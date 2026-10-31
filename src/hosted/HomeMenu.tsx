import { useEffect, useState } from 'react'
import { useEditor, useValue } from 'tldraw'
import {
	claudeStatus,
	connectClaude,
	currentFileAtom,
	disconnectClaude,
	deleteFile,
	homeOpenAtom,
	hostedAtom,
	listFiles,
	newFile,
	openFile,
	renameFile,
	signOut,
	type ServerFile,
} from './hosted'

// Hosted server: the signed-in user's files. Shown at start and from the Home button.
export function HomeMenu() {
	const editor = useEditor()
	const open = useValue('homeOpen', () => homeOpenAtom.get(), [])
	const user = useValue('user', () => hostedAtom.get().user, [])
	const current = useValue('currentFile', () => currentFileAtom.get(), [])
	const [files, setFiles] = useState<ServerFile[] | null>(null)
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)

	const refresh = () =>
		listFiles().then(setFiles, (err) => setError(String(err.message ?? err)))
	useEffect(() => {
		if (open) refresh()
	}, [open])

	if (!open || !user) return null
	const close = () => homeOpenAtom.set(false)
	const run = async (fn: () => Promise<unknown>) => {
		setBusy(true)
		setError(undefined)
		try {
			await fn()
		} catch (err: any) {
			setError(String(err?.message ?? err))
		} finally {
			setBusy(false)
		}
	}

	const create = () => {
		const name = prompt('Name of the new file', 'Untitled')
		if (name === null) return
		run(async () => {
			await newFile(editor, name.trim() || 'Untitled')
			close()
		})
	}

	return (
		<div className="ms-home" onPointerDown={(e) => e.stopPropagation()}>
			<div className="ms-home-card">
				<div className="ms-home-head">
					<span className="ms-logo">∫ Math Studio</span>
					<span className="ms-home-user">
						{user.picture && <img src={user.picture} alt="" referrerPolicy="no-referrer" />}
						{user.email}
					</span>
					<button onClick={signOut}>Sign out</button>
					{current && <button onClick={close} title="Back to the canvas">×</button>}
				</div>
				<div className="ms-home-actions">
					<button className="ms-primary" onClick={create} disabled={busy}>
						+ New file
					</button>
					{!current && (
						<button onClick={close} title="Keep drawing; save it as a file later">
							Continue without a file
						</button>
					)}
				</div>
				{error && <p className="ms-home-error">{error}</p>}
				<ClaudeAccount />
				{!files ? (
					<p className="ms-home-empty">Loading…</p>
				) : !files.length ? (
					<p className="ms-home-empty">No files yet. Make one with New file; it saves itself as you work.</p>
				) : (
					<ul className="ms-home-list">
						{files.map((f) => (
							<li key={f.id} className={f.id === current?.id ? 'current' : ''}>
								<button className="ms-home-open" disabled={busy} onClick={() => run(async () => {
									await openFile(editor, f)
									close()
								})}>
									<span className="ms-home-name">{f.name}</span>
									<span className="ms-home-date">{new Date(f.updatedAt).toLocaleString()}</span>
								</button>
								<button disabled={busy} onClick={() => {
									const name = prompt('Rename file', f.name)
									if (name?.trim()) run(async () => {
										await renameFile(f.id, name.trim())
										if (f.id === current?.id) currentFileAtom.set({ id: f.id, name: name.trim() })
										await refresh()
									})
								}}>Rename</button>
								<button disabled={busy} onClick={() => {
									if (confirm(`Delete "${f.name}"? This cannot be undone.`)) run(async () => {
										await deleteFile(f.id)
										if (f.id === current?.id) currentFileAtom.set(null)
										await refresh()
									})
								}}>Delete</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	)
}

// AI features run on the user's own Claude account: a Claude Code token or an Anthropic API key.
function ClaudeAccount() {
	const [status, setStatus] = useState<{ connected: boolean; kind: string | null } | null>(null)
	const [token, setToken] = useState('')
	const [error, setError] = useState<string>()
	const [open, setOpen] = useState(false)
	useEffect(() => {
		claudeStatus().then(setStatus, () => {})
	}, [])
	if (!status) return null
	const act = (p: Promise<any>) =>
		p.then((s) => {
			setStatus(s)
			setToken('')
			setError(undefined)
			setOpen(false)
		}, (err) => setError(String(err?.message ?? err)))

	return (
		<div className="ms-claude">
			<div className="ms-claude-row">
				<b>Claude AI</b>
				<span className={status.connected ? 'ms-tablet-ok' : 'ms-tablet-wait'}>
					{status.connected ? `Connected (${status.kind === 'oauth' ? 'Claude plan' : 'API key'})` : 'Not connected: chat and AI helper are off'}
				</span>
				{status.connected ? (
					<button onClick={() => act(disconnectClaude())}>Disconnect</button>
				) : (
					<button onClick={() => setOpen((v) => !v)}>Connect</button>
				)}
			</div>
			{open && !status.connected && (
				<div className="ms-claude-form">
					<p>
						With a Claude Pro or Max plan: install Claude Code, run <code>claude setup-token</code> in a terminal, and paste the
						token it prints (starts with <code>sk-ant-oat</code>). Or paste an Anthropic API key (<code>sk-ant-api…</code>).
						It is stored encrypted and used only for your requests.
					</p>
					<input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="sk-ant-…" autoComplete="off" />
					<button className="ms-primary" disabled={!token.trim()} onClick={() => act(connectClaude(token.trim()))}>
						Save
					</button>
					{error && <p className="ms-home-error">{error}</p>}
				</div>
			)}
		</div>
	)
}

export function LoginPage() {
	const dev = useValue('devLogin', () => hostedAtom.get().devLogin, [])
	return (
		<div className="ms-login">
			<div className="ms-home-card">
				<h1 className="ms-logo">∫ Math Studio</h1>
				<p>Sign in to see your files from any device.</p>
				<a className="ms-google" href="/auth/google">Sign in with Google</a>
				{dev && (
					<form action="/auth/dev" className="ms-dev-login">
						<input name="email" placeholder="test email (dev login)" />
						<button>Dev sign in</button>
					</form>
				)}
			</div>
		</div>
	)
}
