/**
 * V2 — Procurement repository (الباب الوحيد إلى /api/procurement/*)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET /procurement/summary → { activeSuppliers, totalSuppliers,
 *     purchasesTotal, paymentsTotal, dueTotal, unpaidInvoices,
 *     invoicesRemaining } — money already rounded by the server
 *     (procurement-routes.js:381-407 · read gate admin|manager|warehouse|
 *     accountant, same file :25).
 *   GET /procurement/suppliers → ARRAY (res.json(rows), NOT {data})
 *     (procurement-routes.js:411-446): full supplier row + joined
 *     purchasesTotal, invoiceCount, invoicesPaidTotal, paymentsTotal,
 *     dueTotal, lastPurchaseDate. dueTotal = opening + purchases − paid.
 *   Supplier columns (DB, read-only SELECT verified 2026-10-14):
 *     id, name, phone, category, address, notes, openingBalance,
 *     is_active, createdAt, updatedAt, name_en, email,
 *     tax_registration_status, vat_number, commercial_register.
 *   Money unit: the stored settings currency — single door in
 *   reports-repo.js (fetchCurrency), imported here, never re-read
 *   elsewhere. Bare numbers + stated note when that read fails.
 *
 * DISPLAY SCOPE (v1): suppliers directory + summary. Supplier invoices
 * and payments are separate doors (/procurement/payments,
 * purchaseInvoices entity) and separate screens (06/07) — not silently
 * folded into this one.
 *
 * WRITES (wave 2, owner approval): this file is the ONLY door that writes,
 * and only the four supplier doors + the two payment doors below. Role
 * gates mirror requireRole lists in the same server file; the server
 * re-checks every call, so a gate here is button hygiene, never security.
 */

import { apiFetch } from '../../core/api.js?v=4.9.131';
import { fetchCurrency, formatMoney, formatInt } from './reports-repo.js?v=4.9.131';

export { fetchCurrency, formatMoney, formatInt };

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** @returns {Promise<object>} summary with coerced numbers */
export async function fetchProcurementSummary() {
    const res = await apiFetch('/procurement/summary');
    const s = res && typeof res === 'object' ? res : {};
    return {
        activeSuppliers: Math.round(num(s.activeSuppliers)),
        totalSuppliers: Math.round(num(s.totalSuppliers)),
        purchasesTotal: num(s.purchasesTotal),
        paymentsTotal: num(s.paymentsTotal),
        dueTotal: num(s.dueTotal),
        unpaidInvoices: Math.round(num(s.unpaidInvoices)),
        invoicesRemaining: num(s.invoicesRemaining),
    };
}

/** The endpoint returns a bare array — accept {data} too, never crash. */
export async function fetchSuppliers() {
    const res = await apiFetch('/procurement/suppliers');
    if (Array.isArray(res)) {return res;}
    if (res && Array.isArray(res.data)) {return res.data;}
    return [];
}

/** Payment-method words copied from the app's own vocabulary
 *  (features/warehouse.js:337 PCMT_PAY_LABELS). Unknown methods are shown
 *  verbatim — relabelling a method the app does not know would be inventing. */
export const PAYMENT_METHOD_AR = {
    cash: 'نقدي', bank: 'تحويل بنكي', card: 'بطاقة', cheque: 'شيك', credit: 'آجل',
};

/** UI write gates mirror the server's requireRole lists (same file):
 *  reads admin|manager|warehouse|accountant (:25),
 *  supplier writes admin|manager|warehouse,
 *  payment writes admin|manager|accountant, payment delete admin only. */
