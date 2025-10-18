const { contextBridge, ipcRenderer } = require('electron');

console.log("[Preload] ========================================");
console.log("[Preload] Preload script starting...");
console.log("[Preload] Node version:", process.version);
console.log("[Preload] Electron version:", process.versions.electron);
console.log("[Preload] Chrome version:", process.versions.chrome);
console.log("[Preload] ========================================");

try {
  // Expose protected methods that allow the renderer process to use
  // the ipcRenderer without exposing the entire object
  contextBridge.exposeInMainWorld(
    'electronAPI', {
      selectFiles: () => {
        console.log("[Preload] selectFiles() called");
        return ipcRenderer.invoke('select-files');
      },
      selectFolder: () => {
        console.log("[Preload] selectFolder() called");
        return ipcRenderer.invoke('select-folder');
      },
      openOutputFolder: (folderPath) => {
        console.log("[Preload] openOutputFolder() called with:", folderPath);
        return ipcRenderer.invoke('open-output-folder', folderPath);
      },
      showNotification: (options) => {
        console.log("[Preload] showNotification() called with:", options);
        return ipcRenderer.invoke('show-notification', options);
      },
      onSelectFilesRequest: (callback) => {
        console.log("[Preload] onSelectFilesRequest() listener registered");
        return ipcRenderer.on('menu-select-images', callback);
      },

      // Image Processing IPC
      startImageProcessing: (files, options) => {
        console.log("[Preload] startImageProcessing() called with", files.length, "files");
        return ipcRenderer.invoke('start-image-processing', files, options);
      },
      cancelImageProcessing: () => {
        console.log("[Preload] cancelImageProcessing() called");
        return ipcRenderer.invoke('cancel-image-processing');
      },
      onImageProcessingProgress: (callback) => {
        console.log("[Preload] onImageProcessingProgress() listener registered");
        return ipcRenderer.on('image-processing-progress', (event, ...args) => callback(...args));
      },
      onImageProcessingComplete: (callback) => {
        console.log("[Preload] onImageProcessingComplete() listener registered");
        return ipcRenderer.on('image-processing-complete', (event, ...args) => callback(...args));
      },
    }
  );

  console.log("[Preload] ✅ electronAPI exposed successfully");

  // Expose DevTools API
  contextBridge.exposeInMainWorld(
    'electronDevTools', {
      openDevTools: () => {
        console.log("[Preload] openDevTools() called");
        return ipcRenderer.invoke('open-dev-tools');
      },
    }
  );

  console.log("[Preload] ✅ electronDevTools exposed successfully");
  console.log("[Preload] ========================================");
  console.log("[Preload] ✅ Preload script completed successfully!");
  console.log("[Preload] ========================================");

} catch (error) {
  console.error("[Preload] ❌ ERROR in preload script:", error);
  console.error("[Preload] Stack:", error.stack);
  throw error;
} 