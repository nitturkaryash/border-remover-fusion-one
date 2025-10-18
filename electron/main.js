const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const logger = require('./utils/logger');

logger.info('[Main] ========================================');
logger.info('[Main] Black Border Remover Initializing');
logger.info('[Main] ========================================');

// Dynamic require to handle Electron loading issues
let electronModule;
try {
  electronModule = require('electron');

  if (typeof electronModule === 'string') {
    logger.warn('[Main] ⚠️ Got Electron binary path instead of API');
    logger.warn('[Main] Attempting to load using fallback methods...');

    try {
      delete require.cache[require.resolve('electron')];
      electronModule = process.binding('electron');

      if (!electronModule || !electronModule.app) {
        throw new Error('Native binding failed');
      }
      logger.info('[Main] ✅ Loaded Electron via native binding');
    } catch (nativeError) {
      logger.error('[Main] ❌ Native binding failed');
      throw new Error('Could not load Electron API');
    }
  }

  if (!electronModule.app) {
    throw new Error('Electron module does not have app property');
  }
} catch (error) {
  logger.error('[Main] ❌ FATAL: Could not load Electron:', error.message);
  process.exit(1);
}

const { app, BrowserWindow, dialog, ipcMain, shell, Menu, Notification } = electronModule;

logger.info('[Main] ✅ Electron module loaded');
logger.info('[Main] Electron version:', process.versions.electron);
logger.info('[Main] Node version:', process.versions.node);

let imageBatchModule = null;

// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow;

// Function to detect Vite dev server port
async function detectViteDevServerPort() {
  // Try ports starting from 9000 (our configured port), then fallback to 5173
  logger.info('[Electron] Starting Vite dev server detection...');

  const portsToTry = [9000, 5173, 5174, 5175, 5176]; // Try configured port first

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
      // continue to next port
    }
  }

  logger.error('[Electron] ❌ Could not detect Vite dev server on any port! Please ensure Vite is running.');
  logger.error('[Electron] Expected ports: 9000 (configured) or 5173 (Vite default)');
  logger.error('[Electron] Falling back to port 9000, but the app may not load correctly.');
  return 9000; // Fallback to configured port
}

async function createWindow() {
  logger.info('[Electron] Creating browser window...');

  // Verify preload script exists
  const preloadPath = path.join(__dirname, 'preload.js');
  if (!fs.existsSync(preloadPath)) {
    logger.error(`[Electron] ❌ Preload script not found at: ${preloadPath}`);
    logger.error('[Electron] This will cause window.electronAPI to be undefined!');
  } else {
    logger.info(`[Electron] ✅ Preload script found at: ${preloadPath}`);
  }

  // Create the browser window
  mainWindow = new BrowserWindow({
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

  // Log when preload script completes
  mainWindow.webContents.on('did-finish-load', () => {
    logger.info('[Electron] ✅ Page finished loading');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    logger.error(`[Electron] ❌ Failed to load page: ${errorCode} - ${errorDescription}`);
  });

  // For testing purposes, load the local HTML file first
  // When debugged, you can switch back to the normal behavior
  const testMode = false; // Set to false to use normal Vite dev server or production build

  let startUrl;
  if (testMode) {
    startUrl = `file://${path.join(__dirname, 'test.html')}`;
    logger.info('[Electron] Running in test mode, loading:', startUrl);
  } else if (process.env.NODE_ENV === 'development') {
    // Use fixed URL from environment variable if available
    if (process.env.ELECTRON_DEV_URL) {
      startUrl = process.env.ELECTRON_DEV_URL;
      logger.info(`[Electron] Using dev URL from environment: ${startUrl}`);
    } else {
      // Fallback to dynamic detection
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
    logger.error('[Electron] Stack:', error.stack);

    // Show error dialog to user
    dialog.showErrorBox(
      'Failed to Load Application',
      `Could not load ${startUrl}\n\nError: ${error.message}\n\nPlease ensure the Vite dev server is running on port 9000.`
    );
  }

  // Open DevTools in development mode
  if (process.env.NODE_ENV === 'development') {
    logger.info('[Electron] Opening DevTools...');
    mainWindow.webContents.openDevTools();
  }

  // Create default menu
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'Select Images',
          click: () => mainWindow.webContents.send('menu-select-images'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://github.com/yourusername/black-border-remover');
          },
        },
      ],
    },
  ]);
  
  Menu.setApplicationMenu(menu);
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  logger.info('[Main] ✅ Electron app ready event fired');

  // Load ImageBatch module after app is ready (lazy-loading)
  try {
    imageBatchModule = require('./processors/ImageBatch');
    logger.info('[Main] ✅ ImageBatch module loaded');
  } catch (error) {
    logger.error('[Main] ❌ Failed to load ImageBatch:', error.message);
  }

  await createWindow();

  app.on('activate', async () => {
    // On macOS re-create a window when the dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers

// Handle file selection
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

  // Process files before returning them
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

// Handle folder selection
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});

