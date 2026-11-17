'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.join(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'milo-desktop-'));
// Upgrade from 2.0.1: the obsolete saved preference must not hide website controls.
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ showSidebar: false }));
let app;
async function search(page, text) {
  await page.locator('#search').fill(text);
  await page.locator('#search-form button').click();
}
async function waitText(page, selector, part) {
  await page.waitForFunction(({ selector, part }) => document.querySelector(selector)?.textContent.includes(part), { selector, part });
}
async function chatEvaluate(source) {
  return app.evaluate(({ webContents }, source) => {
    const chat = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('https://chatgpt.com/'));
    return chat ? chat.executeJavaScript(source) : null;
  }, source);
}
async function waitChat(source) {
  for (let i = 0; i < 100; i++) {
    if (await chatEvaluate(source)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Chat page condition timed out: ' + source);
}
async function clickChat(selector) {
  await app.evaluate(({ webContents }) => {
    const chat = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('https://chatgpt.com/'));
    chat.focus();
    chat.sendInputEvent({ type: 'mouseWheel', x: 150, y: 150, deltaY: -500, deltaX: 0 });
  });
  await new Promise(resolve => setTimeout(resolve, 150));
  await chatEvaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`);
  await new Promise(resolve => setTimeout(resolve, 100));
  const rect = await chatEvaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  await app.evaluate(({ webContents }, point) => {
    const chat = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('https://chatgpt.com/'));
    chat.focus();
    chat.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    chat.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  }, rect);
}
(async () => {
  try {
    app = await electron.launch({ args: [root, ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [])],
      env: { ...process.env, MILO_TEST_MODE: '1', MILO_TEST_DATA: data }, timeout: 60000 });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1320, 900));
    await page.waitForSelector('#search');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await waitText(page, '#dictionary-status', '125,112');
    await search(page, 'new');
    await waitText(page, '#chinese', '新的');
    assert.match(await page.locator('#kk').textContent(), /nu/);
    await search(page, 'zzzzmilonotaword');
    await waitText(page, '#kk', '尚未收錄');
    await search(page, 'A good book can open a world of ideas.');
    await waitText(page, '#chinese', '下載');
    assert.equal(await page.locator('#kk').isVisible(), false);
    await page.locator('#clear').click();
    assert.equal(await page.locator('#welcome').isVisible(), true);
    await search(page, '中文');
    await waitText(page, '#search-error', '請輸入英文');
    await app.evaluate(({ session }, html) => {
      session.fromPartition('persist:milo-chat').protocol.handle('https', () => new Response(html, { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } }));
    }, fs.readFileSync(path.join(root, 'test/chat-fixture.html'), 'utf8'));
    await page.locator('#reload').click();
    await waitChat(`document.querySelector('#prompt-textarea')?.getAttribute('data-milo-composer-editor') === '1'`);
    assert.equal(await chatEvaluate(`document.querySelector('#voice').getClientRects().length > 0`), true);
    assert.equal(await chatEvaluate(`document.querySelector('#attach').getClientRects().length > 0`), false);
    assert.equal(await chatEvaluate(`typeof require`), 'undefined');
    await waitChat(`document.querySelector('#thread-width').hasAttribute('data-milo-wide-text')`);
    assert.equal(await chatEvaluate(`document.querySelector('#stage-sidebar').getClientRects().length > 0`), true);
    assert.equal(await chatEvaluate(`document.querySelector('#sidebar-toggle').getClientRects().length > 0`), true);
    assert.equal(await chatEvaluate(`document.querySelectorAll('[data-milo-sidebar-hidden]').length`), 0);
    assert.equal(await chatEvaluate(`getComputedStyle(document.querySelector('#thread-width')).maxWidth`), 'none');
    const expandedWidth = await chatEvaluate(`document.querySelector('#thread-width').getBoundingClientRect().width`);
    await clickChat('#sidebar-toggle');
    await waitChat(`document.querySelector('#stage-sidebar').getClientRects().length === 0`);
    await chatEvaluate(`(() => { const old=document.querySelector('#stage-sidebar'); const next=old.cloneNode(true); old.remove(); document.body.prepend(next); })()`);
    await waitChat(`document.querySelector('#stage-sidebar').getClientRects().length === 0`);
    assert.ok(await chatEvaluate(`document.querySelector('#thread-width').getBoundingClientRect().width`) > expandedWidth + 100);
    await clickChat('#sidebar-toggle');
    await waitChat(`document.querySelector('#stage-sidebar').getClientRects().length > 0`);
    await clickChat('#new-word');
    await waitText(page, '#english', 'new');
    await waitText(page, '#chinese', '新的');
    await clickChat('#split-word');
    await waitText(page, '#english', 'beautiful');
    await page.locator('#focus').click();
    await waitChat(`!document.querySelector('#prompt-textarea').hasAttribute('data-milo-composer-editor')`);
    assert.equal(await chatEvaluate(`document.querySelector('#attach').getClientRects().length > 0`), true);
    await page.locator('#focus').click();
    await waitChat(`document.querySelector('#prompt-textarea').hasAttribute('data-milo-composer-editor')`);
    await chatEvaluate(`(() => {
      const element = document.querySelector('#sentence');
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    })()`);
    await app.evaluate(({ webContents }) => {
      const chat = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('https://chatgpt.com/'));
      chat.focus();
      chat.sendInputEvent({ type: 'keyUp', keyCode: 'Right', modifiers: ['shift'] });
    });
    await waitText(page, '#english', 'A good book');
    assert.equal(await page.locator('#kk').isVisible(), false);
    await chatEvaluate('getSelection().removeAllRanges()');
    if (process.platform === 'linux') {
      await page.locator('#speak').click();
      await waitText(page, '#speech-note', '只在 Windows');
    }
    await page.locator('#larger').click();
    await waitText(page, '#zoom', '110%');
    await page.locator('#smaller').click();
    await waitText(page, '#zoom', '100%');
    await search(page, 'new'); await waitText(page, '#chinese', '新的');
    await page.waitForTimeout(200);
    const image = await app.evaluate(async ({ BrowserWindow }) => {
      return (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64');
    });
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    fs.writeFileSync(path.join(root, 'test-results/windows-shell.png'), Buffer.from(image, 'base64'));
    await app.evaluate(async ({ session }) => {
      await session.fromPartition('persist:milo-chat').clearCache();
      const protocol = session.fromPartition('persist:milo-chat').protocol;
      protocol.unhandle('https'); protocol.handle('https', () => Response.error());
    });
    await page.locator('#reload').click();
    await waitText(page, '#chat-message', '無法載入');
    await search(page, 'book');
    await waitText(page, '#chinese', '書');
    assert.deepEqual(errors, []);
    console.log('Desktop checks passed: real dictionary, missing words, sentence selection, click across inline elements, focus toggle, zoom, clearing, network failure, offline lookup, UI screenshot.');
  } finally {
    if (app) await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
