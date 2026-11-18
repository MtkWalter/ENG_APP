'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { NativeSpeech, validateWave } = require('../src/speech.cjs');
(async () => {
  if (process.platform !== 'win32') { console.log('Windows speech integration runs on the Windows runner.'); return; }
  let processes = 0;
  const service = new NativeSpeech({ spawnProcess(...args) { processes++; return spawn(...args); } });
  try {
    const started = performance.now();
    const result = await service.render('Hello. This is Milo English.');
    const synthesisMs = performance.now() - started;
    const bytes = Buffer.from(result.audio, 'base64');
    assert.ok(validateWave(bytes)); assert.ok(bytes.length > 1000);
    const output = path.join(__dirname, '..', 'test-results'); fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'windows-native-speech.wav'), bytes);
    service.stop();
    const replayStarted = performance.now();
    const replay = await service.render('Hello. This is Milo English.');
    const replayMs = performance.now() - replayStarted;
    assert.deepEqual(replay, result); assert.equal(processes, 1, 'replay uses audio already synthesized by Windows');
    const report = { voice: result.voice, english: result.english, bytes: bytes.length, processes, synthesisMs, replayMs };
    fs.writeFileSync(path.join(output, 'speech-performance.json'), JSON.stringify(report, null, 2));
    console.log('Actual Windows speech engine produced non-silent WAV; replay reused it:', report);
  } finally { service.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
