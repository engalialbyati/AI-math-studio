import {
	createShapeId,
	loadSnapshot,
	react,
	renderPlaintextFromRichText,
	toRichText,
	type Editor,
	type TLShape,
	type TLShapeId,
} from 'tldraw'
import { widgetErrorsAtom } from '../canvas/shapes/WidgetShape'
import { embeddedSnapshot } from '../export/document'
import { agentOptionsAtom, chatAtom, connectionAtom, getEquationShapes, limitsAtom, requestsAtom, scopeAtom, usageAtom, type ChatMessage, type Region } from '../state'
import type { AgentOptions } from './protocol'
import type { AiRequest, Box, ClientToServer, DocSnapshot, ServerToClient, SyncDiff } from './protocol'
import { followViewAtom, isRemote, pairInfoAtom, pairToken, syncStatusAtom } from './pairing'

// In dev the PC page (Vite, 5173) talks to the server on 3001 and a tablet goes through Vite's /ws proxy.
// The desktop app serves the page and /ws from one port, so both use the page's own host there.
const SERVER_WS = isRemote
	? `ws://${location.host}/ws?token=${encodeURIComponent(pairToken!)}`
	: import.meta.env.DEV
		? `ws://${location.hostname || 'localhost'}:3001/ws`
		: `ws://${location.host}/ws`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let socket: WebSocket | null = null

export function send(msg: ClientToServer) {
	if (socket?.readyState === WebSocket.OPEN) {
		socket.send(JSON.stringify(msg))
		return true
	}
	return false
}

const boxOf = (editor: Editor, s: TLShape): Box => {
	const b = editor.getShapePageBounds(s)!
	return { x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) }
}
const round = (v: number) => Math.round(v)

export function buildSnapshot(editor: Editor): DocSnapshot {
	const { results } = scopeAtom.get()
	const errors = widgetErrorsAtom.get()
	const shapes = editor.getCurrentPageShapes()
	const vp = editor.getViewportPageBounds()
	const pb = editor.getCurrentPageBounds()
	return {
		equations: getEquationShapes(editor).map((s) => {
			const r = results[s.id] ?? {}
			return {
				id: s.id, text: s.props.text, kind: r.kind, name: r.name, params: r.params, tex: r.tex,
				resolved: r.resolved, value: r.value, numeric: r.numeric, error: r.error,
				box: boxOf(editor, s), aiEdited: !!s.meta?.aiEdited || undefined,
			}
		}),
		sliders: shapes.filter((s) => s.type === 'slider').map((s: any) => ({
			id: s.id, name: s.props.name, value: s.props.value, min: s.props.min, max: s.props.max,
			step: s.props.step, box: boxOf(editor, s),
		})),
		widgets: shapes.filter((s) => s.type === 'widget').map((s: any) => ({
			id: s.id, title: s.props.title, box: boxOf(editor, s), error: errors[s.id], codeLength: s.props.code.length,
		})),
		shapes: shapes
			.filter((s) => !['equation', 'slider', 'widget'].includes(s.type))
			.map((s: any) => ({
				id: s.id, type: s.type === 'geo' ? `geo:${s.props.geo}` : s.type, box: boxOf(editor, s),
				text: s.props?.richText ? renderPlaintextFromRichText(editor, s.props.richText) || undefined : undefined,
			})),
		pageBounds: pb ? { x: round(pb.x), y: round(pb.y), w: round(pb.w), h: round(pb.h) } : undefined,
		viewport: { x: round(vp.x), y: round(vp.y), w: round(vp.w), h: round(vp.h) },
	}
}

function shapesInRegion(editor: Editor, region: Region) {
	return editor.getCurrentPageShapes().filter((s) => {
		const b = editor.getShapePageBounds(s)
		return b && b.x < region.x + region.w && b.x + b.w > region.x && b.y < region.y + region.h && b.y + b.h > region.y
	})
}

async function blobToBase64(blob: Blob): Promise<string> {
	const buf = new Uint8Array(await blob.arrayBuffer())
	let bin = ''
	for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
	return btoa(bin)
}

export async function exportImage(editor: Editor, opts: { region?: Region; shapeIds?: TLShapeId[] }) {
	const ids = opts.shapeIds?.length
		? opts.shapeIds
		: opts.region
			? shapesInRegion(editor, opts.region).map((s) => s.id)
			: [...editor.getCurrentPageShapeIds()]
	if (!ids.length) return null
	const bounds = editor.getShapesPageBounds(ids)
	const scale = bounds ? Math.min(2, 1600 / Math.max(bounds.w, bounds.h, 1)) : 1
	const { blob, width, height } = await editor.toImage(ids, { format: 'png', background: true, padding: 16, scale })
	return { image: await blobToBase64(blob), width, height, shapeIds: ids }
}

