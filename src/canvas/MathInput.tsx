import { createElement, useEffect, useRef } from 'react'
import { MathfieldElement } from 'mathlive'
import { math, preprocess } from '../math/parse'
import { latexToText } from '../ocr/latexToText'

// Visual (WYSIWYG) equation editing with MathLive: type into the ∫ limits, fractions,
// exponents and matrix cells directly. The LaTeX is converted back to equation text.

MathfieldElement.fontsDirectory = '/mathlive/fonts'
MathfieldElement.soundsDirectory = null

function normalize(text: string): string[] | null {
	try {
		const src = preprocess(text.trim())
		const parts = src.split(/(?<![=<>!])=(?!=)/)
		return parts.map((p) => (p.trim() ? math.parse(p).toString({ implicit: 'show', parenthesis: 'auto' }).replace(/\s+/g, '') : ''))
	} catch {
		return null
	}
}

// LaTeX to open the visual editor with, or null when the equation would not survive the
// round trip (then the box opens in text mode and nothing is lost).
export function visualStart(text: string, tex: string | undefined, fns: string[]): string | null {
	if (!text.trim()) return ''
	if (!tex) return null
	const a = normalize(text)
	const b = normalize(latexToText(tex, fns))
	return a && b && a.join('=') === b.join('=') ? tex : null
}

interface Props {
	latex: string
	fns: string[]
	onText: (text: string) => void
	onDone: () => void
}

export function MathInput({ latex, fns, onText, onDone }: Props) {
	const ref = useRef<MathfieldElement>(null)
	const latest = useRef({ onText, onDone, fns })
	latest.current = { onText, onDone, fns }

	useEffect(() => {
		const mf = ref.current
		if (!mf) return
		mf.value = latex
		mf.mathVirtualKeyboardPolicy = 'manual'
		mf.smartFence = true
		mf.menuItems = []
		const onInput = () => latest.current.onText(latexToText(mf.value, latest.current.fns))
		const onKey = (e: KeyboardEvent) => {
			// Keep tldraw shortcuts out of the editor.
			e.stopPropagation()
			if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
				e.preventDefault()
				latest.current.onDone()
			}
		}
		mf.addEventListener('input', onInput)
		// Bubble phase: MathLive handles Tab, arrows etc. first, then tldraw never sees the key.
		mf.addEventListener('keydown', onKey)
		requestAnimationFrame(() => mf.focus())
		return () => {
			mf.removeEventListener('input', onInput)
			mf.removeEventListener('keydown', onKey)
		}
		// Only on mount: later changes come from the editor itself.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	// The wrapper keeps tldraw from taking pointer events (and focus) away from the field.
	return (
		<div onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
			{createElement('math-field', { ref, class: 'ms-mathfield ms-math-input' })}
		</div>
	)
}
