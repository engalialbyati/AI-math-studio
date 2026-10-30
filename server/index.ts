import { createServer } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import { WebSocketServer } from 'ws'
import { createMcpServer } from './mcp'
import { isLoopback, lanAddresses, pairToken } from './pairing'
import { state } from './state'

const PORT = Number(process.env.MATH_STUDIO_PORT ?? 3001)
// 0.0.0.0 so a paired tablet on the same Wi-Fi can reach the WebSocket; 127.0.0.1 keeps it local.
const HOST = process.env.MATH_STUDIO_HOST ?? '0.0.0.0'
// Set by the desktop app to learn when the server is up or failed (e.g. port in use).
const { onServerReady, onServerError } = (globalThis as any).__mathStudioHooks ?? {}
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

const app = express()

// Desktop app: the built web app is served here, to the PC and to paired tablets alike.
if (process.env.MATH_STUDIO_STATIC) app.use(express.static(process.env.MATH_STUDIO_STATIC))

app.use(express.json({ limit: '20mb' }))

// Only local pages may talk to this server over HTTP (MCP included); tablets use the WebSocket.
app.use((req, res, next) => {
	const origin = req.headers.origin
	if (!isLoopback(req.socket.remoteAddress) || (origin && !LOCAL_ORIGIN.test(origin))) {
		res.status(403).json({ error: 'Forbidden origin' })
		return
	}
	next()
})

// MCP over Streamable HTTP, stateless: a fresh server + transport per request.
app.post('/mcp', async (req, res) => {
	state.touchMcp()
	const server = createMcpServer()
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
wss.on('connection', (ws, req) => {
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
state.initAgent(PORT)
state.startStatusTicker()

http.on('error', (err) => {
	console.error('[server]', err)
	onServerError?.(err)
})
http.listen(PORT, HOST, () => {
	onServerReady?.()
	console.log(`Math Studio server on http://localhost:${PORT}`)
	if (HOST !== '127.0.0.1') console.log(`  Tablet: open "Connect tablet" in the app (LAN ${lanAddresses().join(', ') || 'not found'})`)
	console.log(`  MCP endpoint: http://localhost:${PORT}/mcp`)
	console.log(`  Claude Code:  claude mcp add --transport http math-studio http://localhost:${PORT}/mcp`)
})
