// Only the first-run setup page uses this: choose a server or this PC only.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mathStudioApp', {
	setup: (choice) => ipcRenderer.invoke('ms:setup', choice),
	settings: () => ipcRenderer.invoke('ms:settings'),
})
