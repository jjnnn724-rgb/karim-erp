/**
 * V2 — CFO repository (الباب الوحيد إلى /api/accounting + /api/pos للتقفل)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   accounting-routes.js (:26-27 READ/WRITE roles, :422/:463/:488/:506/
 *     :526/:550/:583): chart · trial-balance · journal · journal POST ·
 *     journal/:id/void · post-payroll · cfo-summary
 *   accounting-periods.js (:58/:82/:109/:139/:186/:229): periods ·
 *     periods/:p/close · periods/:p/open (admin) · journal/:id/approve ·
 *     balance-sheet · cash-flow
 *   accounting-growth.js (:55/:84/:135/:157/:188/:230/:249/:270/:288/:301/
 *     :322/:341): profit-by-cost-center · ap-aging · bank-statements POST ·
 *     bank-rec · bank-rec/auto-match · cash-custody · cash-custody POST ·
 *     cash-custody/:id/ack · fixed-assets · fixed-assets POST ·
 *     fixed-assets/:id/dispose · depreciation/run
 *   budget-alerts.js (:49/:70/:117/:253/:261): budgets POST · budgets/:id
 *     DELETE · budget-vs-actual · alerts/log · alerts/run
 *   cashier-module/shift-routes.js (:880) + day-close-routes.js (:88/:117):
 *     /pos/shifts/open · /pos/shifts/:id/close · /pos/day-close/status ·
 *     /pos/day-close
 *
 * عمدًا خارج الباب (لا زرّ لها): chart POST · vat-return · drafts ·
 * cost-centers POST — القديم لا يستخدمها في هذه الشاشة.
 */

import { apiFetch } from '../../core/api.js?v=4.9.169';
import { fetchCurrency } from './reports-repo.js?v=4.9.169';
import { fetchMainSettings } from './portal-repo.js?v=4.9.169';

/** بوابة القراءة/الكتابة مرآة الخادم (accounting-routes.js:26-27). */
export const CFO_READ_ROLES = ['admin', 'accountant', 'manager', 'auditor'];
export const CFO_WRITE_ROLES = ['admin', 'accountant'];

export const fetchCfoCurrency = () => fetchCurrency();

/** اسم المنشأة لترويسة المطبوعات — من صف الإعدادات الواحد. */
export async function fetchBrandName() {
    try {
        const ms = await fetchMainSettings();
        const row = Array.isArray(ms) ? ms[0] : ms;
        return row && (row.name || row.company_name) ? String(row.name || row.company_name) : '';
    } catch {return '';}
}

/* ── اللوحة والميزان واليومية ─────────────────────────────────────────── */

