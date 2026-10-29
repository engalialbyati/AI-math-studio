import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { state, type TrackedRequest } from './state'

const WIDGET_API = readFileSync(new URL('../docs/widget-api.md', import.meta.url), 'utf8')

const INSTRUCTIONS = `Math Studio is a canvas where the user sketches figures and types equations.
You read and edit it through these tools. The app does the math: equations are plain text like
"y = (1+x)/2", "L = 6", "f(x) = sin(x)^2", "F(x) = integrate(f, x) + C1", "g(x) = diff(f, x)",
"integrate(x^2, x, 0, 2)", Macaulay brackets "P*<x-a>^-1" (impulse), "<x-a>^0" (step).
All equations on the page share one scope; constants and functions can be used anywhere.

Typical loop ("serve Math Studio requests"): call wait_for_ai_request repeatedly. For each request,
look at the image and the equations, do the work with the tools, then call resolve_ai_request.
To make a sketch dynamic: make sure every value is an equation or slider on the canvas, then
create_widget with code that reads ms.C / ms.fn (call get_widget_api once for the API).
When checking equations: use evaluate to verify, update_equation to fix, add_note to explain.`

const text = (v: unknown) => ({
	content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
})
const fail = (err: unknown) => ({
	content: [{ type: 'text' as const, text: `Error: ${(err as Error)?.message ?? err}` }],
	isError: true,
})

const box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })

function inBox(b: { x: number; y: number; w: number; h: number }, r?: { x: number; y: number; w: number; h: number }) {
	if (!r) return true
	return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y
}

const ACTION_HINTS: Record<string, string> = {
	dynamic:
		'Make the sketch dynamic: identify what it shows, ensure the values exist as equations/sliders (add missing ones next to the sketch), then create_widget placed near the region (near = the region, or x/y right of it). Pass requestId. Optionally delete_shapes the sketch only if the user asked to replace it.',
	convert:
		'Read the handwriting in the image and add each line as a typed equation with add_equation (keep the layout order, place near the region). Then, if the user wants, delete_shapes the handwritten strokes.',
	review:
		'Check every equation for mistakes (math, signs, integration constants, units, boundary conditions). Fix with update_equation, explain each change with add_note near the equation. Use evaluate to confirm values.',
	explain: 'Explain with add_note next to the region. Keep notes short; several small notes beat one long one.',
	custom: 'Do what the prompt says using the tools.',
}

