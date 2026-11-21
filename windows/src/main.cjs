'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, shell, powerSaveBlocker } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { isChatURL, isLoginURL, isExternalURL, normalizeSelection, isWord } = require('./policy.cjs');
const { loadDictionary } = require('./dictionary.cjs');
const { readSettings, writeSettings } = require('./settings.cjs');
const { Translation } = require('./translation.cjs');
const { NativeSpeech, validateWave } = require('./speech.cjs');
const { createMediaPermissions } = require('./media-permissions.cjs');
const { attachMediaPower } = require('./media-power.cjs');
const { buildLessonPrompt, validateLessonOptions, IMAGE_LESSON_MODES } = require('./image-lessons.cjs');
const { prepareLessonImage } = require('./image-files.cjs');
const { sendImageLesson } = require('./image-chat.cjs');

const CHAT_URL = 'https://chatgpt.com/';
const TEST = !app.isPackaged && process.env.MILO_TEST_MODE === '1';
if (TEST && process.env.MILO_TEST_DATA) app.setPath('userData', process.env.MILO_TEST_DATA);
app.setName('Milo English');
let main, chat, settings, translator, speech, dictionaryPromise, awake, releaseMediaPower;
let sequence = 0, currentLookup = null, closing = false;
let chatLoadFailed = false;
let lessonImage = null, lessonAbort = null, lessonJob = null, lessonRequest = 0;
const retiredImageDirectories = new Set();
const imageLesson = { image: null, mode: 'conversation', status: 'idle', message: '', error: '' };
const state = { version: app.getVersion(), loading: true, error: '', zoom: 1, focus: true,
  dictionary: false, translationReady: false, preparing: false };
const assets = path.join(__dirname, '..', 'assets', 'android');
const pageScripts = { compact_voice_composer: 'compact-voice.js', hide_voice_orb: 'hide-voice-orb.js', keep_conversation_visible: 'keep-conversation-visible.js' };
const scripts = Object.fromEntries(Object.entries(pageScripts)
  .map(([name, file]) => [name, fs.readFileSync(path.join(__dirname, 'page', file), 'utf8')]));
const conversationLayoutScript = fs.readFileSync(path.join(__dirname, 'wide-conversation.js'), 'utf8');

