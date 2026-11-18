'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { NativeSpeech, validateWave } = require('../src/speech.cjs');
function wave(size = 444) {
  const data = Buffer.alloc(size); data.write('RIFF'); data.writeUInt32LE(size - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(size - 44, 40); data.writeInt16LE(1000, 44);
  return data;
}
function fake() {
  const calls = [];
  const service = new NativeSpeech({ platform: 'win32', spawnProcess(executable, args, options) {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => { child.killed = true; };
    const call = { executable, args, options, child, input: '' };
    child.stdin.on('data', data => { call.input += data.toString(); });
    calls.push(call); return child;
  } });
  return { service, calls };
}
function finish(call, data = wave()) {
  call.child.stdout.end(JSON.stringify({ audio: data.toString('base64'), voice: 'English', english: true }));
  call.child.emit('close', 0);
}
test('read text is passed as stdin data, and only a real WAV is accepted', async () => {
  const { service, calls } = fake();
  const text = "new'; $(Write-Output nope)";
  const result = service.render(text);
  const call = calls[0];
  assert.equal(call.args.some(arg => arg.includes(text)), false);
  assert.equal(JSON.parse(call.input).text, text);
  assert.equal(call.options.windowsHide, true);
  call.child.stdout.end(JSON.stringify({ audio: wave().toString('base64'), voice: 'Windows English', english: true }));
  call.child.emit('close', 0);
  assert.equal((await result).voice, 'Windows English');
});
test('changing the selection cancels old synthesis and ignores late output', async () => {
  const { service, calls } = fake();
  const first = service.render('first'); const second = service.render('second');
  assert.equal(await first, null); assert.equal(calls[0].child.killed, true);
  calls[0].child.emit('close', 1);
  calls[1].child.stdout.end(JSON.stringify({ audio: wave().toString('base64'), voice: 'English', english: true }));
  calls[1].child.emit('close', 0); assert.equal((await second).english, true);
});
test('missing voices and empty audio yield actionable errors rather than silent success', async () => {
  const { service, calls } = fake();
  const result = service.render('new');
  calls[0].child.stdout.end(JSON.stringify({ audio: Buffer.alloc(100).toString('base64') }));
  calls[0].child.emit('close', 0);
  await assert.rejects(result, /Windows 朗讀無法啟動/);
  assert.equal(validateWave(Buffer.alloc(400)), false);
});
test('replaying normalized text reuses completed audio and still cancels pending synthesis', async () => {
  const { service, calls } = fake();
  const first = service.render('  Hello.  '); finish(calls[0]);
  const rendered = await first;
  service.stop();
  const pending = service.render('different text');
  const repeated = await service.render('Hello.');
  assert.equal(await pending, null);
  assert.equal(calls[1].child.killed, true);
  assert.equal(calls.length, 2, 'replay does not launch another PowerShell process');
  assert.deepEqual(repeated, rendered);
  rendered.audio = 'changed by a caller';
  assert.equal((await service.render('Hello.')).audio, repeated.audio, 'cached audio cannot be changed by a caller');
  finish(calls[1]);
  const retry = service.render('different text');
  assert.equal(calls.length, 3, 'cancelled late output is never cached');
  finish(calls[2]); await retry;
});
test('failed audio is retried and the replay cache has entry and memory bounds', async () => {
  const { service, calls } = fake();
  const failed = service.render('bad'); finish(calls[0], Buffer.alloc(100));
  await assert.rejects(failed);
  const retry = service.render('bad');
  assert.equal(calls.length, 2); finish(calls[1]); await retry;
  for (let i = 0; i < 12; i++) {
    const pending = service.render('word ' + i); finish(calls.at(-1)); await pending;
  }
  assert.ok(service.cache.size <= 8);
  const before = calls.length;
  await service.render('word 11'); assert.equal(calls.length, before);
  const evicted = service.render('word 0'); assert.equal(calls.length, before + 1);
  finish(calls.at(-1)); await evicted;
  for (let i = 0; i < 4; i++) {
    const pending = service.render('long audio ' + i); finish(calls.at(-1), wave(1024 * 1024)); await pending;
    assert.ok(service.cacheBytes <= 8 * 1024 * 1024);
  }
  assert.ok(service.cache.size < 4, 'large audio evicts entries before the count limit');
  const oversized = service.render('very long audio'); finish(calls.at(-1), wave(4 * 1024 * 1024)); await oversized;
  assert.equal(service.cache.has('very long audio'), false, 'oversized audio is played without retaining it');
});
