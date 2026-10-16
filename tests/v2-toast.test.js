/**
 * v2-toast.test.js — عقد التنبيه الحقيقي `?v2toast` (P0-3b)
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: frontend/app/js/v2/toast.js + css/v2/erp-toast.css
 *         + الوصل في preview.js (§2c) + شرط الترتيب في session.js:106-107.
 *
 * ما يُثبَّت هنا (الحالات الثماني المطلوبة، بالترتيب):
 *   1) حقن النص: رسالة فيها وسم HTML تظهر نصًا لا عقدة، وصفر innerHTML.
 *   2) الترتيب: installApiFetchBridge() بعد التنصيب الحقيقي لا يستبدله.
 *   3) السقف: خمس رسائل = أربع مرئية، والأقدم هي المغادرة.
 *   4) النفاذ: role/aria-live — polite للعادي وassertive للخطأ.
 *   5) الإغلاق بالنقر (على البطاقة وعلى زر الإغلاق).
 *   6) الاختفاء الذاتي: 4 ثوانٍ عادي، 6 للخطأ.
 *   7) prefers-reduced-motion: حركة أقل، ونصّ CSS بلا hex واحد.
 *   8) التوحيد: ثمانية عشر موضع notifyTo، وسطر الشاشة يبقى يعمل.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const TOAST = path.join(V2, 'toast.js');
const SESSION = path.join(V2, 'session.js');
const HOST = path.join(V2, 'preview.js');
const CSS = path.join(APP, 'css', 'v2', 'erp-toast.css');
const PAGE = path.join(APP, 'v2.html');

const read = (p) => fs.readFileSync(p, 'utf8');

/** مصدر بلا تعليقات — للعقود التي تقيس الكود لا النثر. */
const code = (p) => read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

