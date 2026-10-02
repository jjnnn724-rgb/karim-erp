/**
 * shift-routes.js — Shift session management endpoints.
 *   POST /api/pos/shifts/open
 *   POST /api/pos/shifts/:id/close
 *   GET  /api/pos/shifts/active
 *   GET  /api/pos/shifts/:id/summary
 *   GET  /api/pos/departments
 *   GET  /api/pos/products?department_id=...
 *   GET  /api/pos/dashboard  (cashier KPIs)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { logger } = require("../logger");
const { MENU_IMAGE_ROOT, ensureMediaDirs, safeProductImageName, removeMenuImageByUrl } = require('../media-storage');
const { pool, withTransaction } = require('./db-pool');
const { jwtAuth, requireRole } = require('./jwt-middleware');
const { rateLimit } = require('./rate-limit');
const { writeAuditLog } = require('./audit-middleware');
const { UNIT_DEFINITIONS, normalizeUnit, convertQuantity, formatUnit } = require('../unit-conversion');
const { ensureBuffetSetup } = require('./buffet-routes');

const router = express.Router();
const PRODUCTS_CACHE_TTL_MS = 2000;
const DASHBOARD_CACHE_TTL_MS = 5000;
const DASHBOARD_STALE_TTL_MS = 20000;
const productsCache = new Map();
let dashboardCache = { expiresAt: 0, value: null, pending: null };

function createSingleFlightCache({ ttlMs = 2000 } = {}) {
    let value = null;
    let expiresAt = 0;
    let pending = null;

    return {
        read(fetcher) {
            const now = Date.now();
            if (value && expiresAt > now) {
                return Promise.resolve(value);
            }
            if (pending) {
                return pending;
            }

            pending = Promise.resolve()
                .then(fetcher)
                .then((nextValue) => {
                    value = nextValue;
                    expiresAt = Date.now() + ttlMs;
                    pending = null;
                    return nextValue;
                })
                .catch((err) => {
                    pending = null;
                    throw err;
                });

            return pending;
        },
        clear() {
            value = null;
            expiresAt = 0;
            pending = null;
        },
        get snapshot() {
            return { value, expiresAt, pending };
        },
    };
}

ensureMediaDirs();
const MENU_IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const menuImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (!MENU_IMAGE_EXTENSIONS[file.mimetype]) {return cb(Object.assign(new Error('يسمح فقط بصور JPG أو PNG أو WEBP'), { code: 'INVALID_IMAGE_TYPE' }));}
        cb(null, true);
    },
});
function hasValidImageSignature(file) {
    if (!file?.buffer) {return false;}
    const b = file.buffer;
    if (file.mimetype === 'image/png') {return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));}
    if (file.mimetype === 'image/jpeg') {return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;}
    if (file.mimetype === 'image/webp') {return b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';}
    return false;
}

function uploadMenuImage(req, res, next) {    menuImageUpload.single('image')(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {return res.status(413).json({ error: 'IMAGE_TOO_LARGE', message: 'حجم الصورة يجب ألا يتجاوز 5 ميجابايت' });}
            if (err.code === 'INVALID_IMAGE_TYPE') {return res.status(422).json({ error: 'INVALID_IMAGE_TYPE', message: err.message });}
            return res.status(422).json({ error: 'IMAGE_UPLOAD_FAILED', message: 'تعذر قراءة الصورة' });
        }
        if (!req.file || !req.file.buffer) {return res.status(422).json({ error: 'IMAGE_REQUIRED', message: 'اختر صورة للصنف أولاً' });}
        if (!hasValidImageSignature(req.file)) {return res.status(422).json({ error: 'INVALID_IMAGE_CONTENT', message: 'محتوى الصورة غير صالح' });}
        return next();
    });
}

// بث تغيير الكتالوج لكل شاشات الكاشير لحظيًا (تحديث تلقائي بلا ريفريش)
function emitCatalogChanged(req, action, data) {
    productsCache.clear();
    try {
        if (!req.io) {return;}
        const payload = {
            entity: 'posProducts',
            entityName: 'أصناف الكاشير',
            action,
            data: data || null,
            changedBy: req.headers?.['x-device-name'] || 'الكاشير',
            changedAt: new Date().toISOString(),
        };
        const sender = req.headers?.['x-socket-id'];
        if (sender && typeof req.io.except === 'function') {req.io.except(sender).emit('entity_changed', payload);}
        else {req.io.emit('entity_changed', payload);}
    } catch (_) { /* البث غير حرج */ }
}


function parseDateOnly(value, fieldName) {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw Object.assign(new Error(`${fieldName} must be in YYYY-MM-DD format`), { statusCode: 422 });
    }
    const d = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) {
        throw Object.assign(new Error(`${fieldName} is invalid`), { statusCode: 422 });
    }
    return raw;
}

function parsePositiveInt(value, fieldName) {
    if (value === undefined || value === null || value === '') {return null;}
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n <= 0) {
        throw Object.assign(new Error(`${fieldName} must be a positive integer`), { statusCode: 422 });
    }
    return n;
}

function coerceNumericRecord(record = {}) {
    const out = { ...record };
    for (const [key, value] of Object.entries(out)) {
        if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)) {
            out[key] = Number(value);
        }
    }
    if (out.payment_methods && typeof out.payment_methods === 'object' && !Array.isArray(out.payment_methods)) {
        for (const [method, amount] of Object.entries(out.payment_methods)) {
            if (typeof amount === 'string' && /^-?\d+(?:\.\d+)?$/.test(amount)) {
                out.payment_methods[method] = Number(amount);
            }
        }
    }
    return out;
}

function canManageCatalog(user) {
    return ['admin', 'manager'].includes(user?.role);
}

function normalizeNullableText(value) {
    if (value === undefined || value === null) {return null;}
    const trimmed = String(value).trim();
    return trimmed === '' ? null : trimmed;
}

