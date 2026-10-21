/**
 * action-dispatch.js — بديل المعالجات السطرية (onclick="…")
 * ══════════════════════════════════════════════════════════════════════
 * لماذا: سياسة CSP الصارمة ستُفعّل `script-src-attr 'none'` ⇒ كل
 * معالج سطري (onclick) يُحجب. الحل: **تفويض** (delegation) بدل eval:
 *
 *   <button data-karim-action="toggleFabMenu">…</button>
 *   <button data-karim-action="go" data-karim-args='["dashboard",null]'>…</button>
 *   <button data-karim-action="go" data-karim-also="toggleFabMenu">…</button>
 *
 * المميزات:
 *   · لا eval ولا new Function ⇒ يعمل تحت CSP بلا 'unsafe-eval'.
 *   · يعمل للعناصر المُنشأة ديناميكيًا (JS templates) أيضًا.
 *   · الدالة تُحلّ **لحظة النقر** (window[name]) ⇒ نفس سلوك المعالج السطري
 *     مع الوحدات التي تُحمَّل كسولًا (bridge في main.js).
 *   · `data-karim-prevent` يعادل `return false` في المعالج السطري.
 *
 * ملاحظة: لا نمنع السلوك الافتراضي افتراضيًا (حتى لا نكسر submit في نماذج).
 */
(function () {
    'use strict';

    const ATTR_ACTION = 'data-karim-action';
    const ATTR_ARGS = 'data-karim-args';
    const ATTR_ALSO = 'data-karim-also';
    const ATTR_PREVENT = 'data-karim-prevent';

    function resolveFn(name) {
        if (!name) {return null;}
        const fn = window[name];
        return typeof fn === 'function' ? fn : null;
    }

    function parseArgs(el) {
        const raw = el.getAttribute(ATTR_ARGS);
        if (!raw) {return [];}
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch (_) {
            console.warn('[karim-action] وسائط غير صالحة:', raw);
            return [];
        }
    }

    function run(el, name) {
        const fn = resolveFn(name);
        if (!fn) {
            // نفس ما كان يحدث مع المعالج السطري (ReferenceError) لكن برسالة أوضح.
            console.error(`[karim-action] الدالة "${name}" غير متاحة (الوحدة لم تُحمَّل بعد؟)`);
            return false;
        }
        try {
            fn.apply(el, parseArgs(el));
        } catch (e) {
            console.error(`[karim-action] خطأ أثناء تنفيذ "${name}":`, e);
        }
        return true;
    }

    document.addEventListener('click', function (event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') {return;}
        const el = target.closest(`[${ATTR_ACTION}]`);
        if (!el) {return;}
        if (el.hasAttribute(ATTR_PREVENT)) {event.preventDefault();}
        run(el, el.getAttribute(ATTR_ACTION));
        const also = el.getAttribute(ATTR_ALSO);
        if (also) {run(el, also);}
    }, false);

    // ─── قلب media="print" ⇒ "all" (كان onload="this.media='all'") ───
    // كانت هذه معالجات سطرية ⇒ محجوبة ⇒ أنماط realtime/scanner لم تكن
    // تُطبَّق على الشاشة. الآن بالتفويض بلا معالج سطري.
    function applyPrintStyles() {
        const nodes = document.querySelectorAll('[data-media-always][media="print"]');
        for (const n of nodes) {n.media = 'all';}
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyPrintStyles);
    } else {
        applyPrintStyles();
    }
})();
