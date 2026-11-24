/**
 * v2-moods.test.js — حرّاس طبقة «الأمزجة» (css/v2/erp-moods.css)
 * ═════════════════════════════════════════════════════════════════════════
 * الطبقة تسمح بثلاث حالات بصرية فوق هوية واحدة، **بلا لمس أي مُحدِّد مكوّن**.
 * هذا الملف يحرس العقد الذي يجعل ذلك آمنًا:
 *
 *   ١. الخمول — لا تصريح يسري بلا [data-mood]، فالصفحة كما كانت بالبايت.
 *   ٢. الانطواء — كل تصريح داخل كتلة مزاج خاصيّةٌ مخصّصة فقط (--x: v).
 *      أي `color:` أو `padding:` داخل مزاج = انزلاق نحو تنسيق المكوّنات.
 *   ٣. العزل — لا مرجع إلى --karim-* ولا !important.
 *   ٤. التباين — كل زوج نص/سطح في كل مزاج ≥ 4.5:1، وغير النصّي ≥ 3:1.
 *      تُحسب من قيم الملف نفسه، لا من قائمةٍ منسوخة.
 *   ٥. التركيب — الورقة تُحمَّل بعد erp-identity.css وبإصدارٍ مطابق للصفحة.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const FILE = path.join(APP, 'css', 'v2', 'erp-moods.css');
const PAGE = path.join(APP, 'v2.html');
const IDENTITY = path.join(APP, 'css', 'v2', 'erp-identity.css');

const read = (p) => fs.readFileSync(p, 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

/** الكتلة التي تبدأ عند أول ظهور للمُحدِّد، مع موازنة الأقواس. */
function blockAfter(css, needle) {
    const at = css.indexOf(needle);
    if (at < 0) {throw new Error('selector not found: ' + needle);}
    const open = css.indexOf('{', at);
    let depth = 0, end = open;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') {depth++;}
        else if (css[i] === '}') {depth--; if (depth === 0) {end = i; break;}}
    }
    const prelude = css.slice(css.lastIndexOf('}', at) + 1, open).trim();
    return { prelude, body: css.slice(open + 1, end) };
}

function decls(body) {
    const out = [];
    for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
        out.push({ prop: m[1].trim(), value: m[2].trim() });
    }
    return out;
}

const hexRgb = (v) => {
    const m = String(v).match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) {return null;}
    let h = m[1];
    if (h.length === 3) {h = h.split('').map((c) => c + c).join('');}
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = (rgb) => {
    const a = rgb.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
};
const ratio = (a, b) => {
    const L1 = lum(a), L2 = lum(b);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
};

const MOODS = ['workshop', 'museum', 'copper'];

const css = strip(read(FILE));

