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
  pickImage: (mode, character, style) => ipcRenderer.invoke('shell:image-pick', mode, character, style),
  startImageLesson: (mode, character, style) => ipcRenderer.invoke('shell:image-start', mode, character, style),
  cancelImageLesson: () => ipcRenderer.invoke('shell:image-cancel'),
  clearImage: () => ipcRenderer.invoke('shell:image-clear'),
  answerGame: value => ipcRenderer.invoke('shell:game-answer', value),
  hintGame: () => ipcRenderer.invoke('shell:game-hint'),
  nextGame: () => ipcRenderer.invoke('shell:game-next'),
  feedGame: () => ipcRenderer.invoke('shell:game-feed'),
  speakGame: () => ipcRenderer.invoke('shell:game-speak'),
  restartGame: (style, character) => ipcRenderer.invoke('shell:game-restart', style, character),
  bounds: rect => ipcRenderer.send('shell:bounds', rect),
  on: callback => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on('shell:event', handler);
    return () => ipcRenderer.removeListener('shell:event', handler);
  }
});
