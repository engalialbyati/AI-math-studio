import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import { WebSocketServer } from 'ws'
import { authRoutes, createDeviceLink, requireUser, sameOrigin, userFrom } from './hosted/auth'
import { checkConfig, config, hosted } from './hosted/config'
import { claudeRoutes } from './hosted/claude'
import { resetPasswordCli } from './hosted/accounts'
import { fileRoutes } from './hosted/files'
import { releaseRoom, roomByMcpKey, roomFor, setRoomsPort } from './hosted/rooms'
import { createMcpServer } from './mcp'
import { isLoopback, lanAddresses, pairToken } from './pairing'
import { state, type AppState } from './state'

const PORT = Number(process.env.MATH_STUDIO_PORT ?? 3001)
// 0.0.0.0 so a paired tablet on the same Wi-Fi can reach the WebSocket; 127.0.0.1 keeps it local.
const HOST = process.env.MATH_STUDIO_HOST ?? '0.0.0.0'
// Set by the desktop app to learn when the server is up or failed (e.g. port in use).
const { onServerReady, onServerError } = (globalThis as any).__mathStudioHooks ?? {}
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

// `node server.mjs reset-password <email> <new password>`: change it and exit.
if (await resetPasswordCli(process.argv)) process.exit(0)
checkConfig()
const app = express()

// Desktop app and hosted server: the built web app is served here, to every device.
// Hosted: the landing page is at / and the app at /app; downloads (installer, APK) at /downloads.
const STATIC = process.env.MATH_STUDIO_STATIC && resolve(process.env.MATH_STUDIO_STATIC)
if (STATIC && hosted) {
	app.get('/', (_req, res) => res.sendFile(join(STATIC, 'landing.html'), { dotfiles: 'allow' }))
	app.get(['/app', '/app/'], (_req, res) => res.sendFile(join(STATIC, 'index.html'), { dotfiles: 'allow' }))
	if (process.env.DOWNLOADS_DIR) app.use('/downloads', express.static(process.env.DOWNLOADS_DIR, { index: false }))
	app.use(express.static(STATIC, { index: false }))
} else if (STATIC) app.use(express.static(STATIC))

// Tells the page whether it runs on a hosted server and who is signed in.
app.get('/api/config', (req, res) => {
	const user = hosted ? userFrom(req) : null
	res.json({ hosted, user })
})

if (hosted) {
	app.use(authRoutes())
	app.use(fileRoutes())
	app.use(claudeRoutes())
	// One-time link a tablet scans to sign into the same account (see "Connect tablet").
	app.post('/api/device-link', requireUser, sameOrigin, (req, res) => {
		res.json({ url: createDeviceLink((req as any).user) })
	})
}

app.use('/mcp', express.json({ limit: '20mb' }))

// Only local pages may talk to this server over HTTP (MCP included); tablets use the WebSocket.
app.use((req, res, next) => {
	const origin = req.headers.origin
	// Behind a reverse proxy (hosted), proxied requests are never local.
	const proxied = hosted && !!req.headers['x-forwarded-for']
	if (!isLoopback(req.socket.remoteAddress) || proxied || (origin && !LOCAL_ORIGIN.test(origin))) {
		res.status(403).json({ error: 'Forbidden origin' })
		return
	}
	next()
})

// MCP over Streamable HTTP, stateless: a fresh server + transport per request.
// Hosted: /mcp/<room key> reaches one user's canvas (used by that user's agent on this server).
async function handleMcp(room: AppState, req: express.Request, res: express.Response) {
	room.touchMcp()
	const server = createMcpServer(room)
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
	res.on('close', () => {
		transport.close()
		server.close()
	})
	try {
		await server.connect(transport)
		await transport.handleRequest(req, res, req.body)
	} catch (err) {
		console.error('[mcp]', err)
		if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null })
	}
}
app.post('/mcp', (req, res) => {
	if (hosted) return void res.status(404).json({ error: 'Use your own MCP URL' })
	handleMcp(state, req, res)
})
app.post('/mcp/:key', (req, res) => {
	const room = hosted ? roomByMcpKey(String(req.params.key)) : null
	if (!room) return void res.status(404).json({ error: 'Unknown MCP URL' })
	handleMcp(room, req, res)
})
const notAllowed = (_req: express.Request, res: express.Response) =>
	res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null })
app.get('/mcp', notAllowed)
app.delete('/mcp', notAllowed)

app.get('/health', (_req, res) => {
	res.json({ ok: true, browserConnected: state.browserConnected, openRequests: state.openRequests().length })
})

const http = createServer(app)
const wss = new WebSocketServer({ server: http, path: '/ws' })
// ws re-emits the http server's errors (e.g. port in use); the http handler below reports them.
wss.on('error', () => {})
wss.on('connection', (ws, req) => {
	if (hosted) {
		const user = userFrom(req)
		const origin = req.headers.origin
		const okOrigin = origin === config.publicUrl
		if (!user || !okOrigin) {
			ws.close(1008, user ? 'Forbidden origin' : 'Not signed in')
			return
		}
		const room = roomFor(user)
		// The first device holds the document; later ones load it from there.
		room.addClient(ws, room.hasHost() ? 'remote' : 'host')
		ws.on('close', () => releaseRoom(user))
		return
	}
	const origin = req.headers.origin
	const token = new URL(req.url ?? '', 'http://x').searchParams.get('token')
	// The PC's own browser connects from loopback; anything else is a tablet and needs the pairing token.
	// Tablets come through the Vite proxy, which marks them (it overrides any such header a client sends).
	const proxied = !!req.headers['x-math-studio-proxy']
	const local = isLoopback(req.socket.remoteAddress) && !proxied && (!origin || LOCAL_ORIGIN.test(origin)) && !token
	if (!local && token !== pairToken) {
		ws.close(1008, token ? 'Bad pairing token' : 'Forbidden origin')
		return
	}
	console.log(local ? '[ws] browser connected' : `[ws] tablet connected from ${req.socket.remoteAddress}`)
	state.addClient(ws, local ? 'host' : 'remote')
})
// Hosted: no shared AI; each user's room runs Claude on the account they connected.
if (hosted) setRoomsPort(PORT)
else state.initAgent(PORT)
state.startStatusTicker()

http.on('error', (err) => {
	console.error('[server]', err)
	onServerError?.(err)
})
http.listen(PORT, HOST, () => {
	onServerReady?.()
	console.log(`Math Studio server on http://localhost:${PORT}${hosted ? ` (hosted: ${config.publicUrl})` : ''}`)
	if (HOST !== '127.0.0.1' && !hosted) console.log(`  Tablet: open "Connect tablet" in the app (LAN ${lanAddresses().join(', ') || 'not found'})`)
	console.log(`  MCP endpoint: http://localhost:${PORT}/mcp`)
	console.log(`  Claude Code:  claude mcp add --transport http math-studio http://localhost:${PORT}/mcp`)
})
