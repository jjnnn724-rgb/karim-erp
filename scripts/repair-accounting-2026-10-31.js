#!/usr/bin/env node
'use strict';
/**
 * repair-accounting-2026-10-31.js — إصلاحات محاسبية محدّدة، مُعاينة افتراضيًا.
 * ═══════════════════════════════════════════════════════════════════════════
 * كل قسم مُستقل ومُعطَّل حتى يُطلب صراحةً، وكل كتابة idempotent (مفتاح مصدر
 * ثابت أو معرّف صفّ)، فلا تكرار لو شُغّل السكربت مرتين.
 *
 * الأقسام:
 *   --ledger-sign        توحيد إشارة total_cost في دفتر المخزون: العُرف أن
 *                        total_cost = |quantity_delta| × unit_cost (موجب
 *                        دائمًا)، وصفّان قديمان كُتبا بإشارة سالبة فكسرا العُرف.
 *   --cash-settlements   فواتير شراء مُعلَّمة «مدفوعة نقدًا» بلا قيد سداد:
 *                        Dr 2000 ذمم / Cr 1000 صندوق (أو 1010 بنك). بدونها
 *                        يبقى الالتزام مفتوحًا ولا تنقص الخزينة رغم أن الفاتورة
 *                        تقول إنها دُفعت.
 *   --duplicate-receipt  إذن صرف #1791159614515714 استُلم في دفتر المخزون
 *                        مرتين: استلامٌ حقيقي (2026-10-05 13:57) ودفعةُ إعادة
 *                        بناءٍ (legacy-receipt 2026-10-05 17:01). تصحيح 10-21
 *                        عكس دفعة 10-18 بدل المكرّرة، فبقيت الكميات ضِعف
 *                        المعتمد. القسم يعكس دفعة إعادة البناء وحدها.
 *
 * الاستخدام:
 *   node scripts/repair-accounting-2026-10-31.js                     # معاينة
 *   node scripts/repair-accounting-2026-10-31.js --apply --ledger-sign
 *   node scripts/repair-accounting-2026-10-31.js --apply --cash-settlements
 *   node scripts/repair-accounting-2026-10-31.js --apply --duplicate-receipt
 */

const { pool } = require('../backend/shared-pool');
const { postJournal } = require('../backend/accounting-routes');
const { postInventoryLedgerEntry } = require('../backend/inventory-ledger');

const APPLY = process.argv.includes('--apply');
const SECTIONS = ['ledger-sign', 'cash-settlements', 'duplicate-receipt'];
const WANTED = SECTIONS.filter((s) => process.argv.includes(`--${s}`));
const money = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const log = (...args) => console.log('[REPAIR]', ...args);

/* ── ١. إشارة total_cost ──────────────────────────────────────────────── */
async function ledgerSign() {
    const { rows } = await pool.query(
        `SELECT id, reference_type, reference_id, inventory_id, quantity_delta, unit_cost, total_cost
           FROM inventory_ledger
          WHERE total_cost < 0
          ORDER BY created_at`);
    log(`إشارة total_cost: ${rows.length} صفًّا بإشارة سالبة`);
    for (const r of rows) {
        const expected = Number((Math.abs(Number(r.quantity_delta)) * Number(r.unit_cost)).toFixed(4));
        const ok = Math.abs(Math.abs(Number(r.total_cost)) - expected) <= 0.01;
        log(`  ${r.id} ${r.reference_type} qty=${r.quantity_delta} unit=${r.unit_cost} total=${r.total_cost}` +
            (ok ? '' : `  ⚠ لا يطابق |qty|×unit=${expected}`));
        if (!ok) { throw new Error(`صفّ غير متسق لا يُصلح تلقائيًا: ${r.id}`); }
    }
    if (!rows.length) { return { changed: 0 }; }
    if (!APPLY) { return { changed: 0, pending: rows.length }; }
    const ids = rows.map((r) => r.id);
    await pool.query('UPDATE inventory_ledger SET total_cost = ABS(total_cost) WHERE id = ANY($1::uuid[])', [ids]);
    return { changed: rows.length };
}

/* ── ٢. سداد نقدي للفواتير المدفوعة بلا قيد ───────────────────────────── */
async function cashSettlements() {
    const { rows } = await pool.query(
        `SELECT i.id, i."invoiceNumber", i.date, i."supplierName", i."totalAmount", i."paidAmount", i."paymentMethod"
           FROM "purchaseInvoices" i
          WHERE COALESCE(i."paidAmount", 0) > 0
            AND NOT EXISTS (SELECT 1 FROM supplier_payments p WHERE p."invoiceId" = i.id)
            AND NOT EXISTS (SELECT 1 FROM journal_entries je
                             WHERE je.source_type = 'purchase_payment' AND je.source_id = i.id::text)
          ORDER BY i.date, i.id`);
    const total = rows.reduce((s, r) => s + Number(r.paidAmount || 0), 0);
    log(`سداد نقدي: ${rows.length} فاتورة بمبلغ ${money(total)}`);
    let posted = 0;
    for (const r of rows) {
        const amount = Number(Number(r.paidAmount).toFixed(2));
        const cash = String(r.paymentMethod || '').toLowerCase() === 'cash' ? '1000' : '1010';
        log(`  ${r.invoiceNumber} ${r.date} ${money(amount)} → Dr 2000 / Cr ${cash}`);
        if (!APPLY) { continue; }
        await postJournal(pool, {
            date: String(r.date).slice(0, 10),
            memo: `سداد نقدي فاتورة شراء ${r.invoiceNumber}`,
            source_type: 'purchase_payment',
            source_id: String(r.id),
            lines: [
                { account_code: '2000', debit: amount, credit: 0, memo: `سداد ذمم فاتورة ${r.invoiceNumber}` },
                { account_code: cash, debit: 0, credit: amount, memo: 'خروج نقدية — شراء نقدي' },
            ],
        });
        posted++;
    }
    return APPLY ? { posted } : { pending: rows.length, total };
}