function requestPayload(r: TrackedRequest) {
	const doc = state.doc
	const eqs = doc?.equations ?? []
	const payload = {
		requestId: r.id,
		action: r.action,
		prompt: r.prompt,
		region: r.region ?? null,
		hint: ACTION_HINTS[r.action] ?? ACTION_HINTS.custom,
		shapesInRegion: r.region
			? [
					...eqs.filter((e) => inBox(e.box, r.region)).map((e) => ({ kind: 'equation', id: e.id, text: e.text, error: e.error })),
					...(doc?.sliders ?? []).filter((s) => inBox(s.box, r.region)).map((s) => ({ kind: 'slider', id: s.id, name: s.name, value: s.value })),
					...(doc?.widgets ?? []).filter((w) => inBox(w.box, r.region)).map((w) => ({ kind: 'widget', id: w.id, title: w.title })),
					...(doc?.shapes ?? []).filter((s) => inBox(s.box, r.region)).map((s) => ({ kind: s.type, id: s.id, text: s.text, box: s.box })),
				]
			: undefined,
		allEquations: eqs.map((e) => ({
			id: e.id, text: e.text, kind: e.kind, value: e.value, resolved: e.resolved, error: e.error,
		})),
		sliders: doc?.sliders.map((s) => ({ name: s.name, value: s.value, min: s.min, max: s.max })),
	}
	const content: any[] = [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
	if (r.image) content.push({ type: 'image', data: r.image, mimeType: 'image/png' })
	return { content }
}

export function createMcpServer() {
	const server = new McpServer({ name: 'math-studio', version: '0.1.0' }, { instructions: INSTRUCTIONS })
	const tool = (name: string, config: any, handler: (args: any) => Promise<any>) =>
		server.registerTool(name, config, async (args: any) => {
			state.touchMcp()
			try {
				return await handler(args)
			} catch (err) {
				return fail(err)
			}
		})

	tool(
		'get_canvas',
		{
			title: 'Read the canvas',
			description:
				'All equations (id, text, LaTeX, value, resolved form, errors), sliders, widgets (with runtime errors) and other shapes (sketch strokes, notes, text) with page boxes. Coordinates are page units; y grows downward.',
			inputSchema: {},
		},
		async () => {
			const doc = await state.command('getSnapshot').catch(() => state.doc)
			if (!doc) throw new Error('No canvas yet. Ask the user to open http://localhost:5173')
			return text(doc)
		}
	)

	tool(
		'get_canvas_image',
		{
			title: 'Screenshot the canvas',
			description: 'PNG of the whole page, of a region, or of specific shapes.',
			inputSchema: { region: box.optional(), shapeIds: z.array(z.string()).optional() },
		},
		async (args) => {
			const r = await state.command<any>('getImage', args)
			if (!r) return text('The canvas (or region) is empty.')
			return { content: [{ type: 'image', data: r.image, mimeType: 'image/png' }, { type: 'text', text: `${r.width}×${r.height}px, shapes: ${r.shapeIds.join(', ')}` }] }
		}
	)

	tool(
		'wait_for_ai_request',
		{
			title: 'Wait for an AI-helper request',
			description:
				'Long-polls for the next request the user made with the AI helper box tool (or "Review all equations"). Returns the prompt, the selected-region image, the shapes inside it and all equations. Returns "no request" after the timeout: just call again to keep serving.',
			inputSchema: { timeoutSeconds: z.number().min(1).max(300).optional() },
		},
		async ({ timeoutSeconds }) => {
			const r = await state.waitForRequest((timeoutSeconds ?? 55) * 1000)
			if (!r) return text('No request yet. Call wait_for_ai_request again to keep waiting.')
			return requestPayload(r)
		}
	)

	tool(
		'list_ai_requests',
		{
			title: 'List open AI-helper requests',
			description: 'Open requests (pending or being worked on) without waiting. Use get_ai_request to load one.',
			inputSchema: {},
		},
		async () =>
			text(state.openRequests().map((r) => ({ id: r.id, status: r.status, action: r.action, prompt: r.prompt, region: r.region })))
	)

	tool(
		'get_ai_request',
		{
			title: 'Load an AI-helper request',
			description: 'Full request (image + context) by id, and mark it as being worked on.',
			inputSchema: { requestId: z.string() },
		},
		async ({ requestId }) => requestPayload(state.claimById(requestId))
	)

	tool(
		'resolve_ai_request',
		{
			title: 'Finish an AI-helper request',
			description: 'Mark a request done (or failed) with a short message shown to the user on the canvas.',
			inputSchema: { requestId: z.string(), message: z.string().max(200), ok: z.boolean().optional() },
		},
		async ({ requestId, message, ok }) => {
			state.resolveRequest(requestId, ok ?? true, message)
			return text('ok')
		}
	)

	tool(
		'add_equation',
		{
			title: 'Add an equation',
			description:
				'Add a typed equation to the canvas. Returns its id and the evaluated result (value, resolved form, or error). Place with x/y, or near a shape id, or below the last equation by default.',
			inputSchema: {
				text: z.string(),
				x: z.number().optional(),
				y: z.number().optional(),
				near: z.string().optional().describe('Shape id to place the equation to the right of'),
			},
		},
		async (args) => text(await state.command('addEquation', args))
	)

	tool(
		'update_equation',
		{
			title: 'Edit an equation',
			description: 'Replace the text of an existing equation (to fix or improve it). Returns the new result.',
			inputSchema: { id: z.string(), text: z.string() },
		},
		async (args) => text(await state.command('updateEquation', args))
	)

	tool(
		'add_slider',
		{
			title: 'Add a slider',
			description:
				'Bind a constant to a slider so the user can drag it. If an equation "name = number" exists it is replaced by the slider (keeping its value and place).',
			inputSchema: {
				name: z.string(),
				value: z.number().optional(),
				min: z.number().optional(),
				max: z.number().optional(),
				step: z.number().optional(),
				x: z.number().optional(),
				y: z.number().optional(),
				near: z.string().optional(),
			},
		},
		async (args) => text(await state.command('addSlider', args))
	)

	tool(
		'add_note',
		{
			title: 'Add a sticky note',
			description: 'Short explanation, correction or comment placed on the canvas (near a shape id or at x/y).',
			inputSchema: {
				text: z.string(),
				near: z.string().optional(),
				x: z.number().optional(),
				y: z.number().optional(),
				color: z.enum(['violet', 'yellow', 'green', 'red', 'blue', 'orange']).optional(),
			},
		},
		async (args) => text(await state.command('addNote', args))
	)

	tool(
		'get_widget_api',
		{
			title: 'Widget API reference',
			description: 'Documentation of the JS API available inside widget code (ms.C, ms.fn, ms.graph, ...). Read before writing widgets.',
			inputSchema: {},
		},
		async () => text(WIDGET_API)
	)

	tool(
		'create_widget',
		{
			title: 'Create a dynamic widget',
			description:
				'Place a draggable widget whose HTML/JS code renders from the canvas scope (see get_widget_api). Returns its id and any runtime error after it loads — fix errors with update_widget.',
			inputSchema: {
				title: z.string(),
				code: z.string().describe('HTML fragment with <script> using the ms API'),
				w: z.number().optional(),
				h: z.number().optional(),
				x: z.number().optional(),
				y: z.number().optional(),
				near: z.string().optional(),
				region: box.optional().describe('Place to the right of this page box (e.g. the request region)'),
				requestId: z.string().optional(),
			},
		},
		async (args) => text(await state.command('createWidget', args))
	)

	tool(
		'update_widget',
		{
			title: 'Update a widget',
			description: 'Change a widget\'s code, title or size. Returns any runtime error.',
			inputSchema: { id: z.string(), code: z.string().optional(), title: z.string().optional(), w: z.number().optional(), h: z.number().optional() },
		},
		async (args) => text(await state.command('updateWidget', args))
	)

	tool(
		'get_widget_code',
		{ title: 'Read widget code', description: 'Current code, size and error of a widget.', inputSchema: { id: z.string() } },
		async (args) => text(await state.command('getWidgetCode', args))
	)

	tool(
		'delete_shapes',
		{
			title: 'Delete shapes',
			description: 'Delete shapes by id (e.g. sketch strokes after converting them). The user can undo.',
			inputSchema: { ids: z.array(z.string()) },
		},
		async (args) => text(await state.command('deleteShapes', args))
	)

	tool(
		'move_shape',
		{ title: 'Move a shape', description: 'Move a shape to page coordinates x/y.', inputSchema: { id: z.string(), x: z.number(), y: z.number() } },
		async (args) => text(await state.command('moveShape', args))
	)

	tool(
		'evaluate',
		{
			title: 'Evaluate with the canvas engine',
			description:
				'Evaluate an expression with the same engine and scope as the canvas, without adding it. Supports integrate(expr, x[, a, b]) and diff(expr, x). Returns value or resolved symbolic form.',
			inputSchema: { text: z.string() },
		},
		async (args) => text(await state.command('evaluate', args))
	)

	server.registerPrompt(
		'serve-math-studio',
		{ title: 'Serve Math Studio requests', description: 'Keep answering AI-helper requests from the canvas' },
		() => ({
			messages: [
				{
					role: 'user',
					content: {
						type: 'text',
						text: 'Serve Math Studio: call get_widget_api once, then loop on wait_for_ai_request. Handle each request with the canvas tools and finish it with resolve_ai_request. Keep looping until I tell you to stop.',
					},
				},
			],
		})
	)

	server.registerResource(
		'widget-api',
		'mathstudio://docs/widget-api',
		{ title: 'Widget API', mimeType: 'text/markdown' },
		async (uri) => ({ contents: [{ uri: uri.href, text: WIDGET_API, mimeType: 'text/markdown' }] })
	)

	return server
}
