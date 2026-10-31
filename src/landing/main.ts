import katex from 'katex'
import 'katex/dist/katex.min.css'
import '@fontsource-variable/fraunces'
import '@fontsource/caveat/500.css'
import '@fontsource/caveat/700.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import { computeScope, formatNumber, makeCallable, type ScopeResult } from '../math/scope'
import './landing.css'

// The landing page's live calc pad: the app's own math engine on a few editable lines.

const START = ['L = 6', 'q = 10', 'V(x) = q*L/2 - q*x', 'M(x) = integrate(V, x)', 'Mmax = M(L/2)']

const linesEl = document.getElementById('lines') as HTMLOListElement
const plot = document.getElementById('plot') as unknown as SVGSVGElement
const dialL = document.getElementById('dial-L') as HTMLInputElement
const dialQ = document.getElementById('dial-q') as HTMLInputElement
const outL = document.getElementById('out-L') as HTMLOutputElement
const outQ = document.getElementById('out-q') as HTMLOutputElement

interface Line {
	input: HTMLInputElement
	tex: HTMLElement
	result: HTMLElement
}
const lines: Line[] = START.map((text, i) => {
	const li = document.createElement('li')
	const input = document.createElement('input')
	input.value = text
	input.spellcheck = false
	input.autocomplete = 'off'
	input.setAttribute('aria-label', `Line ${i + 1}`)
	const tex = document.createElement('div')
	tex.className = 'line-tex'
	const result = document.createElement('div')
	result.className = 'line-result'
	result.setAttribute('aria-live', 'polite')
	li.append(input, tex, result)
	linesEl.append(li)
	input.addEventListener('input', () => {
		syncDials()
		update()
	})
	return { input, tex, result }
})

const render = (el: HTMLElement, tex: string) => {
	try {
		katex.render(tex, el, { throwOnError: false, displayMode: false })
	} catch {
		el.textContent = tex
	}
}

// The two dials write the L and q lines, like changing a number on the pad.
const constantLine = (name: string) => lines.find((l) => new RegExp(`^\\s*${name}\\s*=`).test(l.input.value))
function syncDials() {
	for (const [name, dial, out, unit] of [['L', dialL, outL, 'm'], ['q', dialQ, outQ, 'kN/m']] as const) {
		const v = Number(constantLine(name)?.input.value.split('=')[1])
		if (Number.isFinite(v)) {
			dial.value = String(v)
			out.value = `${formatNumber(v)} ${unit}`
		}
	}
}
for (const [name, dial] of [['L', dialL], ['q', dialQ]] as const) {
	dial.addEventListener('input', () => {
		const line = constantLine(name)
		if (line) line.input.value = `${name} = ${dial.value}`
		syncDials()
		update()
	})
}

let first = true
function update() {
	const scope = computeScope(lines.map((l, i) => ({ id: String(i), text: l.input.value })))
	lines.forEach((l, i) => {
		const r = scope.results[String(i)]
		if (!r || r.kind === 'empty') {
			l.tex.textContent = ''
			l.result.textContent = ''
			return
		}
		render(l.tex, r.tex ?? '')
		l.result.className = 'line-result'
		if (r.kind === 'error') {
			l.result.classList.add('is-error')
			l.result.textContent = r.error ?? 'Cannot read this line'
		} else if (r.kind === 'constant' && r.value !== undefined) {
			// A typed number needs no answer; anything computed gets one.
			const typed = /^\s*-?[\d.]+\s*$/.test(r.text.split('=')[1] ?? '')
			if (typed) l.result.textContent = ''
			else render(l.result, `= ${formatNumber(r.value)}${r.name === 'Mmax' ? '\\ \\text{kN·m}' : ''}`)
		} else if (r.resolvedTex && r.resolvedTex !== r.tex) {
			render(l.result, `= ${r.resolvedTex.replace(/^.*?=\s*/, '')}`)
		} else {
			l.result.textContent = ''
		}
	})
	drawPlot(scope)
	const L = scope.program.constants.L
	const q = scope.program.constants.q
	document.getElementById('sketch-l')!.textContent = Number.isFinite(L) ? `L = ${formatNumber(L)} m` : 'L'
	document.getElementById('sketch-q')!.textContent = Number.isFinite(q) ? `q = ${formatNumber(q)} kN/m` : 'q'
	first = false
}

const NS = 'http://www.w3.org/2000/svg'
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string) {
	const e = document.createElementNS(NS, tag)
	for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
	if (text) e.textContent = text
	return e
}

function drawPlot(scope: ScopeResult) {
	plot.replaceChildren()
	const { functions, constants } = scope.program
	const L = constants.L
	if (!Number.isFinite(L) || L <= 0) return plotMessage('Give L a positive value to draw the beam')
	const sample = (name: string) => {
		const f = functions[name]
		if (!f || f.params.length !== 1) return null
		try {
			const call = makeCallable(f, constants)
			const pts = Array.from({ length: 81 }, (_, i) => {
				const x = (L * i) / 80
				return [x, call(x)] as const
			})
			return pts.every(([, y]) => Number.isFinite(y)) ? pts : null
		} catch {
			return null
		}
	}
	const M = sample('M')
	const V = sample('V')
	if (!M && !V) return plotMessage('Define V(x) or M(x) to see the diagram')

	const W = 600, H = 260, padX = 44, padY = 30
	const ys = [...(M ?? []), ...(V ?? [])].map(([, y]) => y)
	const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys)
	const span = hi - lo || 1
	const sx = (x: number) => padX + ((W - 2 * padX) * x) / L
	const sy = (y: number) => H - padY - ((H - 2 * padY) * (y - lo)) / span
	plot.append(el('line', { x1: padX, x2: W - padX, y1: sy(0), y2: sy(0), class: 'axis' }))
	plot.append(el('text', { x: W - padX, y: sy(0) - 8, class: 'axis-label', 'text-anchor': 'end' }, 'x'))

	const path = (pts: readonly (readonly [number, number])[]) =>
		pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(' ')
	if (V) plot.append(el('path', { d: path(V), class: 'curve curve-v' }))
	if (M) {
		const curve = el('path', { d: path(M), class: 'curve curve-m' })
		plot.append(curve)
		// The one authored moment: the moment diagram is inked in on first view.
		if (first && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
			const len = curve.getTotalLength()
			curve.style.strokeDasharray = `${len}`
			curve.style.strokeDashoffset = `${len}`
			requestAnimationFrame(() => curve.classList.add('inking'))
		}
		const peak = M.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a))
		plot.append(el('circle', { cx: sx(peak[0]), cy: sy(peak[1]), r: 4, class: 'peak' }))
		plot.append(
			el('text', { x: sx(peak[0]), y: sy(peak[1]) + (peak[1] >= 0 ? -12 : 24), class: 'peak-label', 'text-anchor': 'middle' }, `${formatNumber(peak[1])} kN·m`)
		)
	}
}

function plotMessage(text: string) {
	plot.append(el('text', { x: 300, y: 135, class: 'plot-msg', 'text-anchor': 'middle' }, text))
}

// Download tiles: only offer files the server actually has.
for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-download]')) {
	fetch(a.href, { method: 'HEAD' })
		.then((r) => {
			if (!r.ok) throw new Error()
		})
		.catch(() => {
			a.classList.add('is-unavailable')
			a.removeAttribute('href')
			a.setAttribute('aria-disabled', 'true')
			a.querySelector('.get-meta')!.textContent = 'Not published on this server yet'
		})
}

syncDials()
update()
