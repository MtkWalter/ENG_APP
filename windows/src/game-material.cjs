'use strict';

const { validateGamePack } = require('./learning-game.cjs');
const topic = (id, title, words, patterns) => ({ id, title, pack: { words: words.map(([word, meaning, example]) => ({ word, meaning, example })), patterns } });
const pattern = (prompt, answer, choices, explanation) => ({ prompt, answer, choices, explanation });
const TOPICS = [
  topic('breakfast', '早餐店任務', [
    ['hungry', '肚子餓的', "I'm hungry."], ['breakfast', '早餐', 'We have breakfast at seven.'],
    ['sandwich', '三明治', 'I want a sandwich.'], ['hamburger', '漢堡', 'The hamburger is hot.'],
    ['juice', '果汁', 'I like orange juice.'], ['soup', '湯', 'The soup smells good.']
  ], [pattern('I ____ hungry.', 'am', ['am', 'is', 'are'], '主詞 I 搭配 am。'),
    pattern('She ____ a sandwich.', 'wants', ['want', 'wants', 'wanting'], '一般現在式的第三人稱單數，動詞加 s。'),
    pattern('We ____ breakfast at seven.', 'have', ['has', 'have', 'having'], '主詞 we 搭配原形動詞 have。')]),
  topic('park', '公園尋寶', [
    ['garden', '花園', 'This is a beautiful garden.'], ['flower', '花朵', 'The flower is yellow.'],
    ['bench', '長椅', 'We sit on the bench.'], ['butterfly', '蝴蝶', 'A butterfly flies above the flowers.'],
    ['bicycle', '腳踏車', 'My bicycle is blue.'], ['tree', '樹', 'The tree is tall.']
  ], [pattern('The flower ____ yellow.', 'is', ['is', 'am', 'are'], '單數主詞 the flower 搭配 is。'),
    pattern('There ____ two trees.', 'are', ['is', 'are', 'am'], 'There are 後面接複數名詞。'),
    pattern('A butterfly ____ above the flowers.', 'flies', ['fly', 'flying', 'flies'], '單數主詞搭配第三人稱單數動詞 flies。')]),
  topic('classroom', '教室尋寶', [
    ['pencil', '鉛筆', 'This is my pencil.'], ['notebook', '筆記本', 'My notebook is on the desk.'],
    ['teacher', '老師', 'Our teacher is kind.'], ['window', '窗戶', 'Please open the window.'],
    ['library', '圖書館', 'We read in the library.'], ['eraser', '橡皮擦', 'I have an eraser.']
  ], [pattern('This ____ my pencil.', 'is', ['am', 'are', 'is'], 'This 是單數，搭配 is。'),
    pattern('I have ____ eraser.', 'an', ['an', 'a', 'two'], 'eraser 的開頭發母音，單數前面用 an。'),
    pattern('Our teacher ____ kind.', 'is', ['are', 'is', 'am'], '單數主詞 our teacher 搭配 is。')]),
  topic('animals', '動物好朋友', [
    ['rabbit', '兔子', 'The rabbit has long ears.'], ['puppy', '小狗', 'The puppy is happy.'],
    ['kitten', '小貓', 'The kitten is sleeping.'], ['elephant', '大象', 'An elephant has a long trunk.'],
    ['turtle', '烏龜', 'The turtle walks slowly.'], ['dolphin', '海豚', 'A dolphin can swim.']
  ], [pattern('The rabbit ____ long ears.', 'has', ['have', 'has', 'having'], '第三人稱單數主詞搭配 has。'),
    pattern('A dolphin can ____.', 'swim', ['swim', 'swims', 'swimming'], '助動詞 can 後面接原形動詞。'),
    pattern('The kittens ____ sleeping.', 'are', ['am', 'is', 'are'], 'kittens 是複數，搭配 are。')]),
  topic('travel', '旅行小探險', [
    ['ticket', '票券', 'I need a train ticket.'], ['station', '車站', 'The station is near the park.'],
    ['suitcase', '行李箱', 'My suitcase is heavy.'], ['airport', '機場', 'We are at the airport.'],
    ['umbrella', '雨傘', 'Take an umbrella with you.'], ['passport', '護照', 'This is my passport.']
  ], [pattern('We ____ at the airport.', 'are', ['am', 'is', 'are'], '主詞 we 搭配 are。'),
    pattern('My suitcase ____ heavy.', 'is', ['is', 'am', 'are'], 'suitcase 是單數，搭配 is。'),
    pattern('Take ____ umbrella with you.', 'an', ['a', 'an', 'two'], 'umbrella 開頭發母音，單數前面用 an。')])
];
const GAME_TOPICS = Object.freeze(TOPICS.map(({ id, title }) => Object.freeze({ id, title })));
function builtinMaterial(id = 'breakfast') {
  const found = TOPICS.find(item => item.id === id);
  if (!found) throw new RangeError('請選擇有效的內建主題。');
  return { pack: validateGamePack(found.pack), material: { source: 'builtin', id, title: found.title, local: true } };
}

