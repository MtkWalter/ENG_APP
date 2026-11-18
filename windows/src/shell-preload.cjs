'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('milo', {
  state: () => ipcRenderer.invoke('shell:state'),
  action: name => ipcRenderer.invoke('shell:action', name),
  lookup: text => ipcRenderer.invoke('shell:lookup', text),
  clear: () => ipcRenderer.invoke('shell:clear'),
  speech: id => ipcRenderer.invoke('shell:speech', id),
  testSpeech: () => ipcRenderer.invoke('shell:test-speech'),
  stopSpeech: () => ipcRenderer.invoke('shell:stop-speech'),
  prepareTranslation: () => ipcRenderer.invoke('shell:prepare'),
  pickImage: (mode, character) => ipcRenderer.invoke('shell:image-pick', mode, character),
  startImageLesson: (mode, character) => ipcRenderer.invoke('shell:image-start', mode, character),
  cancelImageLesson: () => ipcRenderer.invoke('shell:image-cancel'),
  clearImage: () => ipcRenderer.invoke('shell:image-clear'),
  bounds: rect => ipcRenderer.send('shell:bounds', rect),
  on: callback => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on('shell:event', handler);
    return () => ipcRenderer.removeListener('shell:event', handler);
  }
});
