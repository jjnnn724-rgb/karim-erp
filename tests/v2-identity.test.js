/**
 * v2-identity.test.js — عقد هوية «بورسلين ونحاس»
 * ═══════════════════════════════════════════════════════════════════════
 * الهوية طبقةُ عرضٍ أخيرة (erp-identity.css): تعيد صياغة التوكنات وحدها،
 * فلا تلمس أي ملف مكوّن. وهذا بالضبط سببُ الحاجة إلى حارسٍ آلي: الخطأ هنا
 * لا يرمي استثناءً — لونٌ يخفت درجةً فيمرّ بصريًا، أو ورقةٌ تُحمَّل قبل
 * erp-themes فتخسر الوضع الداكن، أو مُحدِّدٌ بلا `.erp-v2` فيتسرّب للقديم.
 *
 * الملف يثبّت سبعة أشياء:
 *   ١) الورقة مربوطة في الصفحتين (V2 + الكاشير) بنسخة الصفحة، وآخر الطبقات.
 *   ٢) ألوان الواجهة (theme-color) على البترول الجديد.
 *   ٣) التباين: كل درجة نصّ ≥ 4.5 على السطح والكانفس، بعد حلّ var() فعليًا
 *      من الملف نفسه — لا نسخٌ يدوي للأرقام.
 *   ٤) العمود الجانبي والعلامة والتركيز والحالات في الوضعين.
 *   ٥) الوجوه: مالكٌ واحد (erp-fonts.css) بلا local() وبلا CDN، والهوية
 *      لا تعلن @font-face ولا تُعيد وجهًا ثانيًا إلى الصفحة.
 *   ٦) العزل: كل مُحدِّدٍ تحت طبقات V2، والورقة لا تُربط في أي صفحة قديمة.
 *   ٧) الطباعة تعود ورقًا، والتوكنات التي كانت مستهلكةً بلا تعريف صار لها تعريف.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const CSS = path.join(APP, 'css', 'v2');
const read = (p) => fs.readFileSync(p, 'utf8');

const stripCssComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

function pageRevision() {
    const html = read(path.join(APP, 'v2.html'));
    const m = html.match(/js\/v2\/preview\.js\?v=([\d.]+)/);
    expect(m).not.toBeNull();
    return m[1];
}

/** [{sel, body, at[]}] — غوصٌ داخل @media بمطابقة الأقواس. */
function rules(src) {
    const text = stripCssComments(src);
    const out = [];
    const walk = (chunk, atChain) => {
        let i = 0;
        while (i < chunk.length) {
            const brace = chunk.indexOf('{', i);
            if (brace < 0) {return;}
            const head = chunk.slice(i, brace).trim().replace(/\s+/g, ' ');
            let depth = 1;
            let j = brace + 1;
            while (j < chunk.length && depth > 0) {
                if (chunk[j] === '{') {depth += 1;} else if (chunk[j] === '}') {depth -= 1; if (depth === 0) {break;}}
                j += 1;
            }
            const body = chunk.slice(brace + 1, j);
            if (head.startsWith('@font-face')) {
                out.push({ sel: head, body, at: atChain });
            } else if (head.startsWith('@')) {
                walk(body, atChain.concat(head));
            } else {
                out.push({ sel: head, body, at: atChain });
            }
            i = j + 1;
        }
    };
    walk(text, []);
    return out;
}

/** خصائص مخصّصة فقط من جسم قاعدة. */
function customProps(body) {
    const map = new Map();
    for (const decl of body.split(';')) {
        const idx = decl.indexOf(':');
        if (idx < 0) {continue;}
        const name = decl.slice(0, idx).trim();
        if (name.startsWith('--')) {map.set(name, decl.slice(idx + 1).trim());}
    }
    return map;
}

const IDENTITY_SRC = read(path.join(CSS, 'erp-identity.css'));
const ALL_RULES = rules(IDENTITY_SRC);
const TOKEN_RULES = ALL_RULES.filter((r) => /--erp-c-canvas\s*:/.test(r.body));
const LIGHT = TOKEN_RULES.find((r) => !r.sel.includes('data-theme'));
const DARK = TOKEN_RULES.find((r) => r.sel.includes('data-theme="dark"'));

