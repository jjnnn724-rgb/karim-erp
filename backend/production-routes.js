/**
 * production-routes.js — إذن التوليد (خام ← مصنّع بتكلفة الوصفة) · 2026-10-25
 * ═══════════════════════════════════════════════════════════════════════
 * الطلب المعتمد (نظام تكلفة المراكز — المرحلة 3): أقسام البيع (خارجي/عصير/
 * كافيه) تسحب من المطبخ مصنّعًا وغير مصنّع، والمطلوب كلفةٌ دقيقة وترحيلات
 * صحيحة. التوليد هو الحلقة الناقصة: يستهلك مكونات الوصفة من المخزن الرئيسي
 * (كمية العائد × الدفعات × الهالك) بمتوسط تكلفتها، ويسجّل مصروف «توليد»
 * على قسم الوصفة بقيمة حقيقية، ويرحّل قيد Dr 5000 COGS / Cr 1200 مخزون
 * بمركز تكلفة القسم — نفس نمط اعتماد الصرف حرفًا (ledger + inventoryTx +
 * expense + journal best-effort بعد COMMIT).
 *
 * القرار المحاسبي الموثق: استهلاك التوليد يُعامل كصرف مطبخ (COGS فوري بمركز
 * تكلفة القسم) — اتساقًا مع النموذج القائم حيث كل سحبٍ من المخزن يقفل على
 * COGS لحظة الخروج. تكلفة الوحدة المقدرة تعود للواجهة للتوثيق فقط.
 *
 * القراءة: مصروفات فئة «توليد» (نفس جدول expenses — بلا جداول جديدة).
 * كل شيء idempotent عبر مفاتيح ledger (production:<key>:<inventoryId>).
 */
const express = require('express');
const crypto = require('crypto');
const { pool } = require('./shared-pool');
const { riyadhToday } = require('./riyadh-date');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');
const { postInventoryLedgerEntry } = require('./inventory-ledger');
const { emitDomainEvent } = require('./realtime/producers');
const { ensureCostCenters, postJournal } = require('./accounting-routes');

const router = express.Router();
const WRITE_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef'];
const READ_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'accountant', 'auditor', 'dept_head'];

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const round = (v, d = 2) => Math.round((Number(v) || 0) * (10 ** d)) / (10 ** d);
const dateOnly = (v) => String(v || '').slice(0, 10);
const dayRe = /^\d{4}-\d{2}-\d{2}$/;

function fail(res, status, error, message, extra = {}) {
    return res.status(status).json({ error, message, ...extra });
}

function id() {
    return Date.now().toString(36) + crypto.randomBytes(6).toString('hex');
}

/** مزوّد المخزن الرئيسي — نفس عقد warehouse-routes.getWarehouseLocation. */
async function getMainLocation(client) {
    const code = 'MAIN-WAREHOUSE';
    const existing = (await client.query(
        'SELECT id, code, name_ar, dept_code FROM inventory_locations WHERE code=$1 AND active=true LIMIT 1', [code])).rows[0];
    if (existing) {return existing;}
    return (await client.query(
        `INSERT INTO inventory_locations (code,name_ar,location_type,active,negative_stock_policy,costing_policy,count_frequency_days,dept_code)
         VALUES ($1,$2,'warehouse',true,'deny','weighted_average',7,'kitchen')
         ON CONFLICT (code) DO UPDATE SET active=true RETURNING id,code,name_ar,dept_code`,
        [code, 'المخزن الرئيسي'])).rows[0];
}

/** الوصفة النشطة بمكوناتها — أحدث إصدار (أو المفعّل ضمن نافذته). */
async function loadRecipe(client, recipeId) {
    const recipe = (await client.query(
        `SELECT id, name, "deptId", "totalCost", "sellingPrice" FROM recipes WHERE id = $1 LIMIT 1`,
        [String(recipeId)])).rows[0];
    if (!recipe) {return null;}
    const version = (await client.query(
        `SELECT id, product_id, yield_qty, version_no
         FROM pos_recipe_versions WHERE recipe_id = $1
         ORDER BY (status = 'active') DESC, version_no DESC LIMIT 1`,
        [String(recipeId)])).rows[0];
    if (!version) {return { ...recipe, noVersion: true };}
    const ingredients = (await client.query(
        `SELECT rvi.inventory_id, rvi.quantity_per_yield, rvi.unit, rvi.waste_percent,
                i.name, i.qty AS stock_qty, i."avgCost", i.unit AS inv_unit
         FROM pos_recipe_version_ingredients rvi
         JOIN inventory i ON i.id = rvi.inventory_id
         WHERE rvi.recipe_version_id = $1`,
        [version.id])).rows;
    return { ...recipe, version, ingredients };
}

