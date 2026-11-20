(function () {
  'use strict';
  if (location.protocol !== 'https:' || !['chatgpt.com','www.chatgpt.com','chat.openai.com'].includes(location.hostname) || (location.port && location.port !== '443')) return 'blocked';
  const key = '__miloConversationVisibleV1';
  if (window[key]) { window[key].update(); return 'installed'; }
  const message = '[data-message-author-role],[data-testid^="conversation-turn"]';
  const structure = message + ',[data-milo-composer-root="1"],footer,#thread-bottom-container,[data-testid="composer-container"]';
  let frame = 0, stopped = false, structureDirty = true, layoutDirty = true;
  let state = null, footer = null, last = null, contentBox = null;
  let following = true, holding = false, intentUntil = 0, previousURL = location.href;
  const selectionActive = () => { const selected = getSelection(); return selected && !selected.isCollapsed; };
  function schedule() { if (!stopped && !frame && !document.hidden) frame = requestAnimationFrame(update); }
  function layout() { layoutDirty = true; schedule(); }
  const resized = new ResizeObserver(entries => {
    if (entries.some(entry => entry.target === footer || entry.target === state?.node)) layoutDirty = true;
    if (layoutDirty || following) schedule();
  });
  function restore() {
    if (!state) return;
    if (state.original) state.node.style.setProperty('padding-bottom', state.original, state.priority);
    else state.node.style.removeProperty('padding-bottom');
    state = null;
  }
  function scrollContainer(node) {
    for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement)
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.clientHeight > 0) return parent;
    return document.scrollingElement;
  }
  function resolve() {
    structureDirty = false;
    const messages = document.querySelectorAll(message);
    const nextLast = messages[messages.length - 1];
    const composer = document.querySelector('[data-milo-composer-root="1"]');
    const nextFooter = composer && (composer.closest('footer,#thread-bottom-container,[data-testid="composer-container"]') || composer);
    if (!nextLast || !nextFooter) { resized.disconnect(); restore(); last = null; footer = null; return; }
    const scroll = scrollContainer(nextLast);
    if (!scroll) return;
    if (!state || state.node !== scroll) {
      restore(); following = true;
      state = { node: scroll, original: scroll.style.getPropertyValue('padding-bottom'), priority: scroll.style.getPropertyPriority('padding-bottom'), base: parseFloat(getComputedStyle(scroll).paddingBottom) || 0 };
    }
    if (location.href !== previousURL) { previousURL = location.href; following = true; }
    let nextBox = nextLast;
    while (nextBox.parentElement && nextBox !== scroll && getComputedStyle(nextBox).display === 'contents') nextBox = nextBox.parentElement;
    if (footer !== nextFooter || last !== nextLast || contentBox !== nextBox) {
      resized.disconnect(); footer = nextFooter; last = nextLast; contentBox = nextBox;
      for (const node of new Set([footer, scroll, contentBox])) resized.observe(node);
    }
    layoutDirty = true;
  }
  function update() {
    frame = 0; if (stopped) return;
    if (structureDirty) resolve();
    if (!state || !footer?.isConnected || !last?.isConnected) return;
    const scroll = state.node;
    if (layoutDirty) {
      layoutDirty = false;
      const rect = footer.getBoundingClientRect();
      if (!rect.height) return;
      const viewport = window.visualViewport ? visualViewport.height + visualViewport.offsetTop : innerHeight;
      const bottom = scroll === document.scrollingElement ? viewport : Math.min(viewport, scroll.getBoundingClientRect().bottom);
      const padding = Math.ceil(Math.max(state.base, Math.max(0, bottom - rect.top) + 12)) + 'px';
      if (scroll.style.getPropertyValue('padding-bottom') !== padding) scroll.style.setProperty('padding-bottom', padding, 'important');
    }
    if (following && !holding && !selectionActive()) {
      const end = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
      // A site's smooth-scroll CSS would restart an animation on every streamed
      // line. Only our automatic follow is instant; retain the site's own style.
      if (Math.abs(scroll.scrollTop - end) > 1) scroll.scrollTo({ top: end, behavior: 'instant' });
    }
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target;
      if (record.type === 'attributes') {
        if (record.attributeName === 'class') {
          if (target === state?.node || target.matches('main')) structureDirty = true;
        } else if (record.attributeName === 'data-milo-composer-root' || record.attributeName === 'data-message-author-role' || target.matches(message)) structureDirty = true;
      } else if (!target.closest?.('[data-message-author-role]') &&
          [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 &&
            (node.matches(structure) || node.querySelector(structure)))) {
        // React may mount an empty turn first and add the actual reply later.
        // Once inside an author-role element, ResizeObserver handles streaming.
        structureDirty = true;
      }
    }
    if ((last && !last.isConnected) || (footer && !footer.isConnected)) structureDirty = true;
    if (structureDirty) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-milo-composer-root','data-message-author-role','data-testid','id','class'] });
  function intent() { intentUntil = performance.now() + 1200; }
  function wheel(event) { intent(); if (event.deltaY < 0) following = false; }
  function down() { holding = true; intent(); }
  function up() { holding = false; intent(); if (state) following = state.node.scrollHeight - state.node.clientHeight - state.node.scrollTop < 8; schedule(); }
  function keyboard(event) {
    if (event.target.closest?.('input,textarea,[contenteditable="true"]')) return;
    if (['PageUp','PageDown','Home','End','ArrowUp','ArrowDown',' '].includes(event.key)) {
      intent(); if (['PageUp','Home','ArrowUp'].includes(event.key)) following = false;
    }
  }
  function scrolled(event) {
    if (!state || performance.now() > intentUntil || ![state.node, document, window].includes(event.target)) return;
    following = state.node.scrollHeight - state.node.clientHeight - state.node.scrollTop < 8;
    if (following) schedule();
  }
  window.addEventListener('scroll', scrolled, true);
  window.addEventListener('wheel', wheel, { passive: true, capture: true });
  window.addEventListener('pointerdown', down, { passive: true, capture: true });
  window.addEventListener('pointerup', up, { passive: true, capture: true });
  window.addEventListener('pointercancel', up, { passive: true, capture: true });
  window.addEventListener('keydown', keyboard, true);
  window.addEventListener('resize', layout);
  document.addEventListener('selectionchange', schedule);
  document.addEventListener('visibilitychange', layout);
  if (window.visualViewport) { visualViewport.addEventListener('resize', layout); visualViewport.addEventListener('scroll', layout); }
  window[key] = { update: () => { structureDirty = true; schedule(); }, stop() {
    stopped = true; observer.disconnect(); resized.disconnect(); if (frame) cancelAnimationFrame(frame);
    window.removeEventListener('scroll', scrolled, true); window.removeEventListener('wheel', wheel, true);
    window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
    window.removeEventListener('keydown', keyboard, true); window.removeEventListener('resize', layout);
    document.removeEventListener('selectionchange', schedule); document.removeEventListener('visibilitychange', layout);
    if (window.visualViewport) { visualViewport.removeEventListener('resize', layout); visualViewport.removeEventListener('scroll', layout); }
    restore(); delete window[key];
  } };
  update(); return 'installed';
})();
