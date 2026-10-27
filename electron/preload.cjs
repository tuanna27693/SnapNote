const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startCapture: () => ipcRenderer.invoke('start-capture'),
  getCaptureImage: () => ipcRenderer.invoke('get-capture-image'),
  cancelSelection: () => ipcRenderer.invoke('cancel-selection'),
  openEditor: (payload) => ipcRenderer.invoke('open-editor', payload),
  getEditPayload: () => ipcRenderer.invoke('get-edit-payload'),
  saveImage: (bytes, name) => ipcRenderer.invoke('save-image', bytes, name),
  copyImage: (bytes) => ipcRenderer.invoke('copy-image', bytes),
  getHotkey: () => ipcRenderer.invoke('get-hotkey'),
  setHotkey: (hotkey) => ipcRenderer.invoke('set-hotkey', hotkey),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, s) => cb(s)),
});
