'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Translation } = require('../src/translation.cjs');

class FakeWorker extends EventEmitter {
  static workers = [];
  constructor(file, options) { super(); this.options = options; this.messages = []; FakeWorker.workers.push(this); }
  postMessage(message) { this.last = message; this.messages.push(message); }
  terminate() { this.terminated = true; return Promise.resolve(0); }
}
test('changing a selection cooperatively cancels decoding and reuses its loaded worker', async () => {
  const service = new Translation('/unused', () => {}, FakeWorker);
  const first = service.run('translate', 'first');
  const old = service.worker;
  const firstId = old.last.id;
  const generation = old.last.generation;
  const second = service.run('translate', 'second');
  assert.equal(await first, null);
  assert.notEqual(Atomics.load(new Int32Array(old.options.workerData.cancellation), 0), generation);
  assert.equal(old.terminated, undefined);
  assert.equal(old.messages.length, 1, 'replacement waits for the active decoder to stop');
  old.emit('message', { type: 'result', id: firstId, text: 'stale' });
  const current = service.worker;
  assert.equal(current, old);
  current.emit('message', { type: 'result', id: current.last.id, text: 'fresh' });
  assert.equal(await second, 'fresh');
  service.close();
  assert.equal(old.terminated, true, 'closing the app really releases its worker');
});
test('a burst during model initialization retains only the latest waiting selection', async () => {
  const service = new Translation('/unused', () => {}, FakeWorker);
  const requests = [service.run('translate', 'initial')];
  const worker = service.worker;
  const firstId = worker.last.id;
  for (let i = 0; i < 100; i++) requests.push(service.run('translate', `selection ${i}`));
  assert.equal(worker.messages.length, 1);
  assert.equal(service.worker, worker);
  assert.deepEqual(await Promise.all(requests.slice(0, -1)), new Array(100).fill(null));
  worker.emit('message', { type: 'cancelled', id: firstId });
  assert.equal(worker.messages.length, 2);
  assert.equal(worker.last.text, 'selection 99');
  worker.emit('message', { type: 'result', id: worker.last.id, text: '最新' });
  assert.equal(await requests.at(-1), '最新');
  service.close();
});
test('download survives closing a lookup, and a completed marker is required for offline mode', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'milo-model-'));
  const service = new Translation(dir, () => {}, FakeWorker);
  try {
    assert.equal(service.isReady(), false);
    const ready = service.run('prepare');
    const worker = service.worker;
    service.cancel();
    assert.equal(worker.terminated, undefined);
    await assert.rejects(service.run('translate', 'new'), /正在下載/);
    worker.emit('message', { type: 'ready', id: worker.last.id });
    await ready;
    assert.equal(service.isReady(), true);
    const translation = service.run('translate', 'new');
    assert.equal(service.worker, worker, 'reuse idle model instead of loading it again');
    worker.emit('message', { type: 'result', id: worker.last.id, text: '新的' });
    assert.equal(await translation, '新的');
  } finally { service.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('worker failures release pending work so a later request can recover', async () => {
  const service = new Translation('/unused', () => {}, FakeWorker);
  const request = service.run('translate', 'new');
  service.worker.emit('error', new Error('native backend unavailable'));
  await assert.rejects(request, /已停止/);
  assert.equal(service.worker, null);
  service.close();
});
test('an inference error preserves a completed cache, and cancellation does not invalidate it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'milo-model-'));
  const service = new Translation(dir, () => {}, FakeWorker);
  try {
    const ready = service.run('prepare');
    const worker = service.worker;
    worker.emit('message', { type: 'ready', id: worker.last.id });
    await ready;
    const request = service.run('translate', 'new');
    worker.emit('message', { type: 'error', phase: 'translate', id: worker.last.id, message: 'temporary decoding failure' });
    await assert.rejects(request, /請重試/);
    assert.equal(service.isReady(), true);
    const cancelled = service.run('translate', 'cancelled');
    service.cancel();
    assert.equal(await cancelled, null);
    assert.equal(service.isReady(), true);
    assert.equal(service.needsRepair, false);
  } finally { service.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('a model-state write failure rejects preparation without crashing the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'milo-model-write-'));
  const service = new Translation(dir, () => {}, FakeWorker);
  try {
    const ready = service.run('prepare');
    fs.mkdirSync(path.join(dir, 'ready.json'));
    service.worker.emit('message', { type: 'ready', id: service.worker.last.id });
    await assert.rejects(ready, /磁碟空間/);
    assert.equal(service.preparing, false);
    assert.equal(service.isReady(), false);
  } finally { service.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
