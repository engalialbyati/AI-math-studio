import type { WebSocket } from 'ws'
import type { AiRequest, ClientToServer, DocSnapshot, ServerToClient } from '../src/sync/protocol'
import { Agent } from './agent'
import { lanAddresses, pairToken } from './pairing'

export interface TrackedRequest extends AiRequest {
	status: 'pending' | 'working' | 'done' | 'error'
	message?: string
}

// A connected browser: the PC app ('host', owns the document) or a paired tablet ('remote').
interface Client {
	id: string
	role: 'host' | 'remote'
	synced: boolean // remote has loaded a host snapshot and gets live changes
	pending: string[] // changes that arrived while its snapshot was on the way
}

// Live mirror of the browser canvas plus the AI request queue. One per signed-in user on a hosted
// server (their devices sync with each other); the single-user app and the admin share `state`.
export class AppState {
	doc: DocSnapshot | null = null
	requests = new Map<string, TrackedRequest>()
	private clients = new Map<WebSocket, Client>()
	private clientCounter = 0
	private docClient: WebSocket | null = null // browser whose canvas the mirror reflects
	private pendingCmds = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
	private waiters = new Set<(r: TrackedRequest | null) => void>()
	private lastMcp = 0
	private cmdCounter = 0
	agent?: Agent
	lanPairing = true // single-user app: hand the PC the tablet pairing token

	initAgent(port: number, opts?: ConstructorParameters<typeof Agent>[2]) {
		this.agent?.stop()
		this.agent = new Agent(
			port,
			(event) => {
				this.broadcast({ type: 'agent', event })
				if (event.kind === 'start' || event.kind === 'done') this.sendStatus()
			},
			opts
		)
		this.sendStatus()
		if (opts) return
		console.log(this.agent!.bin ? `[agent] Claude Code: ${this.agent.bin}` : '[agent] Claude Code CLI not found; in-app chat disabled')
	}

	// Hosted: the user disconnected their Claude account.
	dropAgent() {
		this.agent?.stop()
		this.agent = undefined
		this.sendStatus()
	}

	get empty() {
		return this.clients.size === 0
	}

	hasHost() {
		return this.hosts().length > 0
	}

	get browserConnected() {
		return this.clients.size > 0
	}

	addClient(ws: WebSocket, role: Client['role']) {
		const client: Client = { id: `b${++this.clientCounter}`, role, synced: role === 'host', pending: [] }
		this.clients.set(ws, client)
		ws.send(JSON.stringify({ type: 'hello', remote: role === 'remote' } satisfies ServerToClient))
		this.sendStatus(ws)
		if (role === 'host' && this.lanPairing) ws.send(JSON.stringify({ type: 'pairInfo', token: pairToken, addresses: lanAddresses() } satisfies ServerToClient))
		this.syncStatus()
		// A tablet starts from the PC's document; a PC (re)connecting refreshes every tablet.
		if (role === 'remote') this.requestSnapshot(client)
		else for (const c of this.clients.values()) if (c.role === 'remote') this.requestSnapshot(c)
		// Send known plan limits; refresh them when stale (>5 min).
		const limits = this.agent?.limits
		if (limits) ws.send(JSON.stringify({ type: 'agent', event: { kind: 'limits', limits } } satisfies ServerToClient))
		if (!limits || Date.now() - limits.checkedAt > 300_000) this.agent?.checkLimits()
		ws.on('message', (raw) => {
			try {
				const msg = JSON.parse(String(raw)) as ClientToServer
				if (msg.type === 'doc') this.docClient = ws
				if (msg.type === 'sync' || msg.type === 'syncSnapshot' || msg.type === 'view' || msg.type === 'fileOpened') this.onSync(ws, msg)
				else this.onMessage(msg, ws)
			} catch (err) {
				console.error('[ws] bad message', err)
			}
		})
		ws.on('close', () => {
			this.clients.delete(ws)
			if (this.docClient === ws) this.docClient = null
			if (client.role === 'remote') console.log('[ws] tablet disconnected')
			// The device holding the document left: the next one takes over.
			if (client.role === 'host' && !this.hasHost()) {
				const next = [...this.clients].find(([, c]) => c.synced)
				if (next) {
					next[1].role = 'host'
					next[0].send(JSON.stringify({ type: 'hello', remote: false } satisfies ServerToClient))
				}
			}
			this.syncStatus()
		})
	}

