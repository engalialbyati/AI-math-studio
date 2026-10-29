import type { MathNode } from 'mathjs'
import { definiteIntegral, diffNode, integrateNode, limitNode, seriesNode, strip, taylorNode, tidy } from './calculus'
import { toJs } from './codegen'
import { makeHelpers } from './helpers'
import { math, parseEquation, parsedToTex, toTex, type Parsed } from './parse'
import { parseSolveQuery, queryTex, solveFor, type SolveQuery } from './solve'

const { SymbolNode, FunctionNode, ParenthesisNode, OperatorNode, ConstantNode } = math as any
const H = makeHelpers()

const BUILTIN_SYMBOLS = new Set(['pi', 'PI', 'e', 'E', 'Infinity', 'true', 'false'])
const CALCULUS = new Set(['integrate', 'int', 'diff', 'derivative', 'limit', 'lim', 'sum', 'prod', 'product', 'taylor'])

export interface EquationInput {
	id: string
	text: string
}
export interface SliderInput {
	id: string
	name: string
	value: number
}

export interface EquationResult {
	id: string
	text: string
	kind: 'constant' | 'function' | 'expression' | 'relation' | 'solve' | 'matrix' | 'error' | 'empty'
	name?: string
	params?: string[]
	tex?: string // the equation as typed, in LaTeX
	resolvedTex?: string // after calculus / substitution, when it differs
	resolved?: string // plain-text resolved expression
	value?: number
	numeric?: boolean // a numeric integration fallback was used
	solution?: string // solve query answer, e.g. "b = 1"
	error?: string
}

export interface CompiledFunction {
	params: string[]
	js: string // JS expression body using v_<param>, C[...] and H.*
	expr: string
}

// What widgets and exported pages receive.
export interface ScopeProgram {
	constants: Record<string, number>
	constOrder: string[]
	constJs: Record<string, string>
	sliders: string[]
	functions: Record<string, CompiledFunction>
}

export interface ScopeResult {
	results: Record<string, EquationResult>
	program: ScopeProgram
	evaluate: (text: string) => EquationResult
}

interface Def {
	id: string
	name: string
	params: string[]
	body: MathNode
	slider?: boolean
	explicitParams: boolean
}
interface Resolved {
	expr: MathNode
	params: string[]
	isConstant: boolean
	numeric: boolean
}

const paren = (n: MathNode): MathNode => {
	const s = strip(n) as any
	return s.type === 'SymbolNode' || s.type === 'ConstantNode' || s.type === 'FunctionNode'
		? s
		: new ParenthesisNode(s)
}

// Numeric forms whose second argument is a bound variable: nint(f, x, a, b), nsum(f, k, a, b), nlim(f, x, a).
const BINDING = new Set(['nint', 'nsum', 'nprod', 'nlim', 'ode'])

// Substitute symbols, respecting the variable bound inside nint(...) and friends.
function substitute(node: MathNode, map: Map<string, MathNode>): MathNode {
	const n = node as any
	if (n.type === 'SymbolNode') return map.has(n.name) ? paren(map.get(n.name)!) : n
	if (n.type === 'FunctionNode' && BINDING.has(n.fn?.name)) {
		const inner = new Map(map)
		inner.delete(n.args[1].name)
		return new FunctionNode(n.fn, [
			substitute(n.args[0], inner),
			n.args[1],
			...n.args.slice(2).map((a: MathNode) => substitute(a, map)),
		])
	}
	if (n.type === 'FunctionNode') return new FunctionNode(n.fn, n.args.map((a: MathNode) => substitute(a, map)))
	return n.map((c: MathNode) => substitute(c, map))
}

function symbolsIn(node: MathNode, bound = new Set<string>(), out = new Set<string>()): Set<string> {
	const n = node as any
	if (n.type === 'SymbolNode') {
		// __y<k> are the state variables inside ode(...).
		if (!bound.has(n.name) && !/^__y\d+$/.test(n.name)) out.add(n.name)
	} else if (n.type === 'FunctionNode' && BINDING.has(n.fn?.name)) {
		const inner = new Set(bound)
		inner.add(n.args[1].name)
		symbolsIn(n.args[0], inner, out)
		n.args.slice(2).forEach((a: MathNode) => symbolsIn(a, bound, out))
	} else if (n.type === 'FunctionNode') {
		n.args.forEach((a: MathNode) => symbolsIn(a, bound, out))
	} else {
		n.forEach((c: MathNode) => symbolsIn(c, bound, out))
	}
	return out
}

