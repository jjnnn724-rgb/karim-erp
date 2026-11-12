/**
 * gen-m3-palette.js — مولّد لوحة Material 3 لطبقة ألوان V2
 * ═══════════════════════════════════════════════════════════════════════
 * المالك (2026-11-02): «نظام Material Design … طبقة الألوان فقط … مظهر
 * Material كامل». هذا السكربد يبني لوحات M3 (TONAL LADDER) من بذرة
 * «زمرد كريم» #0F5B46 ويتحقق من كل عقود التباين قبل كتابة أي CSS:
 *   · الهوية: نصّ ≥4.5 على السطح والكانفس مع ترتيب لمعانٍ صارم،
 *     العلامة/التركيز/الحليّ/الرسوم/العمود/الحالات (tests/v2-identity).
 *   · الأمزجة: نفس أزواج tests/v2-moods (≥4.5 نصّ / ≥3 غير نصّي).
 * البنية ثلاثية كما في M3: طبقة بدائيات (--erp-c-*) بالتوترات فقط،
 * وطبقة دلالية (--erp-*، var() فقط) تُترك كما هي — لا مُحدِّد مكوّن يُلمس.
 *
 * الاستخدام:
 *   node scripts/gen-m3-palette.js check            # كل العقود + أرقام التثبيت
 *   node scripts/gen-m3-palette.js identity light   # كتلة بدائيات الهوية (فاتح)
 *   node scripts/gen-m3-palette.js identity dark    # كتلة بدائيات الهوية (داكن)
 *   node scripts/gen-m3-palette.js mood workshop    # كتلة مزاج
 * ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const IDENTITY = path.join(APP, 'css', 'v2', 'erp-identity.css');
const MOODS = path.join(APP, 'css', 'v2', 'erp-moods.css');

/* ─────────────────────────── color math ─────────────────────────── */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const cbrt = Math.cbrt;