function loadEsm(file, injections = {}, collect = []) {
    const stripped = read(file)
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const src = collect.length
        ? `${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : stripped;
    const context = {
        console, String, Number, Boolean, Array, Object, RegExp, Error,
        Set, Map, JSON, decodeURIComponent, encodeURIComponent,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

const EXPORTS = ['esc', 'toastEnabled', 'notifyTo', 'installToast', 'MAX_VISIBLE'];

/* ── DOM stub: الحد الأدنى الذي تلمسه toast.js فعلًا ───────────────────
   أي كتابة على innerHTML تُسجَّل ثم ترمي — هذا هو المقصود بـ«صفر
   innerHTML»، لا تعليق في رأس الملف. */
function makeNode(tag, sinks) {
    const node = {
        tagName: tag,
        className: '',
        textContent: '',
        type: '',
        attrs: Object.create(null),
        listeners: Object.create(null),
        children: [],
        parentNode: null,
        setAttribute(k, v) {this.attrs[k] = String(v);},
        getAttribute(k) {return k in this.attrs ? this.attrs[k] : null;},
        appendChild(child) {child.parentNode = this; this.children.push(child); return child;},
        removeChild(child) {
            this.children = this.children.filter((c) => c !== child);
            child.parentNode = null;
            return child;
        },
        addEventListener(type, fn) {(this.listeners[type] = this.listeners[type] || []).push(fn);},
        click() {(this.listeners.click || []).forEach((fn) => fn());},
    };
    Object.defineProperty(node, 'innerHTML', {
        get() {return '';},
        set(v) {
            sinks.push({ tag, value: String(v) });
            throw new Error(`innerHTML used on <${tag}>: ${v}`);
        },
    });
    return node;
}

function makeDoc(withBody = true) {
    const sinks = [];
    const body = makeNode('body', sinks);
    return { body: withBody ? body : null, sinks, createElement: (tag) => makeNode(tag, sinks) };
}

/* ── ساعة وهمية: لا نوم في عقد التوقيت ── */
function makeWindow(doc) {
    const queue = [];
    let clock = 0;
    return {
        document: doc,
        location: { origin: 'https://erp.test', search: '' },
        setTimeout: (fn, ms) => {const t = { fn, at: clock + (ms || 0), dead: false };queue.push(t);return t;},
        clearTimeout: (t) => {if (t) {t.dead = true;}},
        tick(ms) {
            clock += ms;
            const due = queue.filter((t) => !t.dead && t.at <= clock).sort((a, b) => a.at - b.at);
            for (const t of due) {
                if (t.dead) {continue;}
                t.dead = true;
                t.fn();
            }
            return clock;
        },
        pending: () => queue.filter((t) => !t.dead).map((t) => t.at),
    };
}

/** الوحدة + نافذة وهمية + `window` نفسه داخل الـ context (يلزمه notifyTo). */
function harness(enabled = true, withBody = true) {
    const doc = makeDoc(withBody);
    const win = makeWindow(doc);
    const ctx = loadEsm(TOAST, { window: win }, EXPORTS);
    const installed = ctx.installToast(win, { enabled });
    return { ctx, doc, win, installed };
}

const sessionOn = (win) => loadEsm(SESSION, {
    window: win,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: async () => ({ ok: false }),
});

describe('1. نص التنبيه لا يُفسَّر HTML', () => {
    const PAYLOAD = '<img src=x onerror=alert(1)>';

    test('يظهر نصًا حرفيًا في textContent ولا تلمس عقدة واحدة innerHTML', () => {
        const { win, doc } = harness();
        const item = win.toast(PAYLOAD, 'error');
        expect(item.children[1].textContent).toBe(PAYLOAD);
        expect(doc.sinks).toHaveLength(0);
    });

    test('esc() نصّط، ولا ينفجر على null، ويحدّ الطويل', () => {
        const { ctx } = harness(false);
        expect(ctx.esc(null)).toBe('');
        expect(ctx.esc(undefined)).toBe('');
        expect(ctx.esc(123)).toBe('123');
        expect(ctx.esc(PAYLOAD)).toBe(PAYLOAD);
        const long = ctx.esc('ا'.repeat(400));
        expect(long.length).toBe(300);
        expect(long.endsWith('…')).toBe(true);
    });

    test('صفر innerHTML في مصدر الوحدة (الحارس البنائي)', () => {
        const src = code(TOAST);
        expect(src).not.toMatch(/innerHTML/);
        expect(src).not.toMatch(/document\.write|insertAdjacentHTML|createContextualFragment/);
    });
});

describe('2. ترتيب التنصيب هو شرط صحّة لا تفصيل', () => {
    test('installApiFetchBridge() بعد التنصيب الحقيقي لا يبتلعه', () => {
        const { win, doc } = harness();
        const real = win.toast;
        sessionOn(win).installApiFetchBridge();
        expect(win.toast).toBe(real);
        expect(typeof win.__v2Toast.show).toBe('function');
        expect(doc.sinks).toHaveLength(0);
    });

    test('العكس هو الكسر: بلا تنصيب يسقط الصمت على console.info', () => {
        const win = { location: { origin: 'https://erp.test' } };
        sessionOn(win).installApiFetchBridge();
        expect(typeof win.toast).toBe('function');
        expect(win.__v2Toast).toBeUndefined();
    });

    test('preview.js ينصب التوست قبل ensureSession — لا بعده', () => {
        const src = code(HOST);
        const install = src.indexOf('installToast(window, { enabled: TOAST })');
        const session = src.indexOf('ensureSession({ rotate: true })');
        expect(install).toBeGreaterThan(-1);
        expect(session).toBeGreaterThan(-1);
        expect(install).toBeLessThan(session);
    });
});

describe('3. السقف: أربع مرئية، والأقدم ترحل', () => {
    test('خمس رسائل → أربع، وأول واحدة هي المغادرة', () => {
        const { ctx, win } = harness();
        const first = win.toast('أ', 'info');
        win.toast('ب', 'info');
        win.toast('ج', 'info');
        win.toast('د', 'info');
        const fifth = win.toast('هـ', 'info');
        expect(ctx.MAX_VISIBLE).toBe(4);
        expect(win.__v2Toast.count()).toBe(4);
        expect(first.__v2Leaving).toBe(true);
        expect(fifth.__v2Leaving).toBeUndefined();
    });

    test('بعد لحظة المغادرة تُنظّف الطبقة نفسها: أربع عقد لا خمس', () => {
        const { win, doc } = harness();
        for (const m of ['أ', 'ب', 'ج', 'د', 'هـ']) {win.toast(m, 'info');}
        expect(doc.body.children).toHaveLength(1);
        const layer = doc.body.children[0];
        expect(layer.children).toHaveLength(5);
        win.tick(200);
        expect(layer.children).toHaveLength(4);
    });
});

describe('4. role و aria-live', () => {
    test('العادي status/polite، والخطأ alert/assertive', () => {
        const { win } = harness();
        const ok = win.toast('تم', 'success');
        const info = win.toast('معلومة', 'info');
        const warn = win.toast('تحذير', 'warning');
        const bad = win.toast('فشل', 'error');
        for (const item of [ok, info, warn]) {
            expect(item.getAttribute('role')).toBe('status');
            expect(item.getAttribute('aria-live')).toBe('polite');
        }
        expect(bad.getAttribute('role')).toBe('alert');
        expect(bad.getAttribute('aria-live')).toBe('assertive');
    });

    test('نوع مجهول يسقط على success لا على فراغ', () => {
        const { win } = harness();
        const odd = win.toast('شيء', 'ok');
        expect(odd.className).toBe('erp-toast erp-toast--success');
        expect(odd.getAttribute('aria-live')).toBe('polite');
        expect(win.toast('بلا نوع').className).toBe('erp-toast erp-toast--success');
    });

    test('الأيقونات كلها أسماء من ji والرموز من --erp-*: لا رسم جديد', () => {
        const { win } = harness();
        const names = ['success', 'info', 'warning', 'error'].map((t) => win.toast('ن', t).children[0]);
        for (const icon of names) {
            expect(icon.tagName).toBe('i');
            expect(icon.className).toBe('ji');
            expect(['circle-check', 'info', 'alert-triangle', 'circle-x']).toContain(icon.getAttribute('data-i'));
        }
    });
});

describe('5. الإغلاق بالنقر', () => {
    test('النقر على البطاقة يغلقها', () => {
        const { win } = harness();
        const item = win.toast('انقرني', 'info');
        expect(win.__v2Toast.count()).toBe(1);
        item.click();
        expect(win.__v2Toast.count()).toBe(0);
        expect(item.__v2Leaving).toBe(true);
    });

    test('زر الإغلاق موجود ومسمّى، والنقر المزدوج لا يكرر الإغلاق', () => {
        const { win } = harness();
        const item = win.toast('مرتين', 'info');
        const close = item.children[2];
        expect(close.tagName).toBe('button');
        expect(close.getAttribute('aria-label')).toBe('إخفاء التنبيه');
        close.click();
        expect(win.__v2Toast.count()).toBe(0);
        item.click();
        expect(win.__v2Toast.count()).toBe(0);
    });

    test('dismissAll يفرّغ بلا استثناء', () => {
        const { win } = harness();
        win.toast('أ', 'info');
        win.toast('ب', 'info');
        win.__v2Toast.dismissAll();
        expect(win.__v2Toast.count()).toBe(0);
    });
});

describe('6. الاختفاء الذاتي: 4 ثوانٍ و6 للأخطاء', () => {
    test('عادي يعيش 4000ms بالضبط', () => {
        const { win } = harness();
        win.toast('عادي', 'info');
        expect(win.pending()).toEqual([4000]);
        win.tick(3999);
        expect(win.__v2Toast.count()).toBe(1);
        win.tick(1);
        expect(win.__v2Toast.count()).toBe(0);
    });

    test('الخطأ يعيش 6000ms بالضبط', () => {
        const { win } = harness();
        win.toast('فشل', 'error');
        expect(win.pending()).toEqual([6000]);
        win.tick(4000);
        expect(win.__v2Toast.count()).toBe(1);
        win.tick(2000);
        expect(win.__v2Toast.count()).toBe(0);
    });

    test('الإغلاق بالنقر يلغي المؤقّت فلا يُطلق بعد رحيله', () => {
        const { win } = harness();
        const item = win.toast('نقر', 'info');
        item.click();
        win.tick(10000);
        expect(win.__v2Toast.count()).toBe(0);
    });
});

describe('7. الحركة والتوكنات في CSS', () => {
    const css = () => code(CSS);

    test('prefers-reduced-motion يطفئ الحركة ولا يخفي التنبيه', () => {
        const src = css();
        const at = src.indexOf('@media (prefers-reduced-motion: reduce)');
        expect(at).toBeGreaterThan(-1);
        const block = src.slice(at);
        expect(block).toMatch(/animation:\s*none/);
        expect(block).toMatch(/transition:\s*none/);
        expect(block).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    });

    test('صفر hex وصفر خط جديد: كل لون توكن حيّ', () => {
        const src = css();
        expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(src).not.toMatch(/rgba?\(|hsl\(/);
        expect(src).toMatch(/z-index:\s*var\(--erp-z-toast\)/);
        expect(src).toMatch(/font-family:\s*var\(--erp-font-sans\)/);
        expect(src.match(/var\(--erp-[a-z0-9-]+\)/g).length).toBeGreaterThan(20);
    });

    test('RTL بالخصائص المنطقية، والطبقة لا تسرق نقرة', () => {
        const src = css();
        const layer = src.slice(src.indexOf('.erp-toast-layer'), src.indexOf('.erp-toast {'));
        expect(src).toMatch(/\[dir="ltr"\]\s\.erp-toast-layer\s*\{[^}]*inset-inline-start:\s*auto/);
        expect(layer).toMatch(/inset-inline-start:\s*var\(--erp-space-4\)/);
        expect(layer).not.toMatch(/inset-inline-end/);
        expect(src).toMatch(/padding-inline:/);
        expect(src).toMatch(/border-inline-start-width:/);
        expect(src).toMatch(/\.erp-toast-layer\s*\{[^}]*pointer-events:\s*none/);
        expect(src).toMatch(/\.erp-toast\s*\{[^}]*pointer-events:\s*auto/);
    });
});

describe('7b. الطبقة داخل نطاق `.erp-v2` — وإلا كان كل توكن فارغًا', () => {
    test('الطبقة تحمل erp-v2 فترث --erp-* وتحويلات [data-theme=dark]', () => {
        const { win, doc } = harness();
        win.toast('ن', 'info');
        const layer = doc.body.children[0];
        expect(layer.className.split(' ')).toContain('erp-v2');
        expect(layer.className.split(' ')).toContain('erp-toast-layer');
    });

    test('السبب ما زال قائمًا: التوكنات على .erp-v2 لا على :root', () => {
        /* المحظور هو :root، لا تعددُ المحدِّدات: طبقتان ملحقَتان ب<body>
           (erp-fab-host · erp-offline-bar) صارتا تُعرَّفان مع .erp-v2 لأن
           var(--erp-*) لا يحلّ عندهما بدونهما — والقياس الحيّ: بدون ذلك يرسم
           الـFAB بخلفية rgba(0,0,0,0) وحرفٍ أبيض على #f4f5f7. */
        const tokens = code(path.join(APP, 'css', 'v2', 'erp-tokens.css'));
        expect(tokens).toMatch(/^\.erp-v2[,\s]/m);
        expect(tokens).not.toMatch(/:root\s*\{[^}]*--erp-/);
        expect(code(path.join(APP, 'css', 'v2', 'erp-themes.css'))).toMatch(/\[data-theme="dark"\] \.erp-v2[,\s]/);
    });

    test('erp-toast.css يبطل خلفية .erp-v2 على الطبقة (لا شريط خلف البطاقات)', () => {
        expect(code(CSS)).toMatch(/\.erp-toast-layer\s*\{[^}]*background:\s*none/);
    });
});

describe('8. التوحيد: notifyTo بدل ثماني عشرة حرفية', () => {
    test('preview.js: ثمانية عشر notifyTo ولا حرفية قديمة', () => {
        const src = code(HOST);
        expect(src.match(/notify: notifyTo\(note\),/g)).toHaveLength(18);
        expect(src).not.toMatch(/notify: \(message\) => \{ note\.textContent = message; \}/);
        expect(read(HOST)).toMatch(/from '\.\/toast\.js\?v=\d+\.\d+\.\d+'/);
    });

    test('سطر الشاشة والتوست معًا — إضافة لا استبدال', () => {
        const { ctx, win } = harness();
        const note = makeNode('p', []);
        const notify = ctx.notifyTo(note);
        expect(notify('تم الحفظ')).toBe('تم الحفظ');
        expect(note.textContent).toBe('تم الحفظ');
        expect(win.__v2Toast.count()).toBe(1);
        const item = win.__v2Toast.getLayer().children[0];
        expect(item.children[1].textContent).toBe('تم الحفظ');
        expect(item.getAttribute('aria-live')).toBe('polite');
    });

    test('سقف notifyTo نفسه: خمس رسائل من شاشة واحدة = أربع مرئية', () => {
        const { ctx, win } = harness();
        const note = makeNode('p', []);
        const notify = ctx.notifyTo(note);
        for (const m of ['1', '2', '3', '4', '5']) {notify(m);}
        expect(note.textContent).toBe('5');
        expect(win.__v2Toast.count()).toBe(4);
    });

    test('العلم مطفأ: سطر الشاشة يعمل وحده ولا توست ولا globals جديدة', () => {
        const { ctx, win, installed } = harness(false);
        const note = makeNode('p', []);
        expect(installed).toBe(false);
        expect(ctx.notifyTo(note)('شبكة')).toBe('شبكة');
        expect(note.textContent).toBe('شبكة');
        expect(win.toast).toBeUndefined();
    });

    test('مواضع notify المتعمّدة الصمت لم تتحول توستًا (menu-board iframe)', () => {
        expect(code(HOST)).toMatch(/notify: \(_message\) => \{\},/);
    });
});

describe('الراية: OFF هو الافتراضي', () => {
    test('?v2toast يسحب على المخزّن، وغيابه يعني إطفاءً', () => {
        const { ctx } = harness(false);
        expect(ctx.toastEnabled('', null)).toBe(false);
        expect(ctx.toastEnabled('', '')).toBe(false);
        expect(ctx.toastEnabled('?live=1', null)).toBe(false);
        expect(ctx.toastEnabled('?v2toast=1', null)).toBe(true);
        expect(ctx.toastEnabled('?v2toast=true', null)).toBe(true);
        expect(ctx.toastEnabled('?live=1&v2toast=1', null)).toBe(true);
        expect(ctx.toastEnabled('?v2toast=0', '1')).toBe(false);
        expect(ctx.toastEnabled('?v2toast=1', '0')).toBe(true);
        expect(ctx.toastEnabled('', '1')).toBe(true);
        expect(ctx.toastEnabled('', 'garbage')).toBe(false);
    });

    test('preview.js يقرأ الراية من الـ URL ومن localStorage معًا', () => {
        const src = code(HOST);
        expect(src).toMatch(/localStorage\.getItem\('karim_v2_toast'\)/);
        expect(src).toMatch(/toastEnabled\(window\.location\.search, storedToastFlag\)/);
    });

    test('الإطفاء يعني صفر globals جديدة وصفر عقد في DOM', () => {
        const { win, doc, installed } = harness(false);
        expect(installed).toBe(false);
        expect(win.toast).toBeUndefined();
        expect(win.__v2Toast).toBeUndefined();
        expect(doc.body.children).toHaveLength(0);
    });

    test('لا DOM ولا localStorage وقت الاستيراد: لا طرفيات مطلوبة عند الاستيراد', () => {
        const src = code(TOAST);
        expect(src).not.toMatch(/localStorage/);
        expect(src).not.toMatch(/^\s*document\./m);
        expect(src).not.toMatch(/addEventListener\([^)]*'DOMContentLoaded'/);
    });

    test('تنصيب مزدوج لا يكرّر الطبقة ولا يستبدل الدالة', () => {
        const { ctx, win, doc } = harness();
        const real = win.toast;
        expect(ctx.installToast(win, { enabled: true })).toBe(true);
        expect(win.toast).toBe(real);
        win.toast('أ', 'info');
        win.toast('ب', 'info');
        expect(doc.body.children).toHaveLength(1);
    });

    test('مستند بلا body: لا استثناء في وجه الـ boot، ولا تنصيب', () => {
        const { installed } = harness(true, false);
        expect(installed).toBe(false);
    });

    test('v2.html يحمّل erp-toast.css بنفس مراجعة الصفحة', () => {
        const html = read(PAGE);
        const ver = (html.match(/js\/v2\/preview\.js\?v=([\d.]+)/) || [])[1];
        expect(ver).toBeTruthy();
        expect(html).toContain(`css/v2/erp-toast.css?v=${ver}`);
    });
});
