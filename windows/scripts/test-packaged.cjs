'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const report = path.join(root, 'test-results', 'packaged-self-test.json');
fs.mkdirSync(path.dirname(report), { recursive: true });
const args = ['--milo-self-test', '--milo-self-test-report=' + report];
if (process.env.MILO_MODEL_DIR) args.push('--milo-self-test-model-dir=' + process.env.MILO_MODEL_DIR);
const child = spawn(path.join(root, 'dist', 'win-unpacked', 'Milo-English.exe'), args, { stdio: 'inherit' });
const timer = setTimeout(() => { child.kill(); console.error('Packaged application timed out'); process.exitCode = 1; }, 120000);
child.on('error', error => { clearTimeout(timer); console.error(error); process.exitCode = 1; });
child.on('exit', code => {
  clearTimeout(timer);
  try {
    assert.equal(code, 0, 'Packaged executable exits successfully');
    const result = JSON.parse(fs.readFileSync(report, 'utf8'));
    assert.equal(result.ok, true); assert.equal(result.platform, 'win32'); assert.equal(result.arch, 'x64');
    assert.equal(result.imageLearning.normalized, true);
    assert.deepEqual(result.imageLearning.characters, ['kuromi', 'cinnamoroll']);
    console.log('Packaged Windows application self-test passed:', result);
  } catch (error) { console.error(error); process.exitCode = 1; }
});
