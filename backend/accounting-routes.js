/**
 * accounting-routes.js — قسم المحاسبة: شجرة الحسابات + قيود مزدوجة + ترحيل تلقائي
 * ────────────────────────────────────────────────────────────────────────────
 * /api/accounting
 *   GET  /chart                 شجرة الحسابات              (admin/accountant/manager/auditor)
 *   POST /chart                 حساب جديد                  (admin/accountant)
 *   GET  /trial-balance         ميزان المراجعة              (admin/accountant/manager/auditor)
 *   GET  /journal               دفتر القيود                 (admin/accountant/manager/auditor)
 *   POST /journal               قيد يدوي متوازن            (admin/accountant)
 *   POST /post-payroll          ترحيل رواتب شهر             (admin/accountant)
 *   GET  /cfo-summary           ملخص المدير المالي          (admin/accountant/manager)
 *
 * ضمانات: كل قيد متوازن (مدين=دائن ±0.01)، الحسابات موجودة ونشطة وقابلة
 * للترحيل، والترحيل التلقائي idempotent بمفتاح (source_type, source_id) —
 * إعادة التشغيل لا تكرر أبدًا. أخطاء الترحيل لا تُسقط البيع أبدًا.
 */

'use strict';

const express = require('express');
const { pool } = require('./shared-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');

const router = express.Router();
const READ_ROLES = ['admin', 'accountant', 'manager', 'auditor'];
const WRITE_ROLES = ['admin', 'accountant'];

