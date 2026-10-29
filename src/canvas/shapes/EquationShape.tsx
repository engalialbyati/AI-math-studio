import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
	BaseBoxShapeUtil,
	HTMLContainer,
	T,
	useEditor,
	useIsEditing,
	useValue,
	type RecordProps,
	type TLShape,
} from 'tldraw'
import { parseEquation, parsedToTex } from '../../math/parse'
import { formatNumber } from '../../math/scope'
import { scopeAtom } from '../../state'
import { MathInput, visualStart } from '../MathInput'
import { Tex } from '../Tex'
import { mathStyleDefaults, mathStyleMigrations, mathStyleProps, useMathStyle, type MathStyleProps } from './mathStyle'

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		equation: { w: number; h: number; text: string } & MathStyleProps
	}
}

export type EquationShape = TLShape<'equation'>

export class EquationShapeUtil extends BaseBoxShapeUtil<EquationShape> {
	static override type = 'equation' as const
	static override props: RecordProps<EquationShape> = {
		w: T.number,
		h: T.number,
		text: T.string,
		...mathStyleProps,
	}
	static override migrations = mathStyleMigrations('equation')

	getDefaultProps(): EquationShape['props'] {
		return { w: 160, h: 44, text: '', ...mathStyleDefaults }
	}

	override canEdit() {
		return true
	}
	override canResize() {
		return false
	}
	override hideRotateHandle() {
		return true
	}

	override onEditEnd(shape: EquationShape) {
		if (!shape.props.text.trim()) this.editor.deleteShape(shape.id)
	}

	component(shape: EquationShape) {
		return <EquationView shape={shape} />
	}

	getIndicatorPath(shape: EquationShape) {
		const p = new Path2D()
		p.roundRect(0, 0, shape.props.w, shape.props.h, 6)
		return p
	}
}

function EquationView({ shape }: { shape: EquationShape }) {
	const editor = useEditor()
	const isEditing = useIsEditing(shape.id)
	const result = useValue('eq-result', () => scopeAtom.get().results[shape.id], [shape.id])
	const ref = useRef<HTMLDivElement>(null)
	const aiEdited = !!(shape.meta as any)?.aiEdited
	const look = useMathStyle(shape.props)
	// Visual editor (type into ∫ limits, fractions, matrices) or plain text; undefined = deciding.
	const [mode, setMode] = useState<'visual' | 'text'>()
	const [startLatex, setStartLatex] = useState<string | null>(null)
	const fns = () => Object.keys(scopeAtom.get().program.functions)
	const tryVisual = () => {
		let tex = scopeAtom.get().results[shape.id]?.tex
		if (!tex) {
			// Scope not recomputed yet (box just created): build the LaTeX directly.
			try {
				tex = parsedToTex(parseEquation(shape.props.text))
			} catch {}
		}
		const latex = visualStart(shape.props.text, tex, fns())
		setStartLatex(latex)
		setMode(latex === null ? 'text' : 'visual')
		return latex !== null
	}
	useEffect(() => {
		if (isEditing) tryVisual()
		else setMode(undefined)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isEditing])
	const finish = () => {
		editor.setEditingShape(null)
		editor.select(shape.id)
	}

	// Keep the shape's box in sync with its rendered content.
	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		const w = Math.ceil(el.offsetWidth)
		const h = Math.ceil(el.offsetHeight)
		// Culled (off-screen) shapes measure 0×0; keep the last real size.
		if (!w || !h) return
		if (Math.abs(w - shape.props.w) > 1 || Math.abs(h - shape.props.h) > 1) {
			editor.run(() => editor.updateShape({ id: shape.id, type: 'equation', props: { w, h } }), {
				history: 'ignore',
			})
		}
	})

	const setText = (text: string) =>
		editor.updateShape({ id: shape.id, type: 'equation', props: { text }, meta: { aiEdited: false } })

	return (
		<HTMLContainer style={{ pointerEvents: 'all' }}>
			<div ref={ref} style={look.style} className={`ms-eq ${look.className} ${isEditing ? 'editing' : ''} ${result?.kind === 'error' ? 'has-error' : ''}`}>
				{aiEdited && <span className="ms-ai-badge" title="Edited by AI">AI</span>}
				{isEditing && (
					<button
						className="ms-eq-mode"
						title={mode === 'visual' ? 'Switch to text editing' : 'Switch to visual editing'}
						onPointerDown={(e) => e.stopPropagation()}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => {
							if (mode === 'visual') setMode('text')
							else if (!tryVisual()) alert('This equation uses something the visual editor cannot show; keep editing it as text.')
						}}
					>
						{mode === 'visual' ? 'abc' : '∑'}
					</button>
				)}
				{isEditing && mode === undefined ? null : isEditing && mode === 'visual' ? (
					<MathInput latex={startLatex ?? ''} fns={fns()} onText={setText} onDone={finish} />
				) : isEditing ? (
					<input
						className="ms-eq-input ms-math-input"
						autoFocus
						spellCheck={false}
						value={shape.props.text}
						placeholder="y = (1+x)/2"
						size={Math.max(12, shape.props.text.length + 2)}
						onChange={(e) => setText(e.currentTarget.value)}
						onPointerDown={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							e.stopPropagation()
							if (e.key === 'Enter' || e.key === 'Escape') finish()
						}}
					/>
				) : !shape.props.text.trim() ? (
					<span className="ms-eq-placeholder">empty equation</span>
				) : result?.tex ? (
					<Tex tex={result.tex} />
				) : (
					<span className="ms-eq-raw">{shape.props.text}</span>
				)}
				{isEditing && result?.tex && <div className="ms-eq-preview"><Tex tex={result.tex} /></div>}
				<ResultLine id={shape.id} />
			</div>
		</HTMLContainer>
	)
}

function ResultLine({ id }: { id: string }) {
	const r = useValue('eq-line', () => scopeAtom.get().results[id], [id])
	if (!r) return null
	if (r.kind === 'error') return <div className="ms-eq-error">⚠ {r.error}</div>
	if (r.kind === 'solve') return <div className="ms-eq-result"><span className="ms-eq-value">{r.solution}</span></div>
	const parts: React.ReactNode[] = []
	if (r.resolvedTex) {
		parts.push(<Tex key="r" tex={`= ${r.resolvedTex}`} />)
	}
	if (r.kind === 'constant' && r.value !== undefined && !/^[^=]*=\s*-?[\d.]+\s*$/.test(r.text)) {
		parts.push(<span key="v" className="ms-eq-value">= {formatNumber(r.value)}</span>)
	}
	if (r.kind === 'function' && r.params?.length && !/^\s*\w+\s*\(/.test(r.text)) {
		parts.push(<span key="p" className="ms-eq-hint">function of {r.params.join(', ')}</span>)
	}
	if (r.numeric) parts.push(<span key="n" className="ms-eq-hint">numeric</span>)
	if (!parts.length) return null
	return <div className="ms-eq-result">{parts}</div>
}
