import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import express from 'express'
import { canSignIn, config, isAdmin } from './config'

// Google sign-in (OAuth 2.0 authorization code flow) and signed session cookies.

export interface User {
	id: string // Google account id ("sub")
	email: string
	name: string
	picture?: string
	admin: boolean
}

const COOKIE = 'ms_session'
const STATE_COOKIE = 'ms_oauth_state'
const SESSION_DAYS = 30

const sign = (data: string) => createHmac('sha256', config.sessionSecret).update(data).digest('base64url')

function encodeSession(u: Omit<User, 'admin'>) {
	const body = Buffer.from(JSON.stringify({ ...u, exp: Date.now() + SESSION_DAYS * 86400_000 })).toString('base64url')
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
		// Re-checked on every request, so removing someone from ALLOWED_EMAILS locks them out.
		if (!s.exp || s.exp < Date.now() || !canSignIn(s.email)) return null
		return { id: s.id, email: s.email, name: s.name, picture: s.picture, admin: isAdmin(s.email) }
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

const secure = () => config.publicUrl.startsWith('https://')
function setCookie(res: express.Response, name: string, value: string, maxAgeSec: number) {
	const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`]
	if (secure()) parts.push('Secure')
	res.append('Set-Cookie', parts.join('; '))
}

export function userFrom(req: IncomingMessage): User | null {
	return decodeSession(cookies(req)[COOKIE])
}

function startSession(res: express.Response, u: Omit<User, 'admin'>) {
	setCookie(res, COOKIE, encodeSession(u), SESSION_DAYS * 86400)
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
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		const origin = req.headers.origin
		if (!origin || (origin !== config.publicUrl && !(config.devLogin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))) {
			res.status(403).json({ error: 'Forbidden origin' })
			return
		}
	}
	next()
}

// One-time links that sign a tablet into the account of the person showing the QR code
// (Google does not allow its sign-in page inside the Android app's web view).
const deviceLinks = new Map<string, { user: Omit<User, 'admin'>; exp: number }>()

export function createDeviceLink(user: User) {
	for (const [k, v] of deviceLinks) if (v.exp < Date.now()) deviceLinks.delete(k)
	const token = randomBytes(24).toString('base64url')
	const { admin: _admin, ...u } = user
	deviceLinks.set(token, { user: u, exp: Date.now() + 5 * 60_000 })
	return `${config.publicUrl}/auth/link?token=${token}`
}

const callbackUrl = () => `${config.publicUrl}/auth/google/callback`

export function authRoutes() {
	const r = express.Router()

	// ?app=1: started from the Windows or Android app, which opened this in the system browser
	// (Google refuses sign-in inside app web views). The app gets a one-time link back.
	r.get('/auth/google', (req, res) => {
		const state = randomBytes(16).toString('base64url') + (req.query.app === '1' ? '.app' : '')
		setCookie(res, STATE_COOKIE, state, 600)
		const q = new URLSearchParams({
			client_id: config.googleClientId,
			redirect_uri: callbackUrl(),
			response_type: 'code',
			scope: 'openid email profile',
			state,
			prompt: 'select_account',
		})
		res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`)
	})

	r.get('/auth/google/callback', async (req, res) => {
		const { code, state } = req.query as Record<string, string>
		if (!code || !state || state !== cookies(req)[STATE_COOKIE]) {
			res.status(400).send('Sign-in expired. <a href="/">Try again</a>')
			return
		}
		setCookie(res, STATE_COOKIE, '', 0)
		try {
			const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					code,
					client_id: config.googleClientId,
					client_secret: config.googleClientSecret,
					redirect_uri: callbackUrl(),
					grant_type: 'authorization_code',
				}),
			})
			const tokens = (await tokenRes.json()) as any
			if (!tokenRes.ok) throw new Error(tokens.error_description ?? tokens.error ?? 'token exchange failed')
			// Ask Google who the token belongs to (no need to verify the id_token ourselves).
			const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
				headers: { authorization: `Bearer ${tokens.access_token}` },
			})
			const info = (await infoRes.json()) as any
			if (!infoRes.ok || !info.sub) throw new Error('could not read the Google account')
			const email = String(info.email ?? '').toLowerCase()
			if (!info.email_verified || !canSignIn(email)) {
				res.status(403).send(`${escapeHtml(email)} is not allowed to use this Math Studio. Ask the owner to add it. <a href="/">Back</a>`)
				return
			}
			const account = { id: String(info.sub), email, name: info.name ?? email, picture: info.picture }
			if (state.endsWith('.app')) {
				res.send(appHandoffPage(createDeviceLink({ ...account, admin: false })))
				return
			}
			startSession(res, account)
			res.redirect('/')
		} catch (err: any) {
			console.error('[auth]', err)
			res.status(502).send('Google sign-in failed. <a href="/">Try again</a>')
		}
	})

	r.get('/auth/link', (req, res) => {
		const link = deviceLinks.get(String(req.query.token ?? ''))
		deviceLinks.delete(String(req.query.token ?? ''))
		if (!link || link.exp < Date.now() || !canSignIn(link.user.email)) {
			res.status(400).send('This code has expired. On the PC, open Connect tablet again for a new one.')
			return
		}
		startSession(res, link.user)
		res.redirect('/')
	})

	r.post('/auth/logout', sameOrigin, (_req, res) => {
		setCookie(res, COOKIE, '', 0)
		res.json({ ok: true })
	})

	if (config.devLogin) {
		r.get('/auth/dev', (req, res) => {
			const addr = req.socket.remoteAddress ?? ''
			const email = String(req.query.email ?? '').toLowerCase()
			if (!/^(::1|127\.|::ffff:127\.)/.test(addr) || !canSignIn(email)) {
				res.status(403).send('Forbidden')
				return
			}
			startSession(res, { id: `dev-${email}`, email, name: email.split('@')[0] })
			res.redirect('/')
		})
	}

	return r
}

// Browser page that hands the sign-in back to the Windows/Android app through mathstudio://.
function appHandoffPage(link: string) {
	const target = `mathstudio://auth?url=${encodeURIComponent(link)}`
	return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Math Studio</title>
<body style="font-family:system-ui;text-align:center;padding:12vh 16px">
<h2 style="color:#7c3aed">Signed in</h2>
<p>Return to the Math Studio app.</p>
<p><a href="${escapeHtml(target)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#7c3aed;color:#fff;text-decoration:none">Open Math Studio</a></p>
<script>location.href=${JSON.stringify(target)}</script>
</body>`
}

function escapeHtml(s: string) {
	return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}
