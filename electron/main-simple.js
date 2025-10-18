// Simplest possible Electron main process
const { app, BrowserWindow } = require('electron');

console.log('app:', app);
console.log('BrowserWindow:', BrowserWindow);

if (!app) {
  console.error('ERROR: app is undefined!');
  process.exit(1);
}

app.whenReady().then(() => {
  console.log('App ready!');
  const win = new BrowserWindow({ width: 800, height: 600 });
  win.loadURL('data:text/html,<h1>Test</h1>');
});
