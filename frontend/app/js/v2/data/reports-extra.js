/**
 * V2 — Extra reports repository (التقارير التسعة خارج مبيعات POS)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT SOURCES (nothing invented):
 *  local computations mirror features/reports.js:268-487 verbatim —
 *    general (:268: كل المصاريف تُحسب، عينة 30 مرتبة بالتاريخ) ·
 *    department (:308: calcStats لكل قسم) · kitchen (:336: معتمد فقط +
 *    قيمة approvedValue + عدد الوصفات) · returns (:365: kitchenReturns +
 *    totalValue) · warehouse (:390: قيمة/عدد/وزن/تحت الحد — قسم الرفوف
 *    محذوف بقرار المالك: لا أرفف ولا موازين) · hr (:438: نشطون/رواتب/
 *    حضور/إجازات) · dept-specific (:466: قسم واحد)
 *  server doors mirror the legacy fetch lines:
 *    GET /yara-reports/departments?from&to&group (reports.js:494)
 *    GET /yara-reports/cashier-items?from&to&view&cashier&limit&page (:546)
 *    GET /yarasoft/sections/invoice-detail?ref=ora:CC:doc (reports.js:660,
 *      backend/yarasoft/routes.js:808)
 *
 * تصنيف المصروف التشغيلي منسوخ من القديم حرفًا (auth-navigation.js:398):
 * NOT IN dispatch/dispatch_return/transfer/receipt/stock_transfer/
 * inventory_transfer/kitchen_return/count_correction — لاحظ 'transfer'
 * التي لا تشملها STOCK_TYPES في finance-repo (تُركت هناك لعقدها).
 */

import { apiFetch } from '../../core/api.js?v=4.9.187';
import { fetchRevenues, fetchExpenses, fetchDepartments, calcDeptStats } from './finance-repo.js?v=4.9.187';
import { fetchDispatches } from './dispatch-repo.js?v=4.9.187';
import { fetchKitchenReturns } from './warehouse-repo.js?v=4.9.187';
import { fetchInventory } from './inventory-repo.js?v=4.9.187';
import { fetchRecipes } from './recipes-repo.js?v=4.9.187';
import { fetchEmployees } from './employees-repo.js?v=4.9.187';
import { fetchLeaveWorkflow } from './leaves-repo.js?v=4.9.187';
import { fetchAttendanceRange } from './attendance-repo.js?v=4.9.187';

export const EXTRA_REPORT_TYPES = [
    'general', 'department', 'kitchen', 'returns', 'warehouse', 'hr',
    'dept-specific', 'yara-departments', 'yara-cashiers',
];

const NOT_OPERATING = new Set(['dispatch', 'dispatch_return', 'transfer', 'receipt',
    'stock_transfer', 'inventory_transfer', 'kitchen_return', 'count_correction']);

function normType(e) {
    return String((e && (e.adjustmentType || e.adjustment_type)) || '').toLowerCase();
}

export function isOperatingExpenseLocal(e) {
    return !NOT_OPERATING.has(normType(e));
}

function inRangeDay(dateStr, from, to) {
    const d = String(dateStr || '').slice(0, 10);
    return (!from || d >= from) && (!to || d <= to);
}

function sum(list, f) {
    return (list || []).reduce((s, x) => s + (Number(f(x)) || 0), 0);
}

/* ── الحزم: تُجلب مرة واحدة وتُحفظ في الشاشة ───────────────────────────── */

export async function fetchLocalBundle() {
    const [revenues, expenses, departments, dispatches, returns, inventory, recipes, leaves, employees] = await Promise.all([
        fetchRevenues(), fetchExpenses(), fetchDepartments(), fetchDispatches(),
        fetchKitchenReturns(), fetchInventory(), fetchRecipes().catch(() => []),
        fetchLeaveWorkflow().catch(() => []), fetchEmployees().catch(() => []),
    ]);
    return {
        revenues: Array.isArray(revenues) ? revenues : [],
        expenses: Array.isArray(expenses) ? expenses : [],
        departments: Array.isArray(departments) ? departments : [],
        dispatches: Array.isArray(dispatches) ? dispatches : [],
        returns: Array.isArray(returns) ? returns : [],
        inventory: Array.isArray(inventory) ? inventory : [],
        recipes: Array.isArray(recipes) ? recipes : [],
        leaves: Array.isArray(leaves) ? leaves : [],
        employees: Array.isArray(employees) ? employees : [],
    };
}

export async function fetchHrAttendance(from, to) {
    try {
        const r = await fetchAttendanceRange({ from, to });
        if (Array.isArray(r)) {return r;}
        if (r && Array.isArray(r.rows)) {return r.rows;}
        if (r && Array.isArray(r.data)) {return r.data;}
        return [];
    } catch {return [];}
}

/* ── الحسابات المحلية (pure) ───────────────────────────────────────────── */