function hexToRgb(hex) {
    let h = String(hex).trim().slice(1);
    if (h.length === 3) {h = h.split('').map((c) => c + c).join('');}
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function rgbToOklch([r, g, b]) {
    const R = toLinear(r / 255), G = toLinear(g / 255), B = toLinear(b / 255);
    const l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
    const m = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
    const s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;
    const l_ = cbrt(l), m_ = cbrt(m), s_ = cbrt(s);
    const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
    const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
    const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
    const C = Math.hypot(a, bb);
    let H = (Math.atan2(bb, a) * 180) / Math.PI;
    if (H < 0) {H += 360;}
    return { L, C, H };
}

function oklchToRgb({ L, C, H }) {
    const hr = (H * Math.PI) / 180;
    const a = C * Math.cos(hr), b = C * Math.sin(hr);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    return [fromLinear(R), fromLinear(G), fromLinear(B)].map((c) => clamp(c, 0, 1));
}

const inGamut = (rgb) => rgb.every((c) => c >= -0.0005 && c <= 1.0005);

/** تحويل OKLCH → hex مع تخفيض الكروم حتى يدخل المدى (تعادل HCT تقريبًا). */
function lchToHex({ L, C, H }) {
    let lo = 0, hi = C, rgb = oklchToRgb({ L, C, H });
    if (!inGamut(rgb)) {
        for (let i = 0; i < 18; i += 1) {
            const mid = (lo + hi) / 2;
            rgb = oklchToRgb({ L, C: mid, H });
            if (inGamut(rgb)) {lo = mid;} else {hi = mid;}
        }
        rgb = oklchToRgb({ L, C: lo, H });
    }
    const [r, g, b] = rgb.map((c) => Math.round(clamp(c, 0, 1) * 255));
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** كروم المنحنى: ذروة عند التوتر 45، ينعدم عند 0 و100 (سلوك M3). */
const chromaAt = (cMax, tone) => {
    const t = clamp(tone, 0, 100) / 100;
    const peak = 0.45;
    const f = t <= peak ? Math.pow(t / peak, 0.75) : Math.pow((1 - t) / (1 - peak), 0.7);
    return cMax * f;
};

/** درجة (tone ≈ HCT L*) على سُلَّم العائلة اللونية.
    L* → OKLab: L = (L* + 16) / 116 لأن OKLab L ≈ ∛Y — تحويل L* ÷ 100 كان
    يجعل كل درجة أشدّ قتامةً ممّا يُقصَد (tone 18 كان يخرج ~#0F0F0F). */
const tone = (fam, t, over) => lchToHex({ L: (clamp(t, 0, 100) + 16) / 116, C: chromaAt(fam.C, t) + (over || 0), H: fam.H });

const family = (seedHex, C) => {
    const { C: c, H } = rgbToOklch(hexToRgb(seedHex));
    return { H, C: C === undefined ? c : C, seed: seedHex };
};

/* ─────────────────────── عائلات الأدوار (M3) ─────────────────────── */
/* البذرة زمرد كريم #0F5B46. الأدوار مفصولة تفكيكيًا حتى لا تتداخل:
   primary زمرد (الفعل) · tertiary/الحليّ سماوي بارد (لا دفء نحاسي —
   قرار المالك 2026-11-01 محفوظ) · copper أزرق البيانات · success أخضر
   عُشبي أصفَر من الزمرد · warning كهرماني · danger قرمزي · info نيلي. */
const SEED = '#0F5B46';

const PALETTES = {
    'identity-light': {
        neutral: { H: 168, C: 0.010 },          // محايد مائل لبذرة الزمرد (Material You)
        neutralVariant: { H: 168, C: 0.016 },
        brand: family(SEED, 0.105),
        jewel: family('#12808F', 0.085),        // الحليّ: سماوي بارد — منفصل عن الفعل
        data: family('#1F6E8C', 0.085),         // صوت البيانات (نحاس الأزرق)
        success: family('#0B7A46', 0.125),
        warning: family('#A86411', 0.135),
        danger: family('#B42318', 0.150),
        info: family('#2E5CC8', 0.115),
        sidebar: { H: 166, C: 0.030 },          // عمود ليلي زمردي (في الوضعين)
        paper: family('#F6F1E6', 0.012),        // ورق العاج للوحات
    },
    'identity-dark': {
        neutral: { H: 168, C: 0.012 },
        neutralVariant: { H: 168, C: 0.018 },
        brand: family(SEED, 0.105),
        jewel: family('#12808F', 0.085),
        data: family('#4FB3D1', 0.095),
        success: family('#3FBF87', 0.115),
        warning: family('#E0952F', 0.130),
        danger: family('#F18B7B', 0.135),
        info: family('#7C9BF0', 0.115),
        sidebar: { H: 166, C: 0.035 },
        paper: family('#F6F1E6', 0.012),
    },
    /* الأمزجة: محايدٌ مختلف لكل مزاج، والعلامة/الحالة كما في الهوية. */
    'mood-workshop': {
        neutral: { H: 232, C: 0.010 }, neutralVariant: { H: 232, C: 0.016 },
        brand: family(SEED, 0.105), jewel: family('#12808F', 0.085), data: family('#1F6E8C', 0.085),
        success: family('#0B7A4B', 0.125), warning: family('#B54708', 0.140),
        danger: family('#B42318', 0.150), info: family('#175CD3', 0.125),
        sidebar: { H: 230, C: 0.030 }, paper: family('#F1F5F9', 0.010),
    },
    'mood-museum': {
        neutral: { H: 78, C: 0.012 }, neutralVariant: { H: 78, C: 0.018 },
        brand: family(SEED, 0.105), jewel: family('#12808F', 0.085), data: family('#1F6E8C', 0.085),
        success: family('#0F7A46', 0.125), warning: family('#A86411', 0.135),
        danger: family('#B03428', 0.150), info: family('#2E5CC8', 0.115),
        sidebar: { H: 150, C: 0.035 }, paper: family('#FAF7F0', 0.012),
    },
    'mood-copper': {
        neutral: { H: 55, C: 0.013 }, neutralVariant: { H: 40, C: 0.020 },
        brand: family(SEED, 0.105), jewel: family('#12808F', 0.085), data: family('#1F6E8C', 0.085),
        success: family('#0F7A46', 0.125), warning: family('#A86411', 0.135),
        danger: family('#B42318', 0.150), info: family('#2E5CC8', 0.115),
        sidebar: { H: 40, C: 0.045 }, paper: family('#F6F1E6', 0.012),
    },
};

/* ───────────────── تخصيص البدائيات (اسم → عائلة/توتر) ───────────────── */
/* نفس أسماء الملفات حرفيًا — لا اسم جديد، لا مُحدِّد مكوّن. */
function assignLight(p) {
    const N = (t) => tone(p.neutral, t);
    const NV = (t) => tone(p.neutralVariant, t);
    return {
        '--erp-c-canvas': N(97), '--erp-c-surface': N(99), '--erp-c-raised': '#FFFFFF',
        '--erp-c-sunken': N(94), '--erp-c-hover': N(96), '--erp-c-active': N(92),
        '--erp-c-line': NV(90), '--erp-c-line-strong': NV(76),

        '--erp-c-ink': N(14), '--erp-c-ink-2': N(26), '--erp-c-ink-muted': N(38), '--erp-c-ink-faint': N(46),

        '--erp-c-emerald': SEED, '--erp-c-emerald-hover': tone(p.brand, 34),
        '--erp-c-emerald-active': tone(p.brand, 28), '--erp-c-emerald-text': tone(p.brand, 36),
        '--erp-c-emerald-ink': tone(p.paper, 98),

        '--erp-c-brass': tone(p.jewel, 42), '--erp-c-brass-text': tone(p.jewel, 30),
        '--erp-c-brass-bright': tone(p.jewel, 76),
        '--erp-c-brass-soft': `rgba(${hexToRgb(tone(p.jewel, 42)).join(', ')}, .10)`,
        '--erp-c-brass-line': `rgba(${hexToRgb(tone(p.jewel, 42)).join(', ')}, .30)`,
        '--erp-c-plaque-line': `rgba(${hexToRgb(tone(p.jewel, 76)).join(', ')}, .45)`,
        '--erp-c-plaque-accent': tone(p.jewel, 26),

        '--erp-c-copper': tone(p.data, 44), '--erp-c-copper-text': tone(p.data, 36),

        '--erp-c-success': tone(p.success, 42), '--erp-c-success-text': tone(p.success, 32),
        '--erp-c-warning': tone(p.warning, 44), '--erp-c-warning-text': tone(p.warning, 34),
        '--erp-c-danger': tone(p.danger, 44), '--erp-c-danger-text': tone(p.danger, 34),
        '--erp-c-info': tone(p.info, 44), '--erp-c-info-text': tone(p.info, 34),
        '--erp-c-neutral': tone(p.neutralVariant, 44), '--erp-c-neutral-text': tone(p.neutralVariant, 36),

        '--erp-c-inverse': '#FFFFFF',
        '--erp-c-highlight': 'rgba(255, 255, 255, .78)',
        '--erp-c-brand-shadow': `rgba(${hexToRgb(N(14)).join(', ')}, .22)`,

        '--erp-c-sidebar': tone(p.sidebar, 18),
        '--erp-c-sidebar-line': `rgba(244, 239, 226, .10)`,
        '--erp-c-sidebar-line-2': `rgba(244, 239, 226, .20)`,
        '--erp-c-sidebar-ink': tone(p.paper, 96),
        '--erp-c-sidebar-ink-2': tone(p.paper, 86),
        '--erp-c-sidebar-muted': tone(p.paper, 74),
        '--erp-c-sidebar-faint': tone(p.paper, 66),
        '--erp-c-sidebar-hover': 'rgba(244, 239, 226, .07)',
        '--erp-c-sidebar-active': `rgba(${hexToRgb(tone(p.jewel, 76)).join(', ')}, .12)`,
        '--erp-c-sidebar-accent': tone(p.jewel, 76),
        '--erp-c-sidebar-paper': tone(p.jewel, 88),
        '--erp-c-sidebar-wash': `rgba(${hexToRgb(tone(p.jewel, 76)).join(', ')}, .12)`,
        '--erp-c-sidebar-success': tone(p.success, 76),
        '--erp-c-sidebar-info': tone(p.info, 78),
        '--erp-c-sidebar-plaque': tone(p.paper, 97),
        '--erp-c-sidebar-plaque-ink': N(14),

        '--erp-c-forest': tone(p.sidebar, 20), '--erp-c-forest-raised': tone(p.sidebar, 26),
        '--erp-c-forest-ink': tone(p.paper, 94), '--erp-c-forest-muted': tone(p.paper, 72),
    };
}

function assignDark(p) {
    const N = (t) => tone(p.neutral, t);
    const NV = (t) => tone(p.neutralVariant, t);
    return {
        '--erp-c-canvas': N(8), '--erp-c-surface': N(13), '--erp-c-raised': N(18),
        '--erp-c-sunken': N(6), '--erp-c-hover': N(17), '--erp-c-active': N(22),
        '--erp-c-line': NV(26), '--erp-c-line-strong': NV(40),

        '--erp-c-ink': N(92), '--erp-c-ink-2': N(82), '--erp-c-ink-muted': N(70), '--erp-c-ink-faint': N(64),

        '--erp-c-emerald': tone(p.brand, 74), '--erp-c-emerald-hover': tone(p.brand, 80),
        '--erp-c-emerald-active': tone(p.brand, 86), '--erp-c-emerald-text': tone(p.brand, 76),
        '--erp-c-emerald-ink': N(10),

        '--erp-c-brass': tone(p.jewel, 74), '--erp-c-brass-text': tone(p.jewel, 80),
        '--erp-c-brass-bright': tone(p.jewel, 80),
        '--erp-c-brass-soft': `rgba(${hexToRgb(tone(p.jewel, 74)).join(', ')}, .14)`,
        '--erp-c-brass-line': `rgba(${hexToRgb(tone(p.jewel, 74)).join(', ')}, .34)`,
        '--erp-c-plaque-line': `rgba(${hexToRgb(tone(p.jewel, 80)).join(', ')}, .45)`,
        '--erp-c-plaque-accent': tone(p.jewel, 84),

        '--erp-c-copper': tone(p.data, 76), '--erp-c-copper-text': tone(p.data, 80),

        '--erp-c-success': tone(p.success, 72), '--erp-c-success-text': tone(p.success, 76),
        '--erp-c-warning': tone(p.warning, 74), '--erp-c-warning-text': tone(p.warning, 78),
        '--erp-c-danger': tone(p.danger, 74), '--erp-c-danger-text': tone(p.danger, 78),
        '--erp-c-info': tone(p.info, 76), '--erp-c-info-text': tone(p.info, 80),
        '--erp-c-neutral': tone(p.neutralVariant, 72), '--erp-c-neutral-text': tone(p.neutralVariant, 78),

        '--erp-c-inverse': '#0A1A14',
        '--erp-c-highlight': 'rgba(255, 255, 255, .16)',
        '--erp-c-brand-shadow': 'rgba(0, 0, 0, .45)',

        '--erp-c-sidebar': tone(p.sidebar, 14),
        '--erp-c-sidebar-line': 'rgba(244, 239, 226, .10)',
        '--erp-c-sidebar-line-2': 'rgba(244, 239, 226, .20)',
        '--erp-c-sidebar-ink': tone(p.paper, 96),
        '--erp-c-sidebar-ink-2': tone(p.paper, 86),
        '--erp-c-sidebar-muted': tone(p.paper, 74),
        '--erp-c-sidebar-faint': tone(p.paper, 66),
        '--erp-c-sidebar-hover': 'rgba(244, 239, 226, .07)',
        '--erp-c-sidebar-active': `rgba(${hexToRgb(tone(p.jewel, 80)).join(', ')}, .14)`,
        '--erp-c-sidebar-accent': tone(p.jewel, 80),
        '--erp-c-sidebar-paper': tone(p.jewel, 88),
        '--erp-c-sidebar-wash': `rgba(${hexToRgb(tone(p.jewel, 80)).join(', ')}, .14)`,
        '--erp-c-sidebar-success': tone(p.success, 76),
        '--erp-c-sidebar-info': tone(p.info, 78),
        '--erp-c-sidebar-plaque': tone(p.paper, 97),
        '--erp-c-sidebar-plaque-ink': N(14),

        '--erp-c-forest': tone(p.sidebar, 16), '--erp-c-forest-raised': tone(p.sidebar, 24),
        '--erp-c-forest-ink': tone(p.paper, 94), '--erp-c-forest-muted': tone(p.paper, 72),
    };
}

/* ─────────────────────────── قراءة الملفات ─────────────────────────── */
function blockAfter(css, needle) {
    const at = css.indexOf(needle);
    if (at < 0) {throw new Error('selector not found: ' + needle);}
    const open = css.indexOf('{', at);
    let depth = 0, end = open;
    for (let i = open; i < css.length; i += 1) {
        if (css[i] === '{') {depth += 1;}
        else if (css[i] === '}') {depth -= 1; if (depth === 0) {end = i; break;}}
    }
    return { start: open + 1, end, body: css.slice(open + 1, end) };
}
function declNames(body) {
    const out = [];
    for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:/g)) {out.push(m[1]);}
    return out;
}

