#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
grand_cleanup_partial.py — تنظيف بقايا تشغيلة فحص كبير متوقفة قبل اكتمال التنظيف الذاتي.
يجد كل كيانات الفحص بالأنماط الاسمية ويعكس حركاتها من الليدجر والأرصدة.
"""
import os, subprocess, sys

PSQL = ["/home/z/my-project/karim-erp/database/bin/bin/psql", "-h", "127.0.0.1",
        "-U", "postgres", "-d", "karim_erp"]
PGPASSWORD = "karim_local_preview_2026_secure_password"


def sql(cmd, fetch=False):
    env = dict(os.environ)
    env["PGPASSWORD"] = PGPASSWORD
    out = subprocess.run(PSQL + ["-At", "-F", "|", "-c", cmd] if fetch else PSQL + ["-At", "-c", cmd],
                         capture_output=True, text=True, env=env)
    if out.returncode != 0:
        print(f"SQL FAIL: {out.stderr[:300]}")
        sys.exit(1)
    return [l.split("|") for l in out.stdout.strip().split("\n") if l] if fetch else out.stdout.strip()


def main():
    # 1) جمع الكيانات
    suppliers = sql("SELECT id FROM suppliers WHERE name LIKE 'مورد الفحص الكبير%' OR name LIKE 'مورد سلسلة الفحص%'", True)
    invoices = sql('SELECT id FROM "purchaseInvoices" WHERE "invoiceNumber" LIKE \'GRAND-%\' OR "invoiceNumber" LIKE \'AUD-FC-%\'', True)
    dispatches = sql("SELECT id FROM dispatches WHERE notes LIKE '%فحص كبير%' OR notes LIKE '%فحص السلسلة%' "
                     "OR notes LIKE '%احتياج أسبوعي%' OR notes LIKE '%طلب ثانٍ للرفض%'", True)
    products = sql("SELECT id FROM pos_products WHERE name_ar LIKE 'وجبة الفحص الكبير%' OR name_ar LIKE 'وجبة سلسلة الفحص%'", True)
    audits = sql("SELECT id FROM inventory_audits WHERE notes LIKE '%فحص كبير%' OR notes LIKE '%فحص حي%' OR notes LIKE '%فحص السلسلة%'", True)
    batches = sql("SELECT id FROM kitchen_production_batches WHERE notes LIKE '%فحص كبير%' OR notes LIKE '%فحص السلسلة%'", True)
    transfers = sql("SELECT id::text FROM inventory_transfers WHERE notes LIKE '%فحص كبير%' OR notes LIKE '%فحص السلسلة%'", True)
    print(f"بقايا: {len(suppliers)} مورد، {len(invoices)} فاتورة، {len(dispatches)} إذن، {len(products)} منتج، "
          f"{len(audits)} جرد، {len(batches)} دفعة إنتاج، {len(transfers)} تحويل")
    if not any((suppliers, invoices, dispatches, products, audits, batches, transfers)):
        print("لا بقايا — القاعدة نظيفة")
        return

    # 2) عكس حركات الليدجر على الأرصدة قبل حذف الليدجر (لكل صنف/موقع تمسّه حركات الفحص)
    ledger_rows = sql("SELECT inventory_id, location_id, SUM(quantity_delta) FROM inventory_ledger WHERE "
                      "reference_type IN ('purchase_invoice','dispatch','dispatch_receipt','kitchen_return',"
                      "'inventory_audit','inventory_transfer','kitchen_transfer','production_consumption') AND ("
                      + " OR ".join([f"reference_id='{r[0]}'" for r in invoices + dispatches + audits + batches + transfers] or ["false"])
                      + ") GROUP BY inventory_id, location_id", True)
    for iid, lid, delta in ledger_rows:
        sql(f"UPDATE inventory_location_balances SET on_hand = on_hand - {delta} "
            f"WHERE inventory_id={iid} AND location_id={lid}")
        sql(f"UPDATE inventory SET qty = qty - {delta} WHERE id={iid}")

    # 2-ب) عكس تأثير الشراء على متوسط التكلفة الموزون:
    # old = (qty_after × cost_after − Σ(qty_purchased × price)) / (qty_after − Σ qty_purchased)
    for r in invoices:
        inv_id = r[0]
        rows = sql(f"SELECT inventory_id, quantity_delta, unit_cost FROM inventory_ledger "
                   f"WHERE reference_type='purchase_invoice' AND reference_id='{inv_id}'", True)
        agg = {}
        for iid, delta, cost in rows:
            a = agg.setdefault(iid, [0.0, 0.0])
            a[0] += float(delta)
            a[1] += float(delta) * float(cost)
        for iid, (q, v) in agg.items():
            if q <= 0:
                continue
            row = sql(f'SELECT qty, "avgCost" FROM inventory WHERE id={iid}', True)
            qty_now, cost_now = float(row[0][0]), float(row[0][1])
            base_qty = qty_now - q
            if base_qty <= 0:
                continue
            old_cost = round((qty_now * cost_now - v) / base_qty, 2)
            sql(f'UPDATE inventory SET "avgCost"={old_cost} WHERE id={iid}')

    # 3) حذف مرتب
    for r in dispatches:
        d = r[0]
        sql(f"DELETE FROM notifications WHERE entity='dispatches' AND entity_id='{d}'")
        sql(f"DELETE FROM dispatch_workflow_events WHERE dispatch_id={d}")
        sql(f"DELETE FROM expenses WHERE notes LIKE '%#{d}%' OR notes LIKE '%إذن صرف #{d}%'")
        sql(f"DELETE FROM \"inventoryTx\" WHERE \"dispatchId\"='DIS-{d}'")
        sql(f"DELETE FROM inventory_ledger WHERE (reference_type='dispatch' AND reference_id='DIS-{d}') "
            f"OR (reference_type='dispatch_receipt' AND reference_id='{d}') "
            f"OR (reference_type='kitchen_return' AND reference_id='{d}')")
        sql(f'DELETE FROM "kitchenReturns" WHERE "dispatchId"=\'{d}\'')
        sql(f"DELETE FROM dispatches WHERE id={d}")
    for r in invoices:
        i = r[0]
        sql(f"DELETE FROM inventory_ledger WHERE reference_type='purchase_invoice' AND reference_id='{i}'")
        sql(f'DELETE FROM "purchaseInvoices" WHERE id={i}')
    for r in suppliers:
        s = r[0]
        sql(f"DELETE FROM supplier_payments WHERE \"supplierId\"={s}")
        sql(f"DELETE FROM suppliers WHERE id={s}")
    for r in products:
        p = r[0]
        # صفوف الكاشير المرتبطة أولًا (قود FK): طوابير → مدفوعات → حركات الوصفة → إيرادات → فواتير → وردية
        sql(f"DELETE FROM pos_pending_prints WHERE order_id IN (SELECT id FROM pos_orders WHERE notes LIKE '%فحص كبير%' OR notes LIKE '%فحص السلسلة%')")
        sql(f"DELETE FROM pos_zatca_invoice_queue WHERE order_id IN (SELECT id FROM pos_orders WHERE notes LIKE '%فحص كبير%' OR notes LIKE '%فحص السلسلة%')")
        sql(f"DELETE FROM pos_invoice_payments WHERE order_id IN (SELECT id FROM pos_orders WHERE notes LIKE '%فحص كبير%' OR notes LIKE '%فحص السلسلة%')")
        sql(f"DELETE FROM pos_stock_movements WHERE order_id IN (SELECT id FROM pos_orders WHERE notes LIKE '%فحص كبير%' OR notes LIKE '%فحص السلسلة%') OR product_id={p}")
        sql(f"DELETE FROM revenues WHERE \"pos_order_id\" IN (SELECT id FROM pos_orders WHERE notes LIKE '%فحص كبير%' OR notes LIKE '%فحص السلسلة%')")
        sql(f"DELETE FROM pos_orders WHERE notes LIKE '%فحص كبير%' OR notes LIKE '%فحص السلسلة%'")
        sql(f"DELETE FROM inventory_ledger WHERE reference_type='sale_consumption' AND reference_id::text NOT IN (SELECT id::text FROM pos_orders)")
        sql(f"DELETE FROM pos_shift_sessions WHERE opened_at::date = CURRENT_DATE AND status='closed' AND NOT EXISTS (SELECT 1 FROM pos_orders o WHERE o.session_id = pos_shift_sessions.id)")
        sql(f"DELETE FROM pos_product_ingredients WHERE product_id={p}")
        sql(f"DELETE FROM pos_products WHERE id={p}")
    for r in batches:
        b = r[0]
        sql(f"DELETE FROM kitchen_production_events WHERE batch_id={b}")
        sql(f"DELETE FROM inventory_ledger WHERE reference_type='kitchen_production' AND reference_id='{b}'")
        sql(f"DELETE FROM kitchen_production_batches WHERE id={b}")
    for r in transfers:
        t = r[0]
        sql(f"DELETE FROM inventory_transfer_events WHERE transfer_id='{t}'")
        sql(f"DELETE FROM inventory_transfer_items WHERE transfer_id='{t}'")
        sql(f"DELETE FROM inventory_ledger WHERE reference_type LIKE 'inventory_transfer%' AND reference_id='{t}'")
        sql(f"DELETE FROM inventory_transfers WHERE id='{t}'")
    for r in audits:
        a = r[0]
        sql(f"DELETE FROM inventory_audit_workflow_events WHERE audit_id={a}")
        sql(f"DELETE FROM inventory_audit_items WHERE audit_id={a}")
        sql(f"DELETE FROM inventory_ledger WHERE reference_type='inventory_audit' AND reference_id='{a}'")
        sql(f"DELETE FROM expenses WHERE \"adjustmentType\"='count_correction' AND notes LIKE '%جرد AUD%'")
        sql(f"DELETE FROM inventory_audits WHERE id={a}")
    # سياسات مطبخ فحص (قسم المطبخ — صارمة) بلا أصناف مرجعية نحتفظ بها
    sql("DELETE FROM kitchen_policies WHERE operation_mode='strict' AND department_id IN "
        "(SELECT id FROM pos_departments WHERE code='erp_kitchen') AND "
        "id NOT IN (SELECT COALESCE(MAX(id),0) FROM kitchen_policies)")
    # مصروفات جرد فحص متبقية
    sql("DELETE FROM expenses WHERE \"adjustmentType\"='count_correction' AND notes LIKE '%فحص%'")
    sql("DELETE FROM expenses WHERE \"desc\" LIKE '%عجز جرد%' AND notes LIKE '%فحص%'")

    # 4) تحقق
    left = sql("SELECT (SELECT count(*) FROM suppliers WHERE name LIKE 'مورد الفحص الكبير%') || '|' || "
               "(SELECT count(*) FROM \"purchaseInvoices\" WHERE \"invoiceNumber\" LIKE 'GRAND-%') || '|' || "
               "(SELECT count(*) FROM dispatches WHERE notes LIKE '%فحص كبير%' OR notes LIKE '%احتياج أسبوعي%') || '|' || "
               "(SELECT count(*) FROM pos_products WHERE name_ar LIKE 'وجبة الفحص الكبير%') || '|' || "
               "(SELECT count(*) FROM inventory_audits WHERE notes LIKE '%فحص كبير%')")
    print(f"متبقٍ بعد التنظيف: {left} (المتوقع 0|0|0|0|0)")
    rice = sql("SELECT qty, \"avgCost\" FROM inventory WHERE id=1787872285012", True)
    print(f"أرز: {rice} (المتوقع [['4000.000', '12.00']])")


if __name__ == "__main__":
    main()
