/**
 * V2 — Executive summary repository (Gate D)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * One door: GET /api/executive/summary (server-built, admin|owner) — the same
 * endpoint screens/executive.js reads, so the preview board and the live
 * executive screen can never disagree about a number.
 *
 * WHY ONE REQUEST
 *   The server already runs every read in a single Promise.all and returns a
 *   ready payload (series, kpi, cash, topDepts, topItems, alerts). Walking the
 *   books from the browser would be a waterfall, a slow first paint and a
 *   silent undercount — exactly what the owner's speed rule forbids.
 *
 * SPEED CONTRACT
 *   · 30-second TTL: a refresh click is served from memory, and two boards
 *     mounted in the same minute share one flight.
 *   · In-flight de-duplication: concurrent callers await the same promise.
 *   · No polling, no interval, no timers — the screen asks, then stops.
 *
 * HONESTY RULES
 *   · A percentage without a base (revenue <= 0) is `null`, and the screen
 *     prints «—» instead of a zero that looks like real data.
 *   · Empty lists stay empty; the screen names the reason, never invents rows.
 *   · This file NEVER writes: no method, no body, no token handling.
 */

import { apiFetch } from '../../core/api.js?v=4.9.314';

const TTL_MS = 30_000;

const num = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
};
const thousands = (v) => num(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct1 = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);

let cache = null;
let cachedAt = 0;
let inflight = null;

/**
 * Read the executive summary, served from a 30s cache unless `force`.
 * @param {{days?: number, force?: boolean}} [opts]
 * @returns {Promise<object>} raw server payload (never transformed here)
 */
export function fetchExecutiveSummary({ days = 14, force = false } = {}) {
    const now = Date.now();
    if (!force && cache && now - cachedAt < TTL_MS) {
        return Promise.resolve(cache);
    }
    if (inflight) {return inflight;}
    const span = Math.min(Math.max(Number(days) || 14, 7), 31);
    inflight = apiFetch(`/executive/summary?days=${span}`)
        .then((payload) => {
            cache = payload;
            cachedAt = Date.now();
            return payload;
        })
        .finally(() => {
            inflight = null;
        });
    return inflight;
}

/** Drop the cache — used by tests and by a hard reload path. */
export function resetExecutiveSummaryCache() {
    cache = null;
    cachedAt = 0;
    inflight = null;
}

/* ── Pure view: payload → dashboard model ─────────────────────────────── */

/**
 * Map the server payload into the words and shapes the board paints.
 * Pure: no network, no DOM, no clock.
 * @param {object} payload
 */
export function buildLiveBoard(payload = {}) {
    const k = payload.kpi || {};
    const revenue = num(k.revenue);
    const cogs = num(k.cogs);
    const net = num(k.net);
    const cash = num(k.cash);
    const series = Array.isArray(payload.series) ? payload.series : [];
    const depts = Array.isArray(payload.topDepts) ? payload.topDepts : [];
    const items = Array.isArray(payload.topItems) ? payload.topItems : [];
    const cashRows = Array.isArray(payload.cash) ? payload.cash : [];
    const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
    const costRatio = revenue > 0 ? Math.round((cogs / revenue) * 1000) / 10 : null;

    return {
        day: String(payload.day || ''),
        entries: num(payload.postedToday),
        kpi: {
            revenue,
            cogs,
            net,
            margin: k.margin == null ? null : num(k.margin),
            cash,
            openShifts: num(k.openShifts),
            negativeStock: num(k.negativeStock),
        },
        kpis: [
            { icon: 'banknote', label: 'إيراد اليوم', en: 'Revenue', value: thousands(revenue), unit: 'ر.س', hint: 'من دفتر القيود المُرحَّل' },
            { icon: 'wallet', label: 'تكلفة البضاعة', en: 'COGS', value: thousands(cogs), unit: 'ر.س', hint: 'قيود التكلفة المُرحَّلة' },
            { icon: 'gem', label: 'الصافي', en: 'Net', value: thousands(net), unit: 'ر.س', hint: 'إيراد − تكلفة − مصروف' },
            { icon: 'trending-up', label: 'الهامش', en: 'Margin', value: pct1(k.margin), unit: '', hint: 'نسبة الصافي من الإيراد' },
            { icon: 'receipt', label: 'النقد في الدفاتر', en: 'Cash on books', value: thousands(cash), unit: 'ر.س', hint: 'أرصدة حسابات النقد' },
            { icon: 'save', label: 'قيود مُرحَّلة اليوم', en: 'Posted today', value: thousands(payload.postedToday), unit: 'قيد', hint: 'من دفتر اليوم' },
            { icon: 'clock', label: 'ورديات مفتوحة', en: 'Open shifts', value: thousands(k.openShifts), unit: 'وردية', hint: 'نقد لم يُقفل بعد' },
            { icon: 'alert-triangle', label: 'أصناف رصيدها سالب', en: 'Negative stock', value: thousands(k.negativeStock), unit: 'صنف', hint: 'ثقة التكلفة' },
        ],
        trend: series.map((r) => ({
            day: String(r.day || '').slice(5),
            revenue: num(r.revenue),
            cost: num(r.cost),
            net: num(r.net),
        })),
        costRatio,
        departments: depts.map((d, i) => ({
            label: String(d.name || '—'),
            value: num(d.total),
            tone: `chart-${(i % 6) + 1}`,
        })),
        cash: cashRows.map((c, i) => ({
            label: String(c.name || c.code || '—'),
            value: Math.abs(num(c.balance)),
            tone: `chart-${(i % 6) + 1}`,
        })),
        topItems: items.map((i) => ({
            name: String(i.name || '—'),
            count: num(i.qty),
            total: num(i.total),
        })),
        alerts: alerts.map((a) => ({
            severity: String(a.severity || 'low'),
            title: String(a.title || ''),
            detail: String(a.detail || ''),
            action: a.action && a.action.screen
                ? { label: String(a.action.label || 'فتح'), screen: String(a.action.screen) }
                : null,
        })),
    };
}
