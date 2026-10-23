/**
 * V2 — Manager briefing repository (بيانات حقيقية، بلا طبقة نموذج)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * THE DATA DOOR for V2's executive screen. Two endpoints, both already live
 * in production and already consumed by the legacy dashboard
 * (features/dashboard.js:251):
 *
 *   GET /api/manager/briefing          backend/manager-briefing.js
 *       revenues by department (+ yesterday's, per department), expenses,
 *       attendance, stock gaps, 3-day cover forecast, 7-day curve, payment
 *       split, top items, pending decisions, integration health.
 *   GET /api/pos/orders/stats/today    backend/cashier-module/pos-orders-history.js:180
 *       POS order counts by status, average ticket, payment breakdown,
 *       department breakdown, the five latest orders.
 *
 * WHY NO NEW ENDPOINT
 *   V2 does not get to invent a backend. Every number this file returns is a
 *   number the legacy app already asks the database for. If a figure is not
 *   inside those two payloads, the screen does not show it — it does not
 *   approximate it either.
 *
 * HONESTY RULES (each one is asserted in tests/v2-briefing.test.js)
 *   • A percentage needs a real base. `deltaOf(now, 0)` returns a flat dash
 *     with a stated reason — never "∞%", never "100%".
 *   • Colour answers "good or bad for this metric", the arrow answers "which
 *     way the number moved". For expenses a rise is red AND points up; the
 *     sample dashboard's up=green rule would have painted a cost increase as
 *     a win.
 *   • Comparisons only ever run against the same definition: today's
 *     issued+reported POS invoices against yesterday's same filter, never
 *     against a total that includes cancelled orders.
 *   • A failed fetch becomes `null` and the screen names the source that
 *     failed. A half-empty dashboard that says so beats a full one that lies.
 *   • Nothing here decides permission. `/api/manager/briefing` is
 *     requireRole('admin','manager') server-side; `/api/pos/orders/stats/today`
 *     is jwtAuth. The 403 comes from the backend and is displayed as-is.
 */

import { apiFetch, API_BASE } from '../../core/api.js?v=4.9.197';

/** Stored values of pos_invoice_payments.method. Unknown methods are shown
 *  verbatim — relabelling a method the app does not know would be inventing. */
const METHOD_LABELS = { cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة' };

/* ── Fetching ────────────────────────────────────────────────────────── */

export async function fetchBriefing(date) {
    const q = date ? `?date=${encodeURIComponent(date)}` : '';
    const payload = await apiFetch(`/manager/briefing${q}`);
    return payload && typeof payload === 'object' ? payload : null;
}

export async function fetchTodayStats() {
    const payload = await apiFetch('/pos/orders/stats/today');
    return payload && typeof payload === 'object' ? payload : null;
}

/* ── Scalar helpers ──────────────────────────────────────────────────── */

const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
};

