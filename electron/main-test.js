// Simple test to check if we're running in Electron
console.log('===== ELECTRON TEST =====');
console.log('process.type:', process.type);
console.log('process.versions.electron:', process.versions.electron);
console.log('process.versions.node:', process.versions.node);
console.log('process.versions.chrome:', process.versions.chrome);

const electron = require('electron');
console.log('typeof require("electron"):', typeof electron);

if (typeof electron === 'object' && electron.app) {
  console.log('✅ SUCCESS: Running in Electron context');
  console.log('electron.app:', !!electron.app);

  const { app, BrowserWindow } = electron;

  app.whenReady().then(() => {
    console.log('✅ App is ready');
    const win = new BrowserWindow({ width: 800, height: 600 });
    win.loadFile('index.html').catch(() => {
      win.loadURL('data:text/html,<h1>Electron Test Window</h1><p>If you see this, Electron is working!</p>');
    });
  });
} else {
  console.error('❌ FAIL: Not running in Electron context');
  console.error('electron value:', electron);
  process.exit(1);
}
