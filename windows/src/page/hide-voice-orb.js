(function () {
    'use strict';
    if (location.protocol !== 'https:' ||
        !['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(location.hostname.toLowerCase()) ||
        (location.port && location.port !== '443')) return 'blocked';

    const key = '__miloVoiceOrbFilterV1';
    if (window[key] && typeof window[key].scan === 'function') {
        window[key].scan();
        return 'installed';
    }
    const marker = 'data-milo-voice-orb-hidden';
    const style = document.createElement('style');
    style.id = 'milo-voice-orb-style';
    style.textContent = '[' + marker + '="1"]{visibility:hidden!important;pointer-events:none!important}';
    (document.head || document.documentElement).appendChild(style);
    const interactive = 'button,[role="button"],a,input,textarea,select,[contenteditable="true"]';
    const content = '[data-message-author-role],[data-testid^="conversation-turn"],article,.markdown,.prose';
    const captions = '[aria-live],[role="status"],[data-testid*="caption" i],[id*="caption" i],[class*="caption" i],[data-testid*="transcript" i],[id*="transcript" i],[class*="transcript" i]';
    const protectedContent = interactive + ',' + content + ',audio,video,' + captions;
    const named = '[data-testid*="voice-orb" i],[data-testid*="voice-visualizer" i],'
        + '[class*="voice-orb" i],[class*="voiceOrb" i],'
        + '[aria-label="Voice orb" i],[aria-label="Voice visualization" i],'
        + '[aria-label="語音球"],[aria-label="语音球"]';
    let frame = 0, timer = 0, stopped = false;
    const watched = new Set();
    const marked = new Set();
    const safe = node => !node.closest(protectedContent) && !node.querySelector(protectedContent);
    const endVoice = /(?:end|exit|close|stop)[\s_-]*(?:the[\s_-]*)?(?:voice|conversation)|(?:voice)[\s_-].*(?:end|exit|close|stop)|(?:結束|结束|停止|離開|离开).*(?:語音|语音|對話|对话)/i;
    const orbClass = /(?:^|[\s_-])(?:orb|voice[-_]?orb)(?:$|[\s_-])/i;
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;

    function schedule() {
        if (stopped || document.hidden || frame || timer) return;
        timer = setTimeout(() => { timer = 0; if (!stopped && !document.hidden) frame = requestAnimationFrame(scan); }, 80);
    }
    function scan() {
        frame = 0;
        if (timer) { clearTimeout(timer); timer = 0; }
        if (stopped) return;
        const targets = new Set();
        const activeVoice = Array.from(document.querySelectorAll('button,[role="button"]')).some(button => {
            if (button.closest(content)) return false;
            const label = [button.getAttribute('aria-label'), button.getAttribute('title'),
                button.getAttribute('data-testid'), button.textContent].filter(Boolean).join(' ');
            if (!endVoice.test(label)) return false;
            if (resize && !watched.has(button)) { watched.add(button); resize.observe(button); }
            return button.getClientRects().length;
        });
        function add(node) {
            if (safe(node)) targets.add(node);
        }
        document.querySelectorAll(named).forEach(node => {
            if (safe(node) && (node.matches('canvas,svg,img,video') || !node.textContent.trim())) add(node);
            else node.querySelectorAll('canvas,svg,img,video').forEach(add);
        });
        if (activeVoice) {
            document.querySelectorAll('[class*="orb" i],[data-testid*="orb" i]').forEach(node => {
                const label = (node.getAttribute('class') || '') + ' ' + (node.getAttribute('data-testid') || '');
                if (orbClass.test(label) && !node.textContent.trim()) add(node);
            });
            document.querySelectorAll('canvas,video').forEach(node => {
                if (node.tagName === 'VIDEO' && !(node.muted && node.loop && node.playsInline && !node.srcObject)) return;
                if (!safe(node)) return;
                if (resize && !watched.has(node)) { watched.add(node); resize.observe(node); }
                const rect = node.getBoundingClientRect();
                const ratio = rect.width / rect.height;
                if (rect.width >= 64 && rect.height >= 64 && rect.width <= 600 && rect.height <= 600
                    && ratio >= 0.65 && ratio <= 1.5) add(node);
            });
        }
        for (const node of marked) {
            if (!targets.has(node)) { node.removeAttribute(marker); marked.delete(node); }
        }
        for (const node of targets) {
            if (!marked.has(node)) { node.setAttribute(marker, '1'); marked.add(node); }
        }
        for (const node of watched) {
            if (!node.isConnected) { resize.unobserve(node); watched.delete(node); }
        }
    }
    const observer = new MutationObserver(records => {
        // Streaming conversation text does not require another graphics scan.
        if (records.some(record => {
            const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
            if (!target || target.closest(content)) return false;
            if (record.type !== 'attributes' && target.closest(captions) &&
                ![...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 &&
                    (node.matches('button,[role="button"],audio,video,canvas,svg,img') || node.querySelector('button,[role="button"],audio,video,canvas,svg,img')))) return false;
            return true;
        })) schedule();
    });
    observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'aria-label', 'title', 'data-testid', 'hidden']});
    window.addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', schedule);
    window[key] = {scan, stop: function () {
        stopped = true;
        observer.disconnect();
        if (resize) resize.disconnect();
        if (frame) cancelAnimationFrame(frame);
        if (timer) clearTimeout(timer);
        window.removeEventListener('resize', schedule);
        document.removeEventListener('visibilitychange', schedule);
        for (const node of marked) node.removeAttribute(marker);
        marked.clear(); watched.clear(); style.remove(); delete window[key];
    }};
    scan();
    return 'installed';
})();
