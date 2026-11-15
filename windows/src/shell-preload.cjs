'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('milo', {
  state: () => ipcRenderer.invoke('shell:state'),
  action: name => ipcRenderer.invoke('shell:action', name),
  lookup: text => ipcRenderer.invoke('shell:lookup', text),
  clear: () => ipcRenderer.invoke('shell:clear'),
  prepareTranslation: () => ipcRenderer.invoke('shell:prepare'),
  bounds: rect => ipcRenderer.send('shell:bounds', rect),
  on: callback => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on('shell:event', handler);
    return () => ipcRenderer.removeListener('shell:event', handler);
  }
});