export function computeGeneral(bundle, from, to) {
    const revs = (bundle.revenues || []).filter((r) => inRangeDay(r.date, from, to));
    const exps = (bundle.expenses || []).filter((e) => inRangeDay(e.date, from, to));
    const totalRev = sum(revs, (r) => r.amount);
    const totalExp = sum(exps, (e) => e.amount);
    const tagged = [
        ...revs.map((r) => ({ date: r.date, kind: 'revenue', ref: r })),
        ...exps.filter(isOperatingExpenseLocal).map((e) => ({ date: e.date, kind: 'operating', ref: e })),
        ...exps.filter((e) => !isOperatingExpenseLocal(e)).map((e) => ({ date: e.date, kind: 'stock', ref: e })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 30);
    return { totalRev, totalExp, profit: totalRev - totalExp, count: revs.length + exps.length, sample: tagged };
}

export function computeDepartments(bundle, from, to) {
    return (bundle.departments || []).map((d) => {
        const s = calcDeptStats(bundle.revenues, bundle.expenses, bundle.departments, d.code, from, to);
        return { code: d.code, name: d.name, rev: s.rev, exp: s.exp, profit: s.profit, costRatio: s.costRatio };
    });
}

export function computeKitchen(bundle, from, to) {
    const approved = (bundle.dispatches || []).filter((d) =>
        inRangeDay(d.date, from, to) && d.status === 'approved');
    const valueOf = (d) => sum(d.approvedItems, (i) => i.approvedValue);
    return {
        count: approved.length,
        totalValue: approved.reduce((s, d) => s + valueOf(d), 0),
        recipesCount: (bundle.recipes || []).length,
        rows: approved.map((d) => ({
            date: d.date, dept: d.deptName,
            itemsText: (d.items || []).map((i) => `${i.itemName} (${i.qty} ${i.unit})`).join('، '),
            value: valueOf(d),
        })),
    };
}

export function computeReturns(bundle, from, to) {
    const list = (bundle.returns || []).filter((r) => inRangeDay(r.date, from, to));
    return {
        count: list.length,
        total: list.reduce((s, r) => s + (parseFloat(r.totalValue) || 0), 0),
        rows: list,
    };
}

export function computeWarehouse(bundle) {
    const items = bundle.inventory || [];
    const low = items.filter((i) => Number(i.qty) < Number(i.minQty));
    return {
        totalValue: items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.avgCost) || 0), 0),
        itemCount: items.length,
        totalWeight: items.reduce((s, i) => s + (Number(i.weight) || 0), 0),
        low,
    };
}

export function computeHr(bundle, attendance, from, to) {
    const active = (bundle.employees || []).filter((e) => e && e.status !== 'inactive' && e.active !== false);
    const leaves = (bundle.leaves || []).filter((l) => inRangeDay(l.startDate || l.start_date, from, to));
    const attByEmp = new Map();
    for (const a of attendance || []) {
        if (!a.checkIn && !a.check_in) {continue;}
        const k = String(a.employeeId || a.employee_id || '');
        attByEmp.set(k, (attByEmp.get(k) || 0) + 1);
    }
    return {
        total: (bundle.employees || []).length,
        activeCount: active.length,
        salaries: active.reduce((s, e) => s + (Number(e.salary) || 0), 0),
        leavesCount: leaves.length,
        rows: active.map((e) => ({
            id: e.employeeId, name: e.name, dept: e.department, position: e.position,
            salary: Number(e.salary) || 0,
            days: attByEmp.get(String(e.id)) || attByEmp.get(String(e.employeeId)) || 0,
        })),
    };
}

/* ── أبواب يارا ────────────────────────────────────────────────────────── */

export async function fetchYaraDepartments({ from, to, group }) {
    const p = new URLSearchParams({ from, to, group });
    const data = await apiFetch(`/yara-reports/departments?${p.toString()}`);
    return {
        rows: Array.isArray(data && data.rows) ? data.rows : [],
        totals: (data && data.totals) || {},
    };
}

export async function fetchYaraCashierItems({
    from, to, view = 'items', cashier = '', cashiers = [], limit = 100, page = 1, summaryOnly = false, live = false,
}) {
    const p = new URLSearchParams({ from, to, view, limit: String(limit) });
    if (cashier) {p.set('cashier', cashier);}
    if (!cashier && cashiers.length) {p.set('cashiers', cashiers.join(','));}
    if (summaryOnly) {p.set('summary_only', '1');}
    if (live) {p.set('live', '1');}
    if (view === 'invoices') {p.set('page', String(page));}
    const data = await apiFetch(`/yara-reports/cashier-items?${p.toString()}`);
    return {
        rows: Array.isArray(data && data.rows) ? data.rows : [],
        totals: (data && data.totals) || {},
        cashiers: Array.isArray(data && data.cashiers) ? data.cashiers : [],
        view: (data && data.view) || view,
        page: Number((data && data.page) || page) || 1,
        pages: Number((data && data.pages) || 1) || 1,
        total: Number((data && data.total) || 0) || 0,
    };
}

export async function fetchYaraInvoiceDetail(docNo) {
    const data = await apiFetch(`/yarasoft/sections/invoice-detail?ref=${encodeURIComponent(`ora:CC:${docNo}`)}`);
    return {
        header: (data && data.header) || {},
        lines: Array.isArray(data && data.lines) ? data.lines : [],
    };
}
