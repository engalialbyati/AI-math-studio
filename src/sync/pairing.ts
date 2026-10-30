import { atom } from 'tldraw'

// A tablet opens the app from the PC's QR code (http://<pc-ip>:5173/?pair=<token>). The token is
// also kept in localStorage so a home-screen shortcut without it still connects.
const KEY = 'ms-pair-token'
const isLocalHost = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname)

function readToken() {
	if (isLocalHost) return null
	const fromUrl = new URLSearchParams(location.search).get('pair')
	try {
		if (fromUrl) localStorage.setItem(KEY, fromUrl)
		return fromUrl ?? localStorage.getItem(KEY)
	} catch {
		return fromUrl
	}
}

export const pairToken = readToken()
// This browser is a paired tablet mirroring the PC app's canvas.
export const isRemote = !!pairToken

// Host only: what the QR code needs.
export const pairInfoAtom = atom<{ token: string; addresses: string[] } | null>('pairInfo', null)

export const syncStatusAtom = atom('syncStatus', {
	hosts: 0, // PC app windows connected
	tablets: 0,
	synced: false, // tablet: loaded the PC's document and receives live changes
})

export function pairUrl(address: string, token: string) {
	return `http://${address}:${location.port || '5173'}/?pair=${encodeURIComponent(token)}`
}
