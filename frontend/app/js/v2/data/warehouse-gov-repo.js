/**
 * V2 — Warehouse governance repository (P2-4)
 * ═══════════════════════════════════════════════════════════════════════
 * THE DOORS, COPIED FROM THE SERVER — NOT INVENTED
 *   GET  /warehouse/fiscal-years                  → fiscal rows (array)
 *          roles admin|manager|accountant (inventory-control-routes.js:329)
 *   POST /warehouse/fiscal-years                  → 201 row
 *          body {startDate, endDate, yearCode?, name?, notes?} (:339)
 *          start/end MUST match YYYY-MM-DD and end >= start; yearCode
 *          defaults to the start year; name defaults to
 *          «السنة المالية {yearCode}» and is cut at 120 chars.
 *   POST /warehouse/fiscal-years/:id/close        → {fiscalYear, closingSnapshot}
 *          ADMIN ONLY (:356). Refuses with 409 while a POS shift is open or
 *          an inventory audit inside the year is still draft/submitted.
 *   POST /warehouse/fiscal-years/:id/create-next  → 201 row
 *          ADMIN ONLY (:383). Previous year must be closed.
 *   GET  /warehouse/opening-balance/report        → {invoices:[…]}
 *          roles admin|manager|warehouse (warehouse-routes.js:2815), READ ONLY.
 *   GET  /warehouse/system-health                 → {ok, itemsTotal, …}
 *          ADMIN ONLY (warehouse-routes.js:2871), READ ONLY.
 *
 * WHAT THE CLIENT ADDS
 *   A form validator that repeats the server's own date rule instead of
 *   letting a malformed date reach Postgres, a payload carrying only the five
 *   fields the server reads, and pure mappers so the screen never guesses a
 *   number or an amount. Nothing here decides a role: the server re-checks
 *   every call, and the screen's double lock is presentation only.
 *
 * WHAT THIS FILE DOES NOT DO
 *   No deletion, no "clear", no cancel. Closing is irreversible on the server
 *   (status flips to closed and a snapshot is stored), which is why the screen
 *   asks first and the server still re-checks every guard.
 */

import { apiFetch } from '../../core/api.js?v=4.9.185';

/** Mirrors the requireRole() lists on the six doors above. */
export const FISCAL_READ_ROLES = ['admin', 'manager', 'accountant'];
export const FISCAL_CREATE_ROLES = ['admin', 'manager', 'accountant'];
export const FISCAL_CLOSE_ROLES = ['admin'];
export const OPENING_READ_ROLES = ['admin', 'manager', 'warehouse'];
export const HEALTH_READ_ROLES = ['admin'];

/** Union of every card this screen can draw — used by the register's entry
 *  button so a role with no readable card is never offered an empty screen. */
