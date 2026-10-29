// Numeric runtime helpers used by compiled equations.
// IMPORTANT: makeHelpers must stay self-contained (no imports, no outer references):
// its source is embedded into widget iframes and exported HTML via toString().

export interface Helpers {
	mac: (u: number, n: number) => number
	step: (u: number) => number
	nint: (f: (t: number) => number, a: number, b: number) => number
	fact: (n: number) => number
	mod: (a: number, b: number) => number
	log: (x: number, base?: number) => number
	nsum: (f: (k: number) => number, a: number, b: number) => number
	nprod: (f: (k: number) => number, a: number, b: number) => number
	nlim: (f: (t: number) => number, a: number) => number
	root: (x: number, n: number) => number
	ode: (F: (x: number, Y: number[]) => number, n: number, x0: number, Y0: number[], x: number) => number
}

export function makeHelpers(): Helpers {
	// Macaulay / singularity bracket <u>^n. n < 0 are impulses (zero almost everywhere).
	function mac(u: number, n: number): number {
		if (n < 0) return 0
		if (n === 0) return u >= 0 ? 1 : 0
		return u > 0 ? Math.pow(u, n) : 0
	}
	function step(u: number): number {
		return u >= 0 ? 1 : 0
	}
	// Composite Simpson integration of f from a to b.
	function nint(f: (t: number) => number, a: number, b: number): number {
		if (a === b) return 0
		if (a > b) return -nint(f, b, a)
		// Infinite bounds: split at 0 / a / b and map [c, ∞) onto (0, 1] with t = c + (1 - u) / u.
		if (a === -Infinity && b === Infinity) return nint(f, -Infinity, 0) + nint(f, 0, Infinity)
		if (b === Infinity) return tail((t) => f(t), a)
		if (a === -Infinity) return tail((t) => f(-t), -b)
		const n = 256
		const h = (b - a) / n
		let s = f(a) + f(b)
		for (let k = 1; k < n; k++) s += (k % 2 ? 4 : 2) * f(a + k * h)
		return (s * h) / 3
	}
	// ∫_c^∞ f(t) dt via t = c + L (1 - u) / u, midpoint rule (avoids u = 0). L follows the size of
	// c so far-out tails stay smooth. NaN when the integrand does not fall fast enough (divergent).
	function tail(f: (t: number) => number, c: number): number {
		const n = 4000
		const L = Math.max(1, Math.abs(c))
		const g = (u: number) => (L * f(c + (L * (1 - u)) / u)) / (u * u)
		let s = 0
		for (let k = 0; k < n; k++) {
			const v = g((k + 0.5) / n)
			if (Number.isFinite(v)) s += v
		}
		s /= n
		const u0 = 0.5 / n
		if (Math.abs(g(u0) * u0) > 1e-3 * Math.max(1e-12, Math.abs(s))) return NaN
		return s
	}
	function fact(n: number): number {
		let r = 1
		for (let k = 2; k <= n; k++) r *= k
		return r
	}
	function mod(a: number, b: number): number {
		return ((a % b) + b) % b
	}
	function log(x: number, base?: number): number {
		return base === undefined ? Math.log(x) : Math.log(x) / Math.log(base)
	}
	// Finite sum / product over integers k = a..b (capped so a typo cannot freeze the page).
	function nsum(f: (k: number) => number, a: number, b: number): number {
		if (b === Infinity) return infiniteSum(f, Math.round(a))
		let s = 0
		const end = Math.min(Math.round(b), Math.round(a) + 1e6)
		for (let k = Math.round(a); k <= end; k++) s += f(k)
		return s
	}
	// Σ_{k=a}^∞ f(k). Alternating series: repeated averaging of partial sums (Euler-style).
	// Otherwise: add terms until they are negligible, then an integral estimate of the rest.
	// Returns NaN when the terms do not go to zero (divergent).
	function infiniteSum(f: (k: number) => number, a: number): number {
		const first: number[] = []
		for (let k = a; k < a + 40; k++) first.push(f(k))
		const alternating = first.slice(10).every((t, i, arr) => i === 0 || Math.sign(t) === -Math.sign(arr[i - 1]) || t === 0)
		if (alternating) {
			let partial: number[] = []
			let s = 0
			for (let k = a; k < a + 60; k++) {
				s += f(k)
				partial.push(s)
			}
			while (partial.length > 1) partial = partial.slice(1).map((p, i) => (p + partial[i]) / 2)
			return partial[0]
		}
		let s = 0
		let k = a
		for (; k < a + 200000; k++) {
			const t = f(k)
			if (!Number.isFinite(t)) return NaN
			s += t
			if (k > a + 50 && Math.abs(t) < 1e-17 * Math.max(1, Math.abs(s))) return s
		}
		const last = Math.abs(f(k))
		if (last > 1e-6 * Math.max(1, Math.abs(s))) return NaN
		return s + tail(f, k + 0.5)
	}
	function nprod(f: (k: number) => number, a: number, b: number): number {
		let s = 1
		const end = Math.min(Math.round(b), Math.round(a) + 1e6)
		for (let k = Math.round(a); k <= end; k++) s *= f(k)
		return s
	}
	// Numeric limit: average of the two one-sided approaches (or large t for a = ±Infinity).
	function nlim(f: (t: number) => number, a: number): number {
		if (a === Infinity || a === -Infinity) {
			const s = a > 0 ? 1 : -1
			return f(s * 1e8)
		}
		const h = 1e-7 * Math.max(1, Math.abs(a))
		const l = f(a - h)
		const r = f(a + h)
		if (Number.isFinite(l) && Number.isFinite(r)) return Math.abs(l - r) < 1e-4 * Math.max(1, Math.abs(l)) ? (l + r) / 2 : NaN
		return Number.isFinite(l) ? l : r
	}
	// n-th order ODE y^(n) = F(x, [y, y', ..., y^(n-1)]) from x0 with Y0, integrated to x (RK4).
	function ode(F: (x: number, Y: number[]) => number, n: number, x0: number, Y0: number[], x: number): number {
		if (x === x0) return Y0[0]
		const steps = Math.min(20000, Math.max(50, Math.ceil(Math.abs(x - x0) / 0.005)))
		const h = (x - x0) / steps
		const d = (t: number, Y: number[]) => Y.map((_, i) => (i < n - 1 ? Y[i + 1] : F(t, Y)))
		let Y = Y0.slice()
		let t = x0
		for (let s = 0; s < steps; s++) {
			const k1 = d(t, Y)
			const k2 = d(t + h / 2, Y.map((v, i) => v + (h / 2) * k1[i]))
			const k3 = d(t + h / 2, Y.map((v, i) => v + (h / 2) * k2[i]))
			const k4 = d(t + h, Y.map((v, i) => v + h * k3[i]))
			Y = Y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))
			t += h
			if (!Number.isFinite(Y[0])) return NaN
		}
		return Y[0]
	}
	function root(x: number, n: number): number {
		return x < 0 && n % 2 === 1 ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n)
	}
	return { mac, step, nint, fact, mod, log, nsum, nprod, nlim, root, ode }
}

export const helpersSource = `(${makeHelpers.toString()})()`
