/**
 * V2 — Charts · رسوم SVG بلا مكتبة خارجية
 * ═══════════════════════════════════════════════════════════════════════
 * WHY NOT CHART.JS
 *   The legacy screens load a chart library (nine Chart.js instances). V2
 *   ships no third-party runtime: writing SVG here keeps CSP `script-src
 *   'self'` untouched, adds no vendor file to precache, and keeps every
 *   colour a `--erp-*` token so dark mode re-resolves without a redraw.
 *
 * CONTRACT
 *   Pure string builders — no DOM, no network, no timers. Screens pass the
 *   already-fetched numbers and a `formatValue` callback for the accessible
 *   titles; this module never computes business values and never formats
 *   money on its own (the repo layer owns the currency).
 *   Every mark carries a <title> so hover/touch exposes the same number the
 *   axis implies; each figure has role="img" + Arabic aria-label.
 *
 * STUDIO GRADE (2026-10-22)
 *   • تدرّجٌ رأسي من لون التوكن: العلامة تعترض الضوء بدل أن تجلس مسطّحة.
 *   • سلّمٌ متقطّع للمدى + خطُّ صفرٍ متّصل: العين تحتاج خطًّا واحدًا تثق به.
 *   • عددُ الفواصل يختار ما تكون فيه الخطوةُ رقمًا صحيحًا (٥ بدل ١٢٫٥).
 *   • سقفُ المحور قابلٌ للتثبيت (max): الشاشة التي تعرف مداها تأخذ
 *     المساحةَ كلَّها بدل أن تترك نصفَ اللوحةِ فراغًا.
 *   • أرقامٌ على العلامات حين تسع (سلسلةٌ واحدة) وآخر نقطة كل خطّ: الرقم
 *     الذي جئت لأجله، بلا حشدٍ فوق كل عمود.
 *   • شرائح الدائري تحمل فجوةً فلا يتلامس جاران، ومفتاحُها يذكر المبلغَ
 *     لا النسبةَ وحدها.
 *   • كل علامة تكشف data-v2-chart-mark{-label,-series,-value}، فتُبنى
 *     التلميحات ومؤشّر لوحة المفاتيح في طبقة التفاعل (charts-live.js)
 *     بلا قراءةٍ لهندسة SVG.
 *   • ملاحظةٌ اختياريةٌ لكل علامة (notes) — «٥٩ فاتورة» مثلًا — تسير معها
 *     إلى التلميح وإلى النطق، فلا تضيع معلومةٌ كانت في title قديم.
 *   • تسمياتُ المحور لا تتداخل: الخطوةُ تتبع أعرضُ تسميةٍ لا عددَها فقط.
 *
 * RTL (2026-10-22)
 *   صفحةُ V2 عربيةٌ واحدة (dir="rtl")، فمحورُ الفئاتِ يسيرُ من اليمين
 *   إلى اليسار: أولُ يومٍ على اليمين وآخرُ يومٍ على اليسار، كما تُقرأ
 *   اللوحاتُ العربية. أرقامُ المحورِ العموديِّ تبقى على اليمين (بدايةُ
 *   السطر) فتُقرأ العينُ القيمَ من هناك، فلا يبقى الرسمُ نصفَ عربيٍّ
 *   ونصفَ غربيّ. ولوحةُ المفاتيحِ تتبع الاتجاه، فالسهمُ الأيسرُ في
 *   صفحةٍ عربيةٍ يقدّمُ النقلةَ التالية — وهذا ما يقوله السهم.
 *
 * HONESTY
 *   No data (or all-zero) renders a stated empty line, never a flat chart
 *   that looks like "zero everywhere".
 */

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Colour tones map to the same semantic tokens the rest of V2 uses. */
const TONES = {
    brand: 'var(--erp-brand)',
    success: 'var(--erp-success)',
    danger: 'var(--erp-danger)',
    warning: 'var(--erp-warning)',
    info: 'var(--erp-info)',
    neutral: 'var(--erp-neutral)',
    copper: 'var(--erp-copper)',
    'chart-1': 'var(--erp-chart-1)',
    'chart-2': 'var(--erp-chart-2)',
    'chart-3': 'var(--erp-chart-3)',
    'chart-4': 'var(--erp-chart-4)',
    'chart-5': 'var(--erp-chart-5)',
    'chart-6': 'var(--erp-chart-6)',
};