function normalizeProductPayload(body = {}) {
    return {
        name_ar: normalizeNullableText(body.name_ar),
        name_en: normalizeNullableText(body.name_en),
        barcode: normalizeNullableText(body.barcode),
        category: normalizeNullableText(body.category),
        unit: normalizeNullableText(body.unit) || 'قطعة',
        price: Number(body.price || 0),
        cost_price: body.cost_price === '' || body.cost_price === undefined || body.cost_price === null ? null : Number(body.cost_price || 0),
        stock_quantity: Number(body.stock_quantity || 0),
        min_stock_level: Number(body.min_stock_level || 0),
        vat_rate: Number(body.vat_rate ?? 15),
        department_id: body.department_id === '' || body.department_id === undefined || body.department_id === null ? null : Number(body.department_id),
        department_ids: Array.isArray(body.department_ids)
            ? [...new Set(body.department_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
            : (body.department_id === '' || body.department_id === undefined || body.department_id === null ? [] : [Number(body.department_id)]),
        is_active: body.is_active !== false,
    };
}

function validateProductPayload(payload) {
    const errors = [];
    if (!payload.name_ar) {errors.push('اسم المنتج مطلوب');}
    if (!Number.isFinite(payload.price) || payload.price < 0) {errors.push('سعر البيع غير صحيح');}
    if (payload.cost_price !== null && (!Number.isFinite(payload.cost_price) || payload.cost_price < 0)) {errors.push('سعر التكلفة غير صحيح');}
    if (!Number.isFinite(payload.stock_quantity) || payload.stock_quantity < 0) {errors.push('المخزون الحالي غير صحيح');}
    if (!Number.isFinite(payload.min_stock_level) || payload.min_stock_level < 0) {errors.push('حد التنبيه غير صحيح');}
    if (!Number.isFinite(payload.vat_rate) || payload.vat_rate < 0) {errors.push('نسبة الضريبة غير صحيحة');}
    if (payload.department_id !== null && (!Number.isInteger(payload.department_id) || payload.department_id <= 0)) {errors.push('القسم غير صحيح');}
    if (payload.department_ids.some((id) => !Number.isInteger(id) || id <= 0)) {errors.push('الأقسام غير صحيحة');}
    return errors;
}

// ─── Departments ────────────────────────────────────────────────────────────
router.get('/departments', jwtAuth, requireRole('cashier','manager','admin','auditor','accountant'), async (req, res) => {
    try {
        // جدول departments هو مصدر الحقيقة. تتم مزامنة POS لحظيًا عند فتح شاشة الكاشير.
        const legacy = (await pool.query(`SELECT code, name, icon FROM departments ORDER BY id`)).rows;
        for (let index = 0; index < legacy.length; index += 1) {
            const dept = legacy[index];
            const code = `erp_${String(dept.code).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
            await pool.query(`
                INSERT INTO pos_departments (code, name_ar, name_en, legacy_dept_code, is_active, sort_order)
                VALUES ($1, $2, $3, $4, true, $5)
                ON CONFLICT (code) DO UPDATE SET
                    name_ar = EXCLUDED.name_ar,
                    name_en = EXCLUDED.name_en,
                    legacy_dept_code = EXCLUDED.legacy_dept_code,
                    is_active = true,
                    sort_order = EXCLUDED.sort_order,
                    updated_at = CURRENT_TIMESTAMP
            `, [code, dept.name, dept.name, dept.code, index + 1]);
        }
        await pool.query(`
            UPDATE pos_departments p SET is_active = false, updated_at = CURRENT_TIMESTAMP
            WHERE p.legacy_dept_code IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM departments d WHERE d.code = p.legacy_dept_code)
        `);
        const r = await pool.query(
            `SELECT id, code, name_ar, name_en, is_active, vat_number FROM pos_departments WHERE is_active = true ORDER BY sort_order, id;`
        );
        res.json(r.rows);
    } catch (e) { logger.error(e); res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر مزامنة أقسام الكاشير مع أقسام النظام' }); }
});

// ─── Products ───────────────────────────────────────────────────────────────
router.get('/products', jwtAuth, requireRole('cashier','manager','admin','auditor','accountant','kitchen'), async (req, res) => {
    const deptId = req.query.department_id ? parseInt(req.query.department_id, 10) : null;
    const includeInactive = String(req.query.include_inactive || '') === 'true' && canManageCatalog(req.user);
    const cacheKey = `${deptId || 'all'}:${includeInactive ? 'inactive' : 'active'}`;
    const cached = productsCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
        return res.json(cached.value);
    }

    if (cached && cached.pending) {
        try {
            const rows = await cached.pending;
            return res.json(rows);
        } catch (e) {
            productsCache.delete(cacheKey);
            logger.error('[pos/products] pending query failed', e);
            return res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    }

    try {
        const pending = pool.query(
            `SELECT p.id, p.name_ar, p.name_en, p.barcode, p.price, p.cost_price,
                    CASE
                      WHEN EXISTS (SELECT 1 FROM pos_product_ingredients pi0 WHERE pi0.product_id = p.id)
                      THEN COALESCE((
                        SELECT FLOOR(MIN(i.qty / NULLIF(pi.quantity_per_unit * (1 + pi.waste_percent / 100), 0)))
                          FROM pos_product_ingredients pi
                          JOIN inventory i ON i.id = pi.inventory_id
                         WHERE pi.product_id = p.id
                      ), 0)
                      ELSE p.stock_quantity
                    END AS stock_quantity,
                    p.vat_rate, p.category, p.unit, p.department_id, p.is_active, p.min_stock_level, p.image_url,
                    COALESCE((SELECT COUNT(*) FROM pos_product_ingredients pi1 WHERE pi1.product_id = p.id), 0)::int AS ingredient_count,
                    COALESCE(p.metadata, '{}'::jsonb) AS metadata,
                    COALESCE((SELECT array_agg(pd.department_id ORDER BY pd.department_id) FROM pos_product_departments pd WHERE pd.product_id = p.id), CASE WHEN p.department_id IS NULL THEN ARRAY[]::bigint[] ELSE ARRAY[p.department_id] END) AS department_ids
               FROM pos_products p
              WHERE 1=1
                AND COALESCE(p.metadata->>'catalog_scope', 'menu') <> 'buffet_only'
                ${includeInactive ? "AND COALESCE(p.metadata->>'catalog_scope', 'menu') = 'menu'" : 'AND p.is_active = true'}
                ${deptId ? 'AND (p.department_id = $1 OR p.department_id IS NULL OR EXISTS (SELECT 1 FROM pos_product_departments pd WHERE pd.product_id = p.id AND pd.department_id = $1))' : ''}
              ORDER BY p.category NULLS LAST, p.name_ar;`,
            deptId ? [deptId] : []
        ).then((r) => r.rows);

        productsCache.set(cacheKey, { expiresAt: Date.now() + PRODUCTS_CACHE_TTL_MS, pending, value: null });
        const rows = await pending;
        productsCache.set(cacheKey, { expiresAt: Date.now() + PRODUCTS_CACHE_TTL_MS, value: rows, pending: null });
        res.json(rows);
    } catch (e) {
        productsCache.delete(cacheKey);
        logger.error(e);
        res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
});

router.post('/products/:id/image', jwtAuth, requireRole('manager','admin'), uploadMenuImage, async (req, res) => {
    const productId = parsePositiveInt(req.params.id, 'product_id');
    if (!req.file) {return res.status(422).json({ error: 'IMAGE_REQUIRED', message: 'اختر صورة للصنف أولاً' });}
    const extension = MENU_IMAGE_EXTENSIONS[req.file.mimetype];
    const client = await pool.connect();
    let imageUrl = null;
    try {
        await client.query('BEGIN');
        const product = await client.query(`SELECT id, image_url FROM pos_products WHERE id = $1 FOR UPDATE`, [productId]);
        if (!product.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'NOT_FOUND' }); }
        const filename = safeProductImageName(productId, extension);
        imageUrl = `/uploads/menu/${filename}`;
        await fs.promises.writeFile(path.join(MENU_IMAGE_ROOT, filename), req.file.buffer, { flag: 'wx' });
        const updated = await client.query(`UPDATE pos_products SET image_url = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, image_url`, [productId, imageUrl]);
        await client.query('COMMIT');
        removeMenuImageByUrl(product.rows[0].image_url);
        res.json(updated.rows[0]);
        emitCatalogChanged(req, 'update', { id: productId, image_url: imageUrl });
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        if (imageUrl) { try { await fs.promises.unlink(path.join(MENU_IMAGE_ROOT, path.basename(imageUrl))); } catch (_) {} }
        logger.error(e); res.status(500).json({ error: 'IMAGE_UPLOAD_FAILED', message: 'تعذر حفظ صورة الصنف' });
    } finally { client.release(); }
});

router.delete('/products/:id/image', jwtAuth, requireRole('manager','admin'), async (req, res) => {
    const productId = parsePositiveInt(req.params.id, 'product_id');
    try {
        const old = await pool.query(`SELECT image_url FROM pos_products WHERE id = $1`, [productId]);
        if (!old.rows.length) {return res.status(404).json({ error: 'NOT_FOUND' });}
        await pool.query(`UPDATE pos_products SET image_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [productId]);
        removeMenuImageByUrl(old.rows[0].image_url);
        res.json({ id: productId, image_url: null });
        emitCatalogChanged(req, 'update', { id: productId, image_url: null });
    } catch (e) { logger.error(e); res.status(500).json({ error: 'IMAGE_DELETE_FAILED' }); }
});

// ─── Restaurant recipe/BOM management ───────────────────────────────────────
router.get('/recipe-units', jwtAuth, requireRole('manager','admin','auditor'), (req, res) => {
    res.json(UNIT_DEFINITIONS.map(unit => ({ value: unit.value, label: unit.label, family: unit.family })));
});

router.get('/recipes/catalog', jwtAuth, requireRole('manager','admin','auditor','kitchen'), async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT r.id AS recipe_id, r.name, r."deptId", r."sellingPrice", r."totalCost", r."costRatio",
                   p.id AS product_id, p.image_url, p.price AS pos_price, p.cost_price AS pos_cost_price,
                   COALESCE((SELECT COUNT(*) FROM pos_product_ingredients pi WHERE pi.product_id = p.id), 0)::int AS ingredient_count
              FROM recipes r
              LEFT JOIN pos_products p ON (p.metadata->>'legacy_recipe_id') = r.id::text
             ORDER BY r.id DESC`);
        res.json(r.rows);
    } catch (e) { dashboardCache = { expiresAt: 0, value: null, pending: null }; logger.error(e); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
});

router.get('/ingredients', jwtAuth, requireRole('manager','admin'), async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT id, name, category, unit, weight, qty, "avgCost", "minQty"
               FROM inventory
              WHERE qty IS NOT NULL
              ORDER BY category NULLS LAST, name;`
        );
        res.json(r.rows);
    } catch (e) { logger.error(e); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
});

