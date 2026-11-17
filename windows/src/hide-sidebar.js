(function () {
  'use strict';
  if (location.protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(location.hostname) || (location.port && location.port !== '443')) return 'blocked';
  const key = '__miloSidebarV1';
  if (window[key]) { window[key].scan(); return 'installed'; }
  const hidden = new Set(), wide = new Set();
  const message = '[data-message-author-role],[data-testid^="conversation-turn"]';
  const sidebar = '#stage-sidebar,#stage-slideover-sidebar,#sidebar,[data-testid="sidebar"],[data-testid="history-sidebar"],[data-testid="sidebar-container"]';
  const toggles = '[data-testid="open-sidebar-button"],[data-testid="close-sidebar-button"],button[aria-label="Open sidebar" i],button[aria-label="Close sidebar" i],button[aria-label="Toggle sidebar" i],button[aria-label="開啟側邊欄"],button[aria-label="關閉側邊欄"],button[aria-label="打开边栏"],button[aria-label="关闭边栏"]';
  const style = document.createElement('style');
  style.textContent = '[data-milo-sidebar-hidden="1"]{display:none!important;width:0!important;min-width:0!important;max-width:0!important}' +
    'html[data-milo-sidebar-off="1"],html[data-milo-sidebar-off="1"] body{--sidebar-width:0px!important;--sidebar-width-mobile:0px!important;--sidebar-rail-width:0px!important}' +
    '[data-milo-wide-text="1"]{max-width:none!important;width:100%!important}';
  (document.head || document.documentElement).appendChild(style);
  document.documentElement.setAttribute('data-milo-sidebar-off', '1');
  let frame = 0;
  function mark(node) {
    if (node.closest(message) || node.matches('main') || node.querySelector('main,' + message)) return;
    node.setAttribute('data-milo-sidebar-hidden', '1'); hidden.add(node);
  }
  function scan() {
    frame = 0;
    document.querySelectorAll(sidebar + ',' + toggles).forEach(mark);
    for (const nav of document.querySelectorAll('nav[aria-label]')) {
      if (!/^(chat history|聊天紀錄|聊天记录|對話紀錄|对话记录|歷史紀錄)$/i.test(nav.getAttribute('aria-label'))) continue;
      let target = nav;
      if (document.querySelector('main')) for (let node = nav.parentElement, i = 0; node && i < 5; node = node.parentElement, i++) {
        if (node === document.body || node.querySelector('main,' + message)) break;
        const rect = node.getBoundingClientRect();
        if (rect.width > 400 || rect.left > 100) break;
        target = node;
      }
      mark(target);
    }
    for (const node of document.querySelectorAll(message)) {
      for (let parent = node.parentElement; parent && parent.closest('main') && !parent.matches('main'); parent = parent.parentElement) {
        if (parent.matches('.mx-auto,[class*="thread-content-max-width"]') && !parent.querySelector(sidebar)) {
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
    for (const node of hidden) node.removeAttribute('data-milo-sidebar-hidden');
    for (const node of wide) node.removeAttribute('data-milo-wide-text');
    document.documentElement.removeAttribute('data-milo-sidebar-off');
    style.remove(); delete window[key];
  } };
  scan(); return 'installed';
})();