// Default spot for new content: to the right of `near`, else below existing equations.
function place(editor: Editor, near?: Box, size = { w: 200, h: 40 }) {
	if (near) return { x: near.x + near.w + 40, y: near.y }
	const eqs = getEquationShapes(editor)
	if (eqs.length) {
		const last = eqs.reduce((a, b) => (editor.getShapePageBounds(a)!.maxY > editor.getShapePageBounds(b)!.maxY ? a : b))
		const b = editor.getShapePageBounds(last)!
		return { x: b.x, y: b.maxY + 16 }
	}
	const vp = editor.getViewportPageBounds()
	return { x: vp.center.x - size.w / 2, y: vp.center.y - size.h / 2 }
}

function nearBox(editor: Editor, args: any): Box | undefined {
	if (args.near) {
		const s = editor.getShape(args.near as TLShapeId)
		if (s) return boxOf(editor, s)
	}
	return args.region
}

function mustGet(editor: Editor, id: string, type?: string) {
	const s = editor.getShape(id as TLShapeId)
	if (!s) throw new Error(`No shape with id ${id}`)
	if (type && s.type !== type) throw new Error(`Shape ${id} is a ${s.type}, not a ${type}`)
	return s
}

async function settledResult(id: string) {
	await sleep(120)
	return scopeAtom.get().results[id]
}

const commands: Record<string, (editor: Editor, args: any) => Promise<unknown> | unknown> = {
	getSnapshot: (editor) => buildSnapshot(editor),

	getImage: async (editor, args) => exportImage(editor, { region: args.region, shapeIds: args.shapeIds }),

	addEquation: async (editor, args) => {
		const id = createShapeId()
		const pos = args.x !== undefined ? { x: args.x, y: args.y } : place(editor, nearBox(editor, args))
		editor.createShape({ id, type: 'equation', ...pos, props: { text: String(args.text) }, meta: { aiEdited: true } })
		return { id, result: await settledResult(id) }
	},

	updateEquation: async (editor, args) => {
		const s = mustGet(editor, args.id, 'equation')
		editor.updateShape({ id: s.id, type: 'equation', props: { text: String(args.text) }, meta: { aiEdited: true } })
		return { id: s.id, result: await settledResult(s.id) }
	},

	deleteShapes: (editor, args) => {
		const ids = (args.ids as string[]).filter((id) => editor.getShape(id as TLShapeId)) as TLShapeId[]
		editor.deleteShapes(ids)
		return { deleted: ids }
	},

	moveShape: (editor, args) => {
		const s = mustGet(editor, args.id)
		editor.updateShape({ id: s.id, type: s.type, x: args.x, y: args.y })
		return { id: s.id }
	},

	addSlider: async (editor, args) => {
		// A slider replaces a plain `name = number` equation for the same constant.
		const existing = getEquationShapes(editor).find((s) => {
			const r = scopeAtom.get().results[s.id]
			return r?.name === args.name && r.kind === 'constant'
		})
		const value = args.value ?? scopeAtom.get().results[existing?.id]?.value ?? 1
		const pos = args.x !== undefined ? { x: args.x, y: args.y } : existing ? { x: existing.x, y: existing.y } : place(editor, nearBox(editor, args))
		if (existing) editor.deleteShape(existing.id)
		const id = createShapeId()
		editor.createShape({
			id, type: 'slider', ...pos, meta: { aiEdited: true },
			props: {
				name: args.name, value,
				min: args.min ?? Math.min(0, value), max: args.max ?? Math.max(10, value * 2), step: args.step ?? 0.1,
			},
		})
		return { id, replacedEquation: existing?.id }
	},

	addNote: (editor, args) => {
		const id = createShapeId()
		const pos = args.x !== undefined ? { x: args.x, y: args.y } : place(editor, nearBox(editor, args))
		editor.createShape({
			id, type: 'note', ...pos, meta: { aiEdited: true },
			props: { richText: toRichText(String(args.text)), color: args.color ?? 'violet', size: 's' },
		})
		return { id }
	},

	createWidget: async (editor, args) => {
		const id = createShapeId()
		const w = args.w ?? 460, h = args.h ?? 320
		const pos = args.x !== undefined ? { x: args.x, y: args.y } : place(editor, nearBox(editor, args), { w, h })
		editor.createShape({
			id, type: 'widget', ...pos, meta: args.requestId ? { aiEdited: true, requestId: args.requestId } : { aiEdited: true },
			props: { w, h, title: args.title ?? 'Widget', code: String(args.code) },
		})
		await sleep(1500)
		return { id, error: widgetErrorsAtom.get()[id] ?? null }
	},

	updateWidget: async (editor, args) => {
		const s = mustGet(editor, args.id, 'widget') as any
		const props: any = {}
		for (const k of ['code', 'title', 'w', 'h']) if (args[k] !== undefined) props[k] = args[k]
		editor.updateShape({ id: s.id, type: 'widget', props, meta: { aiEdited: true } })
		await sleep(props.code ? 1500 : 200)
		return { id: s.id, error: widgetErrorsAtom.get()[s.id] ?? null }
	},

	getWidgetCode: (editor, args) => {
		const s = mustGet(editor, args.id, 'widget') as any
		return { id: s.id, title: s.props.title, code: s.props.code, w: s.props.w, h: s.props.h, error: widgetErrorsAtom.get()[s.id] ?? null }
	},

	evaluate: (_editor, args) => scopeAtom.get().evaluate(String(args.text)),

	getProgram: () => scopeAtom.get().program,
}

