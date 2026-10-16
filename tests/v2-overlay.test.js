/**
 * v2-overlay.test.js — عقد غطاء التحميل `?v2overlay` (P0-3c)
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: frontend/app/js/v2/overlay.js + css/v2/erp-overlay.css
 *         + الوصل في preview.js (§2d) + القرار ٢ في عقد V2.
 *
 * ما يُثبَّت هنا (بالترتيب):
 *   1) الراية: OFF افتراضيًا، و?v2overlay يغلب المخزّن.
 *   2) الإطفاء: صفر globals، صفر عقد، و`window.fetch` كما كان حرفيًا.
 *   3) العتبة: طلب 399ms لا يُظهر غطاءً أبدًا؛ 400ms يُظهره.
 *   4) العدّاد المتوازن: متوازيان يبقيان الغطاء حتى آخر واحد.
 *   5) الخطأ (reject) ينقص العدّاد ويُعيد الرمي — لا غطاء عالق.
 *   6) المهلة (timeout): طلب لا يستقرّ يُحرَّر عند MAX_HOLD_MS.
 *   7) الاستثناء: /notifications و/health لا يُحسبان.
 *   8) البنيوي: لا innerHTML، والطبقة تحمل .erp-v2 وaria-busy.
 *   9) CSS: صفر hex/rgba، توكنات فقط، reduced-motion، وترتيب الأوراق.
 *  10) v2.html يحمّل erp-overlay.css بنفس مراجعة الصفحة.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const OVERLAY = path.join(V2, 'overlay.js');
const HOST = path.join(V2, 'preview.js');
const CSS = path.join(APP, 'css', 'v2', 'erp-overlay.css');
const PAGE = path.join(APP, 'v2.html');

const read = (p) => fs.readFileSync(p, 'utf8');

/** مصدر بلا تعليقات — للعقود التي تقيس الكود لا النثر. */
const code = (p) => read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

const EXPORTS = ['overlayEnabled', 'urlOf', 'shouldCount', 'installOverlay',
    'THRESHOLD_MS', 'MAX_HOLD_MS', 'EXCLUDE', 'LOADING_LABEL'];

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
        Set, Map, JSON, Math, Promise, decodeURIComponent, encodeURIComponent,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

/* ── DOM stub: الحد الأدنى الذي تلمسه overlay.js فعلًا ─────────────── */
function makeNode(tag, sinks) {
    const node = {
        tagName: tag,
        className: '',
        textContent: '',
        hidden: false,
        attrs: Object.create(null),
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

/* ── ساعة وهمية + fetch يدوي التحكم: لا نوم ولا شبكة في العقد ── */
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
        pending: () => queue.filter((t) => !t.dead).map((t) => t.at).sort((a, b) => a - b),
    };
}

function makeFetch() {
    const calls = [];
    const fetch = (input, init) => {
        const rec = { input, init };
        rec.promise = new Promise((resolve, reject) => {rec.resolve = resolve; rec.reject = reject;});
        calls.push(rec);
        return rec.promise;
    };
    return { fetch, calls };
}

function harness({ enabled = true, threshold, maxHold, withBody = true, hasFetch = true } = {}) {
    const doc = makeDoc(withBody);
    const win = makeWindow(doc);
    const f = makeFetch();
    if (hasFetch) {win.fetch = f.fetch;}
    const ctx = loadEsm(OVERLAY, { window: win }, EXPORTS);
    const installed = ctx.installOverlay(win, { enabled, threshold, maxHold });
    return { ctx, doc, win, f, installed, orig: f.fetch };
}

const layerOf = (doc) => (doc.body && doc.body.children.find((c) => String(c.className).includes('erp-loading-layer'))) || null;

