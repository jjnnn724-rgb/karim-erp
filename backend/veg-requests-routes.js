/**
 * veg-requests-routes.js — طلبات شراء الخضار من المطبخ إلى المخازن (2026-10-04)
 * ────────────────────────────────────────────────────────────────────────────
 * الهدف: صفحة مخصصة للشيف/السو شيف يبني بها طلب خضار من قايمة مصنّفة جاهزة،
 * يرسله للمخازن، ويطبعه الطرفان بنموذج A4 احترافي (توقيعات + رقم طلب).
 *
 * القواعد:
 *   • إنشاء: kitchen / sous_chef / dept_head / admin / owner / manager
 *   • قراءة: أعلاه + warehouse (المخازن يشوف كل الطلبات ويستلم)
 *   • استلام: warehouse / admin / owner / manager — من حالة «قيد الانتظار» فقط
 *   • إلغاء: صاحب الطلب نفسه أو admin/owner — قبل الاستلام فقط
 *   • كل النصوص الحرة تُنظّف من <> وقصّ الطول (لا HTML مخزّن)
 *   • الطلب يُنبَّه له لحظيًا عبر io.emit('veg_request:new')
 */
'use strict';

const express = require('express');
const { pool } = require('./shared-pool');
const { logger } = require('./logger');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { cleanText, validateItems, applyPrices, UNITS, VEG_CATALOG } = require('./veg-requests-logic');

const router = express.Router();

const CREATE_ROLES = ['sous_chef', 'admin', 'owner'];
const READ_ROLES = [...CREATE_ROLES, 'warehouse'];
const RECEIVE_ROLES = ['sous_chef', 'admin', 'owner'];

/**
 * Penerimaan oleh kepala bagian (permintaan pemilik 2026-10-04): kepala bagian dapur
 * atau kepala bagian salad boleh menerima permintaan sayur. dept_code bisa huruf besar
 * ('KITCHEN') atau daftar dipisah koma ('storeroom,SERVICE') — dicocokkan tanpa
 * memperhatikan huruf besar/kecil per bagian.
 */
function isKitchenFamilyDeptHead(req) {
    if (req.user?.role !== 'dept_head') {return false;}
    const depts = String(req.user?.dept_code || '')
        .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
    return depts.includes('kitchen') || depts.includes('salads');
}

// ─── المخطط (lazy — أول لمسة تُنشئ الجدول) ───────────────────────────────────

