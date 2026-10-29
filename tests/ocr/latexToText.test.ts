import { describe, expect, it } from 'vitest'
import { latexToText } from '../../src/ocr/latexToText'
import { parseEquation } from '../../src/math/parse'

const cases: [string, string, string[]?][] = [
	['y = \\frac { 1 + x } { 2 }', 'y = (1 + x) / (2)'],
	['L = 6', 'L = 6'],
	['f ( x ) = \\sin ^ { 2 } ( x )', 'f(x) = sin(x)^2'],
	['f ( x ) = \\sin^{2} x', 'f(x) = sin(x)^2'],
	['M _ { m a x } = \\frac { q L ^ { 2 } } { 8 }', 'Mmax = (q * L^2) / (8)'],
	['\\int _ { 0 } ^ { 2 } x ^ { 2 } d x', 'integrate(x^2, x, 0, 2)'],
	['F ( x ) = \\int f d x', 'F(x) = integrate(f, x)'],
	['V = P \\left\\langle x - a \\right\\rangle ^ { 0 }', 'V = P < x - a >^0'],
	['y = 2 x + 3', 'y = 2 * x + 3'],
	['y = P ( x - a )', 'y = P * (x - a)'],
	['y = M ( 4 )', 'y = M(4)', ['M']],
	['R _ { A } = \\sqrt { 1 6 }', 'RA = sqrt(16)'],
	['y = 3 . 5 \\cdot \\pi', 'y = 3.5 * pi'],
]

const visual: [string, string][] = [
	['\\int_{0}^{1}x+5\\,\\mathrm{d}x', 'integrate(x + 5, x, 0, 1)'],
	['\\int_0^{\\infty}e^{-x}\\differentialD x', 'integrate(e^(-x), x, 0, Infinity)'],
	['\\sum_{k=1}^{10}k^2', 'sum(k^2, k, 1, 10)'],
	['\\prod_{k=1}^{5}k', 'prod(k, k, 1, 5)'],
	['\\lim_{x\\to0}\\frac{\\sin\\left(x\\right)}{x}', 'limit((sin(x)) / (x), x, 0)'],
	['g=\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left(x^3\\right)', 'g = diff(x^3, x)'],
	['\\frac{d^{2}}{dx^{2}}\\left(x^4\\right)', 'diff(x^4, x, 2)'],
	['\\frac{\\partial}{\\partial y}\\left(x^2y\\right)', 'diff(x^2 * y, y)'],
	['A=\\begin{bmatrix}1 & 2\\\\ 3 & 4\\end{bmatrix}', 'A = [1, 2; 3, 4]'],
	['B=A^{T}', 'B = transpose(A)'],
	['d=\\det\\left(A\\right)', 'd = det(A)'],
	['\\left|x-3\\right|', 'abs(x - 3)'],
	['b=??', 'b = ??'],
	['\\sqrt[3]{27}', 'nthRoot(27, 3)'],
	['\\int_{\\placeholder{}}^{\\placeholder{}}x\\,\\mathrm{d}x', 'integrate(x, x)'],
]

describe('latexToText from the visual editor', () => {
	for (const [tex, want] of visual) it(tex, () => expect(latexToText(tex)).toBe(want))
})

describe('latexToText', () => {
	for (const [tex, want, fns] of cases) {
		it(tex, () => {
			const got = latexToText(tex, fns)
			expect(got).toBe(want)
			expect(() => parseEquation(got)).not.toThrow()
		})
	}
})
