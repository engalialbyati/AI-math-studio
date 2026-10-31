import { all, create, type MathNode } from 'mathjs'

export const math = create(all, {})

export type Parsed =
	| { kind: 'assign'; name: string; params: string[]; body: MathNode; input: MathNode }
	| { kind: 'expression'; body: MathNode }
	| { kind: 'relation'; lhs: MathNode; rhs: MathNode }

// Rewrite Macaulay brackets `<x-a>^n` (or `<x-a>`) into `mac(x-a, n)`, inserting `*`
// when a coefficient is written right before the bracket (`P<x-a>^-1`).
// Math symbols people type or paste, mapped to math.js names.
const SYMBOLS: [RegExp, string][] = [
	[/π/g, 'pi'], [/∞/g, 'Infinity'], [/[×·⋅]/g, '*'], [/÷/g, '/'], [/[−–]/g, '-'], [/≤/g, '<='], [/≥/g, '>='], [/≠/g, '!='],
	[/²/g, '^2'], [/³/g, '^3'], [/√\s*\(/g, 'sqrt('], [/√\s*([\w.]+)/g, 'sqrt($1)'], [/∛\s*\(/g, 'cbrt('],
	[/θ/g, 'theta'], [/α/g, 'alpha'], [/β/g, 'beta'], [/γ/g, 'gamma'], [/δ/g, 'delta'], [/λ/g, 'lambda'], [/μ/g, 'mu'],
	[/σ/g, 'sigma'], [/φ/g, 'phi'], [/ω/g, 'omega'], [/ε/g, 'epsilon'], [/τ/g, 'tau'], [/ρ/g, 'rho'], [/Δ/g, 'Delta'],
]

// Inside dsolve(...): y'' -> y__d2 (math.js reads ' as a string quote) and "=" -> "==".
function prepDsolve(text: string): string {
	let out = ''
	let i = 0
	for (let at = text.indexOf('dsolve('); at >= 0; at = text.indexOf('dsolve(', i)) {
		let depth = 0
		let end = at + 6
		for (; end < text.length; end++) {
			if (text[end] === '(') depth++
			if (text[end] === ')' && --depth === 0) break
		}
		const inner = text
			.slice(at + 7, end)
			.replace(/([A-Za-z]\w*)('+)/g, (_m, name: string, primes: string) => `${name}__d${primes.length}`)
			.replace(/(^|[^=<>!])=(?!=)/g, '$1==')
		out += text.slice(i, at) + 'dsolve(' + inner
		i = end
	}
	return out + text.slice(i)
}

export function preprocess(text: string): string {
	for (const [re, to] of SYMBOLS) text = text.replace(re, to)
	if (text.includes('dsolve(')) text = prepDsolve(text)
	return text.replace(
		/<([^<>=]+)>(\s*\^\s*(\(\s*-?\d+\s*\)|-?\d+))?/g,
		(_m, inner: string, _e, exp: string | undefined, offset: number, whole: string) => {
			const n = exp ? exp.replace(/[()\s]/g, '') : '1'
			const before = whole.slice(0, offset).trimEnd()
			const mul = /[\w)\]]$/.test(before) ? ' * ' : ''
			return `${mul}mac(${inner.trim()}, ${n})`
		}
	)
}

export function parseEquation(text: string): Parsed {
	const src = preprocess(text.trim())
	if (!src) throw new Error('Empty equation')
	let node: MathNode
	try {
		node = math.parse(src)
	} catch (err) {
		// `x^2 + y^2 = 4` is not a valid math.js assignment: treat it as a relation.
		const parts = src.split(/==|=/)
		if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
			return { kind: 'relation', lhs: math.parse(parts[0]), rhs: math.parse(parts[1]) }
		}
		throw err
	}
	if (node.type === 'AssignmentNode') {
		const n = node as any
		if (n.object?.type !== 'SymbolNode' || n.index) {
			return { kind: 'relation', lhs: n.object, rhs: n.value }
		}
		return { kind: 'assign', name: n.object.name, params: [], body: n.value, input: node }
	}
	if (node.type === 'FunctionAssignmentNode') {
		const n = node as any
		return { kind: 'assign', name: n.name, params: [...n.params], body: n.expr, input: node }
	}
	return { kind: 'expression', body: node }
}

const texFunctions: Record<string, (args: string[]) => string> = {
	mac: (a) => `\\left\\langle ${a[0]} \\right\\rangle^{${a[1] ?? 1}}`,
	integrate: (a) =>
		a.length >= 4
			? `\\int_{${a[2]}}^{${a[3]}} ${a[0]}\\,d${a[1]}`
			: `\\int ${a[0]}\\,d${a[1] ?? 'x'}`,
	nint: (a) => `\\int_{${a[2]}}^{${a[3]}} ${a[0]}\\,d${a[1]}`,
	diff: (a) => `\\frac{d}{d${a[1] ?? 'x'}}\\left(${a[0]}\\right)`,
	step: (a) => `H\\left(${a[0]}\\right)`,
	heaviside: (a) => `H\\left(${a[0]}\\right)`,
}
texFunctions.int = texFunctions.integrate
texFunctions.derivative = texFunctions.diff
texFunctions.diff = (a) =>
	a[2] && a[2] !== '1'
		? `\\frac{d^{${a[2]}}}{d${a[1] ?? 'x'}^{${a[2]}}}\\left(${a[0]}\\right)`
		: `\\frac{d}{d${a[1] ?? 'x'}}\\left(${a[0]}\\right)`
texFunctions.limit = (a) => `\\lim_{${a[1] ?? 'x'} \\to ${a[2] ?? 0}} ${a[0]}`
texFunctions.lim = texFunctions.limit
texFunctions.nlim = texFunctions.limit
texFunctions.sum = (a) => `\\sum_{${a[1]}=${a[2]}}^{${a[3]}} ${a[0]}`
texFunctions.nsum = texFunctions.sum
texFunctions.prod = (a) => `\\prod_{${a[1]}=${a[2]}}^{${a[3]}} ${a[0]}`
texFunctions.product = texFunctions.prod
texFunctions.nprod = texFunctions.prod
texFunctions.taylor = (a) => `T_{${a[3] ?? 4}}\\left[${a[0]}\\right]_{${a[1] ?? 'x'}=${a[2] ?? 0}}`
texFunctions.dsolve = (a) => `\\operatorname{solve}\\left\\{${a.join(',\\; ')}\\right.`
texFunctions.det = (a) => `\\det\\left(${a[0]}\\right)`
texFunctions.inv = (a) => `{${a[0]}}^{-1}`
texFunctions.transpose = (a) => `{${a[0]}}^{T}`
texFunctions.nthRoot = (a) => `\\sqrt[${a[1] ?? 2}]{${a[0]}}`

// A number times a letter, function or bracket reads as one term (5x, 2sin(x), 3(x+1)).
function startsWithNumber(node: any): boolean {
	if (node.type === 'ConstantNode') return true
	if (node.type === 'OperatorNode' && node.args.length === 2 && ['*', '^'].includes(node.op)) return startsWithNumber(node.args[0])
	if (node.type === 'OperatorNode' && node.fn === 'unaryMinus') return true
	return false
}

function factorTex(node: any, options: any) {
	const tex = node.toTex(options)
	const loose = node.type === 'OperatorNode' && node.args.length === 2 && (node.op === '+' || node.op === '-')
	return loose ? `\\left(${tex}\\right)` : tex
}

// Products print as 5x when a number leads, otherwise with * (never as a dot).
function multiplyTex(node: any, options: any) {
	const [l, r] = node.args
	const lt = factorTex(l, options)
	const rt = factorTex(r, options)
	if (node.implicit || (l.type === 'ConstantNode' && !startsWithNumber(r))) return `${lt}${rt}`
	return `${lt} * ${rt}`
}

function texHandler(node: any, options: any): string | undefined {
	if (node.type === 'OperatorNode' && node.op === '*' && node.args.length === 2) return multiplyTex(node, options)
	if (node.type === 'FunctionNode' && texFunctions[node.fn?.name]) {
		return texFunctions[node.fn.name](node.args.map((a: MathNode) => a.toTex(options)))
	}
	// y__d2 (from y'' in dsolve) prints as y''.
	if (node.type === 'SymbolNode' && /__d\d+$/.test(node.name)) {
		const [, base, n] = node.name.match(/^(.*)__d(\d+)$/)!
		return ` ${base}${"'".repeat(Number(n))}`
	}
	if (node.type === 'FunctionNode' && /__d\d+$/.test(node.fn?.name)) {
		const [, base, n] = node.fn.name.match(/^(.*)__d(\d+)$/)!
		return ` ${base}${"'".repeat(Number(n))}\\left(${node.args.map((a: MathNode) => a.toTex(options)).join(', ')}\\right)`
	}
	// Single letters are variables, not units (math.js would print m, b, g upright).
	if (node.type === 'SymbolNode' && /^[A-Za-z]$/.test(node.name)) return ` ${node.name}`
	if (node.type === 'SymbolNode' && /^[A-Za-z]+\d+$/.test(node.name)) {
		// C1 -> C_{1}, M0 -> M_{0}
		const m = node.name.match(/^([A-Za-z]+)(\d+)$/)!
		const head = m[1].length === 1 ? m[1] : `\\mathrm{${m[1]}}`
		return `${head}_{${m[2]}}`
	}
	if (node.type === 'SymbolNode' && /^[A-Za-z]{2,}$/.test(node.name)) {
		// Keep greek letters (\alpha); show other multi-letter names as one word (Mmax).
		const plain = node.toTex()
		return plain.startsWith('\\') ? plain : `\\mathit{${node.name}}`
	}
	return undefined
}

export function toTex(node: MathNode): string {
	return node.toTex({ handler: texHandler, parenthesis: 'keep', implicit: 'hide' } as any)
}

export function parsedToTex(p: Parsed): string {
	if (p.kind === 'assign') {
		const head = p.params.length ? `${p.name}(${p.params.join(', ')})` : p.name
		return `${texName(head)} = ${toTex(p.body)}`
	}
	if (p.kind === 'relation') return `${toTex(p.lhs)} = ${toTex(p.rhs)}`
	return toTex(p.body)
}

function texName(head: string): string {
	return head
		.replace(/^([A-Za-z]+)(\d+)/, (_m, a, d) => `${a}_{${d}}`)
		.replace(/^([A-Za-z]{2,})(?=\(|$)/, (_m, a) => (math.parse(a).toTex().startsWith('\\') ? math.parse(a).toTex() : `\\mathit{${a}}`))
}
