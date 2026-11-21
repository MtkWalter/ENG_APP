'use strict';

const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');
const { html } = require('./fixtures/image-learning.cjs');
const root = path.join(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'milo-upload-compatibility-'));
const selectedImage = path.join(directory, 'selected-image.png');
const selectedPDF = path.join(directory, 'existing-draft.pdf');
const baseline = process.argv.includes('--baseline');
const baselineRevision = process.env.MILO_UPLOAD_BASELINE_REF || 'd9a8970bdc8af406bf6d3fa2e5a1a9fa38d7a74f';
let app;

// A baseline run compiles the committed implementation under its real module
// filename in an isolated test process. Production files remain untouched while
// another agent develops the fix in the working tree.
let entry = root;
if (baseline) {
  const source = execFileSync('git', ['show', baselineRevision + ':windows/src/image-chat.cjs'], { cwd: root, encoding: 'utf8' });
  const sourceFile = path.join(directory, 'committed-image-chat.cjs'); fs.writeFileSync(sourceFile, source);
  entry = path.join(directory, 'baseline-app.cjs');
  const filename = path.join(root, 'src/image-chat.cjs');
  fs.writeFileSync(entry, `const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');const filename=${JSON.stringify(filename)};const compiled=new Module(filename);compiled.filename=filename;compiled.paths=Module._nodeModulePaths(path.dirname(filename));Module._cache[filename]=compiled;compiled._compile(fs.readFileSync(${JSON.stringify(sourceFile)},'utf8'),filename);require(${JSON.stringify(path.join(root, 'src/main.cjs'))});`);
}

const cases = [
  { name: 'body-image-input', layout: 'body', zoom: 1, expected: 'sent' },
  { name: 'outside-form-associated-input', layout: 'associated', zoom: 1, expected: 'sent' },
  { name: 'zh-outside-form-menu', layout: 'zh', zoom: 1, expected: 'sent' },
  { name: 'nested-composer-background', layout: 'nested', zoom: 1, expected: 'sent' },
  { name: 'en-outside-form-menu', layout: 'en', zoom: 1, expected: 'sent' },
  { name: 'direct-input-zoom-125', layout: 'direct', zoom: 1.25, expected: 'sent' },
  { name: 'direct-input-zoom-150', layout: 'direct', zoom: 1.5, expected: 'sent' },
  { name: 'editor-remount-after-send', layout: 'remount', zoom: 1, expected: 'sent' },
  { name: 'zh-menu-zoom-150', layout: 'zh', zoom: 1.5, expected: 'sent' },
  { name: 'trusted-file-drop', layout: 'drop', zoom: 1, expected: 'sent' },
  { name: 'trusted-file-drop-zoom-150', layout: 'drop', zoom: 1.5, expected: 'sent' },
  { name: 'disabled-upload-control', layout: 'disabled', zoom: 1, expected: 'error', guard: 'disabled' },
  { name: 'missing-upload-control', layout: 'missing', zoom: 1, expected: 'error', guard: 'missing' },
  { name: 'preserve-existing-draft', layout: 'body', zoom: 1, expected: 'error', guard: 'draft' },
  { name: 'preserve-masked-pdf', layout: 'body', zoom: 1, expected: 'error', guard: 'pdf' }
];

