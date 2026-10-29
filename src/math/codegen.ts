import type { MathNode } from 'mathjs'

// Compile a resolved math.js tree into a plain JS expression string.
// Params become `v_<name>`, constants are read from `C["name"]`, helpers from `H`.

const FN: Record<string, string> = {
	sin: 'Math.sin', cos: 'Math.cos', tan: 'Math.tan', asin: 'Math.asin', acos: 'Math.acos',
	atan: 'Math.atan', atan2: 'Math.atan2', sinh: 'Math.sinh', cosh: 'Math.cosh', tanh: 'Math.tanh',
	asinh: 'Math.asinh', acosh: 'Math.acosh', atanh: 'Math.atanh', exp: 'Math.exp',
	ln: 'Math.log', log: 'H.log', log10: 'Math.log10', log2: 'Math.log2', sqrt: 'Math.sqrt',
	cbrt: 'Math.cbrt', abs: 'Math.abs', sign: 'Math.sign', floor: 'Math.floor', ceil: 'Math.ceil',
	round: 'Math.round', min: 'Math.min', max: 'Math.max', pow: 'Math.pow', mod: 'H.mod',
	mac: 'H.mac', step: 'H.step', heaviside: 'H.step', factorial: 'H.fact', nthRoot: 'H.root',
}
const RECIP: Record<string, string> = { sec: 'Math.cos', csc: 'Math.sin', cot: 'Math.tan' }
const BIN: Record<string, string> = {
	add: '+', subtract: '-', multiply: '*', divide: '/', smaller: '<', larger: '>',
	smallerEq: '<=', largerEq: '>=', equal: '===', unequal: '!==', and: '&&', or: '||',
}

export interface CodegenCtx {
	params: Set<string>
	constants: Set<string>
}

export function toJs(node: MathNode, ctx: CodegenCtx): string {
	const n = node as any
	switch (n.type) {
		case 'ConstantNode':
			return typeof n.value === 'number' ? `(${n.value})` : JSON.stringify(n.value)
		case 'ParenthesisNode':
			return `(${toJs(n.content, ctx)})`
		case 'SymbolNode': {
			if (/^__y\d+$/.test(n.name)) return `Y[${n.name.slice(3)}]`
			if (ctx.params.has(n.name)) return `v_${n.name}`
			if (ctx.constants.has(n.name)) return `C[${JSON.stringify(n.name)}]`
			if (n.name === 'pi' || n.name === 'PI') return 'Math.PI'
			if (n.name === 'e' || n.name === 'E') return 'Math.E'
			if (n.name === 'Infinity') return 'Infinity'
			throw new Error(`Unknown symbol "${n.name}"`)
		}
		case 'OperatorNode': {
			const a = n.args.map((x: MathNode) => toJs(x, ctx))
			if (n.fn === 'unaryMinus') return `(-${a[0]})`
			if (n.fn === 'unaryPlus') return `(+${a[0]})`
			if (n.fn === 'not') return `(!${a[0]})`
			if (n.fn === 'pow') return `Math.pow(${a[0]}, ${a[1]})`
			if (n.fn === 'mod') return `H.mod(${a[0]}, ${a[1]})`
			if (n.fn === 'factorial') return `H.fact(${a[0]})`
			if (BIN[n.fn]) return `(${a[0]} ${BIN[n.fn]} ${a[1]})`
			throw new Error(`Unsupported operator ${n.op}`)
		}
		case 'ConditionalNode':
			return `(${toJs(n.condition, ctx)} ? ${toJs(n.trueExpr, ctx)} : ${toJs(n.falseExpr, ctx)})`
		case 'FunctionNode': {
			const name = n.fn?.name
			if (name === 'nint' || name === 'nsum' || name === 'nprod') {
				const v = n.args[1].name
				const inner = new Set(ctx.params)
				inner.add(v)
				const f = toJs(n.args[0], { ...ctx, params: inner })
				return `H.${name}((v_${v}) => ${f}, ${toJs(n.args[2], ctx)}, ${toJs(n.args[3], ctx)})`
			}
			if (name === 'ode') {
				// ode(F, x, n, x0, y0, y0', ..., X): F uses x and the state Y[k] (symbols __y<k>).
				const v = n.args[1].name
				const inner = new Set(ctx.params)
				inner.add(v)
				const order = Number(n.args[2].value)
				const f = toJs(n.args[0], { ...ctx, params: inner })
				const init = n.args.slice(4, 4 + order).map((x: MathNode) => toJs(x, ctx))
				return `H.ode((v_${v}, Y) => ${f}, ${order}, ${toJs(n.args[3], ctx)}, [${init.join(', ')}], ${toJs(n.args[4 + order], ctx)})`
			}
			if (name === 'nlim') {
				const v = n.args[1].name
				const inner = new Set(ctx.params)
				inner.add(v)
				const f = toJs(n.args[0], { ...ctx, params: inner })
				return `H.nlim((v_${v}) => ${f}, ${toJs(n.args[2], ctx)})`
			}
			const a = n.args.map((x: MathNode) => toJs(x, ctx))
			if (RECIP[name]) return `(1 / ${RECIP[name]}(${a[0]}))`
			if (FN[name]) return `${FN[name]}(${a.join(', ')})`
			throw new Error(`Unknown function "${name}"`)
		}
		default:
			throw new Error(`Unsupported expression (${n.type})`)
	}
}