function sortParams(vars: Iterable<string>): string[] {
	const pref = ['x', 't', 'y', 'z']
	return [...vars].sort((a, b) => {
		const ia = pref.indexOf(a), ib = pref.indexOf(b)
		if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
		return a.localeCompare(b)
	})
}

export function formatNumber(v: number): string {
	if (!Number.isFinite(v)) return String(v)
	return math.format(v, { precision: 6, lowerExp: -6, upperExp: 9 }) as string
}

export function computeScope(equations: EquationInput[], sliders: SliderInput[] = []): ScopeResult {
	const results: Record<string, EquationResult> = {}
	const defs = new Map<string, Def>()
	const parsed = new Map<string, Parsed>()
	const queries = new Map<string, SolveQuery>()

	for (const s of sliders) {
		if (!s.name) continue
		defs.set(s.name, {
			id: s.id, name: s.name, params: [], body: new (math as any).ConstantNode(s.value),
			slider: true, explicitParams: false,
		})
	}

	for (const eq of equations) {
		const base: EquationResult = { id: eq.id, text: eq.text, kind: 'empty' }
		results[eq.id] = base
		if (!eq.text.trim()) continue
		try {
			const q = parseSolveQuery(eq.text)
			if (q) {
				queries.set(eq.id, q)
				base.tex = queryTex(q)
				continue
			}
			const p = parseEquation(eq.text)
			parsed.set(eq.id, p)
			base.tex = parsedToTex(p)
			if (p.kind === 'assign') {
				base.name = p.name
				if (defs.has(p.name)) {
					const other = defs.get(p.name)!
					throw new Error(`"${p.name}" is already defined${other.slider ? ' by a slider' : ''}`)
				}
				if (CALCULUS.has(p.name) || p.name === 'mac' || BUILTIN_SYMBOLS.has(p.name)) {
					throw new Error(`"${p.name}" is a reserved name`)
				}
				defs.set(p.name, { id: eq.id, name: p.name, params: p.params, body: p.body, explicitParams: p.params.length > 0 })
			}
		} catch (err: any) {
			Object.assign(base, { kind: 'error', error: cleanError(err) })
		}
	}

	// Matrix definitions (A = [1, 2; 3, 4], d = det(A), ...) are evaluated by math.js after the
	// scalar pass; anything that mentions a matrix becomes a matrix definition too.
	const matrixDefs = new Map<string, Def>()
	// Matrix parts of other equations that do not depend on their variables, precomputed:
	// y(x) = det(A)*x  ->  __m1 = det(A), y(x) = __m1*x.
	const hoisted = new Map<string, Def>()
	const known = (s: string) => defs.has(s) || matrixDefs.has(s) || hoisted.has(s) || BUILTIN_SYMBOLS.has(s)
	for (let changed = true; changed; ) {
		changed = false
		for (const [name, def] of defs) {
			if (def.slider || !isMatrixExpr(def.body, matrixDefs)) continue
			const free = [...symbolsIn(def.body)].filter((s) => def.params.includes(s) || !known(s))
			if (!free.length && !def.explicitParams) {
				matrixDefs.set(name, def)
				defs.delete(name)
			} else {
				const hoist = (node: MathNode): MathNode => {
					if (isMatrixExpr(node, matrixDefs) && [...symbolsIn(node)].every((s) => !def.params.includes(s) && known(s))) {
						const id = `__m${hoisted.size + 1}`
						hoisted.set(id, { id: def.id, name: id, params: [], body: node, explicitParams: false })
						return new SymbolNode(id)
					}
					return (node as any).map((c: MathNode) => hoist(c))
				}
				defs.set(name, { ...def, body: hoist(def.body) })
			}
			changed = true
		}
	}

	const memo = new Map<string, Resolved>()
	const visiting = new Set<string>()
	const isConstantName = (name: string) => matrixScalars.has(name) || (defs.has(name) && resolveDef(name).isConstant)

	function resolveNode(node: MathNode, bound: Set<string>, flags: { numeric: boolean }): MathNode {
		const n = node as any
		if (n.type === 'SymbolNode') {
			if (bound.has(n.name) || !defs.has(n.name)) return n
			const r = resolveDef(n.name)
			flags.numeric ||= r.numeric
			return r.isConstant ? n : paren(r.expr)
		}
		if (n.type === 'FunctionNode') {
			const name: string = n.fn?.name
			if (name === 'dsolve') return odeNode(n, bound, flags)
			if (CALCULUS.has(name)) {
				const v: string = n.args[1]?.type === 'SymbolNode' ? n.args[1].name : 'x'
				const inner = new Set(bound)
				inner.add(v)
				const body = resolveNode(n.args[0], inner, flags)
				const outer = (k: number) => resolveNode(n.args[k], bound, flags)
				let res
				if (name === 'limit' || name === 'lim') {
					res = limitNode(body, v, n.args[2] ? outer(2) : new ConstantNode(0))
				} else if (name === 'sum' || name === 'prod' || name === 'product') {
					if (n.args.length < 4) throw new Error(`${name}(expr, k, from, to)`)
					res = seriesNode(name === 'sum' ? 'nsum' : 'nprod', body, v, outer(2), outer(3))
				} else if (name === 'taylor') {
					const order = n.args[3] ? Number(n.args[3].evaluate()) : 4
					res = taylorNode(body, v, n.args[2] ? outer(2) : new ConstantNode(0), order)
				} else if (name === 'integrate' || name === 'int') {
					res = n.args.length >= 4
						? definiteIntegral(body, v, resolveNode(n.args[2], bound, flags), resolveNode(n.args[3], bound, flags))
						: integrateNode(body, v)
					res.node = tidy(res.node)
				} else {
					const order = n.args[2] ? Number(n.args[2].evaluate()) : 1
					res = { node: body, numeric: false }
					for (let k = 0; k < order; k++) res = diffNode(res.node, v)
				}
				flags.numeric ||= res.numeric
				return paren(res.node)
			}
			const args = n.args.map((a: MathNode) => resolveNode(a, bound, flags))
			const def = defs.get(name)
			if (def && !bound.has(name)) {
				const r = resolveDef(name)
				flags.numeric ||= r.numeric
				if (r.params.length !== args.length) {
					throw new Error(`${name} expects ${r.params.length} argument(s), got ${args.length}`)
				}
				return paren(substitute(r.expr, new Map(r.params.map((p, i) => [p, args[i]]))))
			}
			return new FunctionNode(n.fn, args)
		}
		return n.map((c: MathNode) => resolveNode(c, bound, flags))
	}

	// dsolve(y'' + a*y' + b*y == f(x), y(x0) == y0, y'(x0) == v0) -> ode(F, x, n, x0, y0, v0, x),
	// where F is the equation solved for the highest derivative (it must appear linearly).
	function odeNode(n: any, bound: Set<string>, flags: { numeric: boolean }): MathNode {
		const [eq, ...conds] = n.args.map((a: any) => strip(a))
		if (eq?.type !== 'OperatorNode' || eq.fn !== 'equal') throw new Error("dsolve: write the equation first, e.g. dsolve(y'' + y = 0, y(0) = 1, y'(0) = 0)")
		const syms = [...symbolsIn(eq)]
		const derivs = syms.map((s) => s.match(/^(.*)__d(\d+)$/)).filter(Boolean) as RegExpMatchArray[]
		if (!derivs.length) throw new Error("dsolve: use y', y'' ... for derivatives")
		const y = derivs[0][1]
		const order = Math.max(...derivs.map((m) => Number(m[2])))
		// Independent variable: the definition's own parameter (u(t) = dsolve(...)), else x (or t if used).
		const x = defParams[0] ?? (syms.includes('t') && !syms.includes('x') ? 't' : 'x')
		const name = (k: number) => (k === 0 ? y : `${y}__d${k}`)
		const inner = new Set([...bound, x, ...Array.from({ length: order + 1 }, (_, k) => name(k))])
		const expr = resolveNode(new OperatorNode('-', 'subtract', [eq.args[0], paren(eq.args[1])]), inner, flags)
		const top = name(order)
		const A = math.simplify(math.derivative(expr, top))
		if (symbolsIn(A).has(top)) throw new Error(`dsolve: ${y}${"'".repeat(order)} must appear linearly`)
		const B = substitute(expr, new Map([[top, new ConstantNode(0)]]))
		// State: y -> __y0, y' -> __y1, ...
		const state = new Map(Array.from({ length: order }, (_, k) => [name(k), new SymbolNode(`__y${k}`)] as [string, MathNode]))
		const F = substitute(new OperatorNode('/', 'divide', [new OperatorNode('-', 'unaryMinus', [paren(B)]), paren(A)]), state)
		let x0: MathNode | null = null
		const init: MathNode[] = []
		for (let k = 0; k < order; k++) {
			const c = conds.find((c: any) => c?.type === 'OperatorNode' && c.fn === 'equal' && strip(c.args[0]).type === 'FunctionNode' && (strip(c.args[0]) as any).fn.name === name(k))
			if (!c) throw new Error(`dsolve: need ${y}${"'".repeat(k)}(x0) = value`)
			const at = resolveNode((strip(c.args[0]) as any).args[0], bound, flags)
			x0 ??= at
			init.push(resolveNode(c.args[1], bound, flags))
		}
		flags.numeric = true
		return new FunctionNode(new SymbolNode('ode'), [F, new SymbolNode(x), new ConstantNode(order), x0!, ...init, new SymbolNode(x)])
	}

	let defParams: string[] = []
	function resolveDef(name: string): Resolved {
		const hit = memo.get(name)
		if (hit) return hit
		if (visiting.has(name)) throw new Error(`Circular definition involving "${name}"`)
		const def = defs.get(name)!
		visiting.add(name)
		try {
			const flags = { numeric: false }
			const outerParams = defParams
			defParams = def.params
			let expr: MathNode
			try {
				expr = resolveNode(def.body, new Set(def.params), flags)
			} finally {
				defParams = outerParams
			}
			const free = [...symbolsIn(expr)].filter(
				(s) => !BUILTIN_SYMBOLS.has(s) && !def.params.includes(s) && !isConstantName(s)
			)
			if (def.explicitParams && free.length) {
				throw new Error(`Undefined: ${free.join(', ')}`)
			}
			const params = def.explicitParams ? def.params : sortParams(free)
			const r: Resolved = { expr, params, isConstant: params.length === 0, numeric: flags.numeric }
			memo.set(name, r)
			return r
		} finally {
			visiting.delete(name)
		}
	}

	// Numeric values of constants, in dependency order.
	const constants: Record<string, number> = {}
	const constJs: Record<string, string> = {}
	const constOrder: string[] = []
	const constNames = () => new Set([...defs.keys(), ...matrixScalars].filter((k) => { try { return isConstantName(k) } catch { return false } }))
	let allConsts: Set<string> | null = null
	function evalConst(name: string): number {
		if (name in constants) return constants[name]
		allConsts ??= constNames()
		const r = resolveDef(name)
		for (const s of symbolsIn(r.expr)) if (allConsts.has(s) && s !== name) evalConst(s)
		const js = toJs(r.expr, { params: new Set(), constants: allConsts })
		const v = Number(new Function('C', 'H', `return ${js}`)(constants, H))
		constants[name] = v
		constJs[name] = js
		constOrder.push(name)
		return v
	}

	const functions: Record<string, CompiledFunction> = {}
	function compileFn(name: string, r: Resolved): CompiledFunction {
		allConsts ??= constNames()
		const js = toJs(r.expr, { params: new Set(r.params), constants: allConsts })
		// Compile once to surface syntax problems early.
		new Function('C', 'H', `return (${r.params.map((p) => 'v_' + p).join(', ')}) => ${js}`)
		const f = { params: r.params, js, expr: r.expr.toString() }
		functions[name] = f
		return f
	}

	// Constants only show their value; functions show the simplified resolved form when it differs.
	function describe(base: EquationResult, original: MathNode, r: Resolved) {
		base.numeric = r.numeric || undefined
		if (r.isConstant) return
		// Numeric ODE solutions have no readable closed form.
		if (r.expr.toString().includes('ode(')) return
		const shown = r.numeric ? r.expr : tidy(r.expr)
		if (strip(shown).toString() !== strip(original).toString()) {
			base.resolved = shown.toString()
			base.resolvedTex = toTex(shown)
		}
	}

	// math.js scope for matrix work: every scalar constant, compiled function and matrix result.
	const matrixValues: Record<string, unknown> = {}
	function matrixScope() {
		allConsts ??= constNames()
		for (const s of allConsts) {
			try { evalConst(s) } catch { /* reported on its own equation */ }
		}
		const scope: Record<string, unknown> = { ...constants }
		for (const [name, f] of Object.entries(functions)) scope[name] = makeCallable(f, constants)
		return Object.assign(scope, matrixValues)
	}
	function showMatrixValue(base: EquationResult, v: unknown) {
		if (typeof v === 'number') {
			base.kind = 'constant'
			base.value = v
		} else if (v && typeof (v as any).toArray === 'function') {
			base.kind = 'matrix'
			base.resolvedTex = matrixTex((v as any).toArray())
		} else {
			base.kind = 'matrix'
			base.resolvedTex = `\\text{${math.format(v as any, { precision: 6 })}}`
		}
	}
	// Scalars from matrix work (d = det(A), hoisted parts) count as constants for everything else.
	const matrixScalars = new Set<string>()
	const hoistErrors = new Map<string, string>()
	for (const [name, def] of matrixDefs) {
		const base = results[def.id]
		try {
			const v = def.body.evaluate(matrixScope())
			matrixValues[name] = v
			showMatrixValue(base, v)
			// A matrix typed out in plain numbers needs no "= [...]" repeat.
			if (strip(def.body).type === 'ArrayNode' && !symbolsIn(def.body).size) base.resolvedTex = undefined
		} catch (err: any) {
			Object.assign(base, { kind: 'error', error: cleanError(err) })
		}
	}
	for (const [name, def] of hoisted) {
		try {
			const v = def.body.evaluate(matrixScope())
			if (typeof v !== 'number') throw new Error('A matrix-valued part inside a function is not supported; use det, dot, trace, ...')
			matrixValues[name] = v
		} catch (err: any) {
			hoistErrors.set(def.id, cleanError(err))
		}
	}
	for (const [name, v] of Object.entries(matrixValues)) {
		if (typeof v !== 'number') continue
		constants[name] = v
		constJs[name] = String(v)
		constOrder.push(name)
		matrixScalars.add(name)
	}
	// Resolutions made during the matrix pass did not know these constants yet.
	allConsts = null
	memo.clear()

	for (const [name, def] of defs) {
		if (def.slider) {
			try { evalConst(name) } catch { /* slider value always numeric */ }
			continue
		}
		const base = results[def.id]
		const hoistError = hoistErrors.get(def.id)
		if (hoistError) {
			Object.assign(base, { kind: 'error', error: hoistError })
			continue
		}
		try {
			const r = resolveDef(name)
			describe(base, def.body, r)
			if (r.isConstant) {
				base.kind = 'constant'
				base.value = evalConst(name)
			} else {
				base.kind = 'function'
				base.params = r.params
				compileFn(name, r)
			}
		} catch (err: any) {
			Object.assign(base, { kind: 'error', error: cleanError(err) })
		}
	}

	function evaluateParsed(base: EquationResult, p: Parsed) {
		allConsts ??= constNames()
		if (p.kind === 'expression' && isMatrixExpr(p.body, matrixDefs)) {
			showMatrixValue(base, p.body.evaluate(matrixScope()))
			return
		}
		if (p.kind === 'relation') {
			base.kind = 'relation'
			return
		}
		if (p.kind !== 'expression') return
		const flags = { numeric: false }
		const expr = resolveNode(p.body, new Set(), flags)
		const free = [...symbolsIn(expr)].filter((s) => !BUILTIN_SYMBOLS.has(s) && !allConsts!.has(s))
		const r: Resolved = { expr, params: sortParams(free), isConstant: free.length === 0, numeric: flags.numeric }
		describe(base, p.body, r)
		if (r.isConstant) {
			for (const s of symbolsIn(expr)) if (allConsts.has(s)) evalConst(s)
			const js = toJs(expr, { params: new Set(), constants: allConsts })
			base.value = Number(new Function('C', 'H', `return ${js}`)(constants, H))
			base.kind = 'constant'
		} else {
			base.kind = 'expression'
			base.params = r.params
			if (!base.resolvedTex) base.resolvedTex = undefined
		}
	}

	for (const eq of equations) {
		const base = results[eq.id]
		const p = parsed.get(eq.id)
		if (!p || base.kind === 'error' || p.kind === 'assign') continue
		try {
			evaluateParsed(base, p)
		} catch (err: any) {
			Object.assign(base, { kind: 'error', error: cleanError(err) })
		}
	}

	// Each equation on the page as lhs = rhs. A definition keeps its own name as an unknown lhs.
	function relations(): { lhs: MathNode; rhs: MathNode; isDef: boolean }[] {
		const out: { lhs: MathNode; rhs: MathNode; isDef: boolean }[] = []
		for (const [name, def] of defs) {
			if (!def.slider) out.push({ lhs: new SymbolNode(name), rhs: def.body, isDef: true })
		}
		for (const p of parsed.values()) {
			if (p.kind === 'relation') out.push({ lhs: p.lhs, rhs: p.rhs, isDef: false })
		}
		return out
	}

	function solveQuery(base: EquationResult, q: SolveQuery) {
		allConsts ??= constNames()
		for (const s of allConsts) evalConst(s)
		const values = new Map<string, MathNode>()
		const numeric = (node: MathNode) => {
			const flags = { numeric: false }
			const e = substitute(resolveNode(node, new Set(), flags), values)
			const consts = new Map([...allConsts!].filter((s) => !values.has(s) && s !== q.unknown).map((s) => [s, new ConstantNode(constants[s])]))
			return substitute(e, consts)
		}
		for (const k of q.knowns) {
			const v = numeric(math.parse(k.text)).evaluate()
			if (typeof v !== 'number') throw new Error(`${k.name} must be a number`)
			values.set(k.name, new ConstantNode(v))
		}
		let missing: string[] | null = null
		for (const rel of relations()) {
			const left = rel.isDef ? substitute(rel.lhs, values) : numeric(rel.lhs)
			const expr = new OperatorNode('-', 'subtract', [left, paren(numeric(rel.rhs))])
			const free = [...symbolsIn(expr)].filter((s) => !BUILTIN_SYMBOLS.has(s))
			if (!free.includes(q.unknown)) continue
			const others = free.filter((s) => s !== q.unknown)
			if (others.length) {
				if (!missing || others.length < missing.length) missing = others
				continue
			}
			const roots = solveFor(expr, q.unknown)
			if (!roots.length) throw new Error(`No real solution for ${q.unknown}`)
			base.kind = 'solve'
			base.name = q.unknown
			base.value = roots[0]
			base.solution = `${q.unknown} = ${roots.map(formatNumber).join(', ')}`
			return
		}
		throw new Error(missing ? `Also need: ${missing.join(', ')}` : `No equation on the page contains ${q.unknown}`)
	}

	for (const [id, q] of queries) {
		try {
			solveQuery(results[id], q)
		} catch (err: any) {
			Object.assign(results[id], { kind: 'error', error: cleanError(err) })
		}
	}

	return {
		results,
		program: { constants, constOrder, constJs, sliders: sliders.map((s) => s.name), functions },
		evaluate(text: string) {
			const base: EquationResult = { id: 'eval', text, kind: 'empty' }
			try {
				const p = parseEquation(text)
				base.tex = parsedToTex(p)
				if (p.kind === 'assign') {
					// Evaluate the right-hand side without binding it.
					evaluateParsed(base, { kind: 'expression', body: p.body })
					base.name = p.name
				} else {
					evaluateParsed(base, p)
				}
			} catch (err: any) {
				Object.assign(base, { kind: 'error', error: cleanError(err) })
			}
			return base
		},
	}
}

