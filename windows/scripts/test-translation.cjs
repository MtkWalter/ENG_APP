'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { Translation } = require('../src/translation.cjs');
const directory = process.env.MILO_MODEL_DIR || path.join(os.tmpdir(), 'milo-translation-integration');
let service;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function assertTraditional(result) {
  assert.match(result, /[\u4e00-\u9fff]/);
  assert.equal(/[这书]/.test(result), false, 'OpenCC returns Traditional Chinese');
}
(async () => {
  try {
    if (process.argv.includes('--cached')) {
      let workersCreated = 0, cancelledRequests = 0;
      class CountingWorker extends Worker {
        constructor(...args) {
          super(...args); workersCreated++;
          this.on('message', message => { if (message.type === 'cancelled') cancelledRequests++; });
        }
      }
      // This fresh process loads only existing local files; remote models stay disabled.
      service = new Translation(directory, () => {}, CountingWorker);
      assert.equal(service.isReady(), true);
      const started = performance.now();
      const obsolete = [service.run('translate', 'This is an obsolete selection.')];
      const worker = service.worker;
      await wait(20);
      for (let i = 0; i < 40; i++) obsolete.push(service.run('translate', `This is obsolete selection ${i}.`));
      const newest = service.run('translate', 'This is a new book.');
      assert.deepEqual(await Promise.all(obsolete), new Array(obsolete.length).fill(null));
      assertTraditional(await newest);
      const coldMs = performance.now() - started;
      let measured = performance.now();
      const result = await service.run('translate', 'This is a new book.');
      const warmMs = performance.now() - measured;
      assertTraditional(result);
      const replacementMs = [];
      for (let i = 0; i < 3; i++) {
        const discarded = service.run('translate', 'This is a long sentence about books and reading. '.repeat(30));
        await wait(50);
        measured = performance.now();
        const replacement = service.run('translate', 'This is a new book.');
        assert.equal(await discarded, null);
        assertTraditional(await replacement);
        replacementMs.push(performance.now() - measured);
        assert.equal(service.worker, worker, 'cancellation retains the loaded native model');
        assert.equal(service.isReady(), true, 'intentional cancellation leaves the cache usable');
      }
      assert.equal(workersCreated, 1, 'rapid selection never creates overlapping model workers');
      assert.equal(cancelledRequests, 4, 'obsolete initialization and each active inference acknowledge cancellation');
      const report = { workersCreated, obsoleteSelections: obsolete.length + 3, cancelledRequests,
        coldMs: Math.round(coldMs), warmMs: Math.round(warmMs), replacementMs: replacementMs.map(Math.round),
        result, cacheReady: service.isReady() };
      fs.mkdirSync(path.join(__dirname, '..', 'test-results'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, '..', 'test-results', 'translation-performance.json'), JSON.stringify(report, null, 2));
      console.log('Actual CPU inference, local cache only; burst and repeated cancellation:', JSON.stringify(report));
      return;
    }
    service = new Translation(directory, progress => {
      if (progress.done) console.log('Downloaded:', progress.file);
    });
    if (!service.isReady()) await service.run('prepare');
    service.close();
    service = null;
    // Native ONNX runtimes are process scoped. Verify a fresh offline start in
    // its own process, rather than unloading and re-registering the native DLL.
    const child = spawnSync(process.execPath, [__filename, '--cached'], {
      env: process.env, stdio: 'inherit', timeout: 180000
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, 'fresh offline translation and cancellation stress test passed');
  } finally { service?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
