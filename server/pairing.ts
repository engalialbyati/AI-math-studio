import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, networkInterfaces } from 'node:os'
import { join } from 'node:path'

// Secret a tablet must present to join over the LAN. Kept on disk so a saved tablet
// shortcut keeps working after the server restarts.
const TOKEN_FILE = join(homedir(), '.math-studio', 'pair-token')

function loadToken() {
	try {
		const t = readFileSync(TOKEN_FILE, 'utf8').trim()
		if (/^[\w-]{20,}$/.test(t)) return t
	} catch {}
	const t = randomBytes(18).toString('base64url')
	try {
		mkdirSync(join(homedir(), '.math-studio'), { recursive: true })
		writeFileSync(TOKEN_FILE, t, { mode: 0o600 })
	} catch (err) {
		console.warn('[pair] could not save token', err)
	}
	return t
}

export const pairToken = loadToken()

export function isLoopback(addr?: string) {
	return !!addr && (addr === '::1' || addr.startsWith('127.') || addr.startsWith('::ffff:127.'))
}

// LAN IPv4 addresses a tablet can reach, Wi-Fi/Ethernet first, virtual adapters left out.
export function lanAddresses() {
	const virtual = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|Loopback|Tailscale|ZeroTier/i
	const list: string[] = []
	for (const [name, addrs] of Object.entries(networkInterfaces())) {
		if (virtual.test(name)) continue
		for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) list.push(a.address)
	}
	const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2)
	return list.sort((a, b) => rank(a) - rank(b))
}
