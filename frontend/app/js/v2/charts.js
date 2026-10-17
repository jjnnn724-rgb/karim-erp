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
 *   axis implies; each figure has a role="img" + Arabic aria-label.
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
};

export const CHART_TONES = Object.keys(TONES);

const toneColor = (tone) => TONES[tone] || TONES.brand;

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** 440×240 canvas in a responsive viewBox — CSS scales the rendered width.
 *  Kept compact so axis text stays in double digits at card widths; the CSS
 *  raises the unit size in narrow containers (see @container tiers). */
const W = 440;
const H = 240;
const PAD = { top: 14, end: 56, bottom: 32, start: 12 };
const PLOT_W = W - PAD.start - PAD.end;
const PLOT_H = H - PAD.top - PAD.bottom;

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

function gridAndAxis(max) {
    const rows = [0, 1, 2, 3, 4].map((k) => {
        const y = PAD.top + PLOT_H - (k / 4) * PLOT_H;
        const value = (max * k) / 4;
        return `<line x1="${PAD.start}" y1="${y}" x2="${W - PAD.end}" y2="${y}" class="erp-chart__grid"/>`
            + `<text x="${W - 6}" y="${y}" text-anchor="end" dominant-baseline="middle">${esc(tickLabel(value))}</text>`;
    });
    return rows.join('');
}

function xLabels(labels) {
    const n = labels.length;
    if (!n) {return '';}
    const step = Math.max(1, Math.ceil(n / 7));
    return labels.map((label, i) => {
        if (i % step !== 0 && i !== n - 1) {return '';}
        const x = n === 1 ? PAD.start + PLOT_W / 2 : PAD.start + (i / (n - 1)) * PLOT_W;
        return `<text x="${x}" y="${H - 12}" text-anchor="middle">${esc(label)}</text>`;
    }).join('');
}

function legend(series) {
    return `<ul class="erp-chart__legend">`
        + series.map((s) => `<li><span class="erp-chart__dot" style="background:${toneColor(s.tone)}" aria-hidden="true"></span>${esc(s.label)}</li>`).join('')
        + `</ul>`;
}

function figure(kind, title, bodyHtml) {
    return `<figure class="erp-chart erp-chart--${kind}">`
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
 * @param {{title?:string, ariaLabel:string, labels:string[], series:{label:string,tone?:string,values:number[]}[], formatValue?:(v:number)=>string, emptyText?:string}} opts
 * @returns {string}
 */
export function barChart(opts = {}) {
    const labels = (Array.isArray(opts.labels) ? opts.labels : []).map(String);
    const series = cleanSeries(opts.series);
    const title = opts.title || '';
    if (!labels.length || !series.length) {return emptyFigure('bar', title, opts.emptyText);}
    const n = labels.length;
    const max = axisMax(Math.max(0, ...series.flatMap((s) => s.values)));
    const allZero = series.every((s) => s.values.every((v) => v <= 0));
    if (allZero) {return emptyFigure('bar', title, opts.emptyText);}
    const fmt = typeof opts.formatValue === 'function' ? opts.formatValue : (v) => String(num(v));
    const group = PLOT_W / n;
    const slot = Math.max(3, Math.min(36, (group * 0.72) / series.length));
    const baseline = PAD.top + PLOT_H;
    const bars = series.map((s, si) => s.values.map((v, i) => {
        const value = Math.max(0, v);
        const h = (value / max) * PLOT_H;
        const cx = PAD.start + group * (i + 0.5);
        const x = cx - (slot * series.length) / 2 + si * slot;
        return `<rect x="${x.toFixed(2)}" y="${(baseline - h).toFixed(2)}" width="${slot.toFixed(2)}" height="${h.toFixed(2)}"`
            + ` rx="3" style="fill:${toneColor(s.tone)}"><title>${esc(labels[i])} — ${esc(s.label)}: ${esc(fmt(value))}</title></rect>`;
    }).join('')).join('');
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.ariaLabel || title || 'رسم أعمدة')}" preserveAspectRatio="xMidYMid meet">`
        + `<title>${esc(title || opts.ariaLabel || 'رسم أعمدة')}</title>`
        + gridAndAxis(max) + bars + xLabels(labels) + `</svg>`;
    return figure('bar', title, `<div class="erp-chart__plot">${svg}</div>${legend(series)}`);
}

