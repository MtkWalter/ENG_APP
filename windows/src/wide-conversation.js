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
  let frame = 0, stopped = false;
  const pending = new Set();
  function visit(node) {
    for (let parent = node.parentElement; parent && parent.closest('main') && !parent.matches('main'); parent = parent.parentElement) {
      if (parent.matches('.mx-auto,[class*="thread-content-max-width"]')) {
        if (parent.getAttribute('data-milo-wide-text') !== '1') parent.setAttribute('data-milo-wide-text', '1');
        wide.add(parent);
      }
    }
  }
  function discover(root) {
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.nodeType === 1 && root.matches(message)) visit(root);
    for (const node of root.querySelectorAll(message)) visit(node);
  }
  function scan() {
    frame = 0;
    for (const node of wide) if (!node.isConnected) wide.delete(node);
    for (const node of pending) if (node.isConnected) discover(node);
    pending.clear();
  }
  function schedule() { if (!stopped && !frame && !document.hidden) frame = requestAnimationFrame(scan); }
  const observer = new MutationObserver(records => {
    let prune = false;
    for (const record of records) {
      const target = record.target;
      if (record.type === 'attributes') {
        if (wide.has(target)) { if (target.getAttribute('data-milo-wide-text') !== '1') target.setAttribute('data-milo-wide-text', '1'); }
        else if (target.matches(message)) visit(target);
      } else if (!target.closest?.('[data-message-author-role]')) {
        // A turn can appear before its author-role content. Discover only these
        // new subtrees; additions within an existing reply are streaming text.
        for (const node of record.addedNodes) if (node.nodeType === 1) pending.add(node);
        if ([...record.removedNodes].some(node => node.nodeType === 1)) prune = true;
      }
    }
    if (pending.size || prune) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-message-author-role', 'data-testid', 'class'] });
  const refresh = () => { for (const node of wide) if (node.isConnected && node.getAttribute('data-milo-wide-text') !== '1') node.setAttribute('data-milo-wide-text', '1'); schedule(); };
  document.addEventListener('visibilitychange', schedule);
  window[key] = { scan: refresh, stop() {
    stopped = true;
    observer.disconnect(); if (frame) cancelAnimationFrame(frame);
    document.removeEventListener('visibilitychange', schedule);
    for (const node of wide) node.removeAttribute('data-milo-wide-text');
    style.remove(); delete window[key];
  } };
  discover(document); return 'installed';
})();
