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
    this.active = null;
    this.cancellation = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    this.sequence = 0;
    this.preparing = false;
    this.needsRepair = false;
    this.closed = false;
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
      workerData: { cacheDir: this.directory, cancellation: this.cancellation.buffer },
      resourceLimits: { maxOldGenerationSizeMb: 1536 }
    });
    this.worker = worker;
    worker.on('message', message => {
      if (worker !== this.worker) return;
      if (message.type === 'progress') { this.onProgress(message); return; }
      if (!this.active || message.id !== this.active.id) return;
      this.active = null;
      const pending = this.pending;
      if (!pending || message.id !== pending.id) { this.dispatch(); return; }
      this.pending = null;
      this.preparing = false;
      if (message.type === 'error') {
        if (message.phase === 'initialize') {
          this.needsRepair = true;
          try { fs.rmSync(path.join(this.directory, 'ready.json'), { force: true }); } catch {}
        }
        pending.reject(new Error(message.phase === 'initialize'
          ? '離線模型無法載入。請重新檢查 / 下載模型。'
          : '離線翻譯暫時無法完成，請重試。', { cause: message.message }));
      } else {
        if (message.type === 'ready') {
          try {
            fs.mkdirSync(this.directory, { recursive: true });
            fs.writeFileSync(path.join(this.directory, 'ready.json'), JSON.stringify({ model: MODEL, revision: REVISION }));
          } catch (error) {
            pending.reject(new Error('模型狀態無法儲存。請確認磁碟空間與資料夾權限，再重試。', { cause: error }));
            this.dispatch(); return;
          }
        }
        pending.resolve(message.type === 'cancelled' ? null : message.text || '');
      }
      this.dispatch();
    });
    worker.on('error', () => this.fail(worker));
    worker.on('exit', () => this.fail(worker));
  }
  fail(worker) {
    if (this.worker !== worker) return;
    this.worker = null; this.active = null; this.preparing = false;
    if (this.pending) {
      this.pending.reject(new Error('離線翻譯已停止，請重試。'));
      this.pending = null;
    }
  }
  run(type, text) {
    if (this.closed) return Promise.reject(new Error('離線翻譯已關閉。'));
    if (this.preparing) return Promise.reject(new Error('模型正在下載，完成後即可翻譯。'));
    this.cancel(type === 'prepare');
    const id = ++this.sequence;
    this.preparing = type === 'prepare';
    return new Promise((resolve, reject) => {
      // One active request and only the latest waiting selection. Obsolete text
      // never accumulates in the worker's message queue.
      this.pending = { id, type, text, generation: Atomics.load(this.cancellation, 0), resolve, reject };
      this.dispatch();
    });
  }
  dispatch() {
    if (this.closed || this.active || !this.pending) return;
    const pending = this.pending;
    try {
      if (pending.type === 'prepare') {
        if (this.needsRepair) fs.rmSync(this.directory, { recursive: true, force: true });
        this.needsRepair = false;
        fs.rmSync(path.join(this.directory, 'ready.json'), { force: true });
      }
      this.ensureWorker();
      this.active = { id: pending.id };
      const { id, type, text, generation } = pending;
      this.worker.postMessage({ type, text, id, generation });
    } catch (error) {
      this.active = null; this.pending = null; this.preparing = false;
      pending.reject(error);
    }
  }
  cancel(includeDownload = false) {
    if (this.preparing && !includeDownload) return;
    // A shared generation flag stops decoding between tokens, even while the
    // worker event loop is busy. Keep its native model loaded for the next word.
    Atomics.add(this.cancellation, 0, 1);
    if (this.pending) { this.pending.resolve(null); this.pending = null; }
    this.preparing = false;
  }
  close() {
    this.cancel(true); this.closed = true; this.active = null;
    if (this.worker) { const worker = this.worker; this.worker = null; worker.terminate(); }
  }
}
module.exports = { Translation };