router.post('/recipes/sync-legacy', jwtAuth, requireRole('manager','admin'), async (req, res) => {
    const recipeId = Number(req.body?.recipe_id);
    if (!Number.isInteger(recipeId) || recipeId <= 0) {return res.status(422).json({ error: 'INVALID_RECIPE_ID' });}
    try {
        const recipe = await pool.query(`SELECT id, name, "deptId", "sellingPrice", "totalCost" FROM recipes WHERE id = $1`, [recipeId]);
        if (!recipe.rows.length) {return res.status(404).json({ error: 'RECIPE_NOT_FOUND' });}
        const r = recipe.rows[0];
        const dept = await pool.query(`SELECT id FROM pos_departments WHERE legacy_dept_code = $1 AND is_active = true LIMIT 1`, [r.deptId]);
        const departmentId = dept.rows[0]?.id || null;
        const existing = await pool.query(`SELECT id FROM pos_products WHERE (metadata->>'legacy_recipe_id') = $1 OR LOWER(name_ar) = LOWER($2) ORDER BY id LIMIT 1`, [String(r.id), r.name]);
        let product;
        if (existing.rows.length) {
            product = (await pool.query(`UPDATE pos_products SET name_ar=$2, name_en=$2, price=$3, cost_price=$4, department_id=$5, is_active=true, metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('legacy_recipe_id',$6::text,'catalog_scope','menu','managed_in','restaurant','recipe_managed',true), updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id,name_ar,name_en,price,cost_price,department_id,is_active,image_url`, [existing.rows[0].id, r.name, Number(r.sellingPrice || 0), Number(r.totalCost || 0), departmentId, String(r.id)])).rows[0];
        } else {
            product = (await pool.query(`INSERT INTO pos_products (name_ar,name_en,price,cost_price,stock_quantity,min_stock_level,is_active,category,unit,department_id,metadata) VALUES ($1,$1,$2,$3,0,0,true,'وصفة','طلب',$4,jsonb_build_object('legacy_recipe_id',$5::text,'catalog_scope','menu','managed_in','restaurant','recipe_managed',true)) RETURNING id,name_ar,name_en,price,cost_price,department_id,is_active,image_url`, [r.name, Number(r.sellingPrice || 0), Number(r.totalCost || 0), departmentId, String(r.id)])).rows[0];
        }
        res.json({ recipe_id: r.id, product, synced: true });
    } catch (e) {
        logger.error('[sync_legacy_recipe]', e);
        res.status(500).json({ error: 'RECIPE_SYNC_FAILED', message: 'تعذر مزامنة الوصفة مع منيو الكاشير' });
    }
});

