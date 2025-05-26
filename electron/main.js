const { app, BrowserWindow, dialog, ipcMain, shell, Menu, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { addToQueue, processQueue, getQueueStatus, cancelProcessing, clearQueue, validateQueue } = require('./processors/ImageBatch');
const logger = require('./utils/logger'); // Import logger

// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow;

// Function to detect Vite dev server port
async function detectViteDevServerPort() {
  // Try ports starting from 5173 (Vite default)
  logger.info('[Electron] Starting Vite dev server detection...');
  
  for (let port = 5173; port < 5200; port++) {
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
        
        req.setTimeout(300, () => {
          logger.info(`[Electron] Port ${port} timeout`);
          req.destroy();
          resolve(false);
        });
      });
      
      if (available) {
        logger.info(`[Electron] Detected Vite dev server running on port ${port}`);
        return port;
      }
    } catch (err) {
      logger.info(`[Electron] Error checking port ${port}: ${err.message}`);
      // continue to next port
    }
  }
  
  logger.warn('[Electron] Could not detect Vite dev server port, falling back to default 5173');
  return 5173; // Fallback to default Vite port
}

async function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
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
    logger.info('[Electron] Loading URL:', startUrl);
    await mainWindow.loadURL(startUrl);
    logger.info('[Electron] URL loaded successfully');
  } catch (error) {
    logger.error('[Electron] Failed to load URL:', error);
  }

  // Open DevTools in development mode
  if (process.env.NODE_ENV === 'development') {
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
ipcMain.handle('start-image-processing', async (event, filesToProcess) => {
  logger.info(`[IPC] Received request to process ${filesToProcess.length} files.`);
  addToQueue(filesToProcess);
  
  // Define how progress and completion are sent back to renderer
  const progressCallback = (progressUpdate) => {
    logger.info(`[IPC] Sending progress update: ${progressUpdate.done}/${progressUpdate.total} - ${progressUpdate.currentFile}`);
    mainWindow.webContents.send('image-processing-progress', progressUpdate);
  };
  
  const completionCallback = (result) => {
    logger.info(`[IPC] Sending processing completion: ${result.processedFiles.length} processed, ${result.errors.length} errors.`);
    // Determine output folder from first processed file
    let outputDir = null;
    if (result.processedFiles && result.processedFiles.length > 0) {
      const firstPath = result.processedFiles[0].processedPath;
      outputDir = path.dirname(firstPath);
    }
    mainWindow.webContents.send('image-processing-complete', { ...result, outputDir });
  };

  // Start processing the queue (don't wait for it here, it runs in background)
  processQueue(progressCallback, completionCallback)
    .then(() => logger.info('[IPC] processQueue promise resolved (indicates queue processing loop started or finished if empty).'))
    .catch(err => logger.error('[IPC] Error in processQueue execution chain:', err));

  return { success: true, message: 'Processing started.' };
});

// Handle cancelling image processing
ipcMain.handle('cancel-image-processing', async () => {
  logger.info('[IPC] Received request to cancel processing.');
  const result = cancelProcessing();
  
  if (result.success) {
    // Notify renderer of successful cancellation
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