/* ─────────────────────── حساب التباين (نفس الاختبارات) ─────────────────────── */
const channel = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = (rgb) => {
    const a = rgb.map((v) => channel(v / 255));
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
};
const contrast = (a, b) => {
    const la = lum(hexToRgb(a)), lb = lum(hexToRgb(b));
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
/** مسحوق الحالة: color-mix N% فوق السطح (نفس softComposite في الاختبار). */
function composite(fg, bg, pct) {
    const f = hexToRgb(fg), b = hexToRgb(bg), a = pct / 100;
    return '#' + f.map((c, i) => Math.round(c * a + b[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
}
const SOFT = { success: 14, warning: 16, danger: 14, info: 14, neutral: 14 };

function checkLabel(failures, label, ok, detail) {
    if (!ok) {failures.push(`${label}${detail ? ' — ' + detail : ''}`);}
}

/** عقود الهوية (نفس أزواج v2-identity.test.js). */
function identityContracts(theme, map, failures) {
    const g = (n) => {
        const v = map[n];
        if (!v) {failures.push(`${theme}: توكن مفقود ${n}`); return '#000000';}
        return v;
    };
    const surface = g('--erp-c-surface'), canvas = g('--erp-c-canvas');
    const grades = ['--erp-c-ink', '--erp-c-ink-2', '--erp-c-ink-muted', '--erp-c-ink-faint'];
    const ratios = grades.map((n) => contrast(g(n), surface));
    const onCanvas = grades.map((n) => contrast(g(n), canvas));
    checkLabel(failures, `${theme} نصّ/سطح ≥4.5`, ratios.every((r) => r >= 4.5), ratios.map((r) => r.toFixed(2)).join(','));
    checkLabel(failures, `${theme} نصّ/كانفس ≥4.5`, onCanvas.every((r) => r >= 4.5), onCanvas.map((r) => r.toFixed(2)).join(','));
    checkLabel(failures, `${theme} ترتيب لمعانٍ صارم`, ratios.every((r, i) => i === 0 || r < ratios[i - 1]));
    checkLabel(failures, `${theme} العلامة ≥4.5`, contrast(g('--erp-c-emerald-text'), surface) >= 4.5);
    checkLabel(failures, `${theme} حبر الزرّ ≥4.5`, contrast(g('--erp-c-emerald-ink'), g('--erp-c-emerald')) >= 4.5);
    checkLabel(failures, `${theme} التركيز ≥3 (سطح)`, contrast(g('--erp-c-brass'), surface) >= 3);
    checkLabel(failures, `${theme} التركيز ≥3 (كانفس)`, contrast(g('--erp-c-brass'), canvas) >= 3);
    checkLabel(failures, `${theme} حليّ نصّي ≥4.5 (سطح)`, contrast(g('--erp-c-brass-text'), surface) >= 4.5);
    checkLabel(failures, `${theme} حليّ نصّي ≥4.5 (كانفس)`, contrast(g('--erp-c-brass-text'), canvas) >= 4.5);
    for (let i = 1; i <= 6; i += 1) {
        const n = `--erp-chart-${i}`;
        const v = i === 2 ? g('--erp-c-copper') : g(n) || g('--erp-c-copper');
        if (map[n]) {
            checkLabel(failures, `${theme} chart-${i} ≥3 (سطح)`, contrast(v, surface) >= 3);
            checkLabel(failures, `${theme} chart-${i} ≥3 (كانفس)`, contrast(v, canvas) >= 3);
        }
    }
    checkLabel(failures, `${theme} copper ≥3`, contrast(g('--erp-c-copper'), surface) >= 3);
    for (const [fg, bg] of [
        ['--erp-c-sidebar-ink', '--erp-c-sidebar'], ['--erp-c-sidebar-ink-2', '--erp-c-sidebar'],
        ['--erp-c-sidebar-muted', '--erp-c-sidebar'], ['--erp-c-sidebar-faint', '--erp-c-sidebar'],
        ['--erp-c-sidebar-accent', '--erp-c-sidebar'], ['--erp-c-sidebar-paper', '--erp-c-sidebar'],
    ]) {
        checkLabel(failures, `${theme} ${fg.replace('--erp-c-', '')} ≥4.5`, contrast(g(fg), g(bg)) >= 4.5);
    }
    for (const st of ['success', 'warning', 'danger', 'info', 'neutral']) {
        const bg = composite(g(`--erp-c-${st}`), surface, SOFT[st]);
        checkLabel(failures, `${theme} ${st}-text ≥4.5 على مسحوقه`, contrast(g(`--erp-c-${st}-text`), bg) >= 4.5);
    }
    return { ratios, onCanvas };
}

/** عقود الأمزجة (نفس أزواج v2-moods.test.js). */
const MOOD_PAIRS = [
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
function moodContracts(map, failures, label) {
    const g = (n) => map[`--erp-c-${n}`];
    for (const [fg, bg, min] of MOOD_PAIRS) {
        const a = g(fg), b = g(bg);
        if (!a || !b) {continue;} // القيم الـrgba تتجاوز فحص الأزواج
        if (/^rgba/i.test(a) || /^rgba/i.test(b)) {continue;}
        const r = contrast(a, b);
        checkLabel(failures, `${label} ${fg}/${bg} ≥${min}`, r >= min, r.toFixed(2));
    }
}

/* ─────────────────────────── الواجهة ─────────────────────────── */
function buildLight() {return assignLight(PALETTES['identity-light']);}
function buildDark() {return assignDark(PALETTES['identity-dark']);}
function buildMood(key) {
    const p = PALETTES['mood-' + key];
    const base = key === 'copper' ? assignLight(p) : assignLight(p);
    // الأمزجة الافتتاحية تُبنى من نفس سُلَّم الهوية بمُحايد مختلف —
    // الهوية الداكنة لا تُطبَّق على مزاج (workshop/museum محجوبان في الداكن).
    return base;
}

function emit(map, names) {
    const width = Math.max(...names.map((n) => n.length));
    return names.map((n) => {
        const v = map[n];
        if (v === undefined) {throw new Error('لم يُولَّد: ' + n);}
        return `  ${n.padEnd(width)}: ${v};`;
    }).join('\n');
}

function main() {
    const cmd = process.argv[2] || 'check';
    const idSrc = fs.readFileSync(IDENTITY, 'utf8');
    const moodSrc = fs.readFileSync(MOODS, 'utf8');
    const lightBlock = blockAfter(idSrc, '.erp-v2,\n.erp-fab-host');
    const darkBlock = blockAfter(idSrc, '[data-theme="dark"] .erp-v2');
    const lightNames = declNames(lightBlock.body).filter((n) => n.startsWith('--erp-c-'));
    const darkNames = declNames(darkBlock.body).filter((n) => n.startsWith('--erp-c-'));

    const failures = [];
    const light = buildLight(), dark = buildDark();
    /* سُلَّم الرسوم يبقى على توكناته الدلالية كما في الملف (12 ظهورًا
       مثبَّتًا في الاختبار) — نقرؤه من الملف ونحلّ var() فيه فنفحصه على
       أسطحنا الجديدة. */
    const charts = (body) => Object.fromEntries(
        [...body.matchAll(/(--erp-chart-[1-6])\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])
    );
    const resolveVar = (map) => {
        for (const [k, v] of Object.entries(map)) {
            const m = v.match(/^var\((--[\w-]+)\)$/);
            if (m && map[m[1]]) {map[k] = map[m[1]];}
        }
    };
    Object.assign(light, charts(lightBlock.body)); resolveVar(light);
    Object.assign(dark, charts(darkBlock.body)); resolveVar(dark);
    identityContracts('light', light, failures);
    identityContracts('dark', dark, failures);

    const moodMaps = {};
    for (const key of ['workshop', 'museum', 'copper']) {
        const b = blockAfter(moodSrc, `[data-mood="${key}"]`);
        const names = declNames(b.body).filter((n) => n.startsWith('--erp-c-'));
        const map = buildMood(key);
        moodMaps[key] = { map, names };
        moodContracts(map, failures, key);
        const missing = names.filter((n) => map[n] === undefined);
        if (missing.length) {failures.push(`${key}: أسماء في الملف بلا توليد — ${missing.join(', ')}`);}
    }

    if (cmd === 'check') {
        console.log('── أرقام التثبيت الجديدة (لتحديث الاختبار) ──');
        console.log(`light primary  = ${contrast(light['--erp-c-ink'], light['--erp-c-surface']).toFixed(2)}`);
        console.log(`light faint/surface = ${contrast(light['--erp-c-ink-faint'], light['--erp-c-surface']).toFixed(2)}`);
        console.log(`light faint/canvas  = ${contrast(light['--erp-c-ink-faint'], light['--erp-c-canvas']).toFixed(2)}`);
        console.log(`dark faint/surface  = ${contrast(dark['--erp-c-ink-faint'], dark['--erp-c-surface']).toFixed(2)}`);
        console.log(`dark brand-text = ${dark['--erp-c-emerald-text']}`);
        console.log(`dark raised = ${dark['--erp-c-raised']} · dark inverse = ${dark['--erp-c-inverse']}`);
        console.log(`light brass = ${light['--erp-c-brass']} · light brass-text = ${light['--erp-c-brass-text']}`);
        console.log(`dark brass-text = ${dark['--erp-c-brass-text']}`);
        console.log(`light surfaces: canvas ${light['--erp-c-canvas']} · surface ${light['--erp-c-surface']} · line ${light['--erp-c-line']}`);
        console.log(`\n── عقود التباين: ${failures.length === 0 ? 'كلها مقبولة ✓' : failures.length + ' مخالفة'} ──`);
        failures.forEach((f) => console.log('  ✗ ' + f));
        process.exit(failures.length ? 1 : 0);
    }
    if (cmd === 'identity' && process.argv[3] === 'light') {console.log(emit(light, lightNames)); return;}
    if (cmd === 'identity' && process.argv[3] === 'dark') {console.log(emit(dark, darkNames)); return;}
    if (cmd === 'mood') {
        const key = process.argv[3];
        const { map, names } = moodMaps[key];
        console.log(emit(map, names));
        return;
    }
    console.log('الأوامر: check | identity light|dark | mood workshop|museum|copper');
}

main();