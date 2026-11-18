'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isChatURL, isLoginURL, isExternalURL, normalizeSelection, audioPermission } = require('../src/policy.cjs');
const { loadDictionary } = require('../src/dictionary.cjs');
const { readSettings, writeSettings, sanitize } = require('../src/settings.cjs');
const { chunks } = require('../src/translation-text.cjs');

test('only exact HTTPS ChatGPT origins can use lookup and microphone bridges', () => {
  for (const url of ['https://chatgpt.com/', 'https://chat.openai.com/c/123', 'https://www.chatgpt.com:443/']) assert.equal(isChatURL(url), true);
  for (const url of ['http://chatgpt.com', 'https://chatgpt.com.evil.test', 'https://evil.test/chatgpt.com',
    'https://chatgpt.com:444', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user@chatgpt.com', 'garbage']) assert.equal(isChatURL(url), false, url);
  assert.equal(isLoginURL('https://auth.openai.com/login'), true);
  assert.equal(isChatURL('https://auth.openai.com/login'), false);
  assert.equal(isExternalURL('file:///C:/Windows/system.ini'), false);
  assert.equal(isExternalURL('https://example.com'), true);
});
test('camera, mixed streams, unrelated origins, and missing media types are denied', () => {
  assert.equal(audioPermission('media', 'https://chatgpt.com', { mediaTypes: ['audio'] }), true);
  for (const types of [[], ['video'], ['audio', 'video'], undefined]) assert.equal(audioPermission('media', 'https://chatgpt.com', { mediaTypes: types }), false);
  assert.equal(audioPermission('display-capture', 'https://chatgpt.com', { mediaTypes: ['audio'] }), false);
  assert.equal(audioPermission('media', 'https://example.com', { mediaTypes: ['audio'] }), false);
});
test('explicit selections are bounded and contain English', () => {
  assert.equal(normalizeSelection('  A new book.  '), 'A new book.');
  for (const value of [null, {}, '', '中文', 'a'.repeat(5001), 'new\0secret']) assert.equal(normalizeSelection(value), null);
  assert.equal(normalizeSelection('a'.repeat(5000)).length, 5000);
});
test('the actual bundled dictionary retains provenance and both entry counts', async () => {
  const dictionary = await loadDictionary(path.join(__dirname, '..', 'assets', 'android'));
  try {
    assert.equal(dictionary.metadata.kk_entries, '125112');
    assert.equal(dictionary.metadata.chinese_entries, '100497');
    assert.equal(dictionary.metadata.entries, '142153');
    const entry = dictionary.lookup('NEW');
    assert.match(entry.kk, /nu/);
    assert.match(entry.chinese, /新的/);
    assert.equal(dictionary.lookup("'; DROP TABLE entries;--"), null);
    assert.equal(dictionary.lookup('zzzzmilonotaword'), null);
    assert.equal(dictionary.lookup('new book'), null);
    assert.equal(dictionary.lookup('new').kk, entry.kk);
    assert.equal(dictionary.lookup('a').chinese.includes('\\r'), false);
  } finally { dictionary.close(); }
});
test('settings recover from corruption, clamp sizes, and omit unrelated fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'milo-settings-'));
  try {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{broken');
    assert.equal(readSettings(dir).focus, true);
    writeSettings(dir, { zoom: 9, focus: false, microphone: 'allow', width: 20, height: 900, cookie: 'must not persist' });
    const saved = readSettings(dir);
    assert.equal(saved.zoom, 2); assert.equal(saved.width, 980); assert.equal(saved.focus, false);
    assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8').includes('cookie'), false);
    assert.equal(sanitize({ zoom: NaN }).zoom, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('long selections split without losing words or exceeding the model context budget', () => {
  const text = 'This is one sentence. ' + 'Another example word '.repeat(100) + 'End.';
  const result = chunks(text);
  assert.equal(result.join(' ').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '));
  assert.ok(result.length > 2);
  assert.ok(result.every(part => part.length <= 250));
  const long = 'x'.repeat(700);
  assert.equal(chunks(long).join(''), long);
});
