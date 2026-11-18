'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMediaPermissions } = require('../src/media-permissions.cjs');
function setup(askAudio = async () => true) {
  const contents = { getURL: () => 'https://chatgpt.com/' };
  const settings = { microphone: 'ask' };
  const handlers = createMediaPermissions({ getContents: () => contents, settings, askAudio, save() {} });
  const request = (permission, details) => new Promise(resolve => handlers.request(contents, permission, resolve, details));
  return { contents, settings, handlers, request };
}
test('ChatGPT can select speakers and enumerate audio devices; camera capture stays denied', async () => {
  const { contents, settings, handlers, request } = setup();
  assert.equal(handlers.check(contents, 'speaker-selection', 'https://chatgpt.com/', {}), true);
  assert.equal(handlers.check(contents, 'media', 'https://chatgpt.com/', {}), true);
  assert.equal(handlers.check(contents, 'media', 'https://chatgpt.com/', { mediaType: 'video' }), false);
  assert.equal(await request('media', { mediaTypes: ['audio'], requestingUrl: 'https://chatgpt.com/' }), true);
  assert.equal(settings.microphone, 'allow');
  assert.equal(await request('media', { mediaTypes: ['audio', 'video'], requestingUrl: 'https://chatgpt.com/' }), false);
  assert.equal(await request('display-capture', { mediaTypes: ['audio'], requestingUrl: 'https://chatgpt.com/' }), false);
});
test('unrelated origins, other windows, and contradictory frame origins never receive permissions', async () => {
  const { contents, handlers, request } = setup();
  assert.equal(handlers.check(contents, 'speaker-selection', 'https://evil.test/', {}), false);
  assert.equal(handlers.check({ getURL: contents.getURL }, 'media', 'https://chatgpt.com/', {}), false);
  assert.equal(handlers.check(contents, 'media', 'https://chatgpt.com/', { requestingUrl: 'https://evil.test/' }), false);
  assert.equal(await request('media', { mediaTypes: ['audio'], securityOrigin: 'https://evil.test/', requestingUrl: 'https://chatgpt.com/' }), false);
});
test('same-origin blank frames can request audio and concurrent requests share one decision', async () => {
  let prompts = 0;
  const { request } = setup(async () => { prompts++; return true; });
  const details = { mediaTypes: ['audio'], securityOrigin: 'https://chatgpt.com/', requestingUrl: 'about:blank' };
  assert.deepEqual(await Promise.all([request('media', details), request('media', details)]), [true, true]);
  assert.equal(prompts, 1);
});
test('denying the microphone prevents capture while preserving speaker playback', async () => {
  const { request, contents, handlers } = setup(async () => false);
  assert.equal(await request('media', { mediaTypes: ['audio'], requestingUrl: 'https://chatgpt.com/' }), false);
  assert.equal(handlers.check(contents, 'media', 'https://chatgpt.com/', { mediaType: 'audio' }), false);
  assert.equal(handlers.check(contents, 'speaker-selection', 'https://chatgpt.com/', {}), true);
});
