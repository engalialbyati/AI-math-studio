import { createShapeId, StateNode, type TLPointerEventInfo } from 'tldraw'
import { aiSelectionAtom } from '../../state'

function startEditing(tool: StateNode, id: ReturnType<typeof createShapeId>) {
	const editor = tool.editor
	editor.setCurrentTool('select')
	editor.select(id)
	editor.setEditingShape(id)
	editor.setCurrentTool('select.editing_shape', { target: 'shape', shape: editor.getShape(id) })
}

export class EquationTool extends StateNode {
	static override id = 'equation'
	override onEnter() {
		this.editor.setCursor({ type: 'cross', rotation: 0 })
	}
	override onPointerDown() {
		const { x, y } = this.editor.inputs.getCurrentPagePoint()
		const id = createShapeId()
		this.editor.markHistoryStoppingPoint('create equation')
		this.editor.createShape({ id, type: 'equation', x, y: y - 20, props: { text: '' } })
		startEditing(this, id)
	}
	override onCancel() {
		this.editor.setCurrentTool('select')
	}
}

// Replaces the text tool: free text that renders as math and solves "b=" lines.
export class MathTextTool extends StateNode {
	static override id = 'mathtext'
	override onEnter() {
		this.editor.setCursor({ type: 'cross', rotation: 0 })
	}
	override onPointerDown() {
		const { x, y } = this.editor.inputs.getCurrentPagePoint()
		const id = createShapeId()
		this.editor.markHistoryStoppingPoint('create math text')
		this.editor.createShape({ id, type: 'mathtext', x, y: y - 16, props: { text: '' } })
		startEditing(this, id)
	}
	override onCancel() {
		this.editor.setCurrentTool('select')
	}
}

export class SliderTool extends StateNode {
	static override id = 'slider'
	override onEnter() {
		this.editor.setCursor({ type: 'cross', rotation: 0 })
	}
	override onPointerDown() {
		const { x, y } = this.editor.inputs.getCurrentPagePoint()
		const id = createShapeId()
		const used = new Set(
			this.editor.getCurrentPageShapes().filter((s) => s.type === 'slider').map((s: any) => s.props.name)
		)
		const name = ['a', 'b', 'c', 'k', 'm', 'n', 'p', 's'].find((n) => !used.has(n)) ?? `k${used.size}`
		this.editor.markHistoryStoppingPoint('create slider')
		this.editor.createShape({ id, type: 'slider', x, y: y - 28, props: { name } })
		this.editor.setCurrentTool('select')
		this.editor.select(id)
	}
	override onCancel() {
		this.editor.setCurrentTool('select')
	}
}

// Drag a box around sketches/equations, then type an instruction for the AI.
export class AiHelperTool extends StateNode {
	static override id = 'ai-helper'
	private origin: { x: number; y: number } | null = null

	override onEnter() {
		this.editor.setCursor({ type: 'cross', rotation: 0 })
		this.editor.selectNone()
	}
	override onPointerDown(_info: TLPointerEventInfo) {
		const p = this.editor.inputs.getCurrentPagePoint()
		this.origin = { x: p.x, y: p.y }
		aiSelectionAtom.set({ region: { x: p.x, y: p.y, w: 0, h: 0 }, stage: 'dragging' })
	}
	override onPointerMove() {
		if (!this.origin) return
		const p = this.editor.inputs.getCurrentPagePoint()
		aiSelectionAtom.set({
			stage: 'dragging',
			region: {
				x: Math.min(p.x, this.origin.x),
				y: Math.min(p.y, this.origin.y),
				w: Math.abs(p.x - this.origin.x),
				h: Math.abs(p.y - this.origin.y),
			},
		})
	}
	override onPointerUp() {
		const sel = aiSelectionAtom.get()
		this.origin = null
		if (!sel || sel.region.w * this.editor.getZoomLevel() < 12 || sel.region.h * this.editor.getZoomLevel() < 12) {
			aiSelectionAtom.set(null)
			return
		}
		aiSelectionAtom.set({ ...sel, stage: 'prompt' })
		this.editor.setCurrentTool('select')
	}
	override onCancel() {
		this.origin = null
		aiSelectionAtom.set(null)
		this.editor.setCurrentTool('select')
	}
}
