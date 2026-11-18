'use strict';

const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.join(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'milo-game-reader-'));
const oldPack = 'MILO_GAME_PACK_V1\n{"source":"old history"}\nMILO_GAME_PACK_END';
const freshPack = 'MILO_GAME_PACK_V1\n{"source":"fresh image","words":["garden","flower"]}\nMILO_GAME_PACK_END';
const requestId = 'bc682aac-b8e1-4a43-ad16-f98c63b54087';
const oldRequest = 'd845d118-f05f-432a-9fb5-40c37f61cb32';
const ownPrompt = 'Prepare an image learning game for the selected photo.';
const history = Array.from({ length: 2100 }, (_, i) => `<article data-testid="conversation-turn-${i}"><div data-message-id="old-${i}" data-message-author-role="assistant"><p>${i === 2099 ? oldPack : 'Earlier English lesson ' + i}</p></div></article>`).join('');
const fixturePath = path.join(directory, 'fixture.html');
fs.writeFileSync(fixturePath, '<!doctype html><meta charset="utf-8"><main>' + history + '</main>');
const entry = path.join(directory, 'app.cjs');
fs.writeFileSync(entry, `const{app,BrowserWindow,protocol}=require('electron');const fs=require('node:fs');globalThis.__readerModule=require(${JSON.stringify(path.join(root, 'src/game-pack-reader.cjs'))});app.whenReady().then(async()=>{await protocol.handle('https',()=>new Response(fs.readFileSync(${JSON.stringify(fixturePath)}),{headers:{'content-type':'text/html'}}));globalThis.__window=new BrowserWindow({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});await __window.loadURL('https://chatgpt.com/');});`);
let app, page;

