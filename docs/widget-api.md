# Math Studio widget API

A widget is a draggable box on the canvas that runs your HTML/JS in a sandboxed iframe.
Its values come live from the equations and sliders on the canvas: when the user edits
an equation or drags a slider, every widget re-renders.

## Code format

`code` is an HTML fragment placed in `<body>`. It can hold `<style>`, markup and `<script>`.
The page is `width × (height − 26)` px (26 px is the title bar). `html, body` already fill
the iframe with no margin. KaTeX is loaded from a CDN when online.

```html
<div id="plot" style="width:100%;height:100%"></div>
<script>
ms.onUpdate(({ C, fn }) => {
  const g = ms.graph('#plot', { x: [0, C.L], xLabel: 'x', yLabel: 'V(x)' })
  g.fn(fn.V, { color: '#2563eb', fill: true, label: 'V' })
  const { max } = ms.extrema(fn.V, 0, C.L)
  g.point([max.x, max.y], { label: 'max ' + ms.fmt(max.y) })
})
</script>
```

## The `ms` object

| Member | Meaning |
|---|---|
| `ms.onUpdate(cb)` | Register a render callback. Called with `ms` now (if scope is ready) and on every scope change or resize. Do all drawing in here. |
| `ms.C` | Numeric constants: `{ L: 6, q: 10, a: 2.5, ... }` (from `name = value` equations and sliders). |
| `ms.fn` | Compiled canvas functions: `ms.fn.V(x)`, `ms.fn.f(x, t)`. `ms.fn.V.params` lists parameter names. |
| `ms.get(name)` | Function or constant by name. |
| `ms.width`, `ms.height` | Iframe size in px. |
| `ms.sample(f, a, b, n=400)` | `[[x, f(x)], ...]` |
| `ms.extrema(f, a, b)` | `{ min: {x, y}, max: {x, y} }` |
| `ms.roots(f, a, b)` | Sign-change roots in `[a, b]`. |
| `ms.fmt(v, digits=4)` | Short number string. |
| `ms.tex(el, latex, display?)` | Render LaTeX into an element (selector or node). |
| `ms.svgEl(tag, attrs, parent?)` | Create an SVG element. |
| `ms.H` | Helpers: `mac(u, n)` Macaulay bracket, `step(u)`, `nint(f, a, b)` numeric integral. |

## `ms.graph(target, opts)` — 2D plot in data coordinates

`opts`: `x: [xmin, xmax]` (default `[-10, 10]`), `y: [ymin, ymax] | 'auto'` (default auto, includes 0),
`width`, `height` (default: target size), `padding: {l, r, t, b}`, `grid` (default true),
`axes` (default true), `xLabel`, `yLabel`, `includeZero` (default true).

Each call clears `target` and returns `g`. Items draw on the next microtask, in order:

| Method | |
|---|---|
| `g.fn(f, {color, width, dash, fill, fillOpacity, from, to, samples, label})` | Plot `y = f(x)`. `fill: true` shades to the x-axis (use for SFD/BMD-style diagrams). |
| `g.line([x1,y1], [x2,y2], {color, width, dash})` | Segment. |
| `g.arrow([x1,y1], [x2,y2], {color, width})` | Segment with arrow head at the end (forces, vectors). |
| `g.point([x,y], {r, color, label})` | Dot with optional label. |
| `g.text([x,y], str, {anchor, size, color, dx, dy, bold})` | Text. |
| `g.polygon(points, {fill, fillOpacity, color, width})` | Closed polygon. |
| `g.rect([x,y], w, h, {...polygon opts})` | Rectangle in data units. |
| `g.custom((svg, g) => { ... })` | Draw anything; `g.px([x,y])` maps data → pixels. |

After render: `g.svg` (the `<svg>`), `g.px`, `g.xRange`, `g.yRange`.

For figures that are not plots (beams, free-body diagrams, geometry, circuits), either use
`ms.graph` with `axes: false, grid: false` and fixed `y` range as a drawing canvas in data
units, or write raw SVG/canvas yourself. Several stacked graphs in one widget are fine
(e.g. a beam sketch on top, SFD and BMD below, sharing the same x range).

## Rules

- Never hard-code numbers that exist on the canvas. Read them from `ms.C` / `ms.fn`.
  If a value you need is missing, add an equation or slider first (`add_equation`, `add_slider`).
- Handle missing names gracefully: `if (!fn.V) { document.body.textContent = 'Define V(x)'; return }`.
- Interactive controls inside widgets are fine (they work after the user double-clicks the widget),
  but canvas sliders are preferred for parameters so other widgets share them.
- No network calls besides the CDN; the iframe has an opaque origin and no storage.
- After `create_widget` / `update_widget`, check the returned `error` and fix it.
