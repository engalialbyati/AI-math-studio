import { describe, expect, it } from 'vitest'
import { blockNames, lineTex, solveTextBlock } from '../../src/math/textSolve'

describe('text worksheets', () => {
	it('solves the SMath example', () => {
		expect(solveTextBlock('y=mx+b\nm=1\nx=2\ny=3\nb=??')).toEqual([{ line: 4, text: '1' }])
	})
	it('accepts "b??" and any order', () => {
		expect(solveTextBlock('m=1\nb??\ny=mx+b\nx=2\ny=3')).toEqual([{ line: 1, text: '1' }])
	})
	it('ignores a plain "b=" or "b?"', () => {
		expect(solveTextBlock('y=mx+b\nm=1\nx=2\ny=3\nb=')).toEqual([])
		expect(solveTextBlock('y=mx+b\nm=1\nx=2\ny=3\nb?')).toEqual([])
	})
	it('keeps multi-letter names written alone', () => {
		expect(solveTextBlock('Mmax=qL^2/8\nL=8\nMmax=200\nq=??')[0].text).toBe('25')
	})
	it('solves relations and several queries', () => {
		const r = solveTextBlock('x^2+y^2=25\nx=3\ny=??\nr=2\nA=pi r^2\nA=??')
		expect(r[0].text).toBe('-4, 4')
		expect(Number(r[1].text)).toBeCloseTo(4 * Math.PI, 4)
	})
	it('reports missing values', () => {
		const r = solveTextBlock('y=mx+b\nm=1\nb=??')
		expect(r[0].error).toBe(true)
		expect(r[0].text).toContain('need')
	})
	it('uses other boxes on the page, own values first', () => {
		expect(solveTextBlock('b=??', 'y=mx+b\nm=1\nx=2\ny=3')).toEqual([{ line: 0, text: '1' }])
		expect(solveTextBlock('x=5\nb=??', 'y=mx+b\nm=1\nx=2\ny=3\nb=??')[0].text).toBe('-2')
	})
	it('renders lines as LaTeX', () => {
		const text = 'y=(1+x)/2\nb=??'
		const names = blockNames(text)
		expect(lineTex('y=(1+x)/2', names)).toBe('y = \\frac{\\left(1+ x\\right)}{2}')
		expect(lineTex('(1+x)/2', names)).toContain('\\frac')
		expect(lineTex('b=??', names)).toBe('b =')
		expect(lineTex('hello world', names)).toBeNull()
	})
})
