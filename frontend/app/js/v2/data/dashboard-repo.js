/**
 * V2 — Role dashboards repository (P2-7)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Three dashboards, one door each — every source is an endpoint the legacy
 * dashboard already reads for the same role (features/dashboard.js:70-133):
 *
 *   accountant   GET /finance/pnl          (server-built statement, month)
 *                GET /revenues|/expenses   (newest 6 rows each)
 *                GET /settings/main_settings (currency)
 *   warehouse    GET /warehouse/inventory/search?stock=low|out|all
 *                GET /dispatches           (decision queue counts)
 *                GET /warehouse/purchase-requests (PR queue count)
 *   dept_head    GET /warehouse/dept-panel  (Task 28 panel: expenses by source,
 *                                           sub-departments, dispatch counts)
 *                GET /dispatches           (this department's rows)
 *
 * WHY THESE SOURCES
 *   The accountant's month figures come from the server's P&L statement, not
 *   from a client-side walk — POS feeds tens of thousands of revenue rows and
 *   a bounded walk would silently undercount the month. The newest lists are
 *   one page each and are never totalled.
 *
 * HONESTY RULES
 *   • A failed source becomes `null` and is named in `failures`; the screens
 *     paint what answered instead of a zero that looks like real data.
 *   • Counts are the server's own `pagination.total` for the stock filters —
 *     the three filters are disjoint on the server (`qty<=0`, `0<qty<=min`,
 *     `qty>min`), so ok = all - low - out is exact, not an estimate.
 *   • A percentage without a base is `null`, and the screen prints «—».
 *   • Nothing here decides permission; a 403 from the server is surfaced as
 *     the source failure it is.
 *
 * THIS FILE NEVER WRITES.
 */

import { apiFetch } from '../../core/api.js?v=4.9.149';
import { fetchPnl, fetchNewest } from './finance-repo.js?v=4.9.149';
import { fetchInventory, stockState } from './inventory-repo.js?v=4.9.149';
import { fetchDispatches, itemsSummary, chainStage, rowDeptMatches } from './dispatch-repo.js?v=4.9.149';
import { fetchPurchaseRequests } from './pr-repo.js?v=4.9.149';
import { fetchCurrency } from './reports-repo.js?v=4.9.149';

const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
};

function failureNames(results, names) {
    return results.reduce((out, r, i) => {
        if (r.status === 'rejected') {out.push(names[i]);}
        return out;
    }, []);
}

/* ── Fetching ────────────────────────────────────────────────────────── */

export async function fetchAccountantSnapshot() {
    const results = await Promise.allSettled([
        fetchPnl(),
        fetchNewest('revenues', 6),
        fetchNewest('expenses', 6),
        fetchCurrency(),
    ]);
    const [pnl, rev, exp, cur] = results;
    return {
        pnl: pnl.status === 'fulfilled' ? pnl.value : null,
        pnlError: pnl.status === 'rejected' ? pnl.reason : null,
        latestRevenues: rev.status === 'fulfilled' ? (rev.value || []) : [],
        latestExpenses: exp.status === 'fulfilled' ? (exp.value || []) : [],
        currency: cur.status === 'fulfilled' ? String(cur.value || '') : '',
        failures: failureNames(results, ['قائمة الدخل', 'الإيرادات', 'المصروفات', 'العملة']),
    };
}

export async function fetchWarehouseSnapshot() {
    const results = await Promise.allSettled([
        fetchInventory({ stock: 'low', maxPages: 1 }),
        fetchInventory({ stock: 'out', maxPages: 1 }),
        fetchInventory({ stock: 'all', maxPages: 1 }),
        fetchDispatches(),
        fetchPurchaseRequests(),
    ]);
    const [low, out, all, disp, prs] = results;
    return {
        low: low.status === 'fulfilled' ? low.value : null,
        out: out.status === 'fulfilled' ? out.value : null,
        all: all.status === 'fulfilled' ? all.value : null,
        dispatches: disp.status === 'fulfilled' ? (disp.value || []) : [],
        purchaseRequests: prs.status === 'fulfilled' ? (prs.value || []) : [],
        failures: failureNames(results, ['المخزون (تحت الحد)', 'المخزون (نافد)', 'إجمالي المخزون', 'أذونات الصرف', 'طلبات الشراء']),
    };
}

