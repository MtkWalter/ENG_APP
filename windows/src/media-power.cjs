'use strict';
const { isChatURL } = require('./policy.cjs');

// This request keeps media processing available when the window is minimized.
// It is independent of the visible-window display-sleep request in main.cjs.
function attachMediaPower(contents, powerSaveBlocker) {
  let blocker = null, closed = false, mediaPlaying = false, audible = false;
  function release() {
    if (blocker == null) return;
    const current = blocker; blocker = null;
    powerSaveBlocker.stop(current);
  }
  function update() {
    if (closed || contents.isDestroyed() || !isChatURL(contents.getURL()) || !(mediaPlaying || audible)) { release(); return; }
    if (blocker == null) blocker = powerSaveBlocker.start('prevent-app-suspension');
  }
  function playing() { mediaPlaying = true; update(); }
  function paused() { mediaPlaying = false; update(); }
  // Chromium's WebRTC srcObject/Web Audio path can emit audible-state changes
  // without media-started-playing. Observe its native signal, without wrapping
  // the site's player, microphone tracks, AudioContext or RTCPeerConnection.
  function audioChanged(event) { audible = event.audible === true; update(); }
  function reset() { mediaPlaying = false; audible = false; release(); }
  function navigating(event, _url, inPlace, isMainFrame) {
    const mainFrame = typeof event?.isMainFrame === 'boolean' ? event.isMainFrame : isMainFrame;
    const sameDocument = typeof event?.isSameDocument === 'boolean' ? event.isSameDocument : inPlace;
    if (mainFrame && !sameDocument) reset();
  }
  function cleanup() {
    if (closed) return;
    closed = true;
    contents.removeListener('media-started-playing', playing);
    contents.removeListener('media-paused', paused);
    contents.removeListener('audio-state-changed', audioChanged);
    contents.removeListener('did-start-navigation', navigating);
    contents.removeListener('render-process-gone', reset);
    contents.removeListener('destroyed', cleanup);
    reset();
  }
  contents.on('media-started-playing', playing);
  contents.on('media-paused', paused);
  contents.on('audio-state-changed', audioChanged);
  contents.on('did-start-navigation', navigating);
  contents.on('render-process-gone', reset);
  contents.on('destroyed', cleanup);
  return cleanup;
}
module.exports = { attachMediaPower };
