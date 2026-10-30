import { describe, expect, it } from 'vitest'
import { math, toTex } from '../../src/math/parse'

const tex = (s: string) => toTex(math.parse(s)).replace(/\s+/g, ' ').trim()

describe('multiplication in TeX', () => {
	it('writes a leading number next to its factor', () => {
		// TeX ignores spaces: "5 x" renders as 5x.
		expect(tex('5*x')).toBe('5 x')
		expect(tex('5x')).toBe('5 x')
		expect(tex('2*sin(x)')).not.toContain('cdot')
	})
	it('uses * for other products', () => {
		expect(tex('x*y')).toBe('x * y')
		expect(tex('2*3')).toBe('2 * 3')
	})
	it('never prints a dot', () => {
		for (const s of ['x^2/2 + 5*x', 'a*b*c', '(x+1)*(x-1)', '3*(x+1)']) expect(tex(s)).not.toContain('cdot')
	})
})
