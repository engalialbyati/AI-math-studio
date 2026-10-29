# Math Studio

A canvas for math: sketch figures, type equations in plain text, let the app do the calculus,
and let Claude (over MCP) turn a selected sketch into a live, draggable widget driven by your equations.

## Run

```bash
npm install
npm run models   # once: downloads the offline handwriting model (~118 MB) into public/models
npm run dev
```

Opens the app at http://localhost:5173 and the local server (WebSocket + MCP) at http://localhost:3001.

## Connect Claude

Claude Code:

```bash
claude mcp add --transport http math-studio http://localhost:3001/mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
"mcpServers": {
  "math-studio": { "command": "node", "args": ["D:/AI mac/Testing new ideas/Math studio/server/stdio-proxy.mjs"] }
}
```

Then tell Claude: **"serve Math Studio requests"**. It loops on `wait_for_ai_request` and answers
requests made with the AI helper on the canvas.

## Use

| Key | Tool |
|---|---|
| `Q` | Equation: click, type `y = (1+x)/2`, Enter |
| `J` | Slider bound to a constant |
| `I` | AI helper: drag a box, type an instruction |
| `D` | Pen (tldraw) |

Equations share one scope. Examples:

```
L = 6
q = 10
w(x) = -q
V(x) = integrate(w, x) + q*L/2
M(x) = integrate(V, x)
Mmax = M(L/2)
integrate(x^2, x, 0, 2)
g(x) = diff(sin(x)^2, x)
w2(x) = P*<x-a>^-1        (Macaulay brackets: point load)
```

Top bar: **Review all equations** (asks Claude to check and fix every equation), **Save / Open**
(`.mathstudio.json`), **Export HTML** (standalone page with live sliders and widgets).

## Layout

- `src/math/` — parser, symbolic calculus (own Macaulay rules + nerdamer, numeric fallback), scope, JS codegen
- `src/canvas/` — tldraw shapes (equation, slider, widget), tools, AI-helper overlay, top bar
- `src/widget/runtime.ts` — `ms` API inside widget iframes (see `docs/widget-api.md`)
- `src/sync/` — WebSocket client and the commands MCP tools run in the browser
- `server/` — Express + WebSocket + MCP server, stdio proxy for Claude Desktop
- `tests/math/` — `npm test`

## Notes

- tldraw needs a license key for production use; local/dev use is free (shows a "license" link).
- Widget iframes load KaTeX from jsDelivr; without internet, `ms.tex` falls back to plain text.
- Canvas screenshots sent to Claude cannot capture widget iframe contents (widgets appear blank there).
- `scratch/` holds dev helpers (`node scratch/mcp-call.mjs <tool> '<json>'` calls an MCP tool directly).
