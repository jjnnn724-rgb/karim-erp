/**
 * v2-contrast.test.js — سلّم النصوص في V2: 4.5:1 على الأسطح الحقيقية (المرحلة ٤)
 * ═════════════════════════════════════════════════════════════════════════
 * القياس الميداني قبل هذا الحراس (المتصفح، الوضعان، على الصفحة الحيّة):
 *   فاتحًا — على الحاوية #ffffff: أساسي 17.75 · ثانوي 10.46 · خافت-قليل 7.69
 *   · خافت 4.97؛ وعلى خلفية الصفحة #f4f5f7: خافت 4.56 (الأدنى في الواجهة).
 *   غامقًا — على #131926: أساسي 15.26 · ثانوي 11.46 · خافت-قليل 7.07 · خافت 5.57.
 *   ومسحٌ لكل نصٍّ ظاهر (٣٠٥ عقدة في اللوحة، وهيكل ١٧ شاشة، الوضعان) = صفر
 *   إخفاق. فالسلّم الحيّ يجتاز AA ولا يُغيَّر.
 *
 * لكن القيم الاحتياطية في css/v2/erp-tokens.css كانت **درجةً أفتح** من الحيّة
 * (`--erp-text-faint: #98a2b3` = 2.6:1 على الأبيض) — وهي ما يُرسم فعلًا لو غاب
 * design-tokens.css. فطُوبقت بالحيّة، وهذا الملف يحرس الطرفين: الحيّ والاحتياطي.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const LEGACY = path.join(APP, 'css', 'design-tokens.css');
const V2 = path.join(APP, 'css', 'v2', 'erp-tokens.css');

const read = (p) => fs.readFileSync(p, 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

/** يقرأ كل `--name: value` داخل كتلة مُحدِّدة (مُحدِّدها نصّ مطابق تمامًا). */
function blockValues(css, selector) {
    const at = css.indexOf(selector);
    if (at < 0) {throw new Error(`block not found: ${selector}`);}
    const open = css.indexOf('{', at);
    let depth = 0, end = open;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') {depth++;}
        else if (css[i] === '}') {depth--; if (depth === 0) {end = i; break;}}
    }
    const map = {};
    for (const m of css.slice(open + 1, end).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
        map[m[1]] = m[2].trim();
    }
    return map;
}

const hex = (v) => {
    const m = String(v).match(/^#([0-9a-f]{6})$/i);
    if (!m) {throw new Error(`not a plain hex: ${v}`);}
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const luminance = (c) => {
    const ch = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
};
const contrast = (fg, bg) => {
    const a = luminance(hex(fg)), b = luminance(hex(bg));
    const hi = Math.max(a, b), lo = Math.min(a, b);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
};

const LEGACY_CSS = strip(read(LEGACY));
const V2_CSS = strip(read(V2));
const LIGHT = blockValues(LEGACY_CSS, ':root');
const DARK = blockValues(LEGACY_CSS, '[data-theme="dark"]');

/** السلّم كما يستهلكه V2: درجةٌ ← توكن design-tokens الذي يفوّض إليه. */
const LADDER = [
    ['primary', '--karim-text'],
    ['secondary', '--karim-text-2'],
    ['muted', '--karim-text-muted'],
    ['faint', '--karim-text-faint']
];
const SURFACES = ['--karim-surface', '--karim-bg'];

describe('V2 تباين النصوص — 4.5:1 على الأسطح الحقيقية (المرحلة ٤)', () => {

    test('كل درجةٍ في السلّم تجتاز 4.5:1 على كل سطحٍ في الوضعين', () => {
        const below = [];
        for (const [theme, palette] of [['light', LIGHT], ['dark', DARK]]) {
            for (const surface of SURFACES) {
                for (const [grade, token] of LADDER) {
                    const ratio = contrast(palette[token], palette[surface]);
                    if (ratio < 4.5) {below.push(`${theme} ${grade} on ${surface} = ${ratio}`);}
                }
            }
        }
        expect({ below }).toEqual({ below: [] });
    });

    test('الهرميّة محفوظة: الأساسي أدفأ تباينًا ثم الثانوي ثم الخافت', () => {
        const order = [];
        for (const [theme, palette] of [['light', LIGHT], ['dark', DARK]]) {
            const ratios = LADDER.map(([grade, token]) => [grade, contrast(palette[token], palette['--karim-surface'])]);
            const descending = ratios.every(([, r], i) => i === 0 || ratios[i - 1][1] > r);
            order.push({ theme, ratios: ratios.map(([g, r]) => `${g}:${r}`).join(' > '), descending });
        }
        expect(order.filter((o) => !o.descending)).toEqual([]);
    });

    test('أدنى نسبةٍ في الواجهة ≥ 4.5 (لا هامش سالب)', () => {
        const ratios = [];
        for (const palette of [LIGHT, DARK]) {
            for (const surface of SURFACES) {
                for (const [, token] of LADDER) {ratios.push(contrast(palette[token], palette[surface]));}
            }
        }
        expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
    });

    test('الاحتياطيات في erp-tokens.css ليست أفتح من الحيّة: تجتاز 4.5:1', () => {
        const below = [];
        for (const [, token] of LADDER) {
            const prop = { '--karim-text': '--erp-text-primary', '--karim-text-2': '--erp-text-secondary', '--karim-text-muted': '--erp-text-muted', '--karim-text-faint': '--erp-text-faint' }[token];
            const hit = V2_CSS.match(new RegExp(`${prop}\\s*:\\s*var\\(${token},\\s*(#[0-9a-fA-F]{6})\\)`));
            if (!hit) {below.push(`${prop}: fallback not found`); continue;}
            for (const surface of ['#ffffff', '#f4f5f7']) {
                const r = contrast(hit[1], surface);
                if (r < 4.5) {below.push(`${prop} fallback ${hit[1]} on ${surface} = ${r}`);}
            }
        }
        expect({ below }).toEqual({ below: [] });
    });

    test('V2 يفوّض إلى توكنات design-tokens لا إلى حرفيّاتٍ غير مُدقَّقة', () => {
        for (const [prop, token] of [['--erp-text-primary', '--karim-text'], ['--erp-text-secondary', '--karim-text-2'], ['--erp-text-muted', '--karim-text-muted'], ['--erp-text-faint', '--karim-text-faint']]) {
            expect(V2_CSS).toMatch(new RegExp(`${prop}\\s*:\\s*var\\(${token},`));
        }
    });
});