export const CHART_TONES = Object.keys(TONES);

const toneColor = (tone) => TONES[tone] || TONES.brand;

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** معرّفٌ حتميٌّ من المحتوى: نفس البيانات ⇒ نفس المعرّف، فلا تتضارب الدروع. */
const hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
};

/** 440×240 canvas in a responsive viewBox — CSS scales the rendered width.
 *  Kept compact so axis text stays in double digits at card widths; the CSS
 *  raises the unit size in narrow containers (see @container tiers). */
const W = 440;
const H = 240;
const PAD = { top: 14, end: 56, bottom: 32, start: 12 };
const PLOT_W = W - PAD.start - PAD.end;

/* محورُ الفئاتِ يسيرُ مع اتجاهِ القراءة: في صفحةٍ عربيةٍ تبدأُ الفئةُ
   الأولى من اليمين. المحركُ لا يقرأ DOM (عقدُه: بناةُ نصوصٍ خالصة)،
   فالاتجاهُ قرارُ المنتج: V2 صفحةٌ عربيةٌ واحدة. */
const RTL = true;

/**
 * Rounds an axis maximum up to a readable 1/2/5 × 10^n step.
 * Exported for the guard: a malformed series must never produce NaN ticks.
 * @param {number} max
 * @returns {number}
 */
export function axisMax(max) {
    const v = num(max);
    if (!(v > 0)) {return 1;}
    const exp = 10 ** Math.floor(Math.log10(v));
    const f = v / exp;
    const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nice * exp;
}

const tickLabel = (v) => new Intl.NumberFormat('en-US', {
    notation: 'compact', maximumFractionDigits: 1,
}).format(num(v));

/** تدرّجٌ رأسي: أعلى العلامة أدفأ وأدناها أخفت — الضوء من أعلى اللوحة. */
const fillGradient = (id, color, top = .95, bottom = .5) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" style="stop-color:${color};stop-opacity:${top}"/>`
    + `<stop offset="1" style="stop-color:${color};stop-opacity:${bottom}"/></linearGradient>`;

/** تدرّجٌ للّون تحت الخطّ: ذروةٌ عند الخطّ وذهابٌ إلى الصفر عند القاعدة. */
const areaGradient = (id, color) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" style="stop-color:${color};stop-opacity:.26"/>`
    + `<stop offset="1" style="stop-color:${color};stop-opacity:0"/></linearGradient>`;

const seriesGradientId = (s) => `erp-g-${hash(`${s.label}|${s.tone || 'brand'}`)}`;

/** الأرقامُ التي تثق بها العين على سلّمِ محور: ١ و١٫٥ و٢ و٢٫٥ و٥ — بأي قوةِ عشرة. */
const NICE_STEPS = [1, 1.5, 2, 2.5, 5];

/** أصغرُ خطوةٍ من NICE_STEPS لا تقلّ عن x. */
function niceStepAtLeast(x) {
    const v = num(x);
    if (!(v > 0)) {return 1;}
    const exp = 10 ** Math.floor(Math.log10(v));
    for (const scale of [exp / 10, exp, exp * 10]) {
        for (const m of NICE_STEPS) {
            const step = m * scale;
            if (step >= v * (1 - 1e-9)) {return step;}
        }
    }
    return exp * 10;
}

/**
 * سلّمُ محورٍ يعرفه صاحبُ الشاشة: أقربُ حدٍّ فوق القيمة بخطوةٍ مريحة، وعددُ
 * فواصلٍ يجعلها أرقامًا مقروءة. يُرجع السقفَ وعددَ الفواصل معًا لأنهما
 * يتّفقان: سقفٌ بسُلّمٍ آخر لا يخطئ في الرسم بل يكسر الخطوة.
 * @param {number} max
 * @returns {{max:number, div:number}}
 */
