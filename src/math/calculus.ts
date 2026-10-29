import nerdamer from 'nerdamer'
import type { MathNode } from 'mathjs'
import { math } from './parse'

const { OperatorNode, FunctionNode, SymbolNode, ConstantNode, ParenthesisNode } = math as any

export interface CalcResult {
	node: MathNode
	numeric: boolean // true when a numeric fallback (nint) was needed
}

const num = (v: number): MathNode => new ConstantNode(v)
const sym = (n: string): MathNode => new SymbolNode(n)
const op = (o: string, fn: string, args: MathNode[]): MathNode => new OperatorNode(o, fn, args)
const call = (name: string, args: MathNode[]): MathNode => new FunctionNode(new SymbolNode(name), args)
const mul = (a: MathNode, b: MathNode) => op('*', 'multiply', [a, b])
const div = (a: MathNode, b: MathNode) => op('/', 'divide', [a, b])
const neg = (a: MathNode) => op('-', 'unaryMinus', [a])

export function strip(node: MathNode): MathNode {
	return node.type === 'ParenthesisNode' ? strip((node as any).content) : node
}

export function dependsOn(node: MathNode, v: string): boolean {
	let found = false
	node.traverse((n: any) => {
		if (n.type === 'SymbolNode' && n.name === v) found = true
	})
	return found
}

// Flatten a sum into signed terms.
function terms(node: MathNode, sign = 1, out: { sign: number; node: MathNode }[] = []) {
	const n = strip(node) as any
	if (n.type === 'OperatorNode' && n.fn === 'add') {
		terms(n.args[0], sign, out)
		terms(n.args[1], sign, out)
	} else if (n.type === 'OperatorNode' && n.fn === 'subtract') {
		terms(n.args[0], sign, out)
		terms(n.args[1], -sign, out)
	} else if (n.type === 'OperatorNode' && n.fn === 'unaryMinus') {
		terms(n.args[0], -sign, out)
	} else if (n.type === 'OperatorNode' && n.fn === 'unaryPlus') {
		terms(n.args[0], sign, out)
	} else if (n.type === 'OperatorNode' && (n.fn === 'multiply' || n.fn === 'divide')) {
		// Distribute products over sums so each term can be matched on its own.
		const left = terms(n.args[0])
		const right = n.fn === 'multiply' ? terms(n.args[1]) : [{ sign: 1, node: n.args[1] }]
		if (left.length === 1 && right.length === 1) {
			out.push({ sign: sign * left[0].sign * right[0].sign, node: op(n.op, n.fn, [paren(left[0].node), paren(right[0].node)]) })
		} else {
			for (const l of left) for (const r of right) {
				out.push({ sign: sign * l.sign * r.sign, node: op(n.op, n.fn, [paren(l.node), paren(r.node)]) })
			}
		}
	} else {
		out.push({ sign, node: n })
	}
	return out
}

// Split a product into factors; division by v-free terms is kept as a 1/d factor.
function factors(node: MathNode, out: MathNode[] = []): MathNode[] | null {
	const n = strip(node) as any
	if (n.type === 'OperatorNode' && n.fn === 'multiply') {
		if (!factors(n.args[0], out) || !factors(n.args[1], out)) return null
	} else if (n.type === 'OperatorNode' && n.fn === 'divide') {
		if (!factors(n.args[0], out)) return null
		out.push(div(num(1), n.args[1]))
	} else {
		out.push(n)
	}
	return out
}

function isMac(n: any): boolean {
	return n.type === 'FunctionNode' && n.fn?.name === 'mac'
}

// Match coeff * mac(u, n) where coeff is v-free and du/dv = 1.
function matchMacTerm(node: MathNode, v: string) {
	const fs = factors(node)
	if (!fs) return null
	const macs = fs.filter((f) => isMac(f) && dependsOn(f, v))
	if (macs.length !== 1) return null
	const rest = fs.filter((f) => f !== macs[0])
	if (rest.some((f) => dependsOn(f, v))) return null
	const m = macs[0] as any
	const u: MathNode = m.args[0]
	const nVal = Number(m.args[1]?.evaluate?.() ?? 1)
	if (!Number.isInteger(nVal)) return null
	try {
		const du = math.simplify(math.derivative(u, v)).toString()
		if (du !== '1') return null
	} catch {
		return null
	}
	const coeff = rest.length ? rest.reduce((a, b) => mul(a, b)) : null
	return { coeff, u, n: nVal }
}

function withCoeff(coeff: MathNode | null, node: MathNode) {
	return coeff ? mul(coeff, node) : node
}

function combine(parts: { sign: number; node: MathNode }[]): MathNode {
	if (!parts.length) return num(0)
	let acc = parts[0].sign < 0 ? neg(paren(parts[0].node)) : parts[0].node
	for (const p of parts.slice(1)) {
		acc = op(p.sign < 0 ? '-' : '+', p.sign < 0 ? 'subtract' : 'add', [acc, paren(p.node)])
	}
	return acc
}

function paren(n: MathNode): MathNode {
	const s = strip(n) as any
	if (s.type === 'SymbolNode' || s.type === 'ConstantNode' || s.type === 'FunctionNode') return s
	return new ParenthesisNode(s)
}

