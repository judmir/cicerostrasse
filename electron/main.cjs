const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('node:path');

app.setName('Cicerostraße');
let window;

function createWindow() {
  window = new BrowserWindow({
    width: 1512,
    height: 982,
    minWidth: 900,
    minHeight: 650,
    title: 'Cicerostraße — Room journal',
    backgroundColor: '#15171b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  const developmentURL = process.env.ELECTRON_RENDERER_URL;
  if (developmentURL && /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(developmentURL)) {
    window.loadURL(developmentURL);
  } else {
    window.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  const [{ createRunner }, { readAIConfig }, { publicError }] = await Promise.all([
    import('../server/runner.js'), import('../server/config.js'), import('../server/restyle.js'),
  ]);
  const runner = createRunner({ getConfig: () => readAIConfig(path.join(__dirname, '..')) });
  require('./ai-ipc.cjs').registerAIHandlers({ ipcMain, runner, publicError, allowedSender: (sender) => sender === window?.webContents });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
