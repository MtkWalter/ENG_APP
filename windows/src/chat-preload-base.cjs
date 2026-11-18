'use strict';
const { ipcRenderer } = require('electron');
const trusted = () => location.protocol === 'https:' && (!location.port || location.port === '443') &&
  ['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(location.hostname);
const messageSelector = '[data-message-author-role],[data-testid^="conversation-turn"]';
const interactive = 'a,button,input,textarea,select,[role="button"],[contenteditable="true"],nav,header,footer';
let down = null, lastLookup = 0;
function selection() {
  if (!trusted()) return false;
  const selected = window.getSelection();
  if (!selected || selected.isCollapsed || selected.rangeCount !== 1) return false;
  const range = selected.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = node.nodeType === 1 ? node : node.parentElement;
  if (!element || element.closest(interactive) || !element.closest(messageSelector)) return false;
  const text = selected.toString().trim();
  if (text && text.length <= 5000) ipcRenderer.send('chat:selection', text);
  return true;
}
window.addEventListener('pointerdown', event => {
  if (event.isTrusted && event.button === 0) down = { x: event.clientX, y: event.clientY, time: performance.now() };
}, true);
window.addEventListener('pointerup', event => {
  if (!trusted() || !event.isTrusted || event.button !== 0 || !down) return;
  const start = down; down = null;
  if (selection() || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6 ||
    performance.now() - start.time > 650 || performance.now() - lastLookup < 120 ||
    event.target.closest(interactive) || !event.target.closest(messageSelector)) return;
  // Capture before selectionchange / automatic following can move the text under the pointer.
  // wordAtPoint is prepended from the unchanged Android asset by generate-preload.cjs.
  const word = wordAtPoint(event.clientX / innerWidth, event.clientY / innerHeight);
  if (word.status === 'ok') { lastLookup = performance.now(); ipcRenderer.send('chat:selection', word.text); }
}, true);
window.addEventListener('keyup', event => {
  if (event.isTrusted && event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) selection();
}, true);
