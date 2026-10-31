import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { config } from './config'

// Email + password accounts in <DATA_DIR>/accounts.json. Passwords are kept only as scrypt hashes.

export interface Account {
	id: string
	email: string
	name: string
	passwordHash: string
	createdAt: string
}

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>
const file = () => join(config.dataDir, 'accounts.json')
export const MIN_PASSWORD = 8

// Read fresh every time (small file), so a password reset from the command line takes effect
// on the running server; reads and writes are synchronous, so they never interleave.
function all(): Account[] {
	try {
		return JSON.parse(readFileSync(file(), 'utf8'))
	} catch {
		return []
	}
}
function save(list: Account[]) {
	mkdirSync(config.dataDir, { recursive: true })
	const tmp = `${file()}.tmp`
	writeFileSync(tmp, JSON.stringify(list, null, 1), { mode: 0o600 })
	renameSync(tmp, file())
}

export const normalizeEmail = (e: unknown) => String(e ?? '').trim().toLowerCase()
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200

async function hash(password: string) {
	const salt = randomBytes(16)
	const key = await scrypt(password, salt, 64)
	return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}

async function verify(password: string, stored: string) {
	const [kind, salt, key] = stored.split('$')
	if (kind !== 'scrypt' || !salt || !key) return false
	const want = Buffer.from(key, 'base64')
	const got = await scrypt(password, Buffer.from(salt, 'base64'), want.length)
	return timingSafeEqual(want, got)
}

export const findById = (id: string) => all().find((a) => a.id === id) ?? null
export const findByEmail = (email: string) => all().find((a) => a.email === email) ?? null

export async function createAccount(email: string, name: string, password: string) {
	const passwordHash = await hash(password)
	const list = all()
	if (list.some((a) => a.email === email)) throw new Error('An account with this email already exists. Sign in instead.')
	const account: Account = {
		id: randomBytes(12).toString('base64url'),
		email,
		name: name.trim().slice(0, 80) || email.split('@')[0],
		passwordHash,
		createdAt: new Date().toISOString(),
	}
	list.push(account)
	save(list)
	return account
}

// Same work whether or not the email exists, so timing does not reveal accounts.
const DUMMY = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64')
export async function checkLogin(email: string, password: string) {
	const account = findByEmail(email)
	const ok = await verify(password, account?.passwordHash ?? DUMMY)
	return ok && account ? account : null
}

export async function setPassword(id: string, password: string) {
	const passwordHash = await hash(password)
	const list = all()
	const account = list.find((a) => a.id === id)
	if (!account) throw new Error('No such account')
	account.passwordHash = passwordHash
	save(list)
}

// Command line, for the server owner: reset a forgotten password.
//   node server/server.mjs reset-password <email> <new password>
export async function resetPasswordCli(argv: string[]) {
	const i = argv.indexOf('reset-password')
	if (i < 0) return false
	const email = normalizeEmail(argv[i + 1])
	const password = argv[i + 2] ?? ''
	const account = findByEmail(email)
	if (!account) console.error(`No account for ${email}`)
	else if (password.length < MIN_PASSWORD) console.error(`Password must be at least ${MIN_PASSWORD} characters`)
	else {
		await setPassword(account.id, password)
		console.log(`Password changed for ${email}`)
	}
	return true
}
