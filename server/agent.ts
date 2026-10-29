import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentEvent, AgentOptions, PlanLimits } from '../src/sync/protocol'

// Runs Claude Code headless (`claude -p`) with the math-studio MCP server, so the in-app
// chat and AI-helper requests work without a separately opened Claude session.
// Uses the user's own Claude Code login; no API key lives in the app.

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const SYSTEM = `You are the AI assistant built into Math Studio, a canvas where the user sketches figures and types equations.
Use the math-studio MCP tools to read and change the canvas: get_canvas / get_canvas_image to look,
add_equation / update_equation / add_slider / add_note to write, get_widget_api then create_widget / update_widget for
dynamic figures. Never hard-code numbers in widgets that exist as canvas equations; add missing values as equations or sliders.
Place new content in empty space (check page boxes in get_canvas) so it does not cover the user's drawing.
SCOPE RULE: only work on what the user selected. If the message lists selected shapes (or an AI-helper request
has a region), read and transform ONLY those shapes; never convert, edit, move or delete anything else on the canvas.
If nothing is selected and the request needs a target, ask the user to select it instead of guessing.
Keep the user's own drawing unless asked to replace it.
Answer in the chat briefly (a few sentences), in the user's language. Do the work; do not ask for permission.`

export function findClaude(): string | null {
	if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN
	const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
	for (const dir of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
		for (const name of process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']) {
			const p = join(dir, name)
			if (existsSync(p)) return p
		}
	}
	// Claude desktop app bundle: %LOCALAPPDATA%/Claude-Data/<profile>/claude-code/<version>/<hash>/claude.exe
	const base = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Claude-Data')
	if (base && existsSync(base)) {
		const found: { path: string; mtime: number }[] = []
		for (const profile of safeDirs(base)) {
			const cc = join(base, profile, 'claude-code')
			for (const ver of safeDirs(cc)) for (const hash of safeDirs(join(cc, ver))) {
				const p = join(cc, ver, hash, exe)
				if (existsSync(p)) found.push({ path: p, mtime: statSync(p).mtimeMs })
			}
		}
		found.sort((a, b) => b.mtime - a.mtime)
		if (found[0]) return found[0].path
	}
	return null
}

// Drop the host app's session variables (e.g. when the server was started from Claude desktop):
// they make the CLI expect host-provided auth instead of the user's own login.
function cleanEnv() {
	return Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/.test(k) || k === 'CLAUDE_CONFIG_DIR')
	)
}

function safeDirs(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
	} catch {
		return []
	}
}

interface Job {
	runId: string
	label: string
	prompt: string
	onDone?: (ok: boolean, error?: string) => void
}

export class Agent {
	readonly bin = findClaude()
	private sessionId: string | null = null
	private queue: Job[] = []
	private current: { job: Job; proc: ChildProcess } | null = null
	private counter = 0
	options: AgentOptions = {}
	limits: PlanLimits | null = null
	private checking = false

	constructor(private port: number, private emit: (e: AgentEvent) => void) {}

	get available() {
		return !!this.bin
	}
	get busy() {
		return !!this.current || this.queue.length > 0
	}

	ask(label: string, prompt: string, onDone?: Job['onDone']) {
		const runId = `run${++this.counter}`
		this.queue.push({ runId, label, prompt, onDone })
		this.pump()
		return runId
	}

	reset() {
		this.stop()
		this.sessionId = null
	}

