const express = require('express');
const { pool, withTransaction } = require('./db-pool');
const { jwtAuth, requireRole } = require('./jwt-middleware');
const { logger } = require('../logger');

/**
 * buffet-routes.js — Professional Open-Buffet Cashier API
 * ─────────────────────────────────────────────────────────
 * The buffet sells PEOPLE, not menu items: every invoice records how many
 * adults (كبار), children (صغار) and hospitality (ضيافة) guests were served.
 *
 * Endpoints (all under /api/pos/buffet):
 *   GET    /config              — price list (3 core tiers + custom tiers)
 *   PUT    /config/prices       — bulk-update tier prices (manager+)
 *   POST   /config/tiers        — add a custom tier to the price list (manager+)
 *   PUT    /config/tiers/:id    — rename/reprice a custom tier (manager+)
 *   DELETE /config/tiers/:id    — disable a custom tier (manager+, core tiers protected)
 *   GET    /live                — live covers counter (today + current shift)
 *   GET    /invoices            — stored buffet invoices (per date/session)
 *   GET    /report              — daily buffet report (tiers, hours, payments, cashiers)
 *
 * Sale flow: the POS cart maps tier counts to the tier products and completes
 * through POST /api/sales/complete — inheriting idempotency, ZATCA, shift
 * sessions, stock triggers and cash-drawer math for free.
 */

const router = express.Router();
const ADMIN_ROLES = ['manager', 'admin', 'accountant'];
const SALE_ROLES = ['cashier', 'manager', 'admin', 'kitchen', 'warehouse'];

// Core tiers are immutable in set (can reprice only) — hospitality (ضيافة)
// defaults to price 0 (complimentary), tracked separately in reports.
const CORE_TIERS = [
    { key: 'adult',       name: 'بوفيه كبار',  label: 'كبير',  unit: 'فرد', defaultPrice: 0 },
    { key: 'child',       name: 'بوفيه أطفال', label: 'صغير',  unit: 'فرد', defaultPrice: 0 },
    { key: 'hospitality', name: 'ضيافة',       label: 'ضيافة', unit: 'فرد', defaultPrice: 0 },
];

// Buffet department identity in both legacy + POS registries
const LEGACY_CODE = 'open_buffet';
const POS_CODE = 'erp_open_buffet';
const TZ = 'Asia/Riyadh';

function tierMeta(tierKey) {
    return { buffet_tier: tierKey, catalog_scope: 'buffet_only', managed_in: 'buffet' };
}

async function ensureBuffetSetup(client = pool) {
    // Legacy department row (dashboard/HR reuse it) — id is BIGINT with no
    // default, generate a collision-resistant value instead of Date.now()+rand.
    const deptResult = await client.query(
        `INSERT INTO departments (id, code, name, icon, color)
         VALUES (((EXTRACT(EPOCH FROM NOW())*1000)::bigint * 1000 + FLOOR(RANDOM()*1000)::bigint), $1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, color = EXCLUDED.color
         RETURNING id, code, name, icon, color`,
        [LEGACY_CODE, 'البوفيه المفتوح', '🍽️', '#D4A843']
    );
    const dept = deptResult.rows[0];

    // POS registry row (pos_shift_sessions / pos_orders department_id resolve
    // through it). id is GENERATED ALWAYS — let it auto-assign and link the
    // legacy department via legacy_dept_code (same convention as the kitchen).
    const posDeptResult = await client.query(
        `INSERT INTO pos_departments (code, name_ar, name_en, legacy_dept_code, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (code) DO UPDATE SET
            name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en,
            legacy_dept_code = EXCLUDED.legacy_dept_code, is_active = true
         RETURNING id, code, name_ar`,
        [POS_CODE, 'البوفيه المفتوح', 'Open Buffet', LEGACY_CODE]
    );
    const posDept = posDeptResult.rows[0];

    // Guarantee the three core tier products exist (price 0 until configured)
    for (const tier of CORE_TIERS) {
        const existing = await client.query(
            `SELECT id, name_ar, price, vat_rate, unit, is_active
               FROM pos_products WHERE metadata->>'buffet_tier' = $1 LIMIT 1`,
            [tier.key]
        );
        if (!existing.rows[0]) {
            await client.query(
                `INSERT INTO pos_products (name_ar, name_en, price, cost_price, unit, vat_rate, category, is_active, metadata)
                 VALUES ($1, $2, $3, 0, $4, 15, 'بوفيه', true, $5::jsonb)`,
                [tier.name, tier.label, tier.defaultPrice, tier.unit, JSON.stringify(tierMeta(tier.key))]
            );
        }
    }
    return { department: dept, pos_department: posDept };
}

