import { describe, expect, it } from 'vitest'
import { computeScope, makeCallable } from '../../src/math/scope'

const eqs = (...texts: string[]) => texts.map((text, i) => ({ id: `e${i}`, text }))
const run = (...texts: string[]) => computeScope(eqs(...texts))
const fn = (s: ReturnType<typeof run>, name: string) =>
	makeCallable(s.program.functions[name], s.program.constants)

describe('parsing and constants', () => {
	it('evaluates constants in any order', () => {
		const s = run('b = 2*a', 'a = 3')
		expect(s.results.e0.value).toBe(6)
		expect(s.results.e1.kind).toBe('constant')
	})
	it('treats y = expr in x as a function', () => {
		const s = run('y=(1+x)/2')
		expect(s.results.e0.kind).toBe('function')
		expect(s.results.e0.params).toEqual(['x'])
		expect(fn(s, 'y')(3)).toBe(2)
		expect(s.results.e0.tex).toContain('frac')
	})
	it('reports undefined symbols in explicit functions', () => {
		expect(run('f(x) = a*x').results.e0.error).toMatch(/Undefined: a/)
	})
	it('reports cycles and duplicates', () => {
		expect(run('a = b', 'b = a').results.e0.kind).toBe('error')
		expect(run('a = 1', 'a = 2').results.e1.error).toMatch(/already defined/)
	})
	it('treats x^2 + y^2 = 4 as a relation', () => {
		expect(run('x^2 + y^2 = 4').results.e0.kind).toBe('relation')
	})
	it('sliders define constants', () => {
		const s = computeScope(eqs('f(x) = a*x'), [{ id: 's', name: 'a', value: 4 }])
		expect(fn(s, 'f')(2)).toBe(8)
	})
})

describe('calculus', () => {
	it('integrates polynomials symbolically', () => {
		const s = run('F(x) = integrate(x^2, x)')
		expect(fn(s, 'F')(3)).toBeCloseTo(9)
		expect(s.results.e0.numeric).toBeUndefined()
	})
	it('differentiates', () => {
		const s = run('g(x) = diff(sin(x)^2, x)')
		expect(fn(s, 'g')(1)).toBeCloseTo(2 * Math.sin(1) * Math.cos(1))
	})
	it('computes definite integrals', () => {
		expect(run('integrate(x^2, x, 0, 2)').results.e0.value).toBeCloseTo(8 / 3)
	})
	it('integrates referenced functions by name', () => {
		const s = run('f(x) = 3*x^2', 'F(x) = integrate(f, x)')
		expect(fn(s, 'F')(2)).toBeCloseTo(8)
	})
	it('falls back to numeric integration', () => {
		const s = run('F(x) = integrate(exp(-x^2), x)')
		expect(s.results.e0.error).toBeUndefined()
		expect(s.results.e0.numeric).toBe(true)
		expect(fn(s, 'F')(10)).toBeCloseTo(Math.sqrt(Math.PI) / 2, 4)
	})
	it('evaluate() works against the scope', () => {
		const s = run('a = 2')
		expect(s.evaluate('a^3').value).toBe(8)
		expect(s.evaluate('diff(x^3, x)').resolved).toMatch(/3/)
	})
})

describe('Macaulay brackets (beam example)', () => {
	it('point load integrates to a step', () => {
		const s = run('P = 5', 'V(x) = integrate(P<x-2>^-1, x)')
		expect(s.results.e1.error).toBeUndefined()
		const V = fn(s, 'V')
		expect(V(1)).toBe(0)
		expect(V(3)).toBe(5)
	})
	it('simply supported UDL: M_max = qL^2/8', () => {
		const s = run(
			'L = 6', 'q = 10',
			'w(x) = -q',
			'V(x) = integrate(w, x) + q*L/2',
			'M(x) = integrate(V, x)',
			'Mmax = M(L/2)'
		)
		for (const r of Object.values(s.results)) expect(r.error).toBeUndefined()
		expect(s.results.e5.value).toBeCloseTo((10 * 36) / 8)
		expect(fn(s, 'V')(0)).toBeCloseTo(30)
		expect(fn(s, 'M')(6)).toBeCloseTo(0)
	})
	it('point load mid-span via singularity functions', () => {
		const s = run(
			'L = 4', 'P = 8',
			'w(x) = P/2*<x>^-1 - P*<x-L/2>^-1 + P/2*<x-L>^-1',
			'V(x) = integrate(w, x)',
			'M(x) = integrate(V, x)'
		)
		for (const r of Object.values(s.results)) expect(r.error).toBeUndefined()
		const M = fn(s, 'M')
		expect(M(2)).toBeCloseTo((8 * 4) / 4)
		expect(M(1)).toBeCloseTo(4)
	})
})
