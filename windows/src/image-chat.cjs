'use strict';
const { randomUUID } = require('node:crypto');
const { isChatURL } = require('./policy.cjs');

// This function runs in an isolated world. It has no Node or application bridge.
function composerOperation(action, token, prompt) {
  if (location.protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(location.hostname) || (location.port && location.port !== '443')) return { error: '請先登入 ChatGPT，再開始圖片學習。' };
  const key = '__miloImageLessonV1';
  const state = window[key];
  if (action === 'release' || action === 'complete') {
    if (state?.token === token) {
      document.removeEventListener('change', state.fileChanged, true);
      document.removeEventListener('drop', state.otherFiles, true);
      document.removeEventListener('paste', state.otherFiles, true);
    }
    document.querySelectorAll('[data-milo-image-input]').forEach(node => {
      if (node.getAttribute('data-milo-image-input') !== token) return;
      if (action === 'complete' && state?.token === token && !state.foreignFile) node.value = '';
      node.removeAttribute('data-milo-image-input');
    });
    if (state?.token === token) delete window[key];
    return {};
  }
  const candidates = [...document.querySelectorAll('#prompt-textarea,textarea[data-testid="prompt-textarea"],[contenteditable="true"].ProseMirror')]
    .filter((node, i, all) => all.indexOf(node) === i && !node.closest('[data-message-author-role],article,nav'));
  if (candidates.length !== 1) return { error: '找不到 ChatGPT 輸入區。請先登入、結束目前語音，再重試圖片學習。' };
  const editor = candidates[0];
  const root = editor.closest('form') || editor.closest('#composer-background,[data-testid="composer-container"],#thread-bottom-container');
  if (!root) return { error: 'ChatGPT 輸入區版面已改變，請重新載入後再試。' };
  const text = () => String(editor.tagName === 'TEXTAREA' ? editor.value : editor.innerText).replace(/\s+/g, ' ').trim();
  const expected = prompt.replace(/\s+/g, ' ').trim();
  const attachmentSelector = 'img,[data-testid*="file-preview"],[data-testid*="attachment-preview"],[data-testid="file-upload"],[data-testid*="file-thumbnail"],[data-testid*="attachment-file"],button[aria-label*="Remove"],button[aria-label*="移除"],button[aria-label*="刪除"]';
  const attachments = () => root.querySelector(attachmentSelector);
  const selectedFiles = () => [...root.querySelectorAll('input[type="file"]')].some(node => node.files.length);
  const stop = document.querySelector('[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="停止生成"]');
  if (action === 'inspect') {
    if (text() || attachments() || selectedFiles()) return { error: 'ChatGPT 輸入區已有未送出的文字或附件。請先送出或清空，再開始圖片學習。' };
    if (stop && stop.getClientRects().length) return { error: 'ChatGPT 正在回覆，請等回覆完成後再開始圖片學習。' };
    const next = { token, editor, root, foreignFile: false };
    next.fileChanged = event => {
      const input = event.target;
      if (input.tagName !== 'INPUT' || input.type !== 'file' || !input.files.length) return;
      if (input.getAttribute('data-milo-image-input') !== token || input.files.length !== 1 || input.files[0].name !== 'lesson.jpg' || !input.files[0].type.startsWith('image/')) next.foreignFile = true;
    };
    next.otherFiles = event => { if ((event.dataTransfer || event.clipboardData)?.files.length) next.foreignFile = true; };
    document.addEventListener('change', next.fileChanged, true);
    document.addEventListener('drop', next.otherFiles, true);
    document.addEventListener('paste', next.otherFiles, true);
    window[key] = next;
    return { ready: true };
  }
  if (!state || state.token !== token || state.editor !== editor || state.root !== root) return { error: '聊天頁面已變動。請檢查輸入區後再重試，不會自動重送。' };
  if (action === 'file') {
    const inputs = [...root.querySelectorAll('input[type="file"]')].filter(node => !node.accept || node.accept.includes('*/*') || /image|\.png|\.jpe?g|\.webp/i.test(node.accept));
    const images = inputs.filter(node => /image|\.png|\.jpe?g|\.webp/i.test(node.accept));
    const selected = images.length === 1 ? images[0] : inputs.length === 1 ? inputs[0] : null;
    if (!selected) return { found: false };
    selected.value = ''; // CDP files:[] does not clear a previous selection.
    selected.setAttribute('data-milo-image-input', token);
    return { found: true };
  }
  if (action === 'plus' || action === 'upload-menu') {
    let button;
    if (action === 'plus') button = root.querySelector('[data-testid="composer-plus-btn"],button[aria-label="Add photos & files"],button[aria-label="新增照片和檔案"],button[aria-label="附加檔案"]');
    else button = [...document.querySelectorAll('[role="menuitem"]')].find(node => /add photos|upload (?:from|file)|上傳檔案|從電腦|新增照片/i.test(node.textContent) && !/drive|google|camera|相機/i.test(node.textContent));
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return { found: false };
    const rect = button.getBoundingClientRect();
    return rect.width && rect.height ? { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : { found: false };
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
    const busy = [...root.querySelectorAll('[role="progressbar"],[aria-busy="true"],.animate-spin')].some(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[hidden],[aria-hidden="true"]'));
    const ready = !!attachments() && !busy && !!send && !send.disabled && send.getAttribute('aria-disabled') !== 'true' && !!send.getClientRects().length;
    if (action === 'send' && ready) {
      if (state.committed) return { sent: false };
      const rect = send.getBoundingClientRect();
      state.committed = true;
      return { sent: true, found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
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
  let ownsDebugger = false, chooserNode = null, mainFrameId = null, submitted = false, accepted = false;
  const aborted = () => { const error = new Error('已取消圖片學習。'); error.name = 'AbortError'; return error; };
  function guard() {
    if (signal?.aborted) throw aborted();
    if (contents.isDestroyed() || contents.mainFrame !== frame || !isChatURL(contents.getURL()) || (!submitted && contents.getURL() !== initialURL)) throw new Error('聊天頁面已切換，已停止圖片傳送。請檢查後再試。');
  }
  async function run(action) {
    guard();
    const result = await contents.executeJavaScriptInIsolatedWorld(1847, [{ code: `(${composerOperation.toString()})(${JSON.stringify(action)},${JSON.stringify(token)},${JSON.stringify(prompt)})` }]);
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
  const onMessage = (_event, method, params) => { if (method === 'Page.fileChooserOpened' && params.frameId === mainFrameId) chooserNode = params.backendNodeId; };
  async function click(position, commit = false) {
    if (!position?.found) return false;
    guard(); contents.focus();
    contents.sendInputEvent({ type: 'mouseDown', x: Math.round(position.x), y: Math.round(position.y), button: 'left', clickCount: 1 });
    contents.sendInputEvent({ type: 'mouseUp', x: Math.round(position.x), y: Math.round(position.y), button: 'left', clickCount: 1 });
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
      await command('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function(token){this.value="";this.setAttribute("data-milo-image-input",token);}', arguments: [{ value: token }] });
      onStatus('uploading', '正在把圖片附加到目前的 ChatGPT 對話…');
      await command('DOM.setFileInputFiles', { backendNodeId: chooserNode, files: [filePath] });
    } else throw new Error('找不到 ChatGPT 的圖片附件按鈕。請確認帳號可上傳圖片，或重新載入後重試。');
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
