import { DefaultBackground, useEditor, useValue, type Editor } from 'tldraw'

// Each canvas page (tab) is either an endless drawing board or a document of paper pages
// stacked top to bottom like a word processor. The choice is stored in the page's meta, so it
// is saved with the document.

export type PaperSize = 'board' | 'A5' | 'A4' | 'A3' | 'Letter'
export interface PageLayout {
	size: PaperSize
	landscape: boolean
}

// Paper sizes in page units (CSS pixels at 96 dpi).
const PAPER: Record<Exclude<PaperSize, 'board'>, [number, number]> = {
	A5: [559, 794],
	A4: [794, 1123],
	A3: [1123, 1587],
	Letter: [816, 1056],
}
const GAP = 40

export function getLayout(editor: Editor): PageLayout {
	const meta = editor.getCurrentPage().meta as any
	return { size: meta?.paper ?? 'board', landscape: !!meta?.landscape }
}

export function setLayout(editor: Editor, layout: PageLayout) {
	const page = editor.getCurrentPage()
	editor.updatePage({ id: page.id, meta: { ...page.meta, paper: layout.size, landscape: layout.landscape } })
	if (layout.size !== 'board') {
		// Show the top of the first page, centred, as wide as fits (no larger than 100%).
		const [w] = paperSize(layout)
		const vw = editor.getViewportScreenBounds().w
		const z = Math.min(1, vw / (w + 2 * GAP))
		editor.setCamera({ x: (vw / z - w) / 2, y: 90 / z, z }, { animation: { duration: 200 } })
	}
}

export function paperSize(layout: PageLayout): [number, number] {
	if (layout.size === 'board') return [0, 0]
	const [w, h] = PAPER[layout.size]
	return layout.landscape ? [h, w] : [w, h]
}

// Paper sheets drawn behind the shapes. Always one empty sheet after the last one in use.
export function PagesBackground() {
	const editor = useEditor()
	const layout = useValue('layout', () => getLayout(editor), [editor])
	const cam = useValue('camera', () => editor.getCamera(), [editor])
	const bottom = useValue(
		'content-bottom',
		() => {
			const b = editor.getCurrentPageBounds()
			return b ? b.maxY : 0
		},
		[editor]
	)
	if (layout.size === 'board') return <DefaultBackground />
	const [w, h] = paperSize(layout)
	const used = Math.max(1, Math.ceil((bottom + 1) / (h + GAP)))
	const count = used + 1
	return (
		<div className="ms-desk">
			{Array.from({ length: count }, (_, i) => (
				<div
					key={i}
					className="ms-sheet"
					style={{
						left: (0 + cam.x) * cam.z,
						top: (i * (h + GAP) + cam.y) * cam.z,
						width: w * cam.z,
						height: h * cam.z,
					}}
				>
					<span className="ms-sheet-no">{i + 1}</span>
				</div>
			))}
		</div>
	)
}

export function LayoutPicker() {
	const editor = useEditor()
	const layout = useValue('layout', () => getLayout(editor), [editor])
	return (
		<span className="ms-layout">
			<select
				title="Page style: endless board, or paper pages one under another"
				value={layout.size}
				onChange={(e) => setLayout(editor, { ...layout, size: e.currentTarget.value as PaperSize })}
			>
				<option value="board">Board</option>
				<option value="A5">A5</option>
				<option value="A4">A4</option>
				<option value="A3">A3</option>
				<option value="Letter">Letter</option>
			</select>
			{layout.size !== 'board' && (
				<button
					title={layout.landscape ? 'Landscape (click for portrait)' : 'Portrait (click for landscape)'}
					onClick={() => setLayout(editor, { ...layout, landscape: !layout.landscape })}
				>
					{layout.landscape ? '▭' : '▯'}
				</button>
			)}
		</span>
	)
}
