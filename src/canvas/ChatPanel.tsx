import { useEffect, useRef, useState } from 'react'
import { useEditor, useValue } from 'tldraw'
import { agentOptionsAtom, chatAtom, chatOpenAtom, connectionAtom, limitsAtom, usageAtom } from '../state'
import { checkLimits, resetChat, sendChat, setAgentOptions, stopChat } from '../sync/client'
import type { AgentUsage } from '../sync/protocol'

// Empty value = the user's Claude Code default.
const MODELS = [
	['', 'Default'],
	['opus', 'Opus'],
	['sonnet', 'Sonnet'],
	['haiku', 'Haiku'],
	['fable', 'Fable'],
]
const EFFORTS = [
	['', 'Default'],
	['low', 'Low'],
	['medium', 'Medium'],
	['high', 'High'],
	['xhigh', 'Extra high'],
	['max', 'Max'],
]

function LimitBar({ label, w }: { label: string; w?: { utilization: number; resetsAt: number } }) {
	if (!w) return null
	const pct = Math.round(w.utilization * 100)
	const reset = new Date(w.resetsAt * 1000).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
	return (
		<div className="ms-limits-row">
			<div className="ms-limits-line">
				<span>{label}</span>
				<span className="ms-limits-meta">Resets {reset} · {pct}%</span>
			</div>
			<div className="ms-limits-bar">
				<div style={{ width: `${Math.min(100, pct)}%`, background: pct >= 90 ? '#dc2626' : pct >= 70 ? '#f59e0b' : '#3b82f6' }} />
			</div>
		</div>
	)
}

const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

function usageTitle(last: AgentUsage, total: AgentUsage, runs: number) {
	const line = (u: AgentUsage) =>
		`input ${u.inputTokens}, cache read ${u.cacheReadTokens}, cache write ${u.cacheWriteTokens}, output ${u.outputTokens}, $${u.costUsd.toFixed(4)}`
	return `Model: ${last.model ?? '?'}\nLast run (${(last.durationMs / 1000).toFixed(1)} s): ${line(last)}\nThis chat (${runs} runs): ${line(total)}\nCost is the API-price estimate from Claude Code; on a subscription it counts toward your plan limits instead.`
}

// Chat with Claude about the canvas. Messages go to the local server, which runs Claude Code
// headless with the math-studio tools; AI-helper requests show up here too.
export function ChatPanel() {
	const editor = useEditor()
	const open = useValue('chat-open', () => chatOpenAtom.get(), [])
	const messages = useValue('chat', () => chatAtom.get(), [])
	const conn = useValue('conn', () => connectionAtom.get(), [])
	const options = useValue('agent-options', () => agentOptionsAtom.get(), [])
	const usage = useValue('usage', () => usageAtom.get(), [])
	const limits = useValue('limits', () => limitsAtom.get(), [])
	const [text, setText] = useState('')
	const listRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
	}, [messages.length, open])

	if (!open) {
		return (
			<button className="ms-chat-fab" onPointerDown={(e) => e.stopPropagation()} onClick={() => chatOpenAtom.set(true)}>
				💬 Chat with Claude
			</button>
		)
	}

	const submit = () => {
		const t = text.trim()
		if (!t) return
		sendChat(t, editor.getSelectedShapeIds())
		setText('')
	}

	const status = !conn.server
		? 'Server offline'
		: !conn.agentAvailable
			? 'Claude Code CLI not found'
			: conn.agentBusy
				? 'Claude is working…'
				: 'Ready'

	return (
		<div
			className="ms-chat"
			onPointerDown={(e) => e.stopPropagation()}
			onKeyDown={(e) => e.stopPropagation()}
			onWheel={(e) => e.stopPropagation()}
		>
			<div className="ms-chat-head">
				<b>Claude</b>
				<span className={`ms-chat-status ${conn.agentBusy ? 'busy' : ''}`}>{status}</span>
				<button title="New conversation" onClick={resetChat}>New</button>
				<button title="Hide" onClick={() => chatOpenAtom.set(false)}>×</button>
			</div>
			<div className="ms-chat-opts">
				<label>
					Model
					<select value={options.model ?? ''} onChange={(e) => setAgentOptions({ ...options, model: e.currentTarget.value || undefined })}>
						{MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
					</select>
				</label>
				<label>
					Thinking
					<select value={options.effort ?? ''} onChange={(e) => setAgentOptions({ ...options, effort: e.currentTarget.value || undefined })}>
						{EFFORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
					</select>
				</label>
			</div>
			<div className="ms-limits">
				<div className="ms-limits-head">
					Plan usage limits
					<button title="Check now (tiny Haiku call)" onClick={checkLimits}>↻</button>
				</div>
				{limits ? (
					<>
						<LimitBar label="5-hour limit" w={limits.fiveHour} />
						<LimitBar label="Weekly · all models" w={limits.sevenDay} />
					</>
				) : (
					<div className="ms-limits-row">Checking…</div>
				)}
			</div>
			<div className="ms-chat-list" ref={listRef}>
				{!messages.length && (
					<div className="ms-chat-empty">
						Ask anything about the canvas. Claude can read your sketches and equations and edit the canvas.
						<br />
						<br />
						Try: <i>“Turn my beam sketch into a live SFD and BMD”</i> or <i>“Check my equations for mistakes”</i>.
						Select shapes first to point Claude at them.
					</div>
				)}
				{messages.map((m) =>
					m.role === 'tool' ? (
						<div key={m.id} className="ms-chat-tool">⚙ {m.text.replace(/_/g, ' ')}</div>
					) : (
						<div key={m.id} className={`ms-chat-msg ${m.role}`}>{m.text}</div>
					)
				)}
				{conn.agentBusy && <div className="ms-chat-typing">Claude is working…</div>}
			</div>
			{usage.last && (
				<div className="ms-chat-usage" title={usageTitle(usage.last, usage.total, usage.runs)}>
					Last: {tokens(usage.last.inputTokens + usage.last.cacheReadTokens + usage.last.cacheWriteTokens)} in · {tokens(usage.last.outputTokens)} out · ${usage.last.costUsd.toFixed(3)}
					<span> | Chat: ${usage.total.costUsd.toFixed(3)} ({usage.runs})</span>
				</div>
			)}
			<div className="ms-chat-input">
				<textarea
					rows={2}
					value={text}
					placeholder={conn.agentAvailable ? 'Message Claude… (Enter to send)' : 'Claude Code is not available'}
					onChange={(e) => setText(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault()
							submit()
						}
					}}
				/>
				{conn.agentBusy ? (
					<button onClick={stopChat}>Stop</button>
				) : (
					<button className="primary" disabled={!text.trim()} onClick={submit}>Send</button>
				)}
			</div>
		</div>
	)
}