describe('V2 moods — طبقة الأمزجة', () => {
    test('الملف موجود وغير فارغ', () => {
        expect(fs.existsSync(FILE)).toBe(true);
        expect(css.length).toBeGreaterThan(3000);
    });

    test('مُحمَّل في v2.html بعد erp-identity.css وبإصدار مطابق', () => {
        const page = read(PAGE);
        const identity = page.indexOf('erp-identity.css');
        const moods = page.indexOf('erp-moods.css');
        expect(identity).toBeGreaterThan(-1);
        expect(moods).toBeGreaterThan(identity);
        const rev = (href) => {
            const m = page.match(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?v=([0-9.]+)'));
            return m ? m[1] : null;
        };
        const a = rev('erp-identity.css');
        const b = rev('erp-moods.css');
        expect(a).toBeTruthy();
        expect(b).toBe(a);
    });

    test('الخمول: كل مُحدِّد مشروط بـ [data-mood]', () => {
        const selectors = css
            .replace(/\}/g, '}\n')
            .split('\n')
            .filter((line) => line.includes('{') && !line.trim().startsWith('@'))
            .map((line) => line.slice(0, line.indexOf('{')).trim())
            .filter(Boolean);
        expect(selectors.length).toBeGreaterThan(0);
        for (const sel of selectors) {
            for (const part of sel.split(',')) {
                const s = part.trim();
                if (!s) {continue;}
                expect(s).toMatch(/\[data-mood="/);
            }
        }
    });

    test('الانطواء: لا تصريح غير توكن داخل أي مزاج', () => {
        for (const key of MOODS) {
            const { body } = blockAfter(css, '[data-mood="' + key + '"]');
            const list = decls(body);
            expect(list.length).toBeGreaterThan(20);
            for (const d of list) {
                expect(d.prop.startsWith('--')).toBe(true);
            }
        }
    });

    test('العزل: لا --karim-* ولا !important', () => {
        expect(css).not.toMatch(/--karim-/);
        expect(css).not.toMatch(/!important/);
    });

    test('الطباعة هوية: كل تصريح مزاجٍ داخل @media screen', () => {
        /* مزاجُ «ليل نحاسي» حبرُه فاتح؛ وورقُ الطباعة أبيضُ مفروض. بلا هذا
           الحاجز قِيس في Chromium نصٌّ rgb(241,245,249) على بطاقةٍ بيضاء —
           أي ورقةٌ بيضاء. الطباعة تعود للهوية دائمًا. */
        const at = css.indexOf('@media screen');
        expect(at).toBeGreaterThan(-1);
        expect(css.slice(0, at)).not.toContain('[data-mood="');
        const open = css.indexOf('{', at);
        let depth = 0, end = -1;
        for (let i = open; i < css.length; i++) {
            if (css[i] === '{') {depth++;}
            else if (css[i] === '}') {depth--; if (depth === 0) {end = i; break;}}
        }
        expect(end).toBeGreaterThan(open);
        expect(css.slice(end + 1).replace(/\s+/g, '')).toBe('');
        for (const key of MOODS) {
            expect(css.indexOf('[data-mood="' + key + '"]')).toBeGreaterThan(at);
            expect(css.indexOf('[data-mood="' + key + '"]')).toBeLessThan(end);
        }
    });

    test('copper يعمل في الوضعين، والضوئيّان محجوبان في الداكن', () => {
        const copper = blockAfter(css, '[data-mood="copper"]').prelude;
        expect(copper).not.toMatch(/data-theme/);
        for (const key of ['workshop', 'museum']) {
            const prelude = blockAfter(css, '[data-mood="' + key + '"]').prelude;
            expect(prelude).toMatch(/html:not\(\[data-theme="dark"\]\)/);
            expect(prelude).toMatch(new RegExp('html\\[data-mood="' + key + '"\\]'));
        }
    });

    test('التباين: نصّ ≥ 4.5:1 وغير النصّ ≥ 3:1 في كل مزاج', () => {
        const pairs = [
            ['ink', 'canvas', 4.5], ['ink', 'surface', 4.5],
            ['ink-2', 'surface', 4.5], ['ink-muted', 'surface', 4.5],
            ['ink-faint', 'surface', 4.5], ['ink-faint', 'canvas', 4.5],
            ['emerald-ink', 'emerald', 4.5],
            ['emerald-text', 'surface', 4.5], ['brass-text', 'surface', 4.5],
            ['copper-text', 'surface', 4.5],
            ['success-text', 'surface', 4.5], ['warning-text', 'surface', 4.5],
            ['danger-text', 'surface', 4.5], ['info-text', 'surface', 4.5],
            ['neutral-text', 'surface', 4.5],
            ['sidebar-ink', 'sidebar', 4.5], ['sidebar-ink-2', 'sidebar', 4.5],
            ['sidebar-muted', 'sidebar', 4.5], ['sidebar-faint', 'sidebar', 4.5],
            ['sidebar-accent', 'sidebar', 4.5], ['sidebar-success', 'sidebar', 4.5],
            ['sidebar-info', 'sidebar', 4.5],
            ['sidebar-plaque-ink', 'sidebar-plaque', 4.5],
            ['forest-ink', 'forest', 4.5], ['forest-muted', 'forest', 4.5],
            ['brass', 'surface', 3.0], ['brass', 'canvas', 3.0],
        ];
        for (const key of MOODS) {
            const { body } = blockAfter(css, '[data-mood="' + key + '"]');
            const map = {};
            for (const d of decls(body)) {map[d.prop] = d.value;}
            const get = (name) => {
                const v = map['--erp-c-' + name];
                if (!v) {throw new Error(key + ': missing primitive --erp-c-' + name);}
                return v;
            };
            for (const [fg, bg, min] of pairs) {
                const a = hexRgb(get(fg)), b = hexRgb(get(bg));
                if (!a || !b) {continue;} // rgba overlays are not a text/surface pair
                const r = ratio(a, b);
                expect({ mood: key, pair: fg + '/' + bg, ratio: +r.toFixed(2), min }).toEqual(
                    expect.objectContaining({ ratio: expect.any(Number) })
                );
                if (r < min) {
                    throw new Error(key + ' ' + fg + '/' + bg + ' = ' + r.toFixed(2) + ' < ' + min);
                }
            }
        }
    });

    test('كل مزاج يعرّف البدائيات التي تستهلكها المرادفات', () => {
        // المرادفات في الهوية تُقرأ من الملف الحقيقي، لا من قائمة منسوخة.
        const id = strip(read(IDENTITY));
        const used = new Set();
        for (const m of id.matchAll(/--erp-[a-z0-9-]+\s*:\s*var\((--erp-c-[a-z0-9-]+)\)/g)) {
            used.add(m[1].replace('--erp-c-', ''));
        }
        expect(used.size).toBeGreaterThan(20);
        for (const key of MOODS) {
            const { body } = blockAfter(css, '[data-mood="' + key + '"]');
            const defined = new Set(
                decls(body).filter((d) => d.prop.startsWith('--erp-c-')).map((d) => d.prop.replace('--erp-c-', ''))
            );
            const missing = [...used].filter((n) => !defined.has(n));
            expect({ mood: key, missing }).toEqual({ mood: key, missing: [] });
        }
    });

    test('التبديل عبر الرابط: ?mood= فقط، وبلا تخزين دائم', () => {
        const boot = read(path.join(APP, 'js', 'v2', 'theme-boot.js'));
        // المصدر الوحيد للتبديل هو معامل الرابط.
        expect(boot).toMatch(/URLSearchParams\(location\.search\)\.get\('mood'\)/);
        // الأسماء الثلاثة معروفة، ولا مزاج رابع يُقبل بالخطأ.
        expect(boot).toMatch(/\['workshop', 'museum', 'copper'\]/);
        // لا كتابة في التخزين: رابط عرضٍ لا يترك ورديةً حقيقية في مزاج خاطئ.
        const moodBlock = boot.slice(boot.indexOf('MOOD BOOT'));
        expect(moodBlock).not.toMatch(/localStorage\.setItem|sessionStorage\.setItem/);
        // ولا تصريح بلا معامل: الغياب يعني صفر تغيير.
        expect(moodBlock).toMatch(/removeAttribute\('data-mood'\)/);
    });
});

/* ═══════════════════════════════════════════════════════════════════════
   المزاج على مستوى الشاشة — js/v2/mood.js + الوصل في preview.js
   ═══════════════════════════════════════════════════════════════════════ */
const vm = require('vm');
const MOOD_JS = path.join(APP, 'js', 'v2', 'mood.js');
const PREVIEW = path.join(APP, 'js', 'v2', 'preview.js');
const NAVMODEL = path.join(APP, 'js', 'v2', 'layout', 'nav-model.js');
const ROUTING = path.join(APP, 'js', 'v2', 'routing.js');

/** تحميل وحدة ESM في سياق vm — نفس طريقة tests/v2-routing.test.js. */
function loadEsm(file, names) {
    const src = read(file)
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '')
        + `\n;Object.assign(globalThis, {${names.join(', ')}});`;
    const context = {
        console, String, Number, Boolean, Array, Object, RegExp, Error,
        Set, Map, JSON, URLSearchParams,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

const moodMod = () => loadEsm(MOOD_JS, ['MOODS', 'SCREEN_MOODS', 'explicitMood', 'moodForScreen', 'applyScreenMood']);

/** عنصرٌ وهميّ بالعقد الثلاثي فقط — لا DOM كامل في اختبار وحدة. */
const fakeEl = (initial) => {
    const attrs = { ...(initial || {}) };
    return {
        attrs,
        getAttribute: (k) => (Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null),
        setAttribute: (k, v) => { attrs[k] = String(v); },
        removeAttribute: (k) => { delete attrs[k]; },
    };
};

describe('V2 moods — مزاج الشاشة (js/v2/mood.js)', () => {
    test('كل مفتاح معيَّن مسارٌ حقيقي، وكل قيمة مزاجٌ معروف', () => {
        const m = moodMod();
        const known = loadEsm(ROUTING, ['knownKeys']).knownKeys(
            loadEsm(NAVMODEL, ['readNavGroups']).readNavGroups()
        );
        const keys = Object.keys(m.SCREEN_MOODS);
        expect(keys.length).toBeGreaterThan(5);
        const unknown = keys.filter((k) => !known.has(k));
        expect({ unknown }).toEqual({ unknown: [] });
        for (const [key, mood] of Object.entries(m.SCREEN_MOODS)) {
            expect({ key, ok: m.MOODS.includes(mood) }).toEqual({ key, ok: true });
        }
        // لا شاشةَ تشغيلٍ تُعاد تلوينها: اللوحة والكاشير والمخزن تبقى الهوية.
        for (const key of ['dashboard', 'cash-register', 'cashier-sales', 'warehouse', 'kitchen', 'dispatch']) {
            expect({ key, mood: m.SCREEN_MOODS[key] || null }).toEqual({ key, mood: null });
        }
    });

    test('التعيين يضع السمة ويُنزعها — والغياب يعني الهوية', () => {
        const m = moodMod();
        const el = fakeEl();
        expect(m.applyScreenMood(el, 'reports', '')).toBe('museum');
        expect(el.getAttribute('data-mood')).toBe('museum');
        // الانتقال إلى شاشة غير معيَّنة ينزع السمة، فلا يتسرّب المزاج.
        expect(m.applyScreenMood(el, 'dashboard', '')).toBeNull();
        expect(el.getAttribute('data-mood')).toBeNull();
        // ومفتاح مجهول كذلك.
        m.applyScreenMood(el, 'reports', '');
        m.applyScreenMood(el, 'nope', '');
        expect(el.getAttribute('data-mood')).toBeNull();
    });

    test('الرابط يتفوّق على التعيين — و off يوقف التعيين أيضًا', () => {
        const m = moodMod();
        expect(m.moodForScreen('reports', '?mood=copper')).toBeNull();
        expect(m.moodForScreen('reports', '?mood=off')).toBeNull();
        expect(m.moodForScreen('reports', '?mood=neon')).toBe('museum');
        expect(m.explicitMood('?mood=off')).toBe('off');
        expect(m.explicitMood('?mood=neon')).toBeNull();
        expect(m.explicitMood('')).toBeNull();
        expect(m.explicitMood(undefined)).toBeNull();
        // ولا يمحو التعيينُ مزاجًا وضعه الرابط: التنقّل لا يلغي أمرًا بشريًا.
        const el = fakeEl({ 'data-mood': 'copper' });
        expect(m.applyScreenMood(el, 'reports', '?mood=copper')).toBeNull();
        expect(el.getAttribute('data-mood')).toBe('copper');
        const off = fakeEl();
        expect(m.applyScreenMood(off, 'reports', '?mood=off')).toBeNull();
        expect(off.getAttribute('data-mood')).toBeNull();
    });

    test('لا تخزين: المزاج حالةُ مكانٍ لا حالةُ مستخدم', () => {
        const src = strip(read(MOOD_JS));
        expect(src).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
        expect(src).not.toMatch(/\.style\.|setProperty\(/);
    });

    test('الوصل: استيرادٌ واحد واستدعاءٌ واحد داخل applyKey', () => {
        const src = strip(read(PREVIEW));
        const imports = src.match(/from '\.\/mood\.js\?v=[0-9.]+'/g) || [];
        expect(imports.length).toBe(1);
        const calls = src.match(/applyScreenMood\(/g) || [];
        expect(calls.length).toBe(1);
        const at = src.indexOf('function applyKey(key)');
        expect(at).toBeGreaterThan(-1);
        const body = src.slice(at, src.indexOf('\n}', at));
        expect(body).toMatch(/applyScreenMood\(document\.documentElement, key, window\.location\.search\)/);
    });
});
