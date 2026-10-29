import { describe, expect, it } from 'vitest'
import { computeScope } from '../../src/math/scope'

const run = (eqs: string[]) => {
	const r = computeScope(eqs.map((text, i) => ({ id: `e${i}`, text })))
	return { r, at: (i: number) => r.results[`e${i}`] }
}

describe('calculus operations', () => {
	it('limits, exact and at infinity', () => {
		const { at } = run(['a = limit(sin(x)/x, x, 0)', 'b = limit((1+1/n)^n, n, Infinity)'])
		expect(at(0).value).toBe(1)
		expect(at(1).value).toBeCloseTo(Math.E, 9)
	})
	it('finite sums and products, also as functions of the bound', () => {
		const { r, at } = run(['S = sum(k^2, k, 1, 10)', 'P = prod(k, k, 1, 5)', 'g(n) = sum(1/k^2, k, 1, n)'])
		expect(at(0).value).toBe(385)
		expect(at(1).value).toBe(120)
		expect(r.evaluate('g(3)').value).toBeCloseTo(1 + 1 / 4 + 1 / 9, 12)
	})
	it('Taylor polynomials', () => {
		const { r } = run(['T(x) = taylor(sin(x), x, 0, 5)'])
		expect(r.evaluate('T(0.5)').value).toBeCloseTo(0.5 - 0.5 ** 3 / 6 + 0.5 ** 5 / 120, 12)
	})
	it('higher and partial derivatives', () => {
		const { r } = run(['f(x) = x^3', 'h(x, y) = x^2*y', 'hy(x, y) = diff(h(x, y), y)', 'f2(x) = diff(f, x, 2)'])
		expect(r.evaluate('hy(3, 7)').value).toBe(9)
		expect(r.evaluate('f2(2)').value).toBe(12)
	})
	it('matrices', () => {
		const { at } = run(['A = [1, 2; 3, 4]', 'd = det(A)', 'B = inv(A)', 'C = A * B', 'q = d * 2', 'w = dot([1, 2, 3], [1, 2, 3])', 'k = 3', 'M = [k, 1; 0, k]'])
		expect(at(0).kind).toBe('matrix')
		expect(at(1).value).toBeCloseTo(-2, 12)
		expect(at(2).resolvedTex).toContain('1.5')
		expect(at(3).resolvedTex).toBe('\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}')
		expect(at(4).value).toBeCloseTo(-4, 12)
		expect(at(5).value).toBe(14)
		expect(at(7).resolvedTex).toContain('3 & 1')
	})
	it('typed symbols', () => {
		const { at } = run(['a = 2π', 'b = √(16) + 3²', 'c = 6 × 7 ÷ 2'])
		expect(at(0).value).toBeCloseTo(2 * Math.PI, 12)
		expect(at(1).value).toBe(13)
		expect(at(2).value).toBe(21)
	})
	it('infinite sums and integrals', () => {
		const { at } = run(['a = sum(1/k^2, k, 1, Infinity)', 'b = sum((-1)^(k+1)/k, k, 1, Infinity)', 'c = sum(1/k, k, 1, Infinity)', 'i = integrate(exp(-x^2), x, -Infinity, Infinity)'])
		expect(at(0).value).toBeCloseTo(Math.PI ** 2 / 6, 9)
		expect(at(1).value).toBeCloseTo(Math.LN2, 12)
		expect(at(2).value).toBeNaN()
		expect(at(3).value).toBeCloseTo(Math.sqrt(Math.PI), 7)
	})
	it('differential equations', () => {
		const { r } = run(["y(x) = dsolve(y'' + y = 0, y(0) = 1, y'(0) = 0)", 'k = 0.5', "u(t) = dsolve(u' = -k*u, u(0) = 10)"])
		expect(r.evaluate('y(1)').value).toBeCloseTo(Math.cos(1), 8)
		expect(r.evaluate('u(2)').value).toBeCloseTo(10 * Math.exp(-1), 8)
	})
	it('matrices inside functions', () => {
		const { r, at } = run(['A = [1, 2; 3, 4]', 'y(x) = det(A)*x', 'z = det(A)*x + trace(A)', 'bad(x) = A*x'])
		expect(r.evaluate('y(3)').value).toBeCloseTo(-6, 12)
		expect(r.evaluate('z(1)').value).toBeCloseTo(3, 12)
		expect(at(3).error).toContain('not supported')
	})
})
