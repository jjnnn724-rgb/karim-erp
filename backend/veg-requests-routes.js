/**
 * veg-requests-routes.js — طلبات شراء الخضار من المطبخ إلى المخازن (2026-10-04)
 * ────────────────────────────────────────────────────────────────────────────
 * الهدف: صفحة مخصصة للشيف/السو شيف يبني بها طلب خضار من قايمة مصنّفة جاهزة،
 * يرسله للمخازن، ويطبعه الطرفان بنموذج A4 احترافي (توقيعات + رقم طلب).
 *
 * القواعد:
 *   • إنشاء: sous_chef / admin / owner · dept_head بقسم «salads» (رئيس قسم السلطات)
 *   • قراءة: أعلاه + warehouse
 *   • استلام: sous_chef / admin / owner · dept_head بقسم «salads» ← نفس طبقة الإنشاء (من «قيد الانتظار» فقط)
 *   • تسعير: warehouse / admin / owner / manager ← بعد الاستلام — يُحمَّل الإجمالي خزينة المطبخ مصروفًا
 *   • إلغاء: admin/owner لأي حالة (قبل الاستلام فقط لبقية الأدوار)
 *   • حذف نهائي (DELETE /:id): admin/owner فقط — 409 لو للطلب فاتورة مورد أو قيد محاسبي؛ المصروف التلقائي يُحذف في نفس الـ transaction
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

// استلام الطلبية: السو شيف/الإدارة/المالك، أو رئيس السلطات (dept_head · dept_code=salads)،
// أو أي مستخدم مُنح veg.receive صراحةً
const userHasPerm = require('./permissions').userHasPerm;

const isVegReceiveEligible = async (role, deptCode, userId) => {
    const r = String(role || '');
    if (r === 'sous_chef' || r === 'admin' || r === 'owner') {return true;}
    if (r === 'dept_head') {
        const d = String(deptCode || '').toLowerCase().split(',').map((s) => s.trim());
        if (d.includes('salads')) {return true;}
    }
    if (userId == null) {return false;}
    return userHasPerm({ id: Number(userId), role }, 'veg.receive', []);
};

// إنشاء الطلبية: نفس الشرط — الدور، أو تخصص السلطات، أو منح مباشر veg.create
const isVegitCreateEligible = async (role, deptCode, userId) => {
    const r = String(role || '');
    if (r === 'sous_chef' || r === 'admin' || r === 'owner') {return true;}
    if (r === 'dept_head') {
        const d = String(deptCode || '').toLowerCase().split(',').map((s) => s.trim());
        if (d.includes('salads')) {return true;}
    }
    if (userId == null) {return false;}
    return userHasPerm({ id: Number(userId), role }, 'veg.create', []);
};
const vegCreateGate = [jwtAuth, async (req, res, next) => {
    if (await isVegitCreateEligible(req.user?.role, req.user?.dept_code, req.user?.id)) {return next();}
    return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'إنشاء طلبات الخضار متاح للسو شيف والإدارة ورئيس السلطات، أو لمن مُنح صلاحية veg.create من المدير' });
}];

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
                ALTER TABLE veg_requests ADD COLUMN IF NOT EXISTS expense_id BIGINT;
                ALTER TABLE veg_requests ADD COLUMN IF NOT EXISTS invoice_id BIGINT`);
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

router.post('/', ...vegCreateGate, async (req, res, next) => {
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
        // إشعار واتساب للمديرين (نفس مسار تقرير الإدارة: wa_settings أولاً) — أفضل جهد
        try {
            const store = require('./whatsapp-engine/store');
            const nums = await store.managerJids().catch(() => []);
            const jids = nums.slice(0, 5).map((n) => `${String(n).replace(/\D/g, '')}@s.whatsapp.net`).filter((j) => /^\d{7,20}@/.test(j));
            if (jids.length) {
                    const mod = require('./whatsapp-engine');
                    const engine = (typeof mod.getEngine === 'function' ? mod.getEngine() : null)
                        || mod.whatsappEngine || mod.engine || null;
                    const sender = engine && engine.sender ? engine.sender : null;
                    if (sender && typeof sender.enqueue === 'function') {
                        const names = checked.items.slice(0, 8).map((i) => i.name).join('، ');
                        const text = [
                            '🌿 طلبية الخضروات والأعشاب — جديدة',
                            `رقم: ${requestNo}`,
                            `بواسطة: ${saved.created_by_name} (${saved.created_by_role})`,
                            `عدد الأصناف: ${saved.items_count}${checked.items.length > 8 ? ' (وأعلى)' : ''}`,
                            `الأولوية: ${saved.priority === 'urgent' ? 'عاجلة 🔴' : 'عادية'}`,
                            `أصناف: ${names}${checked.items.length > 8 ? ' …' : ''}`,
                            '',
                            'الاستلام والتسعير من صفحة «طلبات خضار» في Karim ERP.',
                        ].join('\n');
                        for (const jid of jids) {
                            sender.enqueue(jid, text, { clientKey: `veg-new:${saved.id}:${jid}` })
                                .catch((err) => logger.warn('[veg-requests] whatsapp failed (non-fatal)', { msg: err && err.message }));
                        }
                        logger.info('[veg-requests] whatsapp notify queued', { request_no: requestNo, targets: jids.length });
                    }
            }
        } catch (_) { /* إشعار أفضل جهد فقط */ }
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
                        total, priced_by_name, priced_at, expense_id, invoice_id, print_count, created_at
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