	// Tiny Haiku call with no tools (~600 tokens) just to read the plan limits Claude Code reports.
	checkLimits() {
		if (!this.bin || this.checking) return
		this.checking = true
		const args = [
			'-p', '--output-format', 'stream-json', '--verbose',
			'--model', 'haiku', '--effort', 'low', '--tools', '', '--system-prompt', 'Reply ok.',
			'--disable-slash-commands', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence',
		]
		const proc = spawn(this.bin, args, { cwd: ROOT, env: cleanEnv(), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
		proc.stdin.end('ok')
		let buf = ''
		proc.stdout.on('data', (d) => {
			buf += d
			let i: number
			while ((i = buf.indexOf('\n')) >= 0) {
				this.readLimits(buf.slice(0, i))
				buf = buf.slice(i + 1)
			}
		})
		proc.on('error', () => (this.checking = false))
		proc.on('close', () => (this.checking = false))
	}

	private readLimits(line: string) {
		if (!line.includes('rate_limit_event')) return
		try {
			const info = JSON.parse(line).rate_limit_info ?? {}
			const w = info.unifiedWindows ?? {}
			this.limits = {
				fiveHour: w.five_hour,
				sevenDay: w.seven_day,
				status: info.status,
				checkedAt: Date.now(),
			}
			this.emit({ kind: 'limits', limits: this.limits })
		} catch {}
	}

	stop() {
		this.queue = []
		this.current?.proc.kill()
	}

	private pump(): void {
		if (this.current || !this.queue.length) return
		const job = this.queue.shift()!
		if (!this.bin) {
			this.emit({ kind: 'done', runId: job.runId, ok: false, error: 'Claude Code CLI not found. Set CLAUDE_BIN to claude.exe.' })
			job.onDone?.(false, 'Claude Code not found')
			return this.pump()
		}
		const mcp = JSON.stringify({ mcpServers: { 'math-studio': { type: 'http', url: `http://127.0.0.1:${this.port}/mcp` } } })
		const args = [
			'-p', '--output-format', 'stream-json', '--verbose',
			'--mcp-config', mcp, '--strict-mcp-config',
			'--allowedTools', 'mcp__math-studio',
			'--disallowedTools', 'mcp__math-studio__wait_for_ai_request',
			'--append-system-prompt', SYSTEM,
		]
		if (this.options.model) args.push('--model', this.options.model)
		if (this.options.effort) args.push('--effort', this.options.effort)
		if (this.sessionId) args.push('--resume', this.sessionId)
		const proc = spawn(this.bin, args, { cwd: ROOT, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
		this.current = { job, proc }
		this.emit({ kind: 'start', runId: job.runId, label: job.label })
		proc.stdin.end(job.prompt)

		let buf = ''
		let stderr = ''
		let resultError: string | undefined
		proc.stdout.on('data', (d) => {
			buf += d
			let i: number
			while ((i = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, i).trim()
				buf = buf.slice(i + 1)
				if (line) resultError = this.onLine(job.runId, line) ?? resultError
			}
		})
		proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)))
		proc.on('error', (err) => (stderr += err.message))
		proc.on('close', (code) => {
			const ok = code === 0 && !resultError
			const error = ok ? undefined : resultError ?? (stderr.trim() || `Claude exited with code ${code}`)
			this.emit({ kind: 'done', runId: job.runId, ok, error })
			job.onDone?.(ok, error)
			this.current = null
			this.pump()
		})
	}

	// Returns an error message when the final result reports one.
	private onLine(runId: string, line: string): string | undefined {
		let msg: any
		try {
			msg = JSON.parse(line)
		} catch {
			return
		}
		if (msg.type === 'rate_limit_event') return void this.readLimits(line)
		if (msg.session_id) this.sessionId = msg.session_id
		if (msg.type === 'assistant') {
			for (const c of msg.message?.content ?? []) {
				if (c.type === 'text' && c.text.trim()) this.emit({ kind: 'text', runId, text: c.text })
				if (c.type === 'tool_use') this.emit({ kind: 'tool', runId, name: String(c.name).replace(/^mcp__math-studio__/, '') })
			}
		}
		if (msg.type === 'result') {
			const u = msg.usage ?? {}
			this.emit({
				kind: 'usage',
				runId,
				usage: {
					model: Object.keys(msg.modelUsage ?? {})[0],
					inputTokens: u.input_tokens ?? 0,
					outputTokens: u.output_tokens ?? 0,
					cacheReadTokens: u.cache_read_input_tokens ?? 0,
					cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
					costUsd: msg.total_cost_usd ?? 0,
					durationMs: msg.duration_ms ?? 0,
				},
			})
		}
		if (msg.type === 'result' && msg.is_error) return String(msg.result ?? msg.subtype ?? 'Claude reported an error')
	}
}
