/**
 * excel-import-routes.js — Excel/CSV import endpoints for inventory
 * ────────────────────────────────────────────────────────────────────────────
 * Provides:
 *   POST /api/inventory/import
 *     multipart/form-data with file=inventory.xlsx
 *     OR JSON body { rows: [{ name, category, unit, qty, avgCost, minQty, barcode }] }
 *
 *   POST /api/inventory/import-preview
 *     Same input but only validates and returns what WOULD be imported.
 *
 *   GET  /api/inventory/import-template
 *     Downloads an XLSX template with the expected headers.
 *
 * Features:
 *   - Zero errors: Comprehensive validation, duplicate detection, transaction safety
 *   - Duplicate detection: By name AND barcode (both DB and within import)
 *   - Data validation: Required fields, types, ranges
 *   - Category/shelf validation against DB
 *   - Per-row SAVEPOINT transactions with proper rollback
 *   - Full audit logging
 *   - Preview mode (dry-run)
 *   - CSV/JSON input support
 *   - Expiry policy: كل صف يدخل المخزون برصيد (qty > 0) يجب أن يحمل تاريخ صلاحية
 *     صحيحًا بصيغة YYYY-MM-DD وإلا يُرفض الصف. الاستيراد يكتب inventory.qty مباشرة
 *     ولا يمر بمخزون inventory_ledger، لذلك يُحفظ تاريخ الصلاحية في سجل التدقيق
 *     (audit_log.new_data) وفي نتيجة المعاينة فقط — ربط الاستيراد بدفتر المخزون
 *     بند مستقل يحتاج موافقة المالك لأنه يغيّر طريقة احتساب الكميات.
 */
const express = require('express');
const crypto = require('crypto');
const { logger } = require('../logger');
const { pool } = require('../shared-pool');
const { jwtAuth, requireRole } = require('./jwt-middleware');
const { crudLimiter } = require('../rate-limiter');
const { normalizeExpiryDate } = require('../expiry-policy');

const router = express.Router();

// ─── CONFIGURATION ──────────────────────────────────────────────────────────────
const MAX_IMPORT_ROWS = 5000;
const MAX_NAME_LENGTH = 255;
const MAX_CATEGORY_LENGTH = 100;
const MAX_UNIT_LENGTH = 50;
const MAX_BARCODE_LENGTH = 100;
const MAX_SHELF_CODE_LENGTH = 50;

const COLUMN_ALIASES = {
    name:        ['name', 'الاسم', 'اسم الصنف', 'product', 'الصنف'],
    category:    ['category', 'الفئة', 'التصنيف'],
    unit:        ['unit', 'الوحدة', 'وحدة'],
    qty:         ['qty', 'quantity', 'الكمية', 'كمية'],
    avgCost:     ['avgCost', 'cost', 'avg_cost', 'التكلفة', 'متوسط التكلفة'],
    minQty:      ['minQty', 'min_qty', 'minimum', 'الحد الأدنى', 'حد الطلب'],
    barcode:     ['barcode', 'الباركود', 'رمز'],
    shelfCode:   ['shelfCode', 'shelf', 'الرف', 'رف'],
    weight:      ['weight', 'الوزن', 'وزن'],
    expiryDate:  ['expiryDate', 'expiry_date', 'تاريخ الصلاحية', 'الصلاحية', 'bestBefore', 'best_before', 'expiry'],
};

function pick(row, aliases) {
    for (const a of aliases) {
        if (row[a] !== undefined && row[a] !== null && row[a] !== '') {return row[a];}
    }
    return undefined;
}