export async function fetchCfoSummary(from, to) {
    return apiFetch(`/accounting/cfo-summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

export async function fetchTrialBalance(from, to) {
    return apiFetch(`/accounting/trial-balance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

export async function fetchJournal(limit = 30) {
    return apiFetch(`/accounting/journal?limit=${encodeURIComponent(limit)}`);
}

export async function fetchChart() {
    return apiFetch('/accounting/chart');
}

/**
 * قيد يدوي — الحمولة نفسها في القديم (cfo.js:96): date/memo/lines/status.
 * @returns الخادم يرد القيد المحفوظ
 */
export async function createJournal({ date, memo, lines, status }) {
    return apiFetch('/accounting/journal', {
        method: 'POST', body: JSON.stringify({ date, memo, lines, status }),
    });
}

/** فحص الإرسال المحلي — نفس قاعدة القديم (cfo.js:92): سطر بحساب ومبلغ. */
export function collectJournalLines(rows = []) {
    const lines = [];
    for (const r of rows) {
        const account_code = String(r.account_code || '').trim();
        const debit = Number(r.debit) || 0;
        const credit = Number(r.credit) || 0;
        if (account_code && (debit > 0 || credit > 0)) {lines.push({ account_code, debit, credit });}
    }
    return lines;
}

export async function approveJournal(id) {
    return apiFetch(`/accounting/journal/${encodeURIComponent(id)}/approve`, { method: 'POST' });
}

export async function voidJournal(id) {
    return apiFetch(`/accounting/journal/${encodeURIComponent(id)}/void`, { method: 'POST', body: JSON.stringify({}) });
}

export async function postPayroll(month) {
    return apiFetch('/accounting/post-payroll', { method: 'POST', body: JSON.stringify({ month }) });
}

/* ── الفترات ──────────────────────────────────────────────────────────── */

export async function fetchPeriods() {
    return apiFetch('/accounting/periods');
}

export async function closePeriod(period, note) {
    return apiFetch(`/accounting/periods/${encodeURIComponent(period)}/close`, {
        method: 'POST', body: JSON.stringify({ note: note || '' }),
    });
}

export async function openPeriod(period) {
    return apiFetch(`/accounting/periods/${encodeURIComponent(period)}/open`, {
        method: 'POST', body: JSON.stringify({}),
    });
}

/* ── القوائم ──────────────────────────────────────────────────────────── */

export async function fetchBalanceSheet(asOf) {
    return apiFetch(`/accounting/balance-sheet?as_of=${encodeURIComponent(asOf)}`);
}

export async function fetchCashFlow(from, to) {
    return apiFetch(`/accounting/cash-flow?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

/* ── النمو: مراكز/ذمم/بنك/أصول/عهد/موازنات/تنبيهات ─────────────────────── */

export async function fetchProfitByCC(from, to) {
    return apiFetch(`/accounting/profit-by-cost-center?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

export async function fetchApAging() {
    return apiFetch('/accounting/ap-aging');
}

export async function fetchBankRec(account, from, to) {
    return apiFetch(`/accounting/bank-rec?account=${encodeURIComponent(account)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

export async function autoMatchBank(account = '1010') {
    return apiFetch('/accounting/bank-rec/auto-match', {
        method: 'POST', body: JSON.stringify({ account }),
    });
}

export async function addBankStatement(rows) {
    return apiFetch('/accounting/bank-statements', {
        method: 'POST', body: JSON.stringify({ rows }),
    });
}

export async function fetchAssets() {
    return apiFetch('/accounting/fixed-assets');
}

export async function createAsset({ name, cost, life_months }) {
    return apiFetch('/accounting/fixed-assets', {
        method: 'POST', body: JSON.stringify({ name, cost, life_months }),
    });
}

export async function disposeAsset(id) {
    return apiFetch(`/accounting/fixed-assets/${encodeURIComponent(id)}/dispose`, { method: 'POST' });
}

export async function runDepreciation() {
    return apiFetch('/accounting/depreciation/run', { method: 'POST', body: JSON.stringify({}) });
}

export async function fetchCustody() {
    return apiFetch('/accounting/cash-custody');
}

export async function handCustody(to_cashier, amount) {
    return apiFetch('/accounting/cash-custody', {
        method: 'POST', body: JSON.stringify({ to_cashier, amount }),
    });
}

export async function ackCustody(id) {
    return apiFetch(`/accounting/cash-custody/${encodeURIComponent(id)}/ack`, { method: 'POST' });
}

export async function fetchBudgetVsActual(period) {
    return apiFetch(`/accounting/budget-vs-actual?period=${encodeURIComponent(period)}`);
}

export async function createBudget({ period, label, account_code, amount }) {
    return apiFetch('/accounting/budgets', {
        method: 'POST', body: JSON.stringify({ period, label, account_code, amount }),
    });
}

export async function deleteBudget(id) {
    return apiFetch(`/accounting/budgets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchAlertsLog() {
    return apiFetch('/accounting/alerts/log');
}

export async function runAlerts() {
    return apiFetch('/accounting/alerts/run', { method: 'POST' });
}

/* ── الورديات والإقفال (أبواب الكاشير — تُستخدم هنا مركزيًا فقط) ──────── */

export async function fetchOpenShifts() {
    return apiFetch('/pos/shifts/open');
}

export async function closeShiftRemote(id, actual_cash) {
    return apiFetch(`/pos/shifts/${encodeURIComponent(id)}/close`, {
        method: 'POST', body: JSON.stringify({ actual_cash, notes: 'إغلاق مركزي من المحاسبة' }),
    });
}

export async function dayCloseStatus() {
    return apiFetch('/pos/day-close/status');
}

export async function execDayClose(date) {
    return apiFetch('/pos/day-close', {
        method: 'POST', body: JSON.stringify({ date, counts: {}, manager_approve: true }),
    });
}
