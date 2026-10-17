/**
 * V2 — Oracle data repository (الباب الوحيد إلى /api/oracle-data + daily-locks)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET  /oracle-data/tables              → { ok, tables[{pg_name,
 *     oracle_name, oracle_rows, imported_at, live_count}] } (admin/manager/
 *     accountant/auditor/hr — oracle-data-routes.js:18-23)
 *   GET  /oracle-data/:table?page&limit&search → { ok, table, columns[],
 *     rows[], total, page, totalPages } (:63-70, حد 200)
 *   POST /oracle-data/refresh             → مزامنة (:125, نفس الأدوار)
 *   GET  /yara-reports/daily-locks?date=  → { ok, date, locked, unlocked,
 *     rows[{dept_code,dept_name,lock_count,gross,refund,net,invoices,
 *     refunds}] } (yara-reports.js:477)
 */

import { apiFetch } from '../../core/api.js?v=4.9.148';

export const ORA_READ_ROLES = ['admin', 'manager', 'accountant', 'auditor', 'hr'];

export async function fetchOraTables() {
    const r = await apiFetch('/oracle-data/tables');
    if (r && r.ok === false) {throw new Error(r.error || 'خطأ');}
    return Array.isArray(r.tables) ? r.tables : [];
}

export async function refreshOraTables() {
    const r = await apiFetch('/oracle-data/refresh', { method: 'POST' });
    if (r && r.ok === false) {throw new Error(r.error || 'خطأ');}
    return r;
}

export async function fetchOraTable(pgName, { page = 1, limit = 50, search = '' } = {}) {
    const short = String(pgName || '').replace(/^ora_/, '');
    const q = `?page=${page}&limit=${Math.min(200, Math.max(1, limit))}&search=${encodeURIComponent(search)}`;
    const r = await apiFetch(`/oracle-data/${encodeURIComponent(short)}${q}`);
    if (r && r.ok === false) {throw new Error(r.error || 'خطأ');}
    return {
        table: r.table || pgName,
        columns: Array.isArray(r.columns) ? r.columns : [],
        rows: Array.isArray(r.rows) ? r.rows : [],
        total: Number(r.total) || 0,
        page: Number(r.page) || 1,
        totalPages: Number(r.totalPages) || 1,
    };
}

export async function fetchDailyLocks(date) {
    const r = await apiFetch(`/yara-reports/daily-locks?date=${encodeURIComponent(date)}`);
    if (r && r.ok === false) {throw new Error(r.error || 'خطأ');}
    const rows = Array.isArray(r.rows) ? r.rows : [];
    return {
        date: r.date || date,
        locked: Number(r.locked) || 0,
        unlocked: Number(r.unlocked) || 0,
        rows,
        totalNet: rows.reduce((s, x) => s + (Number(x.net) || 0), 0),
        totalInv: rows.reduce((s, x) => s + (Number(x.invoices) || 0), 0),
    };
}
