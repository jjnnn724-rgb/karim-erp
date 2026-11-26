/**
 * backend/subledger-service.js — Customer & Supplier Subledger Management
 * ═══════════════════════════════════════════════════════════════════════
 * Handles AR Customer transactions, Delivery Platform settlements, and
 * automated Subledger <-> GL continuous reconciliation.
 */
'use strict';

const { postJournal } = require('./accounting-routes');

function round2(v) {
    return Math.round((Number(v) || 0) * 100) / 100;
}

/**
 * Record customer credit sale / catering invoice into Subledger & General Ledger
 */
async function postCustomerInvoice(pool, { customerId, date, netAmount, vatAmount, referenceNo, memo, costCenter, createdBy }) {
    const net = round2(netAmount);
    const vat = round2(vatAmount);
    const gross = round2(net + vat);

    const cust = (await pool.query('SELECT id, name, control_account_code FROM customers WHERE id = $1', [customerId])).rows[0];
    if (!cust) {
        throw new Error('العميل غير موجود في سجل الحسابات المساعدة');
    }

    const controlAccount = cust.control_account_code || '1300';

    // 1. Post to GL
    const lines = [
        { account_code: controlAccount, debit: gross, credit: 0, memo: `فاتورة عميل (${cust.name}) — ${memo || ''}`, cost_center_code: costCenter },
        { account_code: '4000', debit: 0, credit: net, memo: `مبيعات عميل آجل (${cust.name})`, cost_center_code: costCenter },
    ];
    if (vat > 0) {
        lines.push({ account_code: '2100', debit: 0, credit: vat, memo: `ضريبة مخرجات فاتورة عميل #${referenceNo}`, cost_center_code: costCenter });
    }

    const glResult = await postJournal(pool, {
        date,
        memo: `فاتورة ذمم عميل #${referenceNo} (${cust.name})`,
        source_type: 'customer_invoice',
        source_id: String(referenceNo),
        lines,
        created_by: createdBy || null,
    });

    // 2. Post to Subledger
    const subId = Date.now() + Math.floor(Math.random() * 1000);
    await pool.query(`
        INSERT INTO customer_transactions (id, customer_id, trans_date, trans_type, reference_no, debit, credit, journal_entry_id, memo, created_by)
        VALUES ($1, $2, $3, 'invoice', $4, $5, 0, $6, $7, $8)
    `, [subId, customerId, date, referenceNo, gross, glResult.entry.id, memo, createdBy]);

    return { glEntry: glResult.entry, subledgerId: subId, gross };
}

/**
 * Record customer payment / delivery platform bank settlement
 */
async function postCustomerPayment(pool, { customerId, date, amount, bankAccountCode, referenceNo, memo, costCenter, createdBy }) {
    const amt = round2(amount);

    const cust = (await pool.query('SELECT id, name, control_account_code FROM customers WHERE id = $1', [customerId])).rows[0];
    if (!cust) {
        throw new Error('العميل غير موجود في سجل الحسابات المساعدة');
    }

    const controlAccount = cust.control_account_code || '1300';
    const targetBank = bankAccountCode || '1010';

    // 1. Post to GL
    const lines = [
        { account_code: targetBank, debit: amt, credit: 0, memo: `تحصيل بنكي — تسوية عميل (${cust.name})`, cost_center_code: costCenter },
        { account_code: controlAccount, debit: 0, credit: amt, memo: `سداد ذمة عميل (${cust.name})`, cost_center_code: costCenter },
    ];

    const glResult = await postJournal(pool, {
        date,
        memo: `سداد/تسوية عميل #${referenceNo} (${cust.name})`,
        source_type: 'customer_payment',
        source_id: String(referenceNo),
        lines,
        created_by: createdBy || null,
    });

    // 2. Post to Subledger
    const subId = Date.now() + Math.floor(Math.random() * 1000);
    await pool.query(`
        INSERT INTO customer_transactions (id, customer_id, trans_date, trans_type, reference_no, debit, credit, journal_entry_id, memo, created_by)
        VALUES ($1, $2, $3, 'payment', $4, 0, $5, $6, $7, $8)
    `, [subId, customerId, date, referenceNo, amt, glResult.entry.id, memo, createdBy]);

    return { glEntry: glResult.entry, subledgerId: subId, amount: amt };
}

/**
 * Get continuous subledger vs GL reconciliation status
 */
async function getSubledgerReconciliation(pool) {
    const ap = (await pool.query('SELECT * FROM view_ap_reconciliation')).rows[0];
    const ar = (await pool.query('SELECT * FROM view_ar_reconciliation')).rows[0];

    return {
        ap: {
            subledgerBalance: Number(ap?.subledger_balance || 0),
            glBalance: Number(ap?.gl_balance || 0),
            variance: Number(ap?.variance || 0),
            status: ap?.status || 'UNKNOWN',
        },
        ar: {
            subledgerBalance: Number(ar?.subledger_balance || 0),
            glBalance: Number(ar?.gl_balance || 0),
            variance: Number(ar?.variance || 0),
            status: ar?.status || 'UNKNOWN',
        },
        reconciledAt: new Date().toISOString(),
    };
}

module.exports = {
    round2,
    postCustomerInvoice,
    postCustomerPayment,
    getSubledgerReconciliation,
};
