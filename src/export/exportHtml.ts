import katex from 'katex'
import { type Editor, type TLShape } from 'tldraw'
import { helpersSource } from '../math/helpers'
import { formatNumber } from '../math/scope'
import { scopeAtom } from '../state'
import { buildSrcdoc, KATEX_CSS } from '../widget/runtime'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function download(name: string, content: string, type: string) {
	const url = URL.createObjectURL(new Blob([content], { type }))
	const a = document.createElement('a')
	a.href = url
	a.download = name
	a.click()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Standalone page: sketches as SVG, equations as KaTeX, live sliders and widgets.
export async function exportHtml(editor: Editor, onlySelection = false) {
	const all = onlySelection && editor.getSelectedShapes().length ? editor.getSelectedShapes() : editor.getCurrentPageShapes()
	if (!all.length) return alert('Nothing to export')
	const custom = new Set(['equation', 'slider', 'widget'])
	const sketches = all.filter((s) => !custom.has(s.type))
	const bounds = editor.getShapesPageBounds(all.map((s) => s.id))!
	const ox = bounds.x - 24, oy = bounds.y - 24
	const { results, program } = scopeAtom.get()
	const pos = (s: TLShape) => {
		const b = editor.getShapePageBounds(s)!
		return `left:${b.x - ox}px;top:${b.y - oy}px;`
	}

	const parts: string[] = []
	if (sketches.length) {
		const sb = editor.getShapesPageBounds(sketches.map((s) => s.id))!
		const svg = await editor.getSvgString(sketches.map((s) => s.id), { background: false, padding: 0 })
		if (svg) parts.push(`<div class="sk" style="left:${sb.x - ox}px;top:${sb.y - oy}px">${svg.svg}</div>`)
	}
	for (const s of all as any[]) {
		if (s.type === 'equation') {
			const r = results[s.id]
			const tex = r?.tex ? katex.renderToString(r.tex, { throwOnError: false }) : esc(s.props.text)
			let extra = ''
			if (r?.resolvedTex) extra += katex.renderToString(`= ${r.resolvedTex}`, { throwOnError: false })
			if (r?.kind === 'constant' && r.name && !/^[^=]*=\s*-?[\d.]+\s*$/.test(s.props.text)) extra += ` <span class="val" data-const="${esc(r.name)}">= ${formatNumber(r.value!)}</span>`
			parts.push(`<div class="eq" style="${pos(s)}">${tex}${extra ? `<div class="res">${extra}</div>` : ''}</div>`)
		} else if (s.type === 'slider') {
			const p = s.props
			parts.push(`<div class="sl" style="${pos(s)}width:${p.w}px"><div><b>${esc(p.name)}</b> = <span data-const="${esc(p.name)}">${formatNumber(p.value)}</span></div>
<input type="range" data-slider="${esc(p.name)}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.value}"></div>`)
		} else if (s.type === 'widget') {
			parts.push(`<div class="wg" style="${pos(s)}width:${s.props.w}px;height:${s.props.h}px"><div class="wt">${esc(s.props.title)}</div>
<iframe sandbox="allow-scripts" style="width:${s.props.w}px;height:${s.props.h - 26}px" srcdoc="${esc(buildSrcdoc(s.props.code))}"></iframe></div>`)
		}
	}

	const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Math Studio export</title>
<link rel="stylesheet" href="${KATEX_CSS}">
<style>
body{margin:0;background:#fafaf9;font:14px system-ui,sans-serif;color:#111827}
.page{position:relative;width:${bounds.w + 48}px;height:${bounds.h + 48}px;margin:24px auto;background:#fff;box-shadow:0 1px 4px #0002}
.page>div{position:absolute}
.eq{font-size:17px;padding:6px 8px}.res{font-size:14px;color:#4b5563}.val{color:#7c3aed}
.sl{background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:6px 10px;box-sizing:border-box}.sl input{width:100%;accent-color:#7c3aed}
.wg{border:1px solid #d1d5db;border-radius:8px;overflow:hidden;background:#fff}.wt{height:26px;line-height:26px;padding:0 8px;font-size:12px;background:#f3f4f6;color:#374151}
.wg iframe{border:0;display:block}
</style></head><body><div class="page">
${parts.join('\n')}
</div>
<script>
const H = ${helpersSource};
const program = ${JSON.stringify(program)};
const C = program.constants;
const sliders = new Set(program.sliders);
function recompute(){
  for (const name of program.constOrder) {
    if (sliders.has(name)) continue;
    try { C[name] = new Function('C','H','return ' + program.constJs[name])(C, H) } catch (e) {}
  }
  document.querySelectorAll('[data-const]').forEach(el => {
    const v = C[el.dataset.const];
    if (v !== undefined) el.textContent = (el.classList.contains('val') ? '= ' : '') + Number(v.toPrecision(6));
  });
  const msg = { source: 'math-studio-host', type: 'scope', program: { ...program, constants: { ...C } } };
  document.querySelectorAll('iframe').forEach(f => f.contentWindow && f.contentWindow.postMessage(msg, '*'));
}
document.querySelectorAll('[data-slider]').forEach(el => el.addEventListener('input', () => { C[el.dataset.slider] = Number(el.value); recompute(); }));
window.addEventListener('message', e => { if (e.data && e.data.source === 'math-studio-widget' && e.data.type === 'ready') recompute(); });
</script></body></html>`
	download('math-studio.html', html, 'text/html')
}
