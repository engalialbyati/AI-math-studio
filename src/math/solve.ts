import nerdamer from 'nerdamer'
import type { MathNode } from 'mathjs'
import { math } from './parse'

// Solve queries, SMath style: `m=1, x=2, y=3, b?` finds an equation on the page that
// links these symbols and solves it for b. The knowns are local to the query.
export interface SolveQuery {
	unknown: string
	knowns: { name: string; text: string }[]
}

function splitTop(text: string): string[] {
	const out: string[] = []
	let depth = 0
	let cur = ''
	for (const ch of text) {
		if ('([{'.includes(ch)) depth++
		if (')]}'.includes(ch)) depth--
		if ((ch === ',' || ch === ';') && depth === 0) {
			out.push(cur)
			cur = ''
		} else cur += ch
	}
	out.push(cur)
	return out.map((s) => s.trim()).filter(Boolean)
}

export function parseSolveQuery(text: string): SolveQuery | null {
	if (!text.includes('?')) return null
	let unknown = ''
	const knowns: SolveQuery['knowns'] = []
	for (const part of splitTop(text)) {
		const u = part.match(/^([A-Za-z]\w*)\s*=?\s*\?{1,2}$/)
		if (u) {
			if (unknown) throw new Error('Ask for one unknown at a time')
			unknown = u[1]
			continue
		}
		const k = part.match(/^([A-Za-z]\w*)\s*=\s*(.+)$/)
		if (!k) throw new Error(`Write values as name = value (got "${part}")`)
		knowns.push({ name: k[1], text: k[2] })
	}
	if (!unknown) throw new Error('Mark the unknown with ?, e.g. b?')
	return { unknown, knowns }
}

export function queryTex(q: SolveQuery): string {
	const parts = q.knowns.map((k) => {
		let rhs = k.text
		try {
			rhs = math.parse(k.text).toTex()
		} catch {}
		return `${k.name} = ${rhs}`
	})
	return [...parts, `${q.unknown} = \\,?`].join(',\\; ')
}

// Real roots of expr = 0 in v: exact (nerdamer) first, numeric scan as fallback.
export function solveFor(expr: MathNode, v: string): number[] {
	const src = expr.toString({ implicit: 'show' })
	let roots: number[] = []
	try {
		const sol = (nerdamer as any).solve(src, v).toString() as string
		roots = sol
			.replace(/^\[|\]$|^\{|\}$/g, '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.map((s) => {
				try {
					const val = math.evaluate(s)
					return typeof val === 'number' ? val : NaN
				} catch {
					return NaN
				}
			})
			.filter((x) => Number.isFinite(x))
	} catch {}
	const f = math.compile(src)
	const g = (x: number) => {
		try {
			const r = f.evaluate({ [v]: x })
			return typeof r === 'number' ? r : NaN
		} catch {
			return NaN
		}
	}
	roots = roots.filter((r) => Math.abs(g(r)) < 1e-6 * Math.max(1, Math.abs(r)))
	if (!roots.length) roots = scan(g)
	roots.sort((a, b) => a - b)
	return roots.filter((r, i) => i === 0 || Math.abs(r - roots[i - 1]) > 1e-9 * Math.max(1, Math.abs(r)))
}

function scan(g: (x: number) => number): number[] {
	const xs: number[] = [0]
	for (let e = -3; e <= 6; e += 0.02) xs.push(10 ** e, -(10 ** e))
	xs.sort((a, b) => a - b)
	const out: number[] = []
	for (let i = 1; i < xs.length; i++) {
		let a = xs[i - 1]
		let b = xs[i]
		let fa = g(a)
		const fb = g(b)
		if (fa === 0) { out.push(a); continue }
		if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) continue
		for (let k = 0; k < 80; k++) {
			const m = (a + b) / 2
			const fm = g(m)
			if (fa * fm <= 0) b = m
			else { a = m; fa = fm }
		}
		const r = (a + b) / 2
		if (Math.abs(g(r)) < 1e-6 * Math.max(1, Math.abs(r))) out.push(r)
		if (out.length >= 10) break
	}
	return out
}
