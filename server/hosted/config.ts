import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

// Hosted mode: Math Studio on a server, each user has an account (email + password) and keeps
// files there. Turned on by MATH_STUDIO_HOSTED=1; the desktop app and `npm run dev` stay single-user.
const env = process.env
const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

export const hosted = env.MATH_STUDIO_HOSTED === '1'

export const config = {
	publicUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''), // https://math.example.com
	// Signs session cookies and encrypts Claude logins; set it so sign-ins survive restarts.
	sessionSecret: env.SESSION_SECRET || randomBytes(32).toString('hex'),
	// Who may create an account: these emails only; empty means anyone who opens the site.
	allowedEmails: list(env.ALLOWED_EMAILS),
	dataDir: env.DATA_DIR ?? join(process.cwd(), 'data'),
}

export function checkConfig() {
	if (!hosted) return
	if (!config.publicUrl) throw new Error('Hosted mode needs PUBLIC_URL (see docs/hosting.md)')
	if (!process.env.SESSION_SECRET) console.warn('[hosted] SESSION_SECRET not set: everyone is signed out on restart')
	if (!config.allowedEmails.length) console.warn('[hosted] ALLOWED_EMAILS is empty: anyone can create an account')
}

export const canSignUp = (email: string) => !config.allowedEmails.length || config.allowedEmails.includes(email)