// Shapes that measure their rendered content and store the size. Only the PC reports those sizes:
// two screens measuring slightly differently would otherwise resize each other forever.
const AUTO_SIZED = new Set(['equation', 'mathtext'])
function isSizeOnly([from, to]: [any, any]) {
	if (!AUTO_SIZED.has(to.type)) return false
	for (const k of Object.keys(to)) if (k !== 'props' && from[k] !== to[k]) return false
	for (const k of Object.keys(to.props)) if (k !== 'w' && k !== 'h' && from.props[k] !== to.props[k]) return false
	return true
}

function outgoingDiff(changes: SyncDiff): SyncDiff | null {
	let updated = changes.updated
	if (isRemote) updated = Object.fromEntries(Object.entries(updated).filter(([, u]) => !isSizeOnly(u)))
	const empty = !Object.keys(changes.added).length && !Object.keys(updated).length && !Object.keys(changes.removed).length
	return empty ? null : { added: changes.added, updated, removed: changes.removed }
}

function applyRemote(editor: Editor, fn: () => void) {
	try {
		editor.store.mergeRemoteChanges(fn)
	} catch (err) {
		console.error('[sync] could not apply remote change', err)
	}
}

export function connectServer(editor: Editor) {
	let stopped = false
	let fitted = false // tablet: zoomed to the PC's drawing once
	// Same view: when a remote view is applied, the camera move it causes is not sent back.
	let viewAppliedAt = 0
	let viewTimer: ReturnType<typeof setTimeout> | undefined
	// The other screen's latest view; the camera glides toward it every frame, so updates that
	// arrive unevenly over Wi-Fi still look smooth.
	let viewTarget: Box | null = null
	let glideFrame = 0
	const glide = () => {
		glideFrame = 0
		if (!viewTarget) return
		const screen = editor.getViewportScreenBounds()
		const b = viewTarget
		const z = Math.min(screen.w / b.w, screen.h / b.h)
		const goal = { x: screen.w / (2 * z) - (b.x + b.w / 2), y: screen.h / (2 * z) - (b.y + b.h / 2), z }
		const cam = editor.getCamera()
		const k = 0.45 // share of the remaining distance covered per frame
		const next = { x: cam.x + (goal.x - cam.x) * k, y: cam.y + (goal.y - cam.y) * k, z: cam.z + (goal.z - cam.z) * k }
		const done = Math.abs(goal.z - cam.z) < 1e-3 * goal.z && Math.hypot((goal.x - cam.x) * z, (goal.y - cam.y) * z) < 0.5
		viewAppliedAt = Date.now()
		editor.setCamera(done ? goal : next, { immediate: true, force: true })
		// Zoom limits can stop the camera short of the goal: stop gliding when it no longer moves.
		const now = editor.getCamera()
		const stuck = Math.abs(now.x - cam.x) + Math.abs(now.y - cam.y) + Math.abs(now.z - cam.z) < 1e-6
		if (done || stuck) viewTarget = null
		else glideFrame = requestAnimationFrame(glide)
	}
	const sendView = () => {
		const st = syncStatusAtom.get()
		if (!followViewAtom.get() || (isRemote ? !st.synced : !st.tablets)) return
		if (Date.now() - viewAppliedAt < 300) return
		const b = editor.getViewportPageBounds()
		send({ type: 'view', pageId: editor.getCurrentPageId(), bounds: { x: b.x, y: b.y, w: b.w, h: b.h } })
	}
	let docTimer: ReturnType<typeof setTimeout> | undefined
	const pushDoc = () => {
		if (isRemote) return // the PC app is the one MCP tools read and drive
		clearTimeout(docTimer)
		docTimer = setTimeout(() => send({ type: 'doc', doc: buildSnapshot(editor) }), 300)
	}

	const open = () => {
		if (stopped) return
		const ws = new WebSocket(SERVER_WS)
		socket = ws
		ws.onopen = () => {
			connectionAtom.update((c) => ({ ...c, server: true }))
			if (!isRemote) send({ type: 'doc', doc: buildSnapshot(editor) })
			send({ type: 'agentOptions', options: agentOptionsAtom.get() })
		}
		ws.onclose = () => {
			syncStatusAtom.update((s) => ({ ...s, synced: false }))
			connectionAtom.set({ server: false, claudeActive: false, claudeWaiting: false, agentAvailable: false, agentBusy: false })
			if (!stopped) setTimeout(open, 2000)
		}
		ws.onmessage = async (ev) => {
			const msg = JSON.parse(ev.data) as ServerToClient
			if (msg.type === 'status') {
				connectionAtom.update((c) => ({
					...c, claudeActive: msg.claudeActive, claudeWaiting: msg.claudeWaiting,
					agentAvailable: msg.agentAvailable, agentBusy: msg.agentBusy,
				}))
			} else if (msg.type === 'agent') {
				onAgentEvent(msg.event)
			} else if (msg.type === 'sync') {
				if (!isRemote || syncStatusAtom.get().synced) applyRemote(editor, () => editor.store.applyDiff(msg.diff as any))
			} else if (msg.type === 'syncRequest') {
				const snap = await embeddedSnapshot(editor)
				send({ type: 'syncSnapshot', for: msg.for, snapshot: snap.document })
			} else if (msg.type === 'syncSnapshot') {
				applyRemote(editor, () => loadSnapshot(editor.store, { document: msg.snapshot as any }))
				viewAppliedAt = Date.now() // the PC's view follows; don't push the tablet's old one
				syncStatusAtom.update((s) => ({ ...s, synced: true }))
				if (!fitted && !followViewAtom.get() && editor.getCurrentPageShapeIds().size) editor.zoomToFit()
				fitted = true
			} else if (msg.type === 'view') {
				if (!followViewAtom.get()) return
				viewAppliedAt = Date.now()
				if (editor.getCurrentPageId() !== msg.pageId && editor.getPage(msg.pageId as any)) editor.setCurrentPage(msg.pageId as any)
				viewTarget = msg.bounds
				if (!glideFrame) glideFrame = requestAnimationFrame(glide)
			} else if (msg.type === 'syncStatus') {
				// A tablet just joined: once it has loaded the document, show it what the PC shows.
				if (!isRemote && msg.tablets > syncStatusAtom.get().tablets) setTimeout(sendView, 1500)
				syncStatusAtom.update((s) => ({ ...s, hosts: msg.hosts, tablets: msg.tablets }))
			} else if (msg.type === 'pairInfo') {
				pairInfoAtom.set({ token: msg.token, addresses: msg.addresses })
			} else if (msg.type === 'requestStatus') {
				requestsAtom.update((list) =>
					list.map((r) => (r.id === msg.id ? { ...r, status: msg.status, message: msg.message } : r))
				)
				if (msg.status === 'done' || msg.status === 'error') {
					setTimeout(() => requestsAtom.update((l) => l.filter((r) => r.id !== msg.id || r.status !== msg.status)), 12000)
				}
			} else if (msg.type === 'cmd') {
				const handler = commands[msg.cmd]
				try {
					if (!handler) throw new Error(`Unknown command ${msg.cmd}`)
					const result = await handler(editor, msg.args ?? {})
					send({ type: 'cmdResult', id: msg.id, ok: true, result })
				} catch (err: any) {
					send({ type: 'cmdResult', id: msg.id, ok: false, error: String(err?.message ?? err) })
				}
				pushDoc()
			}
		}
	}
	open()

	const unlisten = editor.store.listen(pushDoc, { scope: 'document' })
	// Same view: send this screen's camera and page while it changes.
	const stopView = react('send-view', () => {
		editor.getViewportPageBounds()
		editor.getCurrentPageId()
		followViewAtom.get()
		if (viewTimer) return
		// At most once per frame (~60 a second).
		viewTimer = setTimeout(() => {
			viewTimer = undefined
			sendView()
		}, 16)
	})
	// Live canvas sync: the PC sends to paired tablets, a tablet sends once it holds the PC's document.
	const unlistenSync = editor.store.listen(
		({ changes }) => {
			const st = syncStatusAtom.get()
			if (isRemote ? !st.synced : !st.tablets) return
			const diff = outgoingDiff(changes as SyncDiff)
			if (diff) send({ type: 'sync', diff })
		},
		{ scope: 'document', source: 'user' }
	)
	// Scope changes (new results, widget errors) also change the snapshot.
	const stopReact = react('push-doc', () => {
		scopeAtom.get()
		widgetErrorsAtom.get()
		pushDoc()
	})

	return () => {
		stopped = true
		unlisten()
		unlistenSync()
		stopView()
		clearTimeout(viewTimer)
		cancelAnimationFrame(glideFrame)
		stopReact()
		socket?.close()
	}
}

