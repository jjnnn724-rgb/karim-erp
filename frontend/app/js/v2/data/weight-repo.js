/**
 * V2 — Weight repository (الميزان + قراءاته + تحديث وزن الصنف)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET  /weightReadings?page&limit…  → generic list (server.js:1445)
 *   POST /weightReadings              → generic create (:1772); required
 *        = weight, DB CHECK weight > 0 (064_weight_readings.sql:10);
 *        writeable = weight, unit, date, itemId, time, timestamp, itemName,
 *        notes, recordedBy (schema-registry.js:481)
 *   PUT  /inventory/:id {weight}      → the legacy "add to item" write
 *        (warehouse.js confirmRecordWeightToItem) — partial update (:2029),
 *        inventory roles = admin|manager|warehouse (:786)
 *
 * WHAT THE CLIENT ADDS
 *   Unit conversion to kilograms for the item's stored `weight` (the legacy
 *   formula: g/1000, lb×0.453592), and a stated summary that never adds
 *   kilograms to grams as if they were one unit.
 *
 * WHAT IT DOES NOT DECIDE
 *   Whether the reading may be created or the item updated — the server
 *   re-checks the role and the payload on every request.
 */

import { apiFetch } from '../../core/api.js?v=4.9.132';

/** Mirror of OPEN_ENTITY_WRITE_ROLES.weightReadings (schema-registry.js:793). */
export const WEIGHT_WRITE_ROLES = ['admin', 'manager', 'kitchen', 'sous_chef', 'warehouse'];
/** Mirror of OPEN_ENTITY_WRITE_ROLES.inventory (schema-registry.js:786). */
export const WEIGHT_INVENTORY_ROLES = ['admin', 'manager', 'warehouse'];

export const WEIGHT_UNITS = ['kg', 'g', 'lb'];
export const WEIGHT_UNIT_AR = { kg: 'كجم', g: 'جرام', lb: 'رطل' };

const LB_TO_KG = 0.453592;
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

export const fetchWeightReadings = () => walkEntity('weightReadings');
export const fetchWeightInventory = () => walkEntity('inventory');

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** The legacy conversion, named: kg stays, g/1000, lb×0.453592. */
export function toKg(weight, unit) {
    const w = num(weight);
    if (unit === 'g') {return w / 1000;}
    if (unit === 'lb') {return w * LB_TO_KG;}
    return w;
}

export function unitLabel(unit) {
    return WEIGHT_UNIT_AR[String(unit)] || String(unit || '');
}

/**
 * A stored reading → the row the table draws. Unknown units stay verbatim
 * and are NOT convertible: `kg` is null, never the raw number pretending to
 * be kilograms.
 */
export function readingToRow(raw = {}) {
    const unit = raw.unit ? String(raw.unit) : 'kg';
    const convertible = WEIGHT_UNITS.includes(unit);
    return {
        id: raw.id,
        date: raw.date ? String(raw.date) : '',
        time: raw.time ? String(raw.time) : '',
        weight: num(raw.weight),
        unit,
        unitAr: unitLabel(unit),
        kg: convertible ? Number(toKg(raw.weight, unit).toFixed(3)) : null,
        itemId: raw.itemId ?? null,
        itemName: raw.itemName ? String(raw.itemName) : (raw.itemId ? `#${raw.itemId}` : ''),
        notes: raw.notes ? String(raw.notes) : '',
        recordedBy: raw.recordedBy ? String(raw.recordedBy) : '',
    };
}

/**
 * Totals are stated in kilograms; a gram or pound reading is converted first,
 * so «إجمالي الوزن» can never add 1 kg to 500 g and call it 501. A reading
 * whose unit this build does not know is excluded and counted, not guessed.
 */
export function readingsSummary(rows = [], today = '') {
    const list = (Array.isArray(rows) ? rows : []).map(readingToRow);
    const convertible = list.filter((r) => r.kg !== null);
    return {
        count: list.length,
        todayCount: today ? list.filter((r) => r.date === today).length : 0,
        totalKg: Number(convertible.reduce((s, r) => s + r.kg, 0).toFixed(3)),
        unconverted: list.length - convertible.length,
        last: list.length ? list[0] : null,
    };
}

/** @returns {{field:string,message:string}[]} */
export function validateReading(weight) {
    const w = Number(weight);
    if (!Number.isFinite(w) || w <= 0) {
        return [{ field: 'weight', message: 'الوزن يجب أن يكون أكبر من صفر' }];
    }
    return [];
}

function localParts(now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return {
        date: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`,
        time: `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`,
        timestamp: now.toISOString(),
    };
}

/**
 * The body the legacy screen sends (warehouse.js recordWeight /
 * confirmRecordWeightToItem), with optional item linkage.
 */
export function buildReadingPayload({
    weight, unit = 'kg', item = null, notes = '', recordedBy = '', now = new Date(),
} = {}) {
    const parts = localParts(now);
    return {
        weight: num(weight),
        unit: WEIGHT_UNITS.includes(unit) ? unit : 'kg',
        date: parts.date,
        time: parts.time,
        timestamp: parts.timestamp,
        itemId: item && item.id != null ? item.id : null,
        itemName: item && item.name ? String(item.name) : null,
        notes: String(notes || '').trim() || null,
        recordedBy: String(recordedBy || '').trim() || null,
    };
}

export async function createWeightReading(payload) {
    return apiFetch('/weightReadings', { method: 'POST', body: JSON.stringify(payload) });
}

/**
 * Adds the measured weight to the item's stored weight. Sends only `weight`,
 * exactly like the legacy partial update; the returned `nextWeight` is what
 * the screen announces, and the server row remains the authority.
 */
export async function addWeightToItem(item, weight, unit) {
    if (!item || item.id == null) {
        throw new Error('الصنف غير موجود');
    }
    const nextWeight = Number((num(item.weight) + toKg(weight, unit)).toFixed(3));
    const saved = await apiFetch(`/inventory/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ weight: nextWeight }),
    });
    return { nextWeight, saved };
}
