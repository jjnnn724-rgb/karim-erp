// ─────────────────────────────────────────────────────────────────────────────
// procurement-routes.js — مركز المشتريات والموردين
// ─────────────────────────────────────────────────────────────────────────────
// دورة حياة المطعم الكاملة: شراء من مورد (فاتورة) → استلام مخزني عبر الليدجر
// (في warehouse-routes) → صرف للأقسام = كلفة قسم → جرد. هذا الملف يضيف النصف
// المالي: دليل الموردين، أرصدتهم المستحقة، الدفعات، وكشف الحساب القابل للطباعة.
//
// قواعد الرصيد (مصدر واحد للحقيقة):
//   رصيد المورد المستحق = الرصيد الافتتاحي + إجمالي فواتيره − إجمالي دفعاته
//   حالة الفاتورة      = paid (مسدد ≥ الإجمالي) | partial (0 < مسدد < إجمالي)
//                        | unpaid (مسدد = 0) — إجمالي ≤ 0 يعد مدفوعة (لا مستحق)
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const { pool } = require('./shared-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');

const router = express.Router();

const READ_ROLES = ['admin', 'manager', 'warehouse', 'accountant'];
const SUPPLIER_WRITE_ROLES = ['admin', 'manager', 'warehouse'];
const PAYMENT_WRITE_ROLES = ['admin', 'manager', 'accountant'];
const PAYMENT_DELETE_ROLES = ['admin'];

const PAYMENT_METHODS = new Set(['cash', 'bank', 'card', 'cheque']);
const INVOICE_PAYMENT_STATUSES = new Set(['paid', 'partial', 'unpaid']);
const PAYMENT_METHOD_LABELS = {
    cash: 'نقدي', bank: 'تحويل بنكي', card: 'بطاقة', cheque: 'شيك', credit: 'آجل',
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^[0-9+\-\s()]{0,30}$/;

// ─── Pure helpers (مصدَّرة للاختبارات) ────────────────────────────────────────

function roundMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {return 0;}
    return Math.round(n * 100) / 100;
}

function computeInvoicePaymentStatus(totalAmount, paidAmount) {
    const total = roundMoney(totalAmount);
    const paid = roundMoney(paidAmount);
    if (total <= 0) {return 'paid';}
    if (paid <= 0) {return 'unpaid';}
    if (paid >= total) {return 'paid';}
    return 'partial';
}

function computeSupplierBalance(openingBalance, invoicesTotal, paymentsTotal) {
    return roundMoney(roundMoney(openingBalance) + roundMoney(invoicesTotal) - roundMoney(paymentsTotal));
}

function normalizeDay(value) {
    if (value == null) {return '';}
    const raw = value instanceof Date ? value.toISOString() : String(value);
    return DATE_RE.test(raw.slice(0, 10)) ? raw.slice(0, 10) : '';
}

/**
 * كشف حساب مورد: رصيد افتتاحي للفترة + حركات مُرتبة زمنيًا برصيد جارٍ.
 * الفواتير مدين (تزيد المستحق) والدفعات دائن (تخفضه). الحركات السابقة لبداية
 * الفترة تُطوى داخل الرصيد الافتتاحي حتى يظل الرصيد الجاري صادقًا.
 */
function buildStatementRows(openingBalance, invoices, payments, fromDate, toDate) {
    const from = normalizeDay(fromDate);
    const to = normalizeDay(toDate);
    const invs = (Array.isArray(invoices) ? invoices : []).map(row => ({
        kind: 'invoice',
        id: row.id,
        date: normalizeDay(row.date),
        ref: row.invoiceNumber || `#${row.id}`,
        description: `فاتورة شراء ${row.invoiceNumber || '#' + row.id}`,
        debit: roundMoney(row.totalAmount),
        credit: 0,
        order: 0,
    })).filter(r => r.date);
    const pays = (Array.isArray(payments) ? payments : []).map(row => ({
        kind: 'payment',
        id: row.id,
        date: normalizeDay(row.date),
        ref: row.method ? (PAYMENT_METHOD_LABELS[row.method] || row.method) : 'دفعة',
        description: `دفعة ${PAYMENT_METHOD_LABELS[row.method] || row.method || ''}`.trim() + (row.invoiceId ? ' — تسديد فاتورة' : ''),
        debit: 0,
        credit: roundMoney(row.amount),
        order: 1,
    })).filter(r => r.date);
    const inPeriod = r => (!from || r.date >= from) && (!to || r.date <= to);
    const beforePeriod = r => (from && r.date < from);
    let opening = roundMoney(openingBalance);
    if (from) {
        for (const r of invs) {if (beforePeriod(r)) {opening = roundMoney(opening + r.debit);}}
        for (const r of pays) {if (beforePeriod(r)) {opening = roundMoney(opening - r.credit);}}
    }
    const rows = [...invs, ...pays].filter(inPeriod)
        .sort((a, b) => (a.date === b.date
            ? (a.order - b.order || a.id - b.id)
            : (a.date < b.date ? -1 : 1)));
    let running = opening;
    let totalDebit = 0;
    let totalCredit = 0;
    const out = rows.map(r => {
        running = roundMoney(running + r.debit - r.credit);
        totalDebit = roundMoney(totalDebit + r.debit);
        totalCredit = roundMoney(totalCredit + r.credit);
        return {
            type: r.kind, id: r.id, date: r.date, ref: r.ref,
            description: r.description, debit: r.debit, credit: r.credit, balance: running,
        };
    });
    return { openingBalance: opening, rows: out, totals: { debit: totalDebit, credit: totalCredit, closing: running } };
}