// Handle opening the output folder
ipcMain.handle('open-output-folder', async (event, folderPath) => {
  if (!folderPath) {
    // If no specific folder provided, open default location
    folderPath = getDefaultOutputFolder();
  }
  
  // Create the folder if it doesn't exist
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  
  shell.openPath(folderPath);
  return true;
});

// Handle showing a notification
ipcMain.handle('show-notification', (event, { title, body }) => {
  new Notification({ title, body }).show();
  return true;
});

// Handle starting image processing
ipcMain.handle('start-image-processing', async (event, filesToProcess, options = {}) => {
  logger.info(`[IPC] Received request to process ${filesToProcess.length} files`);

  if (!imageBatchModule) {
    logger.error('[IPC] ImageBatch module not loaded');
    return { success: false, message: 'Image processor not initialized' };
  }

  const { addToQueue, processQueue } = imageBatchModule;
  addToQueue(filesToProcess);

  const progressCallback = (progressUpdate) => {
    mainWindow.webContents.send('image-processing-progress', progressUpdate);
  };

  const completionCallback = (result) => {
    let outputDir = null;
    if (result.processedFiles && result.processedFiles.length > 0) {
      const firstPath = result.processedFiles[0].processedPath;
      outputDir = path.dirname(firstPath);
    }
    mainWindow.webContents.send('image-processing-complete', { ...result, outputDir });
  };

  processQueue(progressCallback, completionCallback, options)
    .catch(err => logger.error('[IPC] processQueue error:', err));

  return { success: true, message: 'Processing started.' };
});

// Handle cancelling image processing
ipcMain.handle('cancel-image-processing', async () => {
  logger.info('[IPC] Received request to cancel processing.');

  if (!imageBatchModule) {
    return { success: false, message: 'Image processor not loaded' };
  }

  const result = imageBatchModule.cancelProcessing();

  if (result.success) {
    mainWindow.webContents.send('image-processing-cancelled', result);
  }

  return result;
});

// Handle opening DevTools
ipcMain.handle('open-dev-tools', () => {
  if (mainWindow) {
    mainWindow.webContents.openDevTools();
    return true;
  }
  return false;
});

// Handle getting queue status
ipcMain.handle('get-queue-status', async () => {
  logger.info('[IPC] Received request for queue status.');
  return getQueueStatus();
});

// Handle clearing the processing queue
ipcMain.handle('clear-queue', async () => {
  logger.info('[IPC] Received request to clear queue.');
  return clearQueue();
});

// Handle validating files in queue
ipcMain.handle('validate-queue', async () => {
  logger.info('[IPC] Received request to validate queue.');
  return await validateQueue();
});

// Handle updating processing options
ipcMain.handle('update-processing-options', async (event, options) => {
  logger.info('[IPC] Received processing options update:', options);
  // Store options for next processing run
  // These will be passed to processQueue when processing starts
  return { success: true, message: 'Processing options updated', options };
});

// Helper function to get the file type based on extension
function getFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

// Helper function to get the default output folder
function getDefaultOutputFolder() {
  const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(os.homedir(), 'Pictures', `${dateStr}_processed`);
} 