function emit(type, data) {
  if (main && !main.isDestroyed() && !main.webContents.isDestroyed()) main.webContents.send('shell:event', { type, data });
}
function publish(patch = {}) { Object.assign(state, patch); emit('state', state); }
function publishImage(patch = {}) { Object.assign(imageLesson, patch); emit('image-lesson', imageLesson); }
async function disposeLessonImage(image) {
  if (!image) return;
  const directory = path.dirname(image.filePath);
  try { await image.dispose(); retiredImageDirectories.delete(directory); }
  catch { retiredImageDirectories.add(directory); }
}
async function stopImageJob() {
  lessonAbort?.abort();
  if (lessonJob) await lessonJob.catch(() => {});
}
async function launchImageLesson(request, mode) {
  validateLessonOptions(mode);
  if (request !== lessonRequest) return {};
  if (!lessonImage) { publishImage({ status: 'error', error: '請先載入一張圖片。' }); return {}; }
  const controller = new AbortController(); lessonAbort = controller;
  publishImage({ mode, status: 'uploading', error: '', message: '正在準備 ChatGPT 圖片教學…' });
  lessonJob = (async () => {
    try {
      if (!chat || chat.webContents.isDestroyed() || !isChatURL(chat.webContents.getURL())) throw new Error('請先登入 ChatGPT，再使用圖片教學。');
      if (settings.focus) { settings.focus = false; save(); publish({ focus: false }); }
      await applyMode();
      await chat.webContents.executeJavaScript("window.__miloCompactComposerV1?.stop()");
      await sendImageLesson(chat.webContents, lessonImage.filePath, buildLessonPrompt(mode), { signal: controller.signal,
        onStatus: (status, message) => { if (request === lessonRequest) publishImage({ status, message }); } });
      if (request === lessonRequest) publishImage({ status: 'sent', error: '', message: '圖片已送到 ChatGPT，請在左側繼續對話、句型或測驗練習。' });
    } catch (error) {
      if (request === lessonRequest) publishImage(error.name === 'AbortError'
        ? { status: 'cancelled', error: '', message: '已停止傳送；請檢查 ChatGPT 輸入區後再試。' }
        : { status: 'error', error: error.message, message: '圖片教學尚未完成，請檢查左側對話與輸入區。' });
    } finally {
      if (lessonAbort === controller) lessonAbort = null;
      if (!closing) await applyMode();
    }
    return {};
  })();
  return lessonJob;
}
async function pickLessonImage(mode) {
  validateLessonOptions(mode);
  const request = ++lessonRequest;
  await stopImageJob();
  if (request !== lessonRequest) return {};
  const picked = TEST && process.env.MILO_TEST_IMAGE ? { canceled: false, filePaths: [process.env.MILO_TEST_IMAGE] }
    : await dialog.showOpenDialog(main, { title: '載入圖片，開始英文學習', properties: ['openFile'],
      filters: [{ name: '圖片（PNG、JPG、WebP）', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (request !== lessonRequest) return {};
  if (picked.canceled || !picked.filePaths[0]) { publishImage({ status: 'idle', error: '', message: '尚未更換圖片。' }); return {}; }
  publishImage({ mode, status: 'preparing', error: '', message: '正在準備圖片與預覽…' });
  let prepared;
  try {
    prepared = await prepareLessonImage(picked.filePaths[0]);
    if (request !== lessonRequest || closing) { await disposeLessonImage(prepared); return {}; }
    const old = lessonImage; lessonImage = prepared;
    publishImage({ image: { name: prepared.name, preview: prepared.preview, width: prepared.width, height: prepared.height } });
    await disposeLessonImage(old);
    return launchImageLesson(request, mode);
  } catch (error) {
    if (request === lessonRequest) publishImage({ status: 'error', error: error.message, message: '' });
    return {};
  }
}
function save() {
  try { writeSettings(app.getPath('userData'), settings); }
  catch { emit('notice', '設定暫時無法儲存；本次仍可使用。'); }
}
function clearLookup() {
  sequence++; currentLookup = null;
  speech?.stop();
  translator?.cancel(); emit('lookup', null);
}
async function translateLookup(id, text) {
  emit('translation', { id, busy: true });
  try {
    const result = await translator.run('translate', text);
    if (id === sequence && currentLookup && result !== null) {
      currentLookup.chinese = result;
      currentLookup.translated = true;
      emit('lookup', currentLookup);
    }
  } catch (error) {
    if (id === sequence) { publish({ translationReady: translator.isReady() }); emit('translation', { id, error: error.message }); }
  } finally {
    if (id === sequence) emit('translation', { id, busy: false });
  }
}
async function lookup(value) {
  const text = normalizeSelection(value);
  if (!text) return { error: '請輸入英文，最多 5,000 字元。' };
  const id = ++sequence;
  speech.stop();
  translator.cancel();
  const result = { id, text, kind: isWord(text) ? 'word' : 'sentence', kk: '', chinese: '', translated: false };
  currentLookup = result;
  emit('lookup', result);
  if (result.kind === 'word') {
    try {
      const dictionary = await dictionaryPromise;
      if (id !== sequence) return {};
      const entry = dictionary.lookup(text);
      if (entry) Object.assign(result, { kk: entry.kk, chinese: entry.chinese });
    } catch (error) {
      if (id === sequence) emit('notice', error.message);
    }
  }
  if (id !== sequence) return {};
  emit('lookup', result);
  if (!result.chinese && translator.isReady() && !translator.preparing) void translateLookup(id, text);
  return {};
}
function isShell(event) {
  return main && event.sender === main.webContents && event.senderFrame === main.webContents.mainFrame;
}
function isChat(event) {
  return chat && !chat.webContents.isDestroyed() && event.sender === chat.webContents &&
    event.senderFrame === chat.webContents.mainFrame && isChatURL(event.senderFrame.url);
}
function updateAwake() {
  const visible = main && !main.isDestroyed() && main.isVisible() && !main.isMinimized();
  if (visible && awake == null) awake = powerSaveBlocker.start('prevent-display-sleep');
  if (!visible && awake != null) { powerSaveBlocker.stop(awake); awake = null; }
}
async function applyMode() {
  if (!chat || chat.webContents.isDestroyed() || !isChatURL(chat.webContents.getURL())) return;
  try {
    await chat.webContents.executeJavaScript(conversationLayoutScript);
    if (settings.focus) {
      for (const name of ['compact_voice_composer', 'hide_voice_orb', 'keep_conversation_visible']) {
        await chat.webContents.executeJavaScript(scripts[name]);
      }
    } else {
      await chat.webContents.executeJavaScript(`['__miloCompactComposerV1','__miloVoiceOrbFilterV1','__miloConversationVisibleV1'].forEach(key => window[key]?.stop())`);
    }
    chat.webContents.setZoomFactor(settings.zoom);
  } catch { /* Navigation can replace the document while a script is being applied. */ }
}
function external(url) {
  if (isExternalURL(url)) shell.openExternal(url).catch(() => emit('notice', '無法開啟預設瀏覽器。'));
}
function protectNavigation(contents) {
  contents.on('will-navigate', (event, url) => {
    if (!isLoginURL(url)) { event.preventDefault(); external(url); }
  });
  contents.on('will-redirect', (event, url) => { if (!isLoginURL(url)) event.preventDefault(); });
  contents.setWindowOpenHandler(({ url }) => {
    if (isLoginURL(url)) return { action: 'allow', overrideBrowserWindowOptions: {
      parent: main, width: 640, height: 780, autoHideMenuBar: true, title: 'Milo · 登入 ChatGPT',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
        webSecurity: true, partition: 'persist:milo-chat' }
    } };
    external(url); return { action: 'deny' };
  });
  contents.on('did-create-window', child => protectNavigation(child.webContents));
}
function loadChat(url = CHAT_URL) {
  lessonAbort?.abort();
  clearLookup();
  chatLoadFailed = false;
  publish({ loading: true, error: '' });
  chat.setVisible(true);
  chat.webContents.loadURL(url).catch(() => { /* did-fail-load owns the UI. */ });
}

function installIPC() {
  ipcMain.handle('shell:state', event => isShell(event) ? { ...state, imageLesson } : null);
  ipcMain.handle('shell:image-pick', async (event, mode) => {
    if (!isShell(event)) return {};
    try { return await pickLessonImage(mode); } catch { return { error: '請選擇有效的圖片學習模式。' }; }
  });
  ipcMain.handle('shell:image-start', async (event, mode) => {
    if (!isShell(event)) return {};
    try {
      validateLessonOptions(mode);
      const request = ++lessonRequest;
      await stopImageJob();
      return launchImageLesson(request, mode);
    } catch { return { error: '請選擇有效的圖片學習模式。' }; }
  });
  ipcMain.handle('shell:image-cancel', async event => {
    if (!isShell(event)) return {};
    const request = ++lessonRequest;
    await stopImageJob();
    if (request === lessonRequest) {
      publishImage({ status: 'cancelled', error: '', message: '已取消自動操作，請檢查 ChatGPT 輸入區。' });
    }
    return {};
  });
  ipcMain.handle('shell:image-clear', async event => {
    if (!isShell(event)) return {};
    const request = ++lessonRequest;
    await stopImageJob();
    if (request !== lessonRequest) return {};
    const old = lessonImage; lessonImage = null;
    await disposeLessonImage(old);
    publishImage({ image: null, status: 'idle', error: '', message: '已清除本機圖片預覽；ChatGPT 對話中的圖片不會因此刪除。' });
    return {};
  });
  ipcMain.handle('shell:lookup', (event, text) => isShell(event) ? lookup(text) : {});
  ipcMain.handle('shell:clear', event => { if (isShell(event)) clearLookup(); });
  const renderSpeech = async (event, text) => {
    if (!isShell(event) || !text) return { error: '請先選擇要朗讀的英文。' };
    try { return await speech.render(text); }
    catch (error) { return { error: error.message }; }
  };
  ipcMain.handle('shell:speech', (event, id) => renderSpeech(event, currentLookup?.id === id ? currentLookup.text : null));
  ipcMain.handle('shell:test-speech', event => renderSpeech(event, 'Hello. This is Milo English.'));
  ipcMain.handle('shell:stop-speech', event => { if (isShell(event)) speech.stop(); });
  ipcMain.handle('shell:prepare', async event => {
    if (!isShell(event) || translator.preparing) return {};
    publish({ preparing: true });
    try {
      await translator.run('prepare');
      publish({ translationReady: translator.isReady() });
      emit('notice', '離線翻譯模型已就緒。');
      if (currentLookup && !currentLookup.chinese) void translateLookup(sequence, currentLookup.text);
      return {};
    } catch (error) {
      emit('notice', '模型下載失敗。請檢查網路，再按一次下載。');
      return { error: error.message };
    } finally { publish({ preparing: false }); }
  });
  ipcMain.handle('shell:action', async (event, name) => {
    if (!isShell(event)) return;
    switch (name) {
      case 'new': loadChat(); break;
      case 'reload': loadChat(isLoginURL(chat.webContents.getURL()) ? chat.webContents.getURL() : CHAT_URL); break;
      case 'browser': {
        const currentURL = chat.webContents.getURL();
        external(isChatURL(currentURL) ? currentURL : CHAT_URL); break;
      }
      case 'focus': settings.focus = !settings.focus; save(); publish({ focus: settings.focus }); await applyMode(); break;
      case 'smaller':
      case 'larger':
        settings.zoom = Math.round(Math.min(2, Math.max(0.75, settings.zoom + (name === 'larger' ? 0.1 : -0.1))) * 100) / 100;
        save(); publish({ zoom: settings.zoom }); await applyMode(); break;
      case 'microphone':
        settings.microphone = 'ask'; save();
        emit('notice', '已重設麥克風權限。下次啟動網站語音時會重新詢問；Windows 也需允許桌面應用程式使用麥克風。'); break;
      case 'licenses':
        await dialog.showMessageBox(main, { type: 'info', title: 'Milo · 字典與模型來源',
          message: 'Milo English for Windows ' + app.getVersion(),
          detail: 'KK：CMUdict 美式發音轉寫，並非出版社原始 KK。\n中文：ECDICT / OpenCC 繁體轉換。\n整句：Helsinki-NLP OPUS-MT（本機推論）。\n\n字典包含 125,112 筆 KK、100,497 筆中文釋義。\nChatGPT 需要網路及使用者自己的帳號；Milo 與 OpenAI 無隸屬關係。\n\n完整授權隨程式附在 THIRD-PARTY-NOTICES.md 及 assets/android/dictionary_sources.txt。' }); break;
    }
  });
  ipcMain.on('shell:bounds', (event, rect) => {
    if (!isShell(event) || !rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))) return;
    const [width, height] = main.getContentSize();
    const x = Math.max(0, Math.min(width, Math.round(rect.x)));
    const y = Math.max(0, Math.min(height, Math.round(rect.y)));
    chat.setBounds({ x, y, width: Math.max(0, Math.min(width - x, Math.round(rect.width))),
      height: Math.max(0, Math.min(height - y, Math.round(rect.height))) });
  });
  ipcMain.on('chat:selection', (event, text) => { if (isChat(event)) void lookup(text); });
}

async function createWindow() {
  settings = readSettings(app.getPath('userData'));
  speech = new NativeSpeech();
  Object.assign(state, { focus: settings.focus, zoom: settings.zoom });
  translator = new Translation(path.join(app.getPath('userData'), 'translation-model'),
    progress => emit('progress', progress));
  state.translationReady = translator.isReady();
  dictionaryPromise = loadDictionary(assets);
  dictionaryPromise.then(() => publish({ dictionary: true })).catch(error => emit('notice', error.message));
  main = new BrowserWindow({ width: settings.width, height: settings.height, minWidth: 980, minHeight: 680,
    title: 'Milo English', backgroundColor: '#101615', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'shell-preload.cjs'), sandbox: true,
      contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' }
  });
  main.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  main.webContents.on('will-navigate', event => event.preventDefault());
  main.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  chat = new WebContentsView({ webPreferences: { preload: path.join(__dirname, '..', 'build', 'chat-preload.cjs'),
    sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
    partition: 'persist:milo-chat', backgroundThrottling: false, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' }
  });
  releaseMediaPower = attachMediaPower(chat.webContents, powerSaveBlocker);
  main.contentView.addChildView(chat);
  chat.setBounds({ x: 16, y: 96, width: 800, height: 650 });
  const session = chat.webContents.session;
  const ua = session.getUserAgent().replace(/\s(?:Electron|milo-english-windows|Milo\s*English|Milo%20English)\/\S+/gi, '');
  session.setUserAgent(ua);
  const permissions = createMediaPermissions({ getContents: () => chat.webContents, settings, save,
    askAudio: async () => {
      const result = await dialog.showMessageBox(main, { type: 'question', title: 'Milo · 麥克風權限',
        message: '允許 ChatGPT 使用麥克風進行語音對話？',
        detail: '只有 chatgpt.com 的語音功能可以要求音訊權限；攝影機與螢幕錄製維持關閉。',
        buttons: ['允許麥克風', '暫不允許'], defaultId: 0, cancelId: 1 });
      return result.response === 0;
    }
  });
  session.setPermissionCheckHandler(permissions.check);
  session.setPermissionRequestHandler(permissions.request);
  session.on('will-download', (_event, item) => { item.cancel(); emit('notice', '請使用上方「瀏覽器語音」按鈕，在瀏覽器下載附件。'); });
  protectNavigation(chat.webContents);
  chat.webContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) { chatLoadFailed = false; clearLookup(); publish({ loading: true, error: '' }); }
  });
  chat.webContents.on('did-finish-load', async () => {
    if (chatLoadFailed) return;
    publish({ loading: false, error: '' }); chat.setVisible(true); await applyMode();
  });
  chat.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    chatLoadFailed = true;
    chat.setVisible(false);
    publish({ loading: false, error: '無法載入 ChatGPT。請檢查網路後重試；右側離線字典仍可使用。' });
  });
  chat.webContents.on('render-process-gone', () => {
    clearLookup(); chat.setVisible(false);
    publish({ loading: false, error: '聊天頁面已停止，請按重新載入。' });
  });
  installIPC();
  await main.loadFile(path.join(__dirname, 'ui', 'index.html'));
  publishImage();
  main.once('ready-to-show', () => { if (!closing) { main.show(); updateAwake(); } });
  // ready-to-show may occur while loadFile is resolving.
  main.show(); updateAwake();
  main.on('minimize', () => { updateAwake(); clearLookup(); emit('stop-speech', null); });
  main.on('restore', updateAwake);
  main.on('hide', updateAwake);
  main.on('close', () => {
    closing = true;
    lessonRequest++; lessonAbort?.abort();
    if (lessonImage) {
      const image = lessonImage; lessonImage = null;
      try { fs.rmSync(path.dirname(image.filePath), { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
      catch { void image.dispose().catch(() => {}); }
    }
    [settings.width, settings.height] = main.getSize(); save();
    translator.close(); speech.stop(); emit('stop-speech', null);
    releaseMediaPower?.();
    if (chat && !chat.webContents.isDestroyed()) chat.webContents.close();
    for (const directory of retiredImageDirectories) {
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
    }
    retiredImageDirectories.clear();
    if (awake != null) { powerSaveBlocker.stop(awake); awake = null; }
  });
  const menu = Menu.buildFromTemplate([
    { label: '檔案', submenu: [{ label: '新對話', accelerator: 'CmdOrCtrl+N', click: () => loadChat() },
      { label: '重新載入', accelerator: 'CmdOrCtrl+R', click: () => loadChat(isLoginURL(chat.webContents.getURL()) ? chat.webContents.getURL() : CHAT_URL) },
      { type: 'separator' }, { role: 'quit', label: '結束 Milo' }] },
    { label: '編輯', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' }, { label: '查單字', accelerator: 'CmdOrCtrl+L', click: () => { main.webContents.focus(); emit('focus-search', null); } }] }
  ]);
  Menu.setApplicationMenu(menu);
  if (TEST) publish({ loading: false }); else loadChat();
}

async function selfTest() {
  const report = app.commandLine.getSwitchValue('milo-self-test-report');
  const modelDirectory = app.commandLine.getSwitchValue('milo-self-test-model-dir');
  let service;
  try {
    const dictionary = await loadDictionary(assets);
    const entry = dictionary.lookup('new');
    if (!entry?.kk || !entry.chinese.includes('新的')) throw new Error('Bundled dictionary lookup failed');
    // Exercise actual packaged sharp/native files using a local selected-image
    // equivalent, without a ChatGPT account or a network upload.
    const imageSource = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'milo-image-self-test-'));
    let preparedImage;
    try {
      const source = path.join(imageSource, 'sample.png');
      fs.writeFileSync(source, fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.png')));
      preparedImage = await prepareLessonImage(source);
      if (!preparedImage.preview.startsWith('data:image/jpeg;base64,') || !buildLessonPrompt('conversation').length) throw new Error('Packaged image learning failed');
    } finally { await preparedImage?.dispose(); fs.rmSync(imageSource, { recursive: true, force: true }); }
    const imageLearning = { normalized: true, width: preparedImage.width, height: preparedImage.height, modes: IMAGE_LESSON_MODES.map(item => item.id) };
    dictionary.close();
    // Importing the full pipeline also loads the packaged Windows sharp / ONNX N-API libraries.
    await import('@huggingface/transformers');
    let nativeSpeech = null;
    if (process.platform === 'win32') {
      const native = new NativeSpeech();
      const rendered = await native.render('This is a new book.');
      const bytes = Buffer.from(rendered.audio, 'base64');
      if (!validateWave(bytes)) throw new Error('Packaged Windows speech synthesis returned no audio');
      nativeSpeech = { voice: rendered.voice, english: rendered.english, bytes: bytes.length };
      native.stop();
    }
    let translation = null;
    if (modelDirectory) {
      service = new Translation(modelDirectory, () => {});
      translation = await service.run('translate', 'This is a new book.');
      if (!/[\u4e00-\u9fff]/.test(translation) || /[这书]/.test(translation)) throw new Error('Packaged offline translation failed');
    }
    if (report) fs.writeFileSync(report, JSON.stringify({ ok: true, platform: process.platform,
      arch: process.arch, version: app.getVersion(), dictionary: entry, translation, nativeSpeech, imageLearning }, null, 2));
    service?.close(); app.exit(0);
  } catch (error) {
    if (report) fs.writeFileSync(report, JSON.stringify({ ok: false, error: error.message, cause: String(error.cause || '') }, null, 2));
    service?.close(); app.exit(1);
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (main) { if (main.isMinimized()) main.restore(); main.focus(); } });
  app.whenReady().then(() => app.commandLine.hasSwitch('milo-self-test') ? selfTest() : createWindow()).catch(error => {
    dialog.showErrorBox('Milo 無法啟動', String(error.message)); app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { translator?.close(); speech?.stop(); });
}
