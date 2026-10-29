import { createServer } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import { WebSocketServer } from 'ws'
import { createMcpServer } from './mcp'
import { state } from './state'

const PORT = Number(process.env.MATH_STUDIO_PORT ?? 3001)

const app = express()
app.use(express.json({ limit: '20mb' }))

// Only local pages may talk to this server.
app.use((req, res, next) => {
	const origin = req.headers.origin
	if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
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
	if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
		ws.close(1008, 'Forbidden origin')
		return
	}
	console.log('[ws] browser connected')
	state.addClient(ws)
})
state.initAgent(PORT)
state.startStatusTicker()

http.listen(PORT, '127.0.0.1', () => {
	console.log(`Math Studio server on http://localhost:${PORT}`)
	console.log(`  MCP endpoint: http://localhost:${PORT}/mcp`)
	console.log(`  Claude Code:  claude mcp add --transport http math-studio http://localhost:${PORT}/mcp`)
})