/** حالات الألوان من الطبقة البدائية، مع تجاوزات الداكن. */
function palette(theme) {
    const sem = new Map([...customProps(LIGHT.body)].filter(([k]) => !k.startsWith('--erp-c-')));
    const prim = new Map([...customProps(LIGHT.body)].filter(([k]) => k.startsWith('--erp-c-')));
    if (theme === 'dark') {
        for (const [k, v] of customProps(DARK.body)) {
            prim.set(k, v);
            // إعادة إعلان الدلالات داخل كتلة الداكن تتجاوز أدبيات erp-themes.css.
            if (!k.startsWith('--erp-c-')) {sem.set(k, v);}
        }
        // تجاوزات الداكن ذات المحدِّد الأعلى (html[data-theme="dark"] .erp-v2).
        for (const r of ALL_RULES) {
            if (!r.sel.includes('data-theme="dark"')) {continue;}
            for (const [k, v] of customProps(r.body)) {sem.set(k, v);}
        }
    }
    const cache = new Map();
    const resolve = (name) => {
        if (cache.has(name)) {return cache.get(name);}
        const raw = sem.get(name) ?? prim.get(name);
        if (raw === undefined) {throw new Error(`توكن بلا تعريف: ${name}`);}
        const value = raw.replace(/var\((--[\w-]+)\)/g, (_, inner) => resolve(inner));
        cache.set(name, value);
        return value;
    };
    return resolve;
}

function rgba(value) {
    const v = value.trim();
    if (/^#[0-9a-f]{3}$/i.test(v)) {
        return [...v.slice(1)].map((c) => parseInt(c + c, 16) / 255).concat(1);
    }
    if (/^#[0-9a-f]{6}$/i.test(v)) {
        return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255).concat(1);
    }
    const m = v.match(/rgba?\(([^)]+)\)/i);
    if (m) {
        const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts[3] === undefined ? 1 : parts[3]];
    }
    throw new Error(`لون غير قابل للقراءة: ${value}`);
}

const channel = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function contrast(a, b) {
    const toRgb = (v) => (Array.isArray(v) ? v : rgba(v));
    const la = luminance(toRgb(a));
    const lb = luminance(toRgb(b));
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** مسحوق الحالة: color-mix(... N%, transparent) مركّبٌ فوق السطح. */
function softComposite(theme, status) {
    const token = palette(theme)(`--erp-${status}-soft`);
    const m = token.match(/([\d.]+)%/);
    if (!m) {throw new Error(`مسحوق بلا نسبة: ${token}`);}
    const fg = rgba(palette(theme)(`--erp-${status}`));
    const bg = rgba(palette(theme)('--erp-surface'));
    const a = Number(m[1]) / 100;
    return fg.slice(0, 3).map((c, i) => c * a + bg[i] * (1 - a)).concat(1);
}

function htmlFiles(dir) {
    const acc = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {acc.push(...htmlFiles(p));} else if (e.name.endsWith('.html')) {acc.push(p);}
    }
    return acc;
}