let schemaReady = null;
function ensureSchema() {
    if (!schemaReady) {
        schemaReady = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS veg_requests (
                    id BIGSERIAL PRIMARY KEY,
                    request_no VARCHAR(24) UNIQUE,
                    created_by BIGINT NOT NULL,
                    created_by_name VARCHAR(120),
                    created_by_role VARCHAR(40),
                    department VARCHAR(80) NOT NULL DEFAULT 'مطبخ',
                    priority VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
                    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','received','priced','cancelled')),
                    items JSONB NOT NULL,
                    items_count INTEGER NOT NULL DEFAULT 0,
                    notes TEXT,
                    received_by BIGINT,
                    received_by_name VARCHAR(120),
                    received_by_dept VARCHAR(80),
                    received_at TIMESTAMPTZ,
                    cancelled_by BIGINT,
                    cancelled_by_name VARCHAR(120),
                    cancelled_reason TEXT,
                    total NUMERIC(14,2),
                    priced_by BIGINT,
                    priced_by_name VARCHAR(120),
                    priced_at TIMESTAMPTZ,
                    expense_id BIGINT,
                    print_count INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )`);
            await pool.query('CREATE INDEX IF NOT EXISTS idx_veg_requests_created_at ON veg_requests (created_at DESC)');
            await pool.query('CREATE INDEX IF NOT EXISTS idx_veg_requests_status ON veg_requests (status)');
            // ترحيل الجداول القديمة: أعمدة التسعير + حالة priced (idempotent)
            await pool.query(`
                ALTER TABLE veg_requests ADD COLUMN IF NOT EXISTS received_by_dept VARCHAR(80);
                ALTER TABLE veg_requests ADD COLUMN IF NOT EXISTS total NUMERIC(14,2);
                ALTER TABLE veg_requests ADD COLUMN IF NOT EXISTS priced_by BIGINT;
                ALTER TABLE veg_requests ADD COLUMN IF NOT EXISTS priced_by_name VARCHAR(120);
                ALTER TABLE veg_requests ADD COLUMN IF NOT EXISTS priced_at TIMESTAMPTZ;
                ALTER TABLE veg_requests ADD COLUMN IF NOT EXISTS expense_id BIGINT`);
            // توسيع CHECK الحالة: اسحب القيد القديم وركّب الموسع (لو موجود أصلاً فتمشي بالمرور)
            try {
                await pool.query(`ALTER TABLE veg_requests DROP CONSTRAINT veg_requests_status_check`);
            } catch (_) { /* القيد بالاسم الآخر أو غير موجود */ }
            try {
                await pool.query(`ALTER TABLE veg_requests ADD CONSTRAINT veg_requests_status_check
                    CHECK (status IN ('pending','received','priced','cancelled'))`);
            } catch (_) { /* مقيد مسبقاً */ }
        })().catch((e) => { schemaReady = null; throw e; });
    }
    return schemaReady;
}

// ─── كتالوج الخضار ───────────────────────────────────────────────────────────

router.get('/catalog', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        res.json({ ok: true, categories: VEG_CATALOG, units: UNITS });
    } catch (e) { next(e); }
});

// ─── إنشاء طلب ───────────────────────────────────────────────────────────────

router.post('/', jwtAuth, requireRole(...CREATE_ROLES), async (req, res, next) => {
    try {
        await ensureSchema();
        const checked = validateItems(req.body?.items);
        if (!checked.ok) {
            return res.status(422).json({ ok: false, error: 'ITEMS_INVALID', message: checked.error });
        }
        const priority = req.body?.priority === 'urgent' ? 'urgent' : 'normal';
        const notes = cleanText(req.body?.notes, 500) || null;
        const items = JSON.stringify(checked.items);
        const ins = await pool.query(
            `INSERT INTO veg_requests
                (created_by, created_by_name, created_by_role, priority, items, items_count, notes)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
             RETURNING id, created_at`,
            [req.user.id, cleanText(req.user.name || req.user.username, 120), cleanText(req.user.role, 40),
                priority, items, checked.items.length, notes]
        );
        const row = ins.rows[0];
        const requestNo = `VR-${new Date(row.created_at).toISOString().slice(0, 10).replace(/-/g, '')}-${String(row.id).padStart(4, '0')}`;
        const saved = (await pool.query(
            'UPDATE veg_requests SET request_no = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
            [row.id, requestNo]
        )).rows[0];

        logger.info('[veg-requests] طلب خضار جديد', {
            request_no: requestNo, by: req.user.username, items: checked.items.length, priority,
        });
        // إشعار لحظي للمخازن والإدارة (الواجهة تعرض toast وتحدّث السجل لو مفتوح)
        try {
            if (req.io) {
                req.io.emit('veg_request:new', {
                    id: saved.id, request_no: requestNo,
                    created_by_name: saved.created_by_name,
                    items_count: saved.items_count, priority: saved.priority,
                });
            }
        } catch (_) { /* الإشعار اللحظي لا يوقف العملية */ }
        return res.json({ ok: true, request: saved });
    } catch (e) { next(e); }
});

// ─── سجل الطلبات ─────────────────────────────────────────────────────────────

router.get('/', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        await ensureSchema();
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
        const conds = [];
        const params = [];
        if (['pending', 'received', 'cancelled'].includes(req.query.status)) {
            params.push(req.query.status);
            conds.push(`status = $${params.length}`);
        }
        if (req.query.mine === '1') {
            params.push(req.user.id);
            conds.push(`created_by = $${params.length}`);
        }
        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
        params.push(limit);
        // القائمة والملخص بالتوازي (قياس 2026-10-04: كانا متسلسلين — توفير ذهاب/إياب كامل لكل طلب)
        const [listRes, sumRes] = await Promise.all([
            pool.query(
                `SELECT id, request_no, created_by, created_by_name, created_by_role, department,
                        priority, status, items, items_count, notes,
                        received_by, received_by_name, received_by_dept, received_at,
                        total, priced_by_name, priced_at, expense_id, print_count, created_at
                  FROM veg_requests ${where}
                  ORDER BY created_at DESC LIMIT $${params.length}`,
                params
            ),
            pool.query(
                `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
                        COUNT(*) FILTER (WHERE status = 'pending' AND created_at::date = CURRENT_DATE)::int AS pending_today,
                        COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today
                  FROM veg_requests`
            ),
        ]);
        res.json({ ok: true, requests: listRes.rows, summary: sumRes.rows[0] });
    } catch (e) { next(e); }
});

// ─── استلام — السو شيف فقط (+ الإدارة) — قرار المالك 2026-10-10 ───────────

const receiveGate = [jwtAuth, (req, res, next) => {
    if (RECEIVE_ROLES.includes(req.user?.role)) {return next();}
    return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'الاستلام والتوقيع للسو شيف فقط' });
}];

router.post('/:id/receive', ...receiveGate, async (req, res, next) => {
    try {
        await ensureSchema();
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(422).json({ ok: false, error: 'ID_INVALID', message: 'معرّف طلب غير سليم' });
        }
        const byDept = String(req.user.dept_code || '').split(',')[0].trim() || 'سو شيف';
        // الرفض على مستوى الصنف (طلب المالك 2026-10-04): المرفوض لا يرجع للتسعير
        const rejections = new Set(
            (Array.isArray(req.body?.rejections) ? req.body.rejections : [])
                .map((n) => cleanText(n, 80).toLowerCase()).filter(Boolean)
        );
        const row0 = (await pool.query('SELECT items, request_no FROM veg_requests WHERE id = $1', [id])).rows[0];
        const items0 = Array.isArray(row0?.items) ? row0.items : (() => { try { return JSON.parse(row0?.items || '[]'); } catch (_) { return []; } })();
        // الاستلام الجزئي (طلب المالك 2026-10-09): استلمت 80 طماطم والسليم 30 —
        // الحساب على السليم فقط، والتالف موثق ولا يُسعَّر ولا يُحمَّل
        const qtyMap = new Map();
        if (Array.isArray(req.body?.quantities)) {
            for (const q of req.body.quantities) {
                const nm = cleanText(q?.name, 80).toLowerCase();
                const rq = Number(q?.receivedQty ?? q?.qty);
                if (nm && Number.isFinite(rq) && rq >= 0 && rq <= 1000000) {qtyMap.set(nm, rq);}
            }
        }
        let itemsUpdate = null;
        const spoiledNotes = [];
        if (rejections.size || qtyMap.size) {
            itemsUpdate = JSON.stringify(items0.map((it) => {
                const key = String(it.name).toLowerCase();
                if (rejections.has(key)) {return { ...it, rejected: true };}
                if (qtyMap.has(key)) {
                    const got = Math.round(qtyMap.get(key) * 1000) / 1000;
                    const asked = Number(it.qty) || 0;
                    if (got < asked) {
                        const spoiled = Math.round((asked - got) * 1000) / 1000;
                        spoiledNotes.push(`${it.name}: المطلوب ${asked} — السليم ${got} — التالف ${spoiled}`);
                        return { ...it, qty: got, spoiledQty: spoiled };
                    }
                }
                return it;
            }));
        }
        // التسعير الفوري مع الاستلام (طلب المالك 2026-10-09): سعر المندوب/المشتريات
        // نهائي — لو أُرسلت أسعار مع الاستلام يُعتمد الطلب مباشرة (priced) بلا خطوة لاحقة
        const finalItems = itemsUpdate ? JSON.parse(itemsUpdate) : items0;
        let directApprove = null;
        if (Array.isArray(req.body?.prices) && req.body.prices.length) {
            const checked = applyPrices(finalItems, req.body.prices);
            if (!checked.ok) {
                return res.status(422).json({ ok: false, error: 'PRICES_INVALID', message: checked.error });
            }
            directApprove = checked;
        }
        let upd;
        if (directApprove) {
            // FIX 2026-10-11: wrap expense INSERT + guarded UPDATE in a transaction
            // — expense was committing before the UPDATE, so a concurrent receive/cancel
            // left a phantom charge with no matching request status change
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const expenseId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
                const chargeDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
                const userName = cleanText(req.user.name || req.user.username, 120);
                const exp = await client.query(
                    `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
                     VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8) RETURNING id`,
                    [expenseId, 'kitchen', `طلب خضار ${row0.request_no || ('#' + id)}`, directApprove.total,
                        chargeDate, `استلمها وسعّرها ${userName} (${byDept}) — اعتماد مباشر`, 'خضار', 'veg_request']
                );
                upd = await client.query(
                    `UPDATE veg_requests
                      SET status = 'priced', received_by = $2, received_by_name = $3,
                          received_by_dept = $4, received_at = NOW(), updated_at = NOW(),
                          items = $5::jsonb, total = $6,
                          priced_by = $2, priced_by_name = $3, priced_at = NOW(), expense_id = $7
                      WHERE id = $1 AND status = 'pending'
                      RETURNING *`,
                    [id, req.user.id, userName, cleanText(byDept, 80),
                        JSON.stringify(directApprove.items), directApprove.total, exp.rows[0].id]
                );
                if (!upd.rows.length) {
                    // UPDATE matched 0 rows (concurrent receive/cancel) → roll back the expense
                    await client.query('ROLLBACK');
                    return res.status(409).json({ ok: false, error: 'NOT_PENDING', message: 'الطلب مستلم أو ملغي بالفعل' });
                }
                await client.query('COMMIT');
            } catch (txnErr) {
                await client.query('ROLLBACK').catch(() => {});
                throw txnErr;
            } finally {
                client.release();
            }
        } else {
            upd = await pool.query(
                `UPDATE veg_requests
                  SET status = 'received', received_by = $2, received_by_name = $3,
                      received_by_dept = $4, received_at = NOW(), updated_at = NOW(),
                      items = COALESCE($5::jsonb, items)
                  WHERE id = $1 AND status = 'pending'
                  RETURNING *`,
                [id, req.user.id, cleanText(req.user.name || req.user.username, 120), cleanText(byDept, 80), itemsUpdate]
            );
        }
        if (!upd.rows.length) {
            return res.status(409).json({ ok: false, error: 'NOT_PENDING', message: 'الطلب مستلم أو ملغي بالفعل' });
        }
        logger.info('[veg-requests] استلام طلب', {
            request_no: upd.rows[0].request_no, by: req.user.username, dept: byDept,
            rejected: [...rejections].length || undefined,
            directApproved: directApprove ? directApprove.total : undefined,
        });
        try { if (req.io) { req.io.emit('veg_request:update', { id, status: upd.rows[0].status }); } } catch (_) {}
        return res.json({ ok: true, request: upd.rows[0],
            ...(directApprove ? { expenseId: upd.rows[0].expense_id, total: directApprove.total } : {} )});
    } catch (e) { next(e); }
});

// ─── تسعير المخزن (بعد الاستلام) — يحمل المصروف على قسم المطبخ تلقائياً ──────

router.post('/:id/price', jwtAuth, requireRole('warehouse', 'admin', 'owner', 'manager'), async (req, res, next) => {
    try {
        await ensureSchema();
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(422).json({ ok: false, error: 'ID_INVALID', message: 'معرّف طلب غير سليم' });
        }
        const row = (await pool.query('SELECT * FROM veg_requests WHERE id = $1', [id])).rows[0];
        if (!row) {return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'الطلب غير موجود' });}
        if (row.status !== 'received') {
            return res.status(409).json({ ok: false, error: 'NOT_RECEIVED', message: 'التسعير بعد استلام رئيس القسم — الطلب حالته ' + row.status });
        }
        const items = Array.isArray(row.items) ? row.items : JSON.parse(row.items || '[]');
        const checked = applyPrices(items, req.body?.prices);
        if (!checked.ok) {
            return res.status(422).json({ ok: false, error: 'PRICES_INVALID', message: checked.error });
        }
        // المصروف على قسم المطبخ (نفس جدول expenses الذي تقرأه لوحات الأقسام).
        // expenses.id بلا تسلسل — المعرّف يُولَّد كما يفعل باقي الكود (الوقت + عشوائي).
        // FIX 2026-10-11: wrap in transaction + AND status='received' guard
        // — two concurrent price calls both passed the status check → double expense
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const expenseId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
            const chargeDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
            const exp = await client.query(
                `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
                 VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8) RETURNING id`,
                [expenseId,
                    'kitchen',
                    `طلب خضار ${row.request_no}`,
                    checked.total,
                    chargeDate,
                    `استلمها ${row.received_by_name || ''}${row.received_by_dept ? ' (' + row.received_by_dept + ')' : ''} — سعّرها ${cleanText(req.user.name || req.user.username, 60)}`,
                    'خضار',
                    'veg_request']
            );
            const upd = await client.query(
                `UPDATE veg_requests
                  SET items = $2::jsonb, total = $3, status = 'priced',
                      priced_by = $4, priced_by_name = $5, priced_at = NOW(),
                      expense_id = $6, updated_at = NOW()
                  WHERE id = $1 AND status = 'received' RETURNING *`,
                [id, JSON.stringify(checked.items), checked.total,
                    req.user.id, cleanText(req.user.name || req.user.username, 120), exp.rows[0].id]
            );
            if (!upd.rows.length) {
                await client.query('ROLLBACK');
                return res.status(409).json({ ok: false, error: 'NOT_RECEIVED', message: 'الطلب لم يعد قابلاً للتسعير — الحالة تغيرت' });
            }
            await client.query('COMMIT');
            logger.info('[veg-requests] تسعير طلب + مصروف على قسم المطبخ', {
                request_no: row.request_no, total: checked.total, expense_id: exp.rows[0].id,
            });
            try { if (req.io) { req.io.emit('veg_request:update', { id, status: 'priced' }); } } catch (_) {}
            return res.json({ ok: true, request: upd.rows[0], expenseId: exp.rows[0].id, total: checked.total });
        } catch (txnErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txnErr;
        } finally {
            client.release();
        }
    } catch (e) { next(e); }
});

// ─── تعديل الكميات قبل الاعتماد النهائي (طلب المالك 2026-10-09) ───
// رئيس القسم أو المشتريات (warehouse) يعدّل كميات الأصناف الموجودة
// طالما الطلب معلق (قبل الاستلام/التسعير). إضافة أصناف جديدة مرفوضة —
// طلب جديد لها. أي تعديل يُوثَّق ويُبث لحظيًا.
const EDIT_ROLES = ['sous_chef', 'admin', 'owner'];
router.put('/:id/items', jwtAuth, requireRole(...EDIT_ROLES), async (req, res, next) => {
    try {
        await ensureSchema();
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(422).json({ ok: false, error: 'ID_INVALID', message: 'معرّف طلب غير سليم' });
        }
        const row = (await pool.query('SELECT * FROM veg_requests WHERE id = $1', [id])).rows[0];
        if (!row) {return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'الطلب غير موجود' });}
        if (row.status !== 'pending') {
            return res.status(409).json({ ok: false, error: 'NOT_EDITABLE', message: 'التعديل قبل الاعتماد النهائي فقط — الطلب حالته ' + row.status });
        }
        const isBoss = ['admin', 'owner', 'manager'].includes(req.user.role);
        const isDeptHead = req.user.role === 'dept_head';
        const isCreator = Number(row.created_by) === Number(req.user.id);
        if (!isBoss && !isDeptHead && !isCreator) {
            return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'التعديل لرئيس القسم أو صاحب الطلب فقط' });
        }
        const items = Array.isArray(row.items) ? row.items : JSON.parse(row.items || '[]');
        const byName = new Map(items.map((it) => [String(it.name || '').trim().toLowerCase(), it]));
        const wanted = Array.isArray(req.body?.items) ? req.body.items : null;
        if (!wanted || !wanted.length) {
            return res.status(422).json({ ok: false, error: 'ITEMS_REQUIRED', message: 'أرسل الأصناف بالكميات الجديدة' });
        }
        for (const w of wanted) {
            const key = String(w.name || '').trim().toLowerCase();
            const target = byName.get(key);
            if (!target) {
                return res.status(422).json({ ok: false, error: 'UNKNOWN_ITEM', message: `الصنف غير موجود في الطلب: ${w.name || '؟'} — أنشئ طلبًا جديدًا لإضافته` });
            }
            const q = Number(w.qty ?? w.quantity);
            if (!Number.isFinite(q) || q <= 0 || q > 100000) {
                return res.status(422).json({ ok: false, error: 'INVALID_QTY', message: `كمية غير صالحة للصنف ${target.name}` });
            }
            target.qty = Math.round(q * 1000) / 1000;
            if (w.unit !== undefined && w.unit !== null && String(w.unit).trim()) {
                target.unit = String(w.unit).trim().slice(0, 20);
            }
        }
        const upd = await pool.query(
            `UPDATE veg_requests SET items = $2::jsonb, items_count = $3, updated_at = NOW(),
                notes = COALESCE(notes,'') || $4 WHERE id = $1 RETURNING *`,
            [id, JSON.stringify(items), items.length,
                ` [تعديل كميات ${new Date().toISOString().slice(0, 16).replace('T', ' ')} بواسطة ${cleanText(req.user.name || req.user.username, 60)}]`]
        );
        logger.info('[veg-requests] تعديل كميات طلب', { id, by: req.user.username });
        try { if (req.io) { req.io.emit('veg_request:update', { id, action: 'items_edited' }); } } catch (_) {}
        return res.json({ ok: true, request: upd.rows[0] });
    } catch (e) { next(e); }
});

// ─── إلغاء (صاحب الطلب قبل الاستلام، أو admin/owner) ─────────────────────────

router.post('/:id/cancel', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        await ensureSchema();
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(422).json({ ok: false, error: 'ID_INVALID', message: 'معرّف طلب غير سليم' });
        }
        const row = (await pool.query('SELECT * FROM veg_requests WHERE id = $1', [id])).rows[0];
        if (!row) {return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'الطلب غير موجود' });}
        if (row.status !== 'pending') {
            return res.status(409).json({ ok: false, error: 'NOT_PENDING', message: 'لا يمكن إلغاء طلب تم استلامه أو إلغاؤه' });
        }
        const isBoss = ['admin', 'owner'].includes(req.user.role);
        if (!isBoss && row.created_by !== req.user.id) {
            return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'إلغاء الطلب متاح لصاحبه أو للإدارة فقط' });
        }
        const reason = cleanText(req.body?.reason, 200) || null;
        const upd = await pool.query(
            `UPDATE veg_requests
              SET status = 'cancelled', cancelled_by = $2, cancelled_by_name = $3,
                  cancelled_reason = $4, updated_at = NOW()
              WHERE id = $1 RETURNING *`,
            [id, req.user.id, cleanText(req.user.name || req.user.username, 120), reason]
        );
        logger.info('[veg-requests] إلغاء طلب', { request_no: row.request_no, by: req.user.username });
        try { if (req.io) { req.io.emit('veg_request:update', { id, status: 'cancelled' }); } } catch (_) {}
        return res.json({ ok: true, request: upd.rows[0] });
    } catch (e) { next(e); }
});

// ─── عدّاد الطباعة (الطرفان يطبعان) ──────────────────────────────────────────

router.post('/:id/printed', jwtAuth, requireRole(...READ_ROLES), async (req, res, next) => {
    try {
        await ensureSchema();
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(422).json({ ok: false, error: 'ID_INVALID', message: 'معرّف طلب غير سليم' });
        }
        const upd = await pool.query(
            'UPDATE veg_requests SET print_count = print_count + 1, updated_at = NOW() WHERE id = $1 RETURNING print_count',
            [id]
        );
        if (!upd.rows.length) {return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'الطلب غير موجود' });}
        return res.json({ ok: true, print_count: upd.rows[0].print_count });
    } catch (e) { next(e); }
});

// أدوات نقية للاختبار (لا تُستخدم في المسار) — المصدر: veg-requests-logic.js
router._internals = { cleanText, validateItems, UNITS, VEG_CATALOG };

module.exports = router;
