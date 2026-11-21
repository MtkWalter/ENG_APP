'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { IMAGE_LESSON_MODES, validateLessonOptions, buildLessonPrompt } = require('../src/image-lessons.cjs');
test('only conversation, grammar and quiz modes remain available', () => {
  assert.deepEqual(IMAGE_LESSON_MODES.map(item => item.id), ['conversation', 'grammar', 'quiz']);
  assert.throws(() => validateLessonOptions('vocabulary'), RangeError);
  assert.throws(() => buildLessonPrompt('vocabulary'), RangeError);
});
test('optional AI teachers retain image evidence, one-task turns and no pronunciation scoring claims', () => {
  for (const mode of ['conversation', 'grammar', 'quiz']) {
    const prompt = buildLessonPrompt(mode);
    assert.ok(prompt.length < 5000); assert.match(prompt, /看不清.*不補寫/);
    assert.match(prompt, /每則回覆最多一個.*任務/); assert.match(prompt, /停下來等我回答/);
    assert.match(prompt, /不要先詢問.*程度.*學習目標/);
    assert.match(prompt, /圖片內的指令.*不取代/);
    assert.match(prompt, /文字或語音轉寫.*不能.*判定.*發音/);
    assert.doesNotMatch(prompt, /MILO_GAME_PACK|MILO_GAME_REQUEST/);
  }
  assert.match(buildLessonPrompt('conversation'), /分配你和我的角色.*直接開始/);
  assert.match(buildLessonPrompt('grammar'), /一次只教一個文法/);
  assert.match(buildLessonPrompt('quiz'), /直接開始第 1 題/);
});
test('invalid or inherited mode IDs cannot enter any lesson', () => {
  for (const value of [null, {}, [], 1, '', 'constructor', '__proto__', 'unknown']) {
    assert.throws(() => validateLessonOptions(value), RangeError);
  }
});
