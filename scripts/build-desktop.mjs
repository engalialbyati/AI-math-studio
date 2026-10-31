// Prepares desktop/ for electron-builder: the built web app, the server bundled into one file,
// and the docs the MCP server reads. Run through `npm run desktop`.
import { execSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = new URL('..', import.meta.url)
const out = (p) => new URL(`desktop/${p}`, root)

if (!existsSync(new URL('public/models/pix2text-mfr/encoder_model.onnx', root)))
	console.warn('! public/models is missing: Ink → equation will not work in the app. Run `npm run models` first.')

execSync('npx vite build', { stdio: 'inherit', cwd: root })

for (const d of ['web', 'server', 'docs']) rmSync(out(d), { recursive: true, force: true })
cpSync(new URL('dist', root), out('web'), { recursive: true })
cpSync(new URL('docs/widget-api.md', root), out('docs/widget-api.md'))

await build({
	entryPoints: [fileURLToPath(new URL('server/index.ts', root))],
	outfile: fileURLToPath(out('server/server.mjs')),
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node22',
	// Optional native speed-ups of ws; it works without them.
	external: ['bufferutil', 'utf-8-validate'],
	// Bundled CommonJS packages (express) still call require().
	banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
	logLevel: 'info',
})
