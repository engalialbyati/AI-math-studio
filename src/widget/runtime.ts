import { helpersSource } from '../math/helpers'

// The runtime injected into every widget iframe (and into exported HTML pages).
// It must stay plain browser JS: it runs in a sandboxed, opaque-origin iframe.
// `ms` is the API AI-written widget code uses. See docs/widget-api.md.
export const KATEX_VERSION = '0.16.22'
export const KATEX_CSS = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`
const KATEX_JS = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.js`

function widgetRuntime(H: any) {
	const w = window as any
	const listeners: Array<(s: any) => void> = []
	const NS = 'http://www.w3.org/2000/svg'
	const ms: any = {
		C: {},
		fn: {},
		width: innerWidth,
		height: innerHeight,
		program: null,
		H,
	}
	w.ms = ms

	const post = (msg: any) => parent.postMessage({ source: 'math-studio-widget', ...msg }, '*')
	const report = (err: any) => {
		const message = String(err && err.stack ? err.message : err)
		post({ type: 'error', message })
		let box = document.getElementById('__ms_err')
		if (!box) {
			box = document.createElement('div')
			box.id = '__ms_err'
			box.style.cssText =
				'position:fixed;left:0;right:0;bottom:0;background:#fee2e2;color:#991b1b;font:12px monospace;padding:4px 6px;white-space:pre-wrap;z-index:99'
			document.body.appendChild(box)
		}
		box.textContent = message
	}
	const clearError = () => {
		document.getElementById('__ms_err')?.remove()
		post({ type: 'ok' })
	}
	w.addEventListener('error', (e: ErrorEvent) => report(e.error || e.message))
	w.addEventListener('unhandledrejection', (e: any) => report(e.reason))

	function build(program: any) {
		const C: Record<string, number> = { ...program.constants }
		const fn: Record<string, any> = {}
		for (const name of Object.keys(program.functions)) {
			const f = program.functions[name]
			const params = f.params.map((p: string) => 'v_' + p).join(', ')
			fn[name] = new Function('C', 'H', `return (${params}) => ${f.js}`)(C, H)
			fn[name].params = f.params
		}
		ms.C = C
		ms.fn = fn
		ms.program = program
	}

	function fire() {
		ms.width = innerWidth
		ms.height = innerHeight
		try {
			for (const cb of listeners) cb(ms)
			clearError()
		} catch (err) {
			report(err)
		}
	}

	ms.onUpdate = (cb: (s: any) => void) => {
		listeners.push(cb)
		if (ms.program) {
			try {
				cb(ms)
			} catch (err) {
				report(err)
			}
		}
	}
	ms.get = (name: string) => (name in ms.fn ? ms.fn[name] : ms.C[name])

	ms.sample = (f: (x: number) => number, a: number, b: number, n = 400) => {
		const pts: [number, number][] = []
		for (let i = 0; i <= n; i++) {
			const x = a + ((b - a) * i) / n
			pts.push([x, f(x)])
		}
		return pts
	}
	ms.extrema = (f: (x: number) => number, a: number, b: number, n = 2000) => {
		let min = { x: a, y: Infinity }, max = { x: a, y: -Infinity }
		for (let i = 0; i <= n; i++) {
			const x = a + ((b - a) * i) / n
			const y = f(x)
			if (!Number.isFinite(y)) continue
			if (y < min.y) min = { x, y }
			if (y > max.y) max = { x, y }
		}
		return { min, max }
	}
	ms.roots = (f: (x: number) => number, a: number, b: number, n = 2000) => {
		const out: number[] = []
		let px = a, py = f(a)
		for (let i = 1; i <= n; i++) {
			const x = a + ((b - a) * i) / n
			const y = f(x)
			if (py === 0) out.push(px)
			else if (py * y < 0) out.push(px - (py * (x - px)) / (y - py))
			px = x
			py = y
		}
		return out
	}
	ms.fmt = (v: number, digits = 4) => {
		if (!Number.isFinite(v)) return String(v)
		const r = Number(v.toPrecision(digits))
		return String(Math.abs(r) < 1e-12 ? 0 : r)
	}

	ms.tex = (el: any, latex: string, display = false) => {
		const target = typeof el === 'string' ? document.querySelector(el) : el
		if (!target) return
		if (w.katex) w.katex.render(latex, target, { throwOnError: false, displayMode: display })
		else target.textContent = latex
	}

	function svgEl(tag: string, attrs: Record<string, any>, parentEl?: Element) {
		const el = document.createElementNS(NS, tag)
		for (const k of Object.keys(attrs)) if (attrs[k] !== undefined) el.setAttribute(k, String(attrs[k]))
		parentEl?.appendChild(el)
		return el
	}
	ms.svgEl = svgEl

	// Retained-mode 2D plot in data coordinates. Draws on the next microtask.
	ms.graph = (target: any, opts: any = {}) => {
		const host = typeof target === 'string' ? document.querySelector(target) : target || document.body
		const width = opts.width ?? host.clientWidth ?? innerWidth
		const height = opts.height ?? host.clientHeight ?? innerHeight
		const pad = { l: 44, r: 14, t: 14, b: 28, ...(opts.padding || {}) }
		const items: any[] = []
		let scheduled = false
		const g: any = { items, width, height }
		const schedule = () => {
			if (!scheduled) {
				scheduled = true
				queueMicrotask(render)
			}
			return g
		}
		const add = (item: any) => (items.push(item), schedule())
		g.fn = (f: any, o: any = {}) => add({ kind: 'fn', f, o })
		g.line = (a: number[], b: number[], o: any = {}) => add({ kind: 'line', a, b, o })
		g.arrow = (a: number[], b: number[], o: any = {}) => add({ kind: 'line', a, b, o: { ...o, arrow: true } })
		g.point = (p: number[], o: any = {}) => add({ kind: 'point', p, o })
		g.text = (p: number[], text: string, o: any = {}) => add({ kind: 'text', p, text, o })
		g.polygon = (pts: number[][], o: any = {}) => add({ kind: 'poly', pts, o })
		g.rect = (p: number[], wd: number, ht: number, o: any = {}) =>
			add({ kind: 'poly', pts: [p, [p[0] + wd, p[1]], [p[0] + wd, p[1] + ht], [p[0], p[1] + ht]], o })
		g.custom = (draw: (svg: Element, g: any) => void) => add({ kind: 'custom', draw })

		function render() {
			scheduled = false
			const xr: number[] = opts.x || [-10, 10]
			let yr: number[] = opts.y && opts.y !== 'auto' ? opts.y : autoY(xr)
			if (yr[0] === yr[1]) yr = [yr[0] - 1, yr[1] + 1]
			const sx = (x: number) => pad.l + ((x - xr[0]) / (xr[1] - xr[0])) * (width - pad.l - pad.r)
			const sy = (y: number) => height - pad.b - ((y - yr[0]) / (yr[1] - yr[0])) * (height - pad.t - pad.b)
			g.px = (p: number[]) => [sx(p[0]), sy(p[1])]
			g.xRange = xr
			g.yRange = yr
			host.innerHTML = ''
			const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, style: 'display:block;overflow:visible' }, host)
			g.svg = svg
			const defs = svgEl('defs', {}, svg)
			const marker = svgEl('marker', { id: 'ah', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs)
			svgEl('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'context-stroke' }, marker)
			if (opts.axes !== false) drawAxes(svg, xr, yr, sx, sy)
			for (const it of items) {
				const o = it.o || {}
				const color = o.color || '#2563eb'
				if (it.kind === 'fn') {
					const pts = ms.sample(it.f, o.from ?? xr[0], o.to ?? xr[1], o.samples ?? 400)
					const good = pts.filter((p: number[]) => Number.isFinite(p[1]))
					if (!good.length) continue
					const d = good.map((p: number[], i: number) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(2)},${sy(p[1]).toFixed(2)}`).join('')
					if (o.fill) {
						const y0 = sy(Math.max(yr[0], Math.min(yr[1], 0)))
						svgEl('path', { d: `${d}L${sx(good[good.length - 1][0])},${y0}L${sx(good[0][0])},${y0}Z`, fill: o.fill === true ? color : o.fill, 'fill-opacity': o.fillOpacity ?? 0.18, stroke: 'none' }, svg)
					}
					svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': o.width ?? 2, 'stroke-dasharray': o.dash }, svg)
					if (o.label) {
						const last = good[good.length - 1]
						svgEl('text', { x: sx(last[0]) - 4, y: sy(last[1]) - 6, 'text-anchor': 'end', fill: color, 'font-size': 12 }, svg).textContent = o.label
					}
				} else if (it.kind === 'line') {
					svgEl('line', { x1: sx(it.a[0]), y1: sy(it.a[1]), x2: sx(it.b[0]), y2: sy(it.b[1]), stroke: o.color || '#111827', 'stroke-width': o.width ?? 1.5, 'stroke-dasharray': o.dash, 'marker-end': o.arrow ? 'url(#ah)' : undefined }, svg)
				} else if (it.kind === 'point') {
					svgEl('circle', { cx: sx(it.p[0]), cy: sy(it.p[1]), r: o.r ?? 3.5, fill: o.color || '#111827' }, svg)
					if (o.label) svgEl('text', { x: sx(it.p[0]) + 6, y: sy(it.p[1]) - 6, 'font-size': 12, fill: o.color || '#111827' }, svg).textContent = o.label
				} else if (it.kind === 'text') {
					svgEl('text', { x: sx(it.p[0]) + (o.dx || 0), y: sy(it.p[1]) + (o.dy || 0), 'text-anchor': o.anchor || 'middle', 'font-size': o.size ?? 12, fill: o.color || '#111827', 'font-weight': o.bold ? 600 : undefined }, svg).textContent = it.text
				} else if (it.kind === 'poly') {
					svgEl('polygon', { points: it.pts.map((p: number[]) => `${sx(p[0])},${sy(p[1])}`).join(' '), fill: o.fill || 'none', 'fill-opacity': o.fillOpacity, stroke: o.color || '#111827', 'stroke-width': o.width ?? 1.5 }, svg)
				} else if (it.kind === 'custom') {
					it.draw(svg, g)
				}
			}
		}

		function autoY(xr: number[]) {
			let lo = Infinity, hi = -Infinity
			const grow = (y: number) => {
				if (Number.isFinite(y)) {
					lo = Math.min(lo, y)
					hi = Math.max(hi, y)
				}
			}
			for (const it of items) {
				if (it.kind === 'fn') for (const p of ms.sample(it.f, it.o?.from ?? xr[0], it.o?.to ?? xr[1], 200)) grow(p[1])
				if (it.kind === 'point') grow(it.p[1])
				if (it.kind === 'line') (grow(it.a[1]), grow(it.b[1]))
				if (it.kind === 'poly') it.pts.forEach((p: number[]) => grow(p[1]))
			}
			if (lo === Infinity) return [-1, 1]
			if (opts.includeZero !== false) (lo = Math.min(lo, 0), hi = Math.max(hi, 0))
			const m = (hi - lo) * 0.12 || 1
			return [lo - m, hi + m]
		}

		function drawAxes(svg: Element, xr: number[], yr: number[], sx: any, sy: any) {
			const ticks = (r: number[], n: number) => {
				const span = r[1] - r[0]
				const step0 = Math.pow(10, Math.floor(Math.log10(span / n)))
				const step = [1, 2, 5, 10].map((k) => k * step0).find((s) => span / s <= n) || step0 * 10
				const out = []
				for (let v = Math.ceil(r[0] / step) * step; v <= r[1] + 1e-9; v += step) out.push(Number(v.toPrecision(10)))
				return out
			}
			const gridColor = '#e5e7eb'
			for (const t of ticks(xr, Math.max(2, width / 70))) {
				if (opts.grid !== false) svgEl('line', { x1: sx(t), x2: sx(t), y1: pad.t, y2: height - pad.b, stroke: gridColor }, svg)
				svgEl('text', { x: sx(t), y: height - pad.b + 14, 'text-anchor': 'middle', 'font-size': 10, fill: '#6b7280' }, svg).textContent = ms.fmt(t)
			}
			for (const t of ticks(yr, Math.max(2, height / 50))) {
				if (opts.grid !== false) svgEl('line', { x1: pad.l, x2: width - pad.r, y1: sy(t), y2: sy(t), stroke: gridColor }, svg)
				svgEl('text', { x: pad.l - 5, y: sy(t) + 3, 'text-anchor': 'end', 'font-size': 10, fill: '#6b7280' }, svg).textContent = ms.fmt(t)
			}
			const y0 = Math.max(yr[0], Math.min(yr[1], 0))
			const x0 = Math.max(xr[0], Math.min(xr[1], 0))
			svgEl('line', { x1: pad.l, x2: width - pad.r, y1: sy(y0), y2: sy(y0), stroke: '#374151' }, svg)
			svgEl('line', { x1: sx(x0), x2: sx(x0), y1: pad.t, y2: height - pad.b, stroke: '#374151' }, svg)
			if (opts.xLabel) svgEl('text', { x: width - pad.r, y: height - 4, 'text-anchor': 'end', 'font-size': 11, fill: '#374151' }, svg).textContent = opts.xLabel
			if (opts.yLabel) svgEl('text', { x: 4, y: pad.t - 2, 'font-size': 11, fill: '#374151' }, svg).textContent = opts.yLabel
		}
		return g
	}

	w.addEventListener('message', (e: MessageEvent) => {
		const d = e.data
		if (!d || d.source !== 'math-studio-host') return
		if (d.type === 'scope') {
			try {
				build(d.program)
			} catch (err) {
				report(err)
				return
			}
			fire()
		}
	})
	let resizeTimer: any
	w.addEventListener('resize', () => {
		clearTimeout(resizeTimer)
		resizeTimer = setTimeout(() => ms.program && fire(), 30)
	})
	post({ type: 'ready' })
}

const BASE_CSS = `
html,body{margin:0;height:100%;background:#fff;color:#111827;font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;overflow:hidden}
*{box-sizing:border-box}
button{font:inherit}
input[type=range]{accent-color:#7c3aed}
`

// Full HTML document for a widget iframe.
export function buildSrcdoc(code: string): string {
	return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${KATEX_CSS}">
<script src="${KATEX_JS}"></script>
<style>${BASE_CSS}</style>
<script>(${widgetRuntime.toString()})(${helpersSource});</script>
</head><body>
${code}
</body></html>`
}
