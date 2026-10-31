import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import express from 'express'
import { checkLogin, createAccount, findById, MIN_PASSWORD, normalizeEmail, setPassword, validEmail, type Account } from './accounts'
import { canSignUp, config } from './config'

// Email + password sign-in and signed session cookies.

export interface User {
	id: string
	email: string
	name: string
}

const COOKIE = 'ms_session'
const SESSION_DAYS = 30

const sign = (data: string) => createHmac('sha256', config.sessionSecret).update(data).digest('base64url')
// Changes when the password changes, which signs out every other session of that account.
const passwordVersion = (a: Account) => createHash('sha256').update(a.passwordHash).digest('base64url').slice(0, 12)

function encodeSession(a: Account) {
	const body = Buffer.from(JSON.stringify({ id: a.id, pv: passwordVersion(a), exp: Date.now() + SESSION_DAYS * 86400_000 })).toString('base64url')
	return `${body}.${sign(body)}`
}

function decodeSession(value?: string): User | null {
	if (!value) return null
	const [body, sig] = value.split('.')
	if (!body || !sig) return null
	const want = Buffer.from(sign(body))
	const got = Buffer.from(sig)
	if (want.length !== got.length || !timingSafeEqual(want, got)) return null
	try {
		const s = JSON.parse(Buffer.from(body, 'base64url').toString())
		if (!s.exp || s.exp < Date.now()) return null
		const a = findById(s.id)
		if (!a || s.pv !== passwordVersion(a)) return null
		return { id: a.id, email: a.email, name: a.name }
	} catch {
		return null
	}
}

function cookies(req: IncomingMessage) {
	const out: Record<string, string> = {}
	for (const part of (req.headers.cookie ?? '').split(';')) {
		const i = part.indexOf('=')
		if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
	}
	return out
}

function setCookie(res: express.Response, name: string, value: string, maxAgeSec: number) {
	const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`]
	if (config.publicUrl.startsWith('https://')) parts.push('Secure')
	res.append('Set-Cookie', parts.join('; '))
}

export function userFrom(req: IncomingMessage): User | null {
	return decodeSession(cookies(req)[COOKIE])
}

function startSession(res: express.Response, a: Account) {
	setCookie(res, COOKIE, encodeSession(a), SESSION_DAYS * 86400)
}

export function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
	const user = userFrom(req)
	if (!user) {
		res.status(401).json({ error: 'Not signed in' })
		return
	}
	;(req as any).user = user
	next()
}

// Changes must come from the app's own pages (on top of SameSite=Lax cookies).
export function sameOrigin(req: express.Request, res: express.Response, next: express.NextFunction) {
	if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin !== config.publicUrl) {
		res.status(403).json({ error: 'Forbidden origin' })
		return
	}
	next()
}

// Slows down password guessing: 10 failed attempts per address or account, then 15 minutes' wait.
const failures = new Map<string, { count: number; until: number }>()
const LIMIT = 10
const WINDOW = 15 * 60_000
function blocked(keys: string[]) {
	const now = Date.now()
	return keys.some((k) => {
		const f = failures.get(k)
		return f && f.until > now && f.count >= LIMIT
	})
}
function fail(keys: string[]) {
	const now = Date.now()
	for (const k of keys) {
		const f = failures.get(k)
		failures.set(k, f && f.until > now ? { count: f.count + 1, until: f.until } : { count: 1, until: now + WINDOW })
	}
}
const clientIp = (req: express.Request) => String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim()

// One-time links that sign a tablet into the account of the person showing the QR code.
const deviceLinks = new Map<string, { id: string; exp: number }>()

export function createDeviceLink(user: User) {
	for (const [k, v] of deviceLinks) if (v.exp < Date.now()) deviceLinks.delete(k)
	const token = randomBytes(24).toString('base64url')
	deviceLinks.set(token, { id: user.id, exp: Date.now() + 5 * 60_000 })
	return `${config.publicUrl}/auth/link?token=${token}`
}

export function authRoutes() {
	const r = express.Router()
	r.use('/auth', express.json({ limit: '4kb' }))

	r.post('/auth/signup', sameOrigin, async (req, res) => {
		const email = normalizeEmail(req.body?.email)
		const password = String(req.body?.password ?? '')
		if (!validEmail(email)) return void res.status(400).json({ error: 'Enter a valid email address.' })
		if (password.length < MIN_PASSWORD) return void res.status(400).json({ error: `Use at least ${MIN_PASSWORD} characters for the password.` })
		if (!canSignUp(email)) return void res.status(403).json({ error: 'This email is not invited to this Math Studio. Ask the owner to add it.' })
		try {
			startSession(res, await createAccount(email, String(req.body?.name ?? ''), password))
			res.json({ ok: true })
		} catch (err: any) {
			res.status(409).json({ error: err.message })
		}
	})

	r.post('/auth/login', sameOrigin, async (req, res) => {
		const email = normalizeEmail(req.body?.email)
		const keys = [`ip:${clientIp(req)}`, `email:${email}`]
		if (blocked(keys)) return void res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' })
		const account = await checkLogin(email, String(req.body?.password ?? ''))
		if (!account) {
			fail(keys)
			return void res.status(401).json({ error: 'Wrong email or password.' })
		}
		startSession(res, account)
		res.json({ ok: true })
	})

	r.post('/auth/password', sameOrigin, requireUser, async (req, res) => {
		const user = (req as any).user as User
		const keys = [`ip:${clientIp(req)}`, `email:${user.email}`]
		if (blocked(keys)) return void res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' })
		const next = String(req.body?.newPassword ?? '')
		if (!(await checkLogin(user.email, String(req.body?.currentPassword ?? '')))) {
			fail(keys)
			return void res.status(401).json({ error: 'Current password is wrong.' })
		}
		if (next.length < MIN_PASSWORD) return void res.status(400).json({ error: `Use at least ${MIN_PASSWORD} characters for the password.` })
		await setPassword(user.id, next)
		startSession(res, findById(user.id)!) // this device stays signed in; others are signed out
		res.json({ ok: true })
	})

	r.get('/auth/link', (req, res) => {
		const token = String(req.query.token ?? '')
		const link = deviceLinks.get(token)
		deviceLinks.delete(token)
		const account = link && link.exp > Date.now() ? findById(link.id) : null
		if (!account) {
			res.status(400).send('This code has expired. Open Connect tablet again for a new one.')
			return
		}
		startSession(res, account)
		res.redirect('/app')
	})

	r.post('/auth/logout', sameOrigin, (_req, res) => {
		setCookie(res, COOKIE, '', 0)
		res.json({ ok: true })
	})

	return r
}
