'use strict';

const CHAT_HOSTS = new Set(['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com']);
const AUTH_HOSTS = new Set(['auth.openai.com', 'auth0.openai.com', 'accounts.google.com',
  'appleid.apple.com', 'account.apple.com', 'login.live.com', 'login.microsoftonline.com']);

function secureURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (!url.port || url.port === '443') ? url : null;
  } catch { return null; }
}
function isChatURL(value) { const url = secureURL(value); return !!url && CHAT_HOSTS.has(url.hostname); }
function isLoginURL(value) {
  const url = secureURL(value);
  return !!url && (CHAT_HOSTS.has(url.hostname) || AUTH_HOSTS.has(url.hostname));
}
function isExternalURL(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
function normalizeSelection(value) {
  if (typeof value !== 'string' || value.length > 5000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) return null;
  const text = value.trim();
  return text && /[A-Za-z]/.test(text) ? text : null;
}
function isWord(text) { return text.length <= 80 && /^[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+(?:['’][A-Za-z]+)*)*$/.test(text); }
function audioPermission(permission, origin, details = {}) {
  return permission === 'media' && isChatURL(origin) &&
    Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0 &&
    details.mediaTypes.every(type => type === 'audio');
}
module.exports = { isChatURL, isLoginURL, isExternalURL, normalizeSelection, isWord, audioPermission };
