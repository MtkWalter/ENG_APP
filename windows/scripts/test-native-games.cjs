'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { builtinMaterial, materialFromText, GAME_TOPICS } = require('../src/game-material.cjs');
const { loadDictionary } = require('../src/dictionary.cjs');
const { validateWave } = require('../src/speech.cjs');
const { html } = require('./fixtures/image-learning.cjs');
const root = path.join(__dirname, '..'), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'milo-local-games-'));
const selectedImage = path.join(directory, 'my-english-picture.png');
let app, page, dictionary, source = builtinMaterial().pack;
const snapshot = () => page.evaluate(() => window.__gameState);
const waitGame = predicate => page.waitForFunction(predicate => Function('state', 'return (' + predicate + ')')(window.__gameState), predicate);
const waitImage = status => page.waitForFunction(status => window.__imageState?.status === status &&
  document.querySelector('#image-status').parentElement.dataset.busy === 'false', status);
async function chatEvaluate(code) {
  return app.evaluate(({ webContents }, code) => webContents.getAllWebContents()
    .find(item => item.getURL().startsWith('https://chatgpt.com/'))?.executeJavaScript(code), code);
}
function expected(state) {
  const index = Number(state.task.id.split('-')[1]);
  return state.task.kind === 'memory' ? source.words[index].meaning : state.task.kind === 'spelling' ? source.words[index].word : source.patterns[index].answer;
}
async function answer() {
  const state = await snapshot(), target = expected(state);
  if (state.task.choices?.length) await page.locator('#game-choices').getByRole('button', { name: target, exact: true }).click();
  else { await page.locator('#game-answer').fill(target); await page.locator('#game-submit').click(); }
  await waitGame('state.canNext === true');
}
async function next() {
  const before = await snapshot();
  await page.locator('#game-next').click();
  await waitGame('state.complete || (!state.canNext && state.task.id !== ' + JSON.stringify(before.task.id) + ')');
}
async function restart(style, character = 'kuromi') {
  const round = (await snapshot()).round;
  await page.locator('#game-settings').evaluate(node => { node.open = true; });
  await page.locator('input[name="image-game-style"][value="' + style + '"]').check();
  await page.locator('input[name="image-character"][value="' + character + '"]').check();
  await page.locator('#game-settings').evaluate(node => { node.open = false; });
  await page.locator('#game-restart').click();
  await waitGame('state.round > ' + round + ' && state.style === ' + JSON.stringify(style));
}
async function monitorGrid() {
  await page.evaluate(() => {
    window.__gridWrites = 0;
    window.__gridObserver?.disconnect();
    window.__gridObserver = new MutationObserver(records => { window.__gridWrites += records.length; });
    window.__gridObserver.observe(document.getElementById('game-puzzle-grid'), { childList: true });
  });
}
async function capture(name) {
  await page.locator('#image-game').scrollIntoViewIfNeeded();
  await page.locator('#image-game').screenshot({ path: path.join(root, 'test-results', name) });
}
(async () => {
  try {
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    fs.copyFileSync(path.join(root, 'assets', 'ocr-sample.png'), selectedImage);
    dictionary = await loadDictionary(path.join(root, 'assets', 'android'));
    app = await electron.launch({ args: [root, ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [])],
      env: { ...process.env, MILO_TEST_MODE: '1', MILO_TEST_DATA: path.join(directory, 'profile'), MILO_TEST_IMAGE: selectedImage }, timeout: 60000 });
    page = await app.firstWindow();
    await page.waitForSelector('#image-tab');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1320, 1050));
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(async () => {
      const initial = await window.milo.state(); window.__gameState = initial.game; window.__imageState = initial.imageLesson;
      window.milo.on(({ type, data }) => { if (type === 'game') window.__gameState = data; if (type === 'image-lesson') window.__imageState = data; if (type === 'lookup') window.__lookupState = data; });
    });
    await waitGame('state.status === "ready" && state.material.source === "builtin"');
    assert.equal(await page.locator('#image-panel').isVisible(), true);
    assert.equal(await page.locator('#game-play').isVisible(), true, 'game exists before visiting or logging into ChatGPT');
    assert.equal((await snapshot()).progress.total, 15);

    await app.evaluate(({ session }, html) => session.fromPartition('persist:milo-chat').protocol.handle('https',
      () => new Response(html, { headers: { 'content-type': 'text/html' } })), html);
    await page.locator('#reload').click();
    for (let i = 0; i < 100 && !await chatEvaluate('!!window.__fixture'); i++) await page.waitForTimeout(50);
    // Simulate an occupied AI composer. Local games must leave it untouched.
    await chatEvaluate('document.getElementById("prompt-textarea").innerText="Keep my existing chat draft.";document.getElementById("fixture-send").disabled=true');
    const focus = await page.locator('#focus').getAttribute('aria-pressed');
    const initial = await snapshot();
    const wrong = initial.task.choices.find(choice => choice !== expected(initial));
    await page.locator('#game-choices').getByRole('button', { name: wrong, exact: true }).click();
    await waitGame('state.feedback?.correct === false');
    assert.equal((await snapshot()).progress.stars, 0);
    await monitorGrid();
    await page.locator('#game-hint').click();
    await page.waitForTimeout(70);
    const hiddenGridRebuilds = await page.evaluate(() => window.__gridWrites);
    assert.equal(hiddenGridRebuilds, 0);
    await answer();
    const earned = await snapshot();
    await page.evaluate(value => window.milo.answerGame(value), expected(initial));
    assert.deepEqual((await snapshot()).progress, earned.progress, 'a completed task cannot earn duplicate rewards');
    await next();
    const phases = new Set();
    while (!(await snapshot()).complete) {
      const current = await snapshot(); phases.add(current.task.kind);
      if (current.task.kind === 'spelling' && current.task.id === 'spelling-0') {
        assert.equal(await page.locator('#game-word').isVisible(), false);
        await page.locator('#game-hint').click();
      }
      await answer(); await next();
    }
    const quest = await snapshot();
    assert.equal(quest.progress.completed, 15); assert.equal(quest.mastered, 13); assert.equal(quest.assisted, 2);
    assert.deepEqual([...phases], ['memory', 'spelling', 'sentence']);
    await capture('local-game-quest.png');

    await restart('pet', 'cinnamoroll');
    assert.equal(await page.locator('#game-feed').isDisabled(), true);
    await answer(); await page.locator('#game-feed').click();
    await waitGame('state.progress.petEnergy === 1');
    const pet = await snapshot(); assert.equal(pet.progress.food, 0);
    assert.equal(await page.locator('#game-feed').isDisabled(), true);
    await capture('local-game-pet.png');

    await restart('puzzle');
    await monitorGrid(); await page.locator('#game-hint').click(); await page.waitForTimeout(70);
    const hintGridRebuilds = await page.evaluate(() => window.__gridWrites); assert.equal(hintGridRebuilds, 0);
    while ((await snapshot()).task.kind === 'memory') { await answer(); await next(); }
    const spelling = await snapshot(), target = expected(spelling);
    assert.equal(spelling.task.word, undefined);
    assert.deepEqual([...spelling.task.letters].sort(), [...target].sort());
    assert.notEqual(spelling.task.letters.join(''), target);
    for (const letter of target) await page.locator('#game-letters button:not([disabled])').filter({ hasText: new RegExp('^' + letter + '$') }).first().click();
    assert.equal(await page.locator('#game-answer').inputValue(), target);
    await page.locator('#game-submit').click(); await waitGame('state.canNext === true');
    const puzzle = await snapshot(); assert.equal(puzzle.puzzle.revealed, 7);
    await capture('local-game-puzzle.png');

    for (const topic of GAME_TOPICS) {
      await page.locator('#game-topic').selectOption(topic.id);
      await page.locator('#game-topic-start').click();
      await waitGame('state.material.id === ' + JSON.stringify(topic.id) + ' && state.progress.completed === 0');
      source = builtinMaterial(topic.id).pack; await answer();
    }
    await page.locator('#game-text').fill('The garden is beautiful. I see a flower, a bench and a butterfly.');
    await page.locator('#game-text-start').click();
    await waitGame('state.material.source === "text"');
    source = materialFromText(await page.locator('#game-text').inputValue(), dictionary).pack;
    await answer();
    const customRound = (await snapshot()).round;
    await page.locator('#game-text').fill('zzzz qzxx');
    await page.locator('#game-text-start').click();
    await page.waitForSelector('#game-text-error:not([hidden])');
    assert.equal((await snapshot()).round, customRound, 'invalid custom material preserves the game');

    await page.locator('#image-pick').click();
    await waitImage('ready');
    const image = await page.evaluate(() => window.__imageState);
    assert.match(image.text, /breakfast/i);
    assert.equal((await snapshot()).material.source, 'image');
    assert.ok(!JSON.stringify(image).includes(directory), 'normalized local paths are not exposed to the renderer');
    source = materialFromText(image.text, dictionary, 'image').pack;
    await answer();
    assert.equal(await page.locator('#focus').getAttribute('aria-pressed'), focus, 'local OCR never changes chat focus mode');
    const imageRound = (await snapshot()).round;
    await page.locator('#image-start').click();
    await page.waitForSelector('#image-cancel:not([hidden])');
    await page.locator('#image-cancel').click();
    await waitImage('cancelled'); await page.waitForTimeout(300);
    assert.equal((await snapshot()).round, imageRound, 'cancelled OCR cannot overwrite the current game');
    await page.locator('#image-clear').click(); await waitImage('idle');
    assert.equal((await snapshot()).material.source, 'image', 'removing the picture does not destroy playable material');

    assert.equal(await chatEvaluate('window.__fixture.sent.length'), 0, 'no AI generation messages were sent');
    assert.equal(await chatEvaluate('window.__fixture.changes.length'), 0, 'no images were uploaded to AI');
    assert.equal(await chatEvaluate('document.getElementById("prompt-textarea").innerText'), 'Keep my existing chat draft.');
    assert.equal(await chatEvaluate('document.getElementById("native-sidebar").getClientRects().length > 0'), true);
    assert.equal(await chatEvaluate('typeof window.milo'), 'undefined');
    await page.evaluate(() => window.milo.lookup('new'));
    await page.waitForSelector('#lookup:not([hidden])');
    const lookup = await page.locator('#english').textContent();
    await page.locator('#image-tab').click();
    const lastLookup = await page.evaluate(() => window.__lookupState);
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('shell:event',
      { type: 'lookup', data: { ...value, chinese: '新的' } }), lastLookup);
    assert.equal(await page.locator('#image-panel').isVisible(), true, 'background dictionary results do not interrupt gameplay');
    assert.equal(lookup, 'new');

    // Completely unload ChatGPT. The game still starts and accepts answers.
    await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(item => item.getURL().startsWith('https://chatgpt.com/')).loadURL('about:blank'));
    await page.locator('#game-topic').selectOption('breakfast');
    await page.locator('#game-topic-start').click();
    await waitGame('state.material.id === "breakfast"');
    source = builtinMaterial().pack; await answer();
    let speech = { native: false, reason: 'Windows native voice is checked in Windows CI.' };
    if (process.platform === 'win32') {
      const audio = await page.evaluate(() => window.milo.speakGame());
      assert.equal(audio.error, undefined);
      const wave = Buffer.from(audio.audio, 'base64'); assert.ok(validateWave(wave));
      speech = { native: true, validWave: true, bytes: wave.length };
    }
    assert.deepEqual(errors, []);
    const report = { startupPlayableWithoutChatGPT: true, builtInTopics: GAME_TOPICS.length, aiMessages: 0, aiImageUploads: 0,
      quest: { completed: quest.progress.completed, mastered: quest.mastered, assisted: quest.assisted },
      pet: { fed: pet.progress.petEnergy, food: pet.progress.food, character: pet.character },
      puzzle: { rearrangedLetters: true, revealed: puzzle.puzzle.revealed }, hiddenGridRebuilds, hintGridRebuilds,
      realImageOCR: true, editableMaterial: true, invalidTextPreservesGame: true, cancelledOCRPreservesGame: true,
      focusAndChatDraftPreserved: true, gameWorksAfterChatUnloaded: true, nativeSidebarPreserved: true, speech };
    fs.writeFileSync(path.join(root, 'test-results', 'native-games.json'), JSON.stringify(report, null, 2));
    console.log('Independent native learning games passed:', report);
  } finally { dictionary?.close(); if (app) await app.close(); fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