async function loadTiers(client = pool) {
    const result = await client.query(
        `SELECT id, name_ar, price, vat_rate, unit, is_active,
                metadata->>'buffet_tier' AS tier,
                (metadata->>'buffet_tier' = ANY($1::text[])) AS is_core
           FROM pos_products
          WHERE metadata->>'catalog_scope' = 'buffet_only'
          ORDER BY (metadata->>'buffet_tier' = 'adult') DESC,
                   (metadata->>'buffet_tier' = 'child') DESC,
                   (metadata->>'buffet_tier' = 'hospitality') DESC,
                   id ASC`,
        [CORE_TIERS.map(t => t.key)]
    );
    return result.rows.map(row => ({
        id: Number(row.id),
        tier: row.tier || `custom_${row.id}`,
        name_ar: row.name_ar,
        price: Number(row.price || 0),
        vat_rate: Number(row.vat_rate || 15),
        unit: row.unit || 'فرد',
        is_active: Boolean(row.is_active),
        is_core: Boolean(row.is_core),
    }));
}

// Riyadh "today" window as UTC timestampts
function riyadhDayBounds(dateStr) {
    const date = dateStr || new Date().toLocaleDateString('en-CA', { timeZone: TZ });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {return null;}
    // 03:00 UTC == 00:00 Riyadh (UTC+3)
    return { start: `${date} 00:00+03`, end: `${date} 23:59:59.999+03`, date };
}

function buffetDeptFilter(alias = 'po') {
    return `${alias}.department_id IN (SELECT id FROM pos_departments WHERE code = '${POS_CODE}' OR legacy_dept_code = '${LEGACY_CODE}')`;
}

// ─── GET /config — full price list ──────────────────────────────────────────
router.get('/config', jwtAuth, requireRole(...SALE_ROLES, 'accountant'), async (req, res) => {
    try {
        const { department } = await ensureBuffetSetup();
        const tiers = await loadTiers();
        const posDept = await pool.query(
            `SELECT id, code, name_ar, vat_number FROM pos_departments
              WHERE code = $1 OR legacy_dept_code = $2 LIMIT 1`,
            [POS_CODE, LEGACY_CODE]
        );
        res.json({
            department,
            pos_department: posDept.rows[0] || null,
            tiers,
        });
    } catch (e) {
        logger.error('[buffet/config]', e);
        res.status(500).json({ error: 'BUFFET_CONFIG_FAILED', message: 'تعذر تحميل إعدادات البوفيه' });
    }
});

