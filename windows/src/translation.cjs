'use strict';

const { Worker } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { MODEL, REVISION } = require('./translation-text.cjs');

class Translation {
  constructor(directory, onProgress, WorkerClass = Worker) {
    this.directory = directory;
    this.onProgress = onProgress;
    this.WorkerClass = WorkerClass;
    this.worker = null;
    this.pending = null;
    this.sequence = 0;
    this.preparing = false;
    this.needsRepair = false;
  }
  isReady() {
    try {
      const marker = JSON.parse(fs.readFileSync(path.join(this.directory, 'ready.json'), 'utf8'));
      return marker.model === MODEL && marker.revision === REVISION;
    } catch { return false; }
  }
  ensureWorker() {
    if (this.worker) return;
    const worker = new this.WorkerClass(path.join(__dirname, 'translation-worker.cjs'), {
      workerData: { cacheDir: this.directory }, resourceLimits: { maxOldGenerationSizeMb: 1536 }
    });
    this.worker = worker;
    worker.on('message', message => {
      if (worker !== this.worker) return;
      if (message.type === 'progress') { this.onProgress(message); return; }
      const pending = this.pending;
      if (!pending || message.id !== pending.id) return;
      this.pending = null;
      this.preparing = false;
      if (message.type === 'error') {
        this.needsRepair = true;
        try { fs.rmSync(path.join(this.directory, 'ready.json'), { force: true }); } catch {}
        pending.reject(new Error('離線翻譯無法完成。請檢查模型是否下載完整，再重新下載。', { cause: message.message }));
      } else {
        if (message.type === 'ready') {
          fs.mkdirSync(this.directory, { recursive: true });
          fs.writeFileSync(path.join(this.directory, 'ready.json'), JSON.stringify({ model: MODEL, revision: REVISION }));
        }
        pending.resolve(message.text || '');
      }
    });
    worker.on('error', () => this.fail(worker));
    worker.on('exit', () => this.fail(worker));
  }
  fail(worker) {
    if (this.worker !== worker) return;
    this.worker = null; this.preparing = false;
    if (this.pending) {
      this.pending.reject(new Error('離線翻譯已停止，請重試。'));
      this.pending = null;
    }
  }
  run(type, text) {
    if (this.preparing) return Promise.reject(new Error('模型正在下載，完成後即可翻譯。'));
    this.cancel(type === 'prepare');
    if (type === 'prepare') {
      if (this.needsRepair) fs.rmSync(this.directory, { recursive: true, force: true });
      this.needsRepair = false;
      fs.rmSync(path.join(this.directory, 'ready.json'), { force: true });
    }
    this.ensureWorker();
    const id = ++this.sequence;
    this.preparing = type === 'prepare';
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      this.worker.postMessage({ type, text, id });
    });
  }
  cancel(includeDownload = false) {
    if (this.preparing && !includeDownload) return;
    const active = !!this.pending;
    if (this.pending) { this.pending.resolve(null); this.pending = null; }
    // Terminate active inference instead of queuing obsolete selections.
    if (this.worker && (active || includeDownload)) { const worker = this.worker; this.worker = null; worker.terminate(); }
    this.preparing = false;
  }
  close() { this.cancel(true); }
}
module.exports = { Translation };
