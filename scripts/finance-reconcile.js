#!/usr/bin/env node
// finance-reconcile.js — منسّق مالي: يقارن الجداول التشغيلية بالقيود ويصلح النواقص.
// ROOT FIX 2026-10-02: أي عملية بلا قيد (سقط best-effort وقتها) تُرحَّل هنا
// تلقائيًا — كل المُرحِّلات idempotent بمفاتيح (source_type, source_id) فلا تكرار.
// التشغيل: node scripts/finance-reconcile.js  (قراءة أولاً ثم إصلاح)
'use strict';
const path = require('path');

if (!process.argv.includes('--apply')) {
    console.error('رفض التشغيل دون --apply: هذا السكربت يكتب قيودًا مالية. لاستخدامه اكتب --apply --confirm-write=<DB_NAME>.');
    process.exit(2);
}

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: false });
const dbName = process.env.DB_NAME || 'karim_erp';
const confirmation = process.argv.find((argument) => argument.startsWith('--confirm-write='))
    ?.slice('--confirm-write='.length);
if (confirmation !== dbName) {
    console.error(`رفض الكتابة: أعد التشغيل مع --confirm-write=${dbName} المطابق لاسم قاعدة البيانات المستهدفة.`);
    process.exit(2);
}

const { pool } = require('../backend/shared-pool');
const acct = require('../backend/accounting-routes');
String.fromCharCode(92);

async function expenseJournal(row) {
    const amt = Number(row.amount) || 0;
    if (!(amt > 0)) {return { skipped: 'zero' };}
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || '').slice(0, 10)) ? String(row.date).slice(0, 10) : new Date().toISOString().slice(0, 10);
    return acct.postJournal(pool, {
        date: day,
        memo: `مصروف ${row.category || ''} — ${String(row.notes || '').slice(0, 60)}`.trim(),
        source_type: 'expense', source_id: String(row.id),
        lines: [
            { account_code: '6900', debit: amt, credit: 0, memo: 'مصروف تشغيلي' },
            { account_code: '1000', debit: 0, credit: amt, memo: 'دفع نقدي من الصندوق' },
        ],
    });
}
async function paymentJournal(row, supplierName) {
    const amt = Number(row.amount) || 0;
    if (!(amt > 0)) {return { skipped: 'zero' };}
    const cash = String(row.method).toLowerCase() === 'cash' ? '1000' : '1010';
    return acct.postJournal(pool, {
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || '').slice(0, 10)) ? String(row.date).slice(0, 10) : new Date().toISOString().slice(0, 10),
        memo: `دفعة مورد ${supplierName || row.supplierId} (${row.method})`,
        source_type: 'supplier_payment', source_id: String(row.id),
        lines: [
            { account_code: '2000', debit: amt, credit: 0, memo: 'سداد ذمم' },
            { account_code: cash, debit: 0, credit: amt, memo: 'خروج نقدية' },
        ],
    });
}

(async () => {
    const report = {};
    let failures = 0;
    // 1) مبيعات الكاشير الصادرة بلا قيد
    const missingSales = (await pool.query(`
        SELECT o.id FROM pos_orders o
         WHERE o.status = 'issued' AND o.total_amount > 0
           AND NOT EXISTS (SELECT 1 FROM journal_entries je
                            WHERE je.source_type='pos_sale' AND je.source_id=o.id::text AND je.status='posted')`)).rows;
    let fixed = 0;
    for (const r of missingSales) {
        try {
            await acct.postSaleToLedger(r.id);
            fixed++;
        } catch (e) {
            failures++;
            console.error('sale', r.id, e.message);
        }
    }
    report.pos_sale = { missing: missingSales.length, repaired: fixed };

    // 2) فواتير شراء بلا قيد مُرحَّل (استثناء الملغاة/المحذوفة — أي قيد voided يبقى للمراجعة)
    const missingInv = (await pool.query(`
        SELECT p.id, p."invoiceNumber" FROM "purchaseInvoices" p
         WHERE p."totalAmount" > 0
           AND NOT EXISTS (SELECT 1 FROM journal_entries je
                            WHERE je.source_type='purchase_invoice' AND je.source_id=p.id::text)`)).rows;
    let invFixed = 0;
    for (const r of missingInv) {
        try {
            const poster = String(r.invoiceNumber || '').startsWith('OPEN-') ? acct.postOpeningToLedger : acct.postPurchaseToLedger;
            await poster(r.id); invFixed++;
        } catch (e) {
            failures++;
            console.error('invoice', r.id, e.message);
        }
    }
    report.purchase_invoice = { missing: missingInv.length, repaired: invFixed };

    // 3) مصاريف بلا قيد — صفوف التسويات المخزنية (dispatch/return/correction…)
    // ليست مصروفات نقدية: ترحيلها هنا يُكرّر تكلفة الطلب ويُفرّغ الصندوق
    // (مرجعية التصفية: expense-register-routes/daily-report-service بنفس القائمة).
    const missingExp = (await pool.query(`
        SELECT x.id, x.amount, x.category, x.notes, x.date FROM expenses x
         WHERE x.amount > 0
           AND COALESCE(x."adjustmentType",'') NOT IN ('dispatch','dispatch_return','transfer','receipt','stock_transfer','inventory_transfer','kitchen_return','count_correction')
           AND NOT EXISTS (SELECT 1 FROM journal_entries je
                            WHERE je.source_type='expense' AND je.source_id=x.id::text)`)).rows;
    let expFixed = 0;
    for (const r of missingExp) {
        try {
            await expenseJournal(r);
            expFixed++;
        } catch (e) {
            failures++;
            console.error('expense', r.id, e.message);
        }
    }
    report.expense = { missing: missingExp.length, repaired: expFixed };

    // 4) دفعات موردين بلا قيد
    const missingPay = (await pool.query(`
        SELECT sp.id, sp.amount, sp.method, s.name AS supplier_name FROM supplier_payments sp
         LEFT JOIN suppliers s ON s.id = sp."supplierId"
         WHERE sp.amount > 0
           AND NOT EXISTS (SELECT 1 FROM journal_entries je
                            WHERE je.source_type='supplier_payment' AND je.source_id=sp.id::text)`)).rows;
    let payFixed = 0;
    for (const r of missingPay) {
        try {
            await paymentJournal(r, r.supplier_name);
            payFixed++;
        } catch (e) {
            failures++;
            console.error('payment', r.id, e.message);
        }
    }
    report.supplier_payment = { missing: missingPay.length, repaired: payFixed };

    const totalMissing = Object.values(report).reduce((s, r) => s + r.missing, 0);
    const totalFixed = Object.values(report).reduce((s, r) => s + r.repaired, 0);
    console.log('\n════════ منسّق المالية ════════');
    for (const [k, v] of Object.entries(report)) {console.log(`${k}: ناقص=${v.missing} ← أُصلح=${v.repaired}`);}
    console.log(`الإجمالي: ناقص=${totalMissing} | أُصلح=${totalFixed}`);
    if (failures > 0) {
        process.exitCode = 1;
        console.error(`فشلت معالجة ${failures} عملية؛ راجع السجلات وطابق القيود قبل إعادة التشغيل.`);
    }
})().catch((e) => {
    console.error('فشل المنسّق:', e.message);
    process.exitCode = 1;
}).finally(() => pool.end());
