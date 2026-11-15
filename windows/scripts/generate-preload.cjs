'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const word = fs.readFileSync(path.join(root, 'assets/android/word_at_point.js'), 'utf8').trim();
const bridge = fs.readFileSync(path.join(root, 'src/chat-preload-base.cjs'), 'utf8');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build/chat-preload.cjs'), "'use strict';\n// Generated from the original Android word extractor and the isolated desktop bridge.\nconst wordAtPoint = " + word + ';\n' + bridge);
