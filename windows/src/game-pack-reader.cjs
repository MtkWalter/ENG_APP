'use strict';

const { randomUUID } = require('node:crypto');
const { isChatURL } = require('./policy.cjs');
const WORLD = 1849;
const MAX_PACK_BYTES = 50_000;

// Installed in an isolated world: this observer has no Node or IPC bridge.
function installReader(key, timeout, maximum, expectedPrompt, requestId) {
  const assistant = '[data-message-author-role="assistant"]';
  const roles = '[data-message-author-role]';
  const baseline = new Set(document.querySelectorAll(roles));
  const stableID = node => node.closest('[data-message-id]')?.getAttribute('data-message-id') ||
    node.closest('[data-testid^="conversation-turn"]')?.getAttribute('data-testid') || '';
  const baselineIDs = new Set([...baseline].map(stableID).filter(Boolean));
  const pending = new Set();
  const normalized = text => text.replace(/\s+/g, ' ').trim();
  let latest = null, requestUser = null, timer = 0, deadline = 0, complete = false, resolve;
  const promise = new Promise(done => { resolve = done; });
  const state = { promise, stop: () => finish({ error: 'cancelled' }) };
  window[key] = state;
  function finish(value) {
    if (complete) return;
    complete = true;
    if (timer) clearTimeout(timer);
    if (deadline) clearTimeout(deadline);
    observer.disconnect(); baseline.clear(); baselineIDs.clear(); pending.clear(); latest = null; requestUser = null;
    resolve(value);
  }
  function register(node) {
    if (baseline.has(node) || baselineIDs.has(stableID(node)) || node.parentElement?.closest(roles) || !node.isConnected) return;
    if (node.getAttribute('data-message-author-role') === 'user') {
      if (expectedPrompt && (normalized(node.textContent || '') === normalized(expectedPrompt) || normalized(node.innerText || '') === normalized(expectedPrompt))) requestUser = node;
      return;
    }
    if (!node.matches(assistant)) return;
    if (!latest?.isConnected || latest === node || (latest.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) latest = node;
  }
  function discover(node) {
    if (!node.isConnected) return;
    if (node.matches(roles)) register(node);
    for (const child of node.querySelectorAll(roles)) register(child);
  }
  function inspect() {
    timer = 0;
    if (complete) return;
    for (const node of pending) discover(node);
    pending.clear();
    if (!latest?.isConnected || !latest.matches(assistant)) return;
    if (expectedPrompt && (!requestUser?.isConnected || !(requestUser.compareDocumentPosition(latest) & Node.DOCUMENT_POSITION_FOLLOWING))) return;
    // Only the newly mounted assistant reply is read. Streaming changes to old
    // history, user messages and unrelated UI never copy the conversation.
    const text = latest.textContent || '';
    const start = text.indexOf('MILO_GAME_PACK_V1');
    if (start < 0) return;
    if (requestId && text.slice(0, start).trim() !== 'MILO_GAME_REQUEST:' + requestId) return;
    const end = text.indexOf('MILO_GAME_PACK_END', start + 17);
    if (end < 0) { if (text.length - start > maximum) finish({ error: 'large' }); return; }
    if (end + 'MILO_GAME_PACK_END'.length - start > maximum) { finish({ error: 'large' }); return; }
    latest.setAttribute('data-milo-game-pack-token', key);
    finish({ text: text.slice(start, end + 'MILO_GAME_PACK_END'.length) });
  }
  function schedule() { if (!complete && !timer) timer = setTimeout(inspect, 300); }
  const observer = new MutationObserver(records => {
    let changed = false;
    for (const record of records) {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!target) continue;
      if (record.type === 'attributes') {
        if (target.matches(roles) && !baseline.has(target)) { pending.add(target); changed = true; }
        continue;
      }
      const owner = target.closest('[data-message-author-role]');
      if (owner) {
        if (owner === latest) changed = true;
        else if (expectedPrompt && owner.getAttribute('data-message-author-role') === 'user' && !baseline.has(owner) && !baselineIDs.has(stableID(owner))) { pending.add(owner); changed = true; }
        continue;
      }
      if (record.type === 'childList') {
        for (const node of record.addedNodes) if (node.nodeType === 1) { pending.add(node); changed = true; }
      }
    }
    if (changed) schedule();
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['data-message-author-role'] });
  deadline = setTimeout(() => finish({ error: 'timeout' }), timeout);
  return { installed: true };
}