function linePoints(values, max) {
    const n = values.length;
    return values.map((v, i) => {
        const x = n === 1 ? PAD.start + PLOT_W / 2 : PAD.start + (i / (n - 1)) * PLOT_W;
        const y = PAD.top + PLOT_H - (Math.max(0, v) / max) * PLOT_H;
        return { x, y, value: v };
    });
}

/**
 * Multi-series line chart; marks are drawn only for short series so a
 * 366-day statement stays readable.
 * @param {{title?:string, ariaLabel:string, labels:string[], series:{label:string,tone?:string,values:number[],fill?:boolean}[], formatValue?:(v:number)=>string, emptyText?:string}} opts
 * @returns {string}
 */
export function lineChart(opts = {}) {
    const labels = (Array.isArray(opts.labels) ? opts.labels : []).map(String);
    const series = cleanSeries(opts.series);
    const title = opts.title || '';
    if (!labels.length || !series.length) {return emptyFigure('line', title, opts.emptyText);}
    const max = axisMax(Math.max(0, ...series.flatMap((s) => s.values)));
    const allZero = series.every((s) => s.values.every((v) => v <= 0));
    if (allZero) {return emptyFigure('line', title, opts.emptyText);}
    const fmt = typeof opts.formatValue === 'function' ? opts.formatValue : (v) => String(num(v));
    const baseline = PAD.top + PLOT_H;
    const paths = series.map((s) => {
        const pts = linePoints(s.values, max);
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
        const area = s.fill
            ? `<path d="${d} L${pts[pts.length - 1].x.toFixed(2)},${baseline} L${pts[0].x.toFixed(2)},${baseline} Z" style="fill:${toneColor(s.tone)};opacity:.12" stroke="none"/>`
            : '';
        const dots = pts.length <= 31
            ? pts.map((p) => `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3" style="fill:${toneColor(s.tone)}"><title>${esc(s.label)}: ${esc(fmt(p.value))}</title></circle>`).join('')
            : '';
        return area
            + `<path d="${d}" fill="none" style="stroke:${toneColor(s.tone)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"><title>${esc(s.label)}</title></path>`
            + dots;
    }).join('');
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.ariaLabel || title || 'رسم خطي')}" preserveAspectRatio="xMidYMid meet">`
        + `<title>${esc(title || opts.ariaLabel || 'رسم خطي')}</title>`
        + gridAndAxis(max) + paths + xLabels(labels) + `</svg>`;
    return figure('line', title, `<div class="erp-chart__plot">${svg}</div>${legend(series)}`);
}

/**
 * Donut + percentage legend. Slices beyond `maxSlices` fold into «أخرى» so
 * the legend stays readable; the fold is stated in the title text.
 * @param {{title?:string, ariaLabel:string, slices:{label:string,tone?:string,value:number}[], centerLabel?:string, formatValue?:(v:number)=>string, emptyText?:string, maxSlices?:number}} opts
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
        const seg = `<circle cx="66" cy="66" r="${r}" fill="none" stroke-width="16"`
            + ` style="stroke:${toneColor(tone)}" stroke-dasharray="${len.toFixed(2)} ${c.toFixed(2)}"`
            + ` stroke-dashoffset="${(-start).toFixed(2)}" transform="rotate(-90 66 66)">`
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
        return `<li><span class="erp-chart__dot" style="background:${toneColor(tone)}" aria-hidden="true"></span>`
            + `<span class="erp-chart__legend-label">${esc(s.label)}</span>`
            + `<span class="erp-chart__legend-val" dir="ltr">${pct.toFixed(1)}%</span></li>`;
    }).join('');
    const body = `<div class="erp-chart__donut-wrap">`
        + `<div class="erp-chart__donut" role="img" aria-label="${esc(opts.ariaLabel || title || 'رسم دائري')}">`
        + `<svg viewBox="0 0 132 132" aria-hidden="true">`
        + `<circle cx="66" cy="66" r="${r}" fill="none" stroke-width="16" style="stroke:var(--erp-surface-sunken)"/>${arcs}</svg>`
        + center
        + `</div>`
        + `<ul class="erp-chart__legend erp-chart__legend--rows">${legendRows}</ul>`
        + `</div>`;
    return figure('donut', title, body);
}