export function hasGovernanceRead(role) {
    const r = String(role || '');
    return FISCAL_READ_ROLES.includes(r) || OPENING_READ_ROLES.includes(r) || HEALTH_READ_ROLES.includes(r);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const day = (v) => String(v == null ? '' : v).slice(0, 10);

function objectOf(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {return value;}
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

/* ── Doors ─────────────────────────────────────────────────────────────── */

export async function fetchFiscalYears() {
    const rows = await apiFetch('/warehouse/fiscal-years');
    return Array.isArray(rows) ? rows : [];
}

export async function createFiscalYear(form) {
    return apiFetch('/warehouse/fiscal-years', {
        method: 'POST',
        body: JSON.stringify(normalizeFiscalYearForm(form)),
    });
}

export async function closeFiscalYear(id) {
    return apiFetch(`/warehouse/fiscal-years/${encodeURIComponent(id)}/close`, { method: 'POST' });
}

export async function createNextFiscalYear(id) {
    return apiFetch(`/warehouse/fiscal-years/${encodeURIComponent(id)}/create-next`, { method: 'POST' });
}

export async function fetchOpeningBalanceReport() {
    const res = await apiFetch('/warehouse/opening-balance/report');
    return res && Array.isArray(res.invoices) ? res.invoices : [];
}

export async function fetchSystemHealth() {
    return apiFetch('/warehouse/system-health');
}

/* ── Pure mirrors and mappers ──────────────────────────────────────────── */

/**
 * The server's own date rule (inventory-control-routes.js:343):
 *   /^\d{4}-\d{2}-\d{2}$/.test(start) && same for end && end >= start
 * A failure here prevents a request the server would answer 422/500 for.
 * @returns {{field:string, message:string}[]}
 */
export function validateFiscalYearForm(form = {}) {
    const start = String(form.startDate ?? '').trim().slice(0, 10);
    const end = String(form.endDate ?? '').trim().slice(0, 10);
    if (!DAY.test(start)) {
        return [{ field: 'startDate', message: 'تواريخ السنة المالية غير صحيحة — الصيغة YYYY-MM-DD' }];
    }
    if (!DAY.test(end)) {
        return [{ field: 'endDate', message: 'تواريخ السنة المالية غير صحيحة — الصيغة YYYY-MM-DD' }];
    }
    if (end < start) {
        return [{ field: 'endDate', message: 'نهاية السنة تسبق بدايتها — تحقق من التاريخين' }];
    }
    return [];
}

/** Body = exactly the five keys the server reads, with the server's defaults. */
export function normalizeFiscalYearForm(form = {}) {
    const startDate = String(form.startDate ?? '').trim().slice(0, 10);
    const endDate = String(form.endDate ?? '').trim().slice(0, 10);
    const yearCode = String(form.yearCode ?? '').trim() || startDate.slice(0, 4);
    const name = String(form.name ?? '').trim() || `السنة المالية ${yearCode}`;
    return {
        startDate,
        endDate,
        yearCode,
        name: name.slice(0, 120),
        notes: String(form.notes ?? '').trim() || null,
    };
}

/** Persisted row → what the table renders. Numbers never become NaN. */
export function fiscalYearToRow(raw = {}) {
    const snapshot = objectOf(raw.closing_snapshot);
    const opening = objectOf(raw.opening_balances);
    return {
        id: String(raw.id ?? ''),
        yearCode: String(raw.year_code ?? ''),
        name: String(raw.name ?? ''),
        startDate: day(raw.start_date),
        endDate: day(raw.end_date),
        status: String(raw.status ?? ''),
        closedAt: raw.closed_at ? String(raw.closed_at) : '',
        closedBy: raw.closed_by == null ? '' : String(raw.closed_by),
        openingCount: Array.isArray(opening.inventory) ? opening.inventory.length : 0,
        snapshot: {
            revenueCount: num(snapshot.revenue_count),
            revenueTotal: num(snapshot.revenue_total),
            expenseCount: num(snapshot.expense_count),
            expenseTotal: num(snapshot.expense_total),
            purchaseCount: num(snapshot.purchase_count),
            purchaseTotal: num(snapshot.purchase_total),
            netResult: num(snapshot.net_result),
            inventoryValue: num(snapshot.inventory_value),
            inventoryCount: num(snapshot.inventory_count),
            closedAt: snapshot.closed_at ? String(snapshot.closed_at) : '',
        },
        hasSnapshot: Object.keys(snapshot).length > 0,
    };
}

/** Counts over the loaded list — no request. `current` follows the server's
 *  order (start_date DESC), so the first open year is the working one. */
export function fiscalSummary(rows = []) {
    const list = Array.isArray(rows) ? rows : [];
    const open = list.filter((r) => r && r.status === 'open');
    return {
        total: list.length,
        open: open.length,
        closed: list.length - open.length,
        current: open[0] || list[0] || null,
    };
}

export function openingItemToRow(raw = {}) {
    return {
        itemId: raw.itemId == null ? null : String(raw.itemId),
        name: String(raw.itemName ?? ''),
        qty: num(raw.qty),
        unit: String(raw.unit ?? ''),
        price: num(raw.price),
        category: String(raw.category ?? ''),
        packagingQty: raw.packagingQty == null ? null : num(raw.packagingQty),
        currentQty: raw.currentQty == null ? null : num(raw.currentQty),
        issuedSince: num(raw.issuedSince),
        itemExists: raw.itemExists === true,
    };
}

export function openingToInvoice(raw = {}) {
    const items = Array.isArray(raw.items) ? raw.items.map(openingItemToRow) : [];
    return {
        id: String(raw.id ?? ''),
        number: String(raw.invoiceNumber ?? ''),
        date: day(raw.date),
        totalAmount: num(raw.totalAmount),
        notes: String(raw.notes ?? ''),
        items,
    };
}

/** Totals are sums of what the report returns — never a reconstructed balance. */
export function openingTotals(invoices = []) {
    const list = Array.isArray(invoices) ? invoices : [];
    let lines = 0;
    let qty = 0;
    let issued = 0;
    let missing = 0;
    for (const invoice of list) {
        for (const item of (invoice && Array.isArray(invoice.items) ? invoice.items : [])) {
            lines += 1;
            qty += num(item.qty);
            issued += num(item.issuedSince);
            if (!item.itemExists) {missing += 1;}
        }
    }
    return {
        invoices: list.length,
        lines,
        qty,
        issuedSince: issued,
        totalAmount: list.reduce((sum, invoice) => sum + num(invoice && invoice.totalAmount), 0),
        missing,
    };
}

export function healthSummary(raw = {}) {
    const body = raw && typeof raw === 'object' ? raw : {};
    const anomalies = Array.isArray(body.anomalies)
        ? body.anomalies
            .filter((a) => a && typeof a === 'object')
            .map((a) => ({ name: String(a.name ?? ''), issue: String(a.issue ?? '') }))
        : [];
    return {
        ok: body.ok === true,
        itemsTotal: num(body.itemsTotal),
        consistent: num(body.consistent),
        anomaliesCount: num(body.anomaliesCount),
        zeroStock: num(body.zeroStock),
        lowStock: num(body.lowStock),
        anomalies,
    };
}