/** تحقق حمولة المورد — يعيد {ok, errors[], clean} بدون لمس قاعدة البيانات */
function validateSupplierPayload(body, { isUpdate = false } = {}) {
    const errors = [];
    const clean = {};
    const b = body && typeof body === 'object' ? body : {};
    const name = String(b.name ?? '').trim();
    if (name || !isUpdate) {
        if (name.length < 2 || name.length > 120) {errors.push('اسم المورد مطلوب (2-120 حرفًا)');}
        else {clean.name = name;}
    }
    const phone = String(b.phone ?? '').trim();
    if (phone) {
        if (!PHONE_RE.test(phone)) {errors.push('رقم الهاتف غير صحيح');}
        else {clean.phone = phone;}
    }
    const category = String(b.category ?? '').trim();
    if (category) {
        if (category.length > 60) {errors.push('نوع التوريد طويل جدًا');}
        else {clean.category = category;}
    }
    const address = String(b.address ?? '').trim();
    if (address) {
        if (address.length > 200) {errors.push('العنوان طويل جدًا');}
        else {clean.address = address;}
    }
    const notes = String(b.notes ?? '').trim();
    if (notes) {
        if (notes.length > 500) {errors.push('الملاحظات طويلة جدًا');}
        else {clean.notes = notes;}
    }
    if (b.openingBalance !== undefined && b.openingBalance !== null && b.openingBalance !== '') {
        const opening = Number(b.openingBalance);
        if (!Number.isFinite(opening) || opening < 0) {errors.push('الرصيد الافتتاحي يجب أن يكون رقمًا غير سالب');}
        else {clean.openingBalance = roundMoney(opening);}
    }
    if (b.is_active !== undefined) {clean.is_active = Boolean(b.is_active);}
    return { ok: errors.length === 0, errors, clean };
}

/** تحقق حمولة الدفعة — يعيد {ok, errors[], clean} */
function validatePaymentPayload(body) {
    const errors = [];
    const clean = {};
    const b = body && typeof body === 'object' ? body : {};
    const supplierId = Number(b.supplierId);
    if (!Number.isInteger(supplierId) || supplierId <= 0) {errors.push('المورد مطلوب');}
    else {clean.supplierId = supplierId;}
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) {errors.push('قيمة الدفعة يجب أن تكون رقمًا أكبر من صفر');}
    else {clean.amount = roundMoney(amount);}
    const method = String(b.method || 'cash').trim();
    if (!PAYMENT_METHODS.has(method)) {errors.push('طريقة الدفع غير معروفة');}
    else {clean.method = method;}
    const date = normalizeDay(b.date);
    if (!date) {errors.push('تاريخ الدفعة مطلوب بصيغة YYYY-MM-DD');}
    else {clean.date = date;}
    if (b.invoiceId !== undefined && b.invoiceId !== null && b.invoiceId !== '') {
        const invoiceId = Number(b.invoiceId);
        if (!Number.isInteger(invoiceId) || invoiceId <= 0) {errors.push('رقم الفاتورة المرتبطة غير صحيح');}
        else {clean.invoiceId = invoiceId;}
    }
    const notes = String(b.notes ?? '').trim();
    if (notes) {
        if (notes.length > 300) {errors.push('ملاحظات الدفعة طويلة جدًا');}
        else {clean.notes = notes;}
    }
    return { ok: errors.length === 0, errors, clean };
}

