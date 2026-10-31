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

// Who holds the document: 'host' (the PC, or a user's first device on a hosted server) or
// 'remote' (loads the document from the host and mirrors it). The server confirms it on connect.
export const roleAtom = atom<'host' | 'remote'>('role', isRemote ? 'remote' : 'host')
export const remote = () => roleAtom.get() === 'remote'

// Host only: what the QR code needs.
export const pairInfoAtom = atom<{ token: string; addresses: string[] } | null>('pairInfo', null)

export const syncStatusAtom = atom('syncStatus', {
	hosts: 0, // PC app windows connected
	tablets: 0,
	synced: false, // tablet: loaded the PC's document and receives live changes
})

// "Same view": panning, zooming or changing page on one screen moves the other screens too.
function loadFollow() {
	try {
		return localStorage.getItem('ms-same-view') !== '0'
	} catch {
		return true
	}
}
export const followViewAtom = atom('followView', loadFollow())
export function setFollowView(on: boolean) {
	followViewAtom.set(on)
	try {
		localStorage.setItem('ms-same-view', on ? '1' : '0')
	} catch {}
}

export function pairUrl(address: string, token: string) {
	return `http://${address}:${location.port || '5173'}/?pair=${encodeURIComponent(token)}`
}
