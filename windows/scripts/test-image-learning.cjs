'use strict';

const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { buildLessonPrompt } = require('../src/image-lessons.cjs');
const root = path.join(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'milo-image-integration-'));
const selectedImage = path.join(directory, 'selected-original.png');
const otherAttachment = path.join(directory, 'user-notes.pdf');
let app;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;overflow:hidden;font:16px/1.5 Arial}
nav{position:fixed;left:0;top:0;bottom:0;width:150px;background:#eee;padding:12px}
main{height:calc(100vh - 130px);margin-left:150px;overflow:auto}.mx-auto{max-width:620px;margin:auto}
article{padding:20px}footer{position:fixed;bottom:0;left:150px;right:0;padding:10px;background:white}
form{border:1px solid #aaa;padding:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#prompt-textarea{min-height:44px;max-height:130px;overflow:auto;flex:1;min-width:170px;white-space:pre-wrap}
button{min-height:36px;padding:8px}#previews{display:flex;gap:8px}#previews img{width:50px;height:40px;object-fit:contain}
</style></head><body>
<nav id="native-sidebar"><strong>ChatGPT</strong><button id="native-new">新對話</button></nav>
<main><article data-testid="conversation-turn-0"><div class="mx-auto"><div data-message-author-role="assistant"><p>A picture can help us learn English.</p></div></div></article></main>
<footer><form id="composer"><input id="lesson-file" type="file" accept="image/*" hidden><input id="foreign-file" type="file" accept="application/pdf" hidden>
<div id="previews"></div><span id="upload-progress" role="progressbar" hidden>Uploading</span>
<div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox"></div>
<button type="button" id="fixture-voice" aria-label="Start voice">Voice</button>
<button type="button" id="fixture-send" data-testid="send-button" disabled>Send</button></form></footer>
<script>
(() => {
  const file=document.getElementById('lesson-file'),editor=document.getElementById('prompt-textarea');
  const previews=document.getElementById('previews'),progress=document.getElementById('upload-progress'),send=document.getElementById('fixture-send');
  let generation=0,url=null;
  const state=window.__fixture={changes:[],foreignChanges:[],sent:[],uploadDelay:80,uploadReady:false};
  const update=()=>{send.disabled=!state.uploadReady||!editor.innerText.trim()};
  editor.addEventListener('input',update);
  state.clearDraft=()=>{generation++;editor.replaceChildren();previews.replaceChildren();progress.hidden=true;state.uploadReady=false;file.value='';if(url){URL.revokeObjectURL(url);url=null}update()};
  file.addEventListener('change',async event=>{
    const selected=file.files[0];if(!selected)return;
    state.lastFile=selected;
    const current=++generation;state.uploadReady=false;progress.hidden=false;update();
    state.changes.push({trusted:event.isTrusted,name:selected.name,type:selected.type,size:selected.size});
    const bytes=new Uint8Array(await selected.arrayBuffer());
    state.changes[state.changes.length-1].signature=[...bytes.slice(0,3)];
    await new Promise(resolve=>setTimeout(resolve,state.uploadDelay));
    if(current!==generation)return;
    if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(selected);
    const image=new Image();image.alt='Selected lesson image';image.src=url;previews.replaceChildren(image);
    progress.hidden=true;state.uploadReady=true;update();
  });
  document.getElementById('foreign-file').addEventListener('change',event=>{
    const selected=event.target.files[0];if(!selected)return;
    state.foreignChanges.push({trusted:event.isTrusted,name:selected.name,type:selected.type});
    const preview=document.createElement('div');preview.id='concurrent-user-file';preview.setAttribute('data-testid','file-preview');preview.textContent=selected.name;document.querySelector('form').appendChild(preview);
  });
  send.addEventListener('click',event=>{
    if(send.disabled)return;
    state.sent.push({text:editor.innerText,trusted:event.isTrusted,file:state.changes[state.changes.length-1]});
    editor.replaceChildren();previews.replaceChildren();state.uploadReady=false;progress.hidden=true;update();
    // Keep the same underlying File selection: production must reset value to
    // upload the same photo again, rather than relying on a remounted input.
  });
})();
</script></body></html>`;

async function chatEvaluate(source) {
  return app.evaluate(({ webContents }, code) => {
    const contents = webContents.getAllWebContents().find(item => item.getURL().startsWith('https://chatgpt.com/'));
    return contents ? contents.executeJavaScript(code) : null;
  }, source);
}
async function waitChat(source) {
  for (let i = 0; i < 150; i++) {
    if (await chatEvaluate(source)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Image fixture condition timed out: ' + source);
}
async function waitLesson(page, expected) {
  try {
    await page.waitForFunction(() => ['sent', 'error', 'cancelled'].includes(window.__imageState?.status) &&
      document.querySelector('#image-status').parentElement.dataset.busy === 'false', null, { timeout: 30000 });
  } catch (error) {
    const current = await page.evaluate(() => ({ status: window.__imageState?.status, error: window.__imageState?.error }));
    throw new Error('Image lesson did not settle: ' + JSON.stringify(current), { cause: error });
  }
  const actual = await page.evaluate(() => ({ status: window.__imageState.status, error: window.__imageState.error }));
  assert.equal(actual.status, expected, actual.error || 'Unexpected image lesson result');
}
async function resetLessonState(page) { await page.evaluate(() => { window.__imageState = null; }); }
async function normalizedFilePath() {
  return app.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents().find(item => item.getURL().startsWith('https://chatgpt.com/'));
    const ownsDebugger = !contents.debugger.isAttached();
    if (ownsDebugger) contents.debugger.attach('1.3');
    try {
      const { result } = await contents.debugger.sendCommand('Runtime.evaluate', { expression: 'window.__fixture.lastFile' });
      const { path } = await contents.debugger.sendCommand('DOM.getFileInfo', { objectId: result.objectId });
      return path;
    } finally { if (ownsDebugger) contents.debugger.detach(); }
  });
}
async function injectOtherAttachment() {
  await app.evaluate(async ({ webContents }, filePath) => {
    const contents = webContents.getAllWebContents().find(item => item.getURL().startsWith('https://chatgpt.com/'));
    const { root } = await contents.debugger.sendCommand('DOM.getDocument', { depth: 0 });
    const { nodeId } = await contents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#foreign-file' });
    await contents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [filePath] });
  }, otherAttachment);
}
const normalizedText = text => text.replace(/\s+/g, ' ').trim();

(async () => {
  try {
    await sharp({ create: { width: 33, height: 17, channels: 3, background: '#4d986d' } }).png().toFile(selectedImage);
    fs.writeFileSync(otherAttachment, '%PDF-1.4\n% local synthetic attachment for cancellation protection\n');
    const original = fs.readFileSync(selectedImage);
    app = await electron.launch({ args: [root, ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [])],
      env: { ...process.env, MILO_TEST_MODE: '1', MILO_TEST_DATA: path.join(directory, 'profile'), MILO_TEST_IMAGE: selectedImage }, timeout: 60000 });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1420, 1080));
    await page.waitForSelector('#image-tab');
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(() => window.milo.on(({ type, data }) => { if (type === 'image-lesson') window.__imageState = data; }));
    await app.evaluate(({ session }, source) => session.fromPartition('persist:milo-chat').protocol.handle('https',
      () => new Response(source, { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } })), html);
    await page.locator('#reload').click();
    await waitChat('!!window.__fixture && !!window.__miloCompactComposerV1');
    assert.equal(await chatEvaluate('typeof window.milo'), 'undefined', 'remote ChatGPT cannot call the local image API');
    assert.equal(await chatEvaluate('typeof require'), 'undefined');
    assert.equal(await chatEvaluate('document.getElementById("native-sidebar").getBoundingClientRect().width'), 150);
    await page.locator('#image-tab').click();

    const modes = [
      ['conversation', 'kuromi'], ['grammar', 'kuromi'], ['quiz', 'kuromi'],
      ['vocabulary', 'kuromi'], ['vocabulary', 'cinnamoroll']
    ];
    for (const [index, [mode, character]] of modes.entries()) {
      console.log('Checking image lesson:', mode, character);
      await page.locator(`input[name="image-mode"][value="${mode}"]`).check();
      if (mode === 'vocabulary') await page.locator(`input[name="image-character"][value="${character}"]`).check();
      await resetLessonState(page);
      await page.locator(index === 0 ? '#image-pick' : '#image-start').click();
      await waitLesson(page, 'sent');
      const sent = await chatEvaluate(`window.__fixture.sent[${index}]`);
      assert.equal(normalizedText(sent.text), normalizedText(buildLessonPrompt(mode, character)), 'selected lesson reaches the real editor intact');
      assert.equal(sent.trusted, true, 'send is an actual trusted pointer click');
      assert.equal(sent.file.trusted, true, 'CDP upload produces a trusted change event');
      assert.equal(sent.file.name, 'lesson.jpg'); assert.equal(sent.file.type, 'image/jpeg');
      assert.deepEqual(sent.file.signature, [255, 216, 255]);
      assert.ok(sent.file.size > 0 && sent.file.size <= 10 * 1024 * 1024);
      await waitChat('!window.__miloCompactComposerV1');
      assert.equal(await chatEvaluate('document.querySelector("#prompt-textarea").getAttribute("data-milo-composer-editor")'), null);
      assert.equal(await chatEvaluate('document.querySelector("#prompt-textarea").getClientRects().length > 0'), true, 'composer remains available for typed spelling and quiz answers');
      assert.equal(await page.locator('#focus').getAttribute('aria-pressed'), 'false');
      assert.equal(await chatEvaluate('document.getElementById("native-sidebar").getClientRects().length > 0'), true);
    }
    assert.equal(await chatEvaluate('window.__fixture.changes.length'), 5, 'same file can be attached repeatedly in the same chat');
    assert.equal(await chatEvaluate('window.__fixture.sent.length'), 5);
    const image = await page.evaluate(() => window.__imageState.image);
    assert.deepEqual(Object.keys(image).sort(), ['height', 'name', 'preview', 'width']);
    assert.equal(image.name, path.basename(selectedImage)); assert.equal(image.width, 33); assert.equal(image.height, 17);
    assert.match(image.preview, /^data:image\/jpeg;base64,/);
    assert.equal(JSON.stringify(image).includes(directory), false, 'local image paths stay out of shell metadata');
    assert.equal(await page.locator('#image-preview').getAttribute('src'), image.preview);
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    const screenshot = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
    fs.writeFileSync(path.join(root, 'test-results', 'image-learning.png'), Buffer.from(screenshot, 'base64'));
    const preparedPath = await normalizedFilePath();
    assert.equal(path.basename(preparedPath), 'lesson.jpg');
    assert.notEqual(preparedPath, selectedImage); assert.equal(fs.existsSync(preparedPath), true);
    assert.deepEqual(fs.readFileSync(selectedImage), original);

    // Some ChatGPT layouts keep their hidden file input outside the form. The
    // trusted plus-button click must open a real intercepted main-frame chooser.
    await chatEvaluate(`(() => {
      const file=document.getElementById('lesson-file');document.body.appendChild(file);
      const plus=document.createElement('button');plus.type='button';plus.id='chooser-plus';plus.setAttribute('data-testid','composer-plus-btn');plus.textContent='Add photos';
      window.__fixture.chooserClicks=[];plus.addEventListener('click',event=>{window.__fixture.chooserClicks.push(event.isTrusted);file.click()});
      document.querySelector('form').appendChild(plus);
    })()`);
    await page.locator('input[name="image-mode"][value="quiz"]').check();
    await resetLessonState(page);
    await page.locator('#image-start').click();
    await waitLesson(page, 'sent');
    const fallback = await chatEvaluate('window.__fixture.sent[5]');
    assert.equal(normalizedText(fallback.text), normalizedText(buildLessonPrompt('quiz', 'kuromi')));
    assert.equal(fallback.trusted, true); assert.equal(fallback.file.trusted, true);
    assert.equal(fallback.file.name, 'lesson.jpg');
    assert.deepEqual(await chatEvaluate('window.__fixture.chooserClicks'), [true]);
    assert.equal(await chatEvaluate('window.__fixture.changes.length'), 6);
    assert.equal(await chatEvaluate('document.getElementById("foreign-file").files.length'), 0, 'PDF-only input is never chosen for an image');
    await chatEvaluate('document.querySelector("form").prepend(document.getElementById("lesson-file"));document.getElementById("chooser-plus").remove()');
    const completed = 6;

    await chatEvaluate('document.getElementById("prompt-textarea").innerText="Keep this existing draft."');
    await resetLessonState(page);
    await page.evaluate(() => window.milo.startImageLesson('grammar', 'kuromi'));
    await waitLesson(page, 'error');
    assert.equal(await chatEvaluate('document.getElementById("prompt-textarea").innerText'), 'Keep this existing draft.');
    assert.equal(await chatEvaluate('window.__fixture.sent.length'), completed, 'a previous draft is preserved without another send');
    assert.equal(await chatEvaluate('window.__fixture.changes.length'), completed);
    await chatEvaluate(`(() => {window.__fixture.clearDraft();const attachment=document.createElement('div');attachment.id='user-file-preview';attachment.setAttribute('data-testid','file-preview');attachment.textContent='existing-notes.pdf';document.querySelector('form').appendChild(attachment)})()`);
    await resetLessonState(page);
    await page.evaluate(() => window.milo.startImageLesson('grammar', 'kuromi'));
    await waitLesson(page, 'error');
    assert.equal(await chatEvaluate('document.getElementById("user-file-preview").textContent'), 'existing-notes.pdf');
    assert.equal(await chatEvaluate('window.__fixture.sent.length'), completed, 'existing non-image attachments are also preserved');
    assert.equal(await chatEvaluate('window.__fixture.changes.length'), completed);
    await chatEvaluate('document.getElementById("user-file-preview").remove()');
    await chatEvaluate('window.__fixture.clearDraft();window.__fixture.uploadDelay=900');
    await page.locator('input[name="image-mode"][value="grammar"]').check();
    await resetLessonState(page);
    await page.locator('#image-start').click();
    await waitChat('window.__fixture.changes.length === 7');
    await injectOtherAttachment();
    await waitLesson(page, 'error');
    assert.equal(await chatEvaluate('window.__fixture.foreignChanges[0].trusted'), true);
    assert.equal(await chatEvaluate('document.getElementById("concurrent-user-file").textContent'), path.basename(otherAttachment));
    assert.equal(await chatEvaluate('document.getElementById("foreign-file").files.length'), 1, 'the user-added PDF remains untouched');
    assert.equal(await chatEvaluate('window.__fixture.sent.length'), completed, 'another file added during upload prevents automatic sending');
    await chatEvaluate('document.getElementById("concurrent-user-file").remove();document.getElementById("foreign-file").value=""');
    await chatEvaluate('window.__fixture.clearDraft();window.__fixture.uploadDelay=900');
    await page.locator('input[name="image-mode"][value="grammar"]').check();
    await resetLessonState(page);
    await page.locator('#image-start').click();
    await waitChat('window.__fixture.changes.length === 8');
    await page.locator('#image-cancel').click();
    await waitLesson(page, 'cancelled');
    await page.waitForTimeout(1100);
    assert.equal(await chatEvaluate('window.__fixture.sent.length'), completed, 'cancellation prevents sending even if the upload later completes');
    await waitChat('!window.__miloCompactComposerV1');
    assert.equal(await chatEvaluate('document.querySelector("#prompt-textarea").getClientRects().length > 0'), true, 'cancelled uploads leave the composer available for inspection');
    await page.locator('#image-clear').click();
    await page.waitForFunction(() => window.__imageState?.image === null && document.querySelector('#image-status').parentElement.dataset.busy === 'false');
    assert.equal(fs.existsSync(path.dirname(preparedPath)), false, 'clearing the image removes its normalized temporary file');
    assert.equal(await page.locator('#image-preview').getAttribute('src'), null);
    assert.deepEqual(fs.readFileSync(selectedImage), original);
    const invalid = await page.evaluate(() => window.milo.pickImage('unknown-mode', 'kuromi'));
    assert.match(invalid.error, /有效/); assert.equal(await chatEvaluate('window.__fixture.sent.length'), completed);
    assert.deepEqual(errors, []);
    const report = { modes: modes.map(([mode, character]) => ({ mode, character })), sent: completed, trustedUploads: 8,
      mainFrameFileChooserFallback: true, repeatedSameImage: true, composerAvailableForAnswers: true, nativeSidebarVisible: true, localPathPrivate: true,
      draftPreserved: true, existingAttachmentPreserved: true, concurrentOtherFilePreventsSend: true,
      cancellationPreventsSend: true, temporaryImageRemoved: true, originalPreserved: true,
      limitation: 'Synthetic ChatGPT DOM: actual Electron CDP, image normalization, editor input and pointer events; no logged-in ChatGPT upload/server verification.' };
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    fs.writeFileSync(path.join(root, 'test-results', 'image-learning.json'), JSON.stringify(report, null, 2));
    console.log('Image learning integration passed:', JSON.stringify(report));
  } finally {
    if (app) await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