export function niceScale(max) {
    const v = num(max);
    if (!(v > 0)) {return {max: 1, div: 5};}
    let best = null;
    for (const div of [4, 5, 6]) {
        const step = niceStepAtLeast(v / div);
        /* twelve significant digits — نتفادى ضجيجِ الفاصلةِ العائمة في السقف. */
        const ceiling = Number((step * div).toPrecision(12));
        if (!best) {best = {max: ceiling, div}; continue;}
        const gap = ceiling - best.max;
        /* سقفٌ أدنى يملأ اللوحة؛ وعند التساوي يُختار السلمُ الأدقّ. */
        if (gap < -best.max * 1e-9 || (Math.abs(gap) <= best.max * 1e-9 && div > best.div)) {
            best = {max: ceiling, div};
        }
    }
    return best;
}

/**
 * سقفُ محورٍ يعرفه صاحبُ الشاشة: أقربُ حدٍّ فوق القيمة بخطوةٍ مريحة.
 * يُستعمل حين تعرف الشاشةُ مداها بنفسها، فلا يبقى نصفُ اللوحة فراغًا.
 * @param {number} max
 * @returns {number}
 */
export function niceCeiling(max) {
    return niceScale(max).max;
}

/** عددُ الفواصل الذي يجعل الخطوةَ رقمًا مقبولًا — نفسُ قاعدة niceScale:
 *  السقفُ المضبوطُ يجب أن يُقسَم بالعددِ نفسِه، وإلا كسرت الخطوةُ السلم. */
function divisionsFor(max) {
    const v = num(max);
    for (const div of [6, 5, 4]) {
        const step = niceStepAtLeast(v / div);
        if (Math.abs(step * div - v) <= v * 1e-9) {return div;}
    }
    for (const div of [4, 5, 6]) {
        const step = niceStepAtLeast(v / div);
        if (Math.abs(step - v / div) <= (v / div) * 1e-9) {return div;}
    }
    return 5;
}

function gridAndAxis(max, pad, plotH) {
    const out = [];
    const div = divisionsFor(max);
    for (let k = 0; k <= div; k += 1) {
        const y = pad.top + plotH - (k / div) * plotH;
        const value = (max * k) / div;
        const cls = k === 0 ? 'erp-chart__axis' : 'erp-chart__grid';
        out.push(`<line x1="${PAD.start}" y1="${y.toFixed(2)}" x2="${W - PAD.end}" y2="${y.toFixed(2)}" class="${cls}"/>`);
        out.push(`<text x="${W - 6}" y="${y.toFixed(2)}" text-anchor="end" dominant-baseline="middle"`
            + ` class="erp-chart__tick${k === div ? ' erp-chart__tick--max' : ''}">${esc(tickLabel(value))}</text>`);
    }
    return out.join('');
}

/** عرضُ التسمية العربية ≈ ٠٫٤٨ من حجم الخطّ للوحدة — تقديرٌ متحفّظ
 *  يمنع تداخلَ التسميات الطويلة (الأيام، التواريخ) على محورٍ ضيّق. */
const LABEL_EM = 4.8;

/**
 * تسمياتُ المحور: تتخطّى بعضها متى ضاق المحور. المواضعُ تأتي من
 * الراسم — تسميةُ العمود تقف تحته، وتسميةُ النقطة تحت نقطتها؛ وصيغةٌ
 * مشتركةٌ كانت تُزيح تسميةَ العمود نصفَ عمودٍ عن عمودها.
 */
function xLabels(labels, positions) {
    const n = labels.length;
    if (!n) {return '';}
    const widest = labels.reduce((m, l) => Math.max(m, l.length), 0) * LABEL_EM;
    const fit = Math.max(1, Math.floor(PLOT_W / Math.max(widest, 1)));
    const step = Math.max(1, Math.ceil(n / Math.min(7, fit)));
    return labels.map((label, i) => {
        if (i % step !== 0 && i !== n - 1) {return '';}
        const x = positions[i] ?? (PAD.start + PLOT_W / 2);
        return `<text x="${x.toFixed(2)}" y="${H - 12}" text-anchor="middle" class="erp-chart__xlabel">${esc(label)}</text>`;
    }).join('');
}

function legend(series) {
    return `<ul class="erp-chart__legend">`
        + series.map((s) => `<li><span class="erp-chart__dot" style="background:${toneColor(s.tone)}" aria-hidden="true"></span>${esc(s.label)}</li>`).join('')
        + `</ul>`;
}

