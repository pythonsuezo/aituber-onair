const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jikkyoTcp', {
  updateConfig: (config) => ipcRenderer.invoke('jikkyo:updateConfig', config),
  onMessage: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on('jikkyo:message', wrapped);
    return () => ipcRenderer.removeListener('jikkyo:message', wrapped);
  },
  onStatus: (handler) => {
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on('jikkyo:status', wrapped);
    return () => ipcRenderer.removeListener('jikkyo:status', wrapped);
  },
});