// ─── أدوات عامة ──────────────────────────────────────────────────────────────

function id() {
    return Date.now() + Math.floor(Math.random() * 9999);
}
function fail(res, status, error, message, extra = {}) {
    return res.status(status).json({ error, message, ...extra });
}
function emit(req, entity, action, data, entityName) {
    if (!req.io) {return;}
    req.io.emit('entity_changed', {
        entity,
        entityName: entityName || 'المشتريات والموردين',
        action,
        data,
        changedBy: req.headers['x-device-name'] || req.ip,
        changedAt: new Date().toISOString(),
    });
}

// ─── مخطط ذاتي الترقية (idempotent) ─────────────────────────────────────────

async function ensureProcurementSchema() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS suppliers (
            id BIGINT PRIMARY KEY,
            name TEXT NOT NULL,
            phone TEXT,
            category TEXT,
            address TEXT,
            notes TEXT,
            "openingBalance" NUMERIC(12,2) NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
            "updatedAt" TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS supplier_payments (
            id BIGINT PRIMARY KEY,
            "supplierId" BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
            amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
            method VARCHAR(30) NOT NULL DEFAULT 'cash',
            date VARCHAR(50) NOT NULL,
            "invoiceId" BIGINT,
            notes TEXT,
            "createdBy" VARCHAR(100),
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT supplier_payments_method_chk CHECK (method IN ('cash','bank','card','cheque'))
        );
        CREATE INDEX IF NOT EXISTS supplier_payments_supplier_idx ON supplier_payments("supplierId");
        CREATE INDEX IF NOT EXISTS supplier_payments_invoice_idx ON supplier_payments("invoiceId");
        CREATE UNIQUE INDEX IF NOT EXISTS suppliers_active_name_uniq ON suppliers (lower(name)) WHERE is_active;
        ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS "supplierId" BIGINT;
        ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS "paidAmount" NUMERIC(12,2);
        ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS "paymentStatus" VARCHAR(20);
        CREATE INDEX IF NOT EXISTS purchase_invoices_supplier_idx ON "purchaseInvoices"("supplierId");
        CREATE INDEX IF NOT EXISTS purchase_invoices_status_idx ON "purchaseInvoices"("paymentStatus");
    `);
    // ترقية الفواتير القديمة: استنتاج المسدد والحالة من طريقة الدفع
    await pool.query(`
        UPDATE "purchaseInvoices"
           SET "paidAmount" = COALESCE("paidAmount",
                CASE WHEN COALESCE("paymentMethod",'cash') IN ('cash','bank','card') THEN COALESCE("totalAmount",0) ELSE 0 END)
         WHERE "paidAmount" IS NULL;
        UPDATE "purchaseInvoices"
           SET "paymentStatus" = CASE
                WHEN COALESCE("paidAmount",0) <= 0 THEN 'unpaid'
                WHEN COALESCE("paidAmount",0) >= COALESCE("totalAmount",0) THEN 'paid'
                ELSE 'partial' END
         WHERE "paymentStatus" IS NULL;
    `);
    // تحويل أسماء الموردين النصية القديمة إلى دليل موردون وربطها
    await pool.query(`
        WITH missing AS (
            SELECT DISTINCT ON (norm) norm AS name FROM (
                SELECT lower(trim(p."supplierName")) AS norm, trim(p."supplierName") AS raw
                FROM "purchaseInvoices" p
                WHERE p."supplierName" IS NOT NULL AND trim(p."supplierName") <> ''
            ) t
            WHERE NOT EXISTS (SELECT 1 FROM suppliers s WHERE lower(s.name) = t.norm)
        )
        INSERT INTO suppliers (id, name, "createdAt")
        SELECT (-ROW_NUMBER() OVER (ORDER BY name))::bigint, name, now() FROM missing;
        UPDATE "purchaseInvoices" p SET "supplierId" = s.id
        FROM suppliers s
        WHERE p."supplierId" IS NULL AND lower(trim(COALESCE(p."supplierName",''))) = lower(s.name);
    `);
}

// ─── ملخص المركز ─────────────────────────────────────────────────────────────

router.get('/summary', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const s = (await pool.query(`
            SELECT
              (SELECT COUNT(*)::int FROM suppliers WHERE is_active) AS "activeSuppliers",
              (SELECT COUNT(*)::int FROM suppliers) AS "totalSuppliers",
              (SELECT COALESCE(SUM("totalAmount"),0) FROM "purchaseInvoices" WHERE "supplierId" IS NOT NULL) AS "purchasesTotal",
              (SELECT COALESCE(SUM(amount),0) FROM supplier_payments) AS "paymentsTotal",
              (SELECT COALESCE(SUM("openingBalance"),0) FROM suppliers) AS "openingTotal",
              (SELECT COUNT(*)::int FROM "purchaseInvoices" WHERE "supplierId" IS NOT NULL AND COALESCE("paymentStatus",'unpaid') <> 'paid') AS "unpaidInvoices",
              (SELECT COALESCE(SUM(COALESCE("totalAmount",0) - COALESCE("paidAmount",0)),0) FROM "purchaseInvoices" WHERE "supplierId" IS NOT NULL) AS "invoicesRemaining"
        `)).rows[0];
        const dueTotal = roundMoney(Number(s.openingTotal) + Number(s.purchasesTotal) - Number(s.paymentsTotal));
        res.json({
            activeSuppliers: Number(s.activeSuppliers),
            totalSuppliers: Number(s.totalSuppliers),
            purchasesTotal: roundMoney(s.purchasesTotal),
            paymentsTotal: roundMoney(s.paymentsTotal),
            dueTotal,
            unpaidInvoices: Number(s.unpaidInvoices),
            invoicesRemaining: roundMoney(s.invoicesRemaining),
        });
    } catch (error) {
        logger.error('[procurement_summary]', error);
        fail(res, 500, 'PROCUREMENT_SUMMARY_FAILED', 'تعذر تحميل ملخص المشتريات');
    }
});

// ─── الموردون ────────────────────────────────────────────────────────────────

router.get('/suppliers', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const rows = (await pool.query(`
            SELECT s.*,
              COALESCE(i.total,0)   AS "purchasesTotal",
              COALESCE(i.cnt,0)     AS "invoiceCount",
              COALESCE(i.inv_paid,0) AS "invoicesPaidTotal",
              COALESCE(p.paid,0)    AS "paymentsTotal",
              COALESCE(i.last_date, NULL) AS "lastPurchaseDate",
              COALESCE(s."openingBalance",0) + COALESCE(i.total,0) - COALESCE(p.paid,0) AS "dueTotal"
            FROM suppliers s
            LEFT JOIN (
                SELECT "supplierId" sid, SUM(COALESCE("totalAmount",0)) total, COUNT(*) cnt,
                       SUM(COALESCE("paidAmount",0)) inv_paid, MAX(date) last_date
                FROM "purchaseInvoices" WHERE "supplierId" IS NOT NULL GROUP BY 1
            ) i ON i.sid = s.id
            LEFT JOIN (
                SELECT "supplierId" sid, SUM(amount) paid
                FROM supplier_payments GROUP BY 1
            ) p ON p.sid = s.id
            ORDER BY s.is_active DESC, lower(s.name) ASC
        `)).rows.map(r => ({
            ...r,
            openingBalance: roundMoney(r.openingBalance),
            purchasesTotal: roundMoney(r.purchasesTotal),
            invoiceCount: Number(r.invoiceCount),
            invoicesPaidTotal: roundMoney(r.invoicesPaidTotal),
            paymentsTotal: roundMoney(r.paymentsTotal),
            dueTotal: roundMoney(r.dueTotal),
        }));
        res.json(rows);
    } catch (error) {
        logger.error('[procurement_suppliers_list]', error);
        fail(res, 500, 'SUPPLIERS_LIST_FAILED', 'تعذر تحميل دليل الموردين');
    }
});

router.post('/suppliers', jwtAuth, requireRole(...SUPPLIER_WRITE_ROLES), async (req, res) => {
    const v = validateSupplierPayload(req.body);
    if (!v.ok) {return fail(res, 422, 'INVALID_SUPPLIER', v.errors.join(' — '));}
    const client = await pool.connect();
    try {
        const dup = await client.query('SELECT id FROM suppliers WHERE lower(name)=lower($1) LIMIT 1', [v.clean.name]);
        if (dup.rows.length) {return fail(res, 409, 'SUPPLIER_DUPLICATE', `المورد «${v.clean.name}» مسجل بالفعل`);}
        const row = (await client.query(
            `INSERT INTO suppliers (id, name, phone, category, address, notes, "openingBalance", is_active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING *`,
            [id(), v.clean.name, v.clean.phone || null, v.clean.category || null,
                v.clean.address || null, v.clean.notes || null, v.clean.openingBalance ?? 0]
        )).rows[0];
        emit(req, 'procurement', 'create', row);
        res.status(201).json(row);
    } catch (error) {
        logger.error('[procurement_supplier_create]', error);
        fail(res, 500, 'SUPPLIER_CREATE_FAILED', 'تعذر حفظ المورد');
    } finally {
        client.release();
    }
});

router.put('/suppliers/:id', jwtAuth, requireRole(...SUPPLIER_WRITE_ROLES), async (req, res) => {
    const supplierId = Number(req.params.id);
    if (!Number.isInteger(supplierId)) {return fail(res, 422, 'INVALID_SUPPLIER_ID', 'معرف المورد غير صحيح');}
    const v = validateSupplierPayload(req.body, { isUpdate: true });
    if (!v.ok) {return fail(res, 422, 'INVALID_SUPPLIER', v.errors.join(' — '));}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cur = (await client.query('SELECT * FROM suppliers WHERE id=$1 FOR UPDATE', [supplierId])).rows[0];
        if (!cur) { await client.query('ROLLBACK'); return fail(res, 404, 'SUPPLIER_NOT_FOUND', 'المورد غير موجود'); }
        if (v.clean.name) {
            const dup = (await client.query(
                'SELECT id FROM suppliers WHERE lower(name)=lower($1) AND id<>$2 LIMIT 1',
                [v.clean.name, supplierId])).rows[0];
            if (dup) { await client.query('ROLLBACK'); return fail(res, 409, 'SUPPLIER_DUPLICATE', `الاسم «${v.clean.name}» مستخدم بمورد آخر`); }
        }
        const next = {
            name: v.clean.name ?? cur.name,
            phone: 'phone' in v.clean ? v.clean.phone : cur.phone,
            category: 'category' in v.clean ? v.clean.category : cur.category,
            address: 'address' in v.clean ? v.clean.address : cur.address,
            notes: 'notes' in v.clean ? v.clean.notes : cur.notes,
            openingBalance: 'openingBalance' in v.clean ? v.clean.openingBalance : cur.openingBalance,
            is_active: 'is_active' in v.clean ? v.clean.is_active : cur.is_active,
        };
        const row = (await client.query(
            `UPDATE suppliers SET name=$2, phone=$3, category=$4, address=$5, notes=$6,
                    "openingBalance"=$7, is_active=$8, "updatedAt"=now()
             WHERE id=$1 RETURNING *`,
            [supplierId, next.name, next.phone, next.category, next.address, next.notes,
                next.openingBalance, next.is_active]
        )).rows[0];
        await client.query('COMMIT');
        emit(req, 'procurement', 'update', row);
        res.json(row);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[procurement_supplier_update]', error);
        fail(res, 500, 'SUPPLIER_UPDATE_FAILED', 'تعذر تحديث المورد');
    } finally {
        client.release();
    }
});

router.post('/suppliers/:id/toggle', jwtAuth, requireRole(...SUPPLIER_WRITE_ROLES), async (req, res) => {
    const supplierId = Number(req.params.id);
    if (!Number.isInteger(supplierId)) {return fail(res, 422, 'INVALID_SUPPLIER_ID', 'معرف المورد غير صحيح');}
    try {
        const row = (await pool.query(
            'UPDATE suppliers SET is_active = NOT is_active, "updatedAt"=now() WHERE id=$1 RETURNING *',
            [supplierId])).rows[0];
        if (!row) {return fail(res, 404, 'SUPPLIER_NOT_FOUND', 'المورد غير موجود');}
        emit(req, 'procurement', 'update', row);
        res.json(row);
    } catch (error) {
        logger.error('[procurement_supplier_toggle]', error);
        fail(res, 500, 'SUPPLIER_TOGGLE_FAILED', 'تعذر تغيير حالة المورد');
    }
});

router.delete('/suppliers/:id', jwtAuth, requireRole(...SUPPLIER_WRITE_ROLES), async (req, res) => {
    const supplierId = Number(req.params.id);
    if (!Number.isInteger(supplierId)) {return fail(res, 422, 'INVALID_SUPPLIER_ID', 'معرف المورد غير صحيح');}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cur = (await client.query('SELECT id, name FROM suppliers WHERE id=$1 FOR UPDATE', [supplierId])).rows[0];
        if (!cur) { await client.query('ROLLBACK'); return fail(res, 404, 'SUPPLIER_NOT_FOUND', 'المورد غير موجود'); }
        const invoices = Number((await client.query(
            'SELECT COUNT(*)::int AS c FROM "purchaseInvoices" WHERE "supplierId"=$1', [supplierId])).rows[0].c);
        const payments = Number((await client.query(
            'SELECT COUNT(*)::int AS c FROM supplier_payments WHERE "supplierId"=$1', [supplierId])).rows[0].c);
        if (invoices > 0 || payments > 0) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'SUPPLIER_HAS_TRANSACTIONS',
                `لا يمكن حذف «${cur.name}»: له ${invoices} فاتورة و${payments} دفعة. يمكنك تعطيله بدلًا من الحذف.`,
                { invoices, payments });
        }
        await client.query('DELETE FROM suppliers WHERE id=$1', [supplierId]);
        await client.query('COMMIT');
        emit(req, 'procurement', 'delete', { id: supplierId, name: cur.name });
        res.json({ ok: true, deleted: supplierId });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[procurement_supplier_delete]', error);
        fail(res, 500, 'SUPPLIER_DELETE_FAILED', 'تعذر حذف المورد');
    } finally {
        client.release();
    }
});

// ─── كشف حساب مورد ───────────────────────────────────────────────────────────

router.get('/suppliers/:id/statement', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    const supplierId = Number(req.params.id);
    if (!Number.isInteger(supplierId)) {return fail(res, 422, 'INVALID_SUPPLIER_ID', 'معرف المورد غير صحيح');}
    try {
        const supplier = (await pool.query('SELECT * FROM suppliers WHERE id=$1', [supplierId])).rows[0];
        if (!supplier) {return fail(res, 404, 'SUPPLIER_NOT_FOUND', 'المورد غير موجود');}
        const invoices = (await pool.query(
            `SELECT id, "invoiceNumber", date, COALESCE("totalAmount",0) AS "totalAmount", COALESCE("paidAmount",0) AS "paidAmount"
             FROM "purchaseInvoices" WHERE "supplierId"=$1`, [supplierId])).rows;
        const payments = (await pool.query(
            `SELECT id, amount, method, date, "invoiceId", notes
             FROM supplier_payments WHERE "supplierId"=$1`, [supplierId])).rows;
        const statement = buildStatementRows(supplier.openingBalance, invoices, payments, req.query.from, req.query.to);
        res.json({ supplier, statement });
    } catch (error) {
        logger.error('[procurement_statement]', error);
        fail(res, 500, 'STATEMENT_FAILED', 'تعذر توليد كشف الحساب');
    }
});

// ─── الدفعات ─────────────────────────────────────────────────────────────────

router.get('/payments', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const clauses = [];
        const params = [];
        if (req.query.supplierId) { params.push(Number(req.query.supplierId)); clauses.push(`p."supplierId"=$${params.length}`); }
        if (req.query.from && DATE_RE.test(String(req.query.from))) { params.push(req.query.from); clauses.push(`p.date>=$${params.length}`); }
        if (req.query.to && DATE_RE.test(String(req.query.to))) { params.push(req.query.to); clauses.push(`p.date<=$${params.length}`); }
        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        const rows = (await pool.query(`
            SELECT p.*, s.name AS "supplierName"
            FROM supplier_payments p LEFT JOIN suppliers s ON s.id = p."supplierId"
            ${where}
            ORDER BY p.date DESC, p.id DESC LIMIT 500
        `, params)).rows.map(r => ({ ...r, amount: roundMoney(r.amount) }));
        res.json(rows);
    } catch (error) {
        logger.error('[procurement_payments_list]', error);
        fail(res, 500, 'PAYMENTS_LIST_FAILED', 'تعذر تحميل الدفعات');
    }
});

/** تسجيل دفعة — ذريًا: قفل المورد، رفض دفعات على مورد موقوف أو فوق المتبقي */
router.post('/payments', jwtAuth, requireRole(...PAYMENT_WRITE_ROLES), async (req, res) => {
    const v = validatePaymentPayload(req.body);
    if (!v.ok) {return fail(res, 422, 'INVALID_PAYMENT', v.errors.join(' — '));}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const supplier = (await client.query('SELECT * FROM suppliers WHERE id=$1 FOR UPDATE', [v.clean.supplierId])).rows[0];
        if (!supplier) { await client.query('ROLLBACK'); return fail(res, 404, 'SUPPLIER_NOT_FOUND', 'المورد غير موجود'); }
        if (!supplier.is_active) { await client.query('ROLLBACK'); return fail(res, 409, 'SUPPLIER_INACTIVE', 'المورد موقوف — فعّله قبل تسجيل الدفعات'); }
        let invoice = null;
        if (v.clean.invoiceId) {
            invoice = (await client.query('SELECT * FROM "purchaseInvoices" WHERE id=$1 FOR UPDATE', [v.clean.invoiceId])).rows[0];
            if (!invoice) { await client.query('ROLLBACK'); return fail(res, 404, 'INVOICE_NOT_FOUND', 'الفاتورة غير موجودة'); }
            if (Number(invoice.supplierId) !== v.clean.supplierId) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVOICE_SUPPLIER_MISMATCH', 'الفاتورة المحددة لا تنتمي لهذا المورد');
            }
            const remaining = roundMoney(Number(invoice.totalAmount) - Number(invoice.paidAmount || 0));
            if (remaining <= 0) { await client.query('ROLLBACK'); return fail(res, 409, 'INVOICE_ALREADY_PAID', 'الفاتورة مسددة بالكامل'); }
            if (v.clean.amount > remaining) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'AMOUNT_EXCEEDS_REMAINING', `الدفعة أكبر من المتبقي على الفاتورة (${remaining})`, { remaining });
            }
        }
        const paymentId = id();
        const payment = (await client.query(
            `INSERT INTO supplier_payments (id, "supplierId", amount, method, date, "invoiceId", notes, "createdBy")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [paymentId, v.clean.supplierId, v.clean.amount, v.clean.method, v.clean.date,
                v.clean.invoiceId || null, v.clean.notes || null, req.user?.username || String(req.user?.id || '')]
        )).rows[0];
        if (invoice) {
            const paid = roundMoney(Number(invoice.paidAmount || 0) + v.clean.amount);
            const status = computeInvoicePaymentStatus(invoice.totalAmount, paid);
            invoice = (await client.query(
                `UPDATE "purchaseInvoices" SET "paidAmount"=$2, "paymentStatus"=$3 WHERE id=$1 RETURNING *`,
                [invoice.id, paid, status])).rows[0];
        }
        await client.query('COMMIT');
        emit(req, 'procurement', 'create', payment);
        if (invoice) {emit(req, 'purchaseInvoices', 'update', invoice, 'فواتير الشراء');}
        const totals = (await pool.query(`
            SELECT
              COALESCE((SELECT COALESCE("openingBalance",0) FROM suppliers WHERE id=$1),0)
              + COALESCE((SELECT SUM(COALESCE("totalAmount",0)) FROM "purchaseInvoices" WHERE "supplierId"=$1),0)
              - COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE "supplierId"=$1),0) AS due
        `, [v.clean.supplierId])).rows[0];
        res.status(201).json({ payment, invoice, supplierDueTotal: roundMoney(totals.due) });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[procurement_payment_create]', error);
        fail(res, 500, 'PAYMENT_CREATE_FAILED', 'تعذر تسجيل الدفعة');
    } finally {
        client.release();
    }
});

