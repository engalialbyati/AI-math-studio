import { useEffect, useState } from 'react'
import {
	DefaultToolbar,
	DefaultToolbarContent,
	Tldraw,
	TldrawUiMenuItem,
	useIsToolSelected,
	useTools,
	type Editor,
	type TLComponents,
	type TLUiOverrides,
} from 'tldraw'
import 'tldraw/tldraw.css'
import 'katex/dist/katex.min.css'
import { AiOverlay } from './canvas/AiOverlay'
import { EquationShapeUtil } from './canvas/shapes/EquationShape'
import { SliderShapeUtil } from './canvas/shapes/SliderShape'
import { MathTextShapeUtil } from './canvas/shapes/MathTextShape'
import { WidgetShapeUtil } from './canvas/shapes/WidgetShape'
import { AiHelperTool, EquationTool, MathTextTool, SliderTool } from './canvas/tools/tools'
import { PartialEraserTool } from './canvas/tools/PartialEraserTool'
import { PagesBackground } from './canvas/PageLayout'
import { SymbolPalette } from './canvas/SymbolPalette'
import { TopBar } from './canvas/TopBar'
import { openDocument, saveDocument, startFileDrop } from './export/document'
import { convertInkToEquation } from './ocr/convert'
import { scopeAtom, startScopeEngine } from './state'
import { connectServer } from './sync/client'
import { isRemote } from './sync/pairing'
import './styles.css'

const shapeUtils = [EquationShapeUtil, SliderShapeUtil, WidgetShapeUtil, MathTextShapeUtil]
const tools = [EquationTool, SliderTool, AiHelperTool, MathTextTool, PartialEraserTool]

const overrides: TLUiOverrides = {
	tools(editor, tools) {
		tools.equation = {
			id: 'equation', icon: 'italic', label: 'Equation (Q)', kbd: 'q',
			onSelect: () => editor.setCurrentTool('equation'),
		}
		tools.text = {
			...tools.text,
			label: 'Math text (T)',
			onSelect: () => editor.setCurrentTool('mathtext'),
		}
		tools.slider = {
			id: 'slider', icon: 'toggle-on', label: 'Slider (J)', kbd: 'j',
			onSelect: () => editor.setCurrentTool('slider'),
		}
		tools['ai-helper'] = {
			id: 'ai-helper', icon: 'tool-screenshot', label: 'AI helper (I)', kbd: 'i',
			onSelect: () => editor.setCurrentTool('ai-helper'),
		}
		return tools
	},
	actions(editor, actions) {
		actions['ms-save'] = { id: 'ms-save', label: 'Save', kbd: '$s', onSelect: () => saveDocument(editor) }
		actions['ms-save-as'] = { id: 'ms-save-as', label: 'Save as', kbd: '$!s', onSelect: () => saveDocument(editor, true) }
		actions['ms-open'] = { id: 'ms-open', label: 'Open', kbd: '$o', onSelect: () => openDocument(editor) }
		actions['ink-to-equation'] = {
			id: 'ink-to-equation', label: 'Ink → equation', kbd: 'shift+e',
			onSelect: () => convertInkToEquation(editor),
		}
		return actions
	},
}

function Toolbar() {
	const t = useTools()
	const eq = useIsToolSelected(t.equation)
	const sl = useIsToolSelected(t.slider)
	const ai = useIsToolSelected(t['ai-helper'])
	return (
		<DefaultToolbar>
			<TldrawUiMenuItem {...t['ai-helper']} isSelected={ai} />
			<TldrawUiMenuItem {...t.equation} isSelected={eq} />
			<TldrawUiMenuItem {...t.slider} isSelected={sl} />
			<DefaultToolbarContent />
		</DefaultToolbar>
	)
}

const components: TLComponents = {
	Toolbar,
	TopPanel: () => (
		<div className="ms-top">
			<TopBar />
			<SymbolPalette />
		</div>
	),
	InFrontOfTheCanvas: AiOverlay,
	Background: PagesBackground,
	SharePanel: null,
}

export default function App() {
	const [editor, setEditor] = useState<Editor | null>(null)

	useEffect(() => {
		if (!editor) return
		;(window as any).editor = editor
		;(window as any).__ms = { scopeAtom }
		const stopScope = startScopeEngine(editor)
		const stopSync = connectServer(editor)
		const stopDrop = startFileDrop(editor)
		// The tablet is there to draw with the pen.
		if (isRemote) editor.setCurrentTool('draw')
		return () => {
			stopDrop()
			stopScope()
			stopSync()
		}
	}, [editor])

	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw
				persistenceKey={isRemote ? 'math-studio-tablet' : 'math-studio'}
				shapeUtils={shapeUtils}
				tools={tools}
				overrides={overrides}
				components={components}
				onMount={setEditor}
			/>
		</div>
	)
}
