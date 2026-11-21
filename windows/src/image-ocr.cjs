'use strict';

const fs = require('node:fs');
const path = require('node:path');
const abortError = () => Object.assign(new Error('已取消圖片文字辨識。'), { name: 'AbortError' });

// One on-demand worker. Recognition runs outside the UI process; no worker,
// language download or page observer remains alive during local gameplay.
class ImageOCR {
  constructor({ createWorker, timeout = 30000 } = {}) {
    this.createWorker = createWorker;
    this.timeout = timeout;
    this.active = null;
  }
  cancel() { this.active?.cancel(); }
  async recognize(filePath, { signal, onProgress = () => {} } = {}) {
    this.cancel();
    if (signal?.aborted) throw abortError();
    let rejectCancelled, timer;
    const cancelled = new Promise((_resolve, reject) => { rejectCancelled = reject; });
    const job = { cancelled: false, worker: null, cancel: () => {
      if (job.cancelled) return;
      job.cancelled = true; rejectCancelled(abortError());
      void job.worker?.terminate().catch(() => {});
    } };
    this.active = job;
    const stop = () => job.cancel();
    signal?.addEventListener('abort', stop, { once: true });
    const task = async () => {
      const language = require('@tesseract.js-data/eng');
      if (!fs.existsSync(path.join(language.langPath, 'eng.traineddata.gz'))) throw new Error('圖片辨識資料不完整，請重新安裝 Milo。');
      const createWorker = this.createWorker || require('tesseract.js').createWorker;
      const worker = await createWorker('eng', 1, { langPath: language.langPath, gzip: true, cacheMethod: 'none',
        logger: info => { if (!job.cancelled && info.status === 'recognizing text') onProgress(Math.round(info.progress * 100)); },
        errorHandler: () => {} });
      job.worker = worker;
      if (job.cancelled) { await worker.terminate(); throw abortError(); }
      await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
      // Electron can read bundled ASAR assets; libvips cannot open that virtual
      // path itself. Bytes also keep OCR independent of native path handling.
      const source = await fs.promises.readFile(filePath);
      const image = await require('sharp')(source).resize({ width: 1800, height: 1800, fit: 'inside' })
        .greyscale().normalize().sharpen().png().toBuffer();
      if (job.cancelled) throw abortError();
      const { data } = await worker.recognize(image);
      return { text: String(data.text || '').slice(0, 12000).replace(/(^|\s)\|(?=\s+[A-Za-z])/g, '$1I').trim(), confidence: Math.round(data.confidence || 0) };
    };
    try {
      const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('圖片辨識超過 30 秒。可以先玩內建主題，或自行輸入英文教材。')), this.timeout); });
      return await Promise.race([task(), cancelled, timeout]);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', stop);
      job.cancelled = true;
      // A worker still initializing observes cancelled immediately on arrival.
      await job.worker?.terminate().catch(() => {});
      if (this.active === job) this.active = null;
    }
  }
  close() { this.cancel(); }
}
module.exports = { ImageOCR };