export async function fetchDeptHeadSnapshot() {
    const results = await Promise.allSettled([
        fetchDispatches(),
        apiFetch('/warehouse/dept-panel'),
        fetchCurrency(),
    ]);
    const [disp, panel, cur] = results;
    return {
        dispatches: disp.status === 'fulfilled' ? (disp.value || []) : [],
        panel: panel.status === 'fulfilled' ? panel.value : null,
        panelError: panel.status === 'rejected' ? panel.reason : null,
        // Currency is a display aid: its failure is not a dashboard-source
        // failure, and the amounts stay honest without a unit.
        currency: cur.status === 'fulfilled' ? String(cur.value || '') : '',
        failures: failureNames(results.slice(0, 2), ['أذونات الصرف', 'لوحة القسم']),
    };
}

/* ── Pure views ──────────────────────────────────────────────────────── */

const statusOf = (d) => String((d && d.status) || '');

export function buildAccountantView(snapshot = {}) {
    const pnl = snapshot.pnl || null;
    const st = (pnl && pnl.statement) || {};
    const rev = st.revenue || {};
    const cogs = st.cogs || {};
    const op = st.operating || {};
    const pr = st.payroll || {};
    const sh = st.shrinkage || {};
    const np = st.net_profit || {};
    const revenue = n(rev.total);
    const profit = n(np.amount);
    const cost = revenue - profit;
    const daily = Array.isArray(st.daily_series) ? st.daily_series : [];
    const depts = Array.isArray(st.by_department) ? st.by_department : [];

    return {
        hasPnl: !!pnl,
        pnlFailed: !!snapshot.pnlError,
        pnlMessage: snapshot.pnlError ? String(snapshot.pnlError.message || '') : '',
        period: (pnl && pnl.period) || {},
        currency: String(snapshot.currency || ''),
        totals: {
            revenue,
            cost,
            profit,
            invoices: n(rev.invoice_count),
            manual: n(rev.manual_count),
            margin: revenue > 0 ? (profit / revenue) * 100 : null,
            costRatio: revenue > 0 ? (cost / revenue) * 100 : null,
        },
        breakdown: {
            cogs: n(cogs.net),
            operating: n(op.total),
            payroll: n(pr.total),
            shrinkage: n(sh.amount),
        },
        daily: daily.map((d) => ({
            date: String((d && d.date) || '').slice(0, 10),
            revenue: n(d && d.revenue),
            cogs: n(d && d.cogs),
            opex: n(d && d.opex),
            cost: n(d && d.cogs) + n(d && d.opex),
        })),
        departments: depts.map((d) => ({
            code: String((d && d.code) || ''),
            name: String((d && d.name) || (d && d.code) || '—'),
            revenue: n(d && d.revenue),
            cogs: n(d && d.cogs),
            net: n(d && d.net),
        })),
        latestRevenues: (Array.isArray(snapshot.latestRevenues) ? snapshot.latestRevenues : []).map((r) => ({
            id: r && r.id,
            label: String((r && r.source) || '—'),
            date: String((r && r.date) || '').slice(0, 10),
            amount: n(r && r.amount),
        })),
        latestExpenses: (Array.isArray(snapshot.latestExpenses) ? snapshot.latestExpenses : []).map((e) => ({
            id: e && e.id,
            label: String((e && (e.desc || e.category)) || '—'),
            date: String((e && e.date) || '').slice(0, 10),
            amount: n(e && e.amount),
        })),
        failures: Array.isArray(snapshot.failures) ? snapshot.failures : [],
    };
}

