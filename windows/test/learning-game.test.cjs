'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateGamePack, createGame } = require('../src/learning-game.cjs');

function pack() {
  return {
    words: [
      { word: 'umbrella', meaning: '雨傘', phonetic: '/ʌmˈbrɛlə/', hint: '下雨時用來擋雨。', example: 'I have an umbrella.' },
      { word: 'bicycle', meaning: '腳踏車', example: 'The bicycle is red.' },
      { word: 'window', meaning: '窗戶' }
    ],
    patterns: [
      { prompt: 'The bicycle ___ red.', answer: 'is', choices: ['am', 'is', 'are'], explanation: '單數主詞使用 is。' },
      { prompt: 'There ___ three windows.', answer: 'are', choices: ['am', 'is', 'are'] }
    ]
  };
}
const clone = value => JSON.parse(JSON.stringify(value));
function answerFor(snapshot, source) {
  const index = Number(snapshot.task.id.split('-')[1]);
  return snapshot.phase === 'memory' ? source.words[index].meaning : snapshot.phase === 'spelling' ? source.words[index].word : source.patterns[index].answer;
}
function finishMemory(game, source = pack()) {
  while (game.snapshot().phase === 'memory') {
    game.answer(answerFor(game.snapshot(), source)); game.next();
  }
}

test('native game material is validated and copied without a chat protocol', () => {
  const source = pack(), clean = validateGamePack(source);
  assert.deepEqual(clean, source); clean.words[0].word = 'changed';
  assert.equal(source.words[0].word, 'umbrella');
  for (const input of [null, [], {}, '', JSON.stringify(source), { words: [], patterns: [] }]) assert.throws(() => validateGamePack(input));
});

test('validation bounds all fields and rejects duplicate, unsafe and answer-leaking content', () => {
  const mutations = [
    data => { data.words = data.words.slice(0, 2); },
    data => { data.words = new Array(9).fill(data.words[0]); },
    data => { data.patterns = data.patterns.slice(0, 1); },
    data => { data.patterns = new Array(6).fill(data.patterns[0]); },
    data => { data.words[1].word = 'UMBRELLA'; },
    data => { data.words[1].meaning = '雨傘。'; },
    data => { data.words[0].word = 'two words'; },
    data => { data.words[0].word = 'a'.repeat(31); },
    data => { data.words[0].meaning = '雨傘 (umbrella)'; },
    data => { data.words[0].example = '<img src=x onerror=alert(1)>'; },
    data => { data.words[0].hint = 'https://example.com'; },
    data => { data.words[0].hint = 'example.com'; },
    data => { data.words[0].hint = 'ｈｔｔｐｓ：／／example.com'; },
    data => { data.words[0].hint = 'h\u200bttps://example.com'; },
    data => { data.words[0].phonetic = 'x'.repeat(81); },
    data => { data.words[0].extra = '<script>'; },
    data => { data.patterns[1].prompt = 'THE BICYCLE ___ RED.'; },
    data => { data.patterns[0].prompt = 'The bicycle is ___. '; },
    data => { data.patterns[0].prompt = 'The bicycle red.'; },
    data => { data.patterns[0].prompt = 'The ___ ___ red.'; },
    data => { data.patterns[0].answer = 'x'.repeat(81); },
    data => { data.patterns[0].choices = ['is', 'IS', 'am']; },
    data => { data.patterns[0].choices = ['am', 'are', 'was']; },
    data => { data.patterns[0].choices = ['is', 'am']; },
    data => { data.patterns[0].explanation = 'data:text/html,bad'; },
    data => { data.extra = 'unsupported'; }
  ];
  for (const mutation of mutations) {
    const source = pack(); mutation(source);
    assert.throws(() => validateGamePack(source), /學習遊戲資料無法使用/);
  }
  const safe = pack();
  safe.patterns[0].prompt = 'The animal ___ sleeping.';
  assert.equal(validateGamePack(safe).patterns[0].answer, 'is', 'an answer substring inside another word is not a leaked token');
});