const uid = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** ترقيم قيد يومي متسلسل — بالأقصى لا بالعدّ (الفجوات من حذف/إبطال لا تكسره) */
async function nextEntryNo(client) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
    const mx = (await client.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(entry_no FROM 'JE-[0-9]{8}-([0-9]+)') AS int)), 0)::int AS m
         FROM journal_entries WHERE entry_no LIKE $1`, [`JE-${day}-%`])).rows[0].m;
    for (let n = mx + 1; n <= mx + 10; n++) {
        const no = `JE-${day}-${String(n).padStart(4, '0')}`;
        const clash = await client.query('SELECT 1 FROM journal_entries WHERE entry_no = $1 LIMIT 1', [no]);
        if (!clash.rows[0]) {return no;}
    }
    return `JE-${Date.now()}`;
}

/**
 * ترحيل قيد متوازن — يستخدم نفس الاتصال (معاملة المتصل) أو المسبح.
 * يُرجع { entry, replay:true } عند وجود نفس المصدر مسبقًا (لا ازدواج).
 */
async function postJournal(db, { date, memo, source_type = 'manual', source_id = null, lines, created_by = null }) {
    const day = String(date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {throw Object.assign(new Error('تاريخ القيد غير صالح (YYYY-MM-DD)'), { statusCode: 422 });}
    const clean = (Array.isArray(lines) ? lines : [])
        .map(l => ({
            account_code: String(l.account_code || '').trim(),
            debit: round2(l.debit),
            credit: round2(l.credit),
            memo: l.memo != null ? String(l.memo).slice(0, 255) : null,
        }))
        .filter(l => l.account_code && (l.debit > 0 || l.credit > 0));
    if (clean.length < 2) {throw Object.assign(new Error('القيد يحتاج سطرين على الأقل بمبالغ موجبة'), { statusCode: 422 });}
    for (const l of clean) {
        if (l.debit > 0 && l.credit > 0) {throw Object.assign(new Error(`السطر ${l.account_code}: مدين أو دائن فقط`), { statusCode: 422 });}
    }
    const dr = round2(clean.reduce((s, l) => s + l.debit, 0));
    const cr = round2(clean.reduce((s, l) => s + l.credit, 0));
    if (Math.abs(dr - cr) > 0.01) {throw Object.assign(new Error(`القيد غير متوازن: مدين ${dr} ≠ دائن ${cr}`), { statusCode: 422 });}
    const codes = [...new Set(clean.map(l => l.account_code))];
    const acc = await db.query(
        `SELECT code FROM chart_of_accounts WHERE code = ANY($1) AND is_active = true AND is_postable = true`, [codes]);
    const ok = new Set(acc.rows.map(r => r.code));
    const bad = codes.filter(c => !ok.has(c));
    if (bad.length) {throw Object.assign(new Error(`حسابات غير صالحة للترحيل: ${bad.join('، ')}`), { statusCode: 422 });}

    // معرّف المصدر الفعّال: اليدوي بلا مرجع يأخذ مرجعًا فريدًا دائمًا (لا يمنع القيود اليدوية)
    let effSourceId = source_id != null && String(source_id).trim() !== '' ? String(source_id) : null;
    if (effSourceId == null) {effSourceId = `manual:${Date.now()}:${Math.floor(Math.random() * 1000000)}`;}

    const findExisting = async () => (await db.query(
        `SELECT * FROM journal_entries WHERE source_type = $1 AND source_id = $2 LIMIT 1`,
        [source_type, effSourceId])).rows[0] || null;

    // فحص مسبق خارج المعاملة (التحقق داخل معاملة مُجهضة مستحيل في PostgreSQL)
    const pre = await findExisting();
    if (pre && source_id != null && String(source_id).trim() !== '') {return { entry: pre, replay: true };}

    for (let attempt = 0; attempt < 3; attempt++) {
        const doRun = async (client) => {
            const entryNo = await nextEntryNo(client);
            const e = (await client.query(
                `INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, created_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
                [uid(), entryNo, day, memo ? String(memo).slice(0, 500) : null, source_type, effSourceId, created_by]
            )).rows[0];
            for (const l of clean) {
                await client.query(
                    `INSERT INTO journal_lines (id, entry_id, account_code, debit, credit, memo)
                     VALUES ($1,$2,$3,$4,$5,$6)`,
                    [uid() + Math.floor(Math.random() * 999), e.id, l.account_code, l.debit, l.credit, l.memo]
                );
            }
            return { entry: e, lines: clean, replay: false };
        };
        // سباق الترقيم يُعاد، سباق المصدر يُرجع الموجود
        if (db.query && !db.release) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                try {
                    const out = await doRun(client);
                    await client.query('COMMIT');
                    return out;
                } catch (err) {
                    await client.query('ROLLBACK').catch(() => {});
                    if (err.code === '23505') {
                        const dup = await findExisting();
                        if (dup) {return { entry: dup, replay: true };}
                    }
                    if (err.code === '23505' && attempt < 2) {continue;}
                    throw err;
                }
            } finally { client.release(); }
        }
        try {
            return await doRun(db);
        } catch (err) {
            if (err.code === '23505') {
                const dup = await findExisting().catch(() => null);
                if (dup) {return { entry: dup, replay: true };}
            }
            if (err.code === '23505' && attempt < 2) {continue;}
            throw err;
        }
    }
    throw Object.assign(new Error('تعذر ترحيل القيد بعد عدة محاولات'), { statusCode: 500 });
}

/** ترحيل فاتورة كاشير: نقدية/بنك ← إيراد + ضريبة (idempotent برقم الفاتورة) */
async function postSaleToLedger(orderId) {
    const o = (await pool.query(
        `SELECT id, subtotal, discount_total, tax_total, total_amount, created_at FROM pos_orders WHERE id = $1 LIMIT 1`,
        [orderId])).rows[0];
    if (!o) {return { skipped: 'order_not_found' };}
    const pays = (await pool.query(
        `SELECT method, amount FROM pos_invoice_payments WHERE order_id = $1`, [orderId])).rows;
    const total = round2(o.total_amount);
    const tax = round2(o.tax_total);
    const revenue = round2(total - tax);
    if (total <= 0) {return { skipped: 'zero_total' };}
    const lines = [];
    if (pays.length) {
        for (const p of pays) {
            const amt = round2(p.amount);
            if (amt <= 0) {continue;}
            lines.push({
                account_code: String(p.method).toLowerCase() === 'cash' ? '1000' : '1010',
                debit: amt, credit: 0, memo: `تحصيل ${p.method}`,
            });
        }
    } else {
        lines.push({ account_code: '1000', debit: total, credit: 0, memo: 'تحصيل نقدي' });
    }
    if (revenue > 0) {lines.push({ account_code: '4000', debit: 0, credit: revenue, memo: `مبيعات فاتورة #${orderId}` });}
    if (tax > 0) {lines.push({ account_code: '2100', debit: 0, credit: tax, memo: `ضريبة فاتورة #${orderId}` });}
    const day = new Date(o.created_at || Date.now()).toISOString().slice(0, 10);
    const out = await postJournal(pool, {
        date: day,
        memo: `مبيعات كاشير — فاتورة #${orderId}`,
        source_type: 'pos_sale',
        source_id: String(orderId),
        lines,
    });
    logger.info(`[LEDGER] فاتورة #${orderId}: ${out.replay ? 'مُرحّلة مسبقًا' : `قيد ${out.entry.entry_no}`}`);
    return out;
}

