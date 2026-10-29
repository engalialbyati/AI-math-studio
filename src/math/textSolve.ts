import { computeScope, formatNumber } from './scope'
import { math, parseEquation, parsedToTex } from './parse'

// SMath-style worksheets in plain text boxes:
//   y=mx+b
//   m=1
//   x=2
//   y=3
//   b=??      <- answered: "b = 1"
// Lines "name = number" are known values, other lines with "=" are equations, and
// "name=??" asks for that name. Everything is local to the text box.

export interface LineAnswer {
	line: number
	text: string // "1" or "-3, 3", or an error message
	error?: boolean
}

const QUERY = /^\s*([A-Za-z]\w*)\s*=?\s*\?\?\s*$/ // "b=??" or "b??" asks for b
const ASSIGN = /^\s*([A-Za-z]\w*)\s*=\s*(.+)$/
const NEWLINE = /\r?\n/

const isFunctionName = (name: string) => typeof (math as any)[name] === 'function' || name === 'integrate' || name === 'diff'

// "mx+b" -> "m*x+b": split multi-letter names that are not functions or names used on their own.
function implicit(expr: string, names: Set<string>): string {
	return expr.replace(/\b[A-Za-z][A-Za-z0-9]*\b/g, (word, offset: number, whole: string) => {
		if (word.length === 1 || names.has(word) || /^[A-Za-z]\d+$/.test(word)) return word
		if (isFunctionName(word) && whole[offset + word.length] === '(') return word
		if (['pi', 'e', 'Infinity'].includes(word)) return word
		return word.split('').join('*')
	})
}

export function blockNames(text: string): Set<string> {
	const names = new Set<string>()
	for (const raw of text.split(NEWLINE)) {
		const m = raw.match(QUERY) ?? raw.match(ASSIGN)
		if (m) names.add(m[1])
	}
	return names
}

// LaTeX for one line, or null when it is not math (plain words).
export function lineTex(raw: string, names: Set<string>): string | null {
	if (!raw.trim()) return null
	const q = raw.match(QUERY)
	if (q) return `${texName(q[1])} =`
	// Words that are not names or functions mean plain text ("note: check units").
	const words = raw.match(/[A-Za-z]{3,}/g) ?? []
	if (words.some((w) => !names.has(w) && !isFunctionName(w) && w !== 'pi')) return null
	try {
		const src = raw.includes('=') ? raw.split('=').map((s) => implicit(s, names)).join('=') : implicit(raw, names)
		return parsedToTex(parseEquation(src))
	} catch {
		return null
	}
}

const texName = (n: string) => (n.length > 1 && !/^[A-Za-z]\d+$/.test(n) ? `\\mathit{${n}}` : n.replace(/^([A-Za-z])(\d+)$/, '$1_{$2}'))

// `context` is the text of the other boxes on the page: its equations and values are used
// too, but values written in this box win.
export function solveTextBlock(text: string, context = ''): LineAnswer[] {
	const lines = text.split(NEWLINE)
	const ctx = context ? context.split(NEWLINE) : []
	const queries: { line: number; name: string }[] = []
	const assigns: { name: string; rhs: string; own: boolean }[] = []
	const relations: string[] = []
	const read = (raw: string, own: boolean, i: number) => {
		const q = raw.match(QUERY)
		if (q) {
			if (own) queries.push({ line: i, name: q[1] })
			return
		}
		const a = raw.match(ASSIGN)
		if (a) assigns.push({ name: a[1], rhs: a[2].trim(), own })
		else if (raw.includes('=')) relations.push(raw)
	}
	lines.forEach((raw, i) => read(raw, true, i))
	if (!queries.length) return []
	ctx.forEach((raw, i) => read(raw, false, i))

	// Names written alone on the left of "=" are kept whole (Mmax), others split into letters.
	const names = new Set([...assigns.map((a) => a.name), ...queries.map((q) => q.name)])
	const known = new Map<string, string>()
	const equations: string[] = []
	for (const a of [...assigns.filter((a) => a.own), ...assigns.filter((a) => !a.own)]) {
		const rhs = implicit(a.rhs, names)
		let numeric = false
		try {
			numeric = typeof math.evaluate(rhs) === 'number'
		} catch {}
		if (numeric) {
			if (!known.has(a.name)) known.set(a.name, rhs)
		} else equations.push(`${a.name} = ${rhs}`)
	}
	// Relations without a single name on the left (x^2 + y^2 = 25).
	for (const raw of relations) {
		const [l, r] = raw.split('=')
		if (l.trim() && r?.trim()) equations.push(`${implicit(l, names)} = ${implicit(r, names)}`)
	}
	const knowns = [...known].map(([n, v]) => `${n}=${v}`)

	return queries.map((q) => {
		const query = [...knowns.filter((k) => !k.startsWith(q.name + '=')), `${q.name}?`].join(', ')
		// Each equation gets its own id; a name defined twice is reported by the scope as an error.
		const list = [...equations, query].map((t, i) => ({ id: `t${i}`, text: t }))
		const r = computeScope(list).results[`t${equations.length}`]
		if (r.kind === 'solve') return { line: q.line, text: r.solution!.replace(/^\w+\s*=\s*/, '') }
		// A known value asked again: just echo it.
		const own = knowns.find((k) => k.startsWith(q.name + '='))
		if (own && r.kind === 'error') {
			try {
				return { line: q.line, text: formatNumber(math.evaluate(own.slice(q.name.length + 1))) }
			} catch {}
		}
		return { line: q.line, text: r.error ?? 'Cannot solve', error: true }
	})
}