const receiveGate = [jwtAuth, async (req, res, next) => {
    if (await isVegReceiveEligible(req.user?.role, req.user?.dept_code, req.user?.id)) {return next();}
    return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'الاستلام والتوقيع للسو شيف أو رئيس قسم السلطات أو الإدارة، أو لمن مُنح صلاحية veg.receive من المدير' });
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
        const row0 = (await pool.query('SELECT id, items, request_no, department FROM veg_requests WHERE id = $1', [id])).rows[0];
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
                    if (got > asked) {
                        // تسليم أكبر من المطلوب — تُعتمد كل الكمية في الاستلام والفاتورة
                        // (طلب المالك 2026-11-18)
                        return { ...it, qty: got, spoiledQty: 0, originalQty: asked, extraQty: Math.round((got - asked) * 1000) / 1000 };
                    }
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
            // FIX 2026-10-11: wrap invoice INSERT + guarded UPDATE in a transaction
            // — expense was committing before the UPDATE, so a concurrent receive/cancel
            // left a phantom charge with no matching request status change
            const { createVegInvoice } = require('./veg-invoice');
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const userName = cleanText(req.user.name || req.user.username, 120);
                const inv = await createVegInvoice(client, {
                    requestNo: row0.request_no, requestId: row0.id, items: directApprove.items, user: req.user,
                    pricedByName: userName, department: row0.department,
                });
                upd = await client.query(
                    `UPDATE veg_requests
                      SET status = 'priced', received_by = $2, received_by_name = $3,
                          received_by_dept = $4, received_at = NOW(), updated_at = NOW(),
                          items = $5::jsonb, total = $6,
                          priced_by = $2, priced_by_name = $3, priced_at = NOW(), invoice_id = $7
                      WHERE id = $1 AND status = 'pending'
                      RETURNING *`,
                    [id, req.user.id, userName, cleanText(byDept, 80),
                        JSON.stringify(directApprove.items), directApprove.total, inv.invoiceId]
                );
                if (!upd.rows.length) {
                    // UPDATE matched 0 rows (concurrent receive/cancel) → roll back the invoice
                    await client.query('ROLLBACK');
                    return res.status(409).json({ ok: false, error: 'NOT_PENDING', message: 'الطلب مستلم أو ملغي بالفعل' });
                }
                await client.query('COMMIT');
                // ما بعد الالتزام: ترحيل محاسبي best-effort — مساره مطابق مسار فاتورة الشراء
                try {
                    await require('./accounting-routes').postPurchaseToLedger(inv.invoiceId);
                } catch (ledgerErr) {
                    logger.error('[veg-requests] journal التصريف فشل — لا يؤثر على الاستلام', { err: { message: String(ledgerErr && ledgerErr.message || ledgerErr) } });
                    try {
                        await require('./posting-failures').recordPostingFailure(pool, {
                            module: 'purchases',
                            source_type: 'purchase_invoice',
                            source_id: inv.invoiceId,
                            payload: { invoice_id: inv.invoiceId },
                            error: ledgerErr,
                        });
                    } catch (_) { /* الفشل نفسه لا يُسقط */ }
                }
                // قيد سداد المورد النقدي (2026-11-21): Dr 2000 ذمم / Cr 1000 صندوق —
                // يغلق الدائن الذي كانت الدفعة الآلية تتركه مفتوحًا في الدفتر.
                if (inv.paymentId) {
                    try {
                        const { postJournal } = require('./accounting-routes');
                        const accts = await require('./coa-mapping').resolveAccounts(pool, 'procurement', 'supplier_payment', {
                            payable_account: '2000', cash_account: '1000', bank_account: '1010',
                        });
                        await postJournal(pool, {
                            date: new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10),
                            memo: `سداد مورد الخضار ${inv.supplierName} — فاتورة ${inv.invoiceNumber}`,
                            source_type: 'supplier_payment', source_id: String(inv.paymentId),
                            lines: [
                                { account_code: accts.payable_account, debit: Number(inv.total), credit: 0, memo: `سداد ذمم ${inv.supplierName}` },
                                { account_code: accts.cash_account, debit: 0, credit: Number(inv.total), memo: 'خروج نقدية — دفعة فاتورة خضار' },
                            ],
                        });
                    } catch (payErr) {
                        logger.error('[veg-requests] journal سداد المورد فشل — لا يؤثر على الاستلام', { err: { message: String(payErr && payErr.message || payErr) } });
                        try {
                            await require('./posting-failures').recordPostingFailure(pool, {
                                module: 'procurement',
                                source_type: 'supplier_payment',
                                source_id: String(inv.paymentId),
                                payload: { invoice_id: inv.invoiceId, amount: Number(inv.total) },
                                error: payErr,
                            });
                        } catch (_) { /* الفشل نفسه لا يُسقط */ }
                    }
                }
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
            invoiceId: directApprove ? upd.rows[0].invoice_id : undefined,
        });
        try { if (req.io) { req.io.emit('veg_request:update', { id, status: upd.rows[0].status }); } } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
        return res.json({ ok: true, request: upd.rows[0],
            ...(directApprove ? { invoiceId: upd.rows[0].invoice_id, total: directApprove.total } : {} )});
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
        // الفاتورة هي المصدر الوحيد للسعر: إنشاء فاتورة مورد خضار تلقائيًا
        // مع ترحيل المخزون — لا قيد مصروف إضافي هنا.
        const { createVegInvoice } = require('./veg-invoice');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const userName = cleanText(req.user.name || req.user.username, 120);
            const inv = await createVegInvoice(client, {
                requestNo: row.request_no, requestId: row.id, items: checked.items, user: req.user,
                pricedByName: userName, department: row.department,
            });
            const upd = await client.query(
                `UPDATE veg_requests
                  SET items = $2::jsonb, total = $3, status = 'priced',
                      priced_by = $4, priced_by_name = $5, priced_at = NOW(),
                      invoice_id = $6, updated_at = NOW()
                  WHERE id = $1 AND status = 'received' RETURNING *`,
                [id, JSON.stringify(checked.items), checked.total,
                    req.user.id, userName, inv.invoiceId]
            );
            if (!upd.rows.length) {
                await client.query('ROLLBACK');
                return res.status(409).json({ ok: false, error: 'NOT_RECEIVED', message: 'الطلب لم يعد قابلاً للتسعير — الحالة تغيرت' });
            }
            await client.query('COMMIT');
            // ما بعد الالتزام: ترحيل محاسبي best-effort — مساره مطابق مسار فاتورة الشراء
            try {
                await require('./accounting-routes').postPurchaseToLedger(inv.invoiceId);
            } catch (ledgerErr) {
                logger.error('[veg-requests] journal التصريف فشل — لا يؤثر على الاستلام', { err: { message: String(ledgerErr && ledgerErr.message || ledgerErr) } });
                try {
                    await require('./posting-failures').recordPostingFailure(pool, {
                        module: 'purchases',
                        source_type: 'purchase_invoice',
                        source_id: inv.invoiceId,
                        payload: { invoice_id: inv.invoiceId },
                        error: ledgerErr,
                    });
                } catch (_) { /* الفشل نفسه لا يُسقط */ }
            }
            // قيد سداد المورد النقدي (2026-11-21) — نفس نمط مسار الاستلام
            if (inv.paymentId) {
                try {
                    const { postJournal } = require('./accounting-routes');
                    const accts = await require('./coa-mapping').resolveAccounts(pool, 'procurement', 'supplier_payment', {
                        payable_account: '2000', cash_account: '1000', bank_account: '1010',
                    });
                    await postJournal(pool, {
                        date: new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10),
                        memo: `سداد مورد الخضار ${inv.supplierName} — فاتورة ${inv.invoiceNumber}`,
                        source_type: 'supplier_payment', source_id: String(inv.paymentId),
                        lines: [
                            { account_code: accts.payable_account, debit: Number(inv.total), credit: 0, memo: `سداد ذمم ${inv.supplierName}` },
                            { account_code: accts.cash_account, debit: 0, credit: Number(inv.total), memo: 'خروج نقدية — دفعة فاتورة خضار' },
                        ],
                    });
                } catch (payErr) {
                    logger.error('[veg-requests] journal سداد المورد فشل — لا يؤثر على التسعير', { err: { message: String(payErr && payErr.message || payErr) } });
                    try {
                        await require('./posting-failures').recordPostingFailure(pool, {
                            module: 'procurement',
                            source_type: 'supplier_payment',
                            source_id: String(inv.paymentId),
                            payload: { invoice_id: inv.invoiceId, amount: Number(inv.total) },
                            error: payErr,
                        });
                    } catch (_) { /* الفشل نفسه لا يُسقط */ }
                }
            }
            logger.info('[veg-requests] تسعير طلب + فاتورة مورد خضار تلقائية', {
                request_no: row.request_no, total: checked.total, invoice_id: inv.invoiceId,
            });
            try { if (req.io) { req.io.emit('veg_request:update', { id, status: 'priced' }); } } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
            return res.json({ ok: true, request: upd.rows[0], invoiceId: upd.rows[0].invoice_id, total: checked.total });
        } catch (txnErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txnErr;
        } finally {
            client.release();
        }
    } catch (e) { next(e); }
});

