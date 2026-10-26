/**
 * V2 — Toast حقيقي خلف علم `?v2toast` (P0-3b)
 * ═══════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 *   v2.html does not load app.js, so `window.toast` falls through to the
 *   silent stub at session.js:106-107 (`console.info`). The user never sees
 *   a message that the code worked hard to produce. This module installs a
 *   real one. It replaces nothing: with the flag off it does not touch
 *   `window` at all, and the page behaves exactly as it did before.
 *
 * INSTALL ORDER IS A CORRECTNESS CONDITION, NOT A DETAIL
 *   session.js registers its silent fallback only
 *   `if (typeof window.toast !== 'function')`. Installing after
 *   ensureSession() therefore reverts to silence while looking finished.
 *   preview.js §2b calls installToast() before §5 (ensureSession) for
 *   exactly this reason — tests/v2-toast.test.js pins the order.
 *
 * NO innerHTML ANYWHERE IN THIS FILE
 *   Every string reaches the DOM through textContent, so injection is
 *   structurally impossible rather than conditional on remembering to
 *   escape. The lesson this answers is enhancedToast (ui/enhancement.js:351)
 *   building nodes with innerHTML.
 *
 * vm-friendly by contract: no DOM, no localStorage, no timers are touched
 * at import time — every dependency arrives through installToast(win, ...).
 */

const FLAG_TRUE = new Set(['1', 'true', 'on']);

const MAX_TEXT = 300;
const LEAVE_MS = 200;
const LIFE_NORMAL = 4000;
const LIFE_ERROR = 6000;
const CLOSE_LABEL = 'إخفاء التنبيه';

/** Cap of simultaneously visible toasts — the oldest is dropped first. */
export const MAX_VISIBLE = 4;

/** `ji` names only: icons.js owns the set, V2 never draws a glyph itself. */
const KINDS = {
    success: { icon: 'circle-check', role: 'status', live: 'polite', life: LIFE_NORMAL },
    info: { icon: 'info', role: 'status', live: 'polite', life: LIFE_NORMAL },
    warning: { icon: 'alert-triangle', role: 'status', live: 'polite', life: LIFE_NORMAL },
    error: { icon: 'circle-x', role: 'alert', live: 'assertive', life: LIFE_ERROR },
};

const DEFAULT_KIND = 'success';

/** Text-safe normaliser: coercion plus a length bound. Never HTML. */
export function esc(value) {
    const text = value == null ? '' : String(value);
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/** `?v2toast=1|0` beats the stored choice; both absent means OFF. */
export function toastEnabled(search, stored) {
    const match = String(search || '').match(/(?:^|[?&])v2toast=([^&]*)/);
    if (match) {return FLAG_TRUE.has(decodeURIComponent(match[1]).toLowerCase());}
    if (stored == null || stored === '') {return false;}
    return FLAG_TRUE.has(String(stored).toLowerCase());
}

/**
 * One notify for every screen: the in-screen line stays (it survives a
 * re-render in its own context and is where a long message is read), the
 * toast is an addition, never a replacement.
 *
 * Type is `info` on purpose: a notify line carries successes and failures
 * in one channel, and guessing from wording would raise the assertive
 * channel on a message nobody flagged as an error.
 */
export function notifyTo(note) {
    return (message) => {
        const text = esc(message);
        if (note) {note.textContent = text;}
        if (typeof window !== 'undefined' && typeof window.toast === 'function') {
            window.toast(text, 'info');
        }
        return text;
    };
}

/**
 * @param {any} win  the browser window (injected so the module stays testable)
 * @param {{enabled?: boolean}} [opts]
 * @returns {boolean} true only when a real toast was installed
 */
export function installToast(win, opts = {}) {
    if (!opts.enabled) {return false;}
    const doc = win && win.document;
    if (!doc || typeof doc.createElement !== 'function' || !doc.body) {return false;}
    if (win.__v2Toast) {return true;}

    let layer = null;
    const live = [];

    /* THE LAYER CARRIES `.erp-v2` ON PURPOSE.
       Every --erp-* token is declared on `.erp-v2` (erp-tokens.css:26) and
       the dark overrides on `[data-theme="dark"] .erp-v2`
       (erp-themes.css:26) — a portal mounted directly on <body> is outside
       that scope, so each var(--erp-*) would resolve to nothing and the
       toast would paint unstyled while every js test stayed green. Carrying
       the class inherits the token scope (and the box-sizing reset from
       erp-base.css:16) without touching any existing file. */
    function ensureLayer() {
        if (layer) {return layer;}
        layer = doc.createElement('div');
        layer.className = 'erp-v2 erp-toast-layer';
        doc.body.appendChild(layer);
        return layer;
    }

    function dismiss(item) {
        if (!item || item.__v2Leaving) {return;}
        item.__v2Leaving = true;
        win.clearTimeout(item.__v2Timer);
        const at = live.indexOf(item);
        if (at >= 0) {live.splice(at, 1);}
        item.className = `${item.className} erp-toast--leave`;
        win.setTimeout(() => {
            if (layer && item.parentNode) {layer.removeChild(item);}
        }, LEAVE_MS);
    }

    function show(message, type) {
        const meta = KINDS[type] || KINDS[DEFAULT_KIND];
        const host = ensureLayer();
        while (live.length >= MAX_VISIBLE) {dismiss(live[0]);}
        const item = doc.createElement('div');
        item.className = `erp-toast erp-toast--${KINDS[type] ? type : DEFAULT_KIND}`;
        item.setAttribute('role', meta.role);
        item.setAttribute('aria-live', meta.live);
        const icon = doc.createElement('i');
        icon.className = 'ji';
        icon.setAttribute('data-i', meta.icon);
        const text = doc.createElement('span');
        text.className = 'erp-toast__msg';
        text.textContent = esc(message);
        const close = doc.createElement('button');
        close.type = 'button';
        close.className = 'erp-toast__close';
        close.setAttribute('aria-label', CLOSE_LABEL);
        /* أيقونة المجموعة نفسها بدل نص «×»: الرمز الطباعي يختلف شكله ووزنه
           بين الخطوط، والأيقونة تُرسم عبر data-i كما في بقية الواجهة. */
        const closeIcon = doc.createElement('i');
        closeIcon.className = 'ji';
        closeIcon.setAttribute('data-i', 'x');
        closeIcon.setAttribute('aria-hidden', 'true');
        close.appendChild(closeIcon);
        item.addEventListener('click', () => dismiss(item));
        close.addEventListener('click', () => dismiss(item));
        item.appendChild(icon);
        item.appendChild(text);
        item.appendChild(close);
        host.appendChild(item);
        live.push(item);
        item.__v2Timer = win.setTimeout(() => dismiss(item), meta.life);
        return item;
    }

    function dismissAll() {
        while (live.length) {dismiss(live[0]);}
    }

    win.toast = show;
    win.__v2Toast = { show, dismiss, dismissAll, count: () => live.length, getLayer: () => layer };
    return true;
}
