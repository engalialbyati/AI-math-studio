import {
	b64Vecs,
	createShapeId,
	getPointsFromDrawSegments,
	StateNode,
	Vec,
	type TLDrawShape,
	type TLShape,
	type VecModel,
} from 'tldraw'

// Eraser that removes only the part of a pen stroke it touches, splitting the stroke in two.
// Other drawings (shapes, arrows, notes, images) are erased whole, like tldraw's eraser;
// math shapes (equations, sliders, widgets, math text) are never erased by scrubbing.
const INK = new Set(['draw', 'highlight'])
const KEEP = new Set(['equation', 'slider', 'widget', 'mathtext'])
const RADIUS = 10 // screen pixels

export class PartialEraserTool extends StateNode {
	// Same id as tldraw's eraser so it replaces it everywhere: toolbar, E key, a stylus's eraser end.
	static override id = 'eraser'
	private last: Vec | null = null

	override onEnter() {
		this.editor.setCursor({ type: 'cross', rotation: 0 })
	}
	override onPointerDown() {
		this.editor.markHistoryStoppingPoint('erase')
		this.last = this.editor.inputs.getCurrentPagePoint().clone()
		this.eraseAt(this.last, this.last)
	}
	override onPointerMove() {
		if (!this.last) return
		const p = this.editor.inputs.getCurrentPagePoint().clone()
		this.eraseAt(this.last, p)
		this.last = p
	}
	override onPointerUp() {
		this.last = null
	}
	override onCancel() {
		this.last = null
		this.editor.setCurrentTool('select')
	}

	private eraseAt(from: Vec, to: Vec) {
		const editor = this.editor
		const r = RADIUS / editor.getZoomLevel()
		// Sample the eraser path so a fast swipe does not skip over thin strokes.
		const steps = Math.max(1, Math.ceil(Vec.Dist(from, to) / (r / 2)))
		const centers = Array.from({ length: steps + 1 }, (_, i) => Vec.Lrp(from, to, i / steps))
		const minX = Math.min(from.x, to.x) - r, maxX = Math.max(from.x, to.x) + r
		const minY = Math.min(from.y, to.y) - r, maxY = Math.max(from.y, to.y) + r

		for (const shape of editor.getCurrentPageShapes()) {
			if (KEEP.has(shape.type) || shape.isLocked) continue
			const b = editor.getShapePageBounds(shape)
			if (!b || b.maxX < minX || b.x > maxX || b.maxY < minY || b.y > maxY) continue
			if (INK.has(shape.type)) this.splitStroke(shape as TLDrawShape, centers, r)
			else if (centers.some((c) => editor.isPointInShape(shape, c, { margin: r, hitInside: false }))) editor.deleteShape(shape.id)
		}
	}

	private splitStroke(shape: TLDrawShape, pageCenters: Vec[], pageR: number) {
		const editor = this.editor
		const { scaleX, scaleY } = shape.props
		// Work in the shape's own space (rotation and position undone); r grows with stroke width.
		const centers = pageCenters.map((c) => editor.getPointInShapeSpace(shape, c))
		const stroke = Number((editor.getShapeUtil(shape) as any).getStrokeWidth?.(shape)) || 0
		const r = pageR + stroke / 2
		const pts = densify(getPointsFromDrawSegments(shape.props.segments, scaleX, scaleY), r / 2)
		const hit = (p: VecModel) => centers.some((c) => Vec.Dist(c, p) <= r)
		if (!pts.some(hit)) return

		const runs: VecModel[][] = []
		let run: VecModel[] = []
		for (const p of pts) {
			if (hit(p)) {
				if (run.length) runs.push(run)
				run = []
			} else run.push(p)
		}
		if (run.length) runs.push(run)

		const dim = shape.props.segments[0]?.dim
		editor.deleteShape(shape.id)
		editor.createShapes(
			runs
				.filter((run) => run.length > 1)
				.map((run) => ({
					...shape,
					id: createShapeId(),
					props: {
						...shape.props,
						isClosed: false,
						isComplete: true,
						segments: [
							{
								type: 'free' as const,
								path: b64Vecs.encodePoints(run.map((p) => ({ x: p.x / scaleX, y: p.y / scaleY, z: p.z })), dim),
								...(dim ? { dim } : {}),
							},
						],
					},
				})) as TLShape[]
		)
	}
}

// Adds points along long gaps (straight segments, fast strokes) so a cut can land between them.
function densify(points: VecModel[], spacing: number) {
	const out: VecModel[] = []
	for (let i = 0; i < points.length; i++) {
		const p = points[i]
		const prev = out.at(-1)
		if (prev) {
			const n = Math.floor(Vec.Dist(prev, p) / spacing)
			for (let k = 1; k < n; k++) {
				const t = k / n
				out.push({ x: prev.x + (p.x - prev.x) * t, y: prev.y + (p.y - prev.y) * t, z: (prev.z ?? 0.5) + ((p.z ?? 0.5) - (prev.z ?? 0.5)) * t })
			}
		}
		out.push(p)
	}
	return out
}