function viaNerdamer(fn: 'integrate' | 'diff', node: MathNode, v: string): MathNode | null {
	try {
		const out = nerdamer(`${fn}(${node.toString()}, ${v})`).toString()
		if (out.includes('integrate(') || out.includes('diff(')) return null
		return math.parse(out)
	} catch {
		return null
	}
}

export function integrateNode(node: MathNode, v: string): CalcResult {
	let numeric = false
	const parts = terms(node).map(({ sign, node: t }) => {
		if (!dependsOn(t, v)) return { sign, node: mul(paren(t), sym(v)) }
		const m = matchMacTerm(t, v)
		if (m) {
			const n1 = m.n + 1
			const macN = call('mac', [m.u, num(n1)])
			return { sign, node: withCoeff(m.coeff, m.n >= 1 ? div(macN, num(n1)) : macN) }
		}
		if (!hasMac(t)) {
			const r = viaNerdamer('integrate', t, v)
			if (r) return { sign, node: r }
		}
		numeric = true
		return { sign, node: call('nint', [t, sym(v), num(0), sym(v)]) }
	})
	return { node: combine(parts), numeric }
}

export function definiteIntegral(node: MathNode, v: string, a: MathNode, b: MathNode): CalcResult {
	const F = integrateNode(node, v)
	if (F.numeric) return { node: call('nint', [node, sym(v), a, b]), numeric: true }
	const at = (bound: MathNode) =>
		F.node.transform((n: any) => (n.type === 'SymbolNode' && n.name === v ? paren(bound) : n))
	return { node: op('-', 'subtract', [paren(at(b)), paren(at(a))]), numeric: false }
}

export function diffNode(node: MathNode, v: string): CalcResult {
	let numeric = false
	const parts = terms(node).map(({ sign, node: t }) => {
		if (!dependsOn(t, v)) return { sign, node: num(0) }
		const m = matchMacTerm(t, v)
		if (m) {
			const macN = call('mac', [m.u, num(m.n - 1)])
			return { sign, node: withCoeff(m.coeff, m.n >= 1 ? mul(num(m.n), macN) : macN) }
		}
		if (!hasMac(t)) {
			try {
				return { sign, node: math.derivative(t, v) }
			} catch {
				const r = viaNerdamer('diff', t, v)
				if (r) return { sign, node: r }
			}
		}
		throw new Error(`Cannot differentiate ${t.toString()}`)
	})
	return { node: tidy(combine(parts.filter((p) => !(isZero(p.node))))), numeric }
}

function hasMac(n: MathNode): boolean {
	let f = false
	n.traverse((c: any) => {
		if (isMac(c)) f = true
	})
	return f
}

function isZero(n: MathNode) {
	const s = strip(n) as any
	return s.type === 'ConstantNode' && s.value === 0
}

// Light cleanup; math.simplify understands unknown functions like mac as opaque.
// Expressions with Macaulay terms are left expanded so later integration can match them.
export function tidy(node: MathNode): MathNode {
	if (hasMac(node)) {
		return combine(terms(node).map(({ sign, node: t }) => ({ sign, node: simplifyTerm(t) })))
	}
	try {
		return math.simplify(node, {}, { exactFractions: true } as any)
	} catch {
		return node
	}
}

function simplifyTerm(node: MathNode): MathNode {
	try {
		return math.simplify(node)
	} catch {
		return node
	}
}

// limit(f, v, a): exact via nerdamer when possible, else a numeric limit evaluated at run time.
export function limitNode(node: MathNode, v: string, a: MathNode): CalcResult {
	if (!hasMac(node)) {
		try {
			const out = nerdamer(`limit(${node.toString({ implicit: 'show' })}, ${v}, ${a.toString({ implicit: 'show' })})`).toString()
			if (!out.includes('limit(') && !/undefined|NaN/.test(out)) return { node: math.parse(out), numeric: false }
		} catch {}
	}
	return { node: call('nlim', [node, sym(v), a]), numeric: true }
}

// Finite sum / product over integer k from a to b, evaluated numerically.
export function seriesNode(kind: 'nsum' | 'nprod', node: MathNode, k: string, a: MathNode, b: MathNode): CalcResult {
	return { node: call(kind, [node, sym(k), a, b]), numeric: false }
}

// Taylor polynomial of f about v = a, up to order n.
export function taylorNode(node: MathNode, v: string, a: MathNode, order: number): CalcResult {
	if (!Number.isInteger(order) || order < 0 || order > 20) throw new Error('Taylor order must be a whole number 0..20')
	const at = (n: MathNode) => n.transform((c: any) => (c.type === 'SymbolNode' && c.name === v ? paren(a) : c))
	const parts: { sign: number; node: MathNode }[] = []
	let d = node
	let fact = 1
	for (let k = 0; k <= order; k++) {
		if (k > 0) {
			d = diffNode(d, v).node
			fact *= k
		}
		const coeff = div(paren(at(d)), num(fact))
		const powTerm = k === 0 ? num(1) : op('^', 'pow', [paren(op('-', 'subtract', [sym(v), paren(a)])), num(k)])
		parts.push({ sign: 1, node: k === 0 ? coeff : mul(coeff, powTerm) })
	}
	return { node: tidy(combine(parts)), numeric: false }
}