// ─── PUT /config/prices — bulk price update (core keys + custom ids) ────────
router.put('/config/prices', jwtAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
    const prices = req.body?.prices || {};
    const entries = Object.entries(prices);
    if (!entries.length) {
        return res.status(422).json({ error: 'NO_PRICES_PROVIDED', message: 'أرسل الأسعار بصيغة { prices: { adult: 120, child: 60, hospitality: 0 } }' });
    }
    for (const [key, value] of entries) {
        const num = Number(value);
        if (!Number.isFinite(num) || num < 0) {
            return res.status(422).json({ error: 'INVALID_BUFFET_PRICES', message: `السعر "${key}" يجب أن يكون رقمًا موجبًا أو صفرًا` });
        }
    }
    try {
        const saved = await withTransaction(async client => {
            await ensureBuffetSetup(client);
            const results = [];
            for (const [key, value] of entries) {
                if (CORE_TIERS.some(t => t.key === key)) {
                    const upd = await client.query(
                        `UPDATE pos_products SET price = $1, updated_at = CURRENT_TIMESTAMP
                          WHERE metadata->>'buffet_tier' = $2 RETURNING id, name_ar`,
                        [Number(value).toFixed(2), key]
                    );
                    if (upd.rows[0]) {results.push({ tier: key, price: Number(value), id: Number(upd.rows[0].id) });}
                } else {
                    // custom tier addressed by product id
                    const customId = Number(String(key).replace(/^custom_/, ''));
                    if (!Number.isInteger(customId) || customId <= 0) {continue;}
                    const upd = await client.query(
                        `UPDATE pos_products SET price = $1, updated_at = CURRENT_TIMESTAMP
                          WHERE id = $2 AND metadata->>'catalog_scope' = 'buffet_only'
                            AND metadata->>'buffet_tier' IS NULL
                          RETURNING id, name_ar`,
                        [Number(value).toFixed(2), customId]
                    );
                    if (upd.rows[0]) {results.push({ tier: key, price: Number(value), id: Number(upd.rows[0].id) });}
                }
            }
            return results;
        });
        const tiers = await loadTiers();
        res.json({ saved, tiers, message: 'تم حفظ قائمة الأسعار — الفواتير الجديدة فقط تتأثر بالأسعار الجديدة' });
    } catch (e) {
        logger.error('[buffet/prices]', e);
        res.status(500).json({ error: 'BUFFET_PRICES_FAILED', message: 'تعذر حفظ أسعار البوفيه' });
    }
});

// ─── POST /config/tiers — add a custom tier to the price list ───────────────
router.post('/config/tiers', jwtAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
    const name = String(req.body?.name_ar || '').trim();
    const price = Number(req.body?.price ?? 0);
    const vatRate = Number(req.body?.vat_rate ?? 15);
    if (!name || name.length > 100) {
        return res.status(422).json({ error: 'INVALID_TIER_NAME', message: 'اسم الفئة مطلوب (حتى 100 حرف)' });
    }
    if (!Number.isFinite(price) || price < 0) {
        return res.status(422).json({ error: 'INVALID_TIER_PRICE', message: 'السعر يجب أن يكون رقمًا موجبًا أو صفرًا' });
    }
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
        return res.status(422).json({ error: 'INVALID_TIER_VAT', message: 'نسبة الضريبة بين 0 و 100' });
    }
    try {
        const created = await withTransaction(async client => {
            await ensureBuffetSetup(client);
            const dup = await client.query(
                `SELECT id FROM pos_products WHERE metadata->>'catalog_scope' = 'buffet_only' AND is_active = true AND LOWER(name_ar) = LOWER($1) LIMIT 1`,
                [name]
            );
            if (dup.rows[0]) {throw Object.assign(new Error('يوجد فئة نشطة بنفس الاسم في قائمة الأسعار'), { code: 'DUPLICATE_TIER' });}
            const row = await client.query(
                `INSERT INTO pos_products (name_ar, price, cost_price, unit, vat_rate, category, is_active, metadata)
                 VALUES ($1, $2, 0, 'فرد', $3, 'بوفيه', true, $4::jsonb)
                 RETURNING id, name_ar, price, vat_rate, unit, is_active`,
                [name, price.toFixed(2), vatRate, JSON.stringify({ catalog_scope: 'buffet_only', managed_in: 'buffet' })]
            );
            return row.rows[0];
        });
        const tiers = await loadTiers();
        res.status(201).json({ created: { ...created, id: Number(created.id), price: Number(created.price), vat_rate: Number(created.vat_rate) }, tiers });
    } catch (e) {
        if (e.code === 'DUPLICATE_TIER') {return res.status(409).json({ error: e.code, message: e.message });}
        logger.error('[buffet/add-tier]', e);
        res.status(500).json({ error: 'BUFFET_ADD_TIER_FAILED', message: 'تعذر إضافة الفئة' });
    }
});

