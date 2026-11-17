'use strict';

const fs = require('node:fs');
const path = require('node:path');
function sanitize(value = {}) {
  return {
    zoom: Number.isFinite(value.zoom) ? Math.min(2, Math.max(0.75, value.zoom)) : 1,
    focus: typeof value.focus === 'boolean' ? value.focus : true,
    microphone: ['ask', 'allow', 'deny'].includes(value.microphone) ? value.microphone : 'ask',
    width: Number.isFinite(value.width) ? Math.min(3840, Math.max(980, Math.round(value.width))) : 1320,
    height: Number.isFinite(value.height) ? Math.min(2160, Math.max(680, Math.round(value.height))) : 900
  };
}
function readSettings(directory) {
  try { return sanitize(JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'))); }
  catch { return sanitize(); }
}
function writeSettings(directory, settings) {
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, 'settings.json');
  fs.writeFileSync(target + '.tmp', JSON.stringify(sanitize(settings), null, 2));
  fs.renameSync(target + '.tmp', target);
}
module.exports = { sanitize, readSettings, writeSettings };
