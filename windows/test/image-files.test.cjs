'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { prepareLessonImage } = require('../src/image-files.cjs');

test('JPEG, PNG and WebP are detected by content, normalized without modifying originals, and disposed', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'milo-image-test-'));
  try {
    for (const format of ['jpeg', 'png', 'webp']) {
      const original = await sharp({ create: { width: 32, height: 20, channels: 4, background: { r: 20, g: 60, b: 100, alpha: 0.5 } } })
        .toFormat(format).toBuffer();
      const sourcePath = path.join(directory, 'selected-' + format + '.unrelated-extension');
      await fs.writeFile(sourcePath, original);
      const prepared = await prepareLessonImage(sourcePath);
      const normalizedDirectory = path.dirname(prepared.filePath);
      try {
        assert.equal(prepared.name, path.basename(sourcePath));
        assert.equal(prepared.width, 32); assert.equal(prepared.height, 20);
        assert.equal(path.basename(prepared.filePath), 'lesson.jpg');
        assert.notEqual(normalizedDirectory, directory);
        assert.match(path.basename(normalizedDirectory), /^milo-image-learning-/);
        assert.match(prepared.preview, /^data:image\/jpeg;base64,/);
        assert.equal(prepared.preview.includes(directory), false, 'preview contains image data and no local path');
        const metadata = await sharp(prepared.filePath).metadata();
        assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.channels, 3);
        assert.equal(metadata.exif, undefined);
        assert.deepEqual(await fs.readFile(sourcePath), original, 'original is never overwritten');
        const preview = await sharp(Buffer.from(prepared.preview.split(',')[1], 'base64')).metadata();
        assert.equal(preview.format, 'jpeg');
        assert.ok(preview.width <= 640 && preview.height <= 640);
      } finally { await Promise.all([prepared.dispose(), prepared.dispose()]); }
      await assert.rejects(fs.stat(normalizedDirectory), { code: 'ENOENT' });
      assert.deepEqual(await fs.readFile(sourcePath), original, 'disposal keeps the selected original');
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('normalization applies orientation, strips private metadata and limits dimensions', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'milo-image-test-'));
  let prepared;
  try {
    const sourcePath = path.join(directory, 'orientation-' + 'a'.repeat(160) + '.jpg');
    await sharp({ create: { width: 4000, height: 20, channels: 3, background: '#448866' } })
      .jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'private source metadata' } } }).toFile(sourcePath);
    prepared = await prepareLessonImage(sourcePath);
    assert.equal(prepared.name.length, 150);
    assert.equal(prepared.height, 3072);
    assert.ok(prepared.width < prepared.height);
    const metadata = await sharp(prepared.filePath).metadata();
    assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined);
    assert.equal(metadata.icc, undefined);
    const preview = await sharp(Buffer.from(prepared.preview.split(',')[1], 'base64')).metadata();
    assert.equal(preview.height, 640);
    assert.equal(preview.exif, undefined);
  } finally { await prepared?.dispose(); await fs.rm(directory, { recursive: true, force: true }); }
});

test('invalid, non-file and oversized sources fail without revealing a local path or leaving temporary output', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'milo-image-test-'));
  try {
    const invalid = path.join(directory, 'private-name.png');
    await fs.writeFile(invalid, 'this is not an image');
    const empty = path.join(directory, 'empty.png'); await fs.writeFile(empty, '');
    const truncated = path.join(directory, 'truncated.jpg'); await fs.writeFile(truncated, Buffer.from([0xff, 0xd8, 0xff, 0x00]));
    const oversized = path.join(directory, 'huge.jpg');
    const handle = await fs.open(oversized, 'w'); await handle.truncate(20 * 1024 * 1024 + 1); await handle.close();
    for (const source of [invalid, empty, truncated, oversized, directory, path.join(directory, 'missing.jpg'), 'relative.jpg']) {
      await assert.rejects(prepareLessonImage(source), error => {
        assert.equal(error.message.includes(directory), false);
        assert.equal(error.message.includes('private-name'), false);
        if (source === oversized) assert.match(error.message, /20 MB/);
        return true;
      });
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('a valid PNG header above the pixel limit is rejected before decoding its image data', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'milo-image-test-'));
  try {
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
    // Keep a valid IHDR checksum while declaring dimensions above the limit;
    // the tiny payload avoids allocating an actual 36-megapixel test image.
    image.writeUInt32BE(6000, 16); image.writeUInt32BE(6000, 20);
    let crc = 0xffffffff;
    for (const byte of image.subarray(12, 29)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    image.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
    const sourcePath = path.join(directory, 'large-dimensions.png'); await fs.writeFile(sourcePath, image);
    await assert.rejects(prepareLessonImage(sourcePath), /像素過大/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('a temporary-output write failure removes its new directory and keeps the original', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'milo-image-test-'));
  const writeFile = fs.writeFile;
  let outputDirectory;
  try {
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const sourcePath = path.join(directory, 'original.png'); await writeFile(sourcePath, image);
    fs.writeFile = async (file, ...args) => {
      if (path.basename(file) === 'lesson.jpg') {
        outputDirectory = path.dirname(file);
        throw new Error('simulated temporary-output disk failure');
      }
      return writeFile(file, ...args);
    };
    await assert.rejects(prepareLessonImage(sourcePath), /無法讀取/);
    assert.ok(outputDirectory, 'failure occurred after temporary-directory creation');
    await assert.rejects(fs.stat(outputDirectory), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile(sourcePath), image);
  } finally { fs.writeFile = writeFile; await fs.rm(directory, { recursive: true, force: true }); }
});