let reqCounter = 0
export async function submitAiRequest(
	editor: Editor,
	input: { prompt: string; action: AiRequest['action']; region?: Region }
): Promise<boolean> {
	const id = `req_${Date.now().toString(36)}_${++reqCounter}`
	const img = await exportImage(editor, { region: input.region }).catch(() => null)
	const request: AiRequest = {
		id,
		prompt: input.prompt,
		action: input.action,
		region: input.region,
		image: img?.image,
		shapeIds: (img?.shapeIds as string[]) ?? [],
		createdAt: Date.now(),
	}
	const ok = send({ type: 'aiRequest', request })
	requestsAtom.update((l) => [
		...l,
		{ id, prompt: input.prompt, action: input.action, region: input.region, status: ok ? 'pending' : 'error', message: ok ? undefined : 'Server not running' },
	])
	return ok
}

export function cancelAiRequest(id: string) {
	send({ type: 'cancelRequest', id })
	requestsAtom.update((l) => l.filter((r) => r.id !== id))
}

let msgCounter = 0
const pushChat = (m: Omit<ChatMessage, 'id'>) => chatAtom.update((l) => [...l, { ...m, id: `m${++msgCounter}` }])

function onAgentEvent(e: import('./protocol').AgentEvent) {
	if (e.kind === 'start') {
		// Runs started by the chat already show the user's message; label the others (AI helper).
		const last = chatAtom.get().at(-1)
		if (!(last?.role === 'user' && last.text === e.label)) pushChat({ role: 'user', text: e.label, runId: e.runId })
	} else if (e.kind === 'text') {
		pushChat({ role: 'assistant', text: e.text, runId: e.runId })
	} else if (e.kind === 'tool') {
		pushChat({ role: 'tool', text: e.name, runId: e.runId })
	} else if (e.kind === 'limits') {
		limitsAtom.set(e.limits)
	} else if (e.kind === 'usage') {
		usageAtom.update(({ total, runs }) => ({
			last: e.usage,
			runs: runs + 1,
			total: {
				model: e.usage.model,
				inputTokens: total.inputTokens + e.usage.inputTokens,
				outputTokens: total.outputTokens + e.usage.outputTokens,
				cacheReadTokens: total.cacheReadTokens + e.usage.cacheReadTokens,
				cacheWriteTokens: total.cacheWriteTokens + e.usage.cacheWriteTokens,
				costUsd: total.costUsd + e.usage.costUsd,
				durationMs: total.durationMs + e.usage.durationMs,
			},
		}))
	} else if (e.kind === 'done' && !e.ok) {
		pushChat({ role: 'error', text: e.error ?? 'Failed', runId: e.runId })
	}
}

export function sendChat(text: string, selection: string[]) {
	pushChat({ role: 'user', text })
	if (!send({ type: 'chat', text, selection })) pushChat({ role: 'error', text: 'Server not running. Start it with npm run dev.' })
}

export function stopChat() {
	send({ type: 'chatStop' })
}

export function resetChat() {
	send({ type: 'chatReset' })
	chatAtom.set([])
	usageAtom.set({ total: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, durationMs: 0 }, runs: 0 })
}

export function checkLimits() {
	send({ type: 'checkLimits' })
}

export function setAgentOptions(options: AgentOptions) {
	agentOptionsAtom.set(options)
	try {
		localStorage.setItem('ms-agent-options', JSON.stringify(options))
	} catch {}
	send({ type: 'agentOptions', options })
}
