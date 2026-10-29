import type { CSSProperties } from 'react'
import {
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
	DefaultColorStyle,
	DefaultFontFamilies,
	DefaultFontStyle,
	DefaultSizeStyle,
	getColorValue,
	useEditor,
	useValue,
	type TLDefaultColorStyle,
	type TLDefaultFontStyle,
	type TLDefaultSizeStyle,
} from 'tldraw'

// Font, size and colour from tldraw's style panel, shared by equation and math text boxes.
export interface MathStyleProps {
	font: TLDefaultFontStyle
	size: TLDefaultSizeStyle
	color: TLDefaultColorStyle
}

export const mathStyleProps = { font: DefaultFontStyle, size: DefaultSizeStyle, color: DefaultColorStyle }
export const mathStyleDefaults: MathStyleProps = { font: 'draw', size: 'm', color: 'black' }

const FONT_SIZE: Record<TLDefaultSizeStyle, number> = { s: 18, m: 24, l: 32, xl: 44 }

// Boxes saved before these props existed get the defaults.
export function mathStyleMigrations(type: string) {
	const ids = createShapePropsMigrationIds(type, { AddStyles: 1 })
	return createShapePropsMigrationSequence({
		sequence: [
			{
				id: ids.AddStyles,
				up(props: any) {
					Object.assign(props, { ...mathStyleDefaults, ...props })
				},
				down(props: any) {
					delete props.font
					delete props.size
					delete props.color
				},
			},
		],
	})
}

export function useMathStyle(props: MathStyleProps): { className: string; style: CSSProperties } {
	const editor = useEditor()
	const color = useValue(
		'math-color',
		() => getColorValue(editor.getCurrentTheme().colors[editor.getColorMode()], props.color, 'solid'),
		[editor, props.color]
	)
	return {
		className: `ms-font-${props.font}`,
		style: { fontFamily: DefaultFontFamilies[props.font], fontSize: FONT_SIZE[props.size], color },
	}
}