describe('1. الراية: OFF هو الافتراضي', () => {
    const table = [
        ['', null, false], ['', '', false], ['?live=1', null, false],
        ['?v2overlay=1', null, true], ['?v2overlay=true', null, true],
        ['?v2overlay=on', null, true], ['?live=1&v2overlay=1', null, true],
        ['?v2overlay=0', '1', false], ['?v2overlay=1', '0', true],
        ['', '1', true], ['', 'garbage', false],
    ];
    test.each(table)('overlayEnabled(%p, %p) → %p', (search, stored, expected) => {
        const { ctx } = harness(false);
        expect(ctx.overlayEnabled(search, stored)).toBe(expected);
    });

    test('preview.js يقرأ الراية من الـURL ومن localStorage معًا', () => {
        const src = code(HOST);
        expect(src).toMatch(/localStorage\.getItem\('karim_v2_overlay'\)/);
        expect(src).toMatch(/overlayEnabled\(window\.location\.search, storedOverlayFlag\)/);
        expect(read(HOST)).toMatch(/from '\.\/overlay\.js\?v=\d+\.\d+\.\d+'/);
    });

    test('الغطاء يُنصَّب قبل تركيب أي شاشة (وإلا فاتت الطلبات)', () => {
        const src = code(HOST);
        const install = src.indexOf('installOverlay(window, { enabled: OVERLAY })');
        const nav = src.indexOf("renderScreen('dashboard')");
        const session = src.indexOf('ensureSession({ rotate: true })');
        expect(install).toBeGreaterThan(-1);
        expect(nav).toBeGreaterThan(-1);
        expect(session).toBeGreaterThan(-1);
        expect(install).toBeLessThan(nav);
        expect(install).toBeLessThan(session);
    });
});

describe('2. الإطفاء يعني صفر أثر', () => {
    test('صفر globals، صفر عقد، وfetch كما كان', () => {
        const { win, doc, installed, orig, ctx } = harness({ enabled: false });
        expect(installed).toBe(false);
        expect(win.fetch).toBe(orig);
        expect(win.__v2Overlay).toBeUndefined();
        expect(doc.body.children).toHaveLength(0);
        expect(ctx.shouldCount('/api/attendance/range')).toBe(true);
    });

    test('لا fetch أصلًا: لا تنصيب ولا استثناء', () => {
        const { win, installed } = harness({ enabled: true, hasFetch: false });
        expect(installed).toBe(false);
        expect(win.__v2Overlay).toBeUndefined();
    });

    test('مستند بلا body: لا استثناء في وجه الـboot ولا تنصيب', () => {
        const { installed } = harness({ enabled: true, withBody: false });
        expect(installed).toBe(false);
    });

    test('تنصيب مزدوج لا يغلّف fetch مرتين', () => {
        const { win, ctx } = harness();
        const once = win.fetch;
        expect(ctx.installOverlay(win, { enabled: true })).toBe(true);
        expect(win.fetch).toBe(once);
    });

    test('لا DOM ولا localStorage وقت الاستيراد', () => {
        const src = code(OVERLAY);
        expect(src).not.toMatch(/localStorage/);
        expect(src).not.toMatch(/^\s*document\./m);
        expect(src).not.toMatch(/addEventListener\([^)]*'DOMContentLoaded'/);
    });
});

describe('3. العتبة هي الميزة: 399ms لا يراه أحد', () => {
    test('طلب قصير لا يُظهر الغطاء ولو انتظرنا بعده طويلًا', async () => {
        const { win, f, doc } = harness();
        const p = win.fetch('/api/attendance/range');
        win.tick(300);
        expect(layerOf(doc)).toBeNull();
        f.calls[0].resolve({ ok: true });
        await p;
        win.tick(10000);
        expect(layerOf(doc)).toBeNull();
        expect(win.__v2Overlay.count()).toBe(0);
    });

    test('عند 399ms لا شيء، وعند 400ms يظهر الغطاء', async () => {
        const { win, f, doc } = harness();
        const p = win.fetch('/api/attendance/range');
        win.tick(399);
        expect(win.__v2Overlay.visible()).toBe(false);
        win.tick(1);
        expect(win.__v2Overlay.visible()).toBe(true);
        const layer = layerOf(doc);
        expect(layer).not.toBeNull();
        expect(layer.hidden).toBe(false);
        f.calls[0].resolve({ ok: true });
        await p;
        expect(win.__v2Overlay.visible()).toBe(false);
        expect(layer.hidden).toBe(true);
    });

    test('الطلب المتعقَّب يمرّ إلى fetch الأصلي بنفس الوسائط', () => {
        const { win, f } = harness();
        const init = { method: 'POST' };
        win.fetch('/api/attendance/range', init);
        expect(f.calls[0].input).toBe('/api/attendance/range');
        expect(f.calls[0].init).toBe(init);
    });
});