// ─── PUT /config/tiers/:id — update custom tier ─────────────────────────────
router.put('/config/tiers/:id', jwtAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {return res.status(422).json({ error: 'INVALID_TIER_ID', message: 'معرّف فئة غير صالح' });}
    const updates = [];
    const params = [];
    if (req.body?.name_ar !== undefined) {
        const name = String(req.body.name_ar).trim();
        if (!name || name.length > 100) {return res.status(422).json({ error: 'INVALID_TIER_NAME', message: 'اسم الفئة مطلوب (حتى 100 حرف)' });}
        params.push(name); updates.push(`name_ar = $${params.length}`);
    }
    if (req.body?.price !== undefined) {
        const price = Number(req.body.price);
        if (!Number.isFinite(price) || price < 0) {return res.status(422).json({ error: 'INVALID_TIER_PRICE', message: 'السعر يجب أن يكون رقمًا موجبًا أو صفرًا' });}
        params.push(price.toFixed(2)); updates.push(`price = $${params.length}`);
    }
    if (req.body?.vat_rate !== undefined) {
        const vatRate = Number(req.body.vat_rate);
        if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {return res.status(422).json({ error: 'INVALID_TIER_VAT', message: 'نسبة الضريبة بين 0 و 100' });}
        params.push(vatRate); updates.push(`vat_rate = $${params.length}`);
    }
    if (req.body?.is_active !== undefined) {
        // Re-enable a previously disabled custom tier (soft-disabled tiers keep their sales history)
        params.push(Boolean(req.body.is_active)); updates.push(`is_active = $${params.length}`);
    }
    if (!updates.length) {return res.status(422).json({ error: 'NOTHING_TO_UPDATE', message: 'لا يوجد ما يُحدَّث' });}
    params.push(id);
    try {
        // Uniqueness lives among ACTIVE tiers only: a disabled tier keeps its
        // name but never blocks a fresh one — re-enabling it, however, must
        // not collide with an active tier of the same name.
        if (req.body?.name_ar !== undefined || req.body?.is_active === true) {
            const nameToCheck = req.body?.name_ar !== undefined
                ? String(req.body.name_ar).trim()
                : (await pool.query(`SELECT name_ar FROM pos_products WHERE id = $1`, [id])).rows[0]?.name_ar;
            if (nameToCheck) {
                const dup = await pool.query(
                    `SELECT id FROM pos_products
                      WHERE metadata->>'catalog_scope' = 'buffet_only'
                        AND is_active = true AND LOWER(name_ar) = LOWER($1) AND id <> $2 LIMIT 1`,
                    [nameToCheck, id]
                );
                if (dup.rows[0]) {return res.status(409).json({ error: 'DUPLICATE_TIER', message: 'يوجد فئة نشطة بنفس الاسم في قائمة الأسعار' });}
            }
        }
        const upd = await pool.query(
            `UPDATE pos_products SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
              WHERE id = $${params.length} AND metadata->>'catalog_scope' = 'buffet_only' RETURNING id, name_ar, price`,
            params
        );
        if (!upd.rows[0]) {return res.status(404).json({ error: 'TIER_NOT_FOUND', message: 'الفئة غير موجودة' });}
        const tiers = await loadTiers();
        res.json({ updated: { id: Number(upd.rows[0].id), name_ar: upd.rows[0].name_ar, price: Number(upd.rows[0].price) }, tiers });
    } catch (e) {
        logger.error('[buffet/update-tier]', e);
        res.status(500).json({ error: 'BUFFET_UPDATE_TIER_FAILED', message: 'تعذر تحديث الفئة' });
    }
});

