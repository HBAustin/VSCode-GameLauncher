'use strict';
// Only needed if your window uses contextIsolation (no nodeIntegration).
// Add `require('./glass-preload');` to your existing preload.js, or use this file as the preload.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('glassBridge', {
    get: () => ipcRenderer.invoke('glass:get'),
    set: (patch) => ipcRenderer.invoke('glass:set', patch),
});
