const { contextBridge, ipcRenderer } = require('electron');

console.log("[Preload] Preload script starting...");

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'electronAPI', {
    selectFiles: () => ipcRenderer.invoke('select-files'),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    openOutputFolder: (folderPath) => ipcRenderer.invoke('open-output-folder', folderPath),
    showNotification: (options) => ipcRenderer.invoke('show-notification', options),
    onSelectFilesRequest: (callback) => ipcRenderer.on('menu-select-images', callback),

    // Image Processing IPC
    startImageProcessing: (files) => ipcRenderer.invoke('start-image-processing', files),
    cancelImageProcessing: () => ipcRenderer.invoke('cancel-image-processing'),
    onImageProcessingProgress: (callback) => ipcRenderer.on('image-processing-progress', (event, ...args) => callback(...args)),
    onImageProcessingComplete: (callback) => ipcRenderer.on('image-processing-complete', (event, ...args) => callback(...args)),
  }
);

// Expose DevTools API
contextBridge.exposeInMainWorld(
  'electronDevTools', {
    openDevTools: () => ipcRenderer.invoke('open-dev-tools'),
  }
);

console.log("[Preload] Preload script completed, electronAPI exposed."); 