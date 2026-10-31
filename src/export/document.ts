import { atom, getSnapshot, loadSnapshot, type Editor } from 'tldraw'

// .mstudio: one self-contained file with every page, equation, slider, widget, sketch and
// image (images are embedded as data URLs, so the file opens anywhere, offline).

const FORMAT = 'math-studio'
const VERSION = 1
const EXT = '.mstudio'

interface MStudioFile {
	format: typeof FORMAT
	version: number
	savedAt: string
	snapshot: ReturnType<typeof getSnapshot>
}

// File the document was opened from / last saved to (Chrome and Edge can write back to it).
let handle: any = null
export const docNameAtom = atom<string | null>('docName', null)

async function toDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const r = new FileReader()
		r.onload = () => resolve(r.result as string)
		r.onerror = () => reject(r.error)
		r.readAsDataURL(blob)
	})
}

// Snapshot of the editor with every asset embedded as a data URL.
export async function embeddedSnapshot(editor: Editor) {
	const snap = getSnapshot(editor.store)
	// Snapshot records are frozen: copy the store so asset sources can be replaced.
	const store: Record<string, any> = { ...snap.document.store }
	const snapshot = { ...snap, document: { ...snap.document, store } }
	for (const [key, rec] of Object.entries(store)) {
		if (rec.typeName !== 'asset' || !rec.props?.src || String(rec.props.src).startsWith('data:')) continue
		try {
			const url = (await editor.resolveAssetUrl(rec.id, { shouldResolveToOriginal: true })) ?? rec.props.src
			const blob = await (await fetch(url)).blob()
			store[key] = { ...rec, props: { ...rec.props, src: await toDataUrl(blob) } }
		} catch (err) {
			console.warn('Could not embed asset', rec.id, err)
		}
	}
	return snapshot
}

export async function serialize(editor: Editor): Promise<string> {
	const snapshot = await embeddedSnapshot(editor)
	const file: MStudioFile = { format: FORMAT, version: VERSION, savedAt: new Date().toISOString(), snapshot }
	return JSON.stringify(file)
}

function download(name: string, content: string) {
	const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
	const a = document.createElement('a')
	a.href = url
	a.download = name
	a.click()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const picker = { types: [{ description: 'Math Studio document', accept: { 'application/json': [EXT] } }] }

export async function saveDocument(editor: Editor, saveAs = false) {
	const content = await serialize(editor)
	const w = window as any
	if (w.showSaveFilePicker) {
		try {
			if (!handle || saveAs) handle = await w.showSaveFilePicker({ suggestedName: (docNameAtom.get() ?? 'untitled') + EXT, ...picker })
			const out = await handle.createWritable()
			await out.write(content)
			await out.close()
			docNameAtom.set(handle.name.replace(/\.mstudio$/, ''))
			return
		} catch (err: any) {
			if (err?.name === 'AbortError') return
			console.warn('Save picker failed, downloading instead', err)
		}
	}
	// Other browsers: download a copy.
	download((docNameAtom.get() ?? 'untitled') + EXT, content)
}

export function load(editor: Editor, text: string, name: string) {
	const data = JSON.parse(text)
	// Older saves were a bare tldraw snapshot (canvas.mathstudio.json).
	const snapshot = data?.format === FORMAT ? data.snapshot : data
	if (data?.format === FORMAT && data.version > VERSION) throw new Error('This file was made by a newer Math Studio')
	loadSnapshot(editor.store, snapshot)
	docNameAtom.set(name.replace(/(\.mstudio|\.mathstudio\.json|\.json)$/, ''))
}

export async function openDocument(editor: Editor) {
	const w = window as any
	if (w.showOpenFilePicker) {
		try {
			const [h] = await w.showOpenFilePicker({ ...picker, types: [{ description: 'Math Studio document', accept: { 'application/json': [EXT, '.json'] } }] })
			const file = await h.getFile()
			load(editor, await file.text(), file.name)
			handle = file.name.endsWith(EXT) ? h : null
			return
		} catch (err: any) {
			if (err?.name === 'AbortError') return
			if (err instanceof SyntaxError || /newer/.test(String(err))) return alert(`Could not open file: ${err.message}`)
		}
	}
	const input = document.createElement('input')
	input.type = 'file'
	input.accept = `${EXT},.json`
	input.onchange = async () => {
		const file = input.files?.[0]
		if (!file) return
		try {
			load(editor, await file.text(), file.name)
			handle = null
		} catch (err: any) {
			alert(`Could not open file: ${err.message ?? err}`)
		}
	}
	input.click()
}

// Drop a .mstudio file on the page to open it.
export function startFileDrop(editor: Editor) {
	const onDrop = async (e: DragEvent) => {
		const file = e.dataTransfer?.files?.[0]
		if (!file?.name.endsWith(EXT)) return
		e.preventDefault()
		e.stopPropagation()
		try {
			load(editor, await file.text(), file.name)
			handle = null
		} catch (err: any) {
			alert(`Could not open file: ${err.message ?? err}`)
		}
	}
	window.addEventListener('drop', onDrop, true)
	return () => window.removeEventListener('drop', onDrop, true)
}