	private hosts() {
		return [...this.clients].filter(([, c]) => c.role === 'host').map(([ws]) => ws)
	}

	private requestSnapshot(client: Client) {
		const host = (this.docClient && this.clients.get(this.docClient)?.role === 'host' ? this.docClient : null) ?? this.hosts().at(-1)
		client.synced = false
		client.pending = []
		host?.send(JSON.stringify({ type: 'syncRequest', for: client.id } satisfies ServerToClient))
	}

	// Relay canvas changes between the PC app and paired tablets.
	private onSync(from: WebSocket, msg: Extract<ClientToServer, { type: 'sync' | 'syncSnapshot' | 'view' | 'fileOpened' }>) {
		if (msg.type === 'syncSnapshot') {
			const entry = [...this.clients].find(([, c]) => c.id === msg.for)
			if (!entry) return
			const [ws, client] = entry
			ws.send(JSON.stringify({ type: 'syncSnapshot', snapshot: msg.snapshot } satisfies ServerToClient))
			for (const data of client.pending) ws.send(data)
			client.pending = []
			client.synced = true
			return
		}
		if (!this.clients.get(from)?.synced) return
		if (msg.type === 'view' || msg.type === 'fileOpened') {
			// Only the latest view matters: not buffered for tablets still loading.
			const data = JSON.stringify(msg satisfies ServerToClient)
			for (const [ws, c] of this.clients) if (ws !== from && c.synced) ws.send(data)
			return
		}
		const data = JSON.stringify({ type: 'sync', diff: msg.diff } satisfies ServerToClient)
		for (const [ws, c] of this.clients) {
			if (ws === from) continue
			if (c.synced) ws.send(data)
			else c.pending.push(data)
		}
	}

	private syncStatus() {
		const all = [...this.clients.values()]
		this.broadcast({
			type: 'syncStatus',
			hosts: all.filter((c) => c.role === 'host').length,
			tablets: all.filter((c) => c.role === 'remote').length,
		})
	}

	private onMessage(msg: ClientToServer, ws: WebSocket) {
		const ai = ['aiRequest', 'chat', 'chatStop', 'checkLimits', 'agentOptions', 'chatReset'].includes(msg.type)
		if (ai && !this.agent) {
			// Hosted server, not an admin: no AI.
			const error = 'AI is only available to the admin of this server.'
			if (msg.type === 'aiRequest') ws.send(JSON.stringify({ type: 'requestStatus', id: msg.request.id, status: 'error', message: error } satisfies ServerToClient))
			if (msg.type === 'chat') ws.send(JSON.stringify({ type: 'agent', event: { kind: 'done', runId: 'none', ok: false, error } } satisfies ServerToClient))
			return
		}
		const agent = this.agent!
		if (msg.type === 'doc') {
			this.doc = msg.doc
		} else if (msg.type === 'aiRequest') {
			const r: TrackedRequest = { ...msg.request, status: 'pending' }
			this.requests.set(r.id, r)
			console.log(`[ai] request ${r.id}: ${r.prompt.slice(0, 80)}`)
			const waiter = this.waiters.values().next().value
			if (waiter) {
				this.waiters.delete(waiter)
				waiter(this.claim(r))
			} else {
				// Nobody is serving over MCP: hand it to the built-in headless agent.
				setTimeout(() => this.autoHandle(r.id), 1500)
			}
		} else if (msg.type === 'chat') {
			const sel = msg.selection?.length
				? `\n\n[Selected shapes: ${msg.selection.join(', ')}. Work ONLY on these; look at them with get_canvas_image {"shapeIds": [...these ids]}. Do not touch anything else.]`
				: '\n\n[Nothing is selected. Do not transform the canvas on your own; if the request needs a target, ask the user to select it.]'
			agent.ask(msg.text, msg.text + sel)
		} else if (msg.type === 'chatStop') {
			agent.stop()
		} else if (msg.type === 'checkLimits') {
			agent.checkLimits()
		} else if (msg.type === 'agentOptions') {
			agent.options = msg.options
		} else if (msg.type === 'chatReset') {
			agent.reset()
		} else if (msg.type === 'cancelRequest') {
			this.requests.delete(msg.id)
		} else if (msg.type === 'cmdResult') {
			const p = this.pendingCmds.get(msg.id)
			if (!p) return
			clearTimeout(p.timer)
			this.pendingCmds.delete(msg.id)
			if (msg.ok) p.resolve(msg.result)
			else p.reject(new Error(msg.error ?? 'Command failed'))
		}
	}

