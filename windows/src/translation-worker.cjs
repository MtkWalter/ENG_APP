'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { MODEL, REVISION, chunks } = require('./translation-text.cjs');

let translator;
let lastProgress = 0;
let CancellationCriteria, convert;
const cancellation = new Int32Array(workerData.cancellation);
async function initialize(download) {
  if (translator) return;
  const { pipeline, env, StoppingCriteria } = await import('@huggingface/transformers');
  CancellationCriteria = class extends StoppingCriteria {
    constructor(generation) { super(); this.generation = generation; }
    _call(inputIds) { return inputIds.map(() => Atomics.load(cancellation, 0) !== this.generation); }
  };
  env.cacheDir = workerData.cacheDir;
  env.allowLocalModels = !download;
  env.allowRemoteModels = download;
  env.backends.onnx.logLevel = 'error';
  // Commit both initialized pieces together, so retrying after a converter
  // failure cannot leave a truthy model with no text converter.
  const nextConvert = require('opencc-js').Converter({ from: 'cn', to: 'twp' });
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
  convert = nextConvert;
}
parentPort.on('message', async message => {
  const cancelled = () => Atomics.load(cancellation, 0) !== message.generation;
  const stopped = () => parentPort.postMessage({ type: 'cancelled', id: message.id });
  let phase = 'initialize';
  try {
    if (cancelled()) { stopped(); return; }
    await initialize(message.type === 'prepare');
    if (cancelled()) { stopped(); return; }
    if (message.type === 'prepare') {
      parentPort.postMessage({ type: 'ready', id: message.id }); return;
    }
    phase = 'translate';
    const translated = [];
    const stoppingCriteria = new CancellationCriteria(message.generation);
    for (const part of chunks(message.text)) {
      if (cancelled()) { stopped(); return; }
      const result = await translator(part, { max_new_tokens: 512, num_beams: 1, stopping_criteria: [stoppingCriteria] });
      if (cancelled()) { stopped(); return; }
      translated.push(convert(result[0].translation_text));
    }
    parentPort.postMessage({ type: 'result', id: message.id, text: translated.join('\n') });
  } catch (error) {
    if (cancelled()) { stopped(); return; }
    parentPort.postMessage({ type: 'error', id: message.id, phase, message: String(error.message).slice(0, 800) });
  }
});
