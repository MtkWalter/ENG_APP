(function (xFraction, yFraction) {
    'use strict';
    if (location.protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(location.hostname.toLowerCase()) ||
        (location.port && location.port !== '443')) return {status: 'blocked'};
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return {status: 'selection'};
    const x = xFraction * innerWidth, y = yFraction * innerHeight;
    const message = '[data-message-author-role],[data-testid^="conversation-turn"],article,.markdown,.prose';
    const interactive = 'a,button,input,textarea,select,[role="button"],[contenteditable="true"],iframe,nav,header,footer';
    const target = document.elementFromPoint(x, y);
    if (!target || target.closest(interactive) || !target.closest(message)) return {status: 'blocked'};
    let node, offset;
    if (document.caretRangeFromPoint) {
        const caret = document.caretRangeFromPoint(x, y);
        if (!caret) return {status: 'empty'};
        node = caret.startContainer; offset = caret.startOffset;
    } else if (document.caretPositionFromPoint) {
        const caret = document.caretPositionFromPoint(x, y);
        if (!caret) return {status: 'empty'};
        node = caret.offsetNode; offset = caret.offset;
    }
    if (!node || node.nodeType !== Node.TEXT_NODE || node.parentElement.closest(interactive) || !node.parentElement.closest(message)) return {status: 'empty'};
    const paragraph = node.parentElement.closest('p,li,td,blockquote,h1,h2,h3,h4') || node.parentElement;
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const parts = []; let text = '', position = -1, current;
    while ((current = walker.nextNode())) {
        if (current === node) position = text.length + offset;
        parts.push({node: current, start: text.length}); text += current.nodeValue;
        if (text.length > 20000) return {status: 'empty'};
    }
    if (position < 0) return {status: 'empty'};
    const words = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+(?:['’][A-Za-z]+)*)*/g;
    let word;
    while ((word = words.exec(text))) {
        const begin = word.index, end = begin + word[0].length;
        if (position < begin || position > end || word[0].length > 80) continue;
        const first = parts.find(part => begin >= part.start && begin < part.start + part.node.length);
        const last = parts.find(part => end > part.start && end <= part.start + part.node.length);
        if (!first || !last) continue;
        const range = document.createRange();
        range.setStart(first.node, begin - first.start); range.setEnd(last.node, end - last.start);
        if (Array.from(range.getClientRects()).some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom))
            return {status: 'ok', text: word[0]};
    }
    return {status: 'empty'};
})
