/**
 * V2 — Branches repository (الحديث الوحيد مع ‎/api/branches‎)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ONE DOOR, SO THE SCREEN HAS NO NETWORK LAYER OF ITS OWN
 *   The screen asks for data and gets rows; only this file knows the URL,
 *   the verb and the payload shape. That keeps backend/branch-routes.js the
 *   single place where the rules live, and it is why the helpers that
 *   decide shapes (normalizePayload / branchToRow / validateBranch) are
 *   exported and pure: they can be tested without a browser.
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED (backend/branch-routes.js)
 *   GET    /branches            → {ok:true, data:[…]}   (any authenticated user)
 *   GET    /branches?all=1      → includes inactive     (admin only — a
 *         non-admin is answered with the active list, NOT an error)
 *   POST   /branches            → 201 {ok,data} | 409 code exists | 422 invalid
 *   PATCH  /branches/:id        → {ok,data} — `code` is not in the allowed
 *         update set, so editing one would silently do nothing: strip it.
 *   DELETE /branches/:id        → soft (is_active=FALSE); code='MAIN' → 422
 *   All writes: requireRole('admin').
 *
 * THIS FILE NEVER MUTATES A NUMBER IT DID NOT RECEIVE. It ships bytes to
 * the API and returns what came back.
 */

import { apiFetch } from '../../core/api.js?v=4.9.194';

/* Mirrors CODE_RE / CURRENCY_RE in backend/branch-routes.js:12-13. */
const CODE_RE = /^[A-Za-z0-9_-]{1,20}$/;
const CURRENCY_RE = /^[A-Za-z]{3}$/;

const text = (v) => {
    const s = String(v ?? '').trim();
    return s === '' ? null : s;
};

/**
 * Form object → API payload, with the server's own defaults applied so a
 * blank field means the same thing here as it does in PostgreSQL.
 *
 * @param {Record<string, any>} form
 * @returns {{code:string, name_ar:string, name_en:string|null, currency:string,
 *            timezone:string, phone:string|null, address:string|null}}
 */
export function normalizePayload(form = {}) {
    return {
        code: String(form.code ?? '').trim(),
        name_ar: String(form.name_ar ?? '').trim(),
        name_en: text(form.name_en),
        currency: (String(form.currency ?? '').trim() || 'SAR').toUpperCase(),
        timezone: String(form.timezone ?? '').trim() || 'Asia/Riyadh',
        phone: text(form.phone),
        address: text(form.address),
    };
}

/**
 * Field-level validation before a request is sent. The server stays the
 * authority — this only avoids a round-trip for a mistake the user can fix
 * immediately. Rules and messages follow branch-routes.js:32-36.
 *
 * @param {Record<string, any>} form
 * @param {{editing?: boolean}} [opts] editing=true → code is immutable, skip it
 * @returns {Array<{field:string, message:string}>}
 */
export function validateBranch(form = {}, opts = {}) {
    const errors = [];
    const code = String(form.code ?? '').trim();
    if (!opts.editing && !CODE_RE.test(code)) {
        errors.push({ field: 'code', message: 'كود الفرع: من 1 إلى 20 حرفًا لاتينيًا أو رقمًا أو _ أو -' });
    }
    if (!String(form.name_ar ?? '').trim()) {
        errors.push({ field: 'name_ar', message: 'اسم الفرع بالعربية مطلوب' });
    }
    const currency = (String(form.currency ?? '').trim() || 'SAR').toUpperCase();
    if (!CURRENCY_RE.test(currency)) {
        errors.push({ field: 'currency', message: 'العملة رمز ISO من 3 حروف (SAR / EGP / AED)' });
    }
    return errors;
}

/**
 * Database row → table row. `is_active` is a boolean column, not a status
 * string, so it becomes one here and the status adapter turns it into a
 * badge — the same two states the legacy list renders.
 *
 * @param {Record<string, any>} b
 * @returns {Record<string, any>}
 */
export function branchToRow(b = {}) {
    const active = !(b.is_active === false || b.is_active === 'false' || b.is_active === 0);
    return {
        id: b.id,
        code: String(b.code ?? ''),
        name_ar: String(b.name_ar ?? ''),
        name_en: b.name_en ? String(b.name_en) : '',
        currency: String(b.currency ?? ''),
        timezone: String(b.timezone ?? ''),
        phone: b.phone ? String(b.phone) : '',
        address: b.address ? String(b.address) : '',
        status: active ? 'active' : 'inactive',
        // The server refuses to deactivate MAIN (branch-routes.js:77); the
        // UI must not offer a button that is guaranteed to fail.
        is_main: String(b.code ?? '').toUpperCase() === 'MAIN',
    };
}

/** @param {{showAll?: boolean}} [opts] @returns {Promise<any[]>} */
export async function fetchBranches(opts = {}) {
    const res = await apiFetch('/branches' + (opts.showAll ? '?all=1' : ''));
    const data = res && Array.isArray(res.data) ? res.data : [];
    return data.map(branchToRow);
}

export async function createBranch(form) {
    return apiFetch('/branches', { method: 'POST', body: JSON.stringify(normalizePayload(form)) });
}

/** `code` is an external identifier for every branch_id — never sent on update. */
export async function updateBranch(id, form) {
    const payload = normalizePayload(form);
    delete payload.code;
    return apiFetch(`/branches/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    });
}

/** Soft stop: rows already stamped with this branch_id stay untouched. */
export async function deactivateBranch(id) {
    return apiFetch(`/branches/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function reactivateBranch(id) {
    return apiFetch(`/branches/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: true }),
    });
}
