import { atom, type Editor } from 'tldraw'
import { docNameAtom, load, serialize } from '../export/document'

// Hosted server: Google account, the user's files on the server, and autosave.

export interface HostedUser {
	id: string
	email: string
	name: string
	picture?: string
	admin: boolean
}
export interface ServerFile {
	id: string
	name: string
	createdAt: string
	updatedAt: string
	size: number
}

export const hostedAtom = atom<{ hosted: boolean; user: HostedUser | null; devLogin?: boolean }>('hosted', { hosted: false, user: null })
// The server file on the canvas (null: unsaved canvas).
export const currentFileAtom = atom<{ id: string; name: string } | null>('currentFile', null)
export const saveStateAtom = atom<'saved' | 'saving' | 'unsaved' | 'error'>('saveState', 'saved')
export const homeOpenAtom = atom('homeOpen', false)

export async function loadHostedConfig() {
	try {
		const res = await fetch('/api/config')
		if (res.ok) hostedAtom.set(await res.json())
	} catch {
		// Local server not reachable: plain single-user app.
	}
	return hostedAtom.get()
}

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, init)
	if (res.status === 401) {
		hostedAtom.update((h) => ({ ...h, user: null }))
		throw new Error('Signed out')
	}
	if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)
	return res.json()
}

export const listFiles = () => api<ServerFile[]>('/api/files')
export const deleteFile = (id: string) => api(`/api/files/${id}`, { method: 'DELETE' })
export const renameFile = (id: string, name: string) =>
	api<ServerFile>(`/api/files/${id}?name=${encodeURIComponent(name)}`, { method: 'PUT' })
export const createDeviceLink = () => api<{ url: string }>('/api/device-link', { method: 'POST' })

export async function signOut() {
	await fetch('/auth/logout', { method: 'POST' })
	location.reload()
}

let editorRef: Editor | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
let saving: Promise<unknown> = Promise.resolve()
let announce: (file: { id: string; name: string } | null) => void = () => {}

// Write the canvas to its server file (or a new one when `name` is given).
export function saveNow(name?: string) {
	const editor = editorRef
	if (!editor) return Promise.resolve()
	clearTimeout(saveTimer)
	saving = saving.then(async () => {
		const file = currentFileAtom.get()
		if (!file && !name) return
		saveStateAtom.set('saving')
		try {
			const body = await serialize(editor)
			const meta = file && !name
				? await api<ServerFile>(`/api/files/${file.id}`, { method: 'PUT', body, headers: { 'content-type': 'text/plain' } })
				: await api<ServerFile>(`/api/files?name=${encodeURIComponent(name!)}`, { method: 'POST', body, headers: { 'content-type': 'text/plain' } })
			if (!file || name) {
				const f = { id: meta.id, name: meta.name }
				currentFileAtom.set(f)
				docNameAtom.set(meta.name)
				announce(f)
			}
			saveStateAtom.set('saved')
		} catch (err) {
			console.error('[save]', err)
			saveStateAtom.set('error')
		}
	})
	return saving
}

export async function openFile(editor: Editor, file: ServerFile) {
	await saveNow()
	const text = await fetch(`/api/files/${file.id}`).then((r) => {
		if (!r.ok) throw new Error(`Could not open ${file.name}`)
		return r.text()
	})
	const f = { id: file.id, name: file.name }
	// Tell the other devices first, so their saves go to the right file.
	currentFileAtom.set(f)
	announce(f)
	load(editor, text, file.name)
	saveStateAtom.set('saved')
}

export async function newFile(editor: Editor, name: string) {
	await saveNow()
	editor.run(() => {
		for (const page of editor.getPages().slice(1)) editor.deletePage(page.id)
		editor.setCurrentPage(editor.getPages()[0].id)
		editor.deleteShapes([...editor.getCurrentPageShapeIds()])
	})
	currentFileAtom.set(null)
	await saveNow(name)
}

// Autosave: 2 s after the last change, by the device that holds the document.
export function startAutosave(editor: Editor, isHost: () => boolean, onAnnounce: typeof announce) {
	editorRef = editor
	announce = onAnnounce
	const unlisten = editor.store.listen(
		() => {
			if (!currentFileAtom.get() || !isHost()) return
			saveStateAtom.set('unsaved')
			clearTimeout(saveTimer)
			saveTimer = setTimeout(() => saveNow(), 2000)
		},
		{ scope: 'document' }
	)
	const flush = () => {
		if (saveStateAtom.get() === 'unsaved') saveNow()
	}
	window.addEventListener('pagehide', flush)
	return () => {
		unlisten()
		window.removeEventListener('pagehide', flush)
		clearTimeout(saveTimer)
	}
}

// Save button / Ctrl+S on a hosted server: save the open file, or name a new one.
export function saveToServer() {
	if (currentFileAtom.get()) return saveNow()
	const name = prompt('Save as', docNameAtom.get() ?? 'Untitled')
	if (name?.trim()) return saveNow(name.trim())
}

// The user's own Claude account for the AI features (stored encrypted on the server).
export const claudeStatus = () => api<{ connected: boolean; kind: 'oauth' | 'apikey' | null }>('/api/claude')
export const connectClaude = (token: string) =>
	api<{ connected: boolean; kind: string }>('/api/claude', { method: 'PUT', body: token, headers: { 'content-type': 'text/plain' } })
export const disconnectClaude = () => api('/api/claude', { method: 'DELETE' })
