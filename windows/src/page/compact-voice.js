(function () {
    'use strict';
    if (location.protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(location.hostname.toLowerCase()) ||
        (location.port && location.port !== '443')) return 'blocked';
    const key = '__miloCompactComposerV1';
    if (window[key]) { window[key].scan(); return 'installed'; }
    const style = document.createElement('style');
    style.id = 'milo-compact-composer-style';
    style.textContent = '[data-milo-composer-hidden="1"]{display:none!important}'
        + '[data-milo-composer-path="1"]{display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:flex-end!important;'
        + 'height:auto!important;min-height:0!important;max-height:none!important;width:auto!important;flex:0 0 auto!important;padding:0!important;margin:0!important;gap:8px!important;'
        + 'background:transparent!important;box-shadow:none!important;border-width:0!important;overflow:visible!important}'
        + '[data-milo-composer-root="1"]{min-height:52px!important;width:100%!important}'
        + '[data-milo-composer-editor="1"]{position:absolute!important;width:1px!important;height:1px!important;min-height:0!important;max-height:1px!important;opacity:0!important;pointer-events:none!important;overflow:hidden!important;clip-path:inset(50%)!important}';
    (document.head || document.documentElement).appendChild(style);
    const message = '[data-message-author-role],[data-testid^="conversation-turn"],article,.markdown,.prose';
    const audio = /dictat|microphone|voice|speech|\b(?:speak(?:ing)?|pause|resume|play(?:back)?)\b|read[\s_-]*aloud|(?:^|[\s_-])(?:mute|unmute)(?:$|[\s_-])|麥克風|麦克风|語音|语音|聽寫|听写|靜音|静音|朗讀|朗读|暫停|暂停|繼續|继续|播放/i;
    const options = /model|setting|select|menu|option|模型|設定|设置|選擇|选择|選單|菜单/i;
    const special = /^(?:send-button|stop-button|composer-submit-button)$/;
    const composer = '[data-type="unified-composer"],[data-testid="composer"],[data-testid="composer-container"],#composer-background';
    const modelControls = '[data-testid*="model-switcher"],[data-testid="composer-model-selector"],'
        + 'button[aria-label*="model" i],button[aria-label*="模型"],[role="combobox"][aria-label*="model" i],[role="combobox"][aria-label*="模型"]';
    const disclaimer = /^ChatGPT\s*(?:可能會出錯|可能会出错|can make mistakes|可能也會出錯)/i;
    const captions = '[aria-live],[role="status"],[data-testid*="caption" i],[id*="caption" i],[class*="caption" i],[data-testid*="transcript" i],[id*="transcript" i],[class*="transcript" i]';
    const media = 'audio,video,' + captions;
    let frame = 0, timer = 0, stopped = false;
    let hidden = new Set(), paths = new Set(), roots = new Set(), editors = new Set();
    const inputModes = new Map();
    function applySet(previous, next, attribute) {
        for (const node of previous) if (!next.has(node)) node.removeAttribute(attribute);
        for (const node of next) if (!previous.has(node)) node.setAttribute(attribute, '1');
        return next;
    }
    function schedule() {
        if (stopped || frame || timer || document.hidden) return;
        timer = setTimeout(() => { timer = 0; if (!stopped && !document.hidden) frame = requestAnimationFrame(scan); }, 80);
    }
    function keepControl(button) {
        const id = button.getAttribute('data-testid') || '';
        const label = [id, button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent.trim()].filter(Boolean).join(' ');
        const transient = /^(?:stop|end|close|停止|結束|结束|關閉|关闭)$/i.test(button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent.trim());
        return !options.test(label) && (audio.test(label) || special.test(id) || transient);
    }
    function composerRoot(editor) {
        const form = editor.closest('form');
        if (form && !form.closest(message)) return form;
        const known = editor.closest(composer);
        if (known) return known;
        const previous = editor.closest('[data-milo-composer-root="1"]');
        if (previous && !previous.closest(message)) return previous;
        for (let node = editor.parentElement, i = 0; node && i < 8; node = node.parentElement, i++) {
            if (node === document.body || node === document.documentElement || node.closest(message) || node.querySelector(message)) break;
            if (Array.from(node.querySelectorAll('button,[role="button"]')).some(keepControl)) return node;
        }
        return null;
    }
    function scan() {
        frame = 0; if (timer) { clearTimeout(timer); timer = 0; } if (stopped) return;
        const nextHidden = new Set(), nextPaths = new Set(), nextRoots = new Set(), nextEditors = new Set();
        document.querySelectorAll('#prompt-textarea,[data-testid="prompt-textarea"],[data-type="unified-composer"] textarea').forEach(editor => {
            if (editor.closest(message)) return;
            const root = composerRoot(editor);
            if (!root || root === document.body || root === document.documentElement || root.closest(message)) return;
            const keep = [...Array.from(root.querySelectorAll('button,[role="button"]')).filter(keepControl), ...root.querySelectorAll(media)];
            nextRoots.add(root);nextEditors.add(editor);
            if(!inputModes.has(editor)){inputModes.set(editor,editor.getAttribute('inputmode'));
                if(editor===document.activeElement||editor.contains(document.activeElement))document.activeElement.blur();
                editor.setAttribute('inputmode','none');}
            for (const button of [...keep,editor]) {
                for (let node = button.parentElement; node && root.contains(node); node = node.parentElement) {
                    nextPaths.add(node); if (node === root) break;
                }
            }
            for (const node of nextPaths) {
                if (node !== root && !root.contains(node)) continue;
                for (const child of node.children) if (!nextPaths.has(child) && !keep.includes(child) && child !== editor) nextHidden.add(child);
            }
        });
        // A model switcher can also be rendered above the composer, outside its form.
        document.querySelectorAll(modelControls).forEach(node => {
            if (!node.closest(message) && !Array.from(nextEditors).some(editor => node.contains(editor))) nextHidden.add(node);
        });
        // Footer text can be checked locally without walking or copying the chat history.
        const regions = new Set(nextRoots);
        document.querySelectorAll('footer,#thread-bottom-container,[data-testid="composer-container"]').forEach(node => {
            if (!node.closest(message) && !node.querySelector(message)) regions.add(node);
        });
        for (const region of regions) region.querySelectorAll('small,div,span,p').forEach(node => {
            if (node.closest(message + ',' + captions) || node.querySelector('button,input,textarea,[contenteditable="true"]')) return;
            const text = node.textContent.trim();
            if (text.length < 200 && disclaimer.test(text)) nextHidden.add(node);
        });
        for(const editor of editors)if(!nextEditors.has(editor))restoreInput(editor);
        editors = applySet(editors,nextEditors,'data-milo-composer-editor');
        hidden = applySet(hidden, nextHidden, 'data-milo-composer-hidden');
        paths = applySet(paths, nextPaths, 'data-milo-composer-path');
        roots = applySet(roots, nextRoots, 'data-milo-composer-root');
    }
    function restoreInput(editor) {
        const original=inputModes.get(editor);
        if(editor.getAttribute('inputmode')==='none'){if(original===null)editor.removeAttribute('inputmode');else editor.setAttribute('inputmode',original);}
        inputModes.delete(editor);
    }
    const observer = new MutationObserver(records => {
        if (records.some(record => {
            const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
            if (!target || target.closest(message)) return false;
            // Caption words do not change composer controls. Keep their text
            // visible without scanning the bottom toolbar on every syllable.
            if (record.type !== 'attributes' && target.closest(captions) &&
                ![...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 &&
                    (node.matches('button,[role="button"],audio,video') || node.querySelector('button,[role="button"],audio,video')))) return false;
            if (record.type === 'characterData') return !!target.closest('button,[role="button"]');
            return true;
        })) schedule();
    });
    observer.observe(document.documentElement, {childList: true, characterData: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'aria-label', 'title', 'data-testid', 'data-type', 'id', 'role']});
    window.addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', schedule);
    window[key] = {scan, stop: function () {
        stopped = true; observer.disconnect(); if (frame) cancelAnimationFrame(frame); if (timer) clearTimeout(timer);
        window.removeEventListener('resize', schedule); document.removeEventListener('visibilitychange', schedule);
        for (const node of hidden) node.removeAttribute('data-milo-composer-hidden');
        for (const node of paths) node.removeAttribute('data-milo-composer-path');
        for (const node of roots) node.removeAttribute('data-milo-composer-root');
        for(const editor of editors){editor.removeAttribute('data-milo-composer-editor');restoreInput(editor);}
        editors.clear();hidden.clear(); paths.clear(); roots.clear(); style.remove(); delete window[key];
    }};
    scan(); return 'installed';
})();