describe('4. العدّاد المتوازن: الغطاء يبقى حتى آخر طلب', () => {
    test('متوازيان: الأول لا يُخفيه والثاني يُخفيه', async () => {
        const { win, f } = harness();
        const a = win.fetch('/api/a');
        const b = win.fetch('/api/b');
        win.tick(400);
        expect(win.__v2Overlay.visible()).toBe(true);
        expect(win.__v2Overlay.count()).toBe(2);
        f.calls[0].resolve({});
        await a;
        expect(win.__v2Overlay.visible()).toBe(true);
        expect(win.__v2Overlay.count()).toBe(1);
        f.calls[1].resolve({});
        await b;
        expect(win.__v2Overlay.visible()).toBe(false);
        expect(win.__v2Overlay.count()).toBe(0);
    });

    test('المؤقّتات متوازنة: عتبة + سقف احتفاظ عند البدء، ثم لا شيء', async () => {
        const { win, f } = harness();
        const a = win.fetch('/api/a');
        expect(win.pending()).toEqual([400, 30000]);
        win.tick(400);
        expect(win.pending()).toEqual([30000]);
        f.calls[0].resolve({});
        await a;
        expect(win.pending()).toEqual([]);
    });
});

describe('5. الخطأ ينقص العدّاد ويُعيد الرمي', () => {
    test('reject يخفي الغطاء ويمرّر الخطأ كما هو', async () => {
        const { win, f } = harness();
        const p = win.fetch('/api/attendance/range');
        win.tick(400);
        expect(win.__v2Overlay.visible()).toBe(true);
        f.calls[0].reject(new Error('boom'));
        await expect(p).rejects.toThrow('boom');
        expect(win.__v2Overlay.visible()).toBe(false);
        expect(win.__v2Overlay.count()).toBe(0);
        expect(win.pending()).toEqual([]);
    });

    test('رمي متزامن من fetch الأصلي لا يترك العدّاد معلقًا', () => {
        const doc = makeDoc(true);
        const win = makeWindow(doc);
        win.fetch = () => {throw new Error('sync');};
        const ctx = loadEsm(OVERLAY, { window: win }, EXPORTS);
        ctx.installOverlay(win, { enabled: true });
        expect(() => win.fetch('/api/x')).toThrow('sync');
        expect(win.__v2Overlay.count()).toBe(0);
        expect(win.pending()).toEqual([]);
    });

    test('return غير واعد (بلا then) لا يعلق العدّاد', () => {
        const doc = makeDoc(true);
        const win = makeWindow(doc);
        win.fetch = () => 42;
        const ctx = loadEsm(OVERLAY, { window: win }, EXPORTS);
        ctx.installOverlay(win, { enabled: true });
        expect(win.fetch('/api/x')).toBe(42);
        expect(win.__v2Overlay.count()).toBe(0);
    });
});

