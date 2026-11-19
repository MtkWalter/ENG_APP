'use strict';
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isChatURL } = require('./policy.cjs');

// This function runs in an isolated world. It has no Node or application bridge.
function composerOperation(action, token, prompt, details) {
  if (location.protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(location.hostname) || (location.port && location.port !== '443')) return { error: '請先登入 ChatGPT，再開始圖片學習。' };
  const key = '__miloImageLessonV1';
  const state = window[key];
  if (action === 'release' || action === 'complete') {
    if (state?.token === token) {
      document.removeEventListener('change', state.fileChanged, true);
      document.removeEventListener('drop', state.otherFiles, true);
      document.removeEventListener('paste', state.otherFiles, true);
      if (state.root.getAttribute('data-milo-image-composer') === token) state.root.removeAttribute('data-milo-image-composer');
    }
    document.querySelectorAll('[data-milo-image-input]').forEach(node => {
      if (node.getAttribute('data-milo-image-input') !== token) return;
      if (action === 'complete' && state?.token === token && !state.foreignFile) node.value = '';
      node.removeAttribute('data-milo-image-input');
    });
    if (state?.token === token) delete window[key];
    return {};
  }
  const visible = node => !!node?.isConnected && !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[hidden],[aria-hidden="true"],[inert]');
  const editors = [...document.querySelectorAll('#prompt-textarea,textarea[data-testid="prompt-textarea"],[contenteditable="true"].ProseMirror')]
    .filter((node, i, all) => all.indexOf(node) === i && !node.closest('[data-message-author-role],article,nav') && visible(node));
  const namedEditors = editors.filter(node => node.id === 'prompt-textarea' || node.getAttribute('data-testid') === 'prompt-textarea');
  const candidates = namedEditors.length ? namedEditors : editors;
  if (candidates.length !== 1) return action === 'submitted' && state?.token === token && state.committed
    ? { submitted: false } : { error: '找不到 ChatGPT 輸入區。請先登入、結束目前語音，再重試圖片學習。' };
  const editor = candidates[0];
  const scopes = [editor.closest('#composer-background'), editor.closest('[data-testid="composer-container"]'),
    editor.closest('#thread-bottom-container'), editor.closest('form')].filter(node => node && !node.querySelector('[data-message-author-role]'));
  const root = scopes.find(node => scopes.every(other => node.contains(other)));
  if (!root) return action === 'submitted' && state?.token === token && state.committed
    ? { submitted: false } : { error: 'ChatGPT 輸入區版面已改變，請重新載入後再試。' };
  const text = () => String(editor.tagName === 'TEXTAREA' ? editor.value : editor.innerText).replace(/\s+/g, ' ').trim();
  const expected = prompt.replace(/\s+/g, ' ').trim();
  const attachmentSelector = 'img,[data-testid*="file-preview"],[data-testid*="attachment-preview"],[data-testid="file-upload"],[data-testid*="file-thumbnail"],[data-testid*="attachment-file"],button[aria-label*="Remove"],button[aria-label*="移除"],button[aria-label*="刪除"]';
  const attachments = () => root.querySelector(attachmentSelector);
  const form = editor.closest('form');
  const identity = node => [node.id, node.name, node.getAttribute('data-testid'), node.getAttribute('aria-label')].filter(Boolean).join(' ');
  const unrelated = node => /avatar|profile|account.photo|頭像|头像|個人相片|个人照片/i.test(identity(node)) ||
    !!node.closest('nav,header,aside,[data-message-author-role]') || (!!node.form && node.form !== form && !root.contains(node.form));
  const allInputs = () => [...document.querySelectorAll('input[type="file"]')].filter(node => !unrelated(node));
  const imageInput = node => !node.accept || node.accept.includes('*/*') || /image|\.png|\.jpe?g|\.webp/i.test(node.accept);
  const selectedFiles = () => allInputs().some(node => node.files.length);
  const label = node => [node.getAttribute('aria-label'), node.getAttribute('title'), node.textContent].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const disabled = node => !!node.disabled || node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true';
  const cloud = /google|drive|dropbox|sharepoint|camera|相機|相机|螢幕|屏幕|screen/i;
  const openerPattern = /(?:add|attach|upload).*(?:file|photo|image|more)|(?:file|photo|image).*(?:attach|upload)|新增.*(?:檔案|照片|相片|圖片|更多)|(?:上傳|上传|添加|附加|附檔).*(?:檔案|文件|图片|圖片|照片|相片)|^[+＋]$/i;
  function openers() {
    return [...root.querySelectorAll('button,[role="button"],label[for]')].filter(node => visible(node) && !cloud.test(label(node)) &&
      (node.getAttribute('data-testid') === 'composer-plus-btn' || openerPattern.test(label(node))));
  }
  function position(node) {
    if (!visible(node)) return { found: false };
    const rect = node.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return hit && (node === hit || node.contains(hit)) ? { found: true, x, y } : { found: false };
  }
  const busy = () => (root.getAttribute('aria-busy') === 'true' && visible(root)) || [...root.querySelectorAll('[role="progressbar"],[aria-busy="true"],.animate-spin')].some(visible);
  const dropTarget = node => !!node && !node.closest('nav,header,aside,[id*="avatar"],[id*="profile"]') &&
    (root.contains(node) || !!node.closest('[data-testid*="dropzone"],[data-testid*="drop-target"],[aria-label*="Drop files"],[aria-label*="拖放圖片"],[aria-label*="拖曳檔案"]'));
  const stop = document.querySelector('[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="停止生成"]');
  if (action === 'inspect') {
    if (text() || attachments() || selectedFiles()) return { error: 'ChatGPT 輸入區已有未送出的文字或附件。請先送出或清空，再開始圖片學習。' };
    if ([...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(node => visible(node) && !node.contains(editor))) return { error: 'ChatGPT 目前有開啟的視窗，請先關閉該視窗後再開始圖片學習。' };
    const buttons = openers();
    if (buttons.length && buttons.every(disabled)) return { error: 'ChatGPT 目前停用附件按鈕，請先確認網站提示或等待目前操作完成，再重試。' };
    if (stop && stop.getClientRects().length) return { error: 'ChatGPT 正在回覆，請等回覆完成後再開始圖片學習。' };
    const next = { token, editor, root, foreignFile: false, opened: false, dropArm: null, dropObserved: false };
    root.setAttribute('data-milo-image-composer', token);
    next.fileChanged = event => {
      const input = event.target;
      if (input.tagName !== 'INPUT' || input.type !== 'file' || !input.files.length) return;
      if (input.getAttribute('data-milo-image-input') !== token || input.files.length !== 1 || input.files[0].name !== 'lesson.jpg' || !input.files[0].type.startsWith('image/')) next.foreignFile = true;
    };
    next.otherFiles = event => {
      const files = (event.dataTransfer || event.clipboardData)?.files;
      if (!files?.length) return;
      const own = next.dropArm;
      const ownedFile = event.type === 'drop' && own && event.isTrusted && files.length === 1 && files[0].name === own.name && files[0].type === own.type && files[0].size === own.size &&
        Math.abs(event.clientX - own.x) < 3 && Math.abs(event.clientY - own.y) < 3;
      if (ownedFile && dropTarget(event.target)) { next.dropObserved = true; next.dropArm = null; }
      else {
        next.foreignFile = true;
        if (ownedFile) { event.preventDefault(); event.stopImmediatePropagation(); }
      }
    };
    document.addEventListener('change', next.fileChanged, true);
    document.addEventListener('drop', next.otherFiles, true);
    document.addEventListener('paste', next.otherFiles, true);
    window[key] = next;
    return { ready: true };
  }
  if (!state || state.token !== token) return { error: '圖片傳送操作已變動，請檢查輸入區後再試。' };
  // Sending a new conversation may remount its now-empty editor. This is a
  // read-only acknowledgement after our single committed click, never a retry.
  if (action === 'submitted' && state.committed) return { submitted: !text() && !attachments() };
  if (state.editor !== editor || state.root !== root) return { error: '聊天頁面已變動。請檢查輸入區後再重試，不會自動重送。' };
  if (action === 'opened') { state.opened = true; return {}; }
  if (action === 'file') {
    const inputs = allInputs().filter(imageInput);
    const groups = [inputs.filter(node => root.contains(node)), inputs.filter(node => form && node.form === form && !root.contains(node)),
      inputs.filter(node => !node.form && !root.contains(node) && !node.closest('[role="dialog"]') &&
        (state.opened || node.multiple || /(?:upload|attachment|attach)[-_]?(?:file|image|photo)|(?:file|image|photo)[-_]?upload/i.test(identity(node))))];
    let selected;
    for (const group of groups) {
      const enabled = group.filter(node => !disabled(node));
      if (group.length && !enabled.length) return { error: 'ChatGPT 目前停用圖片附件輸入，請先確認網站提示，再重試。' };
      const images = enabled.filter(node => /image|\.png|\.jpe?g|\.webp/i.test(node.accept));
      selected = images.length === 1 ? images[0] : enabled.length === 1 ? enabled[0] : null;
      if (selected || group.length) break;
    }
    if (!selected) return { found: false };
    selected.value = ''; // CDP files:[] does not clear a previous selection.
    selected.setAttribute('data-milo-image-input', token);
    return { found: true };
  }
  if (action === 'plus' || action === 'upload-menu') {
    let button;
    if (action === 'plus') {
      button = openers().filter(node => !disabled(node)).sort((a, b) => Number(b.getAttribute('data-testid') === 'composer-plus-btn') - Number(a.getAttribute('data-testid') === 'composer-plus-btn'))[0];
      if (button) state.menuControl = button.getAttribute('aria-controls');
    } else {
      const ownedMenu = state.menuControl && document.getElementById(state.menuControl);
      const menus = [...new Set([ownedMenu, ...document.querySelectorAll('[role="menu"],[data-radix-popper-content-wrapper],[popover]')].filter(node => node && visible(node)))];
      const choices = menus.length ? menus.flatMap(node => [...node.querySelectorAll('button,[role="menuitem"],[role="option"],[role="button"],label[for]')]) : [...document.querySelectorAll('[role="menuitem"],[role="option"]')];
      const pattern = /(?:upload|add|attach|choose|select).*(?:file|photo|image|computer|device)|(?:file|photo|image).*(?:upload|computer|device)|(?:上傳|上传|新增|添加|附加|選擇|选择).*(?:照片|相片|圖片|图片|檔案|文件)|(?:從|从).*(?:電腦|电脑|裝置|设备)/i;
      button = [...new Set(choices)].filter(node => visible(node) && !disabled(node) && !cloud.test(label(node)) && pattern.test(label(node)))
        .sort((a, b) => Number(/photo|image|照片|相片|圖片|图片/i.test(label(b))) - Number(/photo|image|照片|相片|圖片|图片/i.test(label(a))))[0];
    }
    if (!button) return { found: false };
    return position(button);
  }
  if (action === 'arm-drop') {
    if (text() || attachments() || selectedFiles()) return { error: 'ChatGPT 輸入區已有文字或附件，已停止附加圖片。請先檢查內容。' };
    editor.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    const rect = editor.getBoundingClientRect();
    state.dropArm = { ...details, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    return { x: state.dropArm.x, y: state.dropArm.y };
  }
  if (action === 'drop-started') return { started: state.dropObserved && !!(attachments() || busy()) };
  if (action === 'verify-drop-target') {
    const position = state.dropArm;
    if (!position || state.foreignFile || !dropTarget(document.elementFromPoint(position.x, position.y))) return { error: 'ChatGPT 輸入區被其他介面遮住，已停止附加圖片。請先關閉遮擋的選單或視窗。' };
    return { ready: true };
  }
  if (action === 'focus') {
    if (text()) return { error: '你已在輸入區加入文字，已停止自動傳送。請先檢查內容。' };
    editor.focus(); return { ready: true };
  }
  if (action === 'ready' || action === 'send') {
    if (state.foreignFile) return { error: '你已加入其他附件，已停止自動傳送。請先檢查 ChatGPT 輸入區。' };
    if (text() !== expected) return { error: '輸入內容已變動，已停止自動傳送。請檢查 ChatGPT 輸入區。' };
    const error = root.querySelector('[role="alert"]');
    if (error?.textContent.trim()) return { error: 'ChatGPT 附件提示：' + error.textContent.trim().slice(0, 240) };
    if (root.querySelectorAll('img').length > 1) return { error: '輸入區出現多個圖片附件，請先檢查後再開始。' };
    const removals = root.querySelectorAll('button[aria-label*="Remove"],button[aria-label*="移除"],button[aria-label*="刪除"]');
    const cards = [...root.querySelectorAll('img,[data-testid*="file-preview"],[data-testid*="attachment-preview"],[data-testid="file-upload"],[data-testid*="file-thumbnail"],[data-testid*="attachment-file"]')];
    if (removals.length > 1 || cards.filter(node => !cards.some(other => other !== node && node.contains(other))).length > 1) return { error: '輸入區出現其他附件，已停止自動傳送。請先檢查內容。' };
    const send = root.querySelector('[data-testid="send-button"],[data-testid="composer-submit-button"],button[aria-label="Send prompt"],button[aria-label="傳送提示"]');
    const sendPosition = send ? position(send) : { found: false };
    const available = !!send && !disabled(send) && visible(send);
    if (attachments() && !busy() && available && !sendPosition.found) return { error: 'ChatGPT 傳送按鈕被其他介面遮住，已停止自動傳送。請先關閉遮擋的選單或視窗。' };
    const ready = !!attachments() && !busy() && available && sendPosition.found;
    if (action === 'send' && ready) {
      if (state.committed) return { sent: false };
      state.committed = true;
      return { sent: true, ...sendPosition };
    }
    return { ready };
  }
  if (action === 'submitted') return { submitted: !text() && !attachments() };
  return { error: '無法識別圖片學習操作。' };
}

async function sendImageLesson(contents, filePath, prompt, { signal, onStatus = () => {}, timeout = 60000 } = {}) {
  const token = randomUUID();
  const initialURL = contents.getURL();
  const frame = contents.mainFrame;
  let ownsDebugger = false, chooserNode = null, mainFrameId = null, submitted = false, accepted = false, chooserUntil = 0;
  const aborted = () => { const error = new Error('已取消圖片學習。'); error.name = 'AbortError'; return error; };
  function guard() {
    if (signal?.aborted) throw aborted();
    if (contents.isDestroyed() || contents.mainFrame !== frame || !isChatURL(contents.getURL()) || (!submitted && contents.getURL() !== initialURL)) throw new Error('聊天頁面已切換，已停止圖片傳送。請檢查後再試。');
  }
  async function run(action, details) {
    guard();
    const result = await contents.executeJavaScriptInIsolatedWorld(1847, [{ code: `(${composerOperation.toString()})(${JSON.stringify(action)},${JSON.stringify(token)},${JSON.stringify(prompt)},${JSON.stringify(details)})` }]);
    guard();
    if (result?.error) throw new Error(result.error);
    return result;
  }
  async function pause(ms = 250) {
    guard();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(done, ms);
      function done() { signal?.removeEventListener('abort', cancel); resolve(); }
      function cancel() { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(aborted()); }
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
    });
  }
  const command = (method, params) => { guard(); return contents.debugger.sendCommand(method, params); };
  const onMessage = (_event, method, params) => { if (method === 'Page.fileChooserOpened' && params.frameId === mainFrameId && Date.now() <= chooserUntil) chooserNode = params.backendNodeId; };
  async function click(position, commit = false) {
    if (!position?.found) return false;
    guard(); contents.focus();
    chooserUntil = commit ? 0 : Date.now() + 3000;
    // CDP uses the same CSS coordinate space as getBoundingClientRect. Native
    // sendInputEvent expects DIP instead, which misses at non-100% page zoom.
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: position.x, y: position.y, button: 'left', buttons: 1, clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: position.x, y: position.y, button: 'left', buttons: 0, clickCount: 1 });
    if (commit) submitted = true;
    await pause(150); return true;
  }
  try {
    if (!isChatURL(initialURL)) throw new Error('請先登入 ChatGPT，再開始圖片學習。');
    await run('inspect');
    if (contents.debugger.isAttached()) throw new Error('請先關閉此頁的開發人員工具，再開始圖片學習。');
    contents.debugger.attach('1.3'); ownsDebugger = true;
    contents.debugger.on('message', onMessage);
    await command('Page.enable');
    mainFrameId = (await command('Page.getFrameTree')).frameTree.frame.id;
    await command('Page.setInterceptFileChooserDialog', { enabled: true });
    let input = await run('file');
    if (!input.found) {
      const opened = await click(await run('plus'));
      if (opened) await run('opened');
      const menuDeadline = Date.now() + 2500;
      let menuClicked = false;
      do {
        input = await run('file');
        if (input.found || chooserNode || !opened) break;
        if (!menuClicked) menuClicked = await click(await run('upload-menu'));
        if (!chooserNode) await pause(100);
      } while (Date.now() < menuDeadline);
    }
    if (input.found) {
      const { root } = await command('DOM.getDocument', { depth: 0 });
      const { nodeId } = await command('DOM.querySelector', { nodeId: root.nodeId, selector: `input[data-milo-image-input="${token}"]` });
      if (!nodeId) throw new Error('圖片附件輸入區已變動，請重試。');
      onStatus('uploading', '正在把圖片附加到目前的 ChatGPT 對話…');
      await command('DOM.setFileInputFiles', { nodeId, files: [filePath] });
    } else if (chooserNode) {
      const { object } = await command('DOM.resolveNode', { backendNodeId: chooserNode });
      const claimed = await command('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
        functionDeclaration: `function(token){
          const root=document.querySelector('[data-milo-image-composer="'+token+'"]');
          const identity=[this.id,this.name,this.getAttribute('data-testid'),this.getAttribute('aria-label')].join(' ');
          if(!root||this.type!=='file'||this.disabled||/avatar|profile|account.photo|頭像|头像/i.test(identity)||this.closest('nav,header,aside,[data-message-author-role]')||(this.form&&!root.contains(this.form)&&root!==this.form))return false;
          if(this.accept&&!this.accept.includes('*/*')&&!/image|\\.png|\\.jpe?g|\\.webp/i.test(this.accept))return false;
          this.value='';this.setAttribute('data-milo-image-input',token);return true;
        }`, arguments: [{ value: token }] });
      if (claimed.result.value !== true) throw new Error('檔案選擇器不屬於目前的圖片輸入區，已停止附加圖片。');
      onStatus('uploading', '正在把圖片附加到目前的 ChatGPT 對話…');
      await command('DOM.setFileInputFiles', { backendNodeId: chooserNode, files: [filePath] });
    } else {
      // Normal ChatGPT also accepts a real file drop. Use the verified editor
      // as the target rather than depending on the current attachment labels.
      chooserUntil = 0;
      let metadata;
      try { metadata = await fs.stat(filePath); } catch { throw new Error('圖片暫存已失效，請重新載入圖片。'); }
      const position = await run('arm-drop', { name: path.basename(filePath), type: 'image/jpeg', size: metadata.size });
      const data = { items: [], files: [filePath], dragOperationsMask: 1 };
      onStatus('uploading', '正在透過圖片拖放附加到 ChatGPT…');
      for (const type of ['dragEnter', 'dragOver', 'drop']) {
        if (type === 'drop') await run('verify-drop-target');
        await command('Input.dispatchDragEvent', { type, x: position.x, y: position.y, data });
      }
      const dropDeadline = Date.now() + 2000;
      while (!(await run('drop-started')).started) {
        if (Date.now() > dropDeadline) throw new Error('ChatGPT 尚未接收圖片。請先確認左側附件功能正常，再重試；已保留右側圖片。');
        await pause(100);
      }
    }
    await run('focus');
    contents.focus();
    await contents.insertText(prompt);
    const deadline = Date.now() + timeout;
    while (!(await run('ready')).ready) {
      if (Date.now() > deadline) throw new Error('圖片上傳尚未完成。請檢查 ChatGPT 附件與網路；不會自動重送。');
      await pause();
    }
    onStatus('sending', '圖片已就緒，正在送出學習指令…');
    const send = await run('send');
    if (!send.sent) throw new Error('ChatGPT 尚未接受傳送，請檢查輸入區後再試。');
    // Exactly one trusted click. SPA navigation after sending is expected.
    await click(send, true);
    const acceptedDeadline = Date.now() + Math.min(timeout, 20000);
    while (!(await run('submitted')).submitted) {
      if (Date.now() > acceptedDeadline) throw new Error('無法確認是否已送出。請檢查 ChatGPT 對話，避免重複傳送。');
      await pause();
    }
    accepted = true;
    return { sent: true };
  } finally {
    if (ownsDebugger) contents.debugger.removeListener('message', onMessage);
    if (ownsDebugger && !contents.isDestroyed() && contents.debugger.isAttached()) {
      try { await contents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }); } catch {}
      try { contents.debugger.detach(); } catch {}
    }
    if (!contents.isDestroyed() && contents.mainFrame === frame && isChatURL(contents.getURL())) {
      try { await contents.executeJavaScriptInIsolatedWorld(1847, [{ code: `(${composerOperation.toString()})(${JSON.stringify(accepted ? 'complete' : 'release')},${JSON.stringify(token)},'')` }]); } catch {}
    }
  }
}
module.exports = { sendImageLesson };
