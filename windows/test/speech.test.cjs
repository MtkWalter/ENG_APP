'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { NativeSpeech, validateWave } = require('../src/speech.cjs');
function wave() {
  const data = Buffer.alloc(444); data.write('RIFF'); data.writeUInt32LE(436, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(400, 40); data.writeInt16LE(1000, 44);
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
