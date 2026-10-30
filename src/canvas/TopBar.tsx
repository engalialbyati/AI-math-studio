import { useState } from 'react'
import { useEditor, useValue } from 'tldraw'
import { docNameAtom, openDocument, saveDocument } from '../export/document'
import { exportHtml } from '../export/exportHtml'
import { LayoutPicker } from './PageLayout'
import { convertInkToEquation, convertStatusAtom, selectedInk } from '../ocr/convert'
import { connectionAtom, setStylesShown, stylesShownAtom } from '../state'
import { submitAiRequest } from '../sync/client'
import { followViewAtom, isRemote, setFollowView, syncStatusAtom } from '../sync/pairing'
import { TabletButton } from './TabletPanel'

export function TopBar() {
	const editor = useEditor()
	const conn = useValue('conn', () => connectionAtom.get(), [])
	const [help, setHelp] = useState(false)
	const docName = useValue('doc-name', () => docNameAtom.get(), [])
	const inkSelected = useValue('inkSelected', () => selectedInk(editor).length > 0, [editor])
	const convert = useValue('convert', () => convertStatusAtom.get(), [])
	const sync = useValue('sync', () => syncStatusAtom.get(), [])
	const follow = useValue('follow', () => followViewAtom.get(), [])
	const stylesShown = useValue('stylesShown', () => stylesShownAtom.get(), [])

	const status = isRemote
		? !conn.server
			? { cls: 'off', text: 'PC not reachable' }
			: !sync.hosts
				? { cls: 'mid', text: 'Open Math Studio on the PC' }
				: sync.synced
					? { cls: 'on', text: 'Live with PC' }
					: { cls: 'mid', text: 'Syncing…' }
		: !conn.server
		? { cls: 'off', text: 'Server offline' }
		: conn.claudeWaiting
			? { cls: 'on', text: 'Claude listening' }
			: conn.agentAvailable
				? { cls: 'on', text: conn.agentBusy ? 'Claude working…' : 'Claude ready' }
				: conn.claudeActive
				? { cls: 'mid', text: 'Claude connected' }
				: { cls: 'mid', text: 'Waiting for Claude (MCP)' }

	return (
		<div className="ms-topbar" onPointerDown={(e) => e.stopPropagation()}>
			<span className="ms-logo">∫ Math Studio</span>
			<button onClick={() => setHelp((v) => !v)} className={`ms-status ${status.cls}`} title="How to connect Claude">
				<span className="dot" />
				{status.text}
			</button>
			{isRemote ? (
				<button onClick={toggleFullscreen} title="Use the whole screen for drawing">Fullscreen</button>
			) : (
				<TabletButton />
			)}
			{(isRemote || sync.tablets > 0) && (
				<button
					onClick={() => setFollowView(!follow)}
					className={follow ? 'ms-toggle on' : 'ms-toggle'}
					title="Panning, zooming or changing page on one screen moves the other one too"
				>
					Same view: {follow ? 'on' : 'off'}
				</button>
			)}
			<button
				onClick={() =>
					submitAiRequest(editor, {
						action: 'review',
						prompt: 'Read all equations on the canvas. Check them for mistakes (math, units, signs, integration constants), fix them, and improve them. Add a note explaining each change.',
					})
				}
			>
				Review all equations
			</button>
			{(inkSelected || convert.busy) && (
				<button onClick={() => convertInkToEquation(editor)} disabled={convert.busy} title="Turn the selected handwriting into a typed equation (offline, Shift+E)">
					{convert.busy ? 'Converting…' : 'Ink → equation'}
				</button>
			)}
			{convert.message && !convert.busy && <span className="ms-convert-msg" title={convert.message}>{convert.message}</span>}
			<LayoutPicker />
			<button onClick={() => setStylesShown(!stylesShown)} title="Show or hide the colour, line width and fill panel">
				{stylesShown ? 'Hide styles' : 'Show styles'}
			</button>
			<button onClick={() => saveDocument(editor)} title={`Save${docName ? ` to ${docName}.mstudio` : ''} (Ctrl+S): pages, equations, text and images in one .mstudio file`}>
				Save
			</button>
			<button onClick={() => saveDocument(editor, true)} title="Save as a new .mstudio file (Ctrl+Shift+S)">Save as</button>
			<button onClick={() => openDocument(editor)} title="Open a .mstudio file (Ctrl+O), or drop one on the page">Open</button>
			{docName && <span className="ms-docname" title="Current file">{docName}.mstudio</span>}
			<button onClick={() => exportHtml(editor, true)} title="Exports the selection, or the whole page if nothing is selected">
				Export HTML
			</button>
			{help && <HelpPanel onClose={() => setHelp(false)} />}
		</div>
	)
}

function toggleFullscreen() {
	if (document.fullscreenElement) document.exitFullscreen()
	else document.documentElement.requestFullscreen?.().catch(() => {})
}

function HelpPanel({ onClose }: { onClose: () => void }) {
	return (
		<div className="ms-help">
			<button className="ms-help-close" onClick={onClose}>×</button>
			<h3>Connect Claude (MCP)</h3>
			<p>
				<b>Claude Code</b>: run once
			</p>
			<pre>claude mcp add --transport http math-studio http://localhost:3001/mcp</pre>
			<p>
				<b>Claude Desktop</b>: add to <code>claude_desktop_config.json</code>
			</p>
			<pre>{`"mcpServers": {
  "math-studio": {
    "command": "node",
    "args": ["<path-to>/Math studio/server/stdio-proxy.mjs"]
  }
}`}</pre>
			<p>
				Then tell Claude: <i>“serve Math Studio requests”</i>. It will wait for AI-helper requests and answer them on the canvas.
			</p>
			<h3>Equations</h3>
			<p>
				Press <kbd>Q</kbd> (or the ∑ tool) and click to type. Examples: <code>y = (1+x)/2</code>, <code>L = 6</code>,{' '}
				<code>f(x) = sin(x)^2</code>, <code>F(x) = integrate(f, x)</code>, <code>g(x) = diff(f, x)</code>,{' '}
				<code>integrate(x^2, x, 0, 2)</code>, Macaulay brackets <code>P*&lt;x-a&gt;^-1</code>.
			</p>
			<h3>AI helper</h3>
			<p>
				Press <kbd>I</kbd> (or the box tool), drag a box around a sketch and equations, and type what you want.
			</p>
		</div>
	)
}
