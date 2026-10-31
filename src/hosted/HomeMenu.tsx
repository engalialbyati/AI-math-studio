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
	authRequest,
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
	const [passwordOpen, setPasswordOpen] = useState(false)

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
						{user.email}
					</span>
					<button onClick={() => setPasswordOpen((v) => !v)}>Password</button>
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
				{passwordOpen && <ChangePassword onDone={() => setPasswordOpen(false)} />}
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
	const [mode, setMode] = useState<'login' | 'signup'>('login')
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)

	const submit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		const form = new FormData(e.currentTarget)
		if (mode === 'signup' && form.get('password') !== form.get('confirm')) return setError('The passwords do not match.')
		setBusy(true)
		setError(undefined)
		try {
			await authRequest(mode === 'login' ? '/auth/login' : '/auth/signup', Object.fromEntries(form))
			location.reload()
		} catch (err: any) {
			setError(String(err?.message ?? err))
			setBusy(false)
		}
	}

	return (
		<div className="ms-login">
			<div className="ms-home-card">
				<h1 className="ms-logo">∫ Math Studio</h1>
				<p>{mode === 'login' ? 'Sign in to see your files from any device.' : 'Create your account.'}</p>
				<form className="ms-login-form" onSubmit={submit} key={mode}>
					{mode === 'signup' && <input name="name" placeholder="Name" autoComplete="name" />}
					<input name="email" type="email" placeholder="Email" autoComplete="email" required autoFocus />
					<input
						name="password"
						type="password"
						placeholder={mode === 'signup' ? 'Password (at least 8 characters)' : 'Password'}
						autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
						minLength={mode === 'signup' ? 8 : undefined}
						required
					/>
					{mode === 'signup' && <input name="confirm" type="password" placeholder="Repeat password" autoComplete="new-password" required />}
					{error && <p className="ms-home-error">{error}</p>}
					<button className="ms-primary" disabled={busy}>
						{mode === 'login' ? 'Sign in' : 'Create account'}
					</button>
				</form>
				<p className="ms-login-switch">
					{mode === 'login' ? 'New here? ' : 'Already have an account? '}
					<button
						type="button"
						onClick={() => {
							setMode(mode === 'login' ? 'signup' : 'login')
							setError(undefined)
						}}
					>
						{mode === 'login' ? 'Create an account' : 'Sign in'}
					</button>
				</p>
				{mode === 'login' && <p className="ms-tablet-note">Forgot your password? Ask the owner of this Math Studio to reset it.</p>}
			</div>
		</div>
	)
}

// Change password, from the Home menu. Other devices of this account are signed out.
function ChangePassword({ onDone }: { onDone: () => void }) {
	const [error, setError] = useState<string>()
	const [done, setDone] = useState(false)
	const submit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		const form = new FormData(e.currentTarget)
		if (form.get('newPassword') !== form.get('confirm')) return setError('The new passwords do not match.')
		try {
			await authRequest('/auth/password', Object.fromEntries(form))
			setDone(true)
			setTimeout(onDone, 1500)
		} catch (err: any) {
			setError(String(err?.message ?? err))
		}
	}
	return (
		<form className="ms-claude ms-login-form" onSubmit={submit}>
			<b>Change password</b>
			<input name="currentPassword" type="password" placeholder="Current password" autoComplete="current-password" required />
			<input name="newPassword" type="password" placeholder="New password (at least 8 characters)" autoComplete="new-password" minLength={8} required />
			<input name="confirm" type="password" placeholder="Repeat new password" autoComplete="new-password" required />
			{error && <p className="ms-home-error">{error}</p>}
			{done ? <p className="ms-tablet-ok">Password changed. Other devices are signed out.</p> : <button className="ms-primary">Change password</button>}
		</form>
	)
}
