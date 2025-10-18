// Working Electron main process using ES6 imports
const path = require('path');
const fs = require('fs');

// CRITICAL: Import electron FIRST, before any other requires
const electronModule = require('electron');
const { app, BrowserWindow } = electronModule;

// Check if electron loaded correctly
if (!app) {
  console.error('FATAL: Failed to load Electron. Exiting.');
  process.exit(1);
}

const logger = require('./utils/logger');

logger.info('[Main] Black Border Remover starting...');
logger.info('[Main] Electron version:', process.versions.electron);

// Lazy-load ImageBatch only after electron is ready
let imageQueue = null;

// Function to detect Vite dev server port
async function detectViteDevServerPort() {
  const http = require('http');
  logger.info('[Electron] Starting Vite dev server detection...');

  const portsToTry = [9000, 5173, 5174, 5175, 5176];

  for (const port of portsToTry) {
    logger.info(`[Electron] Checking port ${port}...`);
    try {
      const available = await new Promise((resolve) => {
        const req = http.get(`http://localhost:${port}`, (res) => {
          logger.info(`[Electron] Port ${port} response: ${res.statusCode}`);
          resolve(res.statusCode === 200);
          req.destroy();
        });

        req.on('error', (err) => {
          logger.info(`[Electron] Port ${port} error: ${err.message}`);
          resolve(false);
        });

        req.setTimeout(500, () => {
          logger.info(`[Electron] Port ${port} timeout`);
          req.destroy();
          resolve(false);
        });
      });

      if (available) {
        logger.info(`[Electron] ✅ Detected Vite dev server running on port ${port}`);
        return port;
      }
    } catch (err) {
      logger.info(`[Electron] Error checking port ${port}: ${err.message}`);
    }
  }

  logger.error('[Electron] ❌ Could not detect Vite dev server on any port!');
  return 9000;
}

async function createWindow() {
  logger.info('[Electron] Creating browser window...');

  const preloadPath = path.join(__dirname, 'preload.js');
  if (!fs.existsSync(preloadPath)) {
    logger.error(`[Electron] ❌ Preload script not found at: ${preloadPath}`);
  } else {
    logger.info(`[Electron] ✅ Preload script found at: ${preloadPath}`);
  }

  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on('did-finish-load', () => {
    logger.info('[Electron] ✅ Page finished loading');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    logger.error(`[Electron] ❌ Failed to load page: ${errorCode} - ${errorDescription}`);
  });

  let startUrl;
  if (process.env.NODE_ENV === 'development') {
    if (process.env.ELECTRON_DEV_URL) {
      startUrl = process.env.ELECTRON_DEV_URL;
      logger.info(`[Electron] Using dev URL from environment: ${startUrl}`);
    } else {
      const port = await detectViteDevServerPort();
      startUrl = `http://localhost:${port}`;
      logger.info(`[Electron] Using detected dev URL: ${startUrl}`);
    }
  } else {
    startUrl = `file://${path.join(__dirname, '../dist/index.html')}`;
    logger.info(`[Electron] Using production URL: ${startUrl}`);
  }

  try {
    logger.info(`[Electron] 🔄 Loading URL: ${startUrl}`);
    await mainWindow.loadURL(startUrl);
    logger.info('[Electron] ✅ URL loaded successfully');
  } catch (error) {
    logger.error('[Electron] ❌ Failed to load URL:', error.message);
  }

  if (process.env.NODE_ENV === 'development') {
    logger.info('[Electron] Opening DevTools...');
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow;

app.whenReady().then(async () => {
  logger.info('[Main] ✅ Electron app is ready');

  // NOW load ImageBatch after app is ready
  const { addToQueue, processQueue, getQueueStatus, cancelProcessing, clearQueue, validateQueue } = require('./processors/ImageBatch');
  imageQueue = { addToQueue, processQueue, getQueueStatus, cancelProcessing, clearQueue, validateQueue };

  mainWindow = await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
const { ipcMain, dialog, shell, Menu, Notification } = electronModule;
const os = require('os');

// ... (rest of the IPC handlers from the original main.js)
ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images & PDFs', extensions: ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'webp', 'pdf'] },
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'webp'] },
      { name: 'PDFs', extensions: ['pdf'] },
      { name: 'All Files', extensions: ['*'] }
    ],
  });

  if (result.canceled) {
    return [];
  }

  return result.filePaths.map(filePath => {
    const stats = fs.statSync(filePath);
    return {
      id: path.basename(filePath),
      name: path.basename(filePath),
      path: filePath,
      size: stats.size,
      type: getFileType(filePath),
      lastModified: Math.floor(stats.mtimeMs),
    };
  });
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('open-output-folder', async (event, folderPath) => {
  if (!folderPath) {
    folderPath = path.join(os.homedir(), 'Pictures', new Date().toISOString().split('T')[0] + '_processed');
  }

  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  shell.openPath(folderPath);
  return true;
});

ipcMain.handle('show-notification', (event, { title, body }) => {
  new Notification({ title, body }).show();
  return true;
});

ipcMain.handle('start-image-processing', async (event, filesToProcess, options = {}) => {
  logger.info(`[IPC] Received request to process ${filesToProcess.length} files`);

  if (!imageQueue) {
    logger.error('[IPC] ImageBatch not loaded yet');
    return { success: false, message: 'Image processor not ready' };
  }

  const { addToQueue, processQueue } = imageQueue;
  addToQueue(filesToProcess);

  const progressCallback = (progressUpdate) => {
    logger.info(`[IPC] Sending progress update: ${progressUpdate.done}/${progressUpdate.total}`);
    mainWindow.webContents.send('image-processing-progress', progressUpdate);
  };

  const completionCallback = (result) => {
    logger.info(`[IPC] Processing complete: ${result.processedFiles.length} processed, ${result.errors.length} errors`);
    const outputDir = result.processedFiles.length > 0
      ? path.dirname(result.processedFiles[0].processedPath)
      : null;
    mainWindow.webContents.send('image-processing-complete', { ...result, outputDir });
  };

  processQueue(progressCallback, completionCallback, options)
    .then(() => logger.info('[IPC] processQueue completed'))
    .catch(err => logger.error('[IPC] Error in processQueue:', err));

  return { success: true, message: 'Processing started.' };
});

ipcMain.handle('cancel-image-processing', async () => {
  logger.info('[IPC] Received request to cancel processing.');
  if (!imageQueue) {
    return { success: false, message: 'Image processor not ready' };
  }
  const { cancelProcessing } = imageQueue;
  const result = cancelProcessing();

  if (result.success) {
    mainWindow.webContents.send('image-processing-cancelled', result);
  }

  return result;
});

ipcMain.handle('show-notification', (event, { title, body }) => {
  new Notification({ title, body }).show();
  return true;
});

function getFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
  };
  return types[ext] || 'application/octet-stream';
}

logger.info('[Main] Black Border Remover main process initialized');
