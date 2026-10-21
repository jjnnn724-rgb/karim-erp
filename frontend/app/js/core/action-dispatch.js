/**
 * action-dispatch.js — بديل المعالجات السطرية (onclick="…")
 * ══════════════════════════════════════════════════════════════════════
 * لماذا: سياسة CSP الصارمة ستُفعّل `script-src-attr 'none'` ⇒ كل
 * معالج سطري (onclick) يُحجب. الحل: **تفويض** (delegation) بدل eval:
 *
 *   <button data-karim-action="toggleFabMenu">…</button>
 *   <button data-karim-action="go" data-karim-args='["dashboard",null]'>…</button>
 *   <button data-karim-action="go" data-karim-arg0="dashboard">…</button>
 *   <button data-karim-action="go" data-karim-also="toggleFabMenu">…</button>
 *   <input data-karim-action="cmDateChange" data-karim-event="change"
 *          data-karim-pass="value">
 *
 * المميزات:
 *   · لا eval ولا new Function ⇒ يعمل تحت CSP بلا 'unsafe-eval'.
 *   · يعمل للعناصر المُنشأة ديناميكيًا (JS templates) أيضًا.
 *   · الدالة تُحلّ **لحظة الحدث** (window[name]) ⇒ نفس سلوك المعالج السطري
 *     مع الوحدات التي تُحمَّل كسولًا (bridge في main.js).
 *   · `data-karim-prevent` يعادل `return false`، و`data-karim-stop` يعادل
 *     `event.stopPropagation()`.
 *   · `data-karim-pass` يمرّر قيم العنصر (value/checked/files/element)
 *     فتبقى توقيعات الدوال كما هي — لا حاجة لتعديل أي دالة.
 *
 * ترتيب الوسائط: وسائط JSON (data-karim-args) ثم arg0..argN ثم قيم
 * data-karim-pass — بالترتيب نفسه الذي كان يمرَّر في المعالج السطري.
 */
(function () {
    'use strict';

    const ATTR_ACTION = 'data-karim-action';
    const ATTR_ARGS = 'data-karim-args';
    const ATTR_ARG = 'data-karim-arg';
    const ATTR_ALSO = 'data-karim-also';
    const ATTR_PREVENT = 'data-karim-prevent';
    const ATTR_STOP = 'data-karim-stop';
    const ATTR_EVENT = 'data-karim-event';
    const ATTR_PASS = 'data-karim-pass';
    const ATTR_SET = 'data-karim-set';

    /** إجراءات مدمجة (بديل window.print/window.close داخل المعالج السطري). */
    const BUILTINS = {
        print: function () {window.print();},
        closeWindow: function () {window.close();},
    };

    function resolveFn(name) {
        if (!name) {return null;}
        if (BUILTINS[name]) {return BUILTINS[name];}
        const fn = window[name];
        return typeof fn === 'function' ? fn : null;
    }

    /** قيم العنصر المطلوبة عبر data-karim-pass. */
    function passValues(el, names) {
        const out = [];
        for (const raw of names) {
            const key = raw.trim();
            if (!key) {continue;}
            // "files.0" ⇒ el.files[0]
            const indexed = key.match(/^(\w+)\.(\d+)$/);
            if (indexed) {
                const coll = el[indexed[1]];
                out.push(coll ? coll[Number(indexed[2])] : undefined);
                continue;
            }
            switch (key) {
                case 'value': out.push(el.value); break;
                case 'checked': out.push(el.checked); break;
                case 'files': out.push(el.files); break;
                case 'selectedOptions': out.push(el.selectedOptions); break;
                case 'element': case 'this': out.push(el); break;
                default: out.push(el[key]); break;
            }
        }
        return out;
    }

    /** وسائط المعالج: JSON ثم argN ثم قيم pass. */
    function parseArgs(el) {
        const args = [];
        const raw = el.getAttribute(ATTR_ARGS);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {args.push(...parsed);} else {args.push(parsed);}
            } catch (_) {
                console.warn('[karim-action] وسائط JSON غير صالحة:', raw);
            }
        }
        for (let i = 0; ; i++) {
            const v = el.getAttribute(`${ATTR_ARG}${i}`);
            if (v === null) {break;}
            args.push(v);
        }
        const pass = el.getAttribute(ATTR_PASS);
        if (pass) {args.push(...passValues(el, pass.split(',')));}
        return args;
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

    /** ينفّذ الإجراء الأساسي ثم السلسلة (data-karim-also="a,b"). */
    function dispatch(el) {
        applySets(el);
        run(el, el.getAttribute(ATTR_ACTION));
        const also = el.getAttribute(ATTR_ALSO);
        if (!also) {return;}
        for (const name of also.split(',').map((s) => s.trim()).filter(Boolean)) {
            run(el, name);
        }
    }

    /**
     * تعيّنات مسبقة (data-karim-set="name:value" أو "name:@prop"):
     *   · @prop ⇒ القيمة من العنصر (مثل @value ⇒ el.value)
     *   · value ⇒ قيمة حرفية (رقم/نص/boolean/null)
     *were window[name] = value — بلا eval.
     */
    function applySets(el) {
        const raw = el.getAttribute(ATTR_SET);
        if (!raw) {return;}
        for (const item of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
            const idx = item.indexOf(':');
            if (idx < 0) {continue;}
            const name = item.slice(0, idx).trim();
            const source = item.slice(idx + 1).trim();
            let value;
            if (source.startsWith('@')) {
                value = passValues(el, [source.slice(1)])[0];
            } else if (source === 'true') {value = true;}
            else if (source === 'false') {value = false;}
            else if (source === 'null') {value = null;}
            else if (/^-?\d+(\.\d+)?$/.test(source)) {value = Number(source);}
            else {value = source.replace(/^['"]|['"]$/g, '');}
            try {window[name] = value;} catch (_e) { /* محمية: لا نكسر الصفحة */ }
        }
    }

    function bind(type) {
        document.addEventListener(type, function (event) {
            const target = event.target;
            if (!target || typeof target.closest !== 'function') {return;}
            // للأحداث غير click نبحث عن عنصر يحمل نوع الحدث صراحةً (لا تسرّب
            // من عنصر أب يحمل إجراء click).
            const selector = type === 'click'
                ? `[${ATTR_ACTION}]`
                : `[${ATTR_ACTION}][${ATTR_EVENT}="${type}"]`;
            const el = target.closest(selector);
            if (!el) {return;}
            if (el.hasAttribute(ATTR_STOP)) {event.stopPropagation();}
            if (el.hasAttribute(ATTR_PREVENT)) {event.preventDefault();}
            dispatch(el);
        }, false);
    }

    ['click', 'change', 'input', 'submit', 'keydown', 'focus', 'blur', 'keyup'].forEach(bind);

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
