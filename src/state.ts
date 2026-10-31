import { atom, type Editor } from 'tldraw'
import { computeScope, type ScopeResult } from './math/scope'
import type { AgentOptions, AgentUsage, PlanLimits } from './sync/protocol'

export const scopeAtom = atom<ScopeResult>('scope', computeScope([]))

export interface Region {
	x: number
	y: number
	w: number
	h: number
}

export interface AiRequestView {
	id: string
	prompt: string
	action: string
	region?: Region
	status: 'pending' | 'working' | 'done' | 'error'
	message?: string
}

export const connectionAtom = atom('connection', {
	server: false, // WebSocket to local server is open
	claudeActive: false, // an MCP client talked to the server recently
	claudeWaiting: false, // an MCP client is long-polling for requests
	agentAvailable: false, // the server found the Claude Code CLI for the in-app chat
	agentBusy: false,
})

export interface ChatMessage {
	id: string
	role: 'user' | 'assistant' | 'tool' | 'error'
	text: string
	runId?: string
}
export const chatAtom = atom<ChatMessage[]>('chat', [])
export const chatOpenAtom = atom('chatOpen', true)

// Colour / line width / fill panel on the right; can be hidden to free the canvas (tablet).
function loadStylesShown() {
	try {
		return localStorage.getItem('ms-styles-shown') !== '0'
	} catch {
		return true
	}
}
export const stylesShownAtom = atom('stylesShown', loadStylesShown())
export function setStylesShown(on: boolean) {
	stylesShownAtom.set(on)
	try {
		localStorage.setItem('ms-styles-shown', on ? '1' : '0')
	} catch {}
}

function loadOptions(): AgentOptions {
	try {
		return JSON.parse(localStorage.getItem('ms-agent-options') ?? '{}')
	} catch {
		return {}
	}
}
export const agentOptionsAtom = atom<AgentOptions>('agentOptions', loadOptions())

export const limitsAtom = atom<PlanLimits | null>('limits', null)

// Usage of the last chat run and the total since the conversation started.
export const usageAtom = atom<{ last?: AgentUsage; total: AgentUsage; runs: number }>('usage', {
	total: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, durationMs: 0 },
	runs: 0,
})

export const requestsAtom = atom<AiRequestView[]>('requests', [])
// Region being dragged / awaiting a prompt with the AI helper tool.
export const aiSelectionAtom = atom<{ region: Region; stage: 'dragging' | 'prompt' } | null>(
	'aiSelection',
	null
)

export function getEquationShapes(editor: Editor) {
	return editor
		.getCurrentPageShapes()
		.filter((s) => s.type === 'equation')
		.sort((a, b) => a.y - b.y || a.x - b.x) as any[]
}

export function getSliderShapes(editor: Editor) {
	return editor.getCurrentPageShapes().filter((s) => s.type === 'slider') as any[]
}

// Recompute the shared scope whenever equation or slider shapes change.
export function startScopeEngine(editor: Editor) {
	let lastKey = ''
	let timer: ReturnType<typeof setTimeout> | undefined
	const recompute = () => {
		const eqs = getEquationShapes(editor).map((s) => ({ id: s.id, text: s.props.text }))
		const sliders = getSliderShapes(editor).map((s) => ({ id: s.id, name: s.props.name, value: s.props.value }))
		const key = JSON.stringify([eqs, sliders])
		if (key === lastKey) return
		lastKey = key
		scopeAtom.set(computeScope(eqs, sliders))
	}
	recompute()
	return editor.store.listen(
		() => {
			clearTimeout(timer)
			timer = setTimeout(recompute, 40)
		},
		{ scope: 'all', source: 'all' }
	)
}