function concealPack(key, prompt) {
  const marker = '[data-milo-game-pack-token="' + key + '"]';
  const assistant = document.querySelector(marker);
  if (!assistant?.matches('[data-message-author-role="assistant"]')) return { concealed: false };
  const existing = document.querySelector('[data-milo-game-pack-placeholder="' + key + '"]');
  if (existing) return { concealed: true };
  // Only inspect the newest user role, once. Never copy or rewrite old turns.
  const users = document.querySelectorAll('[data-message-author-role="user"]');
  const user = users[users.length - 1];
  const normalized = text => text.replace(/\s+/g, ' ').trim();
  const ownUser = user && (normalized(user.textContent || '') === normalized(prompt) || normalized(user.innerText || '') === normalized(prompt)) &&
    !!(user.compareDocumentPosition(assistant) & Node.DOCUMENT_POSITION_FOLLOWING);
  const targets = (ownUser ? [user, assistant] : [assistant]).map(node => ({ node,
    display: node.style.getPropertyValue('display'), priority: node.style.getPropertyPriority('display') }));
  const placeholder = document.createElement('div');
  placeholder.setAttribute('data-milo-game-pack-placeholder', key);
  placeholder.style.cssText = 'margin:12px 0;padding:12px;border:1px solid #8886;border-radius:10px;font:inherit;';
  const label = document.createElement('p'); label.textContent = '圖片教材已準備好，請在右側遊戲作答。';
  label.style.cssText = 'margin:0 0 8px;';
  const toggle = document.createElement('button'); toggle.type = 'button';
  toggle.setAttribute('data-milo-game-pack-toggle', '1');
  toggle.style.cssText = 'padding:6px 10px;border:1px solid #8888;border-radius:7px;font:inherit;color:inherit;background:transparent;cursor:pointer;';
  let expanded = false;
  function apply() {
    for (const target of targets) {
      if (expanded) {
        if (target.display) target.node.style.setProperty('display', target.display, target.priority);
        else target.node.style.removeProperty('display');
        target.node.removeAttribute('data-milo-game-pack-concealed');
      } else {
        target.node.style.setProperty('display', 'none', 'important');
        target.node.setAttribute('data-milo-game-pack-concealed', '1');
      }
    }
    toggle.textContent = expanded ? '收合教材' : '查看教材';
    toggle.setAttribute('aria-expanded', String(expanded));
  }
  toggle.addEventListener('click', () => { expanded = !expanded; apply(); });
  placeholder.append(label, toggle); assistant.insertAdjacentElement('afterend', placeholder); apply();
  return { concealed: true, userConcealed: !!ownUser };
}

function readerError(code) {
  const messages = {
    cancelled: '已取消等待遊戲內容。',
    timeout: 'ChatGPT 尚未傳回完整遊戲內容，請稍後再試。',
    large: '遊戲內容過長，請重新產生較短的題目。',
    navigation: '聊天頁面已切換，已停止讀取遊戲內容。',
    unavailable: '無法讀取 ChatGPT 遊戲內容，請重新載入後再試。'
  };
  const error = new Error(messages[code] || messages.unavailable);
  error.code = code;
  if (code === 'cancelled') error.name = 'AbortError';
  if (code === 'timeout') error.name = 'TimeoutError';
  return error;
}