// ─── تحليل الخضار (طلب المالك 2026-11-21): «الطماطم كم كيلو في فترة؟» ──────
// لكل صنف خضار: المستلم من سجل الطلبيات، المستهلك من دفتر المخزون
// (صرف/بيع/توليد/هالك)، والرصيد الحالي ومتوسط التكلفة من جدول المخزون.
router.get('/consumption', jwtAuth, requireRole(...READ_ROLES, 'kitchen', 'manager'), async (req, res, next) => {
    try {
        await ensureSchema();
        const dayRe = /^\d{4}-\d{2}-\d{2}$/;
        const to = dayRe.test(String(req.query.to || '')) ? req.query.to : new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
        const from = dayRe.test(String(req.query.from || '')) ? req.query.from : `${to.slice(0, 8)}01`;
        if (from > to) {return res.status(422).json({ ok: false, error: 'INVALID_RANGE', message: 'الفترة غير سليمة' });}
        if ((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000 > 366) {
            return res.status(422).json({ ok: false, error: 'RANGE_TOO_WIDE', message: 'الحد الأقصى 366 يومًا' });
        }
        const q = cleanText(req.query.q || '', 60);
        const { normName } = require('./veg-invoice');

        // 1) سجل المخزون للأصناف الخضراوية (الرصيد ومتوسط التكلفة)
        const invRows = (await pool.query(
            'SELECT id, name, unit, qty, "avgCost" FROM inventory WHERE category = $1', ['خضار']
        )).rows;
        // 2) المستهلك من دفتر المخزون في الفترة (الدلتا السالبة = خروج)
        const consumedRows = (await pool.query(
            `SELECT inventory_id, SUM(quantity_delta) AS delta, SUM(total_cost) AS cost
             FROM inventory_ledger
             WHERE transaction_type IN ('transfer_out','sale_consumption','production_consumption','waste')
               AND business_date BETWEEN $1 AND $2
             GROUP BY inventory_id`,
            [from, to]
        )).rows;
        const consumedById = new Map(consumedRows.map((r) => [Number(r.inventory_id), r]));
        // 3) المستلم من سجل الطلبيات المسلمة/المعتمدة في الفترة (JS تجميع)
        const reqRows = (await pool.query(
            `SELECT items, department FROM veg_requests
             WHERE status IN ('received','priced')
               AND COALESCE(received_at, created_at)::date BETWEEN $1 AND $2`,
            [from, to]
        )).rows;
        const received = new Map(); // key → { name, unit, qty, value, requests }
        for (const r of reqRows) {
            const items = Array.isArray(r.items) ? r.items : (() => { try { return JSON.parse(r.items || '[]'); } catch (_) { return []; } })();
            for (const it of items) {
                if (it.rejected) {continue;}
                const qty = Number(it.qty) || 0;
                if (qty <= 0) {continue;}
                const key = normName(it.name);
                const cur = received.get(key) || { name: String(it.name || '').trim(), unit: String(it.unit || 'كجم'), qty: 0, value: 0, requests: 0 };
                cur.qty = Math.round((cur.qty + qty) * 1000) / 1000;
                cur.value = Math.round((cur.value + (Number(it.lineTotal) || qty * (Number(it.price) || 0))) * 100) / 100;
                cur.requests += 1;
                if (!cur.name) {cur.name = String(it.name || '').trim();}
                received.set(key, cur);
            }
        }
        // 4) الدمج: أساسه أصناف المخزون الخضراوية + ما استُلم تاريخيًا بلا صنف مخزون
        const merged = new Map();
        for (const inv of invRows) {
            merged.set(normName(inv.name), {
                name: inv.name, unit: inv.unit || 'كجم',
                inventoryId: Number(inv.id), onHand: Number(inv.qty) || 0,
                avgCost: Number(inv.avgCost) || 0,
                receivedQty: 0, receivedValue: 0, requests: 0,
                consumedQty: 0, consumedValue: 0,
            });
        }
        for (const [key, rec] of received) {
            const cur = merged.get(key) || {
                name: rec.name, unit: rec.unit || 'كجم', inventoryId: null,
                onHand: 0, avgCost: 0, receivedQty: 0, receivedValue: 0, requests: 0,
                consumedQty: 0, consumedValue: 0,
            };
            cur.receivedQty = Math.round((cur.receivedQty + rec.qty) * 1000) / 1000;
            cur.receivedValue = Math.round((cur.receivedValue + rec.value) * 100) / 100;
            cur.requests += rec.requests;
            if (rec.unit && cur.unit === 'كجم' && rec.unit !== 'كجم') {cur.unit = rec.unit;}
            merged.set(key, cur);
        }
        for (const [invId, agg] of consumedById) {
            const key = [...merged.entries()].find(([, v]) => v.inventoryId === Number(invId))?.[0];
            if (!key) {continue;}
            const cur = merged.get(key);
            const delta = Number(agg.delta || 0);
            cur.consumedQty = Math.round((cur.consumedQty + (delta < 0 ? -delta : 0)) * 1000) / 1000;
            cur.consumedValue = Math.round((cur.consumedValue + (delta < 0 ? -(Number(agg.cost) || 0) : 0)) * 100) / 100;
        }
        let rows = [...merged.values()].filter((row) => row.receivedQty > 0 || row.consumedQty > 0 || row.onHand > 0);
        if (q) {
            const needle = normName(q);
            rows = rows.filter((row) => normName(row.name).includes(needle));
        }
        rows.sort((a, b) => (b.consumedQty - a.consumedQty) || (b.receivedQty - a.receivedQty) || a.name.localeCompare(b.name, 'ar'));
        const totals = {
            receivedQty: Math.round(rows.reduce((s, r) => s + r.receivedQty, 0) * 1000) / 1000,
            receivedValue: Math.round(rows.reduce((s, r) => s + r.receivedValue, 0) * 100) / 100,
            consumedQty: Math.round(rows.reduce((s, r) => s + r.consumedQty, 0) * 1000) / 1000,
            items: rows.length,
        };
        res.set('Cache-Control', 'no-store');
        return res.json({ ok: true, from, to, rows, totals });
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
        if (row.invoice_id && ['admin', 'owner'].includes(req.user.role)) {
            // الطلب مترحل على فاتورة مورد — تعديل الأصناف هنا بيخلق تعارضًا
            // مع الدفتر (الفاتورة بتحمّل الكميات القديمة). لازم تصحيح الفاتورة
            // من الحسابات أولًا.
            return res.status(409).json({
                ok: false,
                error: 'HAS_INVOICE',
                message: `هذا الطلب له فاتورة مورد مسجلة (رقم ${row.invoice_id}) — تعديل الأصناف بيتعارض مع الدفتر. صحح الفاتورة من الحسابات أولًا.`,
            });
        }
        if (row.status !== 'pending') {
            // الإدمن والمالك يقدرون يعدّلوا أي حالة (طلب المالك 2026-11-18)
            const isAdminSide = ['admin', 'owner'].includes(req.user.role);
            if (!isAdminSide) {
                return res.status(409).json({ ok: false, error: 'NOT_EDITABLE', message: 'التعديل قبل الاعتماد النهائي فقط — الطلب حالته ' + row.status });
            }
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
        try { if (req.io) { req.io.emit('veg_request:update', { id, action: 'items_edited' }); } } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
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
        // الإدمن/المالك يقدرون يلغوا أي حالة (طلب المالك 2026-11-18)؛
        // بقية الأدوار يقدروا يلغوا طلبهم المعلقات فقط.
        const isBoss = ['admin', 'owner'].includes(req.user.role);
        if (row.invoice_id && isBoss) {
            // الطلب له فاتورة مورد مسجلة ومرحلة في الدفتر — الإلغاء هنا هيخلّي
            // الفاتورة بلا طلب، عشان كده لازم إبطال الفاتورة من الحسابات أولًا.
            return res.status(409).json({
                ok: false,
                error: 'HAS_INVOICE',
                message: `هذا الطلب له فاتورة مورد مسجلة (رقم ${row.invoice_id}) ومترحلة في الدفتر — لازم تُبطل الفاتورة من الحسابات أولًا ثم أعد المحاولة.`,
            });
        }
        if (row.status !== 'pending' && !isBoss) {
            return res.status(409).json({ ok: false, error: 'NOT_PENDING', message: 'الاناء متاح للطلبيات المعلقة فقط' });
        }
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
        try { if (req.io) { req.io.emit('veg_request:update', { id, status: 'cancelled' }); } } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
        return res.json({ ok: true, request: upd.rows[0] });
    } catch (e) { next(e); }
});

// ─── حذف نهائي (admin/owner فقط) — بطلب المالك 2026-11-18 ─────────────────────
// الحذف يشيل الطلب من veg_requests نهائيًا. الحماية:
//   • لو للطلب فاتورة مورد مسجلة (invoice_id) ← 409 HAS_INVOICE: تُبطل الفاتورة من الحسابات أولًا.
//   • لو للطلب مصروف مرتبط:
//       — تلقائي مولّد من هذا المسار (autoGenerated + adjustmentType='veg_request') ← يُحذف في نفس الـ transaction.
//       — غير ذلك (يدوي/معدّل) ← 409 EXPENSE_MANUAL: يُراجع يدويًا.
//       — وله قيد في journal_entries (source_type='expense') ← 409 HAS_JOURNAL: يُبطل القيد من الحسابات أولًا.
const DELETE_ROLES = ['admin', 'owner'];
router.delete('/:id', jwtAuth, requireRole(...DELETE_ROLES), async (req, res, next) => {
    try {
        await ensureSchema();
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(422).json({ ok: false, error: 'ID_INVALID', message: 'معرّف طلب غير سليم' });
        }
        const row = (await pool.query(
            'SELECT id, request_no, status, expense_id, invoice_id FROM veg_requests WHERE id = $1',
            [id]
        )).rows[0];
        if (!row) {return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'الطلب غير موجود' });}
        if (row.invoice_id) {
            return res.status(409).json({
                ok: false,
                error: 'HAS_INVOICE',
                message: `هذا الطلب له فاتورة مورد مسجلة (رقم ${row.invoice_id}) ومترحلة في الدفتر — لازم تُبطل الفاتورة من الحسابات أولًا ثم أعد المحاولة.`,
            });
        }
        const client = await pool.connect();
        let expenseDeleted = false;
        let journalBlocked = false;
        try {
            await client.query('BEGIN');
            if (row.expense_id) {
                const exp = await client.query(
                    'SELECT id, "autoGenerated", category, "adjustmentType" FROM expenses WHERE id = $1 FOR UPDATE',
                    [row.expense_id]
                );
                const expense = exp.rows[0];
                if (expense) {
                    const isAutoVeg = expense.autoGenerated === true
                        && (expense.adjustmentType === 'veg_request' || ['خضار', 'veg_request'].includes(String(expense.category)));
                    if (!isAutoVeg) {
                        await client.query('ROLLBACK');
                        return res.status(409).json({ ok: false, error: 'EXPENSE_MANUAL', message: 'المصروف المرتبط بالطلب ليس تلقائيًا — راجعه يدويًا قبل الحذف' });
                    }
                    const jor = await client.query(
                        `SELECT 1 FROM journal_entries WHERE source_type = 'expense' AND source_id = $1 LIMIT 1`,
                        [String(expense.id)]
                    );
                    if (jor.rows.length) {
                        journalBlocked = true;
                    } else {
                        await client.query('DELETE FROM expenses WHERE id = $1', [expense.id]);
                        expenseDeleted = true;
                    }
                }
            }
            if (journalBlocked) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    ok: false,
                    error: 'HAS_JOURNAL',
                    message: 'المصروف المرتبط بالطلب له قيد محاسبي في الدفتر — لازم يُبطل القيد من الحسابات أولًا ثم أعد المحاولة.',
                });
            }
            await client.query('DELETE FROM veg_requests WHERE id = $1', [id]);
            await client.query('COMMIT');
        } catch (txnErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txnErr;
        } finally {
            client.release();
        }
        logger.info('[veg-requests] حُذف الطلب نهائيًا', { request_no: row.request_no, by: req.user.username, expenseDeleted });
        try { if (req.io) { req.io.emit('veg_request:update', { id, status: 'deleted' }); } } catch (_) { /* best-effort: المسار الأساسي تم */ }
        return res.json({ ok: true, id, expenseDeleted });
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
// ─── أرقام واتساب (مورد / مخزن) — إعداد الإدارة ─────────────────────────────
const ADMIN_ROLES = ['admin', 'owner'];
const sanitizeJid = (v) => String(v ?? '').replace(/\D/g, '').slice(0, 15);

