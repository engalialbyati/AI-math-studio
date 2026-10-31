import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import { requireUser, sameOrigin, type User } from './auth'
import { config } from './config'
import { userDir } from './files'
import { refreshClaude } from './rooms'

// Each user's own Claude login for the AI features, stored encrypted on the server:
// a Claude Code token (`claude setup-token`, uses their Pro/Max plan) or an Anthropic API key.

export interface ClaudeLogin {
	kind: 'oauth' | 'apikey'
	token: string
}

const key = () => createHash('sha256').update(`${config.sessionSecret}:claude-login`).digest()
const file = (u: Pick<User, 'id'>) => join(userDir(u), 'claude.json')

export function readClaudeLogin(u: Pick<User, 'id'>): ClaudeLogin | null {
	try {
		const { kind, iv, tag, data } = JSON.parse(readFileSync(file(u), 'utf8'))
		const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
		d.setAuthTag(Buffer.from(tag, 'base64'))
		const token = Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString()
		return { kind, token }
	} catch {
		return null // none saved, or SESSION_SECRET changed
	}
}

function saveClaudeLogin(u: Pick<User, 'id'>, login: ClaudeLogin) {
	const iv = randomBytes(12)
	const c = createCipheriv('aes-256-gcm', key(), iv)
	const data = Buffer.concat([c.update(login.token), c.final()])
	mkdirSync(userDir(u), { recursive: true })
	const out = { kind: login.kind, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }
	writeFileSync(file(u), JSON.stringify(out), { mode: 0o600 })
}

export function claudeEnv(login: ClaudeLogin): Record<string, string> {
	return login.kind === 'oauth' ? { CLAUDE_CODE_OAUTH_TOKEN: login.token } : { ANTHROPIC_API_KEY: login.token }
}

export function claudeRoutes() {
	const r = express.Router()
	r.use('/api/claude', requireUser, sameOrigin, express.text({ type: '*/*', limit: '8kb' }))
	const user = (req: express.Request) => (req as any).user as User

	r.get('/api/claude', (req, res) => {
		const login = readClaudeLogin(user(req))
		res.json({ connected: !!login, kind: login?.kind ?? null })
	})

	r.put('/api/claude', (req, res) => {
		const token = String(req.body ?? '').trim()
		const kind = token.startsWith('sk-ant-oat') ? 'oauth' : token.startsWith('sk-ant-api') ? 'apikey' : null
		if (!kind || !/^[\w-]{20,300}$/.test(token)) {
			res.status(400).json({ error: 'That does not look like a Claude token (sk-ant-oat…) or API key (sk-ant-api…).' })
			return
		}
		saveClaudeLogin(user(req), { kind, token })
		refreshClaude(user(req))
		res.json({ connected: true, kind })
	})

	r.delete('/api/claude', (req, res) => {
		rmSync(file(user(req)), { force: true })
		refreshClaude(user(req))
		res.json({ connected: false, kind: null })
	})

	return r
}