describe('6. المهلة تحرّر الطلب الذي لا يستقرّ أبدًا', () => {
    test('بعد MAX_HOLD_MS يرفع الغطاء ويصفّر العدّاد، والاستقرار المتأخر لا ينقص مرتين', async () => {
        const { win, f, ctx } = harness();
        expect(ctx.MAX_HOLD_MS).toBe(30000);
        const p = win.fetch('/api/slow');
        win.tick(400);
        expect(win.__v2Overlay.visible()).toBe(true);
        win.tick(29599);
        expect(win.__v2Overlay.visible()).toBe(true);
        win.tick(1);
        expect(win.__v2Overlay.visible()).toBe(false);
        expect(win.__v2Overlay.count()).toBe(0);
        f.calls[0].resolve({});
        await p;
        expect(win.__v2Overlay.count()).toBe(0);
    });

    test('السقف قابل للضبط (للاختبار وللسياسة)', () => {
        const { win } = harness({ maxHold: 1000, threshold: 100 });
        win.fetch('/api/slow');
        win.tick(100);
        expect(win.__v2Overlay.visible()).toBe(true);
        win.tick(1000);
        expect(win.__v2Overlay.visible()).toBe(false);
    });
});

describe('7. الاستثناء: النبض وفحص الصحة لا يرفعان الغطاء', () => {
    const skipped = ['/api/notifications', '/api/notifications?since=1',
        'https://erp.test/api/health', '/api/health?deep=1'];

    test.each(skipped)('%s لا يُحسب ولا يُشعل مؤقّتًا', (url) => {
        const { win, f, doc } = harness();
        win.fetch(url);
        expect(win.__v2Overlay.count()).toBe(0);
        expect(win.pending()).toEqual([]);
        win.tick(5000);
        expect(layerOf(doc)).toBeNull();
        expect(f.calls).toHaveLength(1);   // الطلب مرّ فعلًا
    });

    test('مسار يشبه المستثنى لا يُستثنى بالخطأ', () => {
        const { ctx } = harness(false);
        expect(ctx.shouldCount('/api/attendance/health-report')).toBe(true);
        expect(ctx.shouldCount('/api/notifications-log')).toBe(true);
        expect(ctx.shouldCount('')).toBe(false);
    });

    test('الشكل المجهول لا يُحسب: العدّ الخاطئ أسوأ من عدم العدّ', () => {
        const { win, f } = harness();
        win.fetch({ url: '' }, {});
        win.fetch({}, {});
        win.fetch();
        expect(win.__v2Overlay.count()).toBe(0);
        expect(win.pending()).toEqual([]);
        expect(f.calls).toHaveLength(3);
    });

    test('Request.url يُقرأ فيُستثنى النبض ويُحسب السجل', () => {
        const { win } = harness();
        win.fetch({ url: 'https://erp.test/api/notifications' });
        expect(win.__v2Overlay.count()).toBe(0);
        win.fetch({ url: 'https://erp.test/api/attendance/range' });
        expect(win.__v2Overlay.count()).toBe(1);
    });
});

describe('8. البنيوي: نص لا HTML، ونطاق .erp-v2، وaria', () => {
    test('الغطاء يظهر: لا innerHTML في أي عقدة', () => {
        const { win, doc } = harness();
        win.fetch('/api/x');
        win.tick(400);
        expect(doc.sinks).toHaveLength(0);
    });

    test('الطبقة تحمل .erp-v2 و.erp-loading-layer', () => {
        const { win, doc } = harness();
        win.fetch('/api/x');
        win.tick(400);
        const layer = layerOf(doc);
        expect(layer.className.split(' ')).toContain('erp-v2');
        expect(layer.className.split(' ')).toContain('erp-loading-layer');
    });

    test('role=status وaria-live=polite وaria-busy يتبع الحالة', async () => {
        const { win, f } = harness();
        const p = win.fetch('/api/x');
        win.tick(400);
        const layer = win.__v2Overlay.getLayer();
        expect(layer.getAttribute('role')).toBe('status');
        expect(layer.getAttribute('aria-live')).toBe('polite');
        expect(layer.getAttribute('aria-busy')).toBe('true');
        f.calls[0].resolve({});
        await p;
        expect(layer.getAttribute('aria-busy')).toBe('false');
    });

    test('النص نصّي بحرفيته والحلقة زخرفية', () => {
        const { win, ctx } = harness();
        win.fetch('/api/x');
        win.tick(400);
        const card = win.__v2Overlay.getLayer().children[0];
        const spin = card.children[0];
        const label = card.children[1];
        expect(spin.getAttribute('aria-hidden')).toBe('true');
        expect(label.textContent).toBe(ctx.LOADING_LABEL);
    });

    test('صفر innerHTML في مصدر الوحدة (الحارس البنائي)', () => {
        const src = code(OVERLAY);
        expect(src).not.toMatch(/innerHTML/);
        expect(src).not.toMatch(/document\.write|insertAdjacentHTML|createContextualFragment/);
    });
});

