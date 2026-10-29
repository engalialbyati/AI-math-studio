// Convert LaTeX (from the handwriting recognizer or the visual math editor) into Math Studio
// equation text, e.g. `y = \frac { 1 + x } { 2 }` -> `y = (1 + x) / 2`.

type Kind = 'num' | 'id' | 'fn' | 'open' | 'close' | 'op'
interface Piece {
	text: string
	kind: Kind
}

const FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan', 'ln', 'log', 'exp', 'max', 'min', 'det'])
const FUNC_MAP: Record<string, string> = { arcsin: 'asin', arccos: 'acos', arctan: 'atan', ln: 'log' }
const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega'])
const OPS: Record<string, string> = {
	cdot: '*', times: '*', ast: '*', div: '/', pm: '+', mp: '-', le: '<=', leq: '<=', ge: '>=', geq: '>=', neq: '!=', ne: '!=',
	langle: '<', rangle: '>', lt: '<', gt: '>', infty: 'Infinity',
}
const SKIP = new Set(['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'displaystyle', 'textstyle', ',', ';', ':', '!', 'quad', 'qquad', ' ', 'limits'])
// Function names that take ( ... ) even when not defined on the canvas.
const BUILTIN_FNS = ['dot', 'cross', 'trace', 'inv', 'transpose', 'det', 'taylor', 'limit', 'sum', 'prod', 'integrate', 'diff', 'dsolve', 'nthRoot', 'sqrt', 'abs', 'identity', 'norm']
const WRAP = new Set(['mathrm', 'text', 'mathbf', 'mathit', 'operatorname', 'boldsymbol', 'mathsf', 'textrm', 'rm', 'bf', 'it'])

function tokenize(src: string): string[] {
	const out: string[] = []
	let i = 0
	while (i < src.length) {
		const c = src[i]
		if (/\s/.test(c)) { i++; continue }
		if (c === '\\') {
			const m = src.slice(i + 1).match(/^([A-Za-z]+|.)/)
			const name = m ? m[1] : ''
			out.push('\\' + name)
			i += 1 + name.length
			continue
		}
		if (c === '~') { i++; continue }
		out.push(c)
		i++
	}
	return out
}

class Converter {
	private i = 0
	constructor(private toks: string[], private knownFns: Set<string>) {}

	private peek() { return this.toks[this.i] }
	private next() { return this.toks[this.i++] }

	// Parse a `{...}` group or a single token as a piece list.
	private group(): Piece[] {
		while (this.peek() && SKIP.has(this.peek().slice(1)) && this.peek().startsWith('\\')) this.i++
		if (this.peek() === '{') {
			this.i++
			const p = this.seq('}')
			this.i++
			return p
		}
		const p: Piece[] = []
		this.atom(p)
		return p
	}

	private groupText(): string { return join(this.group()) }

	// Contents of a balanced `( ... )`, without the outer parentheses.
	private paren(): Piece[] {
		this.i++
		const out: Piece[] = []
		let depth = 0
		while (this.i < this.toks.length) {
			const t = this.peek()
			if (t === '(') depth++
			if (t === ')' && depth-- === 0) { this.i++; break }
			this.atom(out)
		}
		return out
	}

	seq(end?: string): Piece[] {
		const out: Piece[] = []
		while (this.i < this.toks.length && this.peek() !== end) this.atom(out)
		return out
	}

	private atom(out: Piece[]) {
		const t = this.next()
		if (t === undefined) return
		if (t === '{') {
			const inner = this.seq('}')
			this.i++
			out.push(...inner)
			return
		}
		if (t === '}') return
		if (/^\d$/.test(t) || t === '.') {
			const last = out[out.length - 1]
			if (last?.kind === 'num') last.text += t
			else out.push({ text: t, kind: 'num' })
			return
		}
		if (/^[A-Za-z]$/.test(t)) {
			out.push({ text: t, kind: 'id' })
			return
		}
		if (t === '(' || t === '[') return void out.push({ text: '(', kind: 'open' })
		if (t === ')' || t === ']') return void out.push({ text: ')', kind: 'close' })
		if (t === '^') {
			const g = this.group()
			const s = join(g)
			// A^{T} is a transpose.
			if (s === 'T' && out[out.length - 1]?.kind === 'id') {
				const last = out.pop()!
				out.push({ text: `transpose(${last.text})`, kind: 'id' })
				return
			}
			out.push({ text: g.length === 1 ? `^${s}` : `^(${s})`, kind: 'op' })
			return
		}
		if (t === '_') {
			// Subscripts become part of the name: x_1 -> x1, M_{max} -> Mmax.
			const s = join(this.group()).replace(/[^A-Za-z0-9]/g, '')
			const last = out[out.length - 1]
			if (last && (last.kind === 'id' || last.kind === 'fn')) last.text += s
			return
		}
		if (t === "'") {
			const last = out[out.length - 1]
			if (last?.kind === 'id') last.text += 'p'
			return
		}
		if ('+-*/=<>,|!?'.includes(t)) return void out.push({ text: t, kind: 'op' })
		if (!t.startsWith('\\')) return
		const name = t.slice(1)
		// \left| x \right| -> abs(x)
		if (name === 'left' && this.peek() === '|') {
			this.i++
			const inner: Piece[] = []
			while (this.i < this.toks.length && !(this.peek() === '\\right' && this.toks[this.i + 1] === '|')) this.atom(inner)
			this.i += 2
			out.push({ text: `abs(${join(inner)})`, kind: 'id' })
			return
		}
		if (SKIP.has(name)) return
		if (name === 'begin') return void this.matrix(out)
		if (name === 'sum' || name === 'prod') return void this.series(name, out)
		if (name === 'lim') return void this.limit(out)
		if (name === '{') return void out.push({ text: '(', kind: 'open' })
		if (name === '}') return void out.push({ text: ')', kind: 'close' })
		if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
			const num = this.rawGroup()
			const den = this.rawGroup()
			// d/dx (...), d^2/dx^2 (...), \partial/\partial y (...)
			const dn = num.join('').match(/^(?:\\mathrm\{d\}|d|\\partial)(?:\^\{?(\d+)\}?)?$/)
			const dd = den.join('').match(/^(?:\\mathrm\{d\}|d|\\partial)([A-Za-z])(?:\^\{?(\d+)\}?)?$/)
			if (dn && dd) {
				const body = this.peek() === '\\left' || this.peek() === '(' ? this.bracketed() : this.term()
				const order = dn[1] ?? dd[2]
				out.push({ text: `diff(${join(body)}, ${dd[1]}${order && order !== '1' ? `, ${order}` : ''})`, kind: 'id' })
				return
			}
			out.push({ text: `(${this.sub(num)}) / (${this.sub(den)})`, kind: 'id' })
			return
		}
		if (name === 'sqrt') {
			let n = ''
			if (this.peek() === '[') {
				this.i++
				n = join(this.seq(']'))
				this.i++
			}
			const a = this.groupText()
			out.push({ text: n ? `nthRoot(${a}, ${n})` : `sqrt(${a})`, kind: 'id' })
			return
		}
		if (name === 'int') return void this.integral(out)
		if (WRAP.has(name)) {
			const g = this.group()
			// \mathrm{max} -> one name; \mathrm{d} stays a letter.
			if (g.every((p) => p.kind === 'id' && /^[A-Za-z]$/.test(p.text)) && g.length > 1) {
				out.push({ text: g.map((p) => p.text).join(''), kind: 'id' })
			} else out.push(...g)
			return
		}
		if (FUNCS.has(name)) {
			const fn = FUNC_MAP[name] ?? name
			if (this.peek() === '(' || this.peek() === '\\left') out.push({ text: fn, kind: 'fn' })
			else {
				let arg = this.group()
				if (arg.length === 1 && arg[0].text.startsWith('^')) {
					// sin^2 x -> sin(x)^2
					const pow = arg[0].text
					arg = this.peek() === '(' ? this.paren() : this.group()
					out.push({ text: `${fn}(${join(arg)})${pow}`, kind: 'id' })
				} else out.push({ text: `${fn}(${join(arg)})`, kind: 'id' })
			}
			return
		}
		if (GREEK.has(name)) return void out.push({ text: name.replace(/^var/, ''), kind: 'id' })
		if (OPS[name]) {
			const v = OPS[name]
			out.push({ text: v, kind: v === 'Infinity' ? 'id' : 'op' })
			return
		}
	}

	// Raw tokens of the next {...} group (or single token), without converting them.
	private rawGroup(): string[] {
		if (this.peek() !== '{') return [this.next()]
		let depth = 0
		const start = this.i
		for (; this.i < this.toks.length; this.i++) {
			if (this.toks[this.i] === '{') depth++
			if (this.toks[this.i] === '}' && --depth === 0) break
		}
		return this.toks.slice(start + 1, this.i++)
	}

	private sub(toks: string[]): string {
		return join(new Converter(toks, this.knownFns).seq())
	}

	// ( ... ) or \left( ... \right) contents.
	private bracketed(): Piece[] {
		if (this.peek() === '\\left') this.i++
		this.i++
		const out: Piece[] = []
		let depth = 0
		while (this.i < this.toks.length) {
			const t = this.peek()
			if (t === '\\right') { this.i += 2; break }
			if (t === '(') depth++
			if (t === ')' && depth-- === 0) { this.i++; break }
			this.atom(out)
		}
		return out
	}

	// One term: atoms up to the next top-level + - = , or closing bracket.
	private term(): Piece[] {
		const out: Piece[] = []
		let depth = 0
		while (this.i < this.toks.length) {
			const t = this.peek()
			if (depth === 0 && ['+', '-', '=', ',', '}', ')', '\\right', '&', '\\\\'].includes(t)) break
			const before = out.length
			this.atom(out)
			for (const p of out.slice(before)) depth += p.kind === 'open' ? 1 : p.kind === 'close' ? -1 : 0
		}
		return out
	}

	// \sum_{k=1}^{n} f -> sum(f, k, 1, n)
	private series(name: string, out: Piece[]) {
		let k = 'k'
		let lo = '1'
		let hi = 'Infinity'
		for (let n = 0; n < 2; n++) {
			if (this.peek() === '_') {
				this.i++
				const [v, a] = this.sub(this.rawGroup()).split('=')
				k = v.trim() || k
				lo = (a ?? lo).trim()
			} else if (this.peek() === '^') {
				this.i++
				hi = this.sub(this.rawGroup()) || hi
			}
		}
		const body = this.peek() === '\\left' || this.peek() === '(' ? this.bracketed() : this.term()
		out.push({ text: `${name}(${join(body)}, ${k}, ${lo}, ${hi})`, kind: 'id' })
	}

	// \lim_{x \to a} f -> limit(f, x, a)
	private limit(out: Piece[]) {
		let v = 'x'
		let a = '0'
		if (this.peek() === '_') {
			this.i++
			const toks = this.rawGroup()
			const at = toks.findIndex((t) => t === '\\to' || t === '\\rightarrow')
			if (at >= 0) {
				v = this.sub(toks.slice(0, at)) || v
				a = this.sub(toks.slice(at + 1)) || a
			}
		}
		const body = this.peek() === '\\left' || this.peek() === '(' ? this.bracketed() : this.term()
		out.push({ text: `limit(${join(body)}, ${v}, ${a})`, kind: 'id' })
	}

	// \begin{bmatrix} a & b \\ c & d \end{bmatrix} -> [a, b; c, d]  (vmatrix -> det([...]))
	private matrix(out: Piece[]) {
		const env = this.rawGroup().join('')
		const rows: string[][] = [[]]
		let cell: Piece[] = []
		while (this.i < this.toks.length) {
			const t = this.peek()
			if (t === '\\end') { this.i++; this.rawGroup(); break }
			if (t === '&' || t === '\\\\') {
				this.i++
				rows[rows.length - 1].push(join(cell))
				cell = []
				if (t === '\\\\') rows.push([])
				continue
			}
			this.atom(cell)
		}
		rows[rows.length - 1].push(join(cell))
		const m = `[${rows.filter((r) => r.some((c) => c)).map((r) => r.join(', ')).join('; ')}]`
		out.push({ text: env === 'vmatrix' ? `det(${m})` : m, kind: 'id' })
	}

	// \int_a^b f(x) dx -> integrate(f(x), x, a, b)
	private integral(out: Piece[]) {
		let lo = ''
		let hi = ''
		for (let k = 0; k < 2; k++) {
			if (this.peek() === '_') { this.i++; lo = this.groupText() }
			else if (this.peek() === '^') { this.i++; hi = this.groupText() }
		}
		const body: Piece[] = []
		let v = 'x'
		while (this.i < this.toks.length && this.peek() !== '}') {
			const t = this.peek()
			const t2 = this.toks[this.i + 1]
			if (t === 'd' && t2 && /^[A-Za-z]$/.test(t2)) { v = t2; this.i += 2; break }
			if (t === '\\mathrm' || t === '\\text' || t === '\\operatorname') {
				// \mathrm{d}x
				const save = this.i
				this.i++
				if (this.groupText() === 'd' && /^[A-Za-z]$/.test(this.peek() ?? '')) { v = this.next(); break }
				this.i = save
			}
			if (t === '=' ) break
			this.atom(body)
		}
		const f = join(body) || '1'
		out.push({ text: lo || hi ? `integrate(${f}, ${v}, ${lo || 0}, ${hi})` : `integrate(${f}, ${v})`, kind: 'id' })
	}

	finish(pieces: Piece[]) {
		// Name followed by "(" is a call only for known functions or on the left of "=".
		const eq = pieces.findIndex((p) => p.text === '=')
		pieces.forEach((p, k) => {
			if (p.kind !== 'id' || pieces[k + 1]?.kind !== 'open') return
			if (!/^[A-Za-z]\w*$/.test(p.text)) return
			if ((eq >= 0 && k < eq) || this.knownFns.has(p.text)) p.kind = 'fn'
		})
		return join(pieces)
	}
}

function join(pieces: Piece[]): string {
	let s = ''
	let prev: Piece | undefined
	for (const p of pieces) {
		const value = prev && (prev.kind === 'num' || prev.kind === 'id' || prev.kind === 'close' || (prev.kind === 'op' && prev.text.startsWith('^')))
		if (prev && value && (p.kind === 'num' || p.kind === 'id' || p.kind === 'open' || p.kind === 'fn')) s += ' * '
		else if (p.kind === 'op' && p.text.startsWith('^')) s += ''
		else if (prev && (p.kind === 'op' || prev.kind === 'op') && p.text !== ',') s += ' '
		else if (prev?.text === ',') s += ' '
		s += p.text
		prev = p
	}
	return s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/^\s*-\s+/, '-')
}

export function latexToText(latex: string, knownFns: Iterable<string> = []): string {
	// MathLive spellings and empty template slots.
	const src = latex
		.replace(/\\placeholder(\[[^\]]*\])?\{[^}]*\}/g, '')
		.replace(/\\differentialD/g, 'd')
		.replace(/\\exponentialE/g, 'e')
		.replace(/\\imaginaryI/g, 'i')
	const c = new Converter(tokenize(src), new Set([...BUILTIN_FNS, ...knownFns]))
	return c.finish(c.seq()).replace(/\s+/g, ' ').replace(/\?\s+\?/g, '??').trim()
}
