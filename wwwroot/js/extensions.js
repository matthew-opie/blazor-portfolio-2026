window.markdownEditor = {
    init: (el, value) => {
        if (el) { el.value = value; el.focus(); }
    },
    insertAtCursor: (el, before, after) => {
        if (!el) return '';
        const start = el.selectionStart;
        const end   = el.selectionEnd;
        const sel   = el.value.substring(start, end);
        const ins   = before + sel + (after || '');
        el.value    = el.value.substring(0, start) + ins + el.value.substring(end);
        const cursor = start + before.length + (after ? sel.length : 0);
        el.setSelectionRange(cursor, cursor);
        el.focus();
        return el.value;
    }
};

window.typingTest = {
    init: (el) => {
        if (el) { el.value = ''; el.focus(); }
    },
    focus: (el) => {
        if (el) el.focus();
    },
    clearInput: (el) => {
        if (el) { el.value = ''; el.focus(); }
    },
    setInputValue: (el, val) => {
        if (!el) return;
        el.value = val;
        el.setSelectionRange(val.length, val.length);
        el.focus();
    },
    scrollToWord: (container, wordId) => {
        const word = document.getElementById(wordId);
        if (!container || !word) return;
        const cRect = container.getBoundingClientRect();
        const wRect = word.getBoundingClientRect();
        const relTop = wRect.top - cRect.top + container.scrollTop;
        const lineH  = word.offsetHeight || 32;
        container.scrollTop = Math.max(0, relTop - lineH - 2);
    }
};

window.notifications = {
    isSupported: () => 'Notification' in window,
    getPermission: () => Notification.permission,
    requestPermission: async () => await Notification.requestPermission(),
    show: (title, body, icon) => {
        if (Notification.permission === 'granted') {
            new Notification(title, { body, icon });
        }
        if (navigator.vibrate) {
            navigator.vibrate([100, 200, 100]);
        }
    }
};