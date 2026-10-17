/**
 * V2 — Shelves repository (الباب الوحيد إلى /api/shelves + /api/inventory)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET    /shelves?page&limit&sort&order  → { data[], pagination } (server.js:1445)
 *   POST   /shelves                        → generic CRUD, write roles
 *          OPEN_ENTITY_WRITE_ROLES.shelves = admin|manager|warehouse
 *          (schema-registry.js:782) · writeable = name, code, location,
 *          capacity, icon (:308) · required = name (:309)
 *   PUT    /shelves/:id                    → partial update (:2029)
 *   DELETE /shelves/:id                    → generic delete (:2278)
 *
 * WHAT THE CLIENT ADDS
 *   A duplicate-code guard (the legacy screen refuses the same code,
 *   warehouse.js addShelf) and a normalized body that strips `id` (protected
 *   server-side) and sends no field outside the server whitelist.
 *
 * WHAT IT DOES NOT DECIDE
 *   Whether deletion is allowed: inventory.shelfId is `ON DELETE SET NULL`
 *   (database/migrations/001_schema.sql + live FK), so removing a shelf
 *   unassigns its items rather than deleting them. The screen says that
 *   sentence before the request; the database enforces it.
 */

import { apiFetch } from '../../core/api.js?v=4.9.145';

/** Mirror of OPEN_ENTITY_WRITE_ROLES.shelves (schema-registry.js:782). */
export const SHELF_WRITE_ROLES = ['admin', 'manager', 'warehouse'];

const WALK_PAGES = 8;

async function walkEntity(entity) {
    const rows = [];
    for (let page = 1; page <= WALK_PAGES; page += 1) {
        const res = await apiFetch(`/${entity}?page=${page}&limit=1000&sort=id&order=desc`);
        const batch = res && Array.isArray(res.data) ? res.data
            : (Array.isArray(res) ? res : []);
        rows.push(...batch);
        const totalPages = Number(res && res.pagination && res.pagination.totalPages) || 0;
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < 1000) {break;}
    }
    return rows;
}

export const fetchShelves = () => walkEntity('shelves');

/** Items are read only to count what each shelf holds — never written here. */
export const fetchShelfInventory = () => walkEntity('inventory');

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** Aggregate items per shelf without touching the inventory record. */
export function shelfItems(shelfId, items = []) {
    const rows = (Array.isArray(items) ? items : [])
        .filter((i) => i && String(i.shelfId) === String(shelfId));
    return {
        count: rows.length,
        qty: rows.reduce((s, i) => s + num(i.qty), 0),
        value: rows.reduce((s, i) => s + num(i.qty) * num(i.avgCost), 0),
        rows,
    };
}

export function shelfStats(shelves = [], items = []) {
    const list = Array.isArray(shelves) ? shelves : [];
    const inventory = Array.isArray(items) ? items : [];
    const assignedItems = inventory.filter((i) => i && i.shelfId !== null && i.shelfId !== undefined && String(i.shelfId) !== '').length;
    const emptyShelves = list.filter((s) => !inventory.some((i) => String(i.shelfId) === String(s.id))).length;
    return {
        shelves: list.length,
        assignedItems,
        emptyShelves,
        occupancy: inventory.length > 0 ? (assignedItems / inventory.length) * 100 : 0,
    };
}

/**
 * The same column sentences the server's filterBody speaks
 * (schema-registry.js:653/:672/:692), plus the legacy screen's code rule.
 * @returns {{field:string,message:string}[]}
 */
export function validateShelfForm(form = {}) {
    const errors = [];
    const name = String(form.name ?? '').trim();
    const code = String(form.code ?? '').trim();
    const location = String(form.location ?? '').trim();
    if (!name) {
        errors.push({ field: 'name', message: 'حقول مطلوبة ناقصة: name' });
    } else if (name.length > 255) {
        errors.push({ field: 'name', message: 'الحقل "name" أطول من المسموح (الحد الأقصى 255 حرفًا)' });
    }
    // The server requires only `name`; the legacy shelf screen also demands a
    // code because it is the shelf's human identifier (warehouse.js addShelf).
    if (!code) {
        errors.push({ field: 'code', message: 'الكود مطلوب — معرّف الرف كما في الشاشة القديمة' });
    } else if (code.length > 50) {
        errors.push({ field: 'code', message: 'الحقل "code" أطول من المسموح (الحد الأقصى 50 حرفًا)' });
    }
    if (location.length > 255) {
        errors.push({ field: 'location', message: 'الحقل "location" أطول من المسموح (الحد الأقصى 255 حرفًا)' });
    }
    if (form.capacity !== '' && form.capacity !== null && form.capacity !== undefined) {
        const capacity = Number(form.capacity);
        if (!Number.isFinite(capacity) || capacity < 0) {
            errors.push({ field: 'capacity', message: 'الحقل "capacity" يجب أن يكون رقمًا' });
        }
    }
    return errors;
}

/** Body = server whitelist only; `id` is protected and never sent. */
export function normalizeShelfForm(form = {}) {
    const capacity = form.capacity === '' || form.capacity === null || form.capacity === undefined
        ? 50
        : Number(form.capacity);
    return {
        name: String(form.name ?? '').trim(),
        code: String(form.code ?? '').trim().toUpperCase(),
        location: String(form.location ?? '').trim() || null,
        capacity: Number.isFinite(capacity) ? capacity : 50,
        // Stored exactly as legacy stores it; V2 never renders this markup.
        icon: '<i class=ji data-i=archive></i>',
    };
}

export async function createShelf(form) {
    return apiFetch('/shelves', { method: 'POST', body: JSON.stringify(normalizeShelfForm(form)) });
}

/** `code` is a fixed identifier — updates never carry it (legacy parity). */
export async function updateShelf(id, form) {
    const payload = normalizeShelfForm(form);
    delete payload.code;
    delete payload.icon;
    return apiFetch(`/shelves/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
    });
}

export async function deleteShelf(id) {
    return apiFetch(`/shelves/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