const STOP = new Set(('the a an and or but this that these those i you he she it we they me my your his her our their ' +
  'am is are was were be been being do does did done have has had having can could will would should may might ' +
  'to of for from with at in on by as if so than then there here what who where when why how which ' +
  'yes no not let lets please look see say says said want wants like likes about also very more some any all one two').split(' '));
function lessonText(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 12000) throw new Error('請輸入 12,000 字元以內的英文教材。');
  if (/[<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|(?:https?|file|javascript|data):|www\./i.test(value)) throw new Error('教材請使用純英文文字，不放網址或 HTML。');
  return value.normalize('NFC').replaceAll('’', "'").replace(/\r\n?/g, '\n').trim();
}
function dictionaryMeaning(entry) {
  if (!entry?.chinese) return '';
  return entry.chinese.split(/[\n;；]/)[0].replace(/\([^)]*[A-Za-z][^)]*\)/g, '')
    .replace(/[A-Za-z]+\.?/g, '').replace(/^[\s.,，、/()\[\]:：]+|[\s.,，、/()\[\]:：]+$/g, '').slice(0, 75);
}
function materialFromText(value, dictionary, source = 'text') {
  const text = lessonText(value);
  const names = new Set();
  const body = text.replace(/^\s*([A-Za-z]+(?:\s+(?:and\s+)?[A-Za-z]+){0,3}):\s*/gm, (_all, name) => {
    name.toLowerCase().split(/\s+/).forEach(part => names.add(part)); return '';
  });
  const sentences = body.split(/(?<=[.!?])\s+|\n+/).map(line => line.trim()).filter(line => line.length <= 190 && /\b(?:am|is|are|was|were|have|has|had|want|wants|can|could|will|would|like|likes|go|goes|see|sees|read|reads|eat|eats|play|plays|drink|drinks|need|needs|look|looks|live|lives|love|loves)\b/i.test(line));
  const seen = new Set(), meanings = new Set(), candidates = [];
  for (const token of body.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []) {
    const word = token.toLowerCase();
    if (word.length < 3 || word.length > 30 || STOP.has(word) || names.has(word) || seen.has(word)) continue;
    seen.add(word);
    const entry = dictionary.lookup(word), meaning = dictionaryMeaning(entry);
    if (!/[\u4e00-\u9fff]/.test(meaning) || meanings.has(meaning) || /[<>]|\.[a-z]{2,}/i.test(meaning)) continue;
    const sentence = sentences.find(line => new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(line));
    const item = { word, meaning, hint: '回想教材中的用法；需要時可以先聽一次發音。' };
    if (entry.kk) item.phonetic = entry.kk.slice(0, 80);
    if (sentence) item.example = sentence;
    meanings.add(meaning); candidates.push(item);
  }
  // Longer content words are usually more useful than function words. Sorting
  // at most the bounded source text is done once, never during gameplay.
  const words = candidates.sort((a, b) => b.word.length - a.word.length).slice(0, 6);
  if (words.length < 3) throw new Error('尚未找到 3 個有中文釋義的英文單字。請修正辨識文字、補上英文，或先玩內建主題。');
  const patterns = [], prompts = new Set();
  const add = entry => {
    if (prompts.has(entry.prompt) || patterns.length >= 4) return;
    try { validateGamePack({ words, patterns: [entry, pattern('We ____ ready.', 'are', ['am', 'is', 'are'], '主詞 we 搭配 are。')] }); }
    catch { return; }
    prompts.add(entry.prompt); patterns.push(entry);
  };
  for (const sentence of sentences) {
    const found = sentence.match(/\b(am|is|are)\b/i);
    if (found) {
      const answer = found[0].toLowerCase();
      add(pattern(sentence.slice(0, found.index) + '____' + sentence.slice(found.index + found[0].length), answer,
        ['am', 'is', 'are'], ({ am: '主詞 I 搭配 am。', is: '第三人稱單數使用 is。', are: 'you、we、they 及複數主詞使用 are。' })[answer]));
    }
  }
  for (const entry of words) {
    if (!entry.example || entry.example.split(/\s+/).length < 3) continue;
    const expression = new RegExp('\\b' + entry.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    const choices = [entry.word, ...words.filter(item => item !== entry).map(item => item.word)].slice(0, 3);
    const offset = patterns.length % choices.length; choices.push(...choices.splice(0, offset));
    add(pattern('依教材原句，填入「' + entry.meaning + '」：' + entry.example.replace(expression, '____'), entry.word, choices, '把單字放回教材原句，連同前後文一起記憶。'));
  }
  const fromText = patterns.length;
  if (patterns.length < 2) patterns.push(pattern('I ____ ready.', 'am', ['am', 'is', 'are'], '內建基礎句型：主詞 I 搭配 am。'));
  if (patterns.length < 2) patterns.push(pattern('They ____ learning English.', 'are', ['am', 'is', 'are'], '內建基礎句型：主詞 they 搭配 are。'));
  return { pack: validateGamePack({ words, patterns }), material: { source, title: source === 'image' ? '我的圖片教材' : '我的英文教材', local: true,
    wordCount: words.length, sourcePatterns: fromText, foundationPatterns: patterns.length - fromText } };
}

module.exports = { GAME_TOPICS, builtinMaterial, materialFromText, lessonText };