export function buildWarehouseView(snapshot = {}) {
    const low = snapshot.low || null;
    const out = snapshot.out || null;
    const all = snapshot.all || null;
    const lowTotal = low ? n(low.total) : null;
    const outTotal = out ? n(out.total) : null;
    const allTotal = all ? n(all.total) : null;
    const okTotal = allTotal != null && lowTotal != null && outTotal != null
        ? Math.max(0, allTotal - lowTotal - outTotal)
        : null;

    const seen = new Set();
    const rows = [];
    for (const raw of [...((out && out.rows) || []), ...((low && low.rows) || [])]) {
        const key = String(raw && raw.id);
        if (seen.has(key)) {continue;}
        seen.add(key);
        rows.push({
            id: raw && raw.id,
            name: String((raw && raw.name) || `#${(raw && raw.id) ?? '؟'}`),
            qty: n(raw && raw.qty),
            minQty: n(raw && raw.minQty),
            unit: String((raw && raw.unit) || ''),
            state: stockState(raw && raw.qty, raw && raw.minQty),
        });
    }
    rows.sort((a, b) => a.qty - b.qty);

    const dispatches = Array.isArray(snapshot.dispatches) ? snapshot.dispatches : [];
    const prs = Array.isArray(snapshot.purchaseRequests) ? snapshot.purchaseRequests : [];

    return {
        stock: {
            known: lowTotal != null && outTotal != null && allTotal != null,
            low: lowTotal,
            out: outTotal,
            ok: okTotal,
            total: allTotal,
        },
        lowRows: rows.slice(0, 6),
        queues: {
            chef: dispatches.filter((d) => statusOf(d) === 'pending' && d.needsChefApproval).length,
            warehouse: dispatches.filter((d) => statusOf(d) === 'chef_approved'
                || (statusOf(d) === 'pending' && !d.needsChefApproval)).length,
            purchase: prs.filter((p) => ['pending', 'chef_approved'].includes(String((p && p.status) || ''))).length,
            dispatches: dispatches.length,
            purchases: prs.length,
        },
        failures: Array.isArray(snapshot.failures) ? snapshot.failures : [],
    };
}

const SOURCE_TONE = {
    dispatch: 'warning',
    dispatch_return: 'success',
    purchase_direct: 'info',
    stocktaking: 'info',
    auto_other: 'neutral',
    manual: 'neutral',
};

const DISPATCH_STATUS_AR = {
    pending: 'معلّق',
    chef_approved: 'اعتماد الشيف',
    approved: 'معتمد — بانتظار الاستلام',
    partially_received: 'استلام جزئي',
    received: 'مستلم',
    rejected: 'مرفوض',
};

const DISPATCH_STATUS_TONE = {
    pending: 'warning',
    chef_approved: 'info',
    approved: 'brand',
    partially_received: 'info',
    received: 'success',
    rejected: 'danger',
};

export function buildDeptHeadView(snapshot = {}, user = {}) {
    const all = Array.isArray(snapshot.dispatches) ? snapshot.dispatches : [];
    const mine = all.filter((d) => rowDeptMatches(user, d));
    const panel = snapshot.panel || null;
    const expenseSummary = (panel && panel.expenses) || null;
    const labels = (expenseSummary && expenseSummary.labels) || {};
    const bySource = (expenseSummary && expenseSummary.bySource) || {};

    const sources = Object.entries(bySource).map(([key, v]) => ({
        key,
        label: String(labels[key] || key),
        tone: SOURCE_TONE[key] || 'neutral',
        total: n(v && v.total),
        count: n(v && v.count),
    })).sort((a, b) => b.total - a.total);

    const statusCount = {};
    for (const d of mine) {
        const key = statusOf(d) || 'unknown';
        statusCount[key] = (statusCount[key] || 0) + 1;
    }

    const counts = {
        chef: mine.filter((d) => statusOf(d) === 'pending' && d.needsChefApproval).length,
        warehouse: mine.filter((d) => statusOf(d) === 'chef_approved').length,
        receive: mine.filter((d) => ['approved', 'partially_received'].includes(statusOf(d))).length,
        received: mine.filter((d) => statusOf(d) === 'received').length,
        pending: mine.filter((d) => statusOf(d) === 'pending').length,
    };

    return {
        deptCode: String((user && user.deptCode) || ''),
        currency: String(snapshot.currency || ''),
        deptName: String((panel && panel.department && panel.department.name)
            || (mine.length && mine[mine.length - 1].deptName)
            || (user && user.deptCode) || '—'),
        counts,
        cost: expenseSummary ? n(expenseSummary.total) : null,
        costCount: expenseSummary ? n(expenseSummary.count) : null,
        sources,
        subDepartments: Array.isArray(panel && panel.subDepartments) ? panel.subDepartments : [],
        statusSlices: Object.entries(statusCount).map(([key, count]) => ({
            key,
            label: DISPATCH_STATUS_AR[key] || String(key),
            tone: DISPATCH_STATUS_TONE[key] || 'neutral',
            value: n(count),
        })).sort((a, b) => b.value - a.value),
        recent: mine.slice().reverse().slice(0, 8).map((d) => ({
            id: d && d.id,
            itemsText: itemsSummary(d && d.items),
            date: String((d && d.date) || '').slice(0, 10),
            status: statusOf(d),
            stage: chainStage(d),
        })),
        panelFailed: !panel,
        failures: Array.isArray(snapshot.failures) ? snapshot.failures : [],
    };
}