async function createGamePackReader(contents, { signal, timeout = 90000, expectedPrompt, requestId } = {}) {
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 600000) throw new RangeError('Invalid game reader timeout');
  if (expectedPrompt !== undefined && (typeof expectedPrompt !== 'string' || !expectedPrompt || expectedPrompt.length > MAX_PACK_BYTES)) throw new RangeError('Invalid game reader prompt');
  if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(requestId))) throw new RangeError('Invalid game request identifier');
  if (signal?.aborted) throw readerError('cancelled');
  if (contents.isDestroyed() || !isChatURL(contents.getURL())) throw readerError('navigation');
  const frame = contents.mainFrame;
  const key = '__miloGamePackReader_' + randomUUID();
  let currentURL = contents.getURL(), allowedNewConversation = new URL(currentURL).pathname === '/';
  let installed = false, settled = false, cleanupPromise = null, failure;
  let resolve, reject;
  const result = new Promise((yes, no) => { resolve = yes; reject = no; });
  // The caller normally waits for image upload before awaiting result. Keep a
  // timeout/navigation rejection handled during that earlier asynchronous work.
  void result.catch(() => {});
  const guard = () => !contents.isDestroyed() && contents.mainFrame === frame && isChatURL(contents.getURL());
  const cleanDOM = async () => {
    if (!installed || !guard()) return;
    try {
      await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(() => { const value=window[${JSON.stringify(key)}];value?.stop();delete window[${JSON.stringify(key)}]; })()` }]);
    } catch { /* A replacement document releases the observer itself. */ }
  };
  const removeListeners = () => {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', onAbort);
    contents.removeListener('did-start-navigation', onStartNavigation);
    contents.removeListener('did-navigate-in-page', onInPage);
    contents.removeListener('destroyed', onDestroyed);
    contents.removeListener('render-process-gone', onDestroyed);
  };
  const cleanup = () => {
    removeListeners();
    return cleanupPromise ||= cleanDOM();
  };
  const fail = error => {
    if (settled) return;
    settled = true; failure = error;
    reject(error); void cleanup();
  };
  const onAbort = () => fail(readerError('cancelled'));
  const onDestroyed = () => fail(readerError('navigation'));
  function navigation(url, inPlace) {
    if (!inPlace || !isChatURL(url)) { fail(readerError('navigation')); return; }
    if (url === currentURL) return;
    // ChatGPT gives a brand-new chat its conversation URL after the first send.
    // Any later conversation switch must cancel rather than read another chat.
    if (allowedNewConversation && /^\/c\/[^/]+\/?$/.test(new URL(url).pathname)) {
      allowedNewConversation = false; currentURL = url; return;
    }
    fail(readerError('navigation'));
  }
  function onStartNavigation(_event, url, inPlace, isMainFrame) { if (isMainFrame) navigation(url, inPlace); }
  function onInPage(_event, url, isMainFrame) { if (isMainFrame) navigation(url, true); }
  const deadline = setTimeout(() => fail(readerError('timeout')), timeout);
  signal?.addEventListener('abort', onAbort, { once: true });
  contents.on('did-start-navigation', onStartNavigation);
  contents.on('did-navigate-in-page', onInPage);
  contents.on('destroyed', onDestroyed);
  contents.on('render-process-gone', onDestroyed);
  try {
    const ready = await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${installReader.toString()})(${JSON.stringify(key)},${Math.ceil(timeout)},${MAX_PACK_BYTES},${JSON.stringify(expectedPrompt)},${JSON.stringify(requestId)})` }]);
    installed = true;
    if (settled || !guard() || !ready?.installed) {
      // An abort/navigation may arrive while installation is in flight.
      await cleanDOM();
      throw failure || readerError('navigation');
    }
    void contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `window[${JSON.stringify(key)}].promise` }]).then(async packet => {
      if (settled) return;
      if (!guard()) { fail(readerError('navigation')); return; }
      if (packet?.error) { fail(readerError(packet.error)); return; }
      if (typeof packet?.text !== 'string' || Buffer.byteLength(packet.text, 'utf8') > MAX_PACK_BYTES) { fail(readerError('large')); return; }
      settled = true;
      await cleanup(); resolve(packet.text);
    }).catch(() => fail(readerError('unavailable')));
    return { result,
      conceal: async prompt => {
        await result;
        if (!guard()) throw readerError('navigation');
        if (typeof prompt !== 'string' || prompt.length > MAX_PACK_BYTES) throw new RangeError('Invalid game presentation prompt');
        return contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${concealPack.toString()})(${JSON.stringify(key)},${JSON.stringify(prompt)})` }]);
      },
      stop: async () => {
        fail(readerError('cancelled')); await cleanup();
        if (guard()) {
          try { await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `document.querySelector(${JSON.stringify('[data-milo-game-pack-token="' + key + '"]')})?.removeAttribute('data-milo-game-pack-token')` }]); } catch {}
        }
      }
    };
  } catch (error) {
    fail(error?.code ? error : readerError('unavailable'));
    await cleanup();
    throw failure || error;
  }
}

async function waitForGamePack(contents, options) {
  const reader = await createGamePackReader(contents, options);
  try { return await reader.result; } finally { await reader.stop(); }
}

module.exports = { createGamePackReader, waitForGamePack };
