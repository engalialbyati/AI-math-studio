import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import express from 'express'
import { requireUser, sameOrigin, type User } from './auth'
import { config } from './config'

// Each user's documents: <DATA_DIR>/users/<hash of account id>/<file id>.mstudio plus index.json.

export interface FileMeta {
	id: string
	name: string
	createdAt: string
	updatedAt: string
	size: number
}

const MAX_FILE = 50 * 1024 * 1024
export const userDir = (u: Pick<User, 'id'>) => join(config.dataDir, 'users', createHash('sha256').update(u.id).digest('hex').slice(0, 32))
const validId = (id: string) => /^[\w-]{8,40}$/.test(id)

// One write at a time per user, so index updates never interleave.
const queues = new Map<string, Promise<unknown>>()
function serial<T>(u: User, fn: () => Promise<T>): Promise<T> {
	const prev = queues.get(u.id) ?? Promise.resolve()
	const next = prev.then(fn, fn)
	queues.set(u.id, next.catch(() => {}))
	return next
}

async function readIndex(u: User): Promise<FileMeta[]> {
	try {
		return JSON.parse(await readFile(join(userDir(u), 'index.json'), 'utf8'))
	} catch {
		return []
	}
}

async function writeAtomic(path: string, data: string) {
	const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
	await writeFile(tmp, data)
	await rename(tmp, path)
}

async function writeIndex(u: User, list: FileMeta[]) {
	await mkdir(userDir(u), { recursive: true })
	await writeAtomic(join(userDir(u), 'index.json'), JSON.stringify(list, null, 1))
}

const cleanName = (name: unknown) => String(name ?? '').trim().slice(0, 120) || 'Untitled'

export function fileRoutes() {
	const r = express.Router()
	r.use('/api/files', requireUser, sameOrigin, express.text({ type: '*/*', limit: MAX_FILE }))
	const user = (req: express.Request) => (req as any).user as User

	r.get('/api/files', async (req, res) => {
		const list = await readIndex(user(req))
		res.json(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
	})

	r.get('/api/files/:id', async (req, res) => {
		const id = String(req.params.id)
		if (!validId(id)) return void res.status(400).json({ error: 'Bad id' })
		try {
			res.type('application/json').send(await readFile(join(userDir(user(req)), `${id}.mstudio`), 'utf8'))
		} catch {
			res.status(404).json({ error: 'No such file' })
		}
	})

	// Create (no id) or save. Body: the .mstudio JSON; ?name= sets or renames.
	const save = async (req: express.Request, res: express.Response) => {
		const u = user(req)
		const existing = req.params.id !== undefined
		const id = existing ? String(req.params.id) : randomBytes(9).toString('base64url')
		if (!validId(id)) return void res.status(400).json({ error: 'Bad id' })
		const body = typeof req.body === 'string' ? req.body : ''
		if (body) {
			try {
				if (JSON.parse(body)?.format !== 'math-studio') throw new Error()
			} catch {
				return void res.status(400).json({ error: 'Not a Math Studio document' })
			}
		}
		const meta = await serial(u, async () => {
			const list = await readIndex(u)
			const now = new Date().toISOString()
			let m = list.find((f) => f.id === id)
			if (!m) {
				if (existing) throw Object.assign(new Error('No such file'), { status: 404 })
				m = { id, name: cleanName(req.query.name), createdAt: now, updatedAt: now, size: 0 }
				list.push(m)
			}
			if (req.query.name !== undefined) m.name = cleanName(req.query.name)
			if (body) {
				await mkdir(userDir(u), { recursive: true })
				await writeAtomic(join(userDir(u), `${id}.mstudio`), body)
				m.size = Buffer.byteLength(body)
				m.updatedAt = now
			}
			await writeIndex(u, list)
			return m
		}).catch((err) => {
			res.status(err.status ?? 500).json({ error: err.message })
			return null
		})
		if (meta) res.json(meta)
	}
	r.post('/api/files', save)
	r.put('/api/files/:id', save)

	r.delete('/api/files/:id', async (req, res) => {
		const u = user(req)
		const id = String(req.params.id)
		if (!validId(id)) return void res.status(400).json({ error: 'Bad id' })
		await serial(u, async () => {
			await writeIndex(u, (await readIndex(u)).filter((f) => f.id !== id))
			await rm(join(userDir(u), `${id}.mstudio`), { force: true })
		})
		res.json({ ok: true })
	})

	return r
}
