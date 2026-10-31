import { useEffect, useState } from 'react'
import {
	DefaultStylePanel,
	DefaultToolbar,
	DefaultToolbarContent,
	Tldraw,
	TldrawUiMenuItem,
	useIsToolSelected,
	useTools,
	useValue,
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
import { EraserSize } from './canvas/EraserSize'
import { PagesBackground } from './canvas/PageLayout'
import { SymbolPalette } from './canvas/SymbolPalette'
import { TopBar } from './canvas/TopBar'
import { openDocument, saveDocument, startFileDrop } from './export/document'
import { convertInkToEquation } from './ocr/convert'
import { scopeAtom, startScopeEngine, stylesShownAtom } from './state'
import { connectServer, send } from './sync/client'
import { isRemote, remote } from './sync/pairing'
import { HomeMenu, LoginPage } from './hosted/HomeMenu'
import { homeOpenAtom, hostedAtom, loadHostedConfig, saveToServer, startAutosave } from './hosted/hosted'
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
		actions['ms-save'] = {
			id: 'ms-save', label: 'Save', kbd: '$s',
			onSelect: () => void (hostedAtom.get().hosted ? saveToServer() : saveDocument(editor)),
		}
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

function StylePanel() {
	const shown = useValue('stylesShown', () => stylesShownAtom.get(), [])
	return shown ? <DefaultStylePanel /> : null
}

const components: TLComponents = {
	StylePanel,
	Toolbar,
	TopPanel: () => (
		<div className="ms-top">
			<TopBar />
			<SymbolPalette />
		</div>
	),
	InFrontOfTheCanvas: () => (
		<>
			<AiOverlay />
			<EraserSize />
			<HomeMenu />
		</>
	),
	Background: PagesBackground,
	SharePanel: null,
}

export default function App() {
	const [ready, setReady] = useState(false)
	useEffect(() => {
		loadHostedConfig().then(() => setReady(true))
	}, [])
	const cfg = useValue('hosted', () => hostedAtom.get(), [])
	if (!ready) return null
	if (cfg.hosted && !cfg.user) return <LoginPage />
	return <Canvas persistenceKey={cfg.hosted ? `math-studio-${cfg.user!.id}` : isRemote ? 'math-studio-tablet' : 'math-studio'} />
}

function Canvas({ persistenceKey }: { persistenceKey: string }) {
	const [editor, setEditor] = useState<Editor | null>(null)

	useEffect(() => {
		if (!editor) return
		;(window as any).editor = editor
		;(window as any).__ms = { scopeAtom }
		const stopScope = startScopeEngine(editor)
		const stopSync = connectServer(editor)
		const stopDrop = startFileDrop(editor)
		// Hosted: the user's files live on the server; start at the file list.
		const stopAutosave = hostedAtom.get().hosted
			? startAutosave(editor, () => !remote(), (file) => send({ type: 'fileOpened', file }))
			: () => {}
		if (hostedAtom.get().hosted) homeOpenAtom.set(true)
		// The tablet is there to draw with the pen.
		if (isRemote) editor.setCurrentTool('draw')
		return () => {
			stopAutosave()
			stopDrop()
			stopScope()
			stopSync()
		}
	}, [editor])

	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw
				persistenceKey={persistenceKey}
				shapeUtils={shapeUtils}
				tools={tools}
				overrides={overrides}
				components={components}
				onMount={setEditor}
			/>
		</div>
	)
}
