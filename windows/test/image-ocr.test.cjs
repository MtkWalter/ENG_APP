'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ImageOCR } = require('../src/image-ocr.cjs');
const file = path.join(__dirname, '..', 'assets', 'ocr-sample.png');
test('cancel during initialization rejects promptly and terminates a late worker', async () => {
  let complete, terminated = 0;
  const ocr = new ImageOCR({ createWorker: () => new Promise(resolve => { complete = resolve; }) });
  const pending = ocr.recognize(file); ocr.cancel();
  await assert.rejects(pending, error => error.name === 'AbortError');
  complete({ terminate: async () => { terminated++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(terminated, 1); assert.equal(ocr.active, null);
});
test('a stuck OCR job times out and releases its worker instead of blocking gameplay', async () => {
  let terminated = 0;
  const ocr = new ImageOCR({ timeout: 40, createWorker: async () => ({ setParameters: async () => {},
    recognize: () => new Promise(() => {}), terminate: async () => { terminated++; } }) });
  await assert.rejects(ocr.recognize(file), /超過/);
  assert.equal(terminated, 1); assert.equal(ocr.active, null);
});
