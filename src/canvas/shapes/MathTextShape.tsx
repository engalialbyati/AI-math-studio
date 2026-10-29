import { useLayoutEffect, useMemo, useRef } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, T, useEditor, useIsEditing, useValue, type RecordProps, type TLShape } from 'tldraw'
import { blockNames, lineTex, solveTextBlock } from '../../math/textSolve'
import { Tex } from '../Tex'
import { mathStyleDefaults, mathStyleMigrations, mathStyleProps, useMathStyle, type MathStyleProps } from './mathStyle'

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		mathtext: { w: number; h: number; text: string } & MathStyleProps
	}
}

export type MathTextShape = TLShape<'mathtext'>

// Free text that reads like math: each line is shown as LaTeX, and lines like "b=" are
// solved from the other lines in the same box (SMath style).
export class MathTextShapeUtil extends BaseBoxShapeUtil<MathTextShape> {
	static override type = 'mathtext' as const
	static override props: RecordProps<MathTextShape> = { w: T.number, h: T.number, text: T.string, ...mathStyleProps }
	static override migrations = mathStyleMigrations('mathtext')

	getDefaultProps(): MathTextShape['props'] {
		return { w: 120, h: 40, text: '', ...mathStyleDefaults }
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
	override onEditEnd(shape: MathTextShape) {
		if (!shape.props.text.trim()) this.editor.deleteShape(shape.id)
	}
	component(shape: MathTextShape) {
		return <MathTextView shape={shape} />
	}
	getIndicatorPath(shape: MathTextShape) {
		const p = new Path2D()
		p.roundRect(0, 0, shape.props.w, shape.props.h, 6)
		return p
	}
}

function MathTextView({ shape }: { shape: MathTextShape }) {
	const editor = useEditor()
	const isEditing = useIsEditing(shape.id)
	const ref = useRef<HTMLDivElement>(null)
	const text = shape.props.text
	const look = useMathStyle(shape.props)
	// Text of the other boxes on the page (math text and plain tldraw text), top to bottom.
	const context = useValue(
		'mathtext-context',
		() =>
			editor
				.getCurrentPageShapes()
				.filter((s) => s.id !== shape.id && (s.type === 'mathtext' || s.type === 'text'))
				.sort((a, b) => a.y - b.y || a.x - b.x)
				.map((s) => (s.type === 'mathtext' ? (s as MathTextShape).props.text : editor.getShapeUtil(s).getText(s) ?? ''))
				.join('\n'),
		[editor, shape.id]
	)

	const lines = useMemo(() => {
		const names = blockNames(text)
		const answers = new Map(solveTextBlock(text, context).map((a) => [a.line, a]))
		return text.split(/\r?\n/).map((raw, i) => ({ raw, tex: lineTex(raw, names), answer: answers.get(i) }))
	}, [text, context])

	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		const w = Math.ceil(el.offsetWidth)
		const h = Math.ceil(el.offsetHeight)
		if (!w || !h) return
		if (Math.abs(w - shape.props.w) > 1 || Math.abs(h - shape.props.h) > 1) {
			editor.run(() => editor.updateShape({ id: shape.id, type: 'mathtext', props: { w, h } }), { history: 'ignore' })
		}
	})

	const setText = (t: string) => editor.updateShape({ id: shape.id, type: 'mathtext', props: { text: t } })

	return (
		<HTMLContainer style={{ pointerEvents: 'all' }}>
			<div ref={ref} style={look.style} className={`ms-mt ${look.className} ${isEditing ? 'editing' : ''}`}>
				{isEditing ? (
					<textarea
						className="ms-mt-input ms-math-input"
						autoFocus
						spellCheck={false}
						value={text}
						placeholder={'y=mx+b\nm=1\nx=2\ny=3\nb=??'}
						rows={Math.max(1, text.split('\n').length)}
						cols={Math.max(10, ...text.split('\n').map((l) => l.length + 2))}
						onChange={(e) => setText(e.currentTarget.value)}
						onPointerDown={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							e.stopPropagation()
							// Enter adds a line; Escape or Ctrl+Enter finishes.
							if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
								editor.setEditingShape(null)
								editor.select(shape.id)
							}
						}}
					/>
				) : (
					lines.map((l, i) => (
						<div key={i} className="ms-mt-line">
							{l.tex ? <Tex tex={l.tex} /> : <span className="ms-mt-plain">{l.raw || ' '}</span>}
							{l.answer && (
								<span className={l.answer.error ? 'ms-mt-error' : 'ms-mt-answer'}>
									{l.answer.error ? `⚠ ${l.answer.text}` : l.answer.text}
								</span>
							)}
						</div>
					))
				)}
				{isEditing && lines.some((l) => l.answer) && (
					<div className="ms-mt-preview">
						{lines.filter((l) => l.answer).map((l, i) => (
							<div key={i} className={l.answer!.error ? 'ms-mt-error' : undefined}>
								{l.answer!.error ? `⚠ ${l.answer!.text}` : `${l.raw.replace(/[=?\s]+$/, '')} = ${l.answer!.text}`}
							</div>
						))}
					</div>
				)}
			</div>
		</HTMLContainer>
	)
}