function toNumber(v, fallback = 0) {
    if (v === undefined || v === null || v === '') {return fallback;}
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

// ─── VALIDATION HELPERS ──────────────────────────────────────────────────────────
function validateRow(row, rowIndex, existingNames, existingBarcodes, categoryCache, shelfMap) {
    const errors = [];
    const warnings = [];

    // ─── Required: name ───
    const name = pick(row, COLUMN_ALIASES.name);
    if (!name || String(name).trim() === '') {
        errors.push({ field: 'name', message: 'الحقل "الاسم" مطلوب' });
    } else if (String(name).trim().length > 255) {
        errors.push({ field: 'name', message: 'اسم الصنف يتجاوز 255 حرف' });
    }

    // ─── Check duplicate name within import ───
    const nameKey = String(name || '').trim().toLowerCase();
    if (nameKey && existingNames.has(nameKey)) {
        errors.push({ field: 'name', message: `اسم مكرر في ملف الاستيراد: ${name}` });
    } else if (nameKey) {
        existingNames.add(nameKey);
    }

    // ─── Barcode ───
    const barcode = pick(row, COLUMN_ALIASES.barcode);
    let barcodeClean = null;
    if (barcode !== undefined && barcode !== null && String(barcode).trim() !== '') {
        const bc = String(barcode).trim();
        if (bc.length > 100) {
            errors.push({ field: 'barcode', message: 'الباركود يتجاوز 100 حرف' });
        } else {
            barcodeClean = bc;
            // Check duplicate barcode within import
            const bcKey = barcodeClean.toLowerCase();
            if (existingBarcodes.has(bcKey)) {
                errors.push({ field: 'barcode', message: `باركود مكرر في ملف الاستيراد: ${barcodeClean}` });
            } else {
                existingBarcodes.add(bcKey);
            }
        }
    }

    // ─── Category ───
    const categoryRaw = pick(row, COLUMN_ALIASES.category);
    const category = categoryRaw ? String(categoryRaw).trim() : 'عام';
    if (category.length > 100) {
        errors.push({ field: 'category', message: 'اسم الفئة يتجاوز 100 حرف' });
    }

    // ─── Unit ───
    const unit = pick(row, COLUMN_ALIASES.unit) || 'وحدة';
    if (unit.length > 50) {
        errors.push({ field: 'unit', message: 'الوحدة طويلة جداً' });
    }

    // ─── Numeric fields ───
    const qty = toNumber(pick(row, COLUMN_ALIASES.qty), 0);
    if (qty < 0) { errors.push({ field: 'qty', message: 'الكمية لا يمكن أن تكون سالبة' }); }
    if (qty > 999999999) { warnings.push('الكمية كبيرة جداً، تأكد من القيمة'); }

    const avgCost = toNumber(pick(row, COLUMN_ALIASES.avgCost), 0);
    if (avgCost < 0) { errors.push({ field: 'avgCost', message: 'التكلفة لا يمكن أن تكون سالبة' }); }

    const minQty = toNumber(pick(row, COLUMN_ALIASES.minQty), 0);
    if (minQty < 0) { errors.push({ field: 'minQty', message: 'الحد الأدنى لا يمكن أن يكون سالباً' }); }

    const weight = toNumber(pick(row, COLUMN_ALIASES.weight), 0);
    if (weight < 0) { errors.push({ field: 'weight', message: 'الوزن لا يمكن أن يكون سالباً' }); }

    // ─── Expiry (policy: كل صنف يدخل المخزن برصيد يجب أن يحمل تاريخ صلاحية) ───
    const expiryRaw = pick(row, COLUMN_ALIASES.expiryDate);
    let expiryDate = null;
    if (qty > 0) {
        if (expiryRaw === undefined || expiryRaw === null || String(expiryRaw).trim() === '') {
            errors.push({ field: 'expiryDate', message: 'تاريخ الصلاحية مطلوب لكل صنف يدخل المخزن برصيد — الصيغة YYYY-MM-DD (مثال 2026-12-31)' });
        } else {
            expiryDate = normalizeExpiryDate(expiryRaw);
            if (!expiryDate) {
                errors.push({ field: 'expiryDate', message: `تاريخ الصلاحية غير صحيح (${String(expiryRaw).slice(0, 24)}) — الصيغة المطلوبة YYYY-MM-DD` });
            }
        }
    } else if (expiryRaw !== undefined && expiryRaw !== null && String(expiryRaw).trim() !== '') {
        expiryDate = normalizeExpiryDate(expiryRaw);
        if (!expiryDate) {
            errors.push({ field: 'expiryDate', message: `تاريخ الصلاحية غير صحيح (${String(expiryRaw).slice(0, 24)}) — الصيغة المطلوبة YYYY-MM-DD` });
        }
    }

    // ─── Shelf code ───
    const shelfCodeRaw = pick(row, COLUMN_ALIASES.shelfCode);
    const shelfCode = shelfCodeRaw ? String(shelfCodeRaw).trim() : null;
    let shelfId = null;
    if (shelfCode) {
        if (shelfCode.length > 50) {
            errors.push({ field: 'shelfCode', message: 'كود الرف يتجاوز 50 حرف' });
        }
        const shelfKey = shelfCode.toLowerCase();
        if (!shelfMap[shelfKey]) {
            warnings.push(`الرف "${shelfCode}" غير موجود في النظام، سيتم تخزين الكود فقط`);
        } else {
            shelfId = shelfMap[shelfKey];
        }
    }

    // ─── Weight ───
    const weightVal = weight;

    // ─── Category validation against DB ───
    let categoryId = null;
    if (category && categoryCache) {
        const catKey = category.toLowerCase();
        if (!categoryCache.has(catKey)) {
            warnings.push(`الفئة "${category}" غير موجودة، سيتم إنشاؤها`);
        } else {
            categoryId = categoryCache.get(catKey);
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        data: {
            name: name.trim(),
            category,
            categoryId,
            unit: unit.trim(),
            qty,
            avgCost,
            minQty,
            barcode: barcodeClean,
            shelfCode,
            shelfId,
            weight: weightVal,
            expiryDate,
        },
    };
}

// ─── AUDIT LOGGING ──────────────────────────────────────────────────────────────
async function logAudit(client, userId, action, entityType, entityId, oldData, newData, metadata = {}) {
    try {
        await client.query(`
            INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data, metadata, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `, [userId, action, entityType, entityId, 
            oldData ? JSON.stringify(oldData) : null,
            newData ? JSON.stringify(newData) : null,
            JSON.stringify(metadata)]);
    } catch (e) {
        // Don't fail the main operation if audit logging fails
        logger.warn('[audit] Failed to log audit: ' + e.message);
    }
}

// ─── HELPERS ────────────────────────────────────────────────────────────────────
function parseCsv(csvText) {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) {return [];}
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
        const values = line.split(',');
        const row = {};
        headers.forEach((h, i) => { row[h] = values[i]?.trim() ?? ''; });
        return row;
    });
}

