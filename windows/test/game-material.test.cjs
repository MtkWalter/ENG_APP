'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { builtinMaterial, GAME_TOPICS, materialFromText } = require('../src/game-material.cjs');
const { createGame } = require('../src/learning-game.cjs');
const { loadDictionary } = require('../src/dictionary.cjs');
let dictionary;
test.before(async () => { dictionary = await loadDictionary(path.join(__dirname, '..', 'assets', 'android')); });
test.after(() => dictionary.close());
test('five complete built-in topics start without text, pictures or an AI response', () => {
  assert.equal(GAME_TOPICS.length, 5);
  for (const topic of GAME_TOPICS) {
    const first = builtinMaterial(topic.id);
    assert.equal(first.material.source, 'builtin');
    assert.equal(first.pack.words.length, 6); assert.equal(first.pack.patterns.length, 3);
    for (const style of ['quest', 'pet', 'puzzle']) assert.equal(createGame(first.pack, style).snapshot().progress.total, 15);
    first.pack.words[0].word = 'changed';
    assert.notEqual(builtinMaterial(topic.id).pack.words[0].word, 'changed');
  }
  for (const id of ['constructor', '__proto__', null, {}, 'missing']) assert.throws(() => builtinMaterial(id));
});
test('real bundled dictionary turns only source words and sentences into native game tasks', () => {
  const text = 'Mary: I am hungry. I want a hamburger and juice.\nJohn: There is a breakfast shop over there.\nTina: I want a sandwich and soup.';
  const value = materialFromText(text, dictionary, 'image');
  assert.equal(value.material.source, 'image'); assert.equal(value.material.foundationPatterns, 0);
  for (const entry of value.pack.words) {
    assert.ok(text.toLowerCase().includes(entry.word));
    assert.match(entry.meaning, /[\u4e00-\u9fff]/); assert.ok(!['mary', 'john', 'tina'].includes(entry.word));
  }
  for (const item of value.pack.patterns) {
    const original = item.prompt.replace(/^依教材原句，填入「[^」]+」：/, '').replace('____', item.answer);
    assert.ok(text.toLowerCase().includes(original.toLowerCase()), 'sentence exercises retain actual source context');
  }
  assert.equal(createGame(value.pack).snapshot().phase, 'memory');
});
test('word-only material explicitly labels supplementary foundation grammar', () => {
  const value = materialFromText('breakfast sandwich hamburger juice soup', dictionary);
  assert.equal(value.material.source, 'text');
  assert.equal(value.material.sourcePatterns, 0); assert.equal(value.material.foundationPatterns, 2);
  assert.ok(value.pack.patterns.every(item => item.explanation.startsWith('內建基礎句型')));
});
test('unusable OCR, oversized text and executable content cannot produce a pretend image pack', () => {
  for (const text of ['', 'x', 'qzxxv zzzz', 'Mary: Hello.', 'I am here.', 'a'.repeat(12001), '<script>alert(1)</script>', 'https://example.com breakfast soup juice']) {
    assert.throws(() => materialFromText(text, dictionary));
  }
});