router.get('/contacts', jwtAuth, requireRole(...ADMIN_ROLES), async (_req, res, next) => {
    try {
    const store = require('./whatsapp-engine/store');
    const [supplier_jid, warehouse_jid] = await Promise.all([
        store.getSetting('veg_supplier_jid').catch(() => null),
        store.getSetting('veg_warehouse_jid').catch(() => null),
    ]);
    res.json({ supplier_jid: supplier_jid || '', warehouse_jid: warehouse_jid || '' });
    } catch (e) { next(e); }
});

router.put('/contacts', jwtAuth, requireRole(...ADMIN_ROLES), async (req, res, next) => {
    try {
    const body = req.body || {};
    const entries = [];
    for (const [bodyKey, settingKey] of [['supplier_jid', 'veg_supplier_jid'], ['warehouse_jid', 'veg_warehouse_jid']]) {
        if (body[bodyKey] === undefined) {continue;}
        const digits = sanitizeJid(body[bodyKey]);
        if (digits && (digits.length < 7 || digits.length > 13)) {
            return res.status(422).json({ ok: false, error: 'CONTACT_INVALID', message: `الرقم ${digits} غير صالح — استخدم صيغة دولية بدون + أو 00 (مثال: 9665XXXXXXXX)` });
        }
        entries.push([settingKey, digits]);
    }
    if (!entries.length) {
        return res.status(422).json({ ok: false, error: 'NOTHING_TO_UPDATE', message: 'مرّر: supplier_jid أو warehouse_jid' });
    }
    const store = require('./whatsapp-engine/store');
    for (const [key, digits] of entries) {
        await store.setSetting(key, digits);
    }
    logger.info('[veg-requests] أرقام واتساب اتحدّثت', { keys: entries.map(([k]) => k).join(','), by: req.user && req.user.username });
    res.json({ ok: true });
    } catch (e) { next(e); }
});

