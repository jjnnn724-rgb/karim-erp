/**
 * yarasoft/mapping.js — مطابقة المنتجات (Phase 7: Never blindly match)
 * ────────────────────────────────────────────────────────────────────────────
 * أولوية المطابقة المعتمدة (حرفيًا من المواصفة):
 *   1. باركود Yarasoft الخارجي  → inventory.barcode (مطابقة تامة)
 *   2. كود Yarasoft الخارجي     → yarasoft_product_mapping.external_code نشط
 *   3. باركود خارجي صريح        → yarasoft_product_mapping.external_barcode نشط
 *   4. كود خارجي رقمي يطابق معرّف منتج داخلي (exact id) — أضيق الحدود
 *   5. لا مطابقة → REQUIRES_REVIEW (لا استبدال تلقائي أبدًا)
 */

'use strict';

const { pool } = require('../shared-pool');

/**
 * resolveItems(items) → { resolved: Map<index, {inventoryId, name, unit}>, unmapped: [{index, reason}] }
 * كل صنف يُحسم على حدة؛ الفاتورة تُستورد فقط إن حُسمت كل أصنافها.
 */
async function resolveItems(items) {
    const resolved = new Map();
    const unmapped = [];

    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const barcode = String(it.barcode || '').trim() || null;
        const code = String(it.externalCode || '').trim() || null;

        // 1) باركود خارجي → inventory.barcode
        if (barcode) {
            const byBarcode = await pool.query(
                `SELECT id, name, unit, qty FROM inventory WHERE barcode = $1 LIMIT 1`, [barcode]);
            if (byBarcode.rows[0]) {
                resolved.set(i, { inventoryId: byBarcode.rows[0].id, name: byBarcode.rows[0].name, unit: byBarcode.rows[0].unit, via: 'barcode' });
                continue;
            }
        }

        // 2) كود خارجي → جدول الربط الصريح
        if (code) {
            const byMap = await pool.query(
                `SELECT m.internal_product_id, i.name, i.unit
                 FROM yarasoft_product_mapping m JOIN inventory i ON i.id = m.internal_product_id
                 WHERE m.active = true AND m.external_code = $1 LIMIT 1`, [code]);
            if (byMap.rows[0]) {
                resolved.set(i, { inventoryId: byMap.rows[0].internal_product_id, name: byMap.rows[0].name, unit: byMap.rows[0].unit, via: 'mapping_code' });
                continue;
            }
            // 3) باركود خارجي صريح في جدول الربط
            if (barcode) {
                const byMapBc = await pool.query(
                    `SELECT m.internal_product_id, i.name, i.unit
                     FROM yarasoft_product_mapping m JOIN inventory i ON i.id = m.internal_product_id
                     WHERE m.active = true AND m.external_barcode = $1 LIMIT 1`, [barcode]);
                if (byMapBc.rows[0]) {
                    resolved.set(i, { inventoryId: byMapBc.rows[0].internal_product_id, name: byMapBc.rows[0].name, unit: byMapBc.rows[0].unit, via: 'mapping_barcode' });
                    continue;
                }
            }
            // 4) كود رقمي = معرّف داخلي تام (حد أقصى للأمان: رقم صافٍ موجب)
            if (/^\d+$/.test(code)) {
                const byId = await pool.query(
                    `SELECT id, name, unit FROM inventory WHERE id = $1 LIMIT 1`, [Number(code)]);
                if (byId.rows[0]) {
                    resolved.set(i, { inventoryId: byId.rows[0].id, name: byId.rows[0].name, unit: byId.rows[0].unit, via: 'internal_id' });
                    continue;
                }
            }
        }

        unmapped.push({
            index: i,
            externalItemCode: code,
            externalBarcode: barcode,
            itemName: it.name || null,
            quantity: it.quantity,
            reason: barcode
                ? 'لا باركود مطابق ولا ربط صريح لهذا الصنف'
                : 'لا كود مطابق ولا ربط صريح لهذا الصنف',
        });
    }

    return { resolved, unmapped };
}

/** إنشاء/تحديث ربط صريح من شاشة المراجعة */
function codedError(code, message) {
    const err = new Error(message || code);
    err.code = code;
    return err;
}
async function upsertMapping({ externalCode, externalBarcode, internalProductId, active = true }) {
    if (!internalProductId) {throw codedError('INTERNAL_PRODUCT_REQUIRED', 'حدد الصنف الداخلي');}
    if (!externalCode && !externalBarcode) {throw codedError('EXTERNAL_KEY_REQUIRED', 'أدخل الكود أو الباركود الخارجي');}

    const product = await pool.query('SELECT id FROM inventory WHERE id = $1 LIMIT 1', [Number(internalProductId)]);
    if (!product.rows[0]) {throw codedError('PRODUCT_NOT_FOUND', 'الصنف الداخلي غير موجود');}

    if (externalCode) {
        const clash = await pool.query(
            `SELECT id FROM yarasoft_product_mapping
             WHERE active = true AND external_code = $1 AND internal_product_id <> $2 LIMIT 1`,
            [externalCode, Number(internalProductId)]);
        if (clash.rows[0]) {
            const err = new Error('الربط موجود بالفعل لمنتج آخر بنفس الكود الخارجي');
            err.code = 'MAPPING_CLASH';
            throw err;
        }
    }

    const { rows } = await pool.query(
        `INSERT INTO yarasoft_product_mapping (external_code, external_barcode, internal_product_id, active)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [externalCode || null, externalBarcode || null, Number(internalProductId), Boolean(active)]
    );
    if (rows[0]) {return rows[0];}

    // حدّث الربط القائم (نفس الكود الخارجي) بدل إنشاء مكرر يخرق الفهرس الفريد
    const key = externalCode ? ['external_code', externalCode] : ['external_barcode', externalBarcode];
    const updated = await pool.query(
        `UPDATE yarasoft_product_mapping
            SET internal_product_id = $2, active = $3, updated_at = NOW()
          WHERE ${key[0]} = $1
          RETURNING *`,
        [key[1], Number(internalProductId), Boolean(active)]
    );
    return updated.rows[0];
}

module.exports = { resolveItems, upsertMapping };
