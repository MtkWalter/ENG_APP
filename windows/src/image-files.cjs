'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 32_000_000;
class ImagePreparationError extends Error {}

function supportedSignature(bytes) {
  return (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP');
}

async function prepareLessonImage(selectedPath) {
  let handle, input, normalized, thumbnail, directory;
  try {
    if (typeof selectedPath !== 'string' || !path.isAbsolute(selectedPath) || selectedPath.includes('\0')) {
      throw new ImagePreparationError('請從選檔視窗選擇一張圖片。');
    }
    handle = await fs.open(selectedPath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) throw new ImagePreparationError('請選擇一般圖片檔案。');
    if (stat.size > MAX_SOURCE_BYTES) throw new ImagePreparationError('圖片不可超過 20 MB。');
    if (!stat.size) throw new ImagePreparationError('這個檔案沒有圖片內容。');
    // Read only the file selected by the native dialog. One extra byte detects
    // a file growing during the read without accepting an unbounded buffer.
    input = Buffer.allocUnsafe(stat.size + 1);
    let length = 0;
    while (length < input.length) {
      const { bytesRead } = await handle.read(input, length, input.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    await handle.close(); handle = null;
    if (length !== stat.size) throw new ImagePreparationError('圖片在讀取時已變更，請重新選擇。');
    const source = input.subarray(0, length);
    if (!supportedSignature(source)) throw new ImagePreparationError('請選擇 JPEG、PNG 或 WebP 圖片。');

    // Load native image processing only when a user actually selects a photo.
    const sharp = require('sharp');
    const options = { limitInputPixels: MAX_PIXELS, failOn: 'warning', pages: 1 };
    const metadata = await sharp(source, options).metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height) {
      throw new ImagePreparationError('請選擇 JPEG、PNG 或 WebP 圖片。');
    }
    if (metadata.width * metadata.height > MAX_PIXELS) throw new ImagePreparationError('圖片像素過大，請選擇 3,200 萬像素以內的圖片。');
    const render = quality => sharp(source, options).rotate()
      .resize({ width: 3072, height: 3072, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality }).toBuffer({ resolveWithObject: true });
    let rendered = await render(92);
    normalized = rendered.data;
    if (normalized.length > MAX_OUTPUT_BYTES) {
      normalized.fill(0);
      rendered = await render(85); normalized = rendered.data;
    }
    if (normalized.length > MAX_OUTPUT_BYTES) throw new ImagePreparationError('圖片整理後仍過大，請先縮小圖片再選擇。');
    thumbnail = await sharp(normalized, options)
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 }).toBuffer();
    const preview = 'data:image/jpeg;base64,' + thumbnail.toString('base64');
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'milo-image-learning-'));
    const filePath = path.join(directory, 'lesson.jpg');
    await fs.writeFile(filePath, normalized, { mode: 0o600, flag: 'wx' });
    let disposal;
    const preparedDirectory = directory;
    return {
      filePath,
      name: path.basename(selectedPath).replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 150) || '圖片',
      preview,
      width: rendered.info.width,
      height: rendered.info.height,
      dispose: () => disposal ||= fs.rm(preparedDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 75 }).catch(error => { disposal = null; throw error; })
    };
  } catch (error) {
    if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    if (error instanceof ImagePreparationError) throw error;
    if (/pixel limit|exceeds.*pixel/i.test(error?.message || '')) {
      throw new ImagePreparationError('圖片像素過大，請選擇 3,200 萬像素以內的圖片。');
    }
    throw new ImagePreparationError('無法讀取這張圖片。請確認檔案完整，再重新選擇。');
  } finally {
    if (handle) await handle.close().catch(() => {});
    input?.fill(0); normalized?.fill(0); thumbnail?.fill(0);
  }
}

module.exports = { prepareLessonImage };
