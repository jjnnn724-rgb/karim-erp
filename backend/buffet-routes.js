'use strict';

/**
 * buffet-routes.js — «كوست أصناف بوفيه الشرفة العالمي»
 * ────────────────────────────────────────────────────────────────────────────
 *   GET  /api/buffet/overview            الحمولة الكاملة (الأصناف + المكوّنات + التكلفة المحسوبة حيًّا من المخزن + خطة الأسبوع)
 *   GET  /api/buffet/search?q=           بحث أصناف المخزن بالاسم/الباركود مع السعر وتقدير سعر الكيلو من التعبئة
 *   PUT  /api/buffet/ingredients/:id/link        ربط مكوّن واحد بصنف المخزن { inventoryId }
 *   PUT  /api/buffet/ingredients/link-group      ربط كل الأسطر بنفس الاسم الخام { name, inventoryId }
 *   DELETE /api/buffet/ingredients/:id/link      فكّ الربط
 *
 * مبادئ:
 *  • التكلفة تُحسب **حيًّا من inventory.avgCost وقت الطلب** — لا تُخزَّن أي نتيجة،
 *    فأي تحديث سعر في المخزن ينعكس تلقائيًا (ومن بينها أصناف المطبخ الطازجة
 *    فور اعتمادها في المخزن من 2026-11-17).
 *  • أي مكوّن بلا ربط أو بلا تحويل وحدة → «بدون تسعير» مع عدّاد صريح في التقرير.
 *    لا نص رقم واحد مُقدَّر دون مصدر.
 *  • «ملعقة كبيرة/صغيرة» تُحسب عبر العائلة الحجمية (لتر/مل) فقط؛ الوزن بلا كثافة
 *    → غير محتسب، لا تخمين.
 *  • الكيلو داخل عبوة معلومة وزنها («… 50 كيلو-كيس») يُستخرج آليًا ويُعرض للسعر
 *    «تقديري» موسوم packUsed في المخرجات.
 */

const express = require('express');
const { pool } = require('./shared-pool');
const { logger } = require('./logger');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { computeDishCost, summarizeDishes, parsePackKg } = require('./buffet-logic');
const { userHasPerm } = require('./permissions');
const localLlm = require('./ai-assistant/local-llm');
const { computeNutrition } = require('./buffet-nutrition');
const { proposeLinks, groupProposals } = require('./buffet-match');
const { z } = require('zod');

const router = express.Router();

const READ_ROLES = ['admin', 'owner', 'manager'];
const WRITE_ROLES = ['admin', 'owner', 'manager'];

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const denial = (res, message) => res.status(403).json({ ok: false, error: 'FORBIDDEN', message });

async function readGate(req, res, next) {
    const role = String(req.user?.role || '');
    if (READ_ROLES.includes(role)) {return next();}
    // منح مباشر buffet.view يفتح القراءة (قرار المالك 2026-11-16 — نفس نمط veg)
    if (req.user?.id != null && (await userHasPerm({ id: Number(req.user.id), role }, 'buffet.view', []))) {return next();}
    return denial(res, 'عرض كوست البوفيه متاح للإدارة ومن مُنح صلاحية buffet.view');
}

async function writeGate(req, res, next) {
    const role = String(req.user?.role || '');
    if (WRITE_ROLES.includes(role)) {return next();}
    if (req.user?.id != null && (await userHasPerm({ id: Number(req.user.id), role }, 'buffet.link', []))) {return next();}
    return denial(res, 'ربط مكوّنات البوفيه بالمخزن متاح للمدير ومن مُنح صلاحية buffet.link');
}

const safeLike = (q) => `%${String(q || '').trim().replace(/[\\%_]/g, (c) => '\\' + c)}%`;

async function fetchInventoryForIds(ids) {
    if (!ids.length) {return new Map();}
    const q = await pool.query(
        'SELECT id, name, unit, "avgCost" FROM inventory WHERE id = ANY($1::bigint[])',
        [ids.map((v) => String(v))],
    );
    return new Map(q.rows.map((r) => [String(r.id), {
        id: r.id,
        name: r.name,
        unit: r.unit,
        avgCost: r.avgCost == null ? null : Number(r.avgCost),
    }]));
}

/** تقدير سعر الكيلو من عبوة اختاروها — للعرض في البحث فقط (المعتمد فعليًا يُحسب في الخادم لحظيًا). */
function packPreview(item) {
    const isKg = ['kg', 'كيلو', 'كيلو جرام', 'كيلوجرام'].includes(String(item.unit || '').toLowerCase());
    if (isKg) {return Number(item.avgCost) || null;}
    const pack = parsePackKg(item.name);
    const cost = Number(item.avgCost);
    if (pack && Number.isFinite(cost) && cost > 0) {return round2(cost / pack);}
    return null;
}

