import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		// Reachable from a paired tablet on the same Wi-Fi (see "Connect tablet"). The tablet reaches
		// the local server through /ws here, so only this one port has to be open.
		host: true,
		proxy: {
			'/ws': { target: 'ws://127.0.0.1:3001', ws: true, headers: { 'x-math-studio-proxy': '1' } },
		},
	},
	test: { environment: 'node' },
} as any)
