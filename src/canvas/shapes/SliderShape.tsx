import {
	BaseBoxShapeUtil,
	HTMLContainer,
	T,
	useEditor,
	useIsEditing,
	type RecordProps,
	type TLShape,
} from 'tldraw'
import { formatNumber } from '../../math/scope'

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		slider: { w: number; h: number; name: string; value: number; min: number; max: number; step: number }
	}
}

export type SliderShape = TLShape<'slider'>

export class SliderShapeUtil extends BaseBoxShapeUtil<SliderShape> {
	static override type = 'slider' as const
	static override props: RecordProps<SliderShape> = {
		w: T.number,
		h: T.number,
		name: T.string,
		value: T.number,
		min: T.number,
		max: T.number,
		step: T.number,
	}

	getDefaultProps(): SliderShape['props'] {
		return { w: 240, h: 56, name: 'a', value: 1, min: 0, max: 10, step: 0.1 }
	}

	override canEdit() {
		return true
	}
	override hideRotateHandle() {
		return true
	}

	component(shape: SliderShape) {
		return <SliderView shape={shape} />
	}

	getIndicatorPath(shape: SliderShape) {
		const p = new Path2D()
		p.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return p
	}
}

function SliderView({ shape }: { shape: SliderShape }) {
	const editor = useEditor()
	const isEditing = useIsEditing(shape.id)
	const { name, value, min, max, step } = shape.props
	const update = (props: Partial<SliderShape['props']>) =>
		editor.updateShape({ id: shape.id, type: 'slider', props })
	const stop = (e: React.SyntheticEvent) => e.stopPropagation()

	return (
		<HTMLContainer className="ms-slider" style={{ pointerEvents: 'all' }}>
			{isEditing ? (
				<div className="ms-slider-edit" onPointerDown={stop} onKeyDown={stop}>
					<label>name <input value={name} size={4} onChange={(e) => update({ name: e.currentTarget.value.trim() })} /></label>
					<label>min <input type="number" value={min} onChange={(e) => update({ min: Number(e.currentTarget.value) })} /></label>
					<label>max <input type="number" value={max} onChange={(e) => update({ max: Number(e.currentTarget.value) })} /></label>
					<label>step <input type="number" value={step} onChange={(e) => update({ step: Number(e.currentTarget.value) || 0.01 })} /></label>
				</div>
			) : (
				<>
					<div className="ms-slider-label">
						<b>{name}</b> = {formatNumber(value)}
						<span className="ms-slider-range">[{min}, {max}]</span>
					</div>
					<input
						type="range"
						min={min}
						max={max}
						step={step}
						value={value}
						onPointerDown={stop}
						onChange={(e) => update({ value: Number(e.currentTarget.value) })}
					/>
				</>
			)}
		</HTMLContainer>
	)
}