// ─── PREVIEW ENDPOINT — POST /api/inventory/import-preview ───
router.post('/preview', jwtAuth, requireRole('manager', 'admin'), crudLimiter, async (req, res) => {
    try {
        // Parse input (same as import endpoint)
        let rows = [];
        if (Array.isArray(req.body)) {
            rows = req.body;
        } else if (Array.isArray(req.body.rows)) {
            rows = req.body.rows;
        } else if (typeof req.body === 'string') {
            rows = parseCsv(req.body);
        } else if (typeof req.body.csv === 'string') {
            rows = parseCsv(req.body.csv);
        }

        if (rows.length === 0) {
            return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'No rows found' });
        }
        if (rows.length > 5000) {
            return res.status(400).json({ error: 'TOO_MANY_ROWS', message: 'الحد الأقصى 5000 صف' });
        }

        // Pre-load caches
        const [categories, shelves, existingItems] = await Promise.all([
            pool.query('SELECT id, name FROM categories WHERE active = true'),
            pool.query('SELECT id, code FROM shelves WHERE active = true'),
            pool.query('SELECT name, barcode FROM inventory WHERE deleted_at IS NULL'),
        ]);

        const categoryCache = new Map(categories.rows.map(r => [r.name.toLowerCase(), r.id]));
        const shelfMap = new Map(shelves.rows.map(r => [r.code.toLowerCase(), r.id]));
        const existingNames = new Set(existingItems.rows.map(r => r.name.toLowerCase()));
        const existingBarcodes = new Set(existingItems.rows.filter(r => r.barcode).map(r => r.barcode.toLowerCase()));

        const results = [];
        let validCount = 0;
        let invalidCount = 0;
        const allErrors = [];
        const allWarnings = [];

        for (let i = 0; i < rows.length; i++) {
            const validation = validateRow(rows[i], i + 1, existingNames, existingBarcodes, categoryCache, shelfMap);
            results.push({ row: i + 1, ...validation });
            if (validation.isValid) {validCount++;} else {invalidCount++;}
            allErrors.push(...validation.errors.map(e => ({ row: i + 1, ...e })));
            allWarnings.push(...validation.warnings.map(w => ({ row: i + 1, message: w })));
        }

        res.json({
            total: rows.length,
            valid: validCount,
            invalid: invalidCount,
            rows: results,
            errors: allErrors,
            warnings: allWarnings,
        });
    } catch (err) {
        logger.error({ err: err.message }, '[inventory] preview failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

// ─── MAIN IMPORT ENDPOINT — POST /api/inventory/import ───
router.post('/', jwtAuth, requireRole('manager', 'admin'), crudLimiter, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Parse input (same as preview)
        let rows = [];
        if (Array.isArray(req.body)) {
            rows = req.body;
        } else if (Array.isArray(req.body.rows)) {
            rows = req.body.rows;
        } else if (typeof req.body === 'string') {
            rows = parseCsv(req.body);
        } else if (typeof req.body.csv === 'string') {
            rows = parseCsv(req.body.csv);
        }

        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'No rows found' });
        }
        if (rows.length > MAX_IMPORT_ROWS) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'TOO_MANY_ROWS', message: 'الحد الأقصى ' + MAX_IMPORT_ROWS + ' صف' });
        }

        // Pre-load caches
        const [categories, shelves, existingItems] = await Promise.all([
            pool.query('SELECT id, name FROM categories WHERE active = true'),
            pool.query('SELECT id, code FROM shelves WHERE active = true'),
            pool.query('SELECT name, barcode FROM inventory WHERE deleted_at IS NULL'),
        ]);

        const categoryCache = new Map(categories.rows.map(r => [r.name.toLowerCase(), r.id]));
        const shelfMap = new Map(shelves.rows.map(r => [r.code.toLowerCase(), r.id]));
        const existingNames = new Set(existingItems.rows.map(r => r.name.toLowerCase()));
        const existingBarcodes = new Set(existingItems.rows.filter(r => r.barcode).map(r => r.barcode.toLowerCase()));

        let imported = 0;
        const errors = [];

        for (let i = 0; i < rows.length; i++) {
            const validation = validateRow(rows[i], i + 1, existingNames, existingBarcodes, categoryCache, shelfMap);
            if (!validation.isValid) {
                errors.push({ row: i + 1, errors: validation.errors });
                continue;
            }

            const d = validation.data;
            const spName = `sp_import_${i}_${Date.now()}`;
            try {
                await client.query(`SAVEPOINT ${spName}`);

                // Ensure category exists
                let catId = d.categoryId;
                if (!catId) {
                    const catRes = await client.query(
                        `INSERT INTO categories (name, active, created_at) VALUES ($1, true, NOW()) ON CONFLICT (name) DO UPDATE SET active = true RETURNING id`,
                        [d.category]
                    );
                    catId = catRes.rows[0].id;
                }

                // Insert inventory item
                // الوزن المتغير: صنف لحوم/دواجن/أسماك مخزون بالوزن ⇒ تفعيل تلقائي
                // (على الإدخالات الجديدة فقط — الاستيراد لا يلغي تفعيلًا يدويًا سابقًا)
                const cwDefaults = require('../catch-weight-heuristic').suggestCatchWeight(d.name, d.unit) || {
                    catch_weight_enabled: false,
                    inventory_uom: null,
                    packaging_uom: null,
                    catch_weight_uom: 'kg',
                };
                const itemRes = await client.query(`
                    INSERT INTO inventory (name, category_id, unit, qty, "avgCost", min_qty, barcode, shelf_code, weight, created_at,
                                           catch_weight_enabled, inventory_uom, packaging_uom, catch_weight_uom)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10, $11, $12, $13)
                    ON CONFLICT (name) DO UPDATE SET
                        category_id = EXCLUDED.category_id,
                        unit = EXCLUDED.unit,
                        qty = inventory.qty + EXCLUDED.qty,
                        "avgCost" = EXCLUDED."avgCost",
                        min_qty = EXCLUDED.min_qty,
                        barcode = COALESCE(EXCLUDED.barcode, inventory.barcode),
                        shelf_code = EXCLUDED.shelf_code,
                        weight = EXCLUDED.weight,
                        updated_at = NOW()
                    RETURNING id
                `, [d.name, catId, d.unit, d.qty, d.avgCost, d.minQty, d.barcode, d.shelfCode, d.weight,
                    cwDefaults.catch_weight_enabled, cwDefaults.inventory_uom, cwDefaults.packaging_uom, cwDefaults.catch_weight_uom]);

                await logAudit(client, req.user.id, 'CREATE', 'inventory', itemRes.rows[0].id, null, d, { import: true });
                await client.query(`RELEASE SAVEPOINT ${spName}`);
                imported++;
            } catch (err) {
                await client.query(`ROLLBACK TO SAVEPOINT ${spName}`).catch(() => {});
                errors.push({ row: i + 1, errors: [{ field: 'general', message: err.message }] });
            }
        }

        await client.query('COMMIT');

        logger.info({ total: rows.length, imported, errors: errors.length }, '[inventory] import completed');
        res.status(201).json({
            total: rows.length,
            imported,
            errors: errors.length,
            errorDetails: errors.slice(0, 50),
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error({ err: err.message }, '[inventory] import failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    } finally {
        client.release();
    }
});

// ─── TEMPLATE ENDPOINT ───
router.get('/template', jwtAuth, async (req, res) => {
    const csv = `name,category,unit,qty,avgCost,minQty,barcode,shelfCode,weight,expiryDate
دجاج طازج,بروتين,كجم,50,25,10,,MEAT,0,2026-11-30
أرز بسمتي,حبوب,كيس,80,15,10,,DRY,0,2027-06-30
بصل,خضار,كجم,100,3,20,,VEG,0,2026-10-31`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="inventory-import-template.csv"');
    res.send(csv);
});

module.exports = { router, validateRow, pick, toNumber, parseCsv, logAudit };