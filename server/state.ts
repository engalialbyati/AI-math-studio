import type { WebSocket } from 'ws'
import type { AiRequest, ClientToServer, DocSnapshot, ServerToClient } from '../src/sync/protocol'
import { Agent } from './agent'

export interface TrackedRequest extends AiRequest {
	status: 'pending' | 'working' | 'done' | 'error'
	message?: string
}

// Live mirror of the browser canvas plus the AI request queue.
class AppState {
	doc: DocSnapshot | null = null
	requests = new Map<string, TrackedRequest>()
	private clients = new Set<WebSocket>()
	private docClient: WebSocket | null = null // browser whose canvas the mirror reflects
	private pendingCmds = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
	private waiters = new Set<(r: TrackedRequest | null) => void>()
	private lastMcp = 0
	private cmdCounter = 0
	agent!: Agent

	initAgent(port: number) {
		this.agent = new Agent(port, (event) => {
			this.broadcast({ type: 'agent', event })
			if (event.kind === 'start' || event.kind === 'done') this.sendStatus()
		})
		console.log(this.agent.bin ? `[agent] Claude Code: ${this.agent.bin}` : '[agent] Claude Code CLI not found; in-app chat disabled')
	}

	get browserConnected() {
		return this.clients.size > 0
	}

	addClient(ws: WebSocket) {
		this.clients.add(ws)
		this.sendStatus(ws)
		// Send known plan limits; refresh them when stale (>5 min).
		const limits = this.agent?.limits
		if (limits) ws.send(JSON.stringify({ type: 'agent', event: { kind: 'limits', limits } } satisfies ServerToClient))
		if (!limits || Date.now() - limits.checkedAt > 300_000) this.agent?.checkLimits()
		ws.on('message', (raw) => {
			try {
				const msg = JSON.parse(String(raw)) as ClientToServer
				if (msg.type === 'doc') this.docClient = ws
				this.onMessage(msg)
			} catch (err) {
				console.error('[ws] bad message', err)
			}
		})
		ws.on('close', () => {
			this.clients.delete(ws)
			if (this.docClient === ws) this.docClient = null
		})
	}

	private onMessage(msg: ClientToServer) {
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
			this.agent.ask(msg.text, msg.text + sel)
		} else if (msg.type === 'chatStop') {
			this.agent.stop()
		} else if (msg.type === 'checkLimits') {
			this.agent.checkLimits()
		} else if (msg.type === 'agentOptions') {
			this.agent.options = msg.options
		} else if (msg.type === 'chatReset') {
			this.agent.reset()
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
		for (const ws of this.clients) ws.send(data)
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
		const ws = this.docClient ?? [...this.clients].at(-1)
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
		this.agent.ask(
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
