import { useEditor, useValue } from 'tldraw'
import { eraserSizeAtom, setEraserSize } from './tools/PartialEraserTool'

const PRESETS = [6, 10, 20, 40]

// While the eraser is active: a size bar above the toolbar and a circle showing what it covers.
export function EraserSize() {
	const editor = useEditor()
	const active = useValue('eraserActive', () => editor.getCurrentToolId() === 'eraser', [editor])
	const size = useValue('eraserSize', () => eraserSizeAtom.get(), [])
	const pointer = useValue('pointer', () => editor.inputs.getCurrentScreenPoint(), [editor])
	if (!active) return null
	const vsb = editor.getViewportScreenBounds()
	return (
		<>
			<div
				className="ms-eraser-ring"
				style={{ left: pointer.x - vsb.x - size, top: pointer.y - vsb.y - size, width: size * 2, height: size * 2 }}
			/>
			<div className="ms-eraser-size" onPointerDown={(e) => e.stopPropagation()}>
				<span>Eraser</span>
				{PRESETS.map((p) => (
					<button key={p} className={p === size ? 'on' : ''} onClick={() => setEraserSize(p)} title={`${p * 2}px`}>
						<span style={{ width: Math.max(4, p / 2), height: Math.max(4, p / 2) }} />
					</button>
				))}
				<input type="range" min={3} max={60} value={size} onChange={(e) => setEraserSize(Number(e.target.value))} />
			</div>
		</>
	)
}