/** سلسلةٌ واحدةٌ لا تحتاج مفتاحًا: اسمُها على الرسمِ نفسِه، والمفتاحُ
 *  تكرارٌ يُضعف التسلسل. */
const legendOf = (series) => (series.length > 1 ? legend(series) : '');

const KEYBOARD_HINT = 'استخدم مفاتيح الأسهم للتنقل بين النقاط.';

/** صندوق الرسم: نقطةُ تركيزٍ واحدة لكل رسم، وأسهمٌ تتنقّل بين نقاطه. */
function plotBox(svg, label) {
    return `<div class="erp-chart__plot" tabindex="0" role="group"`
        + ` aria-label="${esc(`${label}. ${KEYBOARD_HINT}`)}">${svg}</div>`;
}

function figure(kind, title, bodyHtml, bare) {
    return `<figure class="erp-chart erp-chart--${kind}${bare ? ' erp-chart--bare' : ''}" data-v2-chart="${kind}">`
        + (title ? `<figcaption class="erp-chart__title">${esc(title)}</figcaption>` : '')
        + bodyHtml
        + `</figure>`;
}

function emptyFigure(kind, title, emptyText) {
    return figure(kind, title, `<p class="erp-chart__empty">${esc(emptyText || 'لا بيانات في هذه الفترة')}</p>`);
}

const cleanSeries = (series) => (Array.isArray(series) ? series : [])
    .map((s) => ({
        label: String((s && s.label) ?? ''),
        tone: s && s.tone,
        values: (Array.isArray(s && s.values) ? s.values : []).map(num),
    }))
    .filter((s) => s.values.length > 0);

/**
 * Grouped vertical bars.
 * @param {{title?:string, ariaLabel:string, labels:string[], series:{label:string,tone?:string,values:number[]}[], formatValue?:(v:number)=>string, formatMark?:(v:number)=>string, emptyText?:string, bare?:boolean, max?:number, notes?:string[]}} opts
 * @returns {string}
 */
