import { useEditor, useValue } from 'tldraw'

// Buttons that insert math templates into the equation / math text being edited.
// "|" marks where the cursor lands.
const GROUPS: { name: string; items: [label: string, insert: string, title: string, latex?: string][] }[] = [
	{
		name: 'Calculus',
		items: [
			['∫', 'integrate(|, x)', 'Integral', '\\int #0\\,\\mathrm{d}x'],
			['∫ₐᵇ', 'integrate(|, x, 0, 1)', 'Definite integral', '\\int_{#?}^{#?}#0\\,\\mathrm{d}x'],
			['d/dx', 'diff(|, x)', 'Derivative', '\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left(#0\\right)'],
			['d²/dx²', 'diff(|, x, 2)', 'Second derivative', '\\frac{\\mathrm{d}^{2}}{\\mathrm{d}x^{2}}\\left(#0\\right)'],
			['∂/∂y', 'diff(|, y)', 'Partial derivative', '\\frac{\\partial}{\\partial y}\\left(#0\\right)'],
			['lim', 'limit(|, x, 0)', 'Limit', '\\lim_{x\\to#?}#0'],
			['Σ', 'sum(|, k, 1, n)', 'Sum', '\\sum_{k=#?}^{#?}#0'],
			['Π', 'prod(|, k, 1, n)', 'Product', '\\prod_{k=#?}^{#?}#0'],
			['Taylor', 'taylor(|, x, 0, 4)', 'Taylor polynomial', '\\operatorname{taylor}\\left(#0,x,0,4\\right)'],
			['ODE', "dsolve(y'' + y = 0, y(0) = 1, y'(0) = 0)|", 'Differential equation (text mode)'],
		],
	},
	{
		name: 'Algebra',
		items: [
			['√', 'sqrt(|)', 'Square root', '\\sqrt{#0}'],
			['ⁿ√', 'nthRoot(|, 3)', 'n-th root', '\\sqrt[#?]{#0}'],
			['xⁿ', '^(|)', 'Power', '#@^{#?}'],
			['a/b', '(|)/()', 'Fraction', '\\frac{#0}{#?}'],
			['|x|', 'abs(|)', 'Absolute value', '\\left|#0\\right|'],
			['n!', '|!', 'Factorial', '#@!'],
			['??', '=??', 'Solve for this name', '=??'],
			['⟨x−a⟩', '<x-|>^0', 'Macaulay bracket', '\\left\\langle x-#?\\right\\rangle^{0}'],
		],
	},
	{
		name: 'Functions',
		items: [
			['sin', 'sin(|)', 'Sine', '\\sin\\left(#0\\right)'],
			['cos', 'cos(|)', 'Cosine', '\\cos\\left(#0\\right)'],
			['tan', 'tan(|)', 'Tangent', '\\tan\\left(#0\\right)'],
			['ln', 'log(|)', 'Natural log', '\\ln\\left(#0\\right)'],
			['eˣ', 'exp(|)', 'Exponential', 'e^{#0}'],
		],
	},
	{
		name: 'Matrix',
		items: [
			['[ ]', '[|, 0; 0, 0]', '2×2 matrix (; starts a new row)', '\\begin{bmatrix}#0 & #? \\\\ #? & #?\\end{bmatrix}'],
			['det', 'det(|)', 'Determinant', '\\det\\left(#0\\right)'],
			['A⁻¹', 'inv(|)', 'Inverse', '#@^{-1}'],
			['Aᵀ', 'transpose(|)', 'Transpose', '#@^{T}'],
			['a·b', 'dot(|, )', 'Dot product', '\\operatorname{dot}\\left(#0,#?\\right)'],
		],
	},
	{
		name: 'Symbols',
		items: [
			['π', 'π|', 'pi', '\\pi'],
			['∞', '∞|', 'Infinity', '\\infty'],
			['θ', 'θ|', 'theta', '\\theta'],
			['α', 'α|', 'alpha', '\\alpha'],
			['β', 'β|', 'beta', '\\beta'],
			['λ', 'λ|', 'lambda', '\\lambda'],
			['ω', 'ω|', 'omega', '\\omega'],
			['Δ', 'Δ|', 'Delta', '\\Delta'],
		],
	},
]

function insert(template: string, latex?: string) {
	// Only the box being edited has a math field, so use it directly (focus sits inside it).
	const active = document.querySelector('math-field') as any
	if (active) {
		if (!latex) return alert('This one is typed in text mode: click "abc" on the equation first.')
		active.insert(latex, { selectionMode: 'placeholder', format: 'latex' })
		active.dispatchEvent(new Event('input', { bubbles: true }))
		active.focus()
		return
	}
	const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
	if (!el || !('selectionStart' in el) || !el.classList.contains('ms-math-input')) return
	const start = el.selectionStart ?? el.value.length
	const end = el.selectionEnd ?? start
	const selected = el.value.slice(start, end)
	// Wrap the selection: select "x^2", click ∫ -> integrate(x^2, x).
	const [before, after] = template.split('|')
	const text = before + selected + (after ?? '')
	const next = el.value.slice(0, start) + text + el.value.slice(end)
	// Set the value the React way so onChange fires.
	const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
	Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, next)
	el.dispatchEvent(new Event('input', { bubbles: true }))
	const caret = start + before.length + selected.length
	requestAnimationFrame(() => el.setSelectionRange(caret, caret))
}

export function SymbolPalette() {
	const editor = useEditor()
	const editing = useValue(
		'editing-math',
		() => {
			const s = editor.getEditingShape()
			return !!s && (s.type === 'equation' || s.type === 'mathtext')
		},
		[editor]
	)
	if (!editing) return null
	return (
		<div className="ms-palette" onPointerDown={(e) => e.stopPropagation()}>
			{GROUPS.map((g) => (
				<div key={g.name} className="ms-palette-group" title={g.name}>
					{g.items.map(([label, tpl, title, latex]) => (
						<button
							key={label}
							title={`${title}: ${tpl.replace('|', '…')}`}
							// Keep focus in the text field.
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => insert(tpl, latex)}
						>
							{label}
						</button>
					))}
				</div>
			))}
		</div>
	)
}
