import { useState } from 'react'
import { useEditor, useValue } from 'tldraw'
import { aiSelectionAtom, connectionAtom, requestsAtom, type Region } from '../state'
import { cancelAiRequest, submitAiRequest } from '../sync/client'
import { ChatPanel } from './ChatPanel'
import type { AiRequest } from '../sync/protocol'

const QUICK: { action: AiRequest['action']; label: string; prompt: string }[] = [
	{
		action: 'dynamic',
		label: 'Make dynamic',
		prompt: 'Turn this sketch into a dynamic widget. Take every value from the equations on the canvas so it updates live.',
	},
	{ action: 'convert', label: 'Handwriting → equations', prompt: 'Convert the handwritten math in this box into typed equations.' },
	{ action: 'review', label: 'Check & improve', prompt: 'Check these equations for mistakes, fix them and improve them. Explain what you changed with notes.' },
	{ action: 'explain', label: 'Explain', prompt: 'Explain what this shows, step by step, with notes next to it.' },
]

// Draws the AI-helper selection box, the prompt popup and pending-request badges.
export function AiOverlay() {
	const editor = useEditor()
	const sel = useValue('ai-sel', () => aiSelectionAtom.get(), [])
	const requests = useValue('ai-reqs', () => requestsAtom.get(), [])
	// Re-render on camera moves so page boxes map to screen correctly.
	useValue('camera', () => editor.getCamera(), [editor])

	const toScreen = (r: Region) => {
		const a = editor.pageToViewport({ x: r.x, y: r.y })
		const b = editor.pageToViewport({ x: r.x + r.w, y: r.y + r.h })
		return { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y }
	}

	return (
		<>
			{requests.map((r) =>
				r.region ? (
					<div key={r.id} className={`ms-ai-region ${r.status}`} style={toScreen(r.region)}>
						<RequestBadge id={r.id} status={r.status} message={r.message} />
					</div>
				) : null
			)}
			{sel && <div className="ms-ai-region selecting" style={toScreen(sel.region)} />}
			{sel?.stage === 'prompt' && <PromptPopup region={sel.region} pos={toScreen(sel.region)} />}
			<GlobalRequests />
			<ChatPanel />
		</>
	)
}

function RequestBadge({ id, status, message }: { id: string; status: string; message?: string }) {
	const label =
		status === 'pending' ? 'Waiting for AI…' : status === 'working' ? 'AI is working…' : status === 'done' ? `✓ ${message ?? 'Done'}` : `⚠ ${message ?? 'Failed'}`
	return (
		<div className="ms-ai-badge-float">
			<span>{label}</span>
			{(status === 'pending' || status === 'working') && (
				<button onPointerDown={(e) => e.stopPropagation()} onClick={() => cancelAiRequest(id)}>
					cancel
				</button>
			)}
		</div>
	)
}

function GlobalRequests() {
	const requests = useValue('ai-reqs-global', () => requestsAtom.get().filter((r) => !r.region), [])
	if (!requests.length) return null
	return (
		<div className="ms-global-requests">
			{requests.map((r) => (
				<RequestBadge key={r.id} id={r.id} status={r.status} message={r.message ?? r.prompt.slice(0, 60)} />
			))}
		</div>
	)
}

function PromptPopup({ region, pos }: { region: Region; pos: { left: number; top: number; width: number; height: number } }) {
	const editor = useEditor()
	const conn = useValue('conn', () => connectionAtom.get(), [])
	const [text, setText] = useState('')
	const [busy, setBusy] = useState(false)

	const submit = async (action: AiRequest['action'], prompt: string) => {
		if (!prompt.trim()) return
		setBusy(true)
		await submitAiRequest(editor, { prompt, action, region })
		setBusy(false)
		aiSelectionAtom.set(null)
	}

	const top = Math.min(pos.top + pos.height + 8, window.innerHeight - 260)
	return (
		<div
			className="ms-ai-popup"
			style={{ left: Math.max(8, Math.min(pos.left, window.innerWidth - 372)), top: Math.max(8, top) }}
			onPointerDown={(e) => e.stopPropagation()}
			onKeyDown={(e) => e.stopPropagation()}
		>
			<div className="ms-ai-popup-title">AI helper</div>
			{!conn.server && <div className="ms-warn">Server not running — start it with <code>npm run dev</code>.</div>}
			{conn.server && !conn.claudeWaiting && !conn.agentAvailable && (
				<div className="ms-info">
					Request will wait until Claude picks it up. In Claude, say: <i>“serve Math Studio requests”</i>.
				</div>
			)}
			<textarea
				autoFocus
				rows={3}
				placeholder="What should the AI do with this?"
				value={text}
				onChange={(e) => setText(e.currentTarget.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit('custom', text)
					if (e.key === 'Escape') aiSelectionAtom.set(null)
				}}
			/>
			<div className="ms-ai-quick">
				{QUICK.map((q) => (
					<button key={q.action} disabled={busy} onClick={() => submit(q.action, text.trim() ? `${q.prompt}\n\nUser note: ${text}` : q.prompt)}>
						{q.label}
					</button>
				))}
			</div>
			<div className="ms-ai-actions">
				<button onClick={() => aiSelectionAtom.set(null)}>Cancel</button>
				<button className="primary" disabled={busy || !text.trim()} onClick={() => submit('custom', text)}>
					Send (Ctrl+Enter)
				</button>
			</div>
		</div>
	)
}
