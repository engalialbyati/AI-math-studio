// Messages between the browser app and the local server (WebSocket, JSON).

export interface Box {
	x: number
	y: number
	w: number
	h: number
}

export interface DocEquation {
	id: string
	text: string
	kind: string
	name?: string
	params?: string[]
	tex?: string
	resolved?: string
	value?: number
	numeric?: boolean
	error?: string
	box: Box
	aiEdited?: boolean
}

export interface DocSnapshot {
	equations: DocEquation[]
	sliders: { id: string; name: string; value: number; min: number; max: number; step: number; box: Box }[]
	widgets: { id: string; title: string; box: Box; error?: string; codeLength: number }[]
	shapes: { id: string; type: string; box: Box; text?: string }[] // sketches, notes, text, geo...
	pageBounds?: Box
	viewport: Box
}

export interface AiRequest {
	id: string
	prompt: string
	action: 'dynamic' | 'convert' | 'review' | 'explain' | 'custom'
	region?: Box
	image?: string // base64 PNG, no data: prefix
	shapeIds: string[]
	createdAt: number
}

// tldraw store changes (RecordsDiff), relayed between the PC app and paired tablets.
export interface SyncDiff {
	added: Record<string, any>
	updated: Record<string, [any, any]>
	removed: Record<string, any>
}

export type ClientToServer =
	| { type: 'doc'; doc: DocSnapshot }
	| { type: 'aiRequest'; request: AiRequest }
	| { type: 'cancelRequest'; id: string }
	| { type: 'cmdResult'; id: string; ok: boolean; result?: unknown; error?: string }
	| { type: 'chat'; text: string; selection?: string[] }
	| { type: 'chatStop' }
	| { type: 'chatReset' }
	| { type: 'agentOptions'; options: AgentOptions }
	| { type: 'checkLimits' }
	| { type: 'sync'; diff: SyncDiff }
	| { type: 'syncSnapshot'; for: string; snapshot: unknown }
	| { type: 'view'; pageId: string; bounds: Box } // what this screen shows; others follow it

// Model and effort for the built-in agent; empty means the user's Claude Code defaults.
export interface AgentOptions {
	model?: string
	effort?: string
}

// Plan usage limits reported by Claude Code (utilization 0..1, resetsAt in Unix seconds).
export interface PlanLimits {
	fiveHour?: { utilization: number; resetsAt: number }
	sevenDay?: { utilization: number; resetsAt: number }
	status?: string
	checkedAt: number
}

export interface AgentUsage {
	model?: string
	inputTokens: number
	outputTokens: number
	cacheReadTokens: number
	cacheWriteTokens: number
	costUsd: number
	durationMs: number
}

export type AgentEvent =
	| { kind: 'start'; runId: string; label: string }
	| { kind: 'text'; runId: string; text: string }
	| { kind: 'tool'; runId: string; name: string }
	| { kind: 'done'; runId: string; ok: boolean; error?: string }
	| { kind: 'usage'; runId: string; usage: AgentUsage }
	| { kind: 'limits'; limits: PlanLimits }

export type ServerToClient =
	| { type: 'cmd'; id: string; cmd: string; args: any }
	| { type: 'requestStatus'; id: string; status: 'pending' | 'working' | 'done' | 'error'; message?: string }
	| { type: 'status'; claudeActive: boolean; claudeWaiting: boolean; agentAvailable: boolean; agentBusy: boolean }
	| { type: 'agent'; event: AgentEvent }
	| { type: 'sync'; diff: SyncDiff }
	| { type: 'syncRequest'; for: string } // host: send your document for this tablet
	| { type: 'syncSnapshot'; snapshot: unknown } // tablet: load this document
	| { type: 'syncStatus'; hosts: number; tablets: number }
	| { type: 'view'; pageId: string; bounds: Box }
	| { type: 'pairInfo'; token: string; addresses: string[] } // host only
