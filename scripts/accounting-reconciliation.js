#!/usr/bin/env node
const { pool } = require('../backend/shared-pool');

const checks = [
    ['paid_without_supplier_payment', `
        SELECT COUNT(*)::int AS count
        FROM "purchaseInvoices" i
        WHERE COALESCE(i."paidAmount", 0) > 0
          AND NOT EXISTS (SELECT 1 FROM supplier_payments p WHERE p."invoiceId" = i.id)
    `],
    ['negative_supplier_due', `
        SELECT COUNT(*)::int AS count
        FROM suppliers s
        WHERE ROUND(
            COALESCE(s."openingBalance", 0)
            + COALESCE((SELECT SUM("totalAmount") FROM "purchaseInvoices" WHERE "supplierId" = s.id), 0)
            - COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE "supplierId" = s.id), 0), 2
        ) < -0.01
    `],
    ['inventory_projection_mismatch', `
        SELECT COUNT(*)::int AS count
        FROM inventory i
        WHERE ABS(
            COALESCE(i.qty, 0)
            - COALESCE((SELECT SUM(on_hand) FROM inventory_location_balances b WHERE b.inventory_id = i.id), 0)
        ) > 0.0001
    `],
    ['invalid_ledger_values', `
        SELECT COUNT(*)::int AS count
        FROM inventory_ledger
        WHERE quantity_delta = 0 OR unit_cost < 0 OR total_cost < 0
    `],
    ['duplicate_invoice_numbers', `
        SELECT COUNT(*)::int AS count
        FROM (
            SELECT "invoiceNumber"
            FROM "purchaseInvoices"
            WHERE "invoiceNumber" IS NOT NULL AND "invoiceNumber" <> ''
            GROUP BY "invoiceNumber"
            HAVING COUNT(*) > 1
        ) duplicates
    `],
    ['invoice_payment_status_mismatch', `
        SELECT COUNT(*)::int AS count
        FROM "purchaseInvoices"
        WHERE ("totalAmount" <= 0 AND "paymentStatus" <> 'paid')
           OR ("totalAmount" > 0 AND "paidAmount" <= 0 AND "paymentStatus" <> 'unpaid')
           OR ("paidAmount" > 0 AND "paidAmount" < "totalAmount" AND "paymentStatus" <> 'partial')
           OR ("paidAmount" >= "totalAmount" AND "paymentStatus" <> 'paid')
    `],
    ['positive_void_revenue', `
        SELECT COUNT(*)::int AS count
        FROM revenues
        WHERE source ILIKE '%void%' AND COALESCE(amount, 0) > 0
    `],
    ['payroll_status_breakdown', `
        SELECT COUNT(*)::int AS count
        FROM payroll
        WHERE status IS NULL OR TRIM(status) = ''
    `],
    // قيد غير متوازن في الأستاذ = خطأ بنيوي لا يُصلح بالتقارير.
    ['unbalanced_journal_entries', `
        SELECT COUNT(*)::int AS count
        FROM (
            SELECT e.id
              FROM journal_entries e
              JOIN journal_lines l ON l.entry_id = e.id
             WHERE e.status = 'posted'
             GROUP BY e.id
            HAVING ABS(SUM(l.debit) - SUM(l.credit)) > 0.01
        ) bad
    `],
    // مبيعات صادرة/مُبلَّغة بلا قيد — ترحيلها best-effort وقت البيع.
    ['sale_without_journal', `
        SELECT COUNT(*)::int AS count
        FROM pos_orders o
        WHERE o.status IN ('issued','reported') AND o.total_amount > 0
          AND NOT EXISTS (SELECT 1 FROM journal_entries je
                           WHERE je.source_type = 'pos_sale' AND je.source_id = o.id::text
                             AND je.status = 'posted')
    `],
    // فاتورة ملغاة بلا قيد عكسي = إيراد وتكلفة حيّان لبيعٍ ملغى.
    ['void_without_reversal', `
        SELECT COUNT(*)::int AS count
        FROM pos_orders o
        WHERE o.status = 'cancelled'
          AND EXISTS (SELECT 1 FROM journal_entries je
                       WHERE je.source_type = 'pos_sale' AND je.source_id = o.id::text
                         AND je.status = 'posted')
          AND NOT EXISTS (SELECT 1 FROM journal_entries jv
                           WHERE jv.source_type = 'pos_void' AND jv.source_id = o.id::text
                             AND jv.status = 'posted')
    `],
    // مصروف يدوي بلا قيد (تُستثنى صفوف التسويات المخزنية — ليست دفعًا نقديًا).
    ['expense_without_journal', `
        SELECT COUNT(*)::int AS count
        FROM expenses x
        WHERE x.amount > 0
          AND COALESCE(x."adjustmentType", '') NOT IN ('dispatch','dispatch_return','transfer','receipt','stock_transfer','inventory_transfer','kitchen_return','count_correction')
          AND NOT EXISTS (SELECT 1 FROM journal_entries je
                           WHERE je.source_type = 'expense' AND je.source_id = x.id::text)
    `],
    // إذن صرف معتمد/مستلم بلا قيد تكلفة.
    ['dispatch_without_journal', `
        SELECT COUNT(*)::int AS count
        FROM dispatches d
        WHERE d.status = ANY(ARRAY['approved','received','partially_received','closed'])
          AND NOT EXISTS (SELECT 1 FROM journal_entries je
                           WHERE je.source_type = 'dispatch' AND je.source_id = d.id::text)
    `],
];

async function main() {
    const result = {};
    for (const [name, sql] of checks) {
        result[name] = Number((await pool.query(sql)).rows[0].count || 0);
    }
    console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
    console.error(`ACCOUNTING_RECONCILIATION_FAILED: ${error.message}`);
    process.exitCode = 1;
}).finally(() => pool.end());