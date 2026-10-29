import { atom, createShapeId, type Editor, type TLShapeId } from 'tldraw'
import { scopeAtom } from '../state'
import { latexToText } from './latexToText'
import { recognizeLatex } from './recognize'

export const convertStatusAtom = atom<{ busy: boolean; message?: string }>('convertStatus', { busy: false })

export function selectedInk(editor: Editor): TLShapeId[] {
	return editor.getSelectedShapes().filter((s) => s.type === 'draw').map((s) => s.id)
}

// Turn the selected handwritten strokes into a typed equation, fully offline.
export async function convertInkToEquation(editor: Editor) {
	const ids = selectedInk(editor)
	if (!ids.length || convertStatusAtom.get().busy) return
	const bounds = editor.getShapesPageBounds(ids)!
	convertStatusAtom.set({ busy: true, message: 'Reading handwriting…' })
	try {
		const scale = Math.min(2, 800 / Math.max(bounds.w, bounds.h, 1))
		const { blob } = await editor.toImage(ids, { format: 'png', background: true, padding: 12, scale, darkMode: false })
		const img = await createImageBitmap(blob)
		const latex = await recognizeLatex(img)
		const text = latexToText(latex, Object.keys(scopeAtom.get().program.functions))
		if (!text) throw new Error('Nothing recognized')
		const id = createShapeId()
		editor.markHistoryStoppingPoint('convert ink')
		editor.createShape({ id, type: 'equation', x: bounds.x, y: bounds.y, props: { text } })
		editor.deleteShapes(ids)
		editor.select(id)
		convertStatusAtom.set({ busy: false, message: `Recognized: ${latex}` })
	} catch (err) {
		console.error(err)
		convertStatusAtom.set({ busy: false, message: `Could not read: ${(err as Error).message}` })
	}
}