// ─── DELETE /config/tiers/:id — disable a custom tier (soft) ────────────────
router.delete('/config/tiers/:id', jwtAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {return res.status(422).json({ error: 'INVALID_TIER_ID', message: 'معرّف فئة غير صالح' });}
    try {
        const row = await pool.query(
            `SELECT metadata->>'buffet_tier' AS tier FROM pos_products WHERE id = $1 AND metadata->>'catalog_scope' = 'buffet_only'`,
            [id]
        );
        if (!row.rows[0]) {return res.status(404).json({ error: 'TIER_NOT_FOUND', message: 'الفئة غير موجودة' });}
        if (CORE_TIERS.some(t => t.key === row.rows[0].tier)) {
            return res.status(409).json({ error: 'CORE_TIER_IMMUTABLE', message: 'فئات كبير/صغير/ضيافة أساسية — يمكن تعديل سعرها فقط، أما إضافة فئات جديدة فمتاحة من القائمة' });
        }
        // Soft-disable: tier products carry sales history — never hard delete
        await pool.query(`UPDATE pos_products SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
        const tiers = await loadTiers();
        res.json({ disabled: Number(id), tiers, message: 'تم تعطيل الفئة (يبقى سجل مبيعاتها محفوظًا)' });
    } catch (e) {
        logger.error('[buffet/disable-tier]', e);
        res.status(500).json({ error: 'BUFFET_DISABLE_TIER_FAILED', message: 'تعذر تعطيل الفئة' });
    }
});

// ─── GET /live — live covers counter (innovation) ───────────────────────────
router.get('/live', jwtAuth, requireRole(...SALE_ROLES, 'accountant'), async (req, res) => {
    try {
        const day = riyadhDayBounds(req.query.date);
        const sessionId = Number(req.query.session_id) || null;
        const statusFilter = `po.status IN ('issued','reported')`;

        const coversByTier = async (extraWhere, params) => {
            const rows = await pool.query(
                `SELECT pp.metadata->>'buffet_tier' AS tier,
                        COALESCE(SUM(poi.quantity), 0) AS covers,
                        COALESCE(SUM(poi.line_total), 0) AS amount
                   FROM pos_order_items poi
                   JOIN pos_orders po ON po.id = poi.order_id
                   JOIN pos_products pp ON pp.id = poi.product_id
                  WHERE pp.metadata->>'catalog_scope' = 'buffet_only'
                    AND ${statusFilter} AND ${buffetDeptFilter()} ${extraWhere}
                  GROUP BY 1`,
                params
            );
            const map = {};
            for (const row of rows.rows) {map[row.tier || 'custom'] = { covers: Number(row.covers), amount: Number(row.amount) };}
            return map;
        };

        const dailyWhere = `AND po.created_at >= $1::timestamptz AND po.created_at < ($1::timestamptz + INTERVAL '1 day')`;
        const daily = await coversByTier(dailyWhere, [day.start]);

        let shift = null;
        if (sessionId) {
            // Shift filter is standalone — its own $1, no day-bound param
            shift = await coversByTier(`AND po.session_id = $1`, [sessionId]);
        }

        const dailyTotals = await pool.query(
            `SELECT COUNT(*)::int AS invoices, COALESCE(SUM(po.total_amount), 0) AS revenue,
                    COALESCE(AVG(po.total_amount), 0) AS avg_invoice
               FROM pos_orders po
              WHERE ${statusFilter} AND ${buffetDeptFilter()} ${dailyWhere}`,
            [day.start]
        );
        const voidedToday = await pool.query(
            `SELECT COUNT(*)::int AS count, COALESCE(SUM(po.total_amount), 0) AS amount
               FROM pos_orders po
              WHERE po.status = 'cancelled' AND ${buffetDeptFilter()} ${dailyWhere}`,
            [day.start]
        );
        const heldCurrent = sessionId
            ? await pool.query(`SELECT COUNT(*)::int AS count FROM pos_held_orders WHERE session_id = $1`, [sessionId])
            : null;

        const coversTotal = Object.values(daily).reduce((s, t) => s + t.covers, 0);
        const shiftCovers = shift ? Object.values(shift).reduce((s, t) => s + t.covers, 0) : 0;

        res.json({
            date: day.date,
            daily: {
                covers_by_tier: daily,
                covers_total: coversTotal,
                invoices_count: dailyTotals.rows[0].invoices,
                revenue: Number(dailyTotals.rows[0].revenue),
                avg_invoice: Number(dailyTotals.rows[0].avg_invoice),
                revenue_per_cover: coversTotal > 0 ? Number((Number(dailyTotals.rows[0].revenue) / coversTotal).toFixed(2)) : 0,
                voided: { count: voidedToday.rows[0].count, amount: Number(voidedToday.rows[0].amount) },
            },
            shift: sessionId ? {
                session_id: sessionId,
                covers_by_tier: shift,
                covers_total: shiftCovers,
                held_orders: heldCurrent?.rows[0]?.count ?? 0,
            } : null,
        });
    } catch (e) {
        logger.error('[buffet/live]', e);
        res.status(500).json({ error: 'BUFFET_LIVE_FAILED', message: 'تعذر تحميل العداد الحي' });
    }
});

// ─── GET /invoices — stored buffet invoices ─────────────────────────────────
router.get('/invoices', jwtAuth, requireRole(...SALE_ROLES, 'accountant'), async (req, res) => {
    try {
        const day = riyadhDayBounds(req.query.date);
        if (req.query.date && !day) {return res.status(422).json({ error: 'INVALID_DATE', message: 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD' });}
        const sessionId = Number(req.query.session_id) || null;
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

        const conditions = [buffetDeptFilter()];
        const params = [];
        if (day) { params.push(day.start); conditions.push(`po.created_at >= $${params.length}::timestamptz AND po.created_at < ($${params.length}::timestamptz + INTERVAL '1 day')`); }
        if (sessionId) { params.push(sessionId); conditions.push(`po.session_id = $${params.length}`); }
        if (req.query.status) { params.push(String(req.query.status)); conditions.push(`po.status = $${params.length}`); }
        else {conditions.push(`po.status IN ('issued','reported','cancelled')`);}
        const where = conditions.join(' AND ');

        const ordersRes = await pool.query(
            `SELECT po.id, po.invoice_counter, po.status, po.total_amount, po.tax_total,
                    po.discount_total, po.notes AS party_name, po.created_at, po.voided_at,
                    u.name AS cashier_name, po.session_id
               FROM pos_orders po
               LEFT JOIN users u ON u.id = po.cashier_id
              WHERE ${where}
              ORDER BY po.created_at DESC
              LIMIT ${limit}`,
            params
        );
        const orderIds = ordersRes.rows.map(r => r.id);
        const tierByOrder = {};
        if (orderIds.length) {
            const itemsRes = await pool.query(
                `SELECT poi.order_id, pp.metadata->>'buffet_tier' AS tier, pp.name_ar,
                        SUM(poi.quantity) AS covers, SUM(poi.line_total) AS amount
                   FROM pos_order_items poi
                   JOIN pos_products pp ON pp.id = poi.product_id
                  WHERE poi.order_id = ANY($1::uuid[])
                    AND pp.metadata->>'catalog_scope' = 'buffet_only'
                  GROUP BY 1, 2, 3`,
                [orderIds]
            );
            for (const row of itemsRes.rows) {
                tierByOrder[row.order_id] = tierByOrder[row.order_id] || { tiers: {}, covers_total: 0 };
                const key = row.tier || `custom_${row.name_ar}`;
                tierByOrder[row.order_id].tiers[key] = { name: row.name_ar, covers: Number(row.covers), amount: Number(row.amount) };
                tierByOrder[row.order_id].covers_total += Number(row.covers);
            }
        }

        const data = ordersRes.rows.map(row => ({
            ...row,
            id: row.id,
            total_amount: Number(row.total_amount),
            tax_total: Number(row.tax_total),
            discount_total: Number(row.discount_total),
            covers: tierByOrder[row.id] || { tiers: {}, covers_total: 0 },
        }));
        res.json({ data, count: data.length, date: day?.date || null, session_id: sessionId });
    } catch (e) {
        logger.error('[buffet/invoices]', e);
        res.status(500).json({ error: 'BUFFET_INVOICES_FAILED', message: 'تعذر تحميل فواتير البوفيه' });
    }
});

// ─── GET /report — daily buffet report (innovation) ─────────────────────────
router.get('/report', jwtAuth, requireRole(...SALE_ROLES, 'accountant'), async (req, res) => {
    try {
        const day = riyadhDayBounds(req.query.date);
        if (!day) {return res.status(422).json({ error: 'INVALID_DATE', message: 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD' });}

        // Per-tier summary
        const tierSummary = await pool.query(
            `SELECT pp.metadata->>'buffet_tier' AS tier, pp.name_ar,
                    COALESCE(SUM(poi.quantity), 0) AS covers,
                    COALESCE(SUM(poi.line_total), 0) AS revenue,
                    COUNT(DISTINCT poi.order_id)::int AS invoices
               FROM pos_order_items poi
               JOIN pos_orders po ON po.id = poi.order_id
               JOIN pos_products pp ON pp.id = poi.product_id
              WHERE pp.metadata->>'catalog_scope' = 'buffet_only'
                AND po.status IN ('issued','reported') AND ${buffetDeptFilter()}
                AND po.created_at >= $1::timestamptz AND po.created_at < ($1::timestamptz + INTERVAL '1 day')
              GROUP BY 1, 2 ORDER BY revenue DESC`,
            [day.start]
        );

        // Hourly distribution
        const hourly = await pool.query(
            `SELECT EXTRACT(HOUR FROM po.created_at AT TIME ZONE 'Asia/Riyadh')::int AS hour,
                    COUNT(*)::int AS invoices,
                    COALESCE(SUM(po.total_amount), 0) AS revenue,
                    COALESCE((SELECT SUM(poi2.quantity) FROM pos_order_items poi2
                               JOIN pos_products pp2 ON pp2.id = poi2.product_id
                              WHERE poi2.order_id = po.id AND pp2.metadata->>'catalog_scope' = 'buffet_only'), 0) AS covers
               FROM pos_orders po
              WHERE po.status IN ('issued','reported') AND ${buffetDeptFilter()}
                AND po.created_at >= $1::timestamptz AND po.created_at < ($1::timestamptz + INTERVAL '1 day')
              GROUP BY 1, po.id`,
            [day.start]
        );
        const hourlyAgg = {};
        for (const row of hourly.rows) {
            const h = Number(row.hour);
            hourlyAgg[h] = hourlyAgg[h] || { hour: h, invoices: 0, revenue: 0, covers: 0 };
            hourlyAgg[h].invoices += Number(row.invoices);
            hourlyAgg[h].revenue += Number(row.revenue);
            hourlyAgg[h].covers += Number(row.covers);
        }

        // Payment breakdown
        const payments = await pool.query(
            `SELECT pip.method, COALESCE(SUM(pip.amount), 0) AS total, COUNT(*)::int AS count
               FROM pos_invoice_payments pip
               JOIN pos_orders po ON po.id = pip.order_id
              WHERE pip.direction = 'in' AND po.status IN ('issued','reported') AND ${buffetDeptFilter()}
                AND po.created_at >= $1::timestamptz AND po.created_at < ($1::timestamptz + INTERVAL '1 day')
              GROUP BY 1 ORDER BY total DESC`,
            [day.start]
        );

        // Cashier performance
        const cashiers = await pool.query(
            `SELECT u.name AS cashier, COUNT(*)::int AS invoices,
                    COALESCE(SUM(po.total_amount), 0) AS revenue
               FROM pos_orders po
               JOIN users u ON u.id = po.cashier_id
              WHERE po.status IN ('issued','reported') AND ${buffetDeptFilter()}
                AND po.created_at >= $1::timestamptz AND po.created_at < ($1::timestamptz + INTERVAL '1 day')
              GROUP BY 1 ORDER BY revenue DESC`,
            [day.start]
        );

        // Voided invoices
        const voided = await pool.query(
            `SELECT COUNT(*)::int AS count, COALESCE(SUM(po.total_amount), 0) AS amount
               FROM pos_orders po
              WHERE po.status = 'cancelled' AND ${buffetDeptFilter()}
                AND po.created_at >= $1::timestamptz AND po.created_at < ($1::timestamptz + INTERVAL '1 day')`,
            [day.start]
        );

        // Held (parked) invoices still stored in the cashier for this date
        const held = await pool.query(
            `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_amount), 0) AS amount
               FROM pos_held_orders pho
              WHERE pho.department_id IN (SELECT id FROM pos_departments WHERE code = $1 OR legacy_dept_code = $2)`,
            [POS_CODE, LEGACY_CODE]
        );

        // Gross collected (VAT-inclusive) — the same basis as /live and the
        // shift cash summary, so the three screens never disagree.
        const gross = await pool.query(
            `SELECT COALESCE(SUM(po.total_amount), 0) AS gross,
                    COALESCE(SUM(po.tax_total), 0) AS vat,
                    COALESCE(SUM(po.discount_total), 0) AS discounts
               FROM pos_orders po
              WHERE po.status IN ('issued','reported') AND ${buffetDeptFilter()}
                AND po.created_at >= $1::timestamptz AND po.created_at < ($1::timestamptz + INTERVAL '1 day')`,
            [day.start]
        );

        const tiers = tierSummary.rows.map(r => ({
            tier: r.tier || 'custom', name: r.name_ar,
            covers: Number(r.covers), revenue: Number(r.revenue), invoices: Number(r.invoices),
            avg_price: Number(r.covers) > 0 ? Number((Number(r.revenue) / Number(r.covers)).toFixed(2)) : 0,
        }));
        const coversTotal = tiers.reduce((s, t) => s + t.covers, 0);
        const netRevenue = tiers.reduce((s, t) => s + t.revenue, 0);
        const grossRevenue = Number(gross.rows[0].gross);
        const vatTotal = Number(gross.rows[0].vat);
        const invoiceCount = cashiers.rows.reduce((s, r) => s + Number(r.invoices), 0);

        res.json({
            date: day.date,
            generated_at: new Date().toISOString(),
            totals: {
                covers_total: coversTotal,
                revenue: Number(grossRevenue.toFixed(2)),
                net_revenue: Number(netRevenue.toFixed(2)),
                vat_total: Number(vatTotal.toFixed(2)),
                discounts_total: Number(gross.rows[0].discounts),
                invoices: invoiceCount,
                avg_invoice: invoiceCount > 0 ? Number((grossRevenue / invoiceCount).toFixed(2)) : 0,
                revenue_per_cover: coversTotal > 0 ? Number((grossRevenue / coversTotal).toFixed(2)) : 0,
                voided: { count: voided.rows[0].count, amount: Number(voided.rows[0].amount) },
                still_held: { count: held.rows[0].count, amount: Number(held.rows[0].amount) },
            },
            tiers,
            hourly: Object.values(hourlyAgg).sort((a, b) => a.hour - b.hour).map(h => ({
                hour: h.hour, invoices: h.invoices, revenue: Number(h.revenue.toFixed(2)), covers: h.covers,
            })),
            payments: payments.rows.map(p => ({ method: p.method, total: Number(p.total), count: p.count })),
            cashiers: cashiers.rows.map(c => ({ cashier: c.cashier, invoices: c.invoices, revenue: Number(c.revenue) })),
        });
    } catch (e) {
        logger.error('[buffet/report]', e);
        res.status(500).json({ error: 'BUFFET_REPORT_FAILED', message: 'تعذر توليد تقرير البوفيه' });
    }
});

module.exports = { router, ensureBuffetSetup };
