'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const root = context.appOutDir;
  const asar = await import('@electron/asar');
  const archive = path.join(root, 'resources', 'app.asar');
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'android', 'integrity.json'), 'utf8'));
  const bytes = asar.extractFile(archive, 'assets/android/study_dictionary.db');
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error('Packaged dictionary hash mismatch');
  const native = path.join(root, 'resources', 'app.asar.unpacked', 'node_modules');
  for (const file of [
    'onnxruntime-node/bin/napi-v3/win32/x64/onnxruntime_binding.node',
    'onnxruntime-node/bin/napi-v3/win32/x64/onnxruntime.dll',
    '@img/sharp-win32-x64/lib/sharp-win32-x64.node'
  ]) if (!fs.existsSync(path.join(native, file))) throw new Error('Windows native dependency missing: ' + file);
  const executable = fs.readFileSync(path.join(root, 'Milo-English.exe'));
  for (const name of ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']) {
    if (!fs.existsSync(path.join(root, name))) throw new Error('App-local Microsoft runtime missing: ' + name);
  }
  if (executable.toString('ascii', 0, 2) !== 'MZ' || executable.readUInt16LE(executable.readUInt32LE(0x3c) + 4) !== 0x8664) {
    throw new Error('Expected a Windows x64 PE executable');
  }
  console.log('Verified packaged Windows x64 executable, dictionary hash, and native CPU inference libraries.');
};