test('each play style advances through memory, spelling and sentence stages with single-use rewards', () => {
  const source = pack();
  for (const style of ['puzzle', 'pet', 'quest']) {
    const game = createGame(source, style);
    const seen = [];
    while (game.snapshot().phase !== 'complete') {
      const before = game.snapshot();
      seen.push(before.phase);
      assert.equal(before.task.type, before.phase);
      assert.equal(before.feedback, null);
      const solved = game.answer(answerFor(before, source));
      assert.equal(solved.feedback.correct, true);
      assert.equal(solved.progress.completed, before.progress.completed + 1);
      assert.equal(solved.rewards.stars, before.rewards.stars + 1);
      assert.equal(solved.rewards.food, before.rewards.food + 1);
      assert.deepEqual(game.answer(answerFor(before, source)), solved, 'replaying an already solved task awards nothing');
      assert.deepEqual(game.hint(), solved, 'a late hint cannot change an earned reward');
      game.next();
    }
    assert.deepEqual(seen, ['memory', 'memory', 'memory', 'spelling', 'spelling', 'spelling', 'sentence', 'sentence']);
    const completed = game.snapshot();
    assert.equal(completed.task, null);
    assert.equal(completed.rewards.mastered, 8);
    assert.equal(completed.progress.completed, completed.progress.total);
    assert.equal(completed.puzzle.revealed, completed.puzzle.total);
    assert.deepEqual(completed.quest.levels.map(level => level.status), ['complete', 'complete', 'complete']);
    assert.deepEqual(game.next(), completed);
    assert.deepEqual(game.answer('umbrella'), completed);
    assert.equal(game.speechText(), '');
  }
});

test('wrong answers stay on the task, hints and retries cannot claim independent mastery', () => {
  const source = pack(), game = createGame(source);
  const initial = game.snapshot();
  assert.deepEqual(game.next(), initial, 'unfinished tasks cannot be skipped for rewards');
  assert.equal(game.answer('').attempts, 0);
  const wrong = game.answer('incorrect');
  assert.equal(wrong.feedback.correct, false);
  assert.equal(wrong.progress.completed, 0);
  assert.equal(wrong.rewards.food, 0);
  assert.deepEqual(game.next(), wrong);
  const hint = game.hint();
  assert.equal(hint.hintUsed, true);
  assert.ok(hint.hintText.length > 0);
  assert.deepEqual(game.hint(), hint);
  const helped = game.answer(source.words[0].meaning);
  assert.equal(helped.rewards.mastered, 0);
  assert.equal(helped.rewards.assisted, 1);
  assert.equal(helped.rewards.stars, 0);
  assert.equal(helped.rewards.food, 1);
  const next = game.next();
  assert.equal(next.hintUsed, false);
  assert.equal(next.attempts, 0);
  assert.equal(next.feedback, null);
  game.answer('wrong');
  const retried = game.answer(source.words[1].meaning);
  assert.equal(retried.rewards.mastered, 0, 'guessing until correct is assisted practice');
  assert.equal(retried.rewards.assisted, 2);
});

test('feeding consumes only earned food once and never creates hunger or negative penalties', () => {
  const game = createGame(pack(), 'pet');
  assert.deepEqual(game.feed(), game.snapshot(), 'a zero-food feed makes no state change');
  const earned = game.answer('雨傘');
  assert.equal(earned.canFeed, true);
  const fed = game.feed();
  assert.equal(fed.rewards.food, 0);
  assert.equal(fed.rewards.fed, 1);
  assert.equal(fed.pet.mood, 'happy');
  assert.equal(fed.canFeed, false);
  assert.equal(fed.rewards.stars, earned.rewards.stars);
  assert.deepEqual(game.feed(), fed);
  assert.deepEqual(game.answer('雨傘'), fed, 'replaying a fed task cannot restore the consumed food');
  game.next(); game.answer('wrong');
  assert.equal(game.snapshot().pet.mood, 'happy');
  assert.equal(game.snapshot().rewards.fed, 1);
  const quest = createGame(pack()); quest.answer('雨傘');
  assert.deepEqual(quest.feed(), quest.snapshot(), 'feeding belongs to the pet play style');
});