export const SUPPLIER_WRITE_ROLES = ['admin', 'manager', 'warehouse'];
export const PAYMENT_WRITE_ROLES = ['admin', 'manager', 'accountant'];
export const PAYMENT_DELETE_ROLES = ['admin'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Both dates present and reversed is a mistake the operator can read off
 *  the two fields, not a result: refused before the request, the same rule
 *  screen 04 pins (reports-repo.js:117). An empty table over an impossible
 *  range would look like missing data — it is a typo. */
export function rangeError(from, to) {
    return (from && to && String(from) > String(to))
        ? 'بداية الفترة بعد نهايتها — صحّح التاريخين قبل العرض'
        : '';
}

/**
 * Server-filtered payment walk (supplierId/from/to are SQL WHERE, same
 * endpoint procurement-routes.js:700-719). ORDER date DESC, LIMIT 500 —
 * the cap is the server's, stated in the UI when hit.
 */
export async function fetchSupplierPayments({ supplierId = '', from = '', to = '' } = {}) {
    const params = new URLSearchParams();
    const sid = Number.parseInt(supplierId, 10);
    if (Number.isInteger(sid) && sid > 0) {params.set('supplierId', String(sid));}
    if (DATE_RE.test(String(from || ''))) {params.set('from', String(from));}
    if (DATE_RE.test(String(to || ''))) {params.set('to', String(to));}
    const bad = rangeError(params.get('from'), params.get('to'));
    if (bad) {throw new Error(bad);}
    const qs = params.toString();
    const res = await apiFetch(`/procurement/payments${qs ? `?${qs}` : ''}`);
    if (Array.isArray(res)) {return res;}
    if (res && Array.isArray(res.data)) {return res.data;}
    return [];
}

/**
 * Database row → table row. Method label via the copied vocabulary, raw
 * key when unknown. Pure and exported so it is testable without a browser.
 */
export function paymentToRow(p = {}) {
    const method = p.method !== undefined && p.method !== null ? String(p.method) : '';
    return {
        id: p.id,
        date: p.date ? String(p.date).slice(0, 10) : '',
        supplierId: p.supplierId ?? null,
        supplier: p.supplierName ? String(p.supplierName) : (p.supplierId ? `#${p.supplierId}` : '—'),
        supplierResolved: !!p.supplierName,
        amount: num(p.amount),
        method,
        methodAr: PAYMENT_METHOD_AR[method] || method || '—',
        invoiceId: p.invoiceId ?? null,
        notes: p.notes ? String(p.notes) : '',
        by: p.createdBy ? String(p.createdBy) : '—',
    };
}

/**
 * Database row → table row. Only register fields (see header scope).
 * `is_active` is a boolean like branches (branchToRow pattern) — the
 * status adapter's branches:active/inactive pair documents exactly this
 * mapping (status.js:152-157), so it is reuse, not invention.
 * Pure and exported so it is testable without a browser.
 */
export function supplierToRow(s = {}) {
    const active = !(s.is_active === false || s.is_active === 'false' || s.is_active === 0);
    const last = s.lastPurchaseDate ? String(s.lastPurchaseDate).slice(0, 10) : '';
    return {
        id: s.id,
        name: s.name ? String(s.name) : `#${s.id ?? '؟'}`,
        nameResolved: !!s.name,
        nameEn: s.name_en ? String(s.name_en) : '',
        phone: s.phone ? String(s.phone) : '—',
        category: s.category ? String(s.category) : '',
        vat: s.vat_number ? String(s.vat_number) : '',
        openingBalance: num(s.openingBalance),
        purchasesTotal: num(s.purchasesTotal),
        invoiceCount: Math.round(num(s.invoiceCount)),
        paymentsTotal: num(s.paymentsTotal),
        dueTotal: num(s.dueTotal),
        lastPurchaseDate: last,
        status: active ? 'active' : 'inactive',
    };
}

/* ── Writes (wave 2 — explicit owner approval) ──────────────────────────
 * Thin doors, same shape as branches-repo.js writes. Every rule lives
 * server-side (procurement-routes.js); the client validates only what the
 * operator can fix before a round-trip (name present, VAT shape), and the
 * server's verbatim message is shown on 422/409 — never a paraphrase.
 * Callers guard double-clicks (saving flag) and confirm destructive acts;
 * the server re-checks role + state on each call regardless. */

/**
 * Shapes copied verbatim from the server's own constants
 * (procurement-routes.js:36-38 PHONE_RE / EMAIL_RE / CR_RE) and its name
 * range (:129), so a refusal says the same words whether the client or the
 * server caught it. The server stays authoritative — this only saves the
 * operator a round-trip for what he can fix in the field itself.
 * @param {Record<string,any>} form
 * @returns {Array<{field:string, message:string}>}
 */
const PHONE_SHAPE = /^[0-9+\-\s()]{0,30}$/;
const EMAIL_SHAPE = /^\S+@\S+\.\S+$/;
const CR_SHAPE = /^[0-9A-Za-z-]{1,20}$/;

export function validateSupplierForm(form = {}) {
    const errors = [];
    const name = String(form.name ?? '').trim();
    if (name.length < 2 || name.length > 120) {
        errors.push({ field: 'name', message: 'اسم المورد مطلوب (2-120 حرفًا)' });
    }
    const phone = String(form.phone ?? '').trim();
    if (phone && !PHONE_SHAPE.test(phone)) {
        errors.push({ field: 'phone', message: 'رقم الهاتف غير صحيح' });
    }
    const email = String(form.email ?? '').trim();
    if (email && !EMAIL_SHAPE.test(email)) {
        errors.push({ field: 'email', message: 'البريد الإلكتروني غير صحيح' });
    }
    const cr = String(form.commercial_register ?? '').trim();
    if (cr && !CR_SHAPE.test(cr)) {
        errors.push({ field: 'commercial_register', message: 'رقم السجل التجاري غير صحيح (حروف/أرقام حتى 20 خانة)' });
    }
    const status = String(form.tax_registration_status || 'NOT_REGISTERED');
    const vat = String(form.vat_number || '').trim();
    if (status === 'REGISTERED' && !/^\d{15}$/.test(vat)) {
        errors.push({ field: 'vat_number', message: 'المورد المسجل ضريبيًا يحتاج رقمًا ضريبيًا (15 رقمًا)' });
    }
    if (status === 'NOT_REGISTERED' && vat) {
        errors.push({ field: 'vat_number', message: 'المورد غير المسجل لا يقبل رقمًا ضريبيًا — اتركه فارغًا' });
    }
    if (vat && !/^\d{1,15}$/.test(vat)) {
        errors.push({ field: 'vat_number', message: 'الرقم الضريبي أرقام فقط (حتى 15 رقمًا)' });
    }
    const opening = String(form.openingBalance ?? '').trim();
    if (opening !== '' && !(Number.isFinite(Number(opening)) && Number(opening) >= 0)) {
        errors.push({ field: 'openingBalance', message: 'الرصيد الافتتاحي يجب أن يكون رقمًا غير سالب' });
    }
    return errors;
}

/** @param {Record<string,any>} form */
export function normalizeSupplierForm(form = {}) {
    const text = (v) => {
        const s = String(v ?? '').trim();
        return s === '' ? null : s;
    };
    const opening = String(form.openingBalance ?? '').trim();
    return {
        name: String(form.name ?? '').trim(),
        name_en: text(form.name_en),
        phone: text(form.phone),
        email: text(form.email),
        category: text(form.category),
        address: text(form.address),
        notes: text(form.notes),
        openingBalance: opening === '' ? 0 : Number(opening),
        tax_registration_status: String(form.tax_registration_status || 'NOT_REGISTERED'),
        vat_number: text(form.vat_number),
        commercial_register: text(form.commercial_register),
    };
}

export async function createSupplier(form) {
    return apiFetch('/procurement/suppliers', {
        method: 'POST', body: JSON.stringify(normalizeSupplierForm(form)),
    });
}

export async function updateSupplier(id, form) {
    return apiFetch(`/procurement/suppliers/${encodeURIComponent(id)}`, {
        method: 'PUT', body: JSON.stringify(normalizeSupplierForm(form)),
    });
}

/** Flips is_active server-side; returns the updated row. */
export async function toggleSupplier(id) {
    return apiFetch(`/procurement/suppliers/${encodeURIComponent(id)}/toggle`, {
        method: 'POST', body: JSON.stringify({}),
    });
}

/**
 * Hard delete, admin|manager|warehouse (procurement-routes.js:645). The
 * server refuses a supplier with invoices or payments (409 with the counts
 * and its own sentence) — there is no cascade here and no undo.
 */
export async function deleteSupplier(id) {
    return apiFetch(`/procurement/suppliers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Full pay of the remaining balance (server computes it). Returns
 *  { payment, invoice }. The server refuses already-paid (409),
 *  supplier-less (422) and inactive-supplier (409) cases itself. */
export async function payInvoiceFull(id, { method = 'cash' } = {}) {
    return apiFetch(`/procurement/invoices/${encodeURIComponent(id)}/pay`, {
        method: 'POST', body: JSON.stringify({ method }),
    });
}

/** Hard delete + invoice recalc + domain event, admin only server-side.
 *  The caller confirms explicitly; there is no undo. */
export async function deletePayment(id) {
    return apiFetch(`/procurement/payments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
