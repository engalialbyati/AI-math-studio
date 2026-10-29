// Downloads the offline handwriting model (pix2text-mfr, MIT) into public/models.
// Run once after cloning: npm run models
import { mkdir, writeFile, stat } from 'node:fs/promises'

const REPO = 'https://huggingface.co/breezedeus/pix2text-mfr/resolve/main/'
const DIR = new URL('../public/models/pix2text-mfr/', import.meta.url)
const FILES = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'special_tokens_map.json', 'tokenizer.json', 'tokenizer_config.json', 'encoder_model.onnx', 'decoder_model.onnx']

await mkdir(DIR, { recursive: true })
for (const f of FILES) {
	const out = new URL(f, DIR)
	if (await stat(out).then((s) => s.size > 0, () => false)) {
		console.log('have', f)
		continue
	}
	process.stdout.write(`get  ${f} ... `)
	const res = await fetch(REPO + f)
	if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`)
	await writeFile(out, Buffer.from(await res.arrayBuffer()))
	console.log('ok')
}