router.get('/products/:id/ingredients', jwtAuth, requireRole('manager','admin','auditor'), async (req, res) => {
    const productId = parsePositiveInt(req.params.id, 'product_id');
    try {
        const r = await pool.query(
            `SELECT pi.id, pi.product_id, pi.inventory_id, i.name AS inventory_name,
                    i.unit AS inventory_unit, i.weight AS inventory_weight, i.qty AS available_qty, i."avgCost" AS avg_cost,
                    pi.quantity_per_unit, pi.unit, pi.waste_percent, pi.notes,
                    ROUND((pi.quantity_per_unit * (1 + pi.waste_percent / 100) * COALESCE(i."avgCost", 0))::numeric, 2) AS extended_cost
               FROM pos_product_ingredients pi
               JOIN inventory i ON i.id = pi.inventory_id
              WHERE pi.product_id = $1
              ORDER BY i.name;`,
            [productId]
        );
        const rows = r.rows.map(row => {
            try {
                const inventoryQuantity = convertQuantity(Number(row.quantity_per_unit), row.unit, row.inventory_unit, { inventoryWeight: Number(row.inventory_weight || 0) });
                return { ...row, inventory_unit_normalized: normalizeUnit(row.inventory_unit), quantity_in_inventory_units: inventoryQuantity, extended_cost: Number((inventoryQuantity * (1 + Number(row.waste_percent || 0) / 100) * Number(row.avg_cost || 0)).toFixed(4)), unit_error: null };
            } catch (error) {
                return { ...row, inventory_unit_normalized: normalizeUnit(row.inventory_unit), quantity_in_inventory_units: null, extended_cost: null, unit_error: 'وحدات غير متوافقة' };
            }
        });
        res.json(rows);
    } catch (e) { logger.error(e); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
});

router.put('/products/:id/ingredients', jwtAuth, requireRole('manager','admin'), async (req, res) => {
    const productId = parsePositiveInt(req.params.id, 'product_id');
    const ingredients = Array.isArray(req.body?.ingredients) ? req.body.ingredients : [];
    if (ingredients.length > 100) {return res.status(422).json({ error: 'TOO_MANY_INGREDIENTS' });}

    const normalized = [];
    const seen = new Set();
    for (const item of ingredients) {
        const inventoryId = Number(item.inventory_id);
        const quantity = Number(item.quantity_per_unit);
        const waste = Number(item.waste_percent || 0);
        if (!Number.isInteger(inventoryId) || inventoryId <= 0 || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(waste) || waste < 0 || waste > 100) {
            return res.status(422).json({ error: 'INVALID_INGREDIENT', message: 'بيانات مكونات الوصفة غير صحيحة' });
        }
        if (seen.has(inventoryId)) {return res.status(422).json({ error: 'DUPLICATE_INGREDIENT', message: 'لا يمكن تكرار نفس المكون في الوصفة' });}
        seen.add(inventoryId);
        normalized.push({
            inventoryId,
            quantity,
            unit: normalizeNullableText(item.unit) || 'وحدة',
            waste,
            notes: normalizeNullableText(item.notes),
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const product = await client.query(`SELECT id FROM pos_products WHERE id = $1 FOR UPDATE`, [productId]);
        if (!product.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'NOT_FOUND' }); }
        const inventoryMeta = new Map();
        if (normalized.length) {
            const ids = normalized.map(item => item.inventoryId);
            const check = await client.query(`SELECT id, unit, weight, "avgCost" FROM inventory WHERE id = ANY($1::bigint[])`, [ids]);
            if (check.rows.length !== ids.length) { await client.query('ROLLBACK'); return res.status(422).json({ error: 'INVENTORY_ITEM_NOT_FOUND' }); }
            for (const row of check.rows) {inventoryMeta.set(Number(row.id), row);}
            for (const item of normalized) {
                const inv = inventoryMeta.get(item.inventoryId);
                try {
                    item.inventoryQuantity = convertQuantity(item.quantity, item.unit, inv.unit, { inventoryWeight: Number(inv.weight || 0) });
                } catch (_) {
                    await client.query('ROLLBACK');
                    return res.status(422).json({ error: 'INCOMPATIBLE_UNITS', message: `وحدة ${item.unit} لا تتوافق مع وحدة تخزين ${inv.unit}` });
                }
            }
        }
        await client.query(`DELETE FROM pos_product_ingredients WHERE product_id = $1`, [productId]);
        for (const item of normalized) {
            await client.query(
                `INSERT INTO pos_product_ingredients
                    (product_id, inventory_id, quantity_per_unit, unit, waste_percent, notes)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [productId, item.inventoryId, item.quantity, item.unit, item.waste, item.notes]
            );
        }
        const totalCost = Number(normalized.reduce((sum, item) => {
            const inv = inventoryMeta.get(item.inventoryId);
            return sum + Number(item.inventoryQuantity || 0) * (1 + item.waste / 100) * Number(inv?.avgCost || 0);
        }, 0).toFixed(4));
        await client.query(
            `UPDATE pos_products
                SET cost_price = $2,
                    metadata = COALESCE(metadata, '{}'::jsonb)
                        || jsonb_build_object('catalog_scope','menu','managed_in','restaurant','recipe_managed',true),
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = $1`,
            [productId, totalCost]
        );
        await client.query(
            `UPDATE recipes r
                SET "totalCost" = $1,
                    "costRatio" = CASE WHEN COALESCE(r."sellingPrice", 0) > 0 THEN ROUND(($1 / r."sellingPrice") * 100, 2) ELSE 0 END
              WHERE r.id = CASE
                  WHEN (SELECT metadata->>'legacy_recipe_id' FROM pos_products WHERE id = $2) ~ '^[0-9]+$'
                  THEN ((SELECT metadata->>'legacy_recipe_id' FROM pos_products WHERE id = $2))::bigint
                  ELSE NULL
              END`,
            [totalCost, productId]
        );
        await client.query('COMMIT');
        res.json({ product_id: productId, ingredient_count: normalized.length, total_cost: totalCost });
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        logger.error(e);
        res.status(500).json({ error: 'INTERNAL_ERROR' });
    } finally { client.release(); }
});

router.post('/products', jwtAuth, requireRole('manager','admin'), async (req, res) => {
    const payload = normalizeProductPayload(req.body);
    payload.department_id = payload.department_ids[0] ?? null;
    const errors = validateProductPayload(payload);
    if (errors.length) {return res.status(422).json({ error: 'VALIDATION_FAILED', details: errors });}

    try {
        const r = await pool.query(
            `INSERT INTO pos_products
                (name_ar, name_en, barcode, price, cost_price, vat_rate, stock_quantity,
                 min_stock_level, is_active, category, unit, department_id, legacy_inventory_id, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7,
                     $8, $9, $10, $11, $12, NULL, jsonb_build_object('catalog_scope','menu','managed_in','pos'))
             RETURNING id, name_ar, name_en, barcode, price, cost_price, vat_rate, stock_quantity,
                       min_stock_level, is_active, category, unit, department_id, image_url;`,
            [
                payload.name_ar, payload.name_en, payload.barcode, payload.price, payload.cost_price, payload.vat_rate,
                0, 0, payload.is_active, payload.category, payload.unit, payload.department_id,
            ]
        );
        await pool.query(`DELETE FROM pos_product_departments WHERE product_id = $1`, [r.rows[0].id]);
        if (payload.department_ids.length) {
            await pool.query(`INSERT INTO pos_product_departments(product_id, department_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`, [r.rows[0].id, payload.department_ids]);
        }
        res.status(201).json({ ...r.rows[0], department_ids: payload.department_ids });
        emitCatalogChanged(req, 'create', r.rows[0]);
    } catch (e) {
        if (e.code === '23505') {return res.status(409).json({ error: 'DUPLICATE', message: 'الباركود مستخدم بالفعل' });}
        logger.error(e);
        res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
});

router.put('/products/:id', jwtAuth, requireRole('manager','admin'), async (req, res) => {
    const productId = parseInt(req.params.id, 10);
    if (!Number.isInteger(productId) || productId <= 0) {return res.status(422).json({ error: 'INVALID_PRODUCT_ID' });}

    const payload = normalizeProductPayload(req.body);
    payload.department_id = payload.department_ids[0] ?? null;
    const errors = validateProductPayload(payload);
    if (errors.length) {return res.status(422).json({ error: 'VALIDATION_FAILED', details: errors });}

    try {
        const r = await pool.query(
            `UPDATE pos_products
                SET name_ar = $2,
                    name_en = $3,
                    barcode = $4,
                    price = $5,
                    cost_price = $6,
                    vat_rate = $7,
                    stock_quantity = stock_quantity,
                    min_stock_level = min_stock_level,
                    is_active = $8,
                    category = $9,
                    unit = $10,
                    department_id = $11,
                    legacy_inventory_id = NULL,
                    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('catalog_scope','menu','managed_in','pos'),
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
              RETURNING id, name_ar, name_en, barcode, price, cost_price, vat_rate, stock_quantity,
                        min_stock_level, is_active, category, unit, department_id, image_url;`,
            [
                productId,
                payload.name_ar, payload.name_en, payload.barcode, payload.price, payload.cost_price,
                payload.vat_rate, payload.is_active,
                payload.category, payload.unit, payload.department_id,
            ]
        );
        if (!r.rows.length) {return res.status(404).json({ error: 'NOT_FOUND' });}
        await pool.query(`DELETE FROM pos_product_departments WHERE product_id = $1`, [productId]);
        if (payload.department_ids.length) {
            await pool.query(`INSERT INTO pos_product_departments(product_id, department_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`, [productId, payload.department_ids]);
        }
        res.json({ ...r.rows[0], department_ids: payload.department_ids });
        emitCatalogChanged(req, 'update', r.rows[0]);
    } catch (e) {
        if (e.code === '23505') {return res.status(409).json({ error: 'DUPLICATE', message: 'الباركود مستخدم بالفعل' });}
        logger.error(e);
        res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
});

router.delete('/products/:id', jwtAuth, requireRole('manager','admin'), async (req, res) => {
    const productId = parseInt(req.params.id, 10);
    if (!Number.isInteger(productId) || productId <= 0) {return res.status(422).json({ error: 'INVALID_PRODUCT_ID' });}

    try {
        const r = await pool.query(
            `UPDATE pos_products
                SET is_active = false,
                    legacy_inventory_id = NULL,
                    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('catalog_scope','menu','managed_in','pos'),
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
              RETURNING id;`,
            [productId]
        );
        if (!r.rows.length) {return res.status(404).json({ error: 'NOT_FOUND' });}
        res.json({ status: 'archived', id: productId });
        emitCatalogChanged(req, 'delete', { id: productId });
    } catch (e) {
        logger.error(e);
        res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
});

// ─── Database-backed held orders ─────────────────────────────────────────────
router.get('/held-orders', jwtAuth, requireRole('cashier','manager','admin','auditor','accountant'), async (req, res) => {
    const sessionId = parsePositiveInt(req.query.session_id, 'session_id');
    if (!sessionId) {return res.status(422).json({ error: 'INVALID_SESSION_ID' });}
    try {
        const r = await pool.query(
            `SELECT id, created_at, total_amount, items, cart_discount
               FROM pos_held_orders
              WHERE session_id = $1
              ORDER BY created_at DESC;`,
            [sessionId]
        );
        res.json(r.rows.map(row => ({
            id: row.id,
            created_at: row.created_at,
            total_amount: Number(row.total_amount),
            items_preview: (Array.isArray(row.items) ? row.items : []).map(item => `${item.name || 'صنف'}(${item.quantity})`).join('، '),
            items: row.items,
            cart_discount: row.cart_discount,
        })));
    } catch (e) { logger.error(e); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
});

router.post('/held-orders', jwtAuth, requireRole('cashier','manager','admin'), async (req, res) => {
    const sessionId = parsePositiveInt(req.body?.session_id, 'session_id');
    const departmentId = parsePositiveInt(req.body?.department_id, 'department_id');
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!sessionId || !departmentId || !rawItems.length) {return res.status(422).json({ error: 'INVALID_HELD_ORDER' });}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const session = await client.query(
            `SELECT id, department_id, cashier_id FROM pos_shift_sessions
              WHERE id = $1 AND status = 'open' FOR UPDATE;`,
            [sessionId]
        );
        if (!session.rows.length || Number(session.rows[0].department_id) !== departmentId) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'SHIFT_DEPARTMENT_MISMATCH', message: 'الوردية غير مطابقة للقسم' });
        }
        const productIds = [...new Set(rawItems.map(item => Number(item.product_id)).filter(Number.isInteger))];
        const productRes = await client.query(
            `SELECT id, name_ar, barcode, price, vat_rate FROM pos_products WHERE id = ANY($1::bigint[]) AND is_active = true`,
            [productIds]
        );
        const productsMap = new Map(productRes.rows.map(product => [Number(product.id), product]));
        const items = rawItems.map(item => {
            const product = productsMap.get(Number(item.product_id));
            const quantity = Number(item.quantity);
            const discount = Number(item.discount || 0);
            const unitPrice = Number(item.unit_price);
            if (!product || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > Number(product.price) || !Number.isFinite(discount) || discount < 0) {return null;}
            return { product_id: Number(product.id), name: product.name_ar, barcode: product.barcode, quantity, unit_price: unitPrice, discount, vat_rate: Number(product.vat_rate || 15) };
        });
        if (items.some(item => !item)) { await client.query('ROLLBACK'); return res.status(422).json({ error: 'INVALID_HELD_ITEM', message: 'بيانات صنف الطلب المعلق غير صحيحة' }); }
        const total = Number(items.reduce((sum, item) => sum + Math.max(0, item.quantity * item.unit_price - item.discount) * (1 + item.vat_rate / 100), 0).toFixed(2));
        const inserted = await client.query(
            `INSERT INTO pos_held_orders (session_id, department_id, cashier_id, items, cart_discount, total_amount)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, created_at, total_amount;`,
            [sessionId, departmentId, req.user.id, JSON.stringify(items), req.body.cart_discount ? JSON.stringify(req.body.cart_discount) : null, total]
        );
        await client.query('COMMIT');
        res.status(201).json({ ...inserted.rows[0], total_amount: Number(inserted.rows[0].total_amount) });
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        logger.error(e); res.status(500).json({ error: 'INTERNAL_ERROR' });
    } finally { client.release(); }
});

router.post('/held-orders/:id/recall', jwtAuth, requireRole('cashier','manager','admin'), async (req, res) => {
    const sessionId = parsePositiveInt(req.body?.session_id, 'session_id');
    const id = String(req.params.id || '').trim();
    if (!sessionId || !id) {return res.status(422).json({ error: 'INVALID_HELD_ORDER' });}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `DELETE FROM pos_held_orders WHERE id = $1 AND session_id = $2 RETURNING id, items, cart_discount, total_amount;`,
            [id, sessionId]
        );
        if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'HELD_ORDER_NOT_FOUND' }); }
        await client.query('COMMIT');
        const row = result.rows[0];
        res.json({ id: row.id, items: row.items, cart_discount: row.cart_discount, total_amount: Number(row.total_amount) });
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        logger.error(e); res.status(500).json({ error: 'INTERNAL_ERROR' });
    } finally { client.release(); }
});

router.delete('/held-orders/:id', jwtAuth, requireRole('cashier','manager','admin'), async (req, res) => {
    const sessionId = parsePositiveInt(req.query.session_id, 'session_id');
    const id = String(req.params.id || '').trim();
    if (!sessionId || !id) {return res.status(422).json({ error: 'INVALID_HELD_ORDER' });}
    try {
        // Scope the delete to the caller's own session — any cashier could
        // otherwise destroy a colleague's held cart by id alone.
        const ownSession = await pool.query(`SELECT id FROM pos_shift_sessions WHERE id = $1 AND cashier_id = $2`, [sessionId, req.user.id]);
        if (req.user.role === 'cashier' && !ownSession.rows.length) {
            return res.status(403).json({ error: 'FORBIDDEN', message: 'لا يمكن التعديل على طلبات محفوظة لجلسة كاشير آخر' });
        }
        const result = await pool.query(`DELETE FROM pos_held_orders WHERE id = $1 AND session_id = $2 RETURNING id`, [id, sessionId]);
        if (!result.rows.length) {return res.status(404).json({ error: 'HELD_ORDER_NOT_FOUND' });}
        res.json({ status: 'deleted', id: result.rows[0].id });
    } catch (e) { logger.error(e); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
});

// ─── Open shift ─────────────────────────────────────────────────────────────
router.post('/shifts/open',
    jwtAuth, requireRole('cashier','manager','admin'),
    rateLimit({ windowMs: 60_000, max: 5, keyFn: r => `shift_open:${r.user.id}` }),
    async (req, res) => {
        const { department_id, opening_balance } = req.body;
        const newSessionRequested = req.body?.new_session === true;
        if (newSessionRequested && !['manager', 'admin'].includes(req.user.role)) {
            return res.status(403).json({ error: 'NEW_SESSION_FORBIDDEN', message: 'فتح جلسة جديدة متاح للمدير أو المسؤول فقط' });
        }
        if (!Number.isInteger(department_id) || department_id <= 0) {return res.status(422).json({ error: 'INVALID_DEPARTMENT_ID' });}
        if (typeof opening_balance !== 'number' || opening_balance < 0) {return res.status(422).json({ error: 'INVALID_OPENING_BALANCE' });}
        // ROOT FIX 2026-10-02: ثغرة البيع بعد الإغلاق — فتح وردية بعد Z كان يبيع
        // في يوم مغلق بلا أثر في إغلاق اليوم. الأدمن وحده يتجاوز صراحة (force).
        if (req.body?.force !== true) {
            const closedToday = await pool.query(`SELECT 1 FROM pos_day_closes WHERE close_date = CURRENT_DATE LIMIT 1`);
            if (closedToday.rows.length) {
                return res.status(409).json({ error: 'DAY_ALREADY_CLOSED', message: 'اليوم مقفل بإغلاق نهائي (Z) — لا يمكن فتح وردية جديدة عليه. المدير المسؤول فقط يعيد الفتح.' });
            }
        }

        try {
            const result = await withTransaction(async (client) => {
                await client.query(`SELECT set_config('app.user_id', $1, true);`,   [String(req.user.id)]);
                await client.query(`SELECT set_config('app.user_role', $1, true);`, [req.user.role]);
                await client.query(`SELECT set_config('app.user_name', $1, true);`, [req.user.name || '']);
                await client.query(`SELECT set_config('app.client_ip', $1, true);`, [req.ip || '']);

                // Serialize shift-open per cashier: the dup-check + insert below is
                // a TOCTOU pair — two concurrent opens both saw no open shift and
                // created two sessions. A transaction advisory lock makes the
                // check-and-insert atomic per cashier.
                await client.query(`SELECT pg_advisory_xact_lock(hashtext('pos_shift_open:' || $1::text));`, [req.user.id]);
                // Check no open shift already exists for this cashier
                const dup = await client.query(
                    `SELECT 1 FROM pos_shift_sessions WHERE cashier_id = $1 AND status = 'open' LIMIT 1;`,
                    [req.user.id]
                );
                if (dup.rows.length > 0 && !newSessionRequested) {
                    throw Object.assign(new Error(`Cashier ${req.user.id} already has an open shift`), { code: 'SHIFT_ALREADY_OPEN' });
                }

                // Insert new shift session — equivalent to sp_pos_open_shift
                const ins = await client.query(
                    `INSERT INTO pos_shift_sessions (cashier_id, department_id, opening_balance, status)
                     VALUES ($1, $2, $3, 'open')
                     RETURNING id;`,
                    [req.user.id, department_id, opening_balance]
                );
                return ins.rows[0];
            }, { userId: req.user.id, userRole: req.user.role, userName: req.user.name, clientIp: req.ip });

            // The shift is already committed — an audit-log failure must not
            // turn the successful open into a client-visible 500 (which invites
            // a retry that now fails with SHIFT_ALREADY_OPEN)
            try {
                await writeAuditLog({
                    action: 'OPEN_SHIFT', tableName: 'pos_shift_sessions', rowPk: result.id,
                    metadata: { department_id, opening_balance },
                    actor: { userId: req.user.id, userName: req.user.name, role: req.user.role, ip: req.ip, requestId: req.id },
                });
            } catch (auditError) { logger.error('[shifts/open] audit log failed (non-fatal):', auditError.message); }
            res.status(201).json({ session_id: result.id, status: 'open', opening_balance, new_session: newSessionRequested });
        } catch (err) {
            if (err.code === 'SHIFT_ALREADY_OPEN' || /already has an open shift/i.test(err.message)) {
                return res.status(409).json({ error: 'SHIFT_ALREADY_OPEN', message: err.message });
            }
            logger.error('[shifts/open]', err); res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    }
);

// ─── Close shift ────────────────────────────────────────────────────────────
router.post('/shifts/:id/close', jwtAuth, requireRole('cashier','manager','admin'), async (req, res) => {
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {return res.status(422).json({ error: 'INVALID_SHIFT_SESSION_ID' });}
    const { actual_cash, notes } = req.body;
    if (typeof actual_cash !== 'number' || actual_cash < 0) {return res.status(422).json({ error: 'INVALID_ACTUAL_CASH' });}

    try {
        const result = await withTransaction(async (client) => {
            await client.query(`SELECT set_config('app.user_id', $1, true);`, [String(req.user.id)]);
            await client.query(`SELECT set_config('app.user_role', $1, true);`, [req.user.role]);
            const ss = await client.query(`SELECT * FROM pos_shift_sessions WHERE id = $1 FOR UPDATE;`, [sessionId]);
            if (ss.rows.length === 0) {throw Object.assign(new Error('NOT_FOUND'), { code: 404 });}
            const session = ss.rows[0];
            // cashier_id is BIGINT → node-postgres returns a STRING; comparing it
            // with the numeric JWT id with !== always failed, so cashiers could
            // never close their own shifts.
            if (req.user.role === 'cashier' && Number(session.cashier_id) !== Number(req.user.id)) {throw Object.assign(new Error('FORBIDDEN'), { code: 403 });}
            if (session.status !== 'open') {throw Object.assign(new Error(`Shift already ${session.status}`), { code: 409 });}

            // Compute expected_cash = opening_balance + cash_in - cash_out
            // (equivalent to sp_pos_close_shift logic, but inline because
            //  PostgreSQL 17 has issues with CALL + parameter placeholders)
            const cashRes = await client.query(
                `SELECT COALESCE(SUM(CASE WHEN ip.method = 'cash' AND ip.direction = 'in'  THEN ip.amount END), 0) -
                        COALESCE(SUM(CASE WHEN ip.method = 'cash' AND ip.direction = 'out' THEN ip.amount END), 0) AS net_cash
                   FROM pos_invoice_payments ip
                   JOIN pos_orders o ON o.id = ip.order_id
                  WHERE o.session_id = $1;`,
                [sessionId]
            );
            const expectedCash = Number(session.opening_balance) + Number(cashRes.rows[0].net_cash || 0);
            const variance = Number(actual_cash) - expectedCash;

            const upd = await client.query(
                `UPDATE pos_shift_sessions
                    SET status = 'closed',
                        actual_cash = $1,
                        expected_cash = $2,
                        cash_variance = $3,
                        closed_at = CURRENT_TIMESTAMP,
                        closed_by = $4,
                        closing_notes = $5
                  WHERE id = $6
                  RETURNING *;`,
                [actual_cash, expectedCash, variance, req.user.id, notes || null, sessionId]
            );
            return upd.rows[0];
        }, { userId: req.user.id, userRole: req.user.role, clientIp: req.ip });

        // Same non-fatal audit policy as shift-open
        try {
            await writeAuditLog({
                action: 'CLOSE_SHIFT', tableName: 'pos_shift_sessions', rowPk: sessionId,
                metadata: { actual_cash, expected_cash: result.expected_cash, variance: result.cash_variance },
                actor: { userId: req.user.id, userName: req.user.name, role: req.user.role, ip: req.ip, requestId: req.id },
            });
        } catch (auditError) { logger.error('[shifts/close] audit log failed (non-fatal):', auditError.message); }

        res.json({
            session_id: sessionId, status: 'closed',
            opening_balance: Number(result.opening_balance),
            expected_cash:   Number(result.expected_cash),
            actual_cash:     Number(result.actual_cash),
            cash_variance:   Number(result.cash_variance),
            closed_at:       result.closed_at,
        });
    } catch (err) {
        if (err.code === 404) {return res.status(404).json({ error: 'NOT_FOUND' });}
        if (err.code === 403) {return res.status(403).json({ error: 'FORBIDDEN' });}
        if (err.code === 409) {return res.status(409).json({ error: 'SHIFT_NOT_OPEN', message: err.message });}
        logger.error('[shifts/close]', err); res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
});

// ─── Active shift ───────────────────────────────────────────────────────────
router.get('/shifts/active', jwtAuth, requireRole('cashier','manager','admin','auditor','accountant'), async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT s.*, d.name_ar AS dept_name, d.code AS dept_code
               FROM pos_shift_sessions s JOIN pos_departments d ON d.id = s.department_id
              WHERE s.cashier_id = $1 AND s.status = 'open'
              ORDER BY s.opened_at DESC;`,
            [req.user.id]
        );
        if (r.rows.length === 0) {return res.status(404).json({ error: 'NO_OPEN_SHIFT' });}
        res.json(r.rows[0]);
    } catch (e) { logger.error(e); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
});

// ─── All open shifts (central close screen for manager/accountant) ───────────
// المحاسب يغلق كل الكاشيرية من شاشته — لا حاجة للمرور على الأجهزة.
router.get('/shifts/open', jwtAuth, requireRole('manager', 'admin', 'accountant', 'auditor'), async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT s.id, s.department_id, s.cashier_id, s.status, s.opening_balance,
                    s.opened_at, u.username AS cashier_name, d.name_ar AS dept_name,
                    TO_CHAR(s.opened_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') AS biz_date,
                    TO_CHAR(NOW() AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') AS today,
                    (s.opening_balance +
                     COALESCE((SELECT SUM(CASE WHEN ip.method = 'cash' AND ip.direction = 'in' THEN ip.amount ELSE -ip.amount END)
                                FROM pos_invoice_payments ip
                                JOIN pos_orders o ON o.id = ip.order_id
                               WHERE o.session_id = s.id AND ip.method = 'cash'), 0))::numeric(14,2) AS expected_cash,
                    (SELECT COUNT(*)::int FROM pos_orders o WHERE o.session_id = s.id) AS invoice_count
               FROM pos_shift_sessions s
               JOIN pos_departments d ON d.id = s.department_id
               LEFT JOIN users u ON u.id = s.cashier_id
              WHERE s.status = 'open'
              ORDER BY s.opened_at`
        );
        res.json({ ok: true, count: r.rows.length, shifts: r.rows });
    } catch (e) {
        logger.error('[shifts/open-all]', e.message);
        res.status(500).json({ error: 'SHIFTS_FETCH_FAILED', message: 'تعذر جلب الورديات المفتوحة' });
    }
});

// ─── Shift summary ──────────────────────────────────────────────────────────
router.get('/shifts/:id/summary', jwtAuth, requireRole('cashier','manager','admin','auditor','accountant'), async (req, res) => {
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {return res.status(422).json({ error: 'INVALID_SHIFT_SESSION_ID' });}
    try {
        const r = await pool.query(
            `SELECT s.*, d.name_ar AS dept_name,
                COALESCE(SUM(CASE WHEN ip.method='cash'   AND ip.direction='in'  THEN ip.amount END),0) AS cash_in,
                COALESCE(SUM(CASE WHEN ip.method='cash'   AND ip.direction='out' THEN ip.amount END),0) AS cash_out,
                COALESCE(SUM(CASE WHEN ip.method='card'   AND ip.direction='in'  THEN ip.amount END),0) AS card_in,
                COALESCE(SUM(CASE WHEN ip.method='wallet' AND ip.direction='in'  THEN ip.amount END),0) AS wallet_in,
                COUNT(DISTINCT CASE WHEN o.status IN ('issued','reported') THEN o.id END)::int AS invoice_count,
                COALESCE(SUM(CASE WHEN o.status IN ('issued','reported') THEN o.total_amount END),0) AS sales_total,
                COALESCE(SUM(CASE WHEN o.status IN ('issued','reported') THEN o.discount_total END),0) AS discount_total,
                COALESCE(SUM(CASE WHEN o.status IN ('issued','reported') THEN o.tax_total END),0) AS tax_total,
                COUNT(DISTINCT CASE WHEN o.status = 'cancelled' THEN o.id END)::int AS voided_count,
                COALESCE(SUM(CASE WHEN o.status = 'cancelled' THEN o.total_amount END),0) AS voided_amount
               FROM pos_shift_sessions s
               JOIN pos_departments d ON d.id = s.department_id
               LEFT JOIN pos_orders o ON o.session_id = s.id
               LEFT JOIN pos_invoice_payments ip ON ip.order_id = o.id AND o.status IN ('issued','reported')
              WHERE s.id = $1
              GROUP BY s.id, d.name_ar;`,
            [sessionId]
        );
        if (r.rows.length === 0) {return res.status(404).json({ error: 'NOT_FOUND' });}
        res.json(r.rows[0]);
    } catch (e) { logger.error(e); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
});


// ─── POS sales reports (actual DB-driven data) ──────────────────────────────
router.get('/reports/sales', jwtAuth, requireRole('cashier','manager','admin','auditor','accountant'), async (req, res) => {
    try {
        const startDate = parseDateOnly(req.query.start_date, 'start_date');
        const endDate = parseDateOnly(req.query.end_date, 'end_date');
        if (startDate > endDate) {
            return res.status(422).json({ error: 'INVALID_DATE_RANGE', message: 'start_date must be before or equal to end_date' });
        }

        const groupBy = String(req.query.group_by || 'department').trim();
        if (!['department', 'cashier', 'item'].includes(groupBy)) {
            return res.status(422).json({ error: 'INVALID_GROUP_BY', message: 'group_by must be one of: department, cashier, item' });
        }

        const departmentId = parsePositiveInt(req.query.department_id, 'department_id');
        const cashierId = parsePositiveInt(req.query.cashier_id, 'cashier_id');

        const params = [startDate, endDate];
        const filters = [
            `o.created_at::date BETWEEN $1::date AND $2::date`,
            `o.status IN ('issued', 'reported')`,
        ];

        if (departmentId) {
            params.push(departmentId);
            filters.push(`o.department_id = $${params.length}`);
        }
        if (cashierId) {
            params.push(cashierId);
            filters.push(`o.cashier_id = $${params.length}`);
        }
        if (req.user?.role === 'cashier') {
            params.push(req.user.id);
            filters.push(`o.cashier_id = $${params.length}`);
        }

        const filteredOrdersCte = `
            WITH filtered_orders AS (
                SELECT o.id,
                       o.department_id,
                       d.code AS department_code,
                       d.name_ar AS department_name,
                       o.cashier_id,
                       u.name AS cashier_name,
                       u.username AS cashier_username,
                       o.subtotal,
                       o.discount_total,
                       o.tax_total,
                       o.total_amount,
                       o.created_at::date AS business_date
                  FROM pos_orders o
                  JOIN pos_departments d ON d.id = o.department_id
                  JOIN users u ON u.id = o.cashier_id
                 WHERE ${filters.join(' AND ')}
            )
        `;

        const summarySql = `${filteredOrdersCte},
            filtered_items AS (
                SELECT i.order_id, i.product_id, i.quantity, i.line_total, i.discount, i.vat_amount
                  FROM pos_order_items i
                  JOIN filtered_orders fo ON fo.id = i.order_id
            ),
            payment_rollup AS (
                SELECT ip.method,
                       ROUND(COALESCE(SUM(CASE WHEN ip.direction = 'in' THEN ip.amount ELSE -ip.amount END), 0)::numeric, 2) AS amount
                  FROM pos_invoice_payments ip
                  JOIN filtered_orders fo ON fo.id = ip.order_id
              GROUP BY ip.method
            )
            SELECT COUNT(*)::int AS invoice_count,
                   ROUND(COALESCE(SUM(total_amount), 0)::numeric, 2) AS net_sales,
                   ROUND(COALESCE(SUM(subtotal), 0)::numeric, 2) AS subtotal_sales,
                   ROUND(COALESCE(SUM(discount_total), 0)::numeric, 2) AS discount_total,
                   ROUND(COALESCE(SUM(tax_total), 0)::numeric, 2) AS tax_total,
                   ROUND(COALESCE((SELECT SUM(quantity) FROM filtered_items), 0)::numeric, 3) AS items_qty,
                   COALESCE((SELECT COUNT(DISTINCT product_id) FROM filtered_items), 0)::int AS unique_items,
                   ROUND(COALESCE(AVG(total_amount), 0)::numeric, 2) AS avg_ticket,
                   COALESCE((SELECT jsonb_object_agg(method, amount) FROM payment_rollup), '{}'::jsonb) AS payment_methods
              FROM filtered_orders;`;

        let rowsSql = '';
        if (groupBy === 'department') {
            rowsSql = `${filteredOrdersCte},
                orders_by_department AS (
                    SELECT department_id,
                           department_code,
                           department_name,
                           COUNT(*)::int AS invoice_count,
                           ROUND(COALESCE(SUM(subtotal), 0)::numeric, 2) AS subtotal_sales,
                           ROUND(COALESCE(SUM(discount_total), 0)::numeric, 2) AS discount_total,
                           ROUND(COALESCE(SUM(tax_total), 0)::numeric, 2) AS tax_total,
                           ROUND(COALESCE(SUM(total_amount), 0)::numeric, 2) AS net_sales,
                           ROUND(COALESCE(AVG(total_amount), 0)::numeric, 2) AS avg_ticket
                      FROM filtered_orders
                  GROUP BY department_id, department_code, department_name
                ),
                items_by_department AS (
                    SELECT fo.department_id,
                           ROUND(COALESCE(SUM(i.quantity), 0)::numeric, 3) AS items_qty,
                           COUNT(DISTINCT i.product_id)::int AS unique_items
                      FROM filtered_orders fo
                 LEFT JOIN pos_order_items i ON i.order_id = fo.id
                  GROUP BY fo.department_id
                )
                SELECT od.department_id,
                       od.department_code,
                       od.department_name,
                       od.invoice_count,
                       od.subtotal_sales,
                       od.discount_total,
                       od.tax_total,
                       od.net_sales,
                       od.avg_ticket,
                       COALESCE(ibd.items_qty, 0) AS items_qty,
                       COALESCE(ibd.unique_items, 0) AS unique_items
                  FROM orders_by_department od
             LEFT JOIN items_by_department ibd ON ibd.department_id = od.department_id
              ORDER BY od.net_sales DESC, od.invoice_count DESC, od.department_name ASC;`;
        } else if (groupBy === 'cashier') {
            rowsSql = `${filteredOrdersCte},
                orders_by_cashier AS (
                    SELECT cashier_id,
                           cashier_name,
                           cashier_username,
                           COUNT(*)::int AS invoice_count,
                           ROUND(COALESCE(SUM(subtotal), 0)::numeric, 2) AS subtotal_sales,
                           ROUND(COALESCE(SUM(discount_total), 0)::numeric, 2) AS discount_total,
                           ROUND(COALESCE(SUM(tax_total), 0)::numeric, 2) AS tax_total,
                           ROUND(COALESCE(SUM(total_amount), 0)::numeric, 2) AS net_sales,
                           ROUND(COALESCE(AVG(total_amount), 0)::numeric, 2) AS avg_ticket
                      FROM filtered_orders
                  GROUP BY cashier_id, cashier_name, cashier_username
                ),
                items_by_cashier AS (
                    SELECT fo.cashier_id,
                           ROUND(COALESCE(SUM(i.quantity), 0)::numeric, 3) AS items_qty,
                           COUNT(DISTINCT i.product_id)::int AS unique_items
                      FROM filtered_orders fo
                 LEFT JOIN pos_order_items i ON i.order_id = fo.id
                  GROUP BY fo.cashier_id
                )
                SELECT oc.cashier_id,
                       oc.cashier_name,
                       oc.cashier_username,
                       oc.invoice_count,
                       oc.subtotal_sales,
                       oc.discount_total,
                       oc.tax_total,
                       oc.net_sales,
                       oc.avg_ticket,
                       COALESCE(ibc.items_qty, 0) AS items_qty,
                       COALESCE(ibc.unique_items, 0) AS unique_items
                  FROM orders_by_cashier oc
             LEFT JOIN items_by_cashier ibc ON ibc.cashier_id = oc.cashier_id
              ORDER BY oc.net_sales DESC, oc.invoice_count DESC, oc.cashier_name ASC;`;
        } else {
            rowsSql = `${filteredOrdersCte},
                item_rows AS (
                    SELECT i.product_id,
                           i.product_name,
                           i.product_barcode,
                           fo.department_name,
                           fo.id AS order_id,
                           i.quantity,
                           i.line_total,
                           i.discount,
                           i.vat_amount
                      FROM pos_order_items i
                      JOIN filtered_orders fo ON fo.id = i.order_id
                )
                SELECT product_id,
                       product_name,
                       product_barcode,
                       MAX(department_name) AS department_name,
                       COUNT(DISTINCT order_id)::int AS invoice_count,
                       ROUND(COALESCE(SUM(quantity), 0)::numeric, 3) AS quantity_sold,
                       ROUND(COALESCE(SUM(line_total), 0)::numeric, 2) AS subtotal_sales,
                       ROUND(COALESCE(SUM(discount), 0)::numeric, 2) AS discount_total,
                       ROUND(COALESCE(SUM(vat_amount), 0)::numeric, 2) AS tax_total,
                       ROUND(COALESCE(SUM(line_total + vat_amount), 0)::numeric, 2) AS net_sales
                  FROM item_rows
              GROUP BY product_id, product_name, product_barcode
              ORDER BY net_sales DESC, quantity_sold DESC, product_name ASC
                 LIMIT 200;`;
        }

        const [summaryRes, rowsRes] = await Promise.all([
            pool.query(summarySql, params),
            pool.query(rowsSql, params),
        ]);

        const summary = coerceNumericRecord(summaryRes.rows[0] || {});
        const rows = rowsRes.rows.map(coerceNumericRecord);

        res.json({
            start_date: startDate,
            end_date: endDate,
            group_by: groupBy,
            filters: {
                department_id: departmentId,
                cashier_id: req.user?.role === 'cashier' ? req.user.id : cashierId,
            },
            summary,
            rows,
        });
    } catch (e) {
        if (e.statusCode === 422) {
            return res.status(422).json({ error: 'VALIDATION_ERROR', message: e.message });
        }
        logger.error('[pos/reports/sales]', e);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to build POS sales report' });
    }
});

// ─── Dashboard ──────────────────────────────────────────────────────────────
router.get('/dashboard', jwtAuth, requireRole('cashier','manager','admin','auditor','accountant'), async (req, res) => {
    const now = Date.now();
    const staleSnapshot = dashboardCache.value && dashboardCache.expiresAt > 0 ? dashboardCache.value : null;

    if (dashboardCache.value && dashboardCache.expiresAt > now) {
        return res.json(dashboardCache.value);
    }

    if (staleSnapshot && dashboardCache.pending === null && now - dashboardCache.expiresAt < DASHBOARD_STALE_TTL_MS) {
        const staleValue = staleSnapshot;
        const refresh = pool.query(`SELECT * FROM v_pos_cashier_dashboard;`)
            .then((r) => {
                dashboardCache = { expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS, value: r.rows, pending: null };
                return r.rows;
            })
            .catch((err) => {
                logger.error('[pos/dashboard] refresh failed, keeping stale cache', err);
                dashboardCache = { expiresAt: now + DASHBOARD_CACHE_TTL_MS, value: staleValue, pending: null };
                throw err;
            });
        dashboardCache.pending = refresh;
        return res.json(staleValue);
    }

    try {
        if (dashboardCache.pending) {
            const rows = await dashboardCache.pending;
            return res.json(rows);
        }

        const pending = pool.query(`SELECT * FROM v_pos_cashier_dashboard;`).then((r) => r.rows);
        dashboardCache.pending = pending;
        const rows = await pending;
        dashboardCache = { expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS, value: rows, pending: null };
        res.json(rows);
    } catch (e) {
        logger.error(e);
        if (dashboardCache.value) {
            return res.json(dashboardCache.value);
        }
        res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
});

module.exports = router;
module.exports.createSingleFlightCache = createSingleFlightCache;
