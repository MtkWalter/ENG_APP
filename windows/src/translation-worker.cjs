'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { MODEL, REVISION, chunks } = require('./translation-text.cjs');

let translator;
let lastProgress = 0;
async function initialize(download) {
  if (translator) return;
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = workerData.cacheDir;
  env.allowLocalModels = !download;
  env.allowRemoteModels = download;
  env.backends.onnx.logLevel = 'error';
  translator = await pipeline('translation', MODEL, {
    revision: REVISION,
    dtype: 'q8',
    device: 'cpu',
    local_files_only: !download,
    session_options: { intra_op_num_threads: 2, inter_op_num_threads: 1 },
    progress_callback: progress => {
      if (progress.status === 'progress' || progress.status === 'done') {
        if (progress.status !== 'done' && Date.now() - lastProgress < 250) return;
        lastProgress = Date.now();
        parentPort.postMessage({ type: 'progress', file: progress.file,
          progress: progress.status === 'done' ? 100 : Math.round(progress.progress || 0),
          done: progress.status === 'done', loaded: progress.loaded || 0, total: progress.total || 0 });
      }
    }
  });
  env.allowRemoteModels = false;
}
parentPort.on('message', async message => {
  try {
    await initialize(message.type === 'prepare');
    if (message.type === 'prepare') {
      parentPort.postMessage({ type: 'ready', id: message.id }); return;
    }
    const OpenCC = require('opencc-js');
    const convert = OpenCC.Converter({ from: 'cn', to: 'twp' });
    const translated = [];
    for (const part of chunks(message.text)) {
      const result = await translator(part, { max_new_tokens: 512, num_beams: 1 });
      translated.push(convert(result[0].translation_text));
    }
    parentPort.postMessage({ type: 'result', id: message.id, text: translated.join('\n') });
  } catch (error) {
    parentPort.postMessage({ type: 'error', id: message.id, message: String(error.message).slice(0, 800) });
  }
});