export function barChart(opts = {}) {
    const labels = (Array.isArray(opts.labels) ? opts.labels : []).map(String);
    const series = cleanSeries(opts.series);
    const title = opts.title || '';
    /* ملاحظةٌ لكل عمود (عددُ الفواتير مثلًا) تسير مع العلامة: تقيمُ في
       التلميح وفي النطق، ولا تشغل محورَ السطور. */
    const notes = Array.isArray(opts.notes) ? opts.notes.map((v) => String(v ?? '')) : [];
    if (!labels.length || !series.length) {return emptyFigure('bar', title, opts.emptyText);}
    const n = labels.length;
    /* سقفُ المحور: يُقرَّب تلقائيًّا، لكنّ الشاشة التي تعرف مداها بنفسها
       تستطيع تثبيته — فتأخذ الأعمدةُ المساحةَ كلَّها بدل أن تترك نصفَ
       اللوحةِ فراغًا. */
    const max = Number.isFinite(opts.max) && opts.max > 0
        ? opts.max
        : axisMax(Math.max(0, ...series.flatMap((s) => s.values)));
    const allZero = series.every((s) => s.values.every((v) => v <= 0));
    if (allZero) {return emptyFigure('bar', title, opts.emptyText);}
    const fmt = typeof opts.formatValue === 'function' ? opts.formatValue : (v) => String(num(v));
    /* الرقمُ المكتوب فوق العلامة قد يكون أدقّ compactًا من قيمة التلميح:
       «2.5» على العمود، و«2,495» عند المرور. */
    const fmtMark = typeof opts.formatMark === 'function' ? opts.formatMark : fmt;
    /* الأرقام على العلامات تصلح لسلسلةٍ واحدةٍ قليلةِ النقاط؛ تعدُّدُ
       السلاسل يجعلها حشدًا، فهناك يتكفّل بها التلميح. */
    const showValues = series.length === 1 && n <= 12;
    const pad = { ...PAD, top: showValues ? 28 : PAD.top };
    const plotH = H - pad.top - pad.bottom;
    const baseline = pad.top + plotH;
    const group = PLOT_W / n;
    const slot = Math.max(3, Math.min(36, (group * 0.72) / series.length));
    /* تسميةُ العمود تقف تحت عمودها: الأعمدةُ تتوزّع على خلايا، لا على
       كاملِ العرض، فالتسميةُ المبنيّةُ على النهايات كانت تنزاح نصفَ خلية.
       والخلاياُ تبدأُ من اليمين (RTL) فأولُ يومٍ على اليمين. */
    const positions = labels.map((_, i) => PAD.start + group * ((RTL ? n - 1 - i : i) + 0.5));
    const defs = series.map((s) => {
        const gid = seriesGradientId(s);
        /* ذروةُ السلسلة تُرسم بتدرّجٍ أقوى: العين تجد أبعدَ يومٍ بلا أن تقرأ رقمًا. */
        return fillGradient(gid, toneColor(s.tone))
            + fillGradient(`${gid}-peak`, toneColor(s.tone), .98, .78);
    }).join('');
    const bars = series.map((s, si) => {
        const gid = seriesGradientId(s);
        const peak = series.length === 1 ? s.values.indexOf(Math.max(...s.values)) : -1;
        return s.values.map((v, i) => {
            const value = Math.max(0, v);
            const h = (value / max) * plotH;
            const cx = positions[i];
            const x = cx - (slot * series.length) / 2 + si * slot;
            const note = notes[i] || '';
            return `<rect x="${x.toFixed(2)}" y="${(baseline - h).toFixed(2)}" width="${slot.toFixed(2)}" height="${h.toFixed(2)}" rx="3"`
                + ` style="fill:url(#${i === peak ? `${gid}-peak` : gid})"`
                + ` data-v2-chart-mark="bar" data-v2-chart-label="${esc(labels[i])}"`
                + ` data-v2-chart-series="${esc(s.label)}" data-v2-chart-value="${esc(fmt(value))}"`
                + `${note ? ` data-v2-chart-note="${esc(note)}"` : ''}>`
                + `<title>${esc(labels[i])}${note ? ` · ${esc(note)}` : ''} — ${esc(s.label)}: ${esc(fmt(value))}</title></rect>`;
        }).join('');
    }).join('');
    const values = showValues ? series[0].values.map((v, i) => {
        const value = Math.max(0, v);
        const h = (value / max) * plotH;
        const cx = positions[i];
        const y = Math.max(pad.top - 4, baseline - h - 7);
        return `<text x="${cx.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" class="erp-chart__value">${esc(fmtMark(value))}</text>`;
    }).join('') : '';
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.ariaLabel || title || 'رسم أعمدة')}" preserveAspectRatio="xMidYMid meet">`
        + `<title>${esc(title || opts.ariaLabel || 'رسم أعمدة')}</title>`
        + `<defs>${defs}</defs>`
        + gridAndAxis(max, pad, plotH) + bars + values + xLabels(labels, positions) + `</svg>`;
    return figure('bar', title, plotBox(svg, opts.ariaLabel || title || 'رسم أعمدة') + legendOf(series), opts.bare);
}

/** مواضعُ نقاطِ الخطّ على عرضِ المحور — تُستعمل كذلك لتسمياتِه. */
const linePositions = (n) => (n <= 1
    ? [PAD.start + PLOT_W / 2]
    : Array.from({ length: n }, (_, i) => PAD.start + ((RTL ? n - 1 - i : i) / (n - 1)) * PLOT_W));

function linePoints(values, max, pad, plotH) {
    const xs = linePositions(values.length);
    return values.map((v, i) => {
        const x = xs[i];
        const y = pad.top + plotH - (Math.max(0, v) / max) * plotH;
        return { x, y, value: v, index: i };
    });
}

/**
 * Multi-series line chart; marks are drawn only for short series so a
 * 366-day statement stays readable.
 * @param {{title?:string, ariaLabel:string, labels:string[], series:{label:string,tone?:string,values:number[],fill?:boolean}[], formatValue?:(v:number)=>string, formatMark?:(v:number)=>string, emptyText?:string, bare?:boolean, max?:number, notes?:string[]}} opts
 * @returns {string}
 */
