const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('restyleAI', {
  status: () => ipcRenderer.invoke('ai:status'),
  run: (input) => ipcRenderer.invoke('ai:restyle', input),
  cancel: (requestId) => ipcRenderer.send('ai:cancel', requestId),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('ai:progress', listener);
    return () => ipcRenderer.removeListener('ai:progress', listener);
  },
});