// ─── GET /overview ─────────────────────────────────────────────────
router.get('/overview', jwtAuth, readGate, async (req, res, next) => {
    try {
        const [dishRows, ingredientRows, weekRows] = await Promise.all([
            pool.query('SELECT id, name, category, freq, yields, notes, description FROM buffet_dishes ORDER BY category, id'),
            pool.query('SELECT id, dish_id, position, name, qty, unit, inventory_id, pack_kg FROM buffet_ingredients ORDER BY dish_id, position'),
            pool.query(`SELECT w.day, w.meal, w.position, w.dish_id, d.name AS dish_name
                          FROM buffet_week w JOIN buffet_dishes d ON d.id = w.dish_id
                         ORDER BY array_position(ARRAY['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'], w.day),
                                  CASE w.meal WHEN 'غداء' THEN 1 WHEN 'عشاء' THEN 2 ELSE 3 END, w.position`),
        ]);

        const linkedIds = [...new Set(ingredientRows.rows.map((r) => r.inventory_id).filter((v) => v != null).map(String))];
        const inventoryById = await fetchInventoryForIds(linkedIds);

        const ingredientsByDish = new Map();
        for (const row of ingredientRows.rows) {
            if (!ingredientsByDish.has(row.dish_id)) {ingredientsByDish.set(row.dish_id, []);}
            ingredientsByDish.get(row.dish_id).push({
                id: row.id,
                position: row.position,
                name: row.name,
                qty: row.qty == null ? 0 : Number(row.qty),
                unit: row.unit,
                inventoryId: row.inventory_id,
                packKg: row.pack_kg == null ? null : Number(row.pack_kg),
            });
        }

        const dishes = dishRows.rows.map((d) => {
            const ingredients = ingredientsByDish.get(d.id) ?? [];
            const cost = computeDishCost({ yields: d.yields, ingredients }, inventoryById);
            const nutrition = computeNutrition(ingredients);
            return {
                id: d.id,
                name: d.name,
                category: d.category,
                freq: d.freq,
                yields: d.yields,
                notes: d.notes,
                description: d.description ?? '',
                nutrition,
                ...cost,
            };
        });

        const summary = summarizeDishes(dishes);
        const costById = new Map(dishes.map((d) => [String(d.id), d]));
        const week = weekRows.rows.map((w) => ({
            day: w.day,
            meal: w.meal,
            position: w.position,
            dishId: w.dish_id,
            name: w.dish_name,
            batchCost: costById.get(String(w.dish_id))?.batchCost ?? 0,
            priced: costById.get(String(w.dish_id))?.unpricedLines === 0,
        }));

        const unpriced = dishes.flatMap((d) =>
            d.lines
                .filter((l) => l.state !== 'ok')
                .map((l) => ({ dish: d.name, name: l.name, qty: l.qty, unit: l.unit, state: l.state })),
        );

        res.json({
            ok: true,
            generatedAt: new Date().toISOString(),
            totals: summary,
            dishes,
            week,
            unpriced,
        });
    } catch (error) {
        logger.error({ err: { message: error?.message || String(error), stack: error?.stack || null } }, '[buffet/overview]');
        next(error);
    }
});

// ─── GET /search?q= ────────────────────────────────────────────────
router.get('/search', jwtAuth, readGate, async (req, res, next) => {
    try {
        const q = String(req.query?.q || '').trim();
        if (q.length < 2) {return res.json({ ok: true, items: [] });}
        const kw = safeLike(q);
        const r = await pool.query(
            `SELECT id, name, unit, category,
                    round(COALESCE(qty, 0)::numeric, 3) AS qty,
                    round(COALESCE("avgCost", 0)::numeric, 2) AS "avgCost"
               FROM inventory
              WHERE name ILIKE $1 ESCAPE '\\' OR external_code ILIKE $1 ESCAPE '\\' OR barcode ILIKE $1 ESCAPE '\\'
              ORDER BY (qty > 0) DESC, name ASC
              LIMIT 20`,
            [kw],
        );
        const items = r.rows.map((row) => {
            const item = { id: row.id, name: row.name, unit: row.unit, category: row.category, qty: Number(row.qty), avgCost: row.avgCost == null ? null : Number(row.avgCost) };
            return { ...item, perKg: packPreview(item) };
        });
        return res.json({ ok: true, items });
    } catch (error) {
        logger.error({ err: { message: error?.message || String(error), stack: error?.stack || null } }, '[buffet/search]');
        next(error);
    }
});