	private broadcast(msg: ServerToClient) {
		const data = JSON.stringify(msg)
		for (const ws of this.clients.keys()) ws.send(data)
	}

	private sendStatus(ws?: WebSocket) {
		const msg: ServerToClient = {
			type: 'status',
			claudeActive: Date.now() - this.lastMcp < 120_000,
			claudeWaiting: this.waiters.size > 0,
			agentAvailable: !!this.agent?.available,
			agentBusy: !!this.agent?.busy,
		}
		if (ws) ws.send(JSON.stringify(msg))
		else this.broadcast(msg)
	}

	touchMcp() {
		const wasActive = Date.now() - this.lastMcp < 120_000
		this.lastMcp = Date.now()
		if (!wasActive) this.sendStatus()
	}

	startStatusTicker() {
		setInterval(() => this.sendStatus(), 10_000)
	}

	// Run a command in the browser and wait for its result.
	command<T = any>(cmd: string, args: unknown = {}, timeoutMs = 20_000): Promise<T> {
		const ws = this.docClient ?? this.hosts().at(-1)
		if (!ws) {
			return Promise.reject(
				new Error('Math Studio is not open in a browser. Ask the user to open http://localhost:5173')
			)
		}
		const id = `c${++this.cmdCounter}`
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingCmds.delete(id)
				reject(new Error(`Browser did not answer "${cmd}" in time`))
			}, timeoutMs)
			this.pendingCmds.set(id, { resolve: resolve as any, reject, timer })
			ws.send(JSON.stringify({ type: 'cmd', id, cmd, args } satisfies ServerToClient))
		})
	}

	private autoHandle(id: string) {
		const r = this.requests.get(id)
		if (!r || r.status !== 'pending' || !this.agent?.available) return
		this.claim(r)
		const where = r.region ? ' on the selected region' : ''
		this.agent!.ask(
			`AI helper${where}: ${r.prompt}`,
			`An AI-helper request from the canvas is waiting (requestId ${r.id}). Call get_ai_request with that id to see the prompt, the image of the selected region and the equations. Work ONLY on the shapes inside the request region (shapesInRegion); do not change anything else. Then call resolve_ai_request with a short message.`,
			(ok, error) => {
				if (this.requests.get(id)?.status === 'working') this.resolveRequest(id, ok, ok ? 'Done' : error?.slice(0, 160))
			}
		)
	}

	private claim(r: TrackedRequest) {
		r.status = 'working'
		this.broadcast({ type: 'requestStatus', id: r.id, status: 'working' })
		return r
	}

	openRequests() {
		return [...this.requests.values()].filter((r) => r.status === 'pending' || r.status === 'working')
	}

	// Next pending request, waiting up to timeoutMs for one to arrive.
	waitForRequest(timeoutMs: number): Promise<TrackedRequest | null> {
		const next = [...this.requests.values()].find((r) => r.status === 'pending')
		if (next) return Promise.resolve(this.claim(next))
		return new Promise((resolve) => {
			const done = (r: TrackedRequest | null) => {
				clearTimeout(timer)
				this.waiters.delete(done)
				this.sendStatus()
				resolve(r)
			}
			const timer = setTimeout(() => done(null), timeoutMs)
			this.waiters.add(done)
			this.sendStatus()
		})
	}

	claimById(id: string) {
		const r = this.requests.get(id)
		if (!r) throw new Error(`No request ${id}`)
		return this.claim(r)
	}

	resolveRequest(id: string, ok: boolean, message?: string) {
		const r = this.requests.get(id)
		if (!r) throw new Error(`No request ${id}`)
		r.status = ok ? 'done' : 'error'
		r.message = message
		r.image = undefined
		this.broadcast({ type: 'requestStatus', id, status: r.status, message })
	}
}

export const state = new AppState()
