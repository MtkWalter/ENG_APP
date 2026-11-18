'use strict';
const { isChatURL, audioPermission } = require('./policy.cjs');

function trustedFrame(contents, origin, details, owner) {
  if (!contents || contents !== owner || !isChatURL(contents.getURL()) || !isChatURL(origin)) return false;
  if (details.securityOrigin && !isChatURL(details.securityOrigin)) return false;
  const url = details.requestingUrl;
  if (!url || isChatURL(url)) return true;
  // Same-origin blank/blob frames inherit the browser-supplied security origin.
  if (url === 'about:blank') return isChatURL(origin);
  try { return new URL(url).protocol === 'blob:' && isChatURL(new URL(url).origin); }
  catch { return false; }
}
function createMediaPermissions({ getContents, settings, askAudio, save }) {
  let decision = null;
  return {
    check(contents, permission, origin, details = {}) {
      if (!trustedFrame(contents, origin, details, getContents())) return false;
      if (permission === 'speaker-selection') return true;
      // Chromium also checks generic media access while enumerating devices.
      // Actual capture still passes through the audio-only request handler below.
      return permission === 'media' && details.mediaType !== 'video' && settings.microphone !== 'deny';
    },
    async request(contents, permission, callback, details = {}) {
      const origin = details.securityOrigin || details.requestingUrl || contents?.getURL();
      if (!trustedFrame(contents, origin, details, getContents())) { callback(false); return; }
      if (permission === 'speaker-selection') { callback(true); return; }
      if (!audioPermission(permission, origin, details)) { callback(false); return; }
      try {
        if (settings.microphone === 'ask') {
          if (!decision) decision = Promise.resolve().then(askAudio).then(allowed => {
            settings.microphone = allowed ? 'allow' : 'deny'; save();
          }).finally(() => { decision = null; });
          await decision;
        }
        callback(settings.microphone === 'allow');
      } catch { callback(false); }
    }
  };
}
module.exports = { createMediaPermissions, trustedFrame };
