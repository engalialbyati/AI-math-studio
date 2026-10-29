// stdio <-> HTTP bridge so MCP clients that only spawn commands (Claude Desktop)
// can reach the Math Studio server. Start the app first with `npm run dev`.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const url = new URL(process.env.MATH_STUDIO_MCP_URL ?? 'http://localhost:3001/mcp')
const stdio = new StdioServerTransport()
const http = new StreamableHTTPClientTransport(url)

stdio.onmessage = (msg) => {
	http.send(msg).catch((err) => {
		if ('id' in msg && msg.id !== undefined) {
			stdio.send({
				jsonrpc: '2.0',
				id: msg.id,
				error: { code: -32000, message: `Math Studio server not reachable at ${url}: ${err.message}. Run "npm run dev".` },
			})
		}
	})
}
http.onmessage = (msg) => stdio.send(msg)
http.onerror = (err) => process.stderr.write(`[math-studio proxy] ${err.message}\n`)
stdio.onclose = () => process.exit(0)

await http.start()
await stdio.start()