async function begin(timeout = 6000, correlated = false) {
  await app.evaluate(async ({ BrowserWindow }, options) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    globalThis.__readerAbort = new AbortController();
    globalThis.__readerSettled = false;
    globalThis.__reader = await globalThis.__readerModule.createGamePackReader(contents, { signal: __readerAbort.signal, ...options });
    globalThis.__readerOutcome = __reader.result.then(text => {
      __readerSettled = true; return { ok: true, text };
    }, error => {
      __readerSettled = true; return { ok: false, code: error.code, name: error.name };
    });
  }, { timeout, ...(correlated ? { requestId, expectedPrompt: ownPrompt } : {}) });
}
async function outcome() { return app.evaluate(() => globalThis.__readerOutcome); }
async function stop() { await app.evaluate(() => globalThis.__reader.stop()); }
async function assertCleaned() {
  const count = await app.evaluate(async ({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    return contents.executeJavaScriptInIsolatedWorld(1849, [{ code: 'Object.keys(window).filter(key=>key.startsWith("__miloGamePackReader_")).length' }]);
  });
  assert.equal(count, 0, 'isolated observer state is removed');
}
async function appendAssistant(text) {
  await page.evaluate(text => {
    const article = document.createElement('article');
    const message = document.createElement('div'); message.setAttribute('data-message-author-role', 'assistant'); message.textContent = text;
    article.appendChild(message); document.querySelector('main').appendChild(article);
  }, text);
}

(async () => {
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [entry, ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [])],
      env: { ...process.env }, timeout: 60000 });
    page = await app.firstWindow(); await page.waitForSelector('main', { state: 'attached' });
    // Instrument inside the same isolated world as production. Page prototypes
    // belong to another world and cannot observe or interfere with the reader.
    await app.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      await contents.executeJavaScriptInIsolatedWorld(1849, [{ code: `(() => {
        const query=document.querySelectorAll.bind(document),descriptor=Object.getOwnPropertyDescriptor(Node.prototype,'textContent');
        window.__readerMetrics={historyScans:0,messageReads:0};
        document.querySelectorAll=function(selector){if(selector==='[data-message-author-role]')window.__readerMetrics.historyScans++;return query(selector)};
        Object.defineProperty(Node.prototype,'textContent',{...descriptor,get(){if(this.nodeType===1&&this.getAttribute('data-message-author-role')==='assistant')window.__readerMetrics.messageReads++;return descriptor.get.call(this)}});
      })()` }]);
    });
    await begin(6000, true);
    await page.waitForTimeout(400);
    assert.equal(await app.evaluate(() => globalThis.__readerSettled), false, 'a valid pack in old history is ignored');
    await page.evaluate(({ old, ownPrompt, oldRequest }) => {
      const remounted=document.querySelector('[data-message-id="old-2099"]').parentElement.cloneNode(true);document.querySelector('main').appendChild(remounted);
      const user = document.createElement('div'); user.setAttribute('data-message-author-role', 'user'); user.textContent = old;
      document.querySelector('main').appendChild(user);
      const own=document.createElement('div');own.id='own-user';own.setAttribute('data-message-author-role','user');own.textContent=ownPrompt;document.querySelector('main').appendChild(own);
      const mismatch=document.createElement('div');mismatch.setAttribute('data-message-author-role','assistant');mismatch.textContent='MILO_GAME_REQUEST:'+oldRequest+'\n'+old;document.querySelector('main').appendChild(mismatch);
    }, { old: oldPack, ownPrompt, oldRequest });
    await page.waitForTimeout(400);
    assert.equal(await app.evaluate(() => globalThis.__readerSettled), false, 'remounted history and a different request identifier are ignored');
    await page.evaluate(() => {const article=document.createElement('article');article.id='new-turn';document.querySelector('main').appendChild(article)});
    await page.waitForTimeout(80);
    await page.evaluate(requestId => {
      const assistant = document.createElement('div'); assistant.setAttribute('data-message-author-role', 'assistant');
      const pre = document.createElement('pre'); pre.id = 'fresh-pack'; pre.textContent = 'MILO_GAME_REQUEST:'+requestId+'\nMILO_GAME_PACK_V1\n'; assistant.appendChild(pre);
      document.getElementById('new-turn').appendChild(assistant);
      history.pushState({}, '', '/c/created-after-first-send');
    }, requestId);
    const payload = freshPack.slice('MILO_GAME_PACK_V1\n'.length, -'MILO_GAME_PACK_END'.length);
    await page.evaluate(async payload => {
      const pre = document.getElementById('fresh-pack');
      for (let i = 0; i < payload.length; i++) {
        if (i % 2) pre.lastChild.firstChild.data += payload[i];
        else { const chunk = document.createElement('span'); chunk.textContent = payload[i]; pre.appendChild(chunk); }
        await new Promise(resolve => setTimeout(resolve, 16));
      }
    }, payload);
    assert.equal(await app.evaluate(() => globalThis.__readerSettled), false, 'partial JSON and incomplete markers never complete a pack');
    await page.evaluate(() => document.getElementById('fresh-pack').appendChild(document.createTextNode('MILO_GAME_PACK_END')));
    const first = await outcome();
    assert.equal(first.ok, true); assert.equal(first.text, freshPack);
    const metrics = await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents
      .executeJavaScriptInIsolatedWorld(1849, [{ code: 'window.__readerMetrics' }]));
    assert.equal(metrics.historyScans, 1, '2100 historical replies are scanned only during initial baseline capture');
    assert.ok(metrics.messageReads <= 10, 'new reply text is read at most once per throttled batch');
    await assertCleaned();
    const concealed=await app.evaluate((_electron,prompt)=>globalThis.__reader.conceal(prompt),ownPrompt);
    assert.deepEqual(concealed,{concealed:true,userConcealed:true});
    assert.equal(await page.evaluate(()=>document.getElementById('fresh-pack').parentElement.style.display),'none');
    assert.equal(await page.evaluate(()=>document.getElementById('own-user').style.display),'none');
    assert.equal(await page.evaluate(()=>document.querySelector('[data-message-id="old-2099"]').style.display),'','old historical roles are unchanged');
    await page.evaluate(()=>document.querySelector('[data-milo-game-pack-toggle]').click());
    assert.equal(await page.evaluate(()=>document.getElementById('fresh-pack').parentElement.style.display),'');
    assert.equal(await page.evaluate(()=>document.getElementById('own-user').textContent),ownPrompt);
    await page.evaluate(()=>document.querySelector('[data-milo-game-pack-toggle]').click());
    await stop();
    assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-milo-game-pack-token]').length),0);
    assert.equal(await page.evaluate(()=>document.getElementById('fresh-pack').parentElement.style.display),'none','stopping the reader keeps the local presentation choice');

    await begin(90);
    const timeout = await outcome(); assert.deepEqual(timeout, { ok: false, code: 'timeout', name: 'TimeoutError' });
    await stop(); await assertCleaned();
    await begin();
    await app.evaluate(() => globalThis.__readerAbort.abort());
    assert.deepEqual(await outcome(), { ok: false, code: 'cancelled', name: 'AbortError' });
    await stop(); await assertCleaned();

    await begin();
    await page.evaluate(() => history.pushState({}, '', '/c/another-conversation'));
    assert.deepEqual(await outcome(), { ok: false, code: 'navigation', name: 'Error' });
    await stop(); await assertCleaned();
    await begin();
    await page.reload();
    assert.deepEqual(await outcome(), { ok: false, code: 'navigation', name: 'Error' });
    await stop(); await assertCleaned();

    await begin();
    await appendAssistant('MILO_GAME_PACK_V1\n' + 'x'.repeat(50001));
    assert.deepEqual(await outcome(), { ok: false, code: 'large', name: 'Error' });
    await stop(); await assertCleaned();
    const report = { historicalReplies: 2100, ...metrics, oldPackIgnored: true, remountedHistoryIgnored:true, requestIdentifierChecked:true, matchingUserBoundary:true, userQuoteIgnored: true,
      stagedAssistantMount: true, mixedFormattedStreaming: true, completeMarkerRequired: true,
      firstConversationRouteAllowed: true, laterConversationSwitchCancels: true, navigationCancels: true,
      timeoutHandled: true, abortHandled: true, boundedPack: true, observerStateCleaned: true, presentationTogglePreservesHistory:true,
      limitation: 'Actual Electron isolated-world DOM lifecycle with synthetic ChatGPT replies; no logged-in ChatGPT generation verified.' };
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    fs.writeFileSync(path.join(root, 'test-results', 'game-pack-reader.json'), JSON.stringify(report, null, 2));
    console.log('Game pack reader passed:', JSON.stringify(report));
  } finally {
    if (app) await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