// ─── إرسال الطلبية على واتساب (للمورد أو للمخزن) ────────────────────────────
const NOTIFY_TARGETS = new Set(['supplier', 'warehouse']);
const STATUS_AR = { received: 'تم الاستلام', priced: 'تم التسعير', pending: 'بانتظار المعالجة', cancelled: 'ملغي' };
const PRIORITY_AR = { urgent: 'عاجلة', normal: 'عادية' };

function buildVegNotifyText(row, target, items) {
    const lines = (Array.isArray(items) ? items : [])
        .slice(0, 40)
        .map((it, i) => `${i + 1}. ${it.name} — ${it.qty ?? '?'} ${it.unit ?? ''}`.trim())
        .join('\n');
    const notesLine = row.notes ? `\nملاحظات: ${String(row.notes).slice(0, 300)}` : '';
    const isSupplier = target === 'supplier';
    const head = isSupplier
        ? '🏪 مطاعم الشرفة العالمي — طلبية الخضروات والأعشاب\nيرجى التحضير والتسليم وفق الموعد المتفق عليه 🤝'
        : '🏬 مخزن المطبخ — طلبية خضار جديدة\nمطلوب منك: استلام الطلبية، الكشف عليها، وتسجيلها في صفحة «طلبات خضار» للاستلام والصرف ✓';
    return [
        head,
        '',
        `📋 رقم الطلب: ${row.request_no || `#${row.id}`}`,
        `🗓 التاريخ: ${String(row.created_at || '').slice(0, 10) || '—'}`,
        `👤 بواسطة: ${row.created_by_name || '—'}${row.created_by_role ? ` (${row.created_by_role})` : ''}`,
        `📦 الأصناف: ${row.items_count} · الأولوية: ${PRIORITY_AR[row.priority] || row.priority} · الحالة: ${STATUS_AR[row.status] || row.status}`,
        '',
        'الأصناف:',
        lines,
        notesLine,
        '',
        '──────────',
        'Sent by Karim ERP · KARIM ERP',
    ].join('\n');
}

