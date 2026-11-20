'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attachMediaPower } = require('../src/media-power.cjs');
function setup() {
  const contents = new EventEmitter();
  contents.url = 'https://chatgpt.com/'; contents.destroyed = false;
  contents.getURL = () => contents.url; contents.isDestroyed = () => contents.destroyed;
  const active = new Map(), starts = [], stops = [];
  let sequence = 0;
  const power = { start(type) { const id = sequence++; active.set(id, type); starts.push(type); return id; },
    stop(id) { stops.push(id); return active.delete(id); } };
  const displayBlocker = power.start('prevent-display-sleep');
  const cleanup = attachMediaPower(contents, power);
  return { contents, power, active, starts, stops, displayBlocker, cleanup };
}
test('remote playback owns one app-suspension blocker without stopping the independent display blocker', () => {
  const { contents, active, starts, stops, displayBlocker, cleanup } = setup();
  assert.deepEqual([...active.values()], ['prevent-display-sleep']);
  contents.emit('media-started-playing'); contents.emit('media-started-playing');
  assert.deepEqual(starts, ['prevent-display-sleep', 'prevent-app-suspension']);
  assert.equal(active.size, 2);
  contents.emit('media-paused'); contents.emit('media-paused');
  assert.equal(stops.length, 1); assert.equal(active.has(displayBlocker), true);
  contents.emit('media-started-playing'); assert.equal(active.size, 2);
  cleanup(); cleanup();
  assert.deepEqual([...active.values()], ['prevent-display-sleep']);
  contents.emit('media-started-playing'); assert.equal(active.size, 1);
  for (const name of ['media-started-playing', 'media-paused', 'audio-state-changed', 'did-start-navigation', 'render-process-gone', 'destroyed']) assert.equal(contents.listenerCount(name), 0);
});
test('audible-only WebRTC playback is protected, and overlapping media signals share one request', () => {
  const { contents, active, starts, cleanup } = setup();
  contents.emit('audio-state-changed', { audible: true });
  assert.equal(active.size, 2, 'WebRTC can be audible without media-started-playing');
  contents.emit('media-started-playing');
  contents.emit('audio-state-changed', { audible: false });
  assert.equal(active.size, 2, 'an ongoing media player retains its request during a quiet interval');
  contents.emit('audio-state-changed', { audible: true });
  contents.emit('media-paused');
  assert.equal(active.size, 2, 'another audible source retains its request when one media player pauses');
  assert.equal(starts.length, 2, 'all sources share a single playback request');
  contents.emit('audio-state-changed', { audible: false });
  assert.equal(active.size, 1);
  contents.emit('audio-state-changed', { audible: true });
  contents.emit('render-process-gone');
  assert.equal(active.size, 1);
  contents.emit('audio-state-changed', { audible: false });
  assert.equal(active.size, 1, 'reset discards the previous media-playing state');
  cleanup();
});
test('only full main-frame navigation releases playback power, including modern Electron event fields', () => {
  const { contents, active, cleanup } = setup();
  contents.emit('media-started-playing');
  contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  assert.equal(active.size, 2);
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.equal(active.size, 1);
  contents.emit('media-started-playing');
  contents.emit('did-start-navigation', {}, 'https://chatgpt.com/', false, true);
  assert.equal(active.size, 1, 'legacy positional arguments also release the request');
  cleanup();
});
test('renderer loss and destruction release the request and unrelated origins never acquire one', () => {
  const { contents, active, starts, cleanup } = setup();
  contents.url = 'https://unrelated.example/'; contents.emit('media-started-playing');
  assert.equal(starts.length, 1);
  contents.url = 'https://chatgpt.com/'; contents.emit('media-started-playing');
  contents.emit('render-process-gone', {}, { reason: 'crashed' }); assert.equal(active.size, 1);
  contents.emit('media-started-playing'); assert.equal(active.size, 2);
  contents.destroyed = true; contents.emit('destroyed');
  assert.equal(active.size, 1); cleanup();
  contents.emit('media-started-playing'); assert.equal(active.size, 1);
});
