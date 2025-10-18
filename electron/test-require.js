console.log('Step 1: require("electron")');
const electronModule = require('electron');
console.log('Step 2: typeof electronModule =', typeof electronModule);
console.log('Step 3: electronModule =', electronModule);

if (typeof electronModule === 'object' && electronModule.app) {
  console.log('✅ Success! electronModule.app is available');
  const { app } = electronModule;
  app.whenReady().then(() => {
    const { BrowserWindow } = electronModule;
    const win = new BrowserWindow({ width: 800, height: 600 });
    win.loadURL('data:text/html,<h1>SUCCESS</h1>');
  });
} else {
  console.error('❌ FAILED: electronModule does not have app property');
  console.error('This indicates Electron native modules are not loaded');
}
