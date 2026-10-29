// Offline handwritten-math recognizer: pix2text-mfr (TrOCR encoder/decoder, MIT)
// running in the browser with onnxruntime-web. Model files live in public/models.
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

const MODEL = '/models/pix2text-mfr'
const SIZE = 384
const START = 2 // decoder_start_token_id
const EOS = 2
const MAX_TOKENS = 200

ort.env.wasm.wasmPaths = { wasm: wasmUrl }

interface Model {
	encoder: ort.InferenceSession
	decoder: ort.InferenceSession
	vocab: string[]
}

let loading: Promise<Model> | null = null

export function loadRecognizer(): Promise<Model> {
	loading ??= (async () => {
		const [encoder, decoder, tok] = await Promise.all([
			ort.InferenceSession.create(`${MODEL}/encoder_model.onnx`),
			ort.InferenceSession.create(`${MODEL}/decoder_model.onnx`),
			fetch(`${MODEL}/tokenizer.json`).then((r) => r.json()),
		])
		const vocab: string[] = []
		for (const [t, id] of Object.entries(tok.model.vocab as Record<string, number>)) vocab[id] = t
		for (const t of tok.added_tokens ?? []) vocab[t.id] = t.content
		return { encoder, decoder, vocab }
	})()
	loading.catch(() => (loading = null))
	return loading
}

// White background, ink fitted (aspect kept) and centred, normalised to [-1, 1].
function toPixels(img: CanvasImageSource & { width: number; height: number }): Float32Array {
	const c = document.createElement('canvas')
	c.width = c.height = SIZE
	const g = c.getContext('2d')!
	g.fillStyle = '#fff'
	g.fillRect(0, 0, SIZE, SIZE)
	const pad = 16
	const s = Math.min((SIZE - 2 * pad) / img.width, (SIZE - 2 * pad) / img.height, 4)
	const w = img.width * s
	const h = img.height * s
	g.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h)
	const { data } = g.getImageData(0, 0, SIZE, SIZE)
	const out = new Float32Array(3 * SIZE * SIZE)
	for (let i = 0; i < SIZE * SIZE; i++) {
		// Grayscale so coloured ink reads like black pen.
		const v = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255
		const n = (v - 0.5) / 0.5
		out[i] = out[SIZE * SIZE + i] = out[2 * SIZE * SIZE + i] = n
	}
	return out
}

// GPT-2 byte-level BPE: map token characters back to bytes.
const byteDecoder = (() => {
	const bs: number[] = []
	for (let i = 33; i <= 126; i++) bs.push(i)
	for (let i = 161; i <= 172; i++) bs.push(i)
	for (let i = 174; i <= 255; i++) bs.push(i)
	const cs = [...bs]
	let n = 0
	for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++) }
	const m = new Map<string, number>()
	bs.forEach((b, i) => m.set(String.fromCharCode(cs[i]), b))
	return m
})()

function detokenize(vocab: string[], ids: number[]): string {
	const text = ids.map((id) => (id > 4 ? vocab[id] ?? '' : '')).join('')
	const bytes = Uint8Array.from([...text].map((ch) => byteDecoder.get(ch) ?? 63))
	return new TextDecoder().decode(bytes).trim()
}

export async function recognizeLatex(img: CanvasImageSource & { width: number; height: number }): Promise<string> {
	const { encoder, decoder, vocab } = await loadRecognizer()
	const pixel_values = new ort.Tensor('float32', toPixels(img), [1, 3, SIZE, SIZE])
	const { last_hidden_state } = await encoder.run({ pixel_values })
	const ids = [START]
	for (let step = 0; step < MAX_TOKENS; step++) {
		const input_ids = new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length])
		const { logits } = await decoder.run({ input_ids, encoder_hidden_states: last_hidden_state })
		const [, len, v] = logits.dims
		const row = (logits.data as Float32Array).subarray((len - 1) * v, len * v)
		let best = 0
		for (let k = 1; k < v; k++) if (row[k] > row[best]) best = k
		if (best === EOS) break
		ids.push(best)
	}
	return detokenize(vocab, ids.slice(1))
}
