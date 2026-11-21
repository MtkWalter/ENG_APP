'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.join(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'milo-no-games-'));
const channels = ['answer', 'hint', 'next', 'feed', 'speak', 'restart', 'topic', 'text'].map(name => 'shell:game-' + name);
const gameMethods = ['answerGame', 'hintGame', 'nextGame', 'feedGame', 'speakGame', 'restartGame', 'startGameTopic', 'startGameText'];
const gameRuntime = [
  'src/learning-game.cjs', 'src/game-material.cjs', 'src/game-material-builder.cjs', 'src/game-material-worker.cjs',
  'src/image-ocr.cjs', 'src/image-ocr-worker.cjs', 'assets/ocr-sample.png',
  'assets/game-kuromi.png', 'assets/game-cinnamoroll.png'
];
const probe = path.join(directory, 'ipc-probe.cjs');
const entry = path.join(directory, 'entry.cjs');
fs.writeFileSync(probe, "const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('__noGamesProbe',{invoke:channel=>ipcRenderer.invoke(channel)});");
fs.writeFileSync(entry, "const{app,session}=require('electron');app.whenReady().then(()=>session.defaultSession.setPreloads([" + JSON.stringify(probe) + "]));require(" + JSON.stringify(path.join(root, 'src/main.cjs')) + ");");
let app;
(async () => {
  try {
    // Checking the runtime and lockfile prevents a future UI-only hiding change
    // from silently bringing heavy game/OCR code back into the installer.
    for (const name of gameRuntime) assert.equal(fs.existsSync(path.join(root, name)), false, name + ' is removed from the application');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    for (const name of ['tesseract.js', 'tesseract.js-core', '@tesseract.js-data/eng']) {
      assert.equal(Object.hasOwn(manifest.dependencies, name), false, name + ' is not a runtime dependency');
      assert.equal(Object.hasOwn(lock.packages, 'node_modules/' + name), false, name + ' is absent from the locked runtime');
    }

    app = await electron.launch({ args: [entry, ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [])],
      env: { ...process.env, MILO_TEST_MODE: '1', MILO_TEST_DATA: path.join(directory, 'profile') }, timeout: 60000 });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('#search');
    await page.waitForFunction(() => !!window.__noGamesProbe && !!window.milo);
    const initial = await page.evaluate(() => window.milo.state());
    assert.equal(Object.hasOwn(initial, 'game'), false, 'shell state has no game controller or progress');
    assert.equal(initial.imageLesson.mode, 'conversation');
    for (const name of gameMethods) assert.equal(await page.evaluate(name => typeof window.milo[name], name), 'undefined', name + ' is not exposed by the production shell bridge');
    for (const name of ['lookup', 'speech', 'testSpeech', 'stopSpeech', 'prepareTranslation', 'pickImage', 'startImageLesson']) {
      assert.equal(await page.evaluate(name => typeof window.milo[name], name), 'function', name + ' remains available');
    }
    const rejectedChannels = [];
    for (const channel of channels) {
      const outcome = await page.evaluate(async channel => {
        try { return { fulfilled: true, value: await window.__noGamesProbe.invoke(channel) }; }
        catch (error) { return { fulfilled: false, error: error.message }; }
      }, channel);
      assert.equal(outcome.fulfilled, false, channel + ' cannot be called even by the trusted shell');
      assert.match(outcome.error, /No handler registered/i);
      rejectedChannels.push(channel);
    }

    await page.locator('#search').fill('new'); await page.locator('#search-form button').click();
    await page.waitForFunction(() => document.getElementById('chinese').textContent.includes('新的'));
    assert.match(await page.locator('#kk').textContent(), /nu/);
    assert.equal(await page.locator('#speak').isVisible(), true);
    assert.equal(await page.locator('#slow').isVisible(), true);
    assert.equal(await page.locator('#stop').isVisible(), true);

    await page.locator('#image-tab').click();
    assert.equal(await page.locator('#image-modes').isVisible(), true);
    assert.deepEqual(await page.locator('input[name="image-mode"]').evaluateAll(nodes => nodes.map(node => node.value)), ['conversation', 'grammar', 'quiz']);
    for (const selector of ['#image-game', '#game-library', '#game-settings', '#game-text', '#game-text-backup', '#image-characters', '#image-game-styles']) {
      assert.equal(await page.locator(selector).count(), 0, selector + ' has been removed');
    }
    const rejectedMode = await page.evaluate(() => window.milo.startImageLesson('vocabulary'));
    assert.match(rejectedMode.error, /有效|不支援/);

    // The test-only probe uses the shell's default session. The website keeps
    // its production isolated session and cannot access either native bridge.
    await app.evaluate(({ session }) => session.fromPartition('persist:milo-chat').protocol.handle('https',
      () => new Response('<!doctype html><title>Chat fixture</title><main>English learning remains available.</main>', { headers: { 'content-type': 'text/html' } })));
    await page.locator('#reload').click();
    let remote;
    for (let attempt = 0; attempt < 100; attempt++) {
      remote = await app.evaluate(async ({ webContents }) => {
        const chat = webContents.getAllWebContents().find(item => item.getURL().startsWith('https://chatgpt.com/'));
        return chat ? chat.executeJavaScript('({ready:document.readyState,milo:typeof window.milo,probe:typeof window.__noGamesProbe,require:typeof require})') : null;
      });
      if (remote?.ready === 'complete') break;
      await page.waitForTimeout(50);
    }
    assert.equal(remote?.ready, 'complete');
    assert.equal(remote.milo, 'undefined'); assert.equal(remote.probe, 'undefined'); assert.equal(remote.require, 'undefined');
    assert.deepEqual(errors, []);
    const report = { ok: true, gameRuntimeRemoved: gameRuntime.length, gameDependenciesRemoved: true,
      legacyGameChannelsRejected: rejectedChannels, nativeGameBridgeAbsent: true,
      retainedImageModes: ['conversation', 'grammar', 'quiz'], dictionaryLookupWorks: true,
      dictionarySpeechControlsRetained: true, remoteNativeAccessDenied: true };
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    fs.writeFileSync(path.join(root, 'test-results', 'no-games.json'), JSON.stringify(report, null, 2));
    console.log('Game removal and retained learning functionality passed:', report);
  } finally { if (app) await app.close(); fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