/**
 * ترحيل فاتورة شراء: مخزون (صافي) + ضريبة مدخلات مستردة ← ذمم موردين (إجمالي).
 * Dr 1200 Inventory (net) · Dr 1150 Input VAT (vat) · Cr 2000 AP (gross).
 * idempotent بمفتاح (purchase_invoice, invoiceId) — إعادة التشغيل لا تكرر أبدًا.
 * يُستدعى best-effort بعد COMMIT الفاتورة — فشله لا يُسقط الشراء أبدًا.
 */
async function postPurchaseToLedger(invoiceId) {
    const inv = (await pool.query(
        `SELECT id, "invoiceNumber", date, subtotal_net, vat_total, "totalAmount"
          FROM "purchaseInvoices" WHERE id = $1 LIMIT 1`,
        [invoiceId])).rows[0];
    if (!inv) {return { skipped: 'invoice_not_found' };}
    const net = round2(inv.subtotal_net ?? inv.totalAmount);
    const vat = round2(inv.vat_total ?? 0);
    const gross = round2(inv.totalAmount);
    if (gross <= 0) {return { skipped: 'zero_total' };}
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(inv.date || '').slice(0, 10))
        ? String(inv.date).slice(0, 10)
        : new Date().toISOString().slice(0, 10);
    const lines = [
        { account_code: '1200', debit: net, credit: 0, memo: `مخزون فاتورة شراء ${inv.invoiceNumber || invoiceId}` },
    ];
    if (vat > 0) {lines.push({ account_code: '1150', debit: vat, credit: 0, memo: `ضريبة مدخلات ${inv.invoiceNumber || invoiceId}` });}
    lines.push({ account_code: '2000', debit: 0, credit: gross, memo: `مستحق مورد ${inv.invoiceNumber || invoiceId}` });
    const out = await postJournal(pool, {
        date: day,
        memo: `فاتورة شراء — ${inv.invoiceNumber || invoiceId}`,
        source_type: 'purchase_invoice',
        source_id: String(invoiceId),
        lines,
    });
    logger.info(`[LEDGER] فاتورة شراء ${invoiceId}: ${out.replay ? 'مُرحّلة مسبقًا' : `قيد ${out.entry.entry_no}`}`);
    return out;
}

/**
 * إصلاح خطأ محاسبي كان قائمًا: الصرف للأقسام والإرجاع منها يحرّكان المخزون
 * (1200) والمصاريف دون أي قيد — فحساب المخزون يتضخم ولا COGS في الأستاذ.
 * الحركات المتماثلة (نقية، قابلة للاختبار):
 *   صرف OUT: Dr 5000 تكلفة بضاعة ← Cr 1200 مخزون (بمتوسط التكلفة المرجح)
 *   إرجاع IN: Dr 1200 مخزون ← Cr 5000 تكلفة بضاعة (عكس متماثل)
 */
function buildStockMoveLines(totalValue, direction) {
    const v = round2(totalValue);
    if (!(v > 0)) {return [];}
    if (direction === 'in') {
        return [
            { account_code: '1200', debit: v, credit: 0, memo: 'إرجاع مخزون' },
            { account_code: '5000', debit: 0, credit: v, memo: 'عكس تكلفة' },
        ];
    }
    return [
        { account_code: '5000', debit: v, credit: 0, memo: 'تكلفة صرف' },
        { account_code: '1200', debit: 0, credit: v, memo: 'صرف مخزون' },
    ];
}

