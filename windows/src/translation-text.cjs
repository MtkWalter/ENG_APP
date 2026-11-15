'use strict';

const MODEL = 'Xenova/opus-mt-en-zh';
const REVISION = '046f55aec303cdee3e0318604406d4df20f1e8ea';
// Small chunks keep Marian's 512-token context from silently truncating long selections.
function chunks(text, limit = 250) {
  const output = [];
  const sentences = new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text);
  for (const { segment } of sentences) {
    const words = segment.trim().split(/\s+/);
    let part = '';
    for (let word of words) {
      while (word.length > limit) {
        if (part) { output.push(part); part = ''; }
        output.push(word.slice(0, limit)); word = word.slice(limit);
      }
      if (part && part.length + word.length + 1 > limit) { output.push(part); part = ''; }
      part += (part ? ' ' : '') + word;
    }
    if (part) output.push(part);
  }
  return output;
}
module.exports = { MODEL, REVISION, chunks };