/* ── ٣. الاستلام المكرر لإذن الصرف ────────────────────────────────────── */
const DUP_DISPATCH = '1791159614515714';

async function duplicateReceipt() {
    const { rows } = await pool.query(
        `SELECT l.*, i.name
           FROM inventory_ledger l JOIN inventory i ON i.id = l.inventory_id
          WHERE l.reference_id = $1
            AND l.idempotency_key LIKE $2
            AND NOT EXISTS (
                SELECT 1 FROM inventory_ledger r
                 WHERE r.idempotency_key = 'correction:legacy-dup:' || $1 || ':' || l.inventory_id || ':reversal')
          ORDER BY l.inventory_id`,
        [DUP_DISPATCH, `dispatch:${DUP_DISPATCH}:legacy-receipt:%`]);
    const approved = await pool.query(
        `SELECT (e->>'itemId')::bigint item_id, (e->>'approvedQty')::numeric qty
           FROM dispatches d, jsonb_array_elements(d."approvedItems") e
          WHERE d.id = $1::bigint`, [DUP_DISPATCH]);
    const apprQty = new Map(approved.rows.map((r) => [String(r.item_id), Number(r.qty)]));
    const qty = rows.reduce((s, r) => s + Number(r.quantity_delta), 0);
    const cost = rows.reduce((s, r) => s + Number(r.total_cost), 0);
    log(`استلام مكرر #${DUP_DISPATCH}: ${rows.length} صفًّا · كمية ${qty} · قيمة ${money(cost)}`);
    for (const r of rows) {
        const a = apprQty.get(String(r.inventory_id));
        log(`  ${r.name}: استلام مكرر ${r.quantity_delta} (المعتمد ${a != null ? a : '؟'})`);
        if (a == null || Math.abs(Number(r.quantity_delta) - a) > 0.0001) {
            throw new Error(`كمية الاستلام المكرر لا تساوي المعتمد للصنف ${r.inventory_id} — مراجعة يدوية`);
        }
    }
    if (!rows.length) { log('  لا شيء متبقٍّ — العكس مُطبَّق مسبقًا.'); return { changed: 0 }; }
    if (!APPLY) { return { pending: rows.length, qty, cost }; }
    const client = await pool.connect();
    let reversed = 0;
    try {
        await client.query('BEGIN');
        for (const r of rows) {
            await postInventoryLedgerEntry(client, {
                transactionType: 'reversal',
                inventoryId: Number(r.inventory_id),
                locationId: Number(r.location_id),
                quantityDelta: -Number(r.quantity_delta),
                unitCost: Number(r.unit_cost),
                referenceType: 'dispatch_duplicate_correction',
                referenceId: DUP_DISPATCH,
                idempotencyKey: `correction:legacy-dup:${DUP_DISPATCH}:${r.inventory_id}:reversal`,
                businessDate: new Date().toISOString().slice(0, 10),
                reason: `عكس استلام مكرر (دفعة إعادة بناء) لإذن صرف #${DUP_DISPATCH} — تصحيح 2026-10-31`,
                metadata: {
                    dispatch_id: Number(DUP_DISPATCH),
                    correction: 'legacy_duplicate_receipt_2026-10-31',
                    corrects_ledger_id: r.id,
                },
            });
            reversed++;
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
    return { reversed };
}

async function main() {
    log(`الوضع: ${APPLY ? 'كتابة' : 'معاينة فقط — أضف --apply'}`);
    if (!WANTED.length) { log(`اختر قسمًا: ${SECTIONS.map((s) => `--${s}`).join(' · ')}`); return; }
    const out = {};
    if (WANTED.includes('ledger-sign')) { out['ledger-sign'] = await ledgerSign(); }
    if (WANTED.includes('cash-settlements')) { out['cash-settlements'] = await cashSettlements(); }
    if (WANTED.includes('duplicate-receipt')) { out['duplicate-receipt'] = await duplicateReceipt(); }
    log('النتيجة:', JSON.stringify(out));
}

main()
    .catch((e) => { console.error('[REPAIR] FAILED:', e.message); process.exitCode = 1; })
    .finally(() => pool.end());