const MATRIX_FN = new Set(['det', 'inv', 'transpose', 'trace', 'dot', 'cross', 'identity', 'zeros', 'ones', 'diag', 'norm', 'pinv', 'lusolve', 'size', 'kron', 'eigs', 'matrix', 'ctranspose'])

function isMatrixExpr(node: MathNode, matrices: Map<string, unknown>): boolean {
	let found = false
	node.traverse((n: any) => {
		if (n.type === 'ArrayNode') found = true
		else if (n.type === 'FunctionNode' && MATRIX_FN.has(n.fn?.name)) found = true
		else if (n.type === 'SymbolNode' && matrices.has(n.name)) found = true
	})
	return found
}

function matrixTex(rows: unknown[]): string {
	const cell = (v: unknown) => (typeof v === 'number' ? formatNumber(v) : String(v))
	// A plain vector is shown as a column, like it is typed.
	const body = (Array.isArray(rows[0]) ? (rows as unknown[][]) : rows.map((v) => [v])).map((r) => r.map(cell).join(' & ')).join(' \\\\ ')
	return `\\begin{bmatrix} ${body} \\end{bmatrix}`
}

function cleanError(err: any): string {
	const msg = String(err?.message ?? err)
	return msg.replace(/^Error: /, '').replace(/\(char \d+\)/, '').trim()
}

// Build a callable for a compiled function against a constants table.
export function makeCallable(f: CompiledFunction, constants: Record<string, number>) {
	return new Function('C', 'H', `return (${f.params.map((p) => 'v_' + p).join(', ')}) => ${f.js}`)(
		constants,
		H
	) as (...args: number[]) => number
}
