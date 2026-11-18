'use strict';

const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { validateWave } = require('../src/speech.cjs');
const { html, pack } = require('./fixtures/image-learning.cjs');
const root = path.join(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'milo-native-games-'));
const selectedImage = path.join(directory, 'game-image.png');
let app, page;

async function chatEvaluate(source) {
  return app.evaluate(({ webContents }, code) => {
    const contents = webContents.getAllWebContents().find(item => item.getURL().startsWith('https://chatgpt.com/'));
    return contents ? contents.executeJavaScript(code) : null;
  }, source);
}
async function waitChat(source) {
  for (let i = 0; i < 100; i++) {
    if (await chatEvaluate(source)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Native game fixture condition timed out: ' + source);
}
async function toggleMaterial() {
  const position = await chatEvaluate(`(() => {
    const button=window.__fixture.lastAssistant.parentElement.querySelector('[data-milo-game-pack-toggle]');
    button.scrollIntoView({block:'center',behavior:'instant'});const rect=button.getBoundingClientRect();
    return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};
  })()`);
  await app.evaluate(({ webContents }, point) => {
    const contents=webContents.getAllWebContents().find(item=>item.getURL().startsWith('https://chatgpt.com/'));
    contents.focus();contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  }, position);
}
const snapshot = () => page.evaluate(() => window.__gameState);
async function waitGame(predicate) {
  const matches = Function('state', 'return (' + predicate + ')');
  for (let i = 0; i < 200; i++) {
    const state = await snapshot();
    if (state && matches(state)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Native game state timed out: ' + predicate);
}
async function waitImage(status) {
  await page.waitForFunction(status => window.__imageState?.status === status &&
    document.querySelector('#image-status').parentElement.dataset.busy === 'false', status, { timeout: 30000 });
}
function correctAnswer(state) {
  if (state.task.kind === 'memory') return pack.words.find(entry => entry.word === state.task.word).meaning;
  if (state.task.kind === 'spelling') return pack.words.find(entry => entry.meaning === state.task.meaning).word;
  return pack.patterns.find(entry => entry.prompt === state.task.prompt).answer;
}
async function answerCorrect() {
  const state = await snapshot(), expected = correctAnswer(state);
  if (state.task.choices?.length) await page.locator('#game-choices button').filter({ hasText: new RegExp('^' + expected + '$') }).click();
  else { await page.locator('#game-answer').fill(expected); await page.locator('#game-submit').click(); }
  await waitGame('state.canNext === true');
  return snapshot();
}
async function next() {
  const state = await snapshot();
  await page.locator('#game-next').click();
  await waitGame('state.complete || (!state.canNext && state.task?.id !== ' + JSON.stringify(state.task.id) + ')');
}
async function capture(name) {
  await page.locator('#image-game').scrollIntoViewIfNeeded();
  await page.locator('#image-game').screenshot({ path: path.join(root, 'test-results', name) });
}

(async () => {
  try {
    await sharp({ create: { width: 80, height: 60, channels: 3, background: '#669966' } }).png().toFile(selectedImage);
    app = await electron.launch({ args: [root, ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [])],
      env: { ...process.env, MILO_TEST_MODE: '1', MILO_TEST_DATA: path.join(directory, 'profile'), MILO_TEST_IMAGE: selectedImage }, timeout: 60000 });
    page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1420, 1080));
    await page.waitForSelector('#image-tab');
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(() => window.milo.on(({ type, data }) => {
      if (type === 'image-lesson') window.__imageState = data;
      if (type === 'game') window.__gameState = data;
    }));
    await app.evaluate(({ session }, html) => session.fromPartition('persist:milo-chat').protocol.handle('https',
      () => new Response(html, { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } })), html);
    await page.locator('#reload').click();
    await waitChat('!!window.__fixture');
    await page.locator('#image-tab').click();
    await page.locator('input[name="image-mode"][value="vocabulary"]').check();
    await page.locator('input[name="image-game-style"][value="quest"]').check();
    await page.locator('#image-pick').click();
    await waitImage('sent'); await waitGame('state.status === "ready" && state.style === "quest"');
    assert.equal(await page.locator('#game-play').isVisible(), true);
    assert.equal((await snapshot()).task.kind, 'memory');
    assert.equal((await snapshot()).progress.total, 8);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('shell:event',
      { type: 'lookup', data: { id: 7001, text: 'garden', kind: 'word', kk: '', chinese: '' } }));
    await page.waitForFunction(() => document.getElementById('dictionary-tab').getAttribute('aria-selected') === 'true');
    await page.locator('#image-tab').click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('shell:event',
      { type: 'lookup', data: { id: 7001, text: 'garden', kind: 'word', kk: '', chinese: '花園', translated: true } }));
    await page.waitForFunction(() => document.getElementById('chinese').textContent === '花園');
    assert.equal(await page.locator('#image-tab').getAttribute('aria-selected'), 'true', 'a late dictionary translation must not switch away from the game');
    await page.evaluate(() => {
      const grid = document.getElementById('game-puzzle-grid');
      const original = grid.replaceChildren.bind(grid);
      window.__gameRenderMetrics = { puzzleRebuilds: 0 };
      grid.replaceChildren = (...nodes) => { window.__gameRenderMetrics.puzzleRebuilds++; return original(...nodes); };
    });
    assert.equal(await chatEvaluate('window.__fixture.sent.length'), 1);
    assert.equal(await chatEvaluate('getComputedStyle(window.__fixture.lastAssistant).display'), 'none', 'validated game data is collapsed in the chat presentation');
    assert.equal(await chatEvaluate('getComputedStyle(window.__fixture.lastUser).display'), 'none', 'only the matching automatic teacher prompt is collapsed');
    assert.equal(await chatEvaluate('document.getElementById("native-sidebar").getBoundingClientRect().width'), 150);
    assert.equal(await chatEvaluate('window.__fixture.lastAssistant.parentElement.querySelector("[data-testid=fixture-copy]").getClientRects().length > 0'), true, 'surrounding website copy actions remain available');
    await toggleMaterial();
    await waitChat('getComputedStyle(window.__fixture.lastAssistant).display !== "none"');
    assert.equal(await chatEvaluate('getComputedStyle(window.__fixture.lastUser).display !== "none"'), true);
    assert.equal(await chatEvaluate('window.__fixture.lastAssistant.textContent.includes("MILO_GAME_PACK_V1")'), true, 'expanding material keeps the original document intact');
    await toggleMaterial();
    await waitChat('getComputedStyle(window.__fixture.lastAssistant).display === "none"');
    const phases = new Set(['memory']);
    assert.match(await page.locator('.game-pronunciation-note').filter({ hasText: '不評判實際發音' }).textContent(), /不評判實際發音/);
    let speech;
    if (process.platform === 'win32') {
      const audio = await page.evaluate(() => window.milo.speakGame());
      assert.equal(audio.error, undefined);
      const bytes = Buffer.from(audio.audio, 'base64'); assert.equal(validateWave(bytes), true);
      speech = { native: true, validWave: true, bytes: bytes.length, voice: audio.voice };
      await page.evaluate(() => window.milo.stopSpeech());
    } else {
      await page.locator('#game-speak').click();
      await page.waitForFunction(() => document.querySelector('#game-speech-note').textContent.includes('只在 Windows'));
      speech = { native: false, platformMessage: true };
    }

    // A hint and a retry are separate assisted cases, rather than awarding
    // independent mastery merely because a later answer becomes correct.
    await page.locator('#game-hint').click();
    await waitGame('!!state.hint');
    const hiddenGridRebuilds = await page.evaluate(() => window.__gameRenderMetrics.puzzleRebuilds);
    assert.equal(hiddenGridRebuilds, 0, 'hidden puzzle artwork must not rebuild during quest feedback');
    let answered = await answerCorrect();
    assert.equal(answered.assisted, 1); assert.equal(answered.mastered, 0); assert.equal(answered.progress.stars, 0);
    const once = { ...answered.progress };
    await page.evaluate(answer => window.milo.answerGame(answer), correctAnswer(answered));
    assert.deepEqual((await snapshot()).progress, once, 'repeated answers cannot duplicate a reward');
    await next();
    await page.locator('#game-choices button').filter({ hasText: /^長椅$/ }).click();
    await waitGame('state.feedback?.correct === false');
    assert.equal((await snapshot()).progress.completed, 1);
    answered = await answerCorrect();
    assert.equal(answered.assisted, 2); assert.equal(answered.mastered, 0);
    await next();
    while (!(await snapshot()).complete) {
      const current = await snapshot(); phases.add(current.task.kind);
      if (current.task.kind === 'spelling') {
        assert.equal(await page.locator('#game-word').isVisible(), false, 'spelling questions do not display the target word');
      }
      await answerCorrect(); await next();
    }
    const quest = await snapshot();
    assert.deepEqual([...phases], ['memory', 'spelling', 'sentence']);
    assert.equal(quest.progress.completed, 8); assert.equal(quest.progress.stars, 6);
    assert.equal(quest.mastered, 6); assert.equal(quest.assisted, 2);
    assert.equal(quest.complete, true); assert.equal(await page.locator('#game-question').isVisible(), false);
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    await capture('native-quest.png');

    await page.locator('input[name="image-game-style"][value="pet"]').check();
    await page.locator('input[name="image-character"][value="cinnamoroll"]').check();
    await page.locator('#game-restart').click();
    await waitGame('state.style === "pet" && state.character === "cinnamoroll" && state.progress.completed === 0');
    assert.equal((await snapshot()).progress.food, 0); assert.equal(await page.locator('#game-feed').isDisabled(), true);
    await answerCorrect();
    assert.equal((await snapshot()).progress.food, 1);
    await page.locator('#game-feed').click();
    await waitGame('state.progress.food === 0 && state.progress.petEnergy === 1');
    assert.equal(await page.locator('#game-feed').isDisabled(), true);
    for (let i = 0; i < 3; i++) await page.evaluate(() => window.milo.feedGame());
    const pet = await snapshot();
    assert.equal(pet.progress.food, 0); assert.equal(pet.progress.petEnergy, 1);
    assert.equal(pet.pet.mood, 'happy');
    assert.equal(await chatEvaluate('window.__fixture.sent.length'), 1, 'local restarts and feeding do not send another image or prompt');
    await capture('native-pet.png');

    await page.locator('input[name="image-game-style"][value="puzzle"]').check();
    await page.locator('input[name="image-character"][value="kuromi"]').check();
    await page.locator('#game-restart').click();
    await waitGame('state.style === "puzzle" && state.progress.completed === 0');
    assert.equal(await page.locator('#game-puzzle').isVisible(), true);
    assert.equal(await page.locator('#game-puzzle-grid .puzzle-piece').count(), 8);
    while ((await snapshot()).task.kind === 'memory') { await answerCorrect(); await next(); }
    const spelling = await snapshot(), word = correctAnswer(spelling);
    assert.equal(spelling.task.kind, 'spelling');
    assert.notEqual(spelling.task.letters.join(''), word, 'puzzle letters are actually rearranged');
    assert.equal(await page.locator('#game-word').isVisible(), false);
    await page.evaluate(() => {
      window.__gameRenderMetrics.puzzleRebuilds = 0;
      window.__firstPuzzleTile = document.getElementById('game-puzzle-grid').firstChild;
    });
    await page.locator('#game-hint').click(); await waitGame('!!state.hint');
    const hintGridRebuilds = await page.evaluate(() => window.__gameRenderMetrics.puzzleRebuilds);
    assert.equal(hintGridRebuilds, 0, 'a hint must reuse the existing puzzle tiles');
    assert.equal(await page.evaluate(() => window.__firstPuzzleTile === document.getElementById('game-puzzle-grid').firstChild), true);
    await page.locator('#game-letters button').first().click();
    assert.equal((await page.locator('#game-answer').inputValue()).length, 1);
    await page.locator('#game-clear-answer').click();
    assert.equal(await page.locator('#game-answer').inputValue(), '');
    for (const letter of word) await page.locator('#game-letters button:not(:disabled)').filter({ hasText: new RegExp('^' + letter + '$') }).first().click();
    assert.equal(await page.locator('#game-answer').inputValue(), word);
    await page.locator('#game-submit').click(); await waitGame('state.canNext === true');
    const puzzle = await snapshot();
    assert.equal(puzzle.puzzle.revealed, 4); assert.equal(puzzle.progress.completed, 4);
    assert.equal(puzzle.assisted, 1);
    assert.equal(await page.locator('#game-puzzle-grid [data-revealed="true"]').count(), 4);
    const progressGridRebuilds = await page.evaluate(() => window.__gameRenderMetrics.puzzleRebuilds);
    assert.equal(progressGridRebuilds, 1, 'newly earned progress updates the artwork exactly once');
    assert.equal(await chatEvaluate('window.__fixture.sent.length'), 1);
    await capture('native-puzzle.png');

    await chatEvaluate('window.__fixture.gamePackMode="invalid"');
    await page.locator('#image-start').click();
    await waitImage('error'); await waitGame('state.status === "error"');
    assert.equal((await snapshot()).task, null);
    assert.equal(await page.locator('#game-play').isVisible(), false, 'invalid generated content never starts a game');
    assert.equal(await chatEvaluate('getComputedStyle(window.__fixture.lastAssistant).display !== "none"'), true, 'invalid generated material is not concealed');
    const invalidRestart = await page.evaluate(() => window.milo.restartGame('quest', 'kuromi'));
    assert.ok(invalidRestart.error);
    assert.equal(await chatEvaluate('window.__fixture.sent.length'), 2);
    await chatEvaluate('window.__fixture.gamePackMode="none"');
    await page.locator('#image-start').click();
    await waitGame('state.status === "waiting"');
    await waitChat('window.__fixture.sent.length === 3');
    await page.waitForFunction(() => window.__imageState?.status === 'preparing');
    await page.locator('#image-cancel').click();
    await waitImage('cancelled'); await waitGame('state.status === "idle"');
    assert.equal(await page.locator('#image-start').isEnabled(), true, 'cancelling a pending generated pack unlocks the learning controls');
    await page.locator('#image-clear').click(); await waitImage('idle');
    assert.equal((await snapshot()).status, 'idle');
    assert.deepEqual(errors, []);
    const report = { quest: { completed: quest.progress.completed, mastered: quest.mastered, assisted: quest.assisted,
        phases: [...phases], stars: quest.progress.stars, duplicateRewardsPrevented: true },
      pet: { fed: pet.progress.petEnergy, food: pet.progress.food, noNegativeFood: true, character: pet.character },
      puzzle: { rearrangedLetters: true, revealed: puzzle.puzzle.revealed, total: puzzle.puzzle.total, assisted: puzzle.assisted },
      localRestartsWithoutUpload: true, validatedMaterialCollapsed: true, originalMaterialToggleWorks: true,
      rendering: { hiddenGridRebuilds, hintGridRebuilds, progressGridRebuilds },
      nativeSidebarPreserved: true, lateDictionaryResultKeepsGameVisible: true, invalidPackRejected: true, waitingCancellationUnlocksControls: true, speech,
      limitation: 'Actual packaged-source Electron UI/IPC/gameplay with synthetic ChatGPT image教材; no real image understanding or pronunciation assessment verified.' };
    fs.writeFileSync(path.join(root, 'test-results', 'native-games.json'), JSON.stringify(report, null, 2));
    console.log('Native learning games passed:', JSON.stringify(report));
  } finally {
    if (app) await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