// ─── PUT /ingredients/:id/link ──────────────────────────────────────
router.put('/ingredients/:id/link', jwtAuth, writeGate, async (req, res, next) => {
    try {
        const lineId = Number(req.params.id);
        if (!Number.isInteger(lineId) || lineId <= 0) {
            return res.status(422).json({ ok: false, error: 'BAD_ID', message: 'معرّف السطر غير صالح' });
        }
        const inventoryId = req.body?.inventoryId == null || req.body?.inventoryId === '' ? null : Number(req.body.inventoryId);
        if (inventoryId != null && (!Number.isInteger(inventoryId) || inventoryId <= 0)) {
            return res.status(422).json({ ok: false, error: 'BAD_INVENTORY', message: 'معرّف صنف المخزن غير صالح' });
        }
        if (inventoryId != null) {
            const exists = await pool.query('SELECT id, name, unit FROM inventory WHERE id = $1 LIMIT 1', [String(inventoryId)]);
            if (!exists.rows[0]) {
                return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'صنف المخزن غير موجود' });
            }
        }
        const updated = await pool.query(
            `UPDATE buffet_ingredients
                SET inventory_id = $2,
                    pack_kg = CASE
                        WHEN $2 IS NULL THEN NULL
                        ELSE pack_kg_for($2, unit)
                    END,
                    updated_at = now()
              WHERE id = $1
              RETURNING id, inventory_id, pack_kg`,
            [lineId, inventoryId == null ? null : String(inventoryId)],
        );
        if (!updated.rows[0]) {
            return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'سطر المكوّن غير موجود' });
        }
        res.json({ ok: true, line: updated.rows[0] });
    } catch (error) {
        logger.error({ err: { message: error?.message || String(error), stack: error?.stack || null } }, '[buffet/link]');
        next(error);
    }
});

// pack_kg_for(inv BIGINT, line_unit TEXT) من migration 153 — لا DDL وقت التشغيل

// ─── PUT /ingredients/link-group ────────────────────────────────────
router.put('/ingredients/link-group', jwtAuth, writeGate, async (req, res, next) => {
    try {
        const name = String(req.body?.name || '').trim();
        const inventoryId = req.body?.inventoryId == null ? null : Number(req.body.inventoryId);
        if (!name) {
            return res.status(422).json({ ok: false, error: 'BAD_NAME', message: 'اكتب اسم المكوّن' });
        }
        if (inventoryId != null && (!Number.isInteger(inventoryId) || inventoryId <= 0)) {
            return res.status(422).json({ ok: false, error: 'BAD_INVENTORY', message: 'معرّف صنف المخزن غير صالح' });
        }
        if (inventoryId != null) {
            const exists = await pool.query('SELECT id FROM inventory WHERE id = $1 LIMIT 1', [String(inventoryId)]);
            if (!exists.rows[0]) {
                return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'صنف المخزن غير موجود' });
            }
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const r = await client.query(
                `UPDATE buffet_ingredients
                    SET inventory_id = $2,
                        pack_kg = CASE
                            WHEN $2 IS NULL THEN NULL
                            ELSE pack_kg_for($2, unit)
                        END,
                        updated_at = now()
                  WHERE btrim(name) = btrim($1)
                  RETURNING id`,
                [name, inventoryId == null ? null : String(inventoryId)],
            );
            await client.query('COMMIT');
            res.json({ ok: true, updated: r.rowCount });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error({ err: { message: error?.message || String(error), stack: error?.stack || null } }, '[buffet/link-group]');
        next(error);
    }
});

// ─── DELETE /ingredients/:id/link ───────────────────────────────────
router.delete('/ingredients/:id/link', jwtAuth, writeGate, async (req, res, next) => {
    try {
        const lineId = Number(req.params.id);
        if (!Number.isInteger(lineId) || lineId <= 0) {
            return res.status(422).json({ ok: false, error: 'BAD_ID', message: 'معرّف السطر غير صالح' });
        }
        const r = await pool.query(
            'UPDATE buffet_ingredients SET inventory_id = NULL, pack_kg = NULL, updated_at = now() WHERE id = $1 RETURNING id',
            [lineId],
        );
        if (!r.rows[0]) {return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'سطر المكوّن غير موجود' });}
        res.json({ ok: true });
    } catch (error) {
        logger.error({ err: { message: error?.message || String(error), stack: error?.stack || null } }, '[buffet/unlink]');
        next(error);
    }
});

