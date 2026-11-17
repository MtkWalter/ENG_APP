'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { normalizeSelection } = require('./policy.cjs');
const script = fs.readFileSync(path.join(__dirname, 'windows-speech.ps1'), 'utf8');

function validateWave(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return false;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4);
    if (buffer.toString('ascii', offset, offset + 4) === 'data') {
      return size > 100 && buffer.subarray(offset + 8, Math.min(buffer.length, offset + 8 + size)).some(value => value !== 0);
    }
    offset += 8 + size + (size % 2);
  }
  return false;
}
class NativeSpeech {
  constructor({ platform = process.platform, spawnProcess = spawn } = {}) {
    this.platform = platform; this.spawnProcess = spawnProcess; this.pending = null;
  }
  stop() {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null; clearTimeout(pending.timer);
    pending.child.kill(); pending.resolve(null);
  }
  render(value) {
    this.stop();
    const text = normalizeSelection(value);
    if (!text) return Promise.reject(new Error('請先選擇要朗讀的英文，最多 5,000 字元。'));
    if (this.platform !== 'win32') return Promise.reject(new Error('Windows 原生朗讀只在 Windows 版提供。'));
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return new Promise((resolve, reject) => {
      const child = this.spawnProcess(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const pending = { child, resolve, reject };
      this.pending = pending;
      let stdout = '', stderr = '';
      const fail = cause => {
        if (this.pending !== pending) return;
        this.pending = null; clearTimeout(pending.timer); child.kill();
        reject(new Error('Windows 朗讀無法啟動。請到「設定 → 時間與語言 → 語音」確認已安裝語音，再重試。', { cause }));
      };
      pending.timer = setTimeout(() => fail('Speech synthesis timed out'), 30000);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', data => { stdout += data; if (stdout.length > 24 * 1024 * 1024) fail('Speech output too large'); });
      child.stderr.on('data', data => { if (stderr.length < 2000) stderr += data; });
      child.on('error', error => fail(error.message));
      child.stdin.on('error', error => fail(error.message));
      child.on('close', code => {
        if (this.pending !== pending) return;
        if (code !== 0) { fail(stderr || 'Speech process failed'); return; }
        try {
          const response = JSON.parse(stdout.trim().replace(/^\uFEFF/, ''));
          const bytes = Buffer.from(response.audio || '', 'base64');
          if (!validateWave(bytes)) throw new Error('Windows returned an empty or invalid WAV');
          this.pending = null; clearTimeout(pending.timer);
          resolve({ audio: bytes.toString('base64'), voice: String(response.voice || 'Windows'), english: !!response.english });
        } catch (error) { fail(error.message); }
      });
      child.stdin.end(JSON.stringify({ text }), 'utf8');
    });
  }
}
module.exports = { NativeSpeech, validateWave };