async function chatEvaluate(source) {
  return app.evaluate(({ webContents }, code) => {
    const contents = webContents.getAllWebContents().find(item => item.getURL().startsWith('https://chatgpt.com/'));
    return contents ? contents.executeJavaScript(code) : null;
  }, source);
}
async function waitChat(source) {
  for (let i = 0; i < 100; i++) {
    if (await chatEvaluate(source)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Upload compatibility fixture did not initialize');
}
function customizeFixture({ layout }) {
  const state = window.__uploadCompat = { clicks: [], plus: [], menu: [], drops: [], profileChanges: 0 };
  const profile = document.createElement('form'); profile.id = 'profile-settings'; profile.hidden = true;
  const avatar = document.createElement('input'); avatar.id = 'avatar-upload'; avatar.name = 'avatar'; avatar.type = 'file'; avatar.accept = 'image/*';
  avatar.addEventListener('change', () => state.profileChanges++); profile.appendChild(avatar); document.getElementById('native-sidebar').appendChild(profile);
  document.addEventListener('pointerdown', event => {
    const rect = document.getElementById('fixture-send').getBoundingClientRect();
    state.clicks.push({ target: event.target.closest('button')?.id || event.target.id || event.target.tagName,
      trusted: event.isTrusted, x: event.clientX, y: event.clientY,
      sendCenter: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } });
  }, true);
  const file = document.getElementById('lesson-file'), foreign = document.getElementById('foreign-file');
  const form = document.getElementById('composer');
  if (layout === 'remount') {
    document.getElementById('fixture-send').addEventListener('click', () => {
      if (!window.__fixture.sent.length || state.remounted) return;
      const original = document.getElementById('prompt-textarea'), replacement = original.cloneNode(false);
      replacement.textContent = ''; original.replaceWith(replacement); state.remounted = true; state.oldEditor = original;
    });
  } else if (layout === 'body') {
    document.body.append(file, foreign); file.accept = '.png,.jpg,.jpeg,.webp'; file.multiple = true;
  } else if (layout === 'associated') {
    document.body.appendChild(file); file.multiple = false; file.setAttribute('form', 'composer');
  } else if (layout === 'zh' || layout === 'en' || layout === 'nested' || layout === 'disabled') {
    document.body.appendChild(file);
    const scope = document.createElement('div'); scope.id = 'composer-background'; scope.setAttribute('data-testid', 'composer');
    if (layout === 'nested') {
      const editor = document.getElementById('prompt-textarea'); editor.before(scope); scope.appendChild(editor);
      scope.style.cssText = 'flex:1;min-width:170px';
    } else {
      const footer = form.parentElement; scope.appendChild(form); footer.appendChild(scope);
    }
    const toolbar = document.createElement('div'); toolbar.id = 'attachment-toolbar';
    const plus = document.createElement('button'); plus.type = 'button'; plus.id = 'compat-plus';
    plus.setAttribute('aria-label', layout === 'zh' || layout === 'nested' ? '新增檔案和更多內容' : 'Add files and more');
    plus.textContent = '+'; toolbar.appendChild(plus); (layout === 'nested' ? form : scope).prepend(toolbar);
    if (layout === 'disabled') {
      plus.disabled = true; plus.setAttribute('aria-disabled', 'true'); plus.title = 'Upload limit reached';
      file.disabled = true;
      const message = document.createElement('div'); message.setAttribute('role', 'alert'); message.textContent = 'Upload limit reached. Try again later.'; scope.appendChild(message);
    } else {
      // This fixture represents the layout that creates its file input only
      // after a user selects the local-upload item in the portal menu.
      file.remove();
      plus.addEventListener('click', event => {
        state.plus.push(event.isTrusted);
        setTimeout(() => {
          const menu = document.createElement('div'); menu.id = 'compat-upload-menu'; menu.setAttribute('role', 'menu');
          menu.style.cssText = 'position:fixed;right:25px;bottom:180px;z-index:1000;background:white;padding:12px;border:1px solid #aaa';
          const drive = document.createElement('button'); drive.type = 'button'; drive.setAttribute('role', 'menuitem'); drive.textContent = 'Add from Google Drive'; menu.appendChild(drive);
          const local = document.createElement('button'); local.id = 'compat-local-upload'; local.type = 'button'; local.setAttribute('role', 'menuitem');
          local.textContent = layout === 'zh' || layout === 'nested' ? '新增相片與檔案' : 'Upload from computer';
          local.addEventListener('click', localEvent => {
            state.menu.push(localEvent.isTrusted); document.body.appendChild(file); file.click(); menu.remove();
          });
          menu.appendChild(local); document.body.appendChild(menu);
        }, 180);
      });
    }
  } else if (layout === 'drop' || layout === 'missing') {
    file.remove();
    const editor = document.getElementById('prompt-textarea');
    for (const type of ['dragenter', 'dragover']) editor.addEventListener(type, event => event.preventDefault());
    editor.addEventListener('drop', async event => {
      event.preventDefault();
      if (layout !== 'drop') return;
      const selected = event.dataTransfer?.files[0];
      if (!selected) return;
      state.drops.push({ trusted: event.isTrusted, files: event.dataTransfer.files.length, target: event.target.id });
      const fixture = window.__fixture, progress = document.getElementById('upload-progress');
      fixture.uploadReady = false; progress.hidden = false; fixture.lastFile = selected;
      const change = { trusted: event.isTrusted, name: selected.name, type: selected.type, size: selected.size };
      fixture.changes.push(change);
      change.signature = [...new Uint8Array(await selected.arrayBuffer()).slice(0, 3)];
      await new Promise(resolve => setTimeout(resolve, 80));
      const image = new Image(); image.alt = 'Dropped lesson image'; image.src = URL.createObjectURL(selected);
      document.getElementById('previews').replaceChildren(image); fixture.uploadReady = true; progress.hidden = true;
      document.getElementById('fixture-send').disabled = !editor.innerText.trim();
    });
  }
}
async function selectMaskedPDF() {
  await app.evaluate(async ({ webContents }, selectedPDF) => {
    const contents = webContents.getAllWebContents().find(item => item.getURL().startsWith('https://chatgpt.com/'));
    contents.debugger.attach('1.3');
    try {
      const { root } = await contents.debugger.sendCommand('DOM.getDocument', { depth: 0 });
      const { nodeId } = await contents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#foreign-file' });
      await contents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [selectedPDF] });
    } finally { contents.debugger.detach(); }
  }, selectedPDF);
  await chatEvaluate('document.getElementById("concurrent-user-file")?.remove()');
}
async function runCase(config) {
  const profile = path.join(directory, config.name); fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ focus: false, zoom: config.zoom }));
  try {
    app = await electron.launch({ args: [entry, ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [])],
      env: { ...process.env, MILO_TEST_MODE: '1', MILO_TEST_DATA: profile, MILO_TEST_IMAGE: selectedImage }, timeout: 60000 });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1100));
    await page.waitForSelector('#image-tab');
    await page.evaluate(() => window.milo.on(({ type, data }) => { if (type === 'image-lesson') window.__compatState = data; }));
    await app.evaluate(({ session }, html) => session.fromPartition('persist:milo-chat').protocol.handle('https',
      () => new Response(html, { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } })), html);
    await page.locator('#reload').click(); await waitChat('!!window.__fixture');
    await chatEvaluate(`(${customizeFixture.toString()})(${JSON.stringify(config)})`);
    if (config.guard === 'draft') await chatEvaluate('document.getElementById("prompt-textarea").innerText="Keep this unsent answer."');
    if (config.guard === 'pdf') await selectMaskedPDF();
    let zoom;
    for (let attempt = 0; attempt < 60; attempt++) {
      zoom = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(item => item.getURL().startsWith('https://chatgpt.com/')).getZoomFactor());
      if (Math.abs(zoom - config.zoom) < 0.001) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(Math.abs(zoom - config.zoom) < 0.001);
    await page.evaluate(() => { window.__compatDone = false; void window.milo.pickImage('quiz').then(() => { window.__compatDone = true; }); });
    const deadline = Date.now() + 5500;
    let observed;
    while (Date.now() < deadline) {
      observed = await page.evaluate(() => ({ status: window.__compatState?.status, error: window.__compatState?.error || '', done: window.__compatDone }));
      if (observed.done && ['sent', 'error', 'cancelled'].includes(observed.status)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const timedOut = !observed?.done;
    if (timedOut) await page.evaluate(() => window.milo.cancelImageLesson());
    const evidence = await chatEvaluate(`({sent:window.__fixture.sent.length,changes:window.__fixture.changes.length,
      trustedUpload:window.__fixture.changes[0]?.trusted,trustedSend:window.__fixture.sent[0]?.trusted,
      pdfCount:document.getElementById('foreign-file')?.files.length||0,draft:document.getElementById('prompt-textarea').innerText,
      plus:window.__uploadCompat.plus,menu:window.__uploadCompat.menu,drops:window.__uploadCompat.drops,profileChanges:window.__uploadCompat.profileChanges,clicks:window.__uploadCompat.clicks,
      remounted:!!window.__uploadCompat.remounted,oldEditorDisconnected:window.__uploadCompat.oldEditor?!window.__uploadCompat.oldEditor.isConnected:false,
      sidebar:document.getElementById('native-sidebar').getBoundingClientRect().width})`);
    let failure = '';
    try {
      assert.equal(timedOut, false, 'automatic upload/send did not complete promptly');
      assert.equal(observed.status, config.expected, observed.error);
      assert.equal(evidence.sidebar, 150);
      assert.equal(evidence.profileChanges, 0, 'unrelated avatar/profile image inputs must never receive the selected lesson image');
      if (config.expected === 'sent') {
        assert.equal(evidence.sent, 1); assert.equal(evidence.changes, 1);
        assert.equal(evidence.trustedUpload, true); assert.equal(evidence.trustedSend, true);
        assert.equal(evidence.pdfCount, 0);
        if (config.layout === 'zh' || config.layout === 'en' || config.layout === 'nested') { assert.deepEqual(evidence.plus, [true]); assert.deepEqual(evidence.menu, [true]); }
        if (config.layout === 'drop') assert.deepEqual(evidence.drops, [{ trusted: true, files: 1, target: 'prompt-textarea' }]);
        if (config.layout === 'remount') { assert.equal(evidence.remounted, true); assert.equal(evidence.oldEditorDisconnected, true); }
        assert.equal(evidence.clicks.at(-1)?.target, 'fixture-send', 'the trusted click must land on Send at the selected zoom factor');
      } else {
        assert.equal(evidence.sent, 0); assert.equal(evidence.changes, 0);
        if (config.guard === 'draft') { assert.equal(evidence.draft, 'Keep this unsent answer.'); assert.match(observed.error, /未送出|清空|已有/); }
        if (config.guard === 'pdf') { assert.equal(evidence.pdfCount, 1); assert.match(observed.error, /未送出|清空|已有|其他附件/); }
        if (config.guard === 'disabled') { assert.match(observed.error, /限制|額度|停用|上限|不可用|limit|disabled/i); assert.doesNotMatch(observed.error, /^找不到 ChatGPT 的圖片附件按鈕/); }
        if (config.guard === 'missing') assert.match(observed.error, /找不到|版面|附件|輸入區/);
      }
    } catch (error) { failure = error.message.split('\n')[0]; }
    return { name: config.name, layout: config.layout, zoom, expected: config.expected, observed: observed.status,
      diagnostic: observed.error, timedOut, sent: evidence.sent, trustedUpload: !!evidence.trustedUpload,
      plusClicks: evidence.plus, menuClicks: evidence.menu, drops: evidence.drops, profileInputUntouched: evidence.profileChanges === 0,
      editorRemounted: evidence.remounted, pointer: evidence.clicks.at(-1) || null, passed: !failure, failure };
  } finally { if (app) { await app.close(); app = null; } }
}

(async () => {
  const results = [];
  try {
    await sharp({ create: { width: 24, height: 18, channels: 3, background: '#668877' } }).png().toFile(selectedImage);
    fs.writeFileSync(selectedPDF, '%PDF-1.4\n% synthetic existing attachment\n');
    for (const config of cases) {
      const result = await runCase(config); results.push(result);
      console.log('Upload compatibility:', JSON.stringify(result));
    }
    const report = { baseline, ...(baseline ? { baselineRevision } : {}), cases: results,
      limitation: 'Actual Electron upload/menu/pointer events against synthetic ChatGPT layouts; logged-in ChatGPT account limits and server uploads remain unverified.' };
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    fs.writeFileSync(path.join(root, 'test-results', baseline ? 'upload-compatibility-baseline.json' : 'upload-compatibility.json'), JSON.stringify(report, null, 2));
    console.log('Upload compatibility summary:', JSON.stringify({ baseline, passed: results.filter(result => result.passed).length, total: results.length }));
    if (!baseline) assert.deepEqual(results.filter(result => !result.passed).map(result => result.name), [], 'all upload layouts, zoom factors and draft guards must pass');
  } finally {
    if (app) await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
