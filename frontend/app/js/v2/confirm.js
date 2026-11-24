/**
 * V2 — Confirm Dialog · js/v2/confirm.js
 * ═══════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 *   Every V2 screen already receives `confirmFn` from the host, and the host
 *   answered with `window.confirm`. That native dialog is an OS window: it
 *   ignores the design system, blocks the whole renderer, cannot be
 *   translated, has no danger semantics, and on Android Chrome it is a
 *   full-screen interruption. The screen contract is already async —
 *   `await confirmFn(text)` — so the host can answer with a themed modal
 *   without touching a single screen.
 *
 * WHAT IS NOT CHANGED
 *   Screens keep their own fallback (`window.confirm`) for isolated mounts;
 *   this module only replaces the host's answer. With `?v2confirm=0` the
 *   host passes the old function through untouched — zero behaviour change.
 *
 * A11Y DECISIONS THAT ARE NOT COSMETIC
 *   • Native `<dialog>.showModal()` — top layer, inert background, Escape,
 *     and focus restoration to the invoking element are the platform's, not
 *     a re-implementation.
 *   • `role="alertdialog"` + `aria-labelledby` + `aria-describedby`.
 *   • Cancel is focused first: a misplaced Enter must never confirm a
 *     destructive action.
 *   • Escape, backdrop click and a second overlapping call resolve `false`
 *     — every ambiguous path fails closed.
 *   • Text reaches the DOM through `textContent` only (no innerHTML), so a
 *     message can never inject markup.
 */

const FLAG_FALSE = new Set(['0', 'false', 'off', 'no']);
const MAX_TEXT = 400;

/** كلماتٌ تُقرأ كإجراءٍ لا رجعة فيه — تُلوّن الزرّ لا تُغيّر سلوكه. */
const DANGER_WORDS = ['حذف', 'مسح', 'إزالة', 'إسقاط', 'تعطيل', 'إيقاف', 'استعادة', 'فك ربط', 'تصفير'];

/** `?v2confirm=0|false|off` disables; anything else (and absence) keeps it on. */
export function confirmEnabled(search, stored) {
    const match = String(search || '').match(/(?:^|[?&])v2confirm=([^&]*)/);
    if (match) {
        return !FLAG_FALSE.has(decodeURIComponent(match[1]).toLowerCase());
    }
    if (stored == null || stored === '') {
        return true;
    }
    return !FLAG_FALSE.has(String(stored).toLowerCase());
}

/** اللون الدلالي من نصٍّ نكتبه نحن — لا من بيانات مستخدم. */
export function inferTone(message) {
    const text = String(message == null ? '' : message);
    return DANGER_WORDS.some((word) => text.includes(word)) ? 'danger' : 'warning';
}

/** تقصير النصّ مع إبقاء المعنى؛ النصّ لا يُفسَّر كـHTML في أي حال. */
export function clampText(value) {
    const text = value == null ? '' : String(value);
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/**
 * ينشئ دالةَ تأكيدٍ واحدةً مربوطةً بالنافذة (حوارٌ واحد يعاد استخدامه).
 *
 * @param {Window} win
 * @returns {(message: string, opts?: {title?: string, confirmLabel?: string,
 *   cancelLabel?: string, tone?: 'danger'|'warning'}) => Promise<boolean>}
 */
export function createConfirm(win) {
    const doc = win.document;
    let dialog = null;
    let settle = null;
    let titleEl = null;
    let msgEl = null;
    let okBtn = null;
    let cancelBtn = null;
    let iconEl = null;

    function finish(value) {
        if (!dialog || !dialog.open) {
            return;
        }
        const done = settle;
        settle = null;
        dialog.close();
        if (done) {
            done(value);
        }
    }

    function build() {
        dialog = doc.createElement('dialog');
        dialog.className = 'erp-confirm';
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-labelledby', 'erp-confirm-title');
        dialog.setAttribute('aria-describedby', 'erp-confirm-msg');

        const card = doc.createElement('div');
        card.className = 'erp-confirm__card';

        const head = doc.createElement('div');
        head.className = 'erp-confirm__head';

        iconEl = doc.createElement('span');
        iconEl.className = 'erp-confirm__icon';
        iconEl.setAttribute('aria-hidden', 'true');
        /* icons.js يُحوّل <i class="ji"> إلى <svg> بـouterHTML، فيفقد أي
           صنفٍ على <i> نفسه — لذا الحلقة الملوّنة على الغلاف لا على الرمز. */
        const glyph = doc.createElement('i');
        glyph.className = 'ji';
        glyph.setAttribute('data-i', 'alert-triangle');
        iconEl.appendChild(glyph);

        titleEl = doc.createElement('h2');
        titleEl.className = 'erp-confirm__title';
        titleEl.id = 'erp-confirm-title';

        msgEl = doc.createElement('p');
        msgEl.className = 'erp-confirm__msg';
        msgEl.id = 'erp-confirm-msg';

        const actions = doc.createElement('div');
        actions.className = 'erp-confirm__actions';

        okBtn = doc.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'erp-confirm__btn erp-confirm__btn--primary';

        cancelBtn = doc.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'erp-confirm__btn erp-confirm__btn--ghost';

        actions.append(okBtn, cancelBtn);
        head.append(iconEl, titleEl);
        card.append(head, msgEl, actions);
        dialog.append(card);
        doc.body.appendChild(dialog);

        okBtn.addEventListener('click', () => finish(true));
        cancelBtn.addEventListener('click', () => finish(false));
        dialog.addEventListener('cancel', (event) => {
            /* لا نترك المتصفح يغلق بنفسه: مسارُ إغلاقٍ واحد يعني نتيجةً واحدة. */
            event.preventDefault();
            finish(false);
        });
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) {
                finish(false);
            }
        });
    }

    return function confirmAction(message, opts = {}) {
        if (!dialog) {
            build();
        }
        if (typeof dialog.showModal !== 'function') {
            return Promise.resolve(Boolean(win.confirm(clampText(message))));
        }
        if (dialog.open) {
            finish(false);
        }

        const tone = opts.tone || inferTone(message);
        dialog.dataset.tone = tone;

        titleEl.textContent = clampText(opts.title || 'تأكيد الإجراء');
        msgEl.textContent = clampText(message);
        okBtn.textContent = clampText(opts.confirmLabel || 'تأكيد');
        cancelBtn.textContent = clampText(opts.cancelLabel || 'إلغاء');
        okBtn.className = tone === 'danger'
            ? 'erp-confirm__btn erp-confirm__btn--danger'
            : 'erp-confirm__btn erp-confirm__btn--primary';

        const answer = new Promise((resolve) => {
            settle = resolve;
        });
        dialog.showModal();
        cancelBtn.focus();
        return answer;
    };
}