test('optional fields and alternative blank markers support open-text sentence puzzles', () => {
  const source = pack();
  source.patterns = [
    { prompt: 'The bicycle is [blank] the window.', answer: 'next to' },
    { prompt: 'The windows □ open.', answer: 'are' }
  ];
  const game = createGame(validateGamePack(source));
  while (game.snapshot().phase !== 'sentence') {
    game.answer(answerFor(game.snapshot(), source)); game.next();
  }
  assert.equal(game.snapshot().task.choices, undefined);
  assert.equal(game.speechText(), 'The bicycle is blank the window.');
  assert.equal(game.answer(' NEXT   TO. ').feedback.correct, true);
  game.next();
  assert.equal(game.speechText(), 'The windows blank open.');
});

test('spelling hides the target while listening remains available and puzzle letters form a real scramble', () => {
  for (const style of ['puzzle', 'pet', 'quest']) {
    const game = createGame(pack(), style);
    const memory = game.snapshot();
    assert.equal(memory.task.word, 'umbrella');
    assert.equal(memory.task.choices.filter(choice => choice === '雨傘').length, 1);
    assert.equal(game.speechText(), 'umbrella');
    finishMemory(game);
    const spelling = game.snapshot();
    assert.equal(spelling.phase, 'spelling');
    assert.equal(JSON.stringify(spelling.task).toLowerCase().includes('umbrella'), false);
    assert.equal(spelling.task.word, undefined);
    assert.equal(spelling.task.phonetic, undefined);
    assert.equal(game.speechText(), 'umbrella', 'the native speech bridge can read the private target for dictation');
    if (style === 'puzzle') {
      assert.deepEqual([...spelling.task.letters].sort(), [...'umbrella'].sort());
      assert.notEqual(spelling.task.letters.join(''), 'umbrella');
    } else assert.equal(spelling.task.letters, undefined);
    const hinted = game.hint();
    assert.equal(hinted.hintText.includes('umbrella'), false);
    assert.match(hinted.hintText, /u/);
    assert.equal(game.answer('UMBRELLA').feedback.correct, true);
  }
});

test('sentence speech reads a blank before the answer and reveals a filled sentence only after success', () => {
  const source = pack(), game = createGame(source);
  while (game.snapshot().phase !== 'sentence') {
    game.answer(answerFor(game.snapshot(), source)); game.next();
  }
  assert.equal(game.speechText(), 'The bicycle blank red.');
  assert.equal(game.answer(' IS. ').feedback.correct, true);
  assert.equal(game.speechText(), 'The bicycle is red.');
  assert.equal(game.snapshot().feedback.explanation, source.patterns[0].explanation);
});

test('snapshots are JSON-safe independent copies and input mutation cannot change an ongoing game', () => {
  const source = pack(), game = createGame(source);
  const initial = game.snapshot();
  assert.deepEqual(clone(initial), initial);
  source.words[0].word = 'tampered';
  initial.task.choices[0] = 'tampered';
  initial.quest.levels[0].status = 'tampered';
  initial.rewards.food = 999;
  initial.theme.title = 'tampered';
  assert.equal(game.speechText(), 'umbrella');
  assert.equal(game.snapshot().rewards.food, 0);
  assert.equal(game.snapshot().quest.levels[0].status, 'current');
  assert.equal(game.snapshot().task.choices.includes('tampered'), false);
  for (const style of ['constructor', '__proto__', '', null]) assert.throws(() => createGame(pack(), style), RangeError);
});
