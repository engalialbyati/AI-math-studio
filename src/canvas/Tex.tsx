import katex from 'katex'
import { useMemo } from 'react'

export function Tex({ tex, display = false, className }: { tex: string; display?: boolean; className?: string }) {
	const html = useMemo(() => {
		try {
			return katex.renderToString(tex, { throwOnError: false, displayMode: display })
		} catch {
			return tex
		}
	}, [tex, display])
	return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