/** تسديد فاتورة بالكامل (المتبقي كله) — بوابة مريحة فوق POST /payments */
router.post('/invoices/:id/pay', jwtAuth, requireRole(...PAYMENT_WRITE_ROLES), async (req, res) => {
    const invoiceId = Number(req.params.id);
    if (!Number.isInteger(invoiceId)) {return fail(res, 422, 'INVALID_INVOICE_ID', 'معرف الفاتورة غير صحيح');}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const invoice = (await client.query('SELECT * FROM "purchaseInvoices" WHERE id=$1 FOR UPDATE', [invoiceId])).rows[0];
        if (!invoice) { await client.query('ROLLBACK'); return fail(res, 404, 'INVOICE_NOT_FOUND', 'الفاتورة غير موجودة'); }
        if (!invoice.supplierId) { await client.query('ROLLBACK'); return fail(res, 422, 'INVOICE_HAS_NO_SUPPLIER', 'الفاتورة غير مرتبطة بمورد — اربطها أولاً'); }
        const remaining = roundMoney(Number(invoice.totalAmount) - Number(invoice.paidAmount || 0));
        if (remaining <= 0) { await client.query('ROLLBACK'); return fail(res, 409, 'INVOICE_ALREADY_PAID', 'الفاتورة مسددة بالكامل'); }
        const supplier = (await client.query('SELECT * FROM suppliers WHERE id=$1 FOR UPDATE', [invoice.supplierId])).rows[0];
        if (!supplier) { await client.query('ROLLBACK'); return fail(res, 404, 'SUPPLIER_NOT_FOUND', 'مورد الفاتورة غير موجود'); }
        if (!supplier.is_active) { await client.query('ROLLBACK'); return fail(res, 409, 'SUPPLIER_INACTIVE', 'المورد موقوف — فعّله قبل التسديد'); }
        const method = PAYMENT_METHODS.has(String(req.body?.method)) ? String(req.body.method) : 'cash';
        const date = DATE_RE.test(String(req.body?.date || '')) ? String(req.body.date) : new Date().toISOString().slice(0, 10);
        const paymentId = id();
        const payment = (await client.query(
            `INSERT INTO supplier_payments (id, "supplierId", amount, method, date, "invoiceId", notes, "createdBy")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [paymentId, supplier.id, remaining, method, date, invoice.id,
                req.body?.notes || `تسديد كامل للفاتورة ${invoice.invoiceNumber || invoice.id}`,
                req.user?.username || String(req.user?.id || '')]
        )).rows[0];
        const updatedInvoice = (await client.query(
            `UPDATE "purchaseInvoices" SET "paidAmount"=$2, "paymentStatus"='paid' WHERE id=$1 RETURNING *`,
            [invoice.id, roundMoney(Number(invoice.totalAmount))])).rows[0];
        await client.query('COMMIT');
        emit(req, 'procurement', 'create', payment);
        emit(req, 'purchaseInvoices', 'update', updatedInvoice, 'فواتير الشراء');
        res.status(201).json({ payment, invoice: updatedInvoice });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[procurement_invoice_pay]', error);
        fail(res, 500, 'INVOICE_PAY_FAILED', 'تعذر تسديد الفاتورة');
    } finally {
        client.release();
    }
});

/** حذف/عكس دفعة (مدير النظام فقط) — يعيد حساب مسدد الفاتورة المرتبطة */
router.delete('/payments/:id', jwtAuth, requireRole(...PAYMENT_DELETE_ROLES), async (req, res) => {
    const paymentId = Number(req.params.id);
    if (!Number.isInteger(paymentId)) {return fail(res, 422, 'INVALID_PAYMENT_ID', 'معرف الدفعة غير صحيح');}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const payment = (await client.query('SELECT * FROM supplier_payments WHERE id=$1 FOR UPDATE', [paymentId])).rows[0];
        if (!payment) { await client.query('ROLLBACK'); return fail(res, 404, 'PAYMENT_NOT_FOUND', 'الدفعة غير موجودة'); }
        await client.query('DELETE FROM supplier_payments WHERE id=$1', [paymentId]);
        let invoice = null;
        if (payment.invoiceId) {
            invoice = (await client.query('SELECT * FROM "purchaseInvoices" WHERE id=$1 FOR UPDATE', [payment.invoiceId])).rows[0];
            if (invoice) {
                const paid = Math.max(0, roundMoney(Number(invoice.paidAmount || 0) - Number(payment.amount)));
                const status = computeInvoicePaymentStatus(invoice.totalAmount, paid);
                invoice = (await client.query(
                    `UPDATE "purchaseInvoices" SET "paidAmount"=$2, "paymentStatus"=$3 WHERE id=$1 RETURNING *`,
                    [invoice.id, paid, status])).rows[0];
            }
        }
        await client.query('COMMIT');
        emit(req, 'procurement', 'delete', payment);
        if (invoice) {emit(req, 'purchaseInvoices', 'update', invoice, 'فواتير الشراء');}
        res.json({ ok: true, deleted: paymentId, invoice });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[procurement_payment_delete]', error);
        fail(res, 500, 'PAYMENT_DELETE_FAILED', 'تعذر حذف الدفعة');
    } finally {
        client.release();
    }
});

module.exports = {
    router, ensureProcurementSchema,
    // pure helpers (tests / reuse)
    roundMoney, computeInvoicePaymentStatus, computeSupplierBalance,
    buildStatementRows, validateSupplierPayload, validatePaymentPayload,
    PAYMENT_METHODS, INVOICE_PAYMENT_STATUSES, PAYMENT_METHOD_LABELS,
};