/** ترحيل صرف معتمد: idempotent بمفتاح (dispatch, id) — best-effort بعد COMMIT. */
async function postDispatchToLedger(dispatchId, { totalValue, date, deptCode } = {}) {
    const v = round2(totalValue);
    if (!(v > 0)) {return { skipped: 'zero_total' };}
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '').slice(0, 10))
        ? String(date).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const out = await postJournal(pool, {
        date: day,
        memo: `صرف مخزون — إذن #${dispatchId}${deptCode ? ` (${deptCode})` : ''}`,
        source_type: 'dispatch',
        source_id: String(dispatchId),
        lines: buildStockMoveLines(v, 'out'),
    });
    logger.info(`[LEDGER] صرف #${dispatchId}: ${out.replay ? 'مُرحّل مسبقًا' : `قيد ${out.entry.entry_no}`}`);
    return out;
}

/** ترحيل إرجاع معتمد (عكس متماثل): idempotent بمفتاح (kitchen_return, id). */
async function postReturnToLedger(returnId, { totalValue, date, deptCode } = {}) {
    const v = round2(totalValue);
    if (!(v > 0)) {return { skipped: 'zero_total' };}
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '').slice(0, 10))
        ? String(date).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const out = await postJournal(pool, {
        date: day,
        memo: `إرجاع مخزون — مرتجع #${returnId}${deptCode ? ` (${deptCode})` : ''}`,
        source_type: 'kitchen_return',
        source_id: String(returnId),
        lines: buildStockMoveLines(v, 'in'),
    });
    logger.info(`[LEDGER] مرتجع #${returnId}: ${out.replay ? 'مُرحّل مسبقًا' : `قيد ${out.entry.entry_no}`}`);
    return out;
}

// ─── الإقرار الضريبي (قراءة فقط): ضريبة المخرجات − ضريبة المدخلات ───────────
// مصادر من الأستاذ العام المرحّل فعليًا (2100 دائن − 1150 مدين) مع مطابقة
// متقاطعة من فواتير الشراء — ما يُقدَّم للهيئة يُبنى على المرحّل لا التقديري.
router.get('/vat-return', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const dayRe = /^\d{4}-\d{2}-\d{2}$/;
        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const from = dayRe.test(String(req.query.from || '')) ? String(req.query.from) : monthStart;
        const to = dayRe.test(String(req.query.to || '')) ? String(req.query.to) : now.toISOString().slice(0, 10);
        if (from > to) {return res.status(422).json({ error: 'LEDGER_PERIOD_INVALID', message: 'بداية الفترة بعد نهايتها' });}
        const posted = await pool.query(
            `SELECT l.account_code,
                    ROUND(COALESCE(SUM(l.debit),0),2)::float AS debit,
                    ROUND(COALESCE(SUM(l.credit),0),2)::float AS credit
             FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
             WHERE e.date >= $1::date AND e.date <= $2::date AND l.account_code IN ('1150','2100')
             GROUP BY 1`, [from, to]);
        const byCode = {};
        for (const r of posted.rows) {byCode[r.account_code] = r;}
        const outputVat = round2(byCode['2100']?.credit || 0); // ضريبة محصلة (مبيعات)
        const inputVat = round2(byCode['1150']?.debit || 0);   // ضريبة مستردة (مشتريات)
        const net = round2(outputVat - inputVat);
        const purchases = (await pool.query(
            `SELECT COUNT(*)::int AS n, COALESCE(ROUND(SUM(subtotal_net),2),0)::float AS net,
                    COALESCE(ROUND(SUM(vat_total),2),0)::float AS vat
             FROM "purchaseInvoices" WHERE date >= $1 AND date <= $2`, [from, to])).rows[0];
        res.json({
            from, to,
            output_vat: outputVat,
            input_vat: inputVat,
            net_payable: net >= 0 ? net : 0,
            carry_forward_credit: net < 0 ? round2(-net) : 0,
            purchases_crosscheck: { count: Number(purchases.n), net: Number(purchases.net), vat: Number(purchases.vat) },
        });
    } catch (error) {
        logger.error('[ledger/vat-return]', error);
        res.status(500).json({ error: 'LEDGER_VAT_RETURN_FAILED', message: 'تعذر حساب الإقرار الضريبي' });
    }
});

