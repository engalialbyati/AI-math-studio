import { describe, expect, it } from 'vitest'
import { computeScope } from '../../src/math/scope'

const solve = (eqs: string[], query: string, sliders: { name: string; value: number }[] = []) => {
	const list = [...eqs, query].map((text, i) => ({ id: `e${i}`, text }))
	const r = computeScope(list, sliders.map((s, i) => ({ id: `s${i}`, ...s })))
	return r.results[`e${eqs.length}`]
}

describe('solve queries', () => {
	it('solves y = m*x + b for b', () => {
		const r = solve(['y = m*x + b'], 'm=1 , x=2, y=3, b?')
		expect(r.kind).toBe('solve')
		expect(r.solution).toBe('b = 1')
	})
	it('solves for a variable inside the body', () => {
		expect(solve(['y = m*x + b'], 'y=7, m=2, b=1, x?').solution).toBe('x = 3')
	})
	it('evaluates the defined name', () => {
		expect(solve(['y = m*x + b'], 'm=2, x=3, b=1, y?').solution).toBe('y = 7')
	})
	it('uses canvas constants and sliders', () => {
		expect(solve(['L = 8', 'Mmax = q*L^2/8'], 'Mmax=200, q?').solution).toBe('q = 25')
		expect(solve(['y = m*x + b'], 'y=10, x=2, b?', [{ name: 'm', value: 4 }]).solution).toBe('b = 2')
	})
	it('returns all real roots', () => {
		expect(solve(['A = s^2'], 'A=9, s?').solution).toBe('s = -3, 3')
	})
	it('solves relations and non-polynomials', () => {
		expect(solve(['x^2 + y^2 = 25'], 'x=3, y?').solution).toBe('y = -4, 4')
		const r = solve(['f = sin(t)'], 'f=0.5, t?')
		expect(r.value).toBeCloseTo(Math.PI / 6, 6)
	})
	it('reports missing values', () => {
		expect(solve(['y = m*x + b'], 'm=1, b?').error).toBe('Also need: y, x')
		expect(solve(['y = m*x'], 'k?').error).toContain('No equation')
	})
})
