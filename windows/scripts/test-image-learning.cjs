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

const { html } = require('./fixtures/image-learning.cjs');

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

    const modes = ['conversation', 'grammar', 'quiz'];
    for (const [index, mode] of modes.entries()) {
      console.log('Checking image lesson:', mode);
      await page.locator(`input[name="image-mode"][value="${mode}"]`).check();
      await resetLessonState(page);
      await page.locator(index === 0 ? '#image-pick' : '#image-start').click();
      await waitLesson(page, 'sent');
      const sent = await chatEvaluate(`window.__fixture.sent[${index}]`);
      assert.equal(normalizedText(sent.text), normalizedText(buildLessonPrompt(mode)), 'selected lesson reaches the real editor intact');
      assert.equal(sent.trusted, true, 'send is an actual trusted pointer click');
      assert.equal(sent.file.trusted, true, 'CDP upload produces a trusted change event');
      assert.equal(sent.file.name, 'lesson.jpg'); assert.equal(sent.file.type, 'image/jpeg');
      assert.deepEqual(sent.file.signature, [255, 216, 255]);
      assert.ok(sent.file.size > 0 && sent.file.size <= 10 * 1024 * 1024);
      await waitChat('!window.__miloCompactComposerV1');
      assert.equal(await chatEvaluate('document.querySelector("#prompt-textarea").getAttribute("data-milo-composer-editor")'), null);
      assert.equal(await chatEvaluate('document.querySelector("#prompt-textarea").getClientRects().length > 0'), true, 'composer remains available for typed lesson answers');
      assert.equal(await page.locator('#focus').getAttribute('aria-pressed'), 'false');
      assert.equal(await chatEvaluate('document.getElementById("native-sidebar").getClientRects().length > 0'), true);
    }
    assert.equal(await chatEvaluate('window.__fixture.changes.length'), 3, 'same file can be attached repeatedly in the same chat');
    assert.equal(await chatEvaluate('window.__fixture.sent.length'), 3);
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
    const fallback = await chatEvaluate('window.__fixture.sent[3]');
    assert.equal(normalizedText(fallback.text), normalizedText(buildLessonPrompt('quiz')));
    assert.equal(fallback.trusted, true); assert.equal(fallback.file.trusted, true);
    assert.equal(fallback.file.name, 'lesson.jpg');
    assert.deepEqual(await chatEvaluate('window.__fixture.chooserClicks'), [true]);
    assert.equal(await chatEvaluate('window.__fixture.changes.length'), 4);
    assert.equal(await chatEvaluate('document.getElementById("foreign-file").files.length'), 0, 'PDF-only input is never chosen for an image');
    await chatEvaluate('document.querySelector("form").prepend(document.getElementById("lesson-file"));document.getElementById("chooser-plus").remove()');
    const completed = 4;

    await chatEvaluate('document.getElementById("prompt-textarea").innerText="Keep this existing draft."');
    await resetLessonState(page);
    await page.evaluate(() => window.milo.startImageLesson('grammar'));
    await waitLesson(page, 'error');
    assert.equal(await chatEvaluate('document.getElementById("prompt-textarea").innerText'), 'Keep this existing draft.');
    assert.equal(await chatEvaluate('window.__fixture.sent.length'), completed, 'a previous draft is preserved without another send');
    assert.equal(await chatEvaluate('window.__fixture.changes.length'), completed);
    await chatEvaluate(`(() => {window.__fixture.clearDraft();const attachment=document.createElement('div');attachment.id='user-file-preview';attachment.setAttribute('data-testid','file-preview');attachment.textContent='existing-notes.pdf';document.querySelector('form').appendChild(attachment)})()`);
    await resetLessonState(page);
    await page.evaluate(() => window.milo.startImageLesson('grammar'));
    await waitLesson(page, 'error');
    assert.equal(await chatEvaluate('document.getElementById("user-file-preview").textContent'), 'existing-notes.pdf');
    assert.equal(await chatEvaluate('window.__fixture.sent.length'), completed, 'existing non-image attachments are also preserved');
    assert.equal(await chatEvaluate('window.__fixture.changes.length'), completed);
    await chatEvaluate('document.getElementById("user-file-preview").remove()');
    await chatEvaluate('window.__fixture.clearDraft();window.__fixture.uploadDelay=900');
    await page.locator('input[name="image-mode"][value="grammar"]').check();
    await resetLessonState(page);
    await page.locator('#image-start').click();
    await waitChat('window.__fixture.changes.length === 5');
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
    await waitChat('window.__fixture.changes.length === 6');
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
    const invalid = await page.evaluate(() => window.milo.pickImage('unknown-mode'));
    assert.match(invalid.error, /有效/); assert.equal(await chatEvaluate('window.__fixture.sent.length'), completed);
    assert.deepEqual(errors, []);
    const report = { modes, sent: completed, trustedUploads: 6,
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