router.post('/:id/notify', ...vegCreateGate, async (req, res) => {
    const target = String(req.body?.target || '').trim().toLowerCase();
    if (!NOTIFY_TARGETS.has(target)) {
        return res.status(422).json({ ok: false, error: 'TARGET_INVALID', message: 'الهدف: supplier أو warehouse' });
    }
    try {
        const found = await pool.query(
            `SELECT id, request_no, created_by_name, created_by_role, priority, items, items_count, status, created_at, notes
               FROM veg_requests WHERE id = $1`,
            [req.params.id],
        );
        if (!found.rows.length) {
            return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'الطلب غير موجود' });
        }
        const row = found.rows[0];
        let items = row.items;
        if (typeof items === 'string') {
            try { items = JSON.parse(items); } catch { items = []; }
        }
        const store = require('./whatsapp-engine/store');
        const settingKey = target === 'supplier' ? 'veg_supplier_jid' : 'veg_warehouse_jid';
        const digits = String(await store.getSetting(settingKey).catch(() => '') || '').replace(/\D/g, '');
        if (!digits || digits.length < 7) {
            const label = target === 'supplier' ? 'المورد' : 'المخزن';
            return res.status(422).json({ ok: false, error: 'CONTACT_MISSING', message: `رقم ${label} غير مضاف — أضفه بزر «📞 أرقام واتساب» في الأعلى` });
        }
        const mod = require('./whatsapp-engine');
        const engine = (typeof mod.getEngine === 'function' ? mod.getEngine() : null) || mod.whatsappEngine || mod.engine || null;
        const sender = engine && engine.sender ? engine.sender : null;
        if (!sender || typeof sender.enqueue !== 'function') {
            return res.status(503).json({ ok: false, error: 'WHATSAPP_UNAVAILABLE', message: 'واتساب غير متاح الآن — حاول مرة أخرى' });
        }
        const text = buildVegNotifyText(row, target, items);
        const jidFull = digits.includes('@') ? digits : `${digits}@s.whatsapp.net`;
        await sender.enqueue(jidFull, text, { clientKey: `veg-notify:${row.id}:${target}` });
        try { await store.logEvent('veg_notify', String(row.id), `${target}->${digits}`); } catch (_) { /* أفضل جهد */ }
        logger.info('[veg-requests] رسايل واتساب انزرعوا', { id: row.id, target, by: req.user && req.user.username });
        res.json({ ok: true, sent: 1, target });
    } catch (e) {
        logger.error('[veg-requests] notify failed', { msg: e && e.message });
        res.status(500).json({ ok: false, error: 'SEND_FAILED', message: 'تعذر الإرسال — حاول مرة أخرى' });
    }
});

router._internals = { cleanText, validateItems, UNITS, VEG_CATALOG };

module.exports = router;