// ─── شجرة الحسابات ───────────────────────────────────────────────────────────
router.get('/chart', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT code, name_ar, name_en, type, parent_code, is_postable, is_active
             FROM chart_of_accounts ORDER BY code`);
        res.json(rows);
    } catch (error) {
        logger.error('[ledger/chart]', error);
        res.status(500).json({ error: 'LEDGER_CHART_FAILED', message: 'تعذر جلب شجرة الحسابات' });
    }
});

router.post('/chart', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const code = String(req.body?.code || '').trim().slice(0, 20);
        const name_ar = String(req.body?.name_ar || '').trim().slice(0, 255);
        const name_en = req.body?.name_en ? String(req.body.name_en).trim().slice(0, 255) : null;
        const type = String(req.body?.type || '').trim();
        const parent_code = req.body?.parent_code ? String(req.body.parent_code).trim().slice(0, 20) : null;
        if (!code || !name_ar) {return res.status(422).json({ error: 'LEDGER_ACCOUNT_INVALID', message: 'الكود والاسم العربي مطلوبان' });}
        if (!['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'].includes(type)) {
            return res.status(422).json({ error: 'LEDGER_TYPE_INVALID', message: 'نوع الحساب غير صالح' });
        }
        if (parent_code) {
            const p = await pool.query('SELECT code, type FROM chart_of_accounts WHERE code = $1 LIMIT 1', [parent_code]);
            if (!p.rows[0]) {return res.status(422).json({ error: 'LEDGER_PARENT_NOT_FOUND', message: 'الحساب الأب غير موجود' });}
            if (p.rows[0].type !== type) {return res.status(422).json({ error: 'LEDGER_PARENT_TYPE', message: 'نوع الأب يجب أن يطابق نوع الحساب' });}
        }
        const { rows } = await pool.query(
            `INSERT INTO chart_of_accounts (id, code, name_ar, name_en, type, parent_code, is_postable)
             VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,true)) RETURNING *`,
            [uid(), code, name_ar, name_en, type, parent_code, req.body?.is_postable]);
        res.status(201).json(rows[0]);
    } catch (error) {
        if (error.code === '23505') {return res.status(409).json({ error: 'LEDGER_CODE_EXISTS', message: 'كود الحساب موجود بالفعل' });}
        logger.error('[ledger/chart:create]', error);
        res.status(500).json({ error: 'LEDGER_ACCOUNT_CREATE_FAILED', message: 'تعذر إنشاء الحساب' });
    }
});

// ─── ميزان المراجعة ──────────────────────────────────────────────────────────
router.get('/trial-balance', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const from = String(req.query.from || '2000-01-01').slice(0, 10);
        const to = String(req.query.to || '2100-12-31').slice(0, 10);
        const { rows } = await pool.query(
            `SELECT c.code, c.name_ar, c.name_en, c.type,
                    COALESCE(SUM(l.debit),0)::numeric(14,2) AS debit,
                    COALESCE(SUM(l.credit),0)::numeric(14,2) AS credit
             FROM chart_of_accounts c
             LEFT JOIN journal_lines l ON l.account_code = c.code
                 AND EXISTS (SELECT 1 FROM journal_entries e
                             WHERE e.id = l.entry_id AND e.status = 'posted'
                               AND e.date >= $1 AND e.date <= $2)
             GROUP BY c.code, c.name_ar, c.name_en, c.type
             ORDER BY c.code`, [from, to]);
        const tDr = round2(rows.reduce((s, r) => s + Number(r.debit), 0));
        const tCr = round2(rows.reduce((s, r) => s + Number(r.credit), 0));
        res.json({ from, to, accounts: rows, total_debit: tDr, total_credit: tCr, balanced: Math.abs(tDr - tCr) < 0.01 });
    } catch (error) {
        logger.error('[ledger/trial-balance]', error);
        res.status(500).json({ error: 'LEDGER_TB_FAILED', message: 'تعذر حساب ميزان المراجعة' });
    }
});

// ─── دفتر القيود ─────────────────────────────────────────────────────────────
router.get('/journal', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
        const { rows } = await pool.query(
            `SELECT e.*, u.username AS created_by_name,
                    COALESCE(json_agg(json_build_object('account_code', l.account_code, 'debit', l.debit, 'credit', l.credit, 'memo', l.memo)
                ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
             FROM journal_entries e
             LEFT JOIN journal_lines l ON l.entry_id = e.id
             LEFT JOIN users u ON u.id = e.created_by
             GROUP BY e.id, u.username ORDER BY e.date DESC, e.id DESC LIMIT $1`, [limit]);
        res.json(rows);
    } catch (error) {
        logger.error('[ledger/journal]', error);
        res.status(500).json({ error: 'LEDGER_JOURNAL_FAILED', message: 'تعذر جلب القيود' });
    }
});

router.post('/journal', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const out = await postJournal(pool, {
            date: req.body?.date,
            memo: req.body?.memo,
            source_type: 'manual',
            source_id: req.body?.source_id || null,
            lines: req.body?.lines,
            created_by: req.user?.id || null,
        });
        if (out.replay) {return res.status(409).json({ error: 'LEDGER_DUPLICATE', message: 'قيد بنفس المرجع موجود مسبقًا', entry: out.entry });}
        res.status(201).json({ entry: out.entry, lines: out.lines });
    } catch (error) {
        const code = error.statusCode || 500;
        res.status(code).json({ error: code === 422 ? 'LEDGER_ENTRY_INVALID' : 'LEDGER_ENTRY_FAILED', message: error.message });
    }
});

// ─── إلغاء قيد (يُبقي الأثر للمراجعة — يُستبعد من الميزان) ────────────────────
router.post('/journal/:id/void', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {return res.status(422).json({ error: 'LEDGER_ID_INVALID', message: 'معرف القيد غير صالح' });}
        const { rows } = await pool.query(
            `UPDATE journal_entries SET status = 'void' WHERE id = $1 AND status = 'posted' RETURNING *`, [id]);
        if (!rows[0]) {return res.status(404).json({ error: 'LEDGER_ENTRY_NOT_FOUND', message: 'القيد غير موجود أو ملغي مسبقًا' });}
        logger.info(`[LEDGER] أُلغي القيد ${rows[0].entry_no} بواسطة ${req.user.username}`);
        if (req.io) {req.io.emit('entity_changed', { entity: 'journal', action: 'update', data: rows[0], changedBy: req.user.username });}
        res.json({ ok: true, entry: rows[0] });
    } catch (error) {
        logger.error('[ledger/void]', error);
        res.status(500).json({ error: 'LEDGER_VOID_FAILED', message: 'تعذر إلغاء القيد' });
    }
});

// ─── ترحيل رواتب شهر ─────────────────────────────────────────────────────────
router.post('/post-payroll', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const month = String(req.body?.month || '').trim();
        if (!/^\d{4}-\d{2}$/.test(month)) {return res.status(422).json({ error: 'LEDGER_MONTH_INVALID', message: 'الشهر بصيغة YYYY-MM' });}
        const total = (await pool.query(
            `SELECT COALESCE(SUM("netSalary"),0)::numeric(14,2) AS t, COUNT(*)::int AS n FROM payroll
             WHERE ("month" = $1 OR ("year" || '-' || LPAD("month"::text,2,'0')) = $1) AND status <> 'cancelled'`,
            [month])).rows[0];
        if (!total || Number(total.t) <= 0) {return res.status(422).json({ error: 'LEDGER_PAYROLL_EMPTY', message: 'لا رواتب مستحقة لهذا الشهر' });}
        const out = await postJournal(pool, {
            date: `${month}-28`,
            memo: `ترحيل رواتب شهر ${month} (${total.n} موظف)`,
            source_type: 'payroll',
            source_id: month,
            lines: [
                { account_code: '6000', debit: Number(total.t), credit: 0, memo: `رواتب ${month}` },
                { account_code: '2200', debit: 0, credit: Number(total.t), memo: `رواتب مستحقة ${month}` },
            ],
            created_by: req.user?.id || null,
        });
        if (out.replay) {return res.status(409).json({ error: 'LEDGER_DUPLICATE', message: `رواتب ${month} مُرحّلة مسبقًا`, entry: out.entry });}
        res.status(201).json({ entry: out.entry, total: Number(total.t), count: Number(total.n) });
    } catch (error) {
        const code = error.statusCode || 500;
        res.status(code).json({ error: 'LEDGER_PAYROLL_FAILED', message: error.message });
    }
});

// ─── ملخص المدير المالي ──────────────────────────────────────────────────────
router.get('/cfo-summary', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const from = String(req.query.from || new Date().toISOString().slice(0, 8) + '01').slice(0, 10);
        const to = String(req.query.to || new Date().toISOString().slice(0, 10)).slice(0, 10);
        const q = async (sql, p) => (await pool.query(sql, p)).rows[0];
        const rev = await q(`SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS t, COUNT(*)::int AS n FROM revenues WHERE date >= $1 AND date <= $2 AND "deptId" != 'ys_b4_ext'`, [from, to]);
        const exp = await q(`SELECT COALESCE(SUM(amount),0)::numeric(14,2) AS t, COUNT(*)::int AS n FROM expenses
            WHERE date >= $1 AND date <= $2 AND COALESCE("adjustmentType",'') NOT IN ('dispatch','dispatch_return','transfer','receipt','stock_transfer','inventory_transfer','kitchen_return','count_correction')`, [from, to]);
        const pay = await q(`SELECT COALESCE(SUM("netSalary"),0)::numeric(14,2) AS t FROM payroll WHERE status <> 'cancelled'`, []);
        const pos = await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total_amount),0)::numeric(14,2) AS t FROM pos_orders WHERE status = 'issued' AND created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')`, [from, to]);
        const cash = await q(`SELECT COALESCE(SUM(CASE WHEN l.account_code IN ('1000','1010') THEN l.debit - l.credit ELSE 0 END),0)::numeric(14,2) AS t
            FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'`, []);
        const topExp = (await pool.query(
            `SELECT COALESCE(category,'أخرى') AS category, COALESCE(SUM(amount),0)::numeric(14,2) AS total
             FROM expenses WHERE date >= $1 AND date <= $2 GROUP BY 1 ORDER BY total DESC LIMIT 5`, [from, to])).rows;
        const byDept = (await pool.query(
            `SELECT "deptId" AS code, COALESCE(SUM(amount),0)::numeric(14,2) AS total FROM revenues
             WHERE date >= $1 AND date <= $2 AND "deptId" != 'ys_b4_ext' GROUP BY 1 ORDER BY total DESC LIMIT 8`, [from, to])).rows;
        const journal = await q(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE status = 'posted'`, []);
        res.json({
            from, to,
            revenue: { total: Number(rev.t), count: Number(rev.n) },
            expenses: { total: Number(exp.t), count: Number(exp.n) },
            payroll_open: Number(pay.t),
            pos: { invoices: Number(pos.n), total: Number(pos.t) },
            cash_position: Number(cash.t),
            journal_entries: Number(journal.n),
            net_approx: round2(Number(rev.t) - Number(exp.t) - Number(pay.t)),
            top_expense_categories: topExp.map(r => ({ category: r.category, total: Number(r.total) })),
            revenue_by_dept: byDept.map(r => ({ code: r.code, total: Number(r.total) })),
        });
    } catch (error) {
        logger.error('[ledger/cfo-summary]', error);
        res.status(500).json({ error: 'LEDGER_CFO_FAILED', message: 'تعذر حساب ملخص المدير المالي' });
    }
});

module.exports = { router, postJournal, postSaleToLedger, postPurchaseToLedger, postDispatchToLedger, postReturnToLedger, buildStockMoveLines };
