(function () {
    'use strict';
    if (location.protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(location.hostname.toLowerCase()) ||
        (location.port && location.port !== '443')) return 'blocked';
    const key = '__miloConversationVisibleV1';
    if (window[key]) { window[key].update(); return 'installed'; }
    let frame = 0, stopped = false, state = null, footer = null;
    let following = true, touching = false, userIntentUntil = 0;
    const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : {observe: function () {}, disconnect: function () {}};
    function schedule() { if (!stopped && !frame && !document.hidden) frame = requestAnimationFrame(update); }
    function restore() {
        if (!state) return;
        if (state.original) state.node.style.setProperty('padding-bottom', state.original, state.priority);
        else state.node.style.removeProperty('padding-bottom');
        state = null;
    }
    function scrollContainer(message) {
        for (let node = message.parentElement; node && node !== document.body; node = node.parentElement)
            if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.clientHeight > 0) return node;
        return document.scrollingElement;
    }
    function update() {
        frame = 0; if (stopped) return;
        const messages = document.querySelectorAll('[data-message-author-role],[data-testid^="conversation-turn"]');
        const last = messages[messages.length - 1];
        const composer = document.querySelector('[data-milo-composer-root="1"]');
        const nextFooter = composer && (composer.closest('footer,#thread-bottom-container,[data-testid="composer-container"]') || composer);
        if (!last || !nextFooter || !nextFooter.getBoundingClientRect().height) { restore(); return; }
        const scroll = scrollContainer(last);
        if (!scroll) return;
        if (footer !== nextFooter || !state || state.node !== scroll) {
            resized.disconnect(); footer = nextFooter; resized.observe(footer); resized.observe(scroll);
        }
        if (!state || state.node !== scroll) {
            restore();
            state = {node: scroll, original: scroll.style.getPropertyValue('padding-bottom'),
                priority: scroll.style.getPropertyPriority('padding-bottom'), base: parseFloat(getComputedStyle(scroll).paddingBottom) || 0};
        }
        const viewportBottom = window.visualViewport ? window.visualViewport.height + window.visualViewport.offsetTop : innerHeight;
        const bottom = scroll === document.scrollingElement ? viewportBottom : Math.min(viewportBottom, scroll.getBoundingClientRect().bottom);
        const clearance = Math.max(0, bottom - footer.getBoundingClientRect().top) + 12;
        const padding = Math.ceil(Math.max(state.base, clearance)) + 'px';
        if (scroll.style.getPropertyValue('padding-bottom') !== padding) scroll.style.setProperty('padding-bottom', padding, 'important');
        const selection = window.getSelection();
        if (following && !touching && !(selection && !selection.isCollapsed)) {
            const end = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
            if (Math.abs(scroll.scrollTop - end) > 1) scroll.scrollTop = end;
        }
    }
    function userIntent() { userIntentUntil = performance.now() + 900; }
    function startTouch() { touching = true; userIntent(); }
    function endTouch() { touching = false; userIntent(); schedule(); }
    function scrolled(event) {
        if (!state || performance.now() > userIntentUntil) return;
        if (event.target !== state.node && event.target !== document && event.target !== window) return;
        following = state.node.scrollHeight - state.node.clientHeight - state.node.scrollTop < 96;
    }
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.documentElement, {childList: true, characterData: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'data-milo-composer-root']});
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('wheel', userIntent, {passive: true});
    window.addEventListener('touchstart', startTouch, {passive: true});
    window.addEventListener('touchend', endTouch, {passive: true});
    window.addEventListener('touchcancel', endTouch, {passive: true});
    window.addEventListener('resize', schedule);
    document.addEventListener('selectionchange', schedule);
    if (window.visualViewport) { visualViewport.addEventListener('resize', schedule); visualViewport.addEventListener('scroll', schedule); }
    window[key] = {update: schedule, stop: function () {
        stopped = true; mutations.disconnect(); resized.disconnect(); if (frame) cancelAnimationFrame(frame);
        window.removeEventListener('scroll', scrolled, true); window.removeEventListener('wheel', userIntent);
        window.removeEventListener('touchstart', startTouch); window.removeEventListener('touchend', endTouch); window.removeEventListener('touchcancel', endTouch);
        window.removeEventListener('resize', schedule); document.removeEventListener('selectionchange', schedule);
        if (window.visualViewport) { visualViewport.removeEventListener('resize', schedule); visualViewport.removeEventListener('scroll', schedule); }
        restore(); delete window[key];
    }};
    update(); return 'installed';
})();
