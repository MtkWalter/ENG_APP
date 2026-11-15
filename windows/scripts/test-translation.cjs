'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { Translation } = require('../src/translation.cjs');
const directory = process.env.MILO_MODEL_DIR || path.join(os.tmpdir(), 'milo-translation-integration');
let service;
(async () => {
  try {
    service = new Translation(directory, progress => {
      if (progress.done) console.log('Downloaded:', progress.file);
    });
    if (!service.isReady()) await service.run('prepare');
    service.close();
    // A fresh worker sets local_files_only and allowRemoteModels=false.
    service = new Translation(directory, () => {});
    const result = await service.run('translate', 'This is a new book.');
    assert.match(result, /[\u4e00-\u9fff]/);
    assert.equal(/[这书]/.test(result), false, 'OpenCC returns Traditional Chinese');
    console.log('Actual CPU inference using the downloaded cache, remote models disabled:', result);
  } finally { service?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
