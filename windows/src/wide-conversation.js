(function () {
  'use strict';
  if (location.protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(location.hostname) || (location.port && location.port !== '443')) return 'blocked';
  const key = '__miloWideConversationV1';
  if (window[key]) { window[key].scan(); return 'installed'; }
  const wide = new Set();
  const message = '[data-message-author-role],[data-testid^="conversation-turn"]';
  const style = document.createElement('style');
  style.textContent = '[data-milo-wide-text="1"]{max-width:none!important;width:100%!important}';
  (document.head || document.documentElement).appendChild(style);
  let frame = 0;
  function scan() {
    frame = 0;
    for (const node of wide) if (!node.isConnected) wide.delete(node);
    for (const node of document.querySelectorAll(message)) {
      for (let parent = node.parentElement; parent && parent.closest('main') && !parent.matches('main'); parent = parent.parentElement) {
        if (parent.matches('.mx-auto,[class*="thread-content-max-width"]')) {
          parent.setAttribute('data-milo-wide-text', '1'); wide.add(parent);
        }
      }
    }
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(scan); }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['id', 'aria-label', 'data-testid', 'class'] });
  window[key] = { scan, stop() {
    observer.disconnect(); if (frame) cancelAnimationFrame(frame);
    for (const node of wide) node.removeAttribute('data-milo-wide-text');
    style.remove(); delete window[key];
  } };
  scan(); return 'installed';
})();