export function lineChart(opts = {}) {
    const labels = (Array.isArray(opts.labels) ? opts.labels : []).map(String);
    const series = cleanSeries(opts.series);
    const title = opts.title || '';
    const notes = Array.isArray(opts.notes) ? opts.notes.map((v) => String(v ?? '')) : [];
    if (!labels.length || !series.length) {return emptyFigure('line', title, opts.emptyText);}
    const max = Number.isFinite(opts.max) && opts.max > 0
        ? opts.max
        : axisMax(Math.max(0, ...series.flatMap((s) => s.values)));
    const allZero = series.every((s) => s.values.every((v) => v <= 0));
    if (allZero) {return emptyFigure('line', title, opts.emptyText);}
    const fmt = typeof opts.formatValue === 'function' ? opts.formatValue : (v) => String(num(v));
    const fmtMark = typeof opts.formatMark === 'function' ? opts.formatMark : fmt;
    /* آخر نقطةٍ تحمل الرقم الحالي — وهو ما يُقرأ أولًا. سلسلةٌ واحدةٌ فقط،
       وإلا تعارضت الأرقام فوق بعضها. */
    const showEnd = series.length === 1;
    const pad = { ...PAD, top: showEnd ? 26 : PAD.top };
    const plotH = H - pad.top - pad.bottom;
    const baseline = pad.top + plotH;
    const defs = series.filter((s) => s.fill)
        .map((s) => areaGradient(`erp-a-${seriesGradientId(s).slice(6)}`, toneColor(s.tone))).join('');
    const paths = series.map((s) => {
        const pts = linePoints(s.values, max, pad, plotH);
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
        const area = s.fill
            ? `<path d="${d} L${pts[pts.length - 1].x.toFixed(2)},${baseline} L${pts[0].x.toFixed(2)},${baseline} Z" style="fill:url(#erp-a-${seriesGradientId(s).slice(6)});opacity:.9" stroke="none"/>`
            : '';
        const dots = pts.length <= 31
            ? pts.map((p) => {
                const note = notes[p.index] || '';
                return `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3" style="fill:${toneColor(s.tone)}"`
                    + ` data-v2-chart-mark="line" data-v2-chart-label="${esc(labels[p.index] ?? '')}"`
                    + ` data-v2-chart-series="${esc(s.label)}" data-v2-chart-value="${esc(fmt(p.value))}"`
                    + `${note ? ` data-v2-chart-note="${esc(note)}"` : ''}>`
                    + `<title>${esc(s.label)}: ${esc(fmt(p.value))}${note ? ` · ${esc(note)}` : ''}</title></circle>`;
            }).join('')
            : '';
        return area
            + `<path d="${d}" fill="none" style="stroke:${toneColor(s.tone)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"><title>${esc(s.label)}</title></path>`
            + dots;
    }).join('');
    const ends = showEnd ? series.map((s) => {
        const pts = linePoints(s.values, max, pad, plotH);
        const last = pts[pts.length - 1];
        if (!last) {return '';}
        const y = Math.max(pad.top - 2, last.y - 9);
        return `<text x="${(last.x - 6).toFixed(2)}" y="${y.toFixed(2)}" text-anchor="end" class="erp-chart__value">${esc(fmtMark(last.value))}</text>`;
    }).join('') : '';
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.ariaLabel || title || 'رسم خطي')}" preserveAspectRatio="xMidYMid meet">`
        + `<title>${esc(title || opts.ariaLabel || 'رسم خطي')}</title>`
        + `<defs>${defs}</defs>`
        + gridAndAxis(max, pad, plotH) + paths + ends + xLabels(labels, linePositions(labels.length)) + `</svg>`;
    return figure('line', title, plotBox(svg, opts.ariaLabel || title || 'رسم خطي') + legendOf(series), opts.bare);
}

/**
 * Donut + percentage legend. Slices beyond `maxSlices` fold into «أخرى» so
 * the legend stays readable; the fold is stated in the title text.
 * @param {{title?:string, ariaLabel:string, slices:{label:string,tone?:string,value:number}[], centerLabel?:string, centerValue?:string, formatValue?:(v:number)=>string, emptyText?:string, maxSlices?:number, bare?:boolean}} opts
 * @returns {string}
 */