/** POST /api/productions — تنفيذ دفعة توليد. */
router.post('/', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    const recipeId = String(req.body?.recipeId || '').trim();
    const batches = Math.floor(n(req.body?.batches));
    const date = dayRe.test(dateOnly(req.body?.date)) ? dateOnly(req.body.date) : riyadhToday();
    const notes = String(req.body?.notes || '').slice(0, 300);
    if (!recipeId) {return fail(res, 422, 'PRODUCTION_RECIPE_REQUIRED', 'اختر الوصفة');}
    if (!(batches > 0)) {return fail(res, 422, 'PRODUCTION_BATCHES_INVALID', 'عدد الدفعات يجب أن يكون 1 على الأقل');}

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const recipe = await loadRecipe(client, recipeId);
        if (!recipe) {
            await client.query('ROLLBACK');
            return fail(res, 404, 'PRODUCTION_RECIPE_NOT_FOUND', 'الوصفة غير موجودة');
        }
        if (recipe.noVersion || !recipe.version) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'PRODUCTION_NO_VERSION', 'الوصفة بلا إصدار مكونات — أكمل مكونات الوصفة أولًا');
        }
        if (!Array.isArray(recipe.ingredients) || !recipe.ingredients.length) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'PRODUCTION_NO_INGREDIENTS', 'الوصفة بلا مكونات مخزنية — لا يمكن التوليد بدونها');
        }
        const yieldQty = n(recipe.version.yield_qty);
        if (!(yieldQty > 0)) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'PRODUCTION_NO_YIELD', 'الإصدار بلا كمية عائد (yield_qty) — حدّد العائد أولًا');
        }

        const mainLocation = await getMainLocation(client);

        // الحساب والتحقق قبل أي حركة: الكمية المطلوبة والرصيد المتاح لكل مكوّن
        const plan = [];
        let totalValue = 0;
        for (const ing of recipe.ingredients) {
            const waste = 1 + (n(ing.waste_percent) / 100);
            const needed = round(n(ing.quantity_per_yield) * batches * waste, 3);
            if (!(needed > 0)) {continue;}
            const availResult = await client.query(
                `SELECT COALESCE(GREATEST(0, on_hand - reserved), 0) AS main_available
                 FROM inventory_location_balances
                 WHERE inventory_id = $1 AND location_id = $2`,
                [ing.inventory_id, mainLocation.id]);
            const available = n(availResult.rows[0]?.main_available);
            if (needed > available) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'PRODUCTION_STOCK_SHORT', `الرصيد غير كافٍ من ${ing.name}: مطلوب ${needed} والمتاح ${available}`, {
                    itemName: ing.name, needed, available,
                });
            }
            const value = round(needed * n(ing.avgCost), 2);
            plan.push({ ...ing, needed, value });
            totalValue += value;
        }
        totalValue = round(totalValue, 2);
        if (!plan.length) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'PRODUCTION_EMPTY_PLAN', 'لا مكوّنات كمياتها مؤثرة — راجع كميات الوصفة');
        }

        const prodKey = `${recipeId}:${date}:${crypto.randomBytes(4).toString('hex')}`;
        const unitCost = round(totalValue / (yieldQty * batches), 4);

        // حركة المخزون: نفس ميكانيكا اعتماد الصرف حرفًا
        for (const item of plan) {
            await postInventoryLedgerEntry(client, {
                transactionType: 'transfer_out',
                inventoryId: Number(item.inventory_id),
                locationId: mainLocation.id,
                quantityDelta: -item.needed,
                unit: item.inv_unit || item.unit || 'وحدة',
                unitCost: n(item.avgCost),
                sourceLocationId: mainLocation.id,
                referenceType: 'production',
                referenceId: prodKey,
                userId: req.user.id,
                idempotencyKey: `production:${prodKey}:${item.inventory_id}:${mainLocation.id}`,
                reason: `توليد ${recipe.name} — ${item.name}`,
                metadata: { recipe_id: recipeId, batches, production_key: prodKey },
            });
            await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes)
                 VALUES ($1,$2,$3,$4,'out',$5,$6,$7,$8)`,
                [id(), item.inventory_id, item.name, item.needed, date, n(item.avgCost), item.value,
                    `توليد: ${recipe.name} × ${batches} دفعة`]);
        }

        // مصروف التوليد على قسم الوصفة — تدخل في حساب القسم تلقائيًا
        const breakdown = plan.map((p) => `${p.name} (${p.needed})`).join('، ').slice(0, 240);
        const expense = (await client.query(
            `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
             VALUES ($1,$2,$3,$4,$5,$6,true,'توليد','production') RETURNING *`,
            [id(), recipe.deptId || 'kitchen',
                `توليد: ${recipe.name} × ${batches} دفعة (عائد ${round(yieldQty * batches, 3)}) — كلفة الوحدة ${unitCost}`,
                totalValue, date,
                `مكونات: ${breakdown}${notes ? ` — ${notes}` : ''} | مفتاح التوليد: ${prodKey}`])).rows[0];

        await emitDomainEvent(pool, client, 'PRODUCTION', {
            eventType: 'PRODUCTION_EXECUTED', aggregateType: 'production', aggregateId: prodKey,
            deptCode: recipe.deptId || 'kitchen',
            payload: { recipe_id: recipeId, recipe: recipe.name, batches, total: totalValue, unit_cost: unitCost, items: plan.length },
        });
        await client.query('COMMIT');

        // ترحيل محاسبي متماثل best-effort: Dr 5000 COGS (بمركز قسم الوصفة) / Cr 1200
        try {
            const cc = recipe.deptId || 'kitchen';
            await ensureCostCenters([cc]);
            await postJournal(pool, {
                date,
                memo: `توليد ${recipe.name} × ${batches} دفعة (${cc})`,
                source_type: 'production',
                source_id: prodKey,
                lines: [
                    { account_code: '5000', debit: totalValue, credit: 0, memo: 'تكلفة توليد', cost_center_code: cc },
                    { account_code: '1200', debit: 0, credit: totalValue, memo: 'استهلاك خام', cost_center_code: cc },
                ],
            });
        } catch (ledgerErr) { logger.warn('[production_ledger] best-effort skipped:', ledgerErr.message); }

        logger.info(`[production] ${recipe.name} × ${batches} = ${totalValue} (${plan.length} مكوّنًا)`);
        res.json({
            production: { key: prodKey, recipe: recipe.name, dept: recipe.deptId, batches, date },
            items: plan.map((p) => ({ name: p.name, needed: p.needed, unit: p.inv_unit || p.unit, value: p.value })),
            totalValue, unitCost,
            expense,
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[production_create]', error);
        if (error.code === '55P03') {
            return fail(res, 409, 'PRODUCTION_BUSY', 'صنف من مكونات الوصفة مستخدم في عملية أخرى — أعد المحاولة بعد ثانية');
        }
        return fail(res, 500, 'PRODUCTION_FAILED', 'تعذر تنفيذ التوليد');
    } finally {
        client.release();
    }
});

/** GET /api/productions?from&to&dept — سجل التوليد (مصروفات الفئة). */
router.get('/', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const params = [];
        let where = `category = 'توليد'`;
        if (dayRe.test(dateOnly(req.query.from))) {params.push(dateOnly(req.query.from)); where += ` AND date >= $${params.length}`;}
        if (dayRe.test(dateOnly(req.query.to))) {params.push(dateOnly(req.query.to)); where += ` AND date <= $${params.length}`;}
        if (req.query.dept) {params.push(String(req.query.dept)); where += ` AND "deptId" = $${params.length}`;}
        const rows = (await pool.query(
            `SELECT id, "deptId", "desc", amount, date, notes FROM expenses
             WHERE ${where} ORDER BY date DESC, id DESC LIMIT 200`, params)).rows;
        const total = round(rows.reduce((s, r) => s + n(r.amount), 0), 2);
        res.json({ data: rows, total, count: rows.length });
    } catch (error) {
        logger.error('[production_list]', error);
        return fail(res, 500, 'PRODUCTION_LIST_FAILED', 'تعذر قراءة سجل التوليد');
    }
});

module.exports = { router };
