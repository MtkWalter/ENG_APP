'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { NativeSpeech, validateWave } = require('../src/speech.cjs');
(async () => {
  if (process.platform !== 'win32') { console.log('Windows speech integration runs on the Windows runner.'); return; }
  const service = new NativeSpeech();
  try {
    const result = await service.render('Hello. This is Milo English.');
    const bytes = Buffer.from(result.audio, 'base64');
    assert.ok(validateWave(bytes)); assert.ok(bytes.length > 1000);
    const output = path.join(__dirname, '..', 'test-results'); fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'windows-native-speech.wav'), bytes);
    console.log('Actual Windows speech engine produced non-silent WAV:', { voice: result.voice, english: result.english, bytes: bytes.length });
  } finally { service.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
