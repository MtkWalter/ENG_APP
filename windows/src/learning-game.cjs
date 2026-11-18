'use strict';

const PACK_START = 'MILO_GAME_PACK_V1';
const PACK_END = 'MILO_GAME_PACK_END';
const MAX_PACK_BYTES = 50 * 1024;
const STYLES = Object.freeze({
  puzzle: { title: '單字拼圖', instruction: '每完成一題，就揭開一塊拼圖；卡住時可以看線索。' },
  pet: { title: '餵食學習夥伴', instruction: '完成練習收集點心，再親手餵給夥伴；不會因答錯扣食物。' },
  quest: { title: '英文闖關', instruction: '依序通過記憶、拼字、句型三關，一步一步完成任務。' }
});

function invalid(message) { throw new Error('學習遊戲資料無法使用：' + message); }
function key(value) { return value.normalize('NFC').replaceAll('’', "'").trim().replace(/\s+/g, ' ').toLowerCase(); }
function answerKey(value) { return key(value).replace(/[.!?。！？]+$/, '').trim(); }
function record(value, name, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(name + '格式錯誤。');
  if (Object.keys(value).some(field => !fields.includes(field))) invalid(name + '含有不支援的欄位。');
}
function plain(value, name, limit) {
  if (typeof value !== 'string') invalid(name + '必須是文字。');
  if (value.length > limit || /[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(value)) invalid(name + '過長或含有不支援的字元。');
  const text = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!text) invalid(name + '不可空白。');
  const inspection = text.normalize('NFKC');
  if (/[<>]|&(?:lt|gt|#0*6[02]|#x0*3[ce]);/i.test(inspection) ||
      /(?:https?|ftp|file|data|javascript|vbscript|mailto):|www\.|\b[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\b|[/:?#])/i.test(inspection)) {
    invalid(name + '不可含有 HTML 或網址。');
  }
  return text;
}
function optional(value, name, limit) { return value === undefined ? undefined : plain(value, name, limit); }
function containsAnswer(prompt, answer) {
  const escaped = answerKey(answer).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z])' + escaped + '($|[^a-z])', 'i').test(key(prompt));
}
function cleanPack(input) {
  record(input, '遊戲資料', ['words', 'patterns']);
  if (!Array.isArray(input.words) || input.words.length < 3 || input.words.length > 8) invalid('需要 3 至 8 個單字。');
  if (!Array.isArray(input.patterns) || input.patterns.length < 2 || input.patterns.length > 5) invalid('需要 2 至 5 個句型。');
  const seenWords = new Set(), seenMeanings = new Set(), seenPatterns = new Set();
  const words = input.words.map(entry => {
    record(entry, '單字', ['word', 'meaning', 'phonetic', 'hint', 'example']);
    const word = plain(entry.word, '英文單字', 30);
    if (!/^[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+(?:['’][A-Za-z]+)*)*$/.test(word)) invalid('英文單字須為一個 30 字元以內的字。');
    const meaning = plain(entry.meaning, '單字意思', 80);
    if (seenWords.has(key(word))) invalid('英文單字不可重複。');
    if (seenMeanings.has(answerKey(meaning))) invalid('單字意思不可重複，以免選項有多個正解。');
    if (containsAnswer(meaning, word)) invalid('中文提示不可直接包含拼字答案。');
    seenWords.add(key(word)); seenMeanings.add(answerKey(meaning));
    const output = { word, meaning };
    for (const [field, limit] of [['phonetic', 80], ['hint', 140], ['example', 200]]) {
      const text = optional(entry[field], '單字' + field, limit);
      if (text !== undefined) output[field] = text;
    }
    return output;
  });
  const patterns = input.patterns.map(entry => {
    record(entry, '句型', ['prompt', 'answer', 'choices', 'explanation']);
    const prompt = plain(entry.prompt, '句型題目', 240);
    const answer = plain(entry.answer, '句型答案', 80);
    if (!/^[A-Za-z]+(?:[ '’-][A-Za-z]+)*[.!?]?$/.test(answer)) invalid('句型答案須為簡短英文。');
    if ((prompt.match(/_{2,}|\[blank\]|□/gi) || []).length !== 1) invalid('句型題目需要一個填空位置。');
    if (containsAnswer(prompt, answer)) invalid('句型題目不可直接包含答案。');
    if (seenPatterns.has(key(prompt))) invalid('句型題目不可重複。');
    seenPatterns.add(key(prompt));
    const output = { prompt, answer };
    if (entry.choices !== undefined) {
      if (!Array.isArray(entry.choices) || entry.choices.length < 3 || entry.choices.length > 4) invalid('句型選項需要 3 至 4 個。');
      const choices = entry.choices.map(choice => plain(choice, '句型選項', 80));
      const normalized = choices.map(answerKey);
      if (new Set(normalized).size !== choices.length || normalized.filter(choice => choice === answerKey(answer)).length !== 1) invalid('句型選項必須恰有一個正確答案，且不可重複。');
      output.choices = choices;
    }
    const explanation = optional(entry.explanation, '句型解說', 200);
    if (explanation !== undefined) output.explanation = explanation;
    return output;
  });
  return { words, patterns };
}

function parseGamePack(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_PACK_BYTES) invalid('資料不可超過 50 KB。');
  const start = text.indexOf(PACK_START), end = text.indexOf(PACK_END);
  if (start < 0 || end < start + PACK_START.length || text.indexOf(PACK_START, start + PACK_START.length) !== -1 || text.indexOf(PACK_END, end + PACK_END.length) !== -1) invalid('找不到完整且唯一的遊戲資料區塊。');
  let source = text.slice(start + PACK_START.length, end).trim();
  if (/^```(?:json)?\s/i.test(source) && /\s```$/.test(source)) source = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let input;
  try { input = JSON.parse(source); } catch { invalid('遊戲資料不是有效的 JSON。'); }
  return cleanPack(input);
}

function createGame(input, style = 'quest') {
  if (typeof style !== 'string' || !Object.hasOwn(STYLES, style)) throw new RangeError('Unknown learning game style');
  const pack = cleanPack(input);
  const tasks = [
    ...pack.words.map((entry, index) => ({ type: 'memory', entry, index })),
    ...pack.words.map((entry, index) => ({ type: 'spelling', entry, index })),
    ...pack.patterns.map((entry, index) => ({ type: 'sentence', entry, index }))
  ];
  let cursor = 0, completed = 0, stars = 0, food = 0, fed = 0, mastered = 0, assisted = 0;
  let attempts = 0, hintUsed = false, hintText = '', feedback = null, solved = false;
  const current = () => tasks[cursor];
  const correctAnswer = task => task.type === 'memory' ? task.entry.meaning : task.type === 'spelling' ? task.entry.word : task.entry.answer;
  const phase = () => current()?.type || 'complete';
  function taskView() {
    const task = current();
    if (!task) return null;
    const { entry, type, index } = task;
    const output = { id: `${type}-${index}`, type };
    if (type === 'memory') {
      const choices = [entry.meaning, ...pack.words.filter(word => word !== entry).map(word => word.meaning)].slice(0, 3);
      for (let i = 0; i < index % choices.length; i++) choices.push(choices.shift());
      Object.assign(output, { word: entry.word, prompt: '先聽發音跟讀，再選出這個單字的中文意思。', choices });
      if (entry.phonetic) output.phonetic = entry.phonetic;
    } else if (type === 'spelling') {
      Object.assign(output, { meaning: entry.meaning, prompt: '聽發音或看中文提示，拼出完整英文單字：' + entry.meaning });
      if (style === 'puzzle') {
        const original = key(entry.word), letters = [...original];
        for (let i = letters.length - 1; i > 0; i--) {
          const other = (i * 3 + index + 1) % (i + 1);
          [letters[i], letters[other]] = [letters[other], letters[i]];
        }
        if (letters.join('') === original) {
          const different = letters.findIndex(letter => letter !== letters[0]);
          if (different > 0) [letters[0], letters[different]] = [letters[different], letters[0]];
        }
        output.letters = letters;
      }
    } else {
      output.prompt = entry.prompt;
      if (entry.choices) output.choices = [...entry.choices];
    }
    return output;
  }
  function snapshot() {
    const stage = phase() === 'memory' ? 1 : phase() === 'spelling' ? 2 : 3;
    return {
      style, phase: phase(), stage, theme: { ...STYLES[style] }, task: taskView(),
      feedback: feedback ? { ...feedback } : null, attempts, hintUsed, hintText,
      canNext: solved, canFeed: style === 'pet' && food > 0,
      progress: { completed, total: tasks.length },
      rewards: { stars, food, fed, mastered, assisted },
      puzzle: { revealed: completed, total: tasks.length },
      pet: { fed, mood: fed ? 'happy' : 'ready', message: fed ? '夥伴收到點心，很開心能陪你練習。' : '夥伴準備好陪你學習，慢慢來也沒關係。' },
      quest: { level: stage, totalLevels: 3, levels: ['單字記憶', '英文拼字', '句型挑戰'].map((label, index) => ({
        label, status: phase() === 'complete' || index + 1 < stage ? 'complete' : index + 1 === stage ? 'current' : 'locked'
      })) }
    };
  }
  function answer(value) {
    const task = current();
    if (!task || solved) return snapshot();
    if (typeof value !== 'string' || value.length > 200 || !value.trim()) {
      feedback = { correct: false, message: '請先選擇或輸入一個答案。' }; return snapshot();
    }
    attempts++;
    if (answerKey(value) !== answerKey(correctAnswer(task))) {
      feedback = { correct: false, message: '再試一次；需要時可以看提示，不會扣掉已獲得的獎勵。' };
      return snapshot();
    }
    solved = true; completed++; food++;
    const independent = !hintUsed && attempts === 1;
    if (independent) { mastered++; stars++; } else assisted++;
    const reward = style === 'puzzle' ? '揭開了一塊拼圖！' : style === 'pet' ? '得到一份點心，可以餵給夥伴了！' : '完成這一步，繼續往下一關前進！';
    feedback = { correct: true, answer: correctAnswer(task), message: '答對了！' + reward };
    if (task.type === 'sentence' && task.entry.explanation) feedback.explanation = task.entry.explanation;
    if (task.type !== 'sentence' && task.entry.example) feedback.example = task.entry.example;
    return snapshot();
  }
  function hint() {
    const task = current();
    if (!task || solved || hintUsed) return snapshot();
    hintUsed = true;
    const expected = correctAnswer(task);
    if (task.type === 'memory') hintText = task.entry.hint || '回想這個字在圖片中的位置，再比較選項的意思。';
    else if (expected.length > 1) hintText = `開頭是「${expected[0]}」，答案共有 ${expected.replace(/[^A-Za-z]/g, '').length} 個字母。`;
    else hintText = '這個答案只有一個字母，可以再聽一次或回想句型。';
    return snapshot();
  }
  function next() {
    if (!solved || !current()) return snapshot();
    cursor++; attempts = 0; hintUsed = false; hintText = ''; feedback = null; solved = false;
    return snapshot();
  }
  function feed() {
    if (style === 'pet' && food > 0) { food--; fed++; }
    return snapshot();
  }
  function speechText() {
    const task = current();
    if (!task) return '';
    if (task.type !== 'sentence') return task.entry.word;
    return task.entry.prompt.replace(/_{2,}|\[blank\]|□/i, solved ? task.entry.answer : 'blank');
  }
  return Object.freeze({ snapshot, answer, hint, next, feed, speechText });
}

module.exports = { parseGamePack, createGame };
