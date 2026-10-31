import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

// Hosted mode: Math Studio on a server, each user signs in with Google and keeps files there.
// Turned on by MATH_STUDIO_HOSTED=1; the desktop app and `npm run dev` stay single-user.
const env = process.env
const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

export const hosted = env.MATH_STUDIO_HOSTED === '1'

export const config = {
	publicUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''), // https://math.example.com
	googleClientId: env.GOOGLE_CLIENT_ID ?? '',
	googleClientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
	// Signs session cookies; set it so sign-ins survive restarts.
	sessionSecret: env.SESSION_SECRET || randomBytes(32).toString('hex'),
	allowedEmails: list(env.ALLOWED_EMAILS), // empty: nobody but admins
	adminEmails: list(env.ADMIN_EMAILS), // may use the AI features
	dataDir: env.DATA_DIR ?? join(process.cwd(), 'data'),
	// Local testing only: /auth/dev?email=... signs in without Google, from this machine only.
	devLogin: env.MATH_STUDIO_DEV_LOGIN === '1',
}

export function checkConfig() {
	if (!hosted) return
	const missing = ['publicUrl', 'googleClientId', 'googleClientSecret'].filter((k) => !(config as any)[k])
	if (missing.length && !config.devLogin) throw new Error(`Hosted mode needs ${missing.join(', ')} (see docs/hosting.md)`)
	if (!process.env.SESSION_SECRET) console.warn('[hosted] SESSION_SECRET not set: everyone is signed out on restart')
	if (!config.allowedEmails.length && !config.adminEmails.length) console.warn('[hosted] ALLOWED_EMAILS and ADMIN_EMAILS are empty: nobody can sign in')
}

export const canSignIn = (email: string) => config.allowedEmails.includes(email) || config.adminEmails.includes(email)
export const isAdmin = (email: string) => config.adminEmails.includes(email)