// ═══ إدارة الأصناف (مسودة بإشراف الشيف/المدير) ══════════════════════
const DISH_WRITE_ROLES = ['admin', 'owner', 'manager', 'kitchen', 'sous_chef'];
const DISH_DELETE_ROLES = ['admin', 'owner', 'manager'];

const dishWriteGate = (req, res, next) => {
    if (DISH_WRITE_ROLES.includes(String(req.user?.role || ''))) {return next();}
    return denial(res, 'إضافة/تعديل أصناف البوفيه متاح للمطبخ والإدارة');
};
const dishDeleteGate = (req, res, next) => {
    if (DISH_DELETE_ROLES.includes(String(req.user?.role || ''))) {return next();}
    return denial(res, 'حذف الأصناف متاح للإدارة فقط');
};

const UNITS_OK = new Set(['كيلو', 'جرام', 'لتر', 'مل', 'عدد / حبة', 'علبة', 'كيس', 'زجاجة', 'كوب', 'ملعقة كبيرة', 'ملعقة صغيرة', 'رشة', 'عبوة', 'باكت', 'شدة', 'كرتون', 'جالون', 'تنك', 'قطعة']);
const cleanText = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const parseQty = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
};

const ingredientSchema = z.object({
    name: z.string().trim().min(1).max(300),
    qty: z.coerce.number().min(0),
    unit: z.string().trim().min(1).max(60),
}).passthrough();

const dishPayloadSchema = z.object({
    name: z.string().trim().min(1, 'اكتب اسم الصنف').max(300),
    category: z.string().trim().min(1, 'اختر الفئة').max(120),
    freq: z.coerce.number().int().min(0).max(99).default(1),
    yields: z.string().trim().max(200).default(''),
    notes: z.string().trim().max(4000).default(''),
    description: z.string().trim().max(600).default(''),
    ingredients: z.array(ingredientSchema).max(200).default([]),
});

async function saveDishWithIngredients(client, payload, dishId) {
    await client.query(
        `UPDATE buffet_dishes
            SET name = $2, category = $3, freq = $4, yields = $5, notes = $6, description = $7, updated_at = now()
          WHERE id = $1`,
        [dishId, payload.name, payload.category, payload.freq, payload.yields, payload.notes, payload.description],
    );
    await client.query('DELETE FROM buffet_ingredients WHERE dish_id = $1', [dishId]);
    let pos = 0;
    for (const ing of payload.ingredients) {
        pos += 1;
        await client.query(
            'INSERT INTO buffet_ingredients (dish_id, position, name, qty, unit) VALUES ($1, $2, $3, $4, $5)',
            [dishId, pos, ing.name, ing.qty, ing.unit],
        );
    }
    return dishId;
}