describe('هوية V2 — «بورسلين ونحاس»', () => {
    test('الورقة مربوطة في V2 والكاشير بنسخة الصفحة، وآخر ما يُحمَّل قبل كروم المعاينة', () => {
        const rev = pageRevision();
        const html = read(path.join(APP, 'v2.html'));
        const at = (needle) => html.indexOf(needle);
        const identity = at(`css/v2/erp-identity.css?v=${rev}`);
        expect(identity).toBeGreaterThan(at(`css/v2/erp-themes.css?v=${rev}`));
        expect(identity).toBeGreaterThan(at(`css/v2/erp-inquiry.css?v=${rev}`));
        expect(identity).toBeLessThan(at(`css/v2/erp-preview.css?v=${rev}`));

        const cashier = read(path.join(APP, 'cashier', 'index.html'));
        const cash = (needle) => cashier.indexOf(needle);
        expect(cash(`/app/css/v2/erp-identity.css?v=${rev}`)).toBeGreaterThan(cash(`/app/css/v2/erp-tokens.css?v=${rev}`));
        expect(cash(`/app/css/v2/erp-identity.css?v=${rev}`)).toBeLessThan(cash(`/app/cashier/cashier.css?v=`));
    });

    test('theme-color على البترول الجديد في الصفحتين، ومانيفست الكاشير يلبس الهوية', () => {
        expect(read(path.join(APP, 'v2.html'))).toContain('<meta name="theme-color" content="#0B5A5F">');
        expect(read(path.join(APP, 'cashier', 'index.html'))).toContain('<meta name="theme-color" content="#0B5A5F">');
        const manifest = JSON.parse(read(path.join(APP, 'cashier', 'manifest.json')));
        expect(manifest.theme_color).toBe('#0B5A5F');
        expect(manifest.background_color).toBe('#EFECE4');
    });

    test('سلّم النص الفاتح: كل درجة ≥ 4.5 على السطح والكانفس، وبترتيب لمعانٍ صارم', () => {
        const t = palette('light');
        const grades = ['primary', 'secondary', 'muted', 'faint'];
        const onSurface = grades.map((g) => contrast(t(`--erp-text-${g}`), t('--erp-surface')));
        const onCanvas = grades.map((g) => contrast(t(`--erp-text-${g}`), t('--erp-background')));
        expect({ low: onSurface.filter((r) => r < 4.5) }).toEqual({ low: [] });
        expect({ low: onCanvas.filter((r) => r < 4.5) }).toEqual({ low: [] });
        for (let i = 1; i < onSurface.length; i += 1) {
            expect(onSurface[i]).toBeLessThan(onSurface[i - 1]);
        }
        // القيم الموثّقة في رأس الملف: انزياحٌ بمقدار 0.05 يستوجب تحديثها معًا.
        expect(onSurface[0]).toBeCloseTo(17.72, 1);
        expect(onSurface[3]).toBeCloseTo(5.52, 1);
        expect(onCanvas[3]).toBeCloseTo(4.68, 1);
    });

    test('سلّم النص الداكن: كل درجة ≥ 4.5 على سطحه وكانفسه', () => {
        const t = palette('dark');
        for (const g of ['primary', 'secondary', 'muted', 'faint']) {
            expect(contrast(t(`--erp-text-${g}`), t('--erp-surface'))).toBeGreaterThanOrEqual(4.5);
            expect(contrast(t(`--erp-text-${g}`), t('--erp-background'))).toBeGreaterThanOrEqual(4.5);
        }
        const faint = contrast(t('--erp-text-faint'), t('--erp-surface'));
        expect(faint).toBeCloseTo(5.81, 1);
    });

    test('العلامة والتركيز: بترولٌ للفعل، نحاسٌ للحلقة، وحبرٌ معاكسٌ على الزر', () => {
        for (const theme of ['light', 'dark']) {
            const t = palette(theme);
            expect(contrast(t('--erp-brand-text'), t('--erp-surface'))).toBeGreaterThanOrEqual(4.5);
            expect(contrast(t('--erp-text-inverse'), t('--erp-brand'))).toBeGreaterThanOrEqual(4.5);
            // حلقة التركيز عنصرٌ غير نصي: حدّ WCAG 1.4.11 هو 3:1.
            expect(contrast(t('--erp-focus-ring'), t('--erp-surface'))).toBeGreaterThanOrEqual(3);
            expect(contrast(t('--erp-focus-ring'), t('--erp-background'))).toBeGreaterThanOrEqual(3);
        }
    });

    test('نحاس النص ≥ 4.5 في الوضعين — نحاس الزينة يبقى للعلامات لا للأرقام', () => {
        for (const theme of ['light', 'dark']) {
            const t = palette(theme);
            for (const bg of ['--erp-surface', '--erp-background']) {
                expect({ theme, bg, ok: contrast(t('--erp-dash-accent-text'), t(bg)) >= 4.5 })
                    .toEqual({ theme, bg, ok: true });
            }
            // نحاس الزينة نفسه مسموح كعلامة غير نصية (≥3:1).
            expect(contrast(t('--erp-brass'), t('--erp-surface'))).toBeGreaterThanOrEqual(3);
        }
        expect(palette('light')('--erp-dash-accent-text')).toBe('#7A5410');
    });

    test('سُلَّم الرسوم: كل درجةٍ تُرى على الورقة والكانفس (حدّ 1.4.11 = 3:1)', () => {
        for (const theme of ['light', 'dark']) {
            const t = palette(theme);
            for (let i = 1; i <= 6; i += 1) {
                for (const bg of ['--erp-surface', '--erp-background']) {
                    expect({ theme, stop: i, bg, ok: contrast(t(`--erp-chart-${i}`), t(bg)) >= 3 })
                        .toEqual({ theme, stop: i, bg, ok: true });
                }
            }
            // نحاس البيانات: لونُ الأرقام لا لونُ الفعل.
            expect(contrast(t('--erp-copper'), t('--erp-surface'))).toBeGreaterThanOrEqual(3);
        }
    });

    test('الداكن يعيد إعلان ما تتجاوزه طبقة الثيمات — وإلا عاد الحبر الأزرق القديم', () => {
        const dark = customProps(DARK.body);
        for (const name of [
            '--erp-surface-raised', '--erp-surface-sunken', '--erp-text-inverse',
            '--erp-brand-text', '--erp-success-text', '--erp-warning-text',
            '--erp-danger-text', '--erp-info-text', '--erp-neutral-text',
        ]) {
            expect({ token: name, declared: dark.has(name) }).toEqual({ token: name, declared: true });
        }
        const t = palette('dark');
        // القيم البدائية للهوية، لا أدبيات erp-themes.css.
        expect(t('--erp-brand-text')).toBe('#86D8D0');
        expect(t('--erp-surface-raised')).toBe('#14241F');
        expect(t('--erp-text-inverse')).toBe('#0C111D');
    });

    test('العمود الجانبي: العمق البترولي لا يبتلع أي درجة نص', () => {
        for (const theme of ['light', 'dark']) {
            const t = palette(theme);
            const pairs = [
                ['--erp-sidebar-ink', '--erp-sidebar-bg'],
                ['--erp-sidebar-ink-2', '--erp-sidebar-bg'],
                ['--erp-sidebar-muted', '--erp-sidebar-bg'],
                ['--erp-sidebar-faint', '--erp-sidebar-bg'],
                ['--erp-sidebar-accent', '--erp-sidebar-bg'],
                ['--erp-sidebar-accent-text', '--erp-sidebar-bg'],
            ];
            for (const [fg, bg] of pairs) {
                expect({ theme, fg, ok: contrast(t(fg), t(bg)) >= 4.5 }).toEqual({ theme, fg, ok: true });
            }
        }
    });

    test('نصوص الحالات على مسحوقها ≥ 4.5 في الوضعين — لا شارة تغرق في خلفيتها', () => {
        for (const theme of ['light', 'dark']) {
            for (const status of ['success', 'warning', 'danger', 'info', 'neutral']) {
                const fg = palette(theme)(`--erp-${status}-text`);
                const bg = softComposite(theme, status);
                expect({ theme, status, ok: contrast(fg, bg) >= 4.5 }).toEqual({ theme, status, ok: true });
            }
        }
    });

    test('الوجوه: مالكٌ واحد — الهوية لا تعلن @font-face، ووجوهها من erp-fonts.css', () => {
        const faces = ALL_RULES.filter((r) => r.sel.startsWith('@font-face'));
        expect(faces.length).toBe(0);
        // الوجهان (العرض والأرقام) يشيران إلى نفس العائلة المحلية، فلا
        // يعود انقسام الشخصية بين عنوانٍ ورقمٍ بجواره.
        const body = ALL_RULES.find((r) => r.body.includes('--erp-font-num'))?.body || '';
        expect(body).toMatch(/--erp-font-num:\s*"IBM Plex Sans Arabic"/);
        expect(body).toMatch(/--erp-font-display:\s*"IBM Plex Sans Arabic"/);
        const fontSheet = stripCssComments(read(path.join(CSS, 'erp-fonts.css')));
        expect(fontSheet).not.toMatch(/local\(/);
        expect(fontSheet).not.toMatch(/https?:/);
    });

    test('العزل: كل مُحدِّدٍ داخل طبقات V2، والورقة لا تُربط في صفحة قديمة', () => {
        const HOSTS = ['.erp-v2', '.erp-fab-host', '.erp-offline-bar', '.erp-pal-backdrop'];
        const scoped = (part) => {
            let s = part.trim().replace(/^html(?=\[)/, '');
            s = s.replace(/^\[data-theme="dark"\]\s*/, '');
            return HOSTS.some((h) => s.startsWith(h));
        };
        const unscoped = [];
        for (const r of ALL_RULES) {
            if (r.sel.startsWith('@font-face')) {continue;}
            for (const part of r.sel.split(',')) {
                if (!scoped(part)) {unscoped.push(`${r.sel} → ${part.trim()}`);}
            }
        }
        expect({ unscoped }).toEqual({ unscoped: [] });

        const linked = htmlFiles(APP)
            .filter((p) => read(p).includes('erp-identity.css'))
            .map((p) => path.relative(APP, p).replace(/\\/g, '/'))
            .sort();
        expect({ linked }).toEqual({ linked: ['cashier/index.html', 'v2.html'] });
    });

    test('الطباعة تعود ورقًا مهما كان الثيم — والورقة الأخيرة لا تبتلع قاعدة الطباعة', () => {
        const print = ALL_RULES.find((r) => r.at.some((a) => /print/i.test(a)) && r.sel === '.erp-v2');
        expect(print).toBeTruthy();
        const p = customProps(print.body);
        expect(p.get('--erp-background')).toBe('#ffffff');
        expect(p.get('--erp-surface')).toBe('#ffffff');
        expect(p.get('--erp-text-primary')).toBe('#000000');
        expect(p.get('--erp-shadow-lg')).toBe('none');
        expect(p.get('--erp-highlight')).toBe('transparent');
    });

    test('التوكنات التي كانت مستهلكةً بلا تعريف صار لها تعريفٌ صريح', () => {
        const sem = customProps(LIGHT.body);
        for (const name of ['--erp-text', '--erp-primary', '--erp-primary-soft', '--erp-surface-2', '--erp-focus-ring-width']) {
            expect({ token: name, defined: sem.has(name) }).toEqual({ token: name, defined: true });
        }
    });

    test('ألوان الرسوم في لوحة القيادة توكناتُ الهوية لا حرفية', () => {
        /* العقدُ بعد نقل الرسوم إلى محرّكٍ مشترك: لا حرفيةَ لونٍ في الشاشة
           إطلاقًا — كلُّ لونٍ يمرّ عبر var(--erp-*) فيُعاد حلُّه في الوضعين.
           ومعرّفاتُ الفواتير ('#90412') خمسةُ أرقامٍ فلا تُحسب حرفيةَ لونٍ،
           فحدُّ الفحص ستّةُ أرقامٍ فأكثر (والثمانيةُ hexٌ شفافٌ لا لونٌ). */
        const src = read(path.join(APP, 'js', 'v2', 'screens', 'dashboard.js'));
        const hexes = [...src.matchAll(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{8}\b/g)].map((m) => m[0]);
        expect({ hexes }).toEqual({ hexes: [] });
        expect(src).toContain("from '../charts.js?v=" + pageRevision() + "'");
        const engine = read(path.join(APP, 'js', 'v2', 'charts.js'));
        const palette = new Set([...engine.matchAll(/^\s{4}'?([a-z0-9-]+)'?:\s*'var\(--erp-/gm)].map((m) => m[1]));
        const tones = [...src.matchAll(/tone: '([a-z0-9-]+)'/g)].map((m) => m[1]);
        const offScale = tones.filter((t) => !palette.has(t));
        expect({ offScale }).toEqual({ offScale: [] });
        const ramp = [...stripCssComments(IDENTITY_SRC).matchAll(/--erp-chart-([1-6]):/g)];
        expect(ramp.length).toBe(12);
    });

});