describe('9. CSS: توكنات فقط ولا لون خام', () => {
    const css = () => code(CSS);

    test('صفر hex وصفر rgba/hsl: كل لون توكن حيّ', () => {
        const src = css();
        expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(src).not.toMatch(/rgba?\(|hsl\(/);
        expect(src).toMatch(/z-index:\s*var\(--erp-z-overlay\)/);
        expect(src).toMatch(/font-family:\s*var\(--erp-font-sans\)/);
        expect(src.match(/var\(--erp-[a-z0-9-]+\)/g).length).toBeGreaterThan(15);
    });

    test('الشريط مشتقٌّ من توكن مع إعلان احتياطي شفاف (لا لون خام)', () => {
        const src = css();
        const layer = src.slice(src.indexOf('.erp-loading-layer'), src.indexOf('.erp-loading-layer[hidden]'));
        expect(layer).toMatch(/background:\s*var\(--erp-neutral-soft\)/);
        expect(layer).toMatch(/color-mix\(in srgb, var\(--erp-text-primary\)/);
    });

    test('الغطاء يلتقط المؤشر والبطاقة لا', () => {
        const src = css();
        expect(src).toMatch(/\.erp-loading-layer\s*\{[^}]*pointer-events:\s*auto/);
        expect(src).toMatch(/\.erp-loading__card\s*\{[^}]*pointer-events:\s*none/);
    });

    test('hidden يُخفي فعلًا (display:none يغلب display:grid)', () => {
        expect(css()).toMatch(/\.erp-loading-layer\[hidden\]\s*\{\s*display:\s*none/);
    });

    test('prefers-reduced-motion يثبّت الحلقة ولا يخفي الغطاء', () => {
        const src = css();
        const at = src.indexOf('@media (prefers-reduced-motion: reduce)');
        expect(at).toBeGreaterThan(-1);
        const block = src.slice(at);
        expect(block).toMatch(/animation:\s*none/);
        expect(block).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    });

    test('الطبقة على <body> تحمل نطاق .erp-v2 وخلفيتها تغلب خلفية .erp-v2', () => {
        /* المحظور :root لا تعددُ المحدِّدات — انظر v2-toast.test.js: طبقتا
           erp-fab-host وerp-offline-bar صارتا تُعرَّفان مع .erp-v2. */
        expect(code(path.join(APP, 'css', 'v2', 'erp-tokens.css'))).toMatch(/^\.erp-v2[,\s]/m);
        expect(code(path.join(APP, 'css', 'v2', 'erp-tokens.css'))).not.toMatch(/:root\s*\{[^}]*--erp-/);
        // الشريط يغلب خلفية .erp-v2 من erp-base.css:23 بترتيب الأوراق في v2.html
        const page = read(PAGE);
        const base = page.indexOf('css/v2/erp-base.css');
        const overlay = page.indexOf('css/v2/erp-overlay.css');
        expect(base).toBeGreaterThan(-1);
        expect(overlay).toBeGreaterThan(base);
    });
});

describe('10. v2.html يحمّل ورقة الغطاء بنفس مراجعة الصفحة', () => {
    test('revision موحّدة بين preview.js وerp-overlay.css', () => {
        const html = read(PAGE);
        const ver = (html.match(/js\/v2\/preview\.js\?v=([\d.]+)/) || [])[1];
        expect(ver).toBeTruthy();
        expect(html).toContain(`css/v2/erp-overlay.css?v=${ver}`);
    });
});
