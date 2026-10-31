// Math Studio desktop app: runs the local server (MCP + WebSocket + the built web app) inside
// Electron and shows the canvas in a window. Paired tablets reach the same server over Wi-Fi.
const { app, BrowserWindow, dialog, shell } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const PORT = 3001
const URL = `http://localhost:${PORT}/`

if (!app.requestSingleInstanceLock()) {
	app.quit()
} else {
	let win = null

	function createWindow() {
		win = new BrowserWindow({
			width: 1400,
			height: 900,
			title: 'Math Studio',
			autoHideMenuBar: true,
			webPreferences: { contextIsolation: true, sandbox: true },
		})
		// Links (docs, tldraw license) open in the normal browser.
		win.webContents.setWindowOpenHandler(({ url }) => {
			if (/^https?:/.test(url)) shell.openExternal(url)
			return { action: 'deny' }
		})
		win.loadURL(URL)
		win.on('closed', () => (win = null))
	}

	app.on('second-instance', () => {
		if (!win) return
		if (win.isMinimized()) win.restore()
		win.focus()
	})

	app.whenReady().then(async () => {
		process.env.MATH_STUDIO_STATIC = path.join(__dirname, 'web')
		process.env.MATH_STUDIO_ROOT = app.getPath('userData')
		const started = new Promise((resolve, reject) => {
			globalThis.__mathStudioHooks = { onServerReady: resolve, onServerError: reject }
		})
		try {
			await import(pathToFileURL(path.join(__dirname, 'server', 'server.mjs')).href)
			await started
		} catch (err) {
			const busy = err && err.code === 'EADDRINUSE'
			dialog.showErrorBox(
				'Math Studio could not start',
				busy
					? `Port ${PORT} is already in use. Close the other Math Studio (or "npm run dev") and try again.`
					: String(err && err.stack ? err.stack : err)
			)
			app.quit()
			return
		}
		createWindow()
	})

	app.on('window-all-closed', () => app.quit())
}
