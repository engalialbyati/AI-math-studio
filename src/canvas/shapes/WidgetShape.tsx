import { useEffect, useMemo, useRef, useState } from 'react'
import {
	atom,
	BaseBoxShapeUtil,
	HTMLContainer,
	T,
	useEditor,
	useIsEditing,
	useValue,
	type RecordProps,
	type TLShape,
} from 'tldraw'
import { scopeAtom } from '../../state'
import { buildSrcdoc } from '../../widget/runtime'

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		widget: { w: number; h: number; title: string; code: string }
	}
}

export type WidgetShape = TLShape<'widget'>

// Runtime errors reported by widget iframes, keyed by shape id (read by the MCP snapshot).
export const widgetErrorsAtom = atom<Record<string, string | undefined>>('widgetErrors', {})

const HEADER = 26

export class WidgetShapeUtil extends BaseBoxShapeUtil<WidgetShape> {
	static override type = 'widget' as const
	static override props: RecordProps<WidgetShape> = {
		w: T.number,
		h: T.number,
		title: T.string,
		code: T.string,
	}

	getDefaultProps(): WidgetShape['props'] {
		return { w: 420, h: 300, title: 'Widget', code: '<div id="plot" style="width:100%;height:100%"></div>' }
	}

	// Editing = interacting with the iframe (double-click). Otherwise the shape drags as a whole.
	override canEdit() {
		return true
	}
	override hideRotateHandle() {
		return true
	}

	component(shape: WidgetShape) {
		return <WidgetView shape={shape} />
	}

	getIndicatorPath(shape: WidgetShape) {
		const p = new Path2D()
		p.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return p
	}
}

function WidgetView({ shape }: { shape: WidgetShape }) {
	const editor = useEditor()
	const isEditing = useIsEditing(shape.id)
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const [showCode, setShowCode] = useState(false)
	const program = useValue('program', () => scopeAtom.get().program, [])
	const error = useValue('widget-error', () => widgetErrorsAtom.get()[shape.id], [shape.id])
	const srcdoc = useMemo(() => buildSrcdoc(shape.props.code), [shape.props.code])
	const [readyFor, setReadyFor] = useState('')
	const ready = readyFor === srcdoc
	const setReady = (v: boolean) => setReadyFor(v ? srcdoc : '')
	const aiEdited = !!(shape.meta as any)?.aiEdited

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			if (e.source !== iframeRef.current?.contentWindow || e.data?.source !== 'math-studio-widget') return
			if (e.data.type === 'ready') setReady(true)
			if (e.data.type === 'error' || e.data.type === 'ok') {
				const message = e.data.type === 'error' ? String(e.data.message) : undefined
				if (widgetErrorsAtom.get()[shape.id] !== message) {
					widgetErrorsAtom.update((m) => ({ ...m, [shape.id]: message }))
				}
			}
		}
		window.addEventListener('message', onMessage)
		return () => window.removeEventListener('message', onMessage)
	}, [srcdoc, shape.id])

	useEffect(() => {
		if (!ready) return
		iframeRef.current?.contentWindow?.postMessage({ source: 'math-studio-host', type: 'scope', program }, '*')
	}, [ready, program])

	const stop = (e: React.SyntheticEvent) => e.stopPropagation()

	return (
		<HTMLContainer className={`ms-widget ${isEditing ? 'interacting' : ''}`} style={{ pointerEvents: 'all' }}>
			<div className="ms-widget-header" style={{ height: HEADER }}>
				{aiEdited && <span className="ms-ai-badge">AI</span>}
				<span className="ms-widget-title">{shape.props.title}</span>
				{error && <span className="ms-widget-err" title={error}>⚠ error</span>}
				<span className="ms-widget-hint">{isEditing ? 'interacting — Esc to finish' : 'double-click to interact'}</span>
				<button
					className="ms-widget-btn"
					onPointerDown={stop}
					onClick={(e) => {
						stop(e)
						setShowCode((v) => !v)
					}}
				>
					{showCode ? 'view' : 'code'}
				</button>
			</div>
			{showCode ? (
				<textarea
					className="ms-widget-code"
					style={{ height: shape.props.h - HEADER }}
					value={shape.props.code}
					spellCheck={false}
					onPointerDown={stop}
					onKeyDown={stop}
					onWheel={stop}
					onChange={(e) =>
						editor.updateShape({ id: shape.id, type: 'widget', props: { code: e.currentTarget.value } })
					}
				/>
			) : (
				<iframe
					ref={iframeRef}
					title={shape.props.title}
					sandbox="allow-scripts"
					srcDoc={srcdoc}
					// load fires after the runtime's scripts ran, so the scope can be posted even
					// if the iframe's own 'ready' message raced the listener.
					onLoad={() => {
						setReady(true)
						iframeRef.current?.contentWindow?.postMessage(
							{ source: 'math-studio-host', type: 'scope', program: scopeAtom.get().program },
							'*'
						)
					}}
					style={{
						width: shape.props.w,
						height: shape.props.h - HEADER,
						border: 0,
						display: 'block',
						pointerEvents: isEditing ? 'all' : 'none',
					}}
				/>
			)}
		</HTMLContainer>
	)
}