export function donutChart(opts = {}) {
    const title = opts.title || '';
    const raw = (Array.isArray(opts.slices) ? opts.slices : [])
        .map((s) => ({ label: String((s && s.label) ?? ''), tone: s && s.tone, value: Math.max(0, num(s && s.value)) }))
        .filter((s) => s.value > 0);
    if (!raw.length) {return emptyFigure('donut', title, opts.emptyText);}
    const maxSlices = Number.isFinite(opts.maxSlices) && opts.maxSlices > 1 ? Math.floor(opts.maxSlices) : 8;
    let slices = raw;
    if (raw.length > maxSlices) {
        const head = raw.slice(0, maxSlices - 1);
        const rest = raw.slice(maxSlices - 1).reduce((s, x) => s + x.value, 0);
        slices = head.concat([{ label: 'أخرى', tone: 'neutral', value: rest }]);
    }
    const total = slices.reduce((s, x) => s + x.value, 0);
    const fmt = typeof opts.formatValue === 'function' ? opts.formatValue : (v) => String(num(v));
    const r = 54;
    const c = 2 * Math.PI * r;
    let start = 0;
    const arcs = slices.map((s, i) => {
        const len = (s.value / total) * c;
        const tone = s.tone || CHART_TONES[i % CHART_TONES.length];
        /* فجوةٌ بين الشرائح: الجاران لا يتلامسان، والنسبة تُقرأ بلا لبس. */
        const gap = Math.min(2.4, len * 0.22);
        const seg = `<circle cx="66" cy="66" r="${r}" fill="none" stroke-width="16"`
            + ` style="stroke:${toneColor(tone)}" stroke-dasharray="${Math.max(0.5, len - gap).toFixed(2)} ${c.toFixed(2)}"`
            + ` stroke-dashoffset="${(-start).toFixed(2)}" transform="rotate(-90 66 66)"`
            + ` data-v2-chart-mark="donut" data-v2-chart-label="${esc(s.label)}"`
            + ` data-v2-chart-series="${esc(s.label)}" data-v2-chart-value="${esc(fmt(s.value))}">`
            + `<title>${esc(s.label)}: ${esc(fmt(s.value))}</title></circle>`;
        start += len;
        return seg;
    }).join('');
    const centerValue = opts.centerValue != null
        ? esc(String(opts.centerValue))
        : esc(fmt(total));
    const center = `<div class="erp-chart__donut-center"><span class="erp-chart__donut-total" dir="ltr">${centerValue}</span>`
        + (opts.centerLabel ? `<span class="erp-chart__donut-cap">${esc(opts.centerLabel)}</span>` : '')
        + `</div>`;
    const legendRows = slices.map((s, i) => {
        const pct = total > 0 ? (s.value / total) * 100 : 0;
        const tone = s.tone || CHART_TONES[i % CHART_TONES.length];
        /* المفتاحُ يذكر المبلغَ والنسبةَ معًا: النسبةُ وحدها لا تقول كم
          جنيَ، والمبلغُ وحده لا يقول كم حصةً. */
        return `<li><span class="erp-chart__dot" style="background:${toneColor(tone)}" aria-hidden="true"></span>`
            + `<span class="erp-chart__legend-label">${esc(s.label)}</span>`
            + `<span class="erp-chart__legend-amt" dir="ltr">${esc(fmt(s.value))}</span>`
            + `<span class="erp-chart__legend-val" dir="ltr">${pct.toFixed(1)}%</span></li>`;
    }).join('');
    const label = opts.ariaLabel || title || 'رسم دائري';
    const body = `<div class="erp-chart__donut-wrap" tabindex="0" role="group" aria-label="${esc(`${label}. ${KEYBOARD_HINT}`)}">`
        + `<div class="erp-chart__donut" role="img" aria-label="${esc(label)}">`
        + `<svg viewBox="0 0 132 132" aria-hidden="true">`
        + `<circle cx="66" cy="66" r="${r}" fill="none" stroke-width="16" style="stroke:var(--erp-chart-track)"/>${arcs}</svg>`
        + center
        + `</div>`
        + `<ul class="erp-chart__legend erp-chart__legend--rows">${legendRows}</ul>`
        + `</div>`;
    return figure('donut', title, body, opts.bare);
}
