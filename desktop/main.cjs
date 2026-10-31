// Math Studio desktop app. Two ways to run:
// - Server: opens your hosted Math Studio (sign in with email and password; files live there).
// - This PC only: runs the local server (MCP + WebSocket + web app) inside Electron, no sign-in;
//   paired tablets on the same Wi-Fi reach it directly.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const PORT = 3001
const LOCAL_URL = `http://localhost:${PORT}/`

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
function readSettings() {
	try {
		return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
	} catch {
		return {}
	}
}
function writeSettings(s) {
	fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
	fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2))
}

if (!app.requestSingleInstanceLock()) {
	app.quit()
} else {
	let win = null
	let localStarted = false
	const settings = () => readSettings()

	async function startLocal() {
		if (localStarted) return true
		process.env.MATH_STUDIO_STATIC = path.join(__dirname, 'web')
		process.env.MATH_STUDIO_ROOT = app.getPath('userData')
		const started = new Promise((resolve, reject) => {
			globalThis.__mathStudioHooks = { onServerReady: resolve, onServerError: reject }
		})
		try {
			await import(pathToFileURL(path.join(__dirname, 'server', 'server.mjs')).href)
			await started
			localStarted = true
			return true
		} catch (err) {
			const busy = err && err.code === 'EADDRINUSE'
			dialog.showErrorBox(
				'Math Studio could not start',
				busy
					? `Port ${PORT} is already in use. Close the other Math Studio (or "npm run dev") and try again.`
					: String(err && err.stack ? err.stack : err)
			)
			return false
		}
	}

	async function openMain() {
		const s = settings()
		if (!s.mode) return win.loadFile(path.join(__dirname, 'setup.html'))
		if (s.mode === 'server') return win.loadURL(new URL('app', s.serverUrl).href)
		if (await startLocal()) win.loadURL(LOCAL_URL)
		else app.quit()
	}

	function createWindow() {
		win = new BrowserWindow({
			width: 1400,
			height: 900,
			title: 'Math Studio',
			autoHideMenuBar: true,
			webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
		})
		// Links (docs, tldraw license) open in the normal browser.
		win.webContents.setWindowOpenHandler(({ url }) => {
			if (/^https?:/.test(url)) shell.openExternal(url)
			return { action: 'deny' }
		})
		win.on('closed', () => (win = null))
		openMain()
	}

	function changeServer() {
		writeSettings({ ...settings(), mode: undefined })
		win?.loadFile(path.join(__dirname, 'setup.html'))
	}

	// Only the local setup page may change settings, not pages loaded from a server.
	const fromSetup = (e) => (e.senderFrame?.url ?? '').startsWith('file:')
	ipcMain.handle('ms:setup', async (e, choice) => {
		if (!fromSetup(e)) return { error: 'Not allowed' }
		if (choice?.mode === 'server') {
			let url
			try {
				url = new URL(/^https?:\/\//.test(choice.serverUrl) ? choice.serverUrl : `https://${choice.serverUrl}`)
			} catch {
				return { error: 'That is not a web address.' }
			}
			writeSettings({ mode: 'server', serverUrl: url.origin + '/' })
		} else {
			writeSettings({ ...settings(), mode: 'local' })
		}
		openMain()
		return { ok: true }
	})
	ipcMain.handle('ms:settings', (e) => (fromSetup(e) ? settings() : {}))

	app.on('second-instance', () => {
		if (!win) return
		if (win.isMinimized()) win.restore()
		win.focus()
	})

	app.whenReady().then(() => {
		Menu.setApplicationMenu(
			Menu.buildFromTemplate([
				{
					label: 'Math Studio',
					submenu: [
						{ label: 'Change server…', click: changeServer },
						{ role: 'reload' },
						{ role: 'togglefullscreen' },
						{ type: 'separator' },
						{ role: 'quit' },
					],
				},
				{ role: 'editMenu' },
			])
		)
		createWindow()
	})

	app.on('window-all-closed', () => app.quit())
}
