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
  constructor() { super(); FakeWorker.workers.push(this); }
  postMessage(message) { this.last = message; }
  terminate() { this.terminated = true; return Promise.resolve(0); }
}
test('closing a selection cancels active work and rejects late results from the old worker', async () => {
  const service = new Translation('/unused', () => {}, FakeWorker);
  const first = service.run('translate', 'first');
  const old = service.worker;
  const second = service.run('translate', 'second');
  assert.equal(await first, null);
  assert.equal(old.terminated, true);
  old.emit('message', { type: 'result', id: old.last.id, text: 'stale' });
  const current = service.worker;
  current.emit('message', { type: 'result', id: current.last.id, text: 'fresh' });
  assert.equal(await second, 'fresh');
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