export function formatMoney(v) {
    return n(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatInt(v) {
    return Math.round(n(v)).toLocaleString('en-US');
}

/** A pill that admits it has nothing to compare against. */
export function noBase(reason) {
    return { sign: 'flat', favor: 'flat', text: '—', aria: reason };
}

/**
 * Real percentage movement, split into the two things a pill actually means.
 *
 * @param {number} now      today's value
 * @param {number} prev     the comparison value (0 or absent → no percentage)
 * @param {'higher'|'lower'} better  which direction is GOOD for this metric
 * @param {string} basis    what `prev` is, for the screen-reader sentence
 * @returns {{sign:'up'|'down'|'flat', favor:'good'|'bad'|'flat', text:string, aria:string}}
 */
export function deltaOf(now, prev, better = 'higher', basis = 'أمس') {
    const a = n(now);
    const b = n(prev);
    if (!(b > 0)) {
        return {
            sign: 'flat', favor: 'flat', text: '—',
            aria: `لا مقارنة ممكنة — ${basis} ${formatMoney(b)}`,
        };
    }
    const pct = ((a - b) / b) * 100;
    const sign = pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat';
    const favor = sign === 'flat' ? 'flat'
        : (sign === 'up') === (better === 'higher') ? 'good' : 'bad';
    const shown = `${Math.abs(pct).toFixed(1)}%`;
    const verb = sign === 'up' ? 'ارتفع' : sign === 'down' ? 'انخفض' : 'استقر';
    return {
        sign, favor, text: shown,
        aria: `${verb} ${shown} مقارنة بـ${basis}`,
    };
}

/* ── View model pieces ───────────────────────────────────────────────── */

/**
 * Six numbers only. A dashboard that shows 50 numbers is a report; a
 * dashboard that shows six is a decision tool.
 */
export function buildKpis(briefing, stats, currency = '') {
    const unit = String(currency || '').trim() || 'ر.س';
    const b = briefing || {};
    const summary = stats?.summary || {};

    const sales = n(b.cashiersTotal?.total);
    const expenses = n(b.expenses?.total);
    const net = sales - expenses;
    const netY = n(b.cashiersY?.total) - n(b.expensesY?.total);

    const week = b.week || {};
    const weekAvg = n(week.invoices) > 0 ? n(week.total) / n(week.invoices) : 0;
    const avgTicket = n(summary.avg_order_value);

    const att = b.attendance || {};
    const stockOut = Array.isArray(b.stockOut) ? b.stockOut : [];
    const forecast = Array.isArray(b.forecast) ? b.forecast : [];

    return [
        {
            id: 'sales', icon: 'banknote', label: 'مبيعات اليوم', en: "Today's Sales",
            value: formatMoney(sales), unit,
            hint: `${formatInt(b.cashiersTotal?.invoices)} فاتورة اليوم`,
            delta: deltaOf(sales, b.cashiersY?.total, 'higher'),
        },
        {
            id: 'avg_ticket', icon: 'wallet', label: 'متوسط الفاتورة', en: 'Avg Ticket',
            value: formatMoney(avgTicket), unit,
            hint: weekAvg > 0 ? `متوسط آخر ٧ أيام ${formatMoney(weekAvg)}` : 'لا فاتورة في الأسبوع بعد',
            delta: deltaOf(avgTicket, weekAvg, 'higher', 'متوسط آخر ٧ أيام'),
        },
        {
            id: 'net', icon: 'trending-up', label: 'صافي اليوم', en: 'Net Today',
            value: formatMoney(net), unit,
            hint: 'مبيعات مطروحًا منها مصاريف اليوم',
            delta: deltaOf(net, netY, 'higher'),
        },
        {
            id: 'expenses', icon: 'receipt', label: 'مصاريف اليوم', en: 'Expenses',
            value: formatMoney(expenses), unit,
            hint: `${formatInt(b.expenses?.count)} عملية مسجّلة`,
            delta: deltaOf(expenses, b.expensesY?.total, 'lower'),
        },
        {
            id: 'attendance', icon: 'users', label: 'الحضور اليوم', en: 'Attendance',
            // النسبةُ رقمٌ واحدٌ لا رقمان: «٢٥ من ٣٠». لو انشطرت على
            // spanَين لقلبها تدفّقُ RTL فظهرت «٣٠ / ٢٥»، فتسير في
            // مقطعٍ واحدٍ لاتينيٍّ معزول — كما المالُ بالضبط.
            value: `${formatInt(att.checked_in)} / ${formatInt(att.with_record)}`, unit: '',
            hint: `نسي الخروج ${formatInt(att.missing_out)} • نسي الدخول ${formatInt(att.missing_in)}`,
            // The day is still running: a "vs yesterday" percentage would compare
            // a partial day against a full one and always look like a collapse.
            delta: noBase('لا مقارنة بأمس — اليوم لم ينتهِ بعد'),
        },
        {
            id: 'stock', icon: 'package', label: 'أصناف تحتاج طلبًا', en: 'To Reorder',
            value: formatInt(stockOut.length + forecast.length), unit: '',
            hint: `نافذ ${formatInt(stockOut.length)} • سينفد خلال ٣ أيام ${formatInt(forecast.length)}`,
            // Counted against the stock as it stands now; the briefing carries no
            // yesterday snapshot of shortages, so no percentage is claimed.
            delta: noBase('لا مقارنة بأمس — الجرد الحالي فقط'),
        },
    ];
}

/**
 * 7-day curve from `weekDaily` (real rows, one per day with sales).
 * Labels are day/month from the stored date — no locale formatting, so the
 * axis cannot disagree with the date the database actually holds.
 */
export function buildBars(briefing) {
    const rows = Array.isArray(briefing?.weekDaily) ? briefing.weekDaily : [];
    return rows.map((r) => {
        const iso = String(r.day ?? '').slice(0, 10);
        const parts = iso.split('-');
        return {
            date: iso,
            label: parts.length === 3 ? `${parts[2]}/${parts[1]}` : iso,
            value: n(r.total),
            invoices: n(r.invoices),
        };
    });
}

/** Payment split — POS first (direction 'in' only), briefing as fallback. */
export function buildPayments(briefing, stats) {
    const fromStats = Array.isArray(stats?.payment_breakdown) ? stats.payment_breakdown : [];
    const rows = fromStats.length
        ? fromStats.map((p) => ({ method: p.method, value: n(p.total), count: n(p.count) }))
        : (Array.isArray(briefing?.payments) ? briefing.payments : [])
            .map((p) => ({ method: p.method, value: n(p.amount), count: n(p.count) }));
    return rows
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value)
        .map((r) => ({
            method: r.method,
            label: METHOD_LABELS[r.method] || String(r.method ?? 'غير محدد'),
            value: r.value,
            count: r.count,
        }));
}

/** Best sellers today, by real line totals. */
export function buildTops(briefing) {
    const rows = Array.isArray(briefing?.topItems) ? briefing.topItems : [];
    return rows.slice(0, 5).map((t) => ({
        name: String(t.name ?? '—'),
        value: n(t.total),
        qty: n(t.qty),
    }));
}

/**
 * The invoice flow, as the enum actually stores it
 * (database/migrations/003_cashier_module.sql:71 →
 *  draft | issued | reported | failed | cancelled).
 *
 * `draft` is not returned by the stats query, so it is what is left of
 * today's orders after the three known states — clamped at zero, because a
 * negative "draft" count would be arithmetic noise, not a fact.
 */
export function buildPipeline(stats) {
    const s = stats?.summary || {};
    const issued = n(s.issued_count);
    const reported = n(s.reported_count);
    const voided = n(s.voided_count);
    const orders = n(s.orders_count);
    const draft = Math.max(0, orders - issued - reported - voided);
    return {
        steps: [
            { key: 'draft', label: 'مسودة', count: draft, state: 'todo' },
            { key: 'issued', label: 'صادرة', count: issued, state: 'current' },
            { key: 'reported', label: 'مُبلَّغة', count: reported, state: 'done' },
        ],
        voided,
        orders,
        revenue: n(s.total_revenue),
        tax: n(s.total_tax),
        discounts: n(s.total_discounts),
    };
}

/**
 * تفصيل سند واحد (أصنافه ومدفوعاته وبياناته الضريبية) — من مرآة YaraSoft.
 * @param {string|number} docNo رقم السند
 */
export async function fetchOrderDetail(docNo) {
    return apiFetch(`/pos/orders/ys/${encodeURIComponent(String(docNo))}`);
}

/**
 * إيصال POS كتصميم طباعة HTML — نقطة النهاية محمية برؤوس المصادقة فقط،
 * وقفزة المتصفح (href/target) لا تحمل x-api-key فترجع 401. لذلك يُجلب
 * الرد خام بـ fetch برؤوس `window._jwt`/`window._appKey` (نفس نمط
 * fetchLuxCardHtml في employee-card-repo.js) والشاشة تكتبه في عارض V2.
 * @param {string|number} docNo رقم السند
 * @returns {Promise<string>} صفحة الإيصال كما ولّدها الخادم
 */
export async function fetchReceiptHtml(docNo) {
    const headers = {};
    if (typeof window !== 'undefined' && window._jwt) {headers.Authorization = `Bearer ${window._jwt}`;}
    if (typeof window !== 'undefined' && window._appKey) {headers['x-api-key'] = window._appKey;}
    const res = await fetch(`${API_BASE}/pos/orders/ys/${encodeURIComponent(String(docNo))}/receipt-html`, { headers });
    if (!res.ok) {
        let msg = `تعذر توليد الإيصال (${res.status})`;
        try {
            const e = await res.clone().json();
            if (e && (e.message || e.error)) {msg = e.message || e.error;}
        } catch (_) { /* صفحة HTML — يبقى الردّ العام + الرمز */ }
        throw new Error(msg);
    }
    return res.text();
}

/**
 * كل الفواتير بتفاصيلها (نطاق تواريخ) — من مرآة YaraSoft.
 * @param {{from?:string, to?:string, limit?:number}} [opts]
 * @returns {Promise<{from:string, to:string, totals:object, rows:Array}>}
 */
export async function fetchAllOrders({ from, to, limit = 500 } = {}) {
    const q = new URLSearchParams();
    if (from) {q.set('from', String(from));}
    if (to) {q.set('to', String(to));}
    q.set('limit', String(limit));
    return apiFetch(`/pos/orders/list?${q.toString()}`);
}

/**
 * أحدث السندات (من مرآة YaraSoft — مصدرُ المبيعات الحقيقي).
 * ملاحظة: pos_orders عندنا فارغ (البيع من YaraSoft)، فالسندات تُقرأ من
 * ys_mirror_orders عبر /pos/orders/stats/today.
 */
export function buildRecent(stats) {
    const rows = Array.isArray(stats?.recent_orders) ? stats.recent_orders : [];
    return rows.slice(0, 8).map((o) => {
        const time = String(o.doc_time ?? '');
        return {
            id: o.invoice_counter,
            counter: String(o.invoice_counter ?? '—'),
            amount: n(o.total_amount),
            net: n(o.net_amount),
            vat: n(o.vat_amount),
            status: 'issued',
            dept: String(o.department_name || o.dept_name || o.dept_id || '—'),
            cashier: String(o.cashier_no ?? ''),
            time: time ? time.slice(0, 5) : '',
        };
    });
}

/** Departments ranked by today's real revenue, each against its own yesterday. */
export function buildDepartments(briefing) {
    const rows = Array.isArray(briefing?.cashiers) ? briefing.cashiers : [];
    const y = briefing?.cashiersYDetail || {};
    return rows.slice(0, 6).map((r) => {
        const code = String(r.code ?? '');
        const prev = y[code]?.total;
        return {
            code,
            name: String(r.name ?? code ?? '—'),
            invoices: n(r.invoices),
            total: n(r.total),
            delta: deltaOf(r.total, prev, 'higher'),
            hasBase: n(prev) > 0,
        };
    });
}

/**
 * "Needs a decision" — the only list on the screen that is allowed to be
 * empty, and then it says so instead of hiding the card.
 */
export function buildAlerts(briefing) {
    const b = briefing || {};
    const out = [];
    const stockOut = Array.isArray(b.stockOut) ? b.stockOut : [];
    const forecast = Array.isArray(b.forecast) ? b.forecast : [];
    const pending = b.pending || {};
    const health = b.syncHealth || {};
    const att = b.attendance || {};

    stockOut.slice(0, 3).forEach((s) => {
        out.push({ tone: 'danger', text: `${s.name} — نافذ من المخزن`, sub: `${formatInt(s.qty)} ${s.unit || ''}`.trim() });
    });
    forecast.slice(0, 3).forEach((s) => {
        out.push({ tone: 'warning', text: `${s.name} — ينفد خلال ${formatMoney(s.days_cover)} يوم`, sub: `المعدل ${formatMoney(s.avg_day)} ${s.unit || ''}/يوم`.trim() });
    });
    if (n(pending.leavesPending) > 0) {
        out.push({ tone: 'info', text: `${formatInt(pending.leavesPending)} إجازة بانتظار القرار`, sub: 'الموارد البشرية' });
    }
    if (n(pending.reviewItems) > 0) {
        out.push({ tone: 'info', text: `${formatInt(pending.reviewItems)} بند مبيعات يحتاج مراجعة`, sub: 'التكامل المحاسبي' });
    }
    if (n(att.missing_out) > 0) {
        out.push({ tone: 'warning', text: `${formatInt(att.missing_out)} موظف نسي تسجيل الخروج`, sub: 'الحضور' });
    }
    if (n(health.zkTotal) > 0 && n(health.zkOnline) < n(health.zkTotal)) {
        out.push({ tone: 'danger', text: `${formatInt(n(health.zkTotal) - n(health.zkOnline))} جهاز بصمة غير متصل`, sub: 'الأجهزة' });
    }

    const rank = { danger: 0, warning: 1, info: 2 };
    return out.sort((a, b2) => rank[a.tone] - rank[b2.tone]).slice(0, 6);
}

export function buildMeta(briefing, stats) {
    const health = briefing?.syncHealth || {};
    const ys = health.ysLog || {};
    return {
        day: String(briefing?.day ?? stats?.date ?? ''),
        generatedAt: String(briefing?.generatedAt ?? ''),
        punchesToday: n(health.punchesToday),
        zkOnline: n(health.zkOnline),
        zkTotal: n(health.zkTotal),
        ysFailed: n(ys.FAILED ?? ys.failed),
    };
}

/**
 * One call, one view model. Either source may be null (403, network error) —
 * the screen decides how to say that, the repository never papers over it.
 */
export function buildBriefingView({ briefing = null, stats = null, currency = '' } = {}) {
    return {
        kpis: buildKpis(briefing, stats, currency),
        bars: buildBars(briefing),
        payments: buildPayments(briefing, stats),
        tops: buildTops(briefing),
        pipeline: buildPipeline(stats),
        recent: buildRecent(stats),
        departments: buildDepartments(briefing),
        alerts: buildAlerts(briefing),
        meta: buildMeta(briefing, stats),
        sources: { briefing: briefing ? 'ok' : 'missing', stats: stats ? 'ok' : 'missing' },
    };
}
