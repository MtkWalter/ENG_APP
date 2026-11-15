'use strict';
const fs = require('node:fs');
const path = require('node:path');
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Use Windows x64 or the Windows Actions workflow to build the Windows distribution.');
}
const source = process.env.MILO_CRT_DIR || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const target = path.join(__dirname, '..', 'build', 'runtime');
fs.mkdirSync(target, { recursive: true });
for (const name of ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll',
  'msvcp140_atomic_wait.dll', 'msvcp140_codecvt_ids.dll', 'concrt140.dll']) {
  const file = path.join(source, name);
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(target, name));
  else if (['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'].includes(name)) {
    throw new Error('Microsoft Visual C++ x64 runtime missing. Install the official VC++ 2015–2022 x64 redistributable, or set MILO_CRT_DIR to its app-local CRT directory.');
  }
}
fs.writeFileSync(path.join(target, 'README.txt'), 'Microsoft Visual C++ runtime DLLs (Microsoft Corporation). App-local dependencies for ONNX Runtime and sharp. Redistribution terms: https://visualstudio.microsoft.com/license-terms/vs2022-cruntime/\r\n');
