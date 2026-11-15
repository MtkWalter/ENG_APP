'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const initSqlJs = require('sql.js');
const { isWord } = require('./policy.cjs');

async function loadDictionary(assetDirectory) {
  const bytes = fs.readFileSync(path.join(assetDirectory, 'study_dictionary.db'));
  const integrity = JSON.parse(fs.readFileSync(path.join(assetDirectory, 'integrity.json'), 'utf8'));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== integrity.sha256) {
    throw new Error('離線字典校驗失敗，請重新安裝 Milo。');
  }
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
  const database = new SQL.Database(bytes);
  const query = database.prepare('SELECT word, kk, chinese FROM entries WHERE word = ?');
  const metadata = Object.fromEntries(database.exec('SELECT name, value FROM metadata')[0].values);
  return {
    metadata,
    lookup(text) {
      if (!isWord(text)) return null;
      query.bind([text.toLowerCase().replaceAll('’', "'")]);
      const row = query.step() ? query.getAsObject() : null;
      query.reset();
      if (!row) return null;
      return { word: row.word, kk: row.kk,
        chinese: row.chinese.replace(/\\r\\n|\\[rn]|\r\n/g, '\n').trim() };
    },
    close() { query.free(); database.close(); }
  };
}
module.exports = { loadDictionary };