// ─── POST /api/buffet/dishes ─ إنشاء صنف ──────────────────────────
router.post('/dishes', jwtAuth, dishWriteGate, async (req, res, next) => {
    try {
        const parsed = dishPayloadSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            return res.status(422).json({ ok: false, error: 'BAD_PAYLOAD', message: parsed.error.issues?.[0]?.message || 'بيانات الصنف غير مكتملة' });
        }
        const payload = parsed.data;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const dup = await client.query('SELECT id FROM buffet_dishes WHERE btrim(name) = btrim($1) LIMIT 1', [payload.name]);
            if (dup.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(409).json({ ok: false, error: 'DUPLICATE', message: 'الصنف موجود مسبقًا في البوفيه' });
            }
            const d = await client.query(
                `INSERT INTO buffet_dishes (name, category, freq, yields, notes, description)
                 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
                [payload.name, payload.category, payload.freq, payload.yields, payload.notes, payload.description],
            );
            let pos = 0;
            for (const ing of payload.ingredients) {
                pos += 1;
                await client.query(
                    'INSERT INTO buffet_ingredients (dish_id, position, name, qty, unit) VALUES ($1, $2, $3, $4, $5)',
                    [d.rows[0].id, pos, ing.name, ing.qty, ing.unit],
                );
            }
            await client.query('COMMIT');
            res.status(201).json({ ok: true, id: d.rows[0].id });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error({ err: { message: error?.message || String(error), stack: error?.stack || null } }, '[buffet/dish-create]');
        next(error);
    }
});

// ─── PUT /api/buffet/dishes/:id ─ تعديل صنف ────────────────────────
router.put('/dishes/:id', jwtAuth, dishWriteGate, async (req, res, next) => {
    try {
        const dishId = Number(req.params.id);
        if (!Number.isInteger(dishId) || dishId <= 0) {
            return res.status(422).json({ ok: false, error: 'BAD_ID', message: 'معرّف الصنف غير صالح' });
        }
        const parsed = dishPayloadSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            return res.status(422).json({ ok: false, error: 'BAD_PAYLOAD', message: parsed.error.issues?.[0]?.message || 'بيانات الصنف غير مكتملة' });
        }
        const payload = parsed.data;
        const dup = await pool.query('SELECT id FROM buffet_dishes WHERE btrim(name) = btrim($1) AND id <> $2 LIMIT 1', [payload.name, dishId]);
        if (dup.rows[0]) {
            return res.status(409).json({ ok: false, error: 'DUPLICATE', message: 'اسم الصنف مكرر — اختر اسمًا آخر' });
        }
        const exists = await pool.query('SELECT id FROM buffet_dishes WHERE id = $1 LIMIT 1', [dishId]);
        if (!exists.rows[0]) {
            return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'الصنف غير موجود' });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await saveDishWithIngredients(client, payload, dishId);
            await client.query('COMMIT');
            res.json({ ok: true });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error({ err: { message: error?.message || String(error), stack: error?.stack || null } }, '[buffet/dish-update]');
        next(error);
    }
});

// ─── DELETE /api/buffet/dishes/:id ─ حذف صنف ───────────────────────
router.delete('/dishes/:id', jwtAuth, dishDeleteGate, async (req, res, next) => {
    try {
        const dishId = Number(req.params.id);
        if (!Number.isInteger(dishId) || dishId <= 0) {
            return res.status(422).json({ ok: false, error: 'BAD_ID', message: 'معرّف الصنف غير صالح' });
        }
        const r = await pool.query('DELETE FROM buffet_dishes WHERE id = $1 RETURNING id', [dishId]);
        if (!r.rows[0]) {return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'الصنف غير موجود' });}
        res.json({ ok: true });
    } catch (error) {
        logger.error({ err: { message: error?.message || String(error), stack: error?.stack || null } }, '[buffet/dish-delete]');
        next(error);
    }
});

// ─── جداول خطة الأسبوع: استبدال/إضافة/حذف ─────────────────────────
const WEEK_ROLES = ['admin', 'owner', 'manager', 'kitchen', 'sous_chef'];
const weekGate = (req, res, next) => {
    if (WEEK_ROLES.includes(String(req.user?.role || ''))) {return next();}
    return denial(res, 'تعديل خطة الأسبوع متاح للمطبخ والإدارة');
};
const VALID_DAYS = new Set(['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة']);
const VALID_MEALS = new Set(['غداء', 'عشاء']);

// PUT /api/buffet/week — استبدال خانة كاملة {day, meal, dishes: [id,...]}
router.put('/week', jwtAuth, weekGate, async (req, res, next) => {
    try {
        const { day, meal, dishes } = req.body ?? {};
        if (!VALID_DAYS.has(String(day)) || !VALID_MEALS.has(String(meal))) {
            return res.status(422).json({ ok: false, error: 'BAD_SLOT', message: 'اليوم أو الوجبة غير معتمدة' });
        }
        if (!Array.isArray(dishes)) {
            return res.status(422).json({ ok: false, error: 'BAD_PAYLOAD', message: 'dishes يجب أن تكون مصفوفة معرّفات' });
        }
        const ids = dishes.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0);
        const found = await pool.query('SELECT id FROM buffet_dishes WHERE id = ANY($1::bigint[])', [ids.map(String)]);
        if (found.rows.length !== ids.length) {
            return res.status(422).json({ ok: false, error: 'BAD_DISH', message: 'يوجد معرّف صنف غير موجود' });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM buffet_week WHERE day = $1 AND meal = $2', [day, meal]);
            let position = 0;
            for (const dishId of ids) {
                position += 1;
                await client.query(
                    'INSERT INTO buffet_week (day, meal, position, dish_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
                    [day, meal, position, dishId],
                );
            }
            await client.query('COMMIT');
            res.json({ ok: true, count: ids.length });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error({ err: { message: error?.message || String(error), stack: error?.stack || null } }, '[buffet/week-put]');
        next(error);
    }
});

// POST /api/buffet/week/slot — إضافة صنف إلى خانة {day, meal, dishId}
router.post('/week/slot', jwtAuth, weekGate, async (req, res, next) => {
    try {
        const { day, meal, dishId } = req.body ?? {};
        if (!VALID_DAYS.has(String(day)) || !VALID_MEALS.has(String(meal))) {
            return res.status(422).json({ ok: false, error: 'BAD_SLOT', message: 'اليوم أو الوجبة غير معتمدة' });
        }
        const id = Number(dishId);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(422).json({ ok: false, error: 'BAD_DISH', message: 'معرّف الصنف غير صالح' });
        }
        const exists = await pool.query('SELECT id, name FROM buffet_dishes WHERE id = $1 LIMIT 1', [id]);
        if (!exists.rows[0]) {
            return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'الصنف غير موجود' });
        }
        const r = await pool.query(
            `INSERT INTO buffet_week (day, meal, position, dish_id)
             VALUES ($1, $2, (SELECT COALESCE(MAX(position), 0) + 1 FROM buffet_week WHERE day = $1 AND meal = $2), $3)
             RETURNING position`,
            [day, meal, id],
        );
        res.status(201).json({ ok: true, position: r.rows[0].position });
    } catch (error) {
        logger.error({ err: { message: error?.message || String(error), stack: error?.stack || null } }, '[buffet/week-add]');
        next(error);
    }
});

// DELETE /api/buffet/week/slot — حذف صنف من خانة (أقدم موضع أولًا) {day, meal, dishId}
router.delete('/week/slot', jwtAuth, weekGate, async (req, res, next) => {
    try {
        const { day, meal, dishId } = req.body ?? {};
        if (!VALID_DAYS.has(String(day)) || !VALID_MEALS.has(String(meal))) {
            return res.status(422).json({ ok: false, error: 'BAD_SLOT', message: 'اليوم أو الوجبة غير معتمدة' });
        }
        const id = Number(dishId);
        if (!Number.isInteger(id)) {
            return res.status(422).json({ ok: false, error: 'BAD_DISH', message: 'معرّف الصنف غير صالح' });
        }
        const r = await pool.query(
            `DELETE FROM buffet_week
              WHERE ctid = (SELECT ctid FROM buffet_week WHERE day = $1 AND meal = $2 AND dish_id = $3 ORDER BY position LIMIT 1)
              RETURNING position`,
            [day, meal, id],
        );
        if (!r.rows[0]) {
            return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'الصنف غير مجدول في هذه الوجبة' });
        }
        // إغلاق الفجوات في الترتيب
        await pool.query(
            `UPDATE buffet_week w SET position = sub.rn
               FROM (SELECT day, meal, position, dish_id, row_number() OVER (PARTITION BY day, meal ORDER BY position) AS rn
                       FROM buffet_week WHERE day = $1 AND meal = $2) AS sub
              WHERE w.day = sub.day AND w.meal = sub.meal AND w.position = sub.position AND w.dish_id = sub.dish_id`,
            [day, meal],
        );
        res.json({ ok: true });
    } catch (error) {
        logger.error({ err: { message: error?.message || String(error), stack: error?.stack || null } }, '[buffet/week-del]');
        next(error);
    }
});

// ─── POST /api/buffet/dishes/autofill — المسودة من المساعد الشخصي ───
// تُرجع مسودة كاملة (وصف + مكونات + قيم غذائية + مسببات) — **لا تُحفظ**
// إلا بموافقة صريحة من المستخدم عبر POST /dishes.
router.post('/dishes/autofill', jwtAuth, dishWriteGate, async (req, res, next) => {
    try {
        const name = cleanText(req.body?.name, 300);
        const category = cleanText(req.body?.category, 120);
        const yields = cleanText(req.body?.yields, 200) || 'سفنديش 5 سم — تكفي 35–40 شخص';
        if (!name) {
            return res.status(422).json({ ok: false, error: 'NAME_REQUIRED', message: 'اكتب اسم الصنف أولًا' });
        }

        const available = await localLlm.available().catch(() => false);
        if (!available) {
            return res.status(503).json({
                ok: false,
                error: 'AI_UNAVAILABLE',
                message: 'المساعد الشخصي غير متاح حاليًا (المحرك المحلي متوقف) — أكمل الصنف يدويًا، أو أعد المحاولة لاحقًا',
            });
        }

        const system = [
            'أنت الشيف التنفيذي لمطاعم الشرفة العالمي. أجب بـ JSON صالح فقط بلا أي نص إضافي، بالمخطط التالي بالضبط:',
            '{"description":"وصف عربي فصيح من ٢ إلى ٣ أسطر للصنف","ingredients":[{"name":"اسم المكون العربي","qty":كمية_رقم,"unit":"واحدة_معتمدة"}]}',
            'كل النصوص بالعربية الفصحى حصرًا — لا تكتب حرفًا لاتينيًا ولا فرنسيًا ولا إنجليزيًا داخل description أو أسماء المكونات.',
            'الوحدات المعتمدة فقط: كيلو، جرام، لتر، مل، عدد / حبة، علبة، كيس، زجاجة، كوب، ملعقة كبيرة، ملعقة صغيرة، رشة.',
            'المكونات لوعاء سفنديش 5 سم (تكفي 35–40 شخص). القيم تقليدية للمطبخ العربي الخليجي بكميات لكل دفعة كاملة:',
            'مكوّن أساسي (عدس/أرز/مكرونة/لحم/دجاج): 2–6 كيلو · مرق/سوائل: 4–5 لتر · خضار: 1–3 كيلو · زبدة/سمن: 150–250 جرام · زيت: 0.5–1 لتر',
            'توابل أساسية: 1–3 ملعقة كبيرة · ملح: 1–2.5 ملعقة كبيرة · ورق غار: 2–4 عدد · بقدونس/كزبرة للتزيين: 100–200 جرام · ثوم: 50–100 جرام.',
            'كل كمية يجب أن تأتي بوحدة منطقية: كيلو/جرام للجوامد، لتر/مل للسوائل، ملعقة/كوب للتوابل — لا تستخدم «عدد / حبة» إلا لورق الغار والورقيات والليمون فقط.',
            'افهم الصنف أولًا ثم اقترح مكوناته الحقيقية — لا تنسخ الأمثلة حرفيًا.',
            'لا تكتب كميات فلكية — الدفعة تُستهلك في وجبة واحدة لصالة واحدة.',
            'لا تكتب أي نص خارج JSON — لا مقدمة ولا تعليق.',
        ].join('\n');

        let chatResult;
        try {
            chatResult = await localLlm.chat({
                system,
                messages: [{
                    role: 'user',
                    content: `الصنف: «${name}»${category ? ` (الفئة: ${category})` : ''}. اكتب المسودة الكاملة.`,
                }],
                temperature: 0.3,
                maxTokens: 900,
                numCtx: 3072,
            });
        } catch (e) {
            logger.error({ err: { message: e?.message || String(e), stack: e?.stack || null } }, '[buffet/autofill-llm]');
            return res.status(503).json({
                ok: false,
                error: 'AI_FAILED',
                message: 'تعذر على المساعد الشخصي توليد المسودة الآن — أكمل يدويًا أو أعد المحاولة',
            });
        }

        const raw = String(chatResult?.text || '');
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start < 0 || end <= start) {
            return res.status(422).json({ ok: false, error: 'AI_UNPARSEABLE', message: 'لم تتحقق المسودة (شكل غير متوقع) — أعد المحاولة أو أكمل يدويًا' });
        }

        let draft;
        try {
            draft = JSON.parse(raw.slice(start, end + 1));
        } catch (_e) {
            return res.status(422).json({ ok: false, error: 'AI_UNPARSEABLE', message: 'لم تتحقق المسودة (JSON غير مكتمل) — أعد المحاولة أو أكمل يدويًا' });
        }

        const ingredients = (Array.isArray(draft.ingredients) ? draft.ingredients : [])
            .map((ing) => ({
                name: cleanText(ing?.name, 300),
                qty: parseQty(ing?.qty),
                unit: UNITS_OK.has(String(ing?.unit || '').trim()) ? String(ing.unit).trim() : 'عدد / حبة',
            }))
            .filter((ing) => ing.name && ing.qty > 0)
            .slice(0, 60);
        const description = cleanText(draft.description, 600);
        const nutrition = computeNutrition(ingredients);

        res.json({
            ok: true,
            draft: {
                name,
                category: category || null,
                yields,
                description,
                ingredients,
                nutrition,
                model: chatResult?.model ?? null,
            },
        });
    } catch (error) {
        logger.error({ err: { message: error?.message || String(error), stack: error?.stack || null } }, '[buffet/autofill]');
        next(error);
    }
});

// ═══ محرك الربط الآلي: اقتراح + مراجعة + تطبيق ═══════════════════════
// dry-run: لا يكتب شيئًا — يُرجع اقتراحات مجمّعة مع درجات وأسباب.
// apply:   يطبّق القرارات التي اعتمدها المستخدم في الواجهة فقط (+ سجلًا في buffet_link_audit).

// POST /api/buffet/rematch — اقتراحات الربط (dry-run)
router.post('/rematch', jwtAuth, writeGate, async (req, res, next) => {
    try {
        const threshold = Math.min(0.99, Math.max(0.3, Number(req.body?.threshold) || 0.8));
        const [invRows, lineRows] = await Promise.all([
            pool.query('SELECT id, name, unit, category, "avgCost" FROM inventory ORDER BY id'),
            pool.query(`SELECT i.id, i.dish_id, i.name, i.qty::float AS qty, i.unit
                          FROM buffet_ingredients i
                         WHERE i.inventory_id IS NULL
                         ORDER BY i.id`),
        ]);
        const inventory = invRows.rows.map((r) => ({
            id: r.id,
            name: r.name,
            unit: r.unit,
            category: r.category,
            avgCost: r.avgCost == null ? null : Number(r.avgCost),
        }));
        const { proposals } = proposeLinks(
            lineRows.rows.map((r) => ({ id: r.id, name: r.name, qty: Number(r.qty) || 0, unit: r.unit })),
            inventory,
            { threshold },
        );
        const groups = groupProposals(proposals).map((g) => ({
            name: g.name,
            norm: g.key,
            count: g.lines.length,
            lines: g.lines.map((l) => l.id),
            best: g.best,
            alternatives: g.alternatives,
            autoApply: (g.best?.score ?? 0) >= threshold,
        }));
        const auto = groups.filter((g) => g.autoApply);
        res.json({
            ok: true,
            dryRun: true,
            threshold,
            generatedAt: new Date().toISOString(),
            inventoryCount: inventory.length,
            unlinkedBefore: lineRows.rows.length,
            summary: {
                totalGroups: groups.length,
                autoGroups: auto.length,
                autoLines: auto.reduce((sum, g) => sum + g.count, 0),
                reviewGroups: groups.length - auto.length,
            },
            groups,
        });
    } catch (error) {
        logger.error({ err: { message: error?.message || String(error), stack: error?.stack || null } }, '[buffet/rematch]');
        next(error);
    }
});

// POST /api/buffet/rematch/apply — تطبيق القرارات المعتمدة من الواجهة
router.post('/rematch/apply', jwtAuth, writeGate, async (req, res, next) => {
    try {
        const links = Array.isArray(req.body?.links) ? req.body.links.slice(0, 500) : [];
        if (!links.length) {
            return res.status(422).json({ ok: false, error: 'NO_LINKS', message: 'لم يتم اختيار أي ربط' });
        }
        const actor = String(req.user?.name || req.user?.username || req.user?.id || 'user').slice(0, 120);
        let applied = 0;
        const skipped = [];
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const link of links) {
                const inventoryId = Number(link.inventoryId);
                const rule = String(link.rule || 'rematch').slice(0, 120);
                const score = link.score == null ? null : Number(link.score);
                const packKg = link.packKg == null ? null : Number(link.packKg);
                if (!Number.isInteger(inventoryId) || inventoryId <= 0) {
                    skipped.push({ rule, reason: 'معرّف صنف مخزن غير صالح' });
                    continue;
                }
                const inv = await client.query('SELECT id, name FROM inventory WHERE id = $1 LIMIT 1', [String(inventoryId)]);
                if (!inv.rows[0]) {
                    skipped.push({ rule, inventoryId, reason: 'صنف المخزن غير موجود' });
                    continue;
                }
                const lineIds = [...new Set((Array.isArray(link.lines) ? link.lines.map(Number) : []).filter((n) => Number.isInteger(n) && n > 0))];
                for (const lineId of lineIds) {
                    const upd = await client.query(
                        `UPDATE buffet_ingredients
                            SET inventory_id = $2,
                                pack_kg = COALESCE($3, pack_kg_for($2, unit)),
                                updated_at = now()
                          WHERE id = $1 AND inventory_id IS NULL
                          RETURNING dish_id, name`,
                        [lineId, String(inventoryId), packKg && packKg > 0 ? packKg : null],
                    );
                    if (upd.rows[0]) {
                        applied += 1;
                        await client.query(
                            `INSERT INTO buffet_link_audit (dish_id, line_id, ingredient, inventory_id, rule, score, pack_kg, actor)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                            [upd.rows[0].dish_id, lineId, upd.rows[0].name, String(inventoryId), rule, score, packKg && packKg > 0 ? packKg : null, actor],
                        );
                    } else {
                        skipped.push({ lineId, reason: 'السطر مربوط مسبقًا أو غير موجود' });
                    }
                }
            }
            await client.query('COMMIT');
            res.json({ ok: true, applied, skipped });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error({ err: { message: error?.message || String(error), stack: error?.stack || null } }, '[buffet/rematch-apply]');
        next(error);
    }
});

module.exports = { router };

