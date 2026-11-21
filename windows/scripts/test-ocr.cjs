'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ImageOCR } = require('../src/image-ocr.cjs');
const { materialFromText } = require('../src/game-material.cjs');
const { loadDictionary } = require('../src/dictionary.cjs');
const root = path.join(__dirname, '..');
(async () => {
  const ocr = new ImageOCR(), start = performance.now();
  let dictionary;
  try {
    const recognized = await ocr.recognize(path.join(root, 'assets', 'ocr-sample.png'));
    assert.match(recognized.text, /breakfast/i); assert.match(recognized.text, /sandwich/i);
    assert.ok(recognized.confidence >= 30);
    dictionary = await loadDictionary(path.join(root, 'assets', 'android'));
    const prepared = materialFromText(recognized.text, dictionary, 'image');
    assert.ok(prepared.pack.words.length >= 3); assert.ok(prepared.material.sourcePatterns >= 2);
    assert.equal(ocr.active, null, 'OCR worker is gone before gameplay starts');
    const report = { ok: true, local: true, aiRequests: 0, bundledLanguage: true, workerReleased: true,
      durationMs: Math.round(performance.now() - start), confidence: recognized.confidence,
      fixtureWords: prepared.pack.words.map(item => item.word), sourcePatterns: prepared.material.sourcePatterns };
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    fs.writeFileSync(path.join(root, 'test-results', 'ocr.json'), JSON.stringify(report, null, 2));
    console.log('Real bundled English OCR and local game material passed:', report);
  } finally { ocr.close(); dictionary?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
