#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_fullchain_audit.py — فحص حي شامل: من دخول البضاعة المخزن حتى وصولها الزبون
────────────────────────────────────────────────────────────────────────────────
كل مراحل السلسلة على النظام الحي:
  A) تهيئة الكتالوج: مزامنة أقسام الكاشير + منتج مرتبط بقسم + وصفة مكونات + سياسة مطبخ صارمة
  B) الشراء: مورد + فاتورة شراء آجلة → استلام فعلي في المخزن الرئيسي (ليدجر + متوسط تكلفة)
  C) الصرف للقسم: إذن صرف → اعتماد (مصروف القسم تلقائيًا) → استلام المطبخ
  D) الإنتاج: أمر إنتاج يستهلك من مخزن المطبخ ويوزع على البوفيه
  E) البيع للزبون: وردية كاشير → بيع منتج بواسفة تستهلك مكوناته من مخزن المطبخ (وضع صارم)
     + إيراد + طابور ZATCA + طابور الطباعة + خزنة الوردية + اختبار تكرار المفتاح
  F) الإرجاع: جزء من الصرف يرجع للمخزن الرئيسي (خصم مخزن المطبخ + عكس المصروف)
  G) التحويل المخزني: طلب → اعتماد وحجز → شحن → استلام
  H) التقارير والاتساق: مصروفات، ملخص المشتريات، تقرير مبيعات POS، توازن الليدجر
  I) تنظيف كامل وإرجاع الأرصدة مطابقةً للقطة ما قبل الفحص
"""
import json, subprocess, sys, time
import urllib.request, urllib.error

BASE = "http://localhost:5000"
PSQL = "/home/z/my-project/karim-erp/database/bin/bin/psql"
PGENV = {"PGPASSWORD": "karim_local_preview_2026_secure_password", "PATH": "/usr/bin:/bin"}
SIGNATURE = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg"
             "YPgPAAEDAQAIicLsAAAABJRU5ErkJggg==")
RUN = str(int(time.time()))

PASS, FAIL = 0, 0
def check(label, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✓ {label}" + (f" — {detail}" if detail else ""))
    else:    FAIL += 1; print(f"  ✗ {label}" + (f" — {detail}" if detail else ""))

def api(method, path, token=None, body=None, headers=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", f"Bearer {token}")
    for k, v in (headers or {}).items(): req.add_header(k, v)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def api_sale(token, body, key, shift_id=None):
    h = {"Idempotency-Key": key}
    if shift_id: h["X-Shift-Session-Id"] = str(shift_id)
    return api("POST", "/api/sales/complete", token, body, headers=h)

def sql(query):
    out = subprocess.run([PSQL, "-h", "localhost", "-U", "postgres", "-d", "karim_erp",
                          "-At", "-F", "|", "-c", query],
                         capture_output=True, text=True, env=PGENV, timeout=40)
    if out.returncode != 0:
        raise RuntimeError(f"SQL failed: {out.stderr.strip()}")
    return [l.split("|") for l in out.stdout.strip().split("\n") if l]

def sql1(query):
    rows = sql(query)
    return rows[0] if rows else None

print("═" * 72)
print("فحص حي شامل: من دخول البضاعة المخزن حتى وصولها الزبون — كل المراحل")
print("═" * 72)

# ══ 0) تسجيل الدخول ═══════════════════════════════════════════════════════════
st, login = api("POST", "/api/auth/login", body={"username": "admin", "password": "Karim2026Demo"})
check("تسجيل دخول المدير", st == 200 and login.get("access_token"), f"HTTP {st}")
TOK = login.get("access_token") if st == 200 else None
if not TOK:
    print("لا يمكن المتابعة بدون دخول"); sys.exit(1)

# ══ لقطة ما قبل الفحص ═════════════════════════════════════════════════════════
snap_inv = {r[0]: (float(r[1]), float(r[2]), float(r[3] or 0)) for r in sql(
    'SELECT id::text, qty, "avgCost", COALESCE(weight,0) FROM inventory')}
snap_bal = {(r[0], r[1]): (float(r[2]), float(r[3]), float(r[4])) for r in sql(
    "SELECT inventory_id::text, location_id::text, on_hand, reserved, in_transit FROM inventory_location_balances")}
snap_counts = {
    "suppliers": int(sql1("SELECT count(*) FROM suppliers")[0]),
    "purchaseInvoices": int(sql1('SELECT count(*) FROM "purchaseInvoices"')[0]),
    "dispatches": int(sql1("SELECT count(*) FROM dispatches")[0]),
    "kitchenReturns": int(sql1('SELECT count(*) FROM "kitchenReturns"')[0]),
    "expenses": int(sql1("SELECT count(*) FROM expenses")[0]),
    "revenues": int(sql1("SELECT count(*) FROM revenues")[0]),
    "pos_orders": int(sql1("SELECT count(*) FROM pos_orders")[0]),
    "pos_products": int(sql1("SELECT count(*) FROM pos_products")[0]),
    "pos_departments": int(sql1("SELECT count(*) FROM pos_departments")[0]),
    "kitchen_policies": int(sql1("SELECT count(*) FROM kitchen_policies")[0]),
    "kitchen_batches": int(sql1("SELECT count(*) FROM kitchen_production_batches")[0]),
    "transfers": int(sql1("SELECT count(*) FROM inventory_transfers")[0]),
    "ledger": int(sql1("SELECT count(*) FROM inventory_ledger")[0]),
    "inventoryTx": int(sql1('SELECT count(*) FROM "inventoryTx"')[0]),
}
print(f"  لقطة: {len(snap_inv)} صنف، {len(snap_bal)} رصيد موقع | " +
      "، ".join(f"{k}={v}" for k, v in snap_counts.items()))

# ══ A) تهيئة الكتالوج ═════════════════════════════════════════════════════════
print("\n■ A) تهيئة الكتالوج: أقسام الكاشير + منتج بواسفة + سياسة مطبخ")
st, depts = api("GET", "/api/pos/departments", TOK)
check("GET /pos/departments يزامن أقسام POS من أقسام النظام", st == 200 and isinstance(depts, list) and len(depts) >= 2, f"HTTP {st} n={len(depts) if isinstance(depts,list) else 0}")
kitchen_pos = next((d for d in depts if d.get("code") == "erp_kitchen"), None)
buffet_pos = next((d for d in depts if d.get("code") == "erp_open_buffet"), None)
check("قسم المطبخ موجود في الكاشير (erp_kitchen)", bool(kitchen_pos))
check("قسم البوفيه موجود في الكاشير (erp_open_buffet)", bool(buffet_pos))
KPOS_ID = int(kitchen_pos["id"]) if kitchen_pos else None

# منتج البيع: وجبة بواسفة مرتبطة بقسم المطبخ
PROD_NAME = f"وجبة سلسلة الفحص {RUN}"
ARROZ = "1787872285012"  # أرز — كيلوجرام
item_row = sql1(f'SELECT id::text, name, unit, qty, "avgCost" FROM inventory WHERE id={ARROZ}')
check("صنف الأرز متوفر بالمخزن الرئيسي", bool(item_row), f"{item_row[1]} ×{item_row[3]} {item_row[2]}" if item_row else "")
ITEM_NAME, ITEM_UNIT = item_row[1], item_row[2]

st, prod = api("POST", "/api/pos/products", TOK, {
    "name_ar": PROD_NAME, "price": 20, "vat_rate": 15, "cost_price": 2.4,
    "unit": "وجبة", "category": "فحص", "department_ids": [KPOS_ID]})
check("إنشاء منتج مرتبط بقسم المطبخ (201)", st == 201 and prod.get("id"), f"HTTP {st} {prod.get('error','')}")
PID = int(prod["id"]) if st == 201 else None

st, ings = api("PUT", f"/api/pos/products/{PID}/ingredients", TOK,
               {"ingredients": [{"inventory_id": int(ARROZ), "quantity_per_unit": 0.2, "unit": "كيلوجرام", "waste_percent": 0}]})
check("ربط وصفة المكونات (0.2 كجم أرز لكل وجبة)", st == 200 and ings.get("ingredient_count") == 1, f"HTTP {st}")

st, pol = api("POST", "/api/kitchen/policies", TOK,
              {"department_id": KPOS_ID, "kitchen_location_id": 2, "operation_mode": "strict"})
check("سياسة مطبخ صارمة: قسم المطبخ يستهلك من KITCHEN-MAIN", st == 200 and pol.get("operation_mode") == "strict", f"HTTP {st}")

# ══ B) الشراء: البضاعة تدخل المخزن ════════════════════════════════════════════
print("\n■ B) الشراء من مورد → دخول البضاعة المخزن الرئيسي")
SUP = f"مورد سلسلة الفحص {RUN}"
INV_NO = f"AUD-FC-{RUN}"
P_QTY, P_PRICE = 10.0, 15.0
P_TOTAL = round(P_QTY * P_PRICE, 2)

main_before = snap_bal[(ARROZ, "1")][0]
cost_before = snap_inv[ARROZ][1]

st, sup = api("POST", "/api/procurement/suppliers", TOK, {"name": SUP, "phone": "0500000000", "category": "فحص"})
check("إنشاء مورد الفحص (201)", st == 201 and sup.get("id"), f"HTTP {st}")
SID = sup.get("id")

st, bad = api("POST", "/api/warehouse/purchase-invoices", TOK,
              {"invoiceNumber": f"AUD-FC-BAD-{RUN}", "supplierId": SID, "paymentMethod": "credit", "items": []})
check("رفض فاتورة بلا أصناف (422)", st == 422 and bad.get("error") == "EMPTY_INVOICE_ITEMS", f"HTTP {st}")

st, inv = api("POST", "/api/warehouse/purchase-invoices", TOK, {
    "invoiceNumber": INV_NO, "date": time.strftime("%Y-%m-%d"),
    "supplierId": SID, "paymentMethod": "credit",
    "items": [{"itemName": ITEM_NAME, "itemId": int(ARROZ), "unit": ITEM_UNIT, "qty": P_QTY, "price": P_PRICE}]})
check("فاتورة شراء آجلة 10 كجم × 15 (201)", st == 201 and inv.get("invoice", {}).get("id"), f"HTTP {st} {inv.get('error','')}")
INV_ID = str(inv["invoice"]["id"]) if st == 201 else None
check("حالة السداد unpaid ومسدد 0", inv.get("invoice", {}).get("paymentStatus") == "unpaid", str(inv.get("invoice", {}).get("paymentStatus")))

led = sql(f"SELECT quantity_delta FROM inventory_ledger WHERE reference_type='purchase_invoice' AND reference_id='{INV_ID}'")
check("استلام مخزني فعلي في الليدجر (+10 بموقع MAIN)", len(led) == 1 and abs(float(led[0][0]) - P_QTY) < 0.001, f"{len(led)} صف")
main_after = float(sql1(f"SELECT on_hand FROM inventory_location_balances WHERE inventory_id={ARROZ} AND location_id=1")[0])
check("رصيد MAIN زاد +10", abs(main_after - (main_before + P_QTY)) < 0.001, f"{main_before} → {main_after}")

cost_after = float(sql1(f'SELECT "avgCost" FROM inventory WHERE id={ARROZ}')[0])
expected_cost = round(((snap_inv[ARROZ][0] * cost_before) + (P_QTY * P_PRICE)) / (snap_inv[ARROZ][0] + P_QTY), 2)
check("متوسط التكلفة تحدث موزونًا", abs(cost_after - expected_cost) < 0.01, f"{cost_before} → {cost_after} ≈ {expected_cost}")

st, sups = api("GET", "/api/procurement/suppliers", TOK)
row = next((s for s in sups if str(s["id"]) == str(SID)), None)
check("رصيد المورد المستحق = قيمة الفاتورة", row and abs(row["dueTotal"] - P_TOTAL) < 0.01, f"due={row.get('dueTotal') if row else None}")

# ══ C) الصرف للقسم: إذن صرف → اعتماد → استلام ════════════════════════════════
print("\n■ C) الصرف للقسم (المطبخ): اعتماد = مصروف تلقائي + استلام مخزن المطبخ")
D_QTY = 3.0
st, disp = api("POST", "/api/dispatches", TOK, {
    "deptCode": "kitchen", "deptName": "المطبخ",
    "items": [{"itemName": ITEM_NAME, "qty": D_QTY, "unit": ITEM_UNIT}],
    "notes": f"فحص السلسلة {RUN}"})
check("إنشاء إذن صرف 3 كجم للمطبخ (pending)", st in (200, 201) and disp.get("status") == "pending", f"HTTP {st}")
DISP_ID = str(disp.get("id")) if st in (200, 201) else None

st, nf = api("POST", "/api/warehouse/dispatches/999999999/approve", TOK, {"signatureData": SIGNATURE})
check("رفض اعتماد إذن غير موجود (404)", st == 404, f"HTTP {st}")

exp_amount = round(D_QTY * cost_after, 2)
st, appr = api("POST", f"/api/warehouse/dispatches/{DISP_ID}/approve", TOK,
               {"signatureData": SIGNATURE, "approveNotes": "فحص السلسلة"})
check("اعتماد الإذن من المخزن", st == 200 and appr.get("dispatch", {}).get("status") == "approved", f"HTTP {st}")
ap_exp = (appr.get("expenses") or [{}])[0]
check("مصروف تلقائي على قسم المطبخ", ap_exp.get("deptId") == "kitchen", str(ap_exp.get("deptId")))
check("قيمة المصروف = 3 × متوسط التكلفة", abs(float(ap_exp.get("amount", 0)) - exp_amount) < 0.01, f"{ap_exp.get('amount')} ≈ {exp_amount}")
DISP_EXP_ID = ap_exp.get("id")
main_after_appr = float(sql1(f"SELECT on_hand FROM inventory_location_balances WHERE inventory_id={ARROZ} AND location_id=1")[0])
check("رصيد MAIN نقص −3 عند الاعتماد", abs(main_after_appr - (main_after - D_QTY)) < 0.001, f"{main_after} → {main_after_appr}")

st, rcv = api("POST", f"/api/warehouse/dispatches/{DISP_ID}/receive", TOK,
              {"items": [{"itemName": ITEM_NAME, "receivedQty": D_QTY}], "signatureData": SIGNATURE, "notes": "استلام كامل"})
check("استلام المطبخ الكمية كاملة", st == 200 and rcv.get("dispatch", {}).get("status") == "received", f"HTTP {st}")
kit_after_rcv = float(sql1(f"SELECT on_hand FROM inventory_location_balances WHERE inventory_id={ARROZ} AND location_id=2")[0])
check("رصيد KITCHEN-MAIN زاد +3", abs(kit_after_rcv - (snap_bal[(ARROZ, "2")][0] + D_QTY)) < 0.001, f"{snap_bal[(ARROZ,'2')][0]} → {kit_after_rcv}")

# ══ D) الإنتاج: أمر إنتاج يستهلك من مخزن المطبخ ═══════════════════════════════
print("\n■ D) الإنتاج في المطبخ: أمر إنتاج 4 وجبات يستهلك 2 كجم أرز")
PRD_QTY, PRD_MAT = 4.0, 2.0
st, batch = api("POST", "/api/kitchen/production", TOK, {
    "product_name": PROD_NAME, "product_unit": "وجبة", "produced_qty": PRD_QTY,
    "distributions": [{"destination_type": "channel", "destination_code": "open_buffet", "quantity": PRD_QTY}],
    "materials": [{"inventory_id": int(ARROZ), "quantity": PRD_MAT, "waste_percent": 0}],
    "notes": f"فحص السلسلة {RUN}"})
check("إنشاء أمر الإنتاج (200)", st == 200 and batch.get("batch", {}).get("id"), f"HTTP {st} {batch.get('error','') if st!=200 else ''}")
BATCH_ID = str(batch.get("batch", {}).get("id")) if st == 200 else None
check("توزيع الإنتاج على البوفيه مسجل", len(batch.get("distributions", [])) == 1 and batch["distributions"][0].get("destination_code") == "open_buffet")

kit_after_prd = float(sql1(f"SELECT on_hand FROM inventory_location_balances WHERE inventory_id={ARROZ} AND location_id=2")[0])
check("مخزن المطبخ نقص −2 (استهلاك إنتاج)", abs(kit_after_prd - (kit_after_rcv - PRD_MAT)) < 0.001, f"{kit_after_rcv} → {kit_after_prd}")

st, short_batch = api("POST", "/api/kitchen/production", TOK, {
    "product_name": PROD_NAME, "product_unit": "وجبة", "produced_qty": 999,
    "distributions": [{"destination_type": "channel", "destination_code": "open_buffet", "quantity": 999}],
    "materials": [{"inventory_id": int(ARROZ), "quantity": 999, "waste_percent": 0}]})
check("رفض إنتاج يفوق رصيد المطبخ (409)", st == 409 and short_batch.get("error") == "INSUFFICIENT_STOCK", f"HTTP {st}")

# ══ E) البيع للزبون: وردية + بيع بواسفة تستهلك الوصفة ═════════════════════════
print("\n■ E) البيع للزبون: وردية كاشير → بيع 2 وجبة (استهلاك صارم من مخزن المطبخ)")
st, shift = api("POST", "/api/pos/shifts/open", TOK, {"department_id": KPOS_ID, "opening_balance": 0})
if st == 409 and shift.get("error") == "SHIFT_ALREADY_OPEN":
    # وردية قديمة عالقة للمدير: أغلقها برصيدها المتوقع (فرق صفر) ثم أعد الفتح
    stale = sql1("SELECT s.id FROM pos_shift_sessions s WHERE s.cashier_id=1 AND s.status='open' ORDER BY s.id LIMIT 1")
    if stale:
        net = sql1(f"SELECT COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='in' THEN ip.amount END),0) - COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='out' THEN ip.amount END),0) FROM pos_invoice_payments ip JOIN pos_orders o ON o.id=ip.order_id WHERE o.session_id={stale[0]}")
        expected = float(net[0] or 0)
        api("POST", f"/api/pos/shifts/{stale[0]}/close", TOK, {"actual_cash": expected, "notes": f"إغلاق وردية عالقة أثناء فحص السلسلة {RUN}"})
        print(f"  … أُغلقت وردية عالقة #{stale[0]} (فرق صفر)")
    st, shift = api("POST", "/api/pos/shifts/open", TOK, {"department_id": KPOS_ID, "opening_balance": 0})
check("فتح وردية على قسم المطبخ", st == 201 and shift.get("session_id"), f"HTTP {st} {shift.get('error','')}")
SHIFT_ID = int(shift["session_id"]) if st == 201 else None

SALE_KEY = f"audit-fc-{RUN}"
SALE_BODY = {
    "department_id": KPOS_ID,
    "items": [{"product_id": PID, "quantity": 2, "unit_price": 20, "discount": 0}],
    "payments": [{"method": "cash", "amount": 46}],
    "notes": f"فحص السلسلة {RUN}",
}
st, sale = api_sale(TOK, SALE_BODY, SALE_KEY, SHIFT_ID)
check("بيع 2 وجبة (201) مرتبط بالوردية", st == 201 and sale.get("order_id"), f"HTTP {st} {json.dumps(sale)[:200] if st != 201 else ''}")
ORDER_ID = sale.get("order_id") if st in (200, 201) else None
check("إجمالي البيع 46 = 40 + 15% ضريبة", abs(float(sale.get("total_amount", 0)) - 46) < 0.01,
      f"subtotal={sale.get('subtotal')} vat={sale.get('tax_total')} total={sale.get('total_amount')}")

st, sale2 = api_sale(TOK, SALE_BODY, SALE_KEY, SHIFT_ID)
check("إعادة نفس المفتاح لا تكرر البيع (نفس الفاتورة)", st in (200, 201) and sale2.get("order_id") == ORDER_ID and sale2.get("_idempotent_replay") is True,
      f"{sale2.get('order_id')} replay={sale2.get('_idempotent_replay')}")

kit_after_sale = float(sql1(f"SELECT on_hand FROM inventory_location_balances WHERE inventory_id={ARROZ} AND location_id=2")[0])
expected_sale_consumption = 2 * 0.2
check("الاستهلاك من مخزن المطبخ −0.4 (وصفة 2 وجبة)", abs(kit_after_sale - (kit_after_prd - expected_sale_consumption)) < 0.001,
      f"{kit_after_prd} → {kit_after_sale}")

smov = sql(f"SELECT count(*) FROM pos_stock_movements WHERE order_id='{ORDER_ID}' AND reason='sale_recipe'") if ORDER_ID else []
if ORDER_ID:
    check("حركات وصفة البيع مسجلة (pos_stock_movements)", int(smov[0][0]) >= 1, f"{smov[0][0]} صف")

if ORDER_ID:
    rev = sql1(f"SELECT amount, \"deptId\", source FROM revenues WHERE \"pos_order_id\"='{ORDER_ID}'")
    check("إيراد POS مسجل على قسم المطبخ", bool(rev) and abs(float(rev[0]) - 46) < 0.01 and rev[1] == "kitchen", f"{rev}")

    zat = sql1(f"SELECT status FROM pos_zatca_invoice_queue WHERE order_id='{ORDER_ID}'")
    check("الفاتورة في طابور ZATCA", bool(zat), str(zat))
    prn = sql1(f"SELECT status FROM pos_pending_prints WHERE order_id='{ORDER_ID}'")
    check("الفاتورة في طابور الطباعة", bool(prn), str(prn))

# بيع يفوق رصيد المطبخ في الوضع الصارم → مرفوض دون الرجوع للمخزن الرئيسي
st, oversale = api_sale(TOK,
                   {"department_id": KPOS_ID,
                    "items": [{"product_id": PID, "quantity": 30, "unit_price": 20, "discount": 0}],
                    "payments": [{"method": "cash", "amount": 690}],
                    "notes": "فحص رفض البيع فوق رصيد المطبخ"},
                   f"audit-fc-over-{RUN}", SHIFT_ID)
check("الوضع الصارم يرفض بيع 6 كجم والمطبخ لا يملكها (409)", st == 409, f"HTTP {st} {oversale.get('error','')}")

st, rep = api("GET", "/api/pos/reports/sales?start_date=" + time.strftime("%Y-%m-%d") + "&end_date=" + time.strftime("%Y-%m-%d"), TOK) if ORDER_ID else (200, {})
rep_ok = st == 200
rep_txt = json.dumps(rep)
check("تقرير مبيعات اليوم يعمل ويتضمن البيع", rep_ok and (str(PID) in rep_txt or PROD_NAME in rep_txt or "46" in rep_txt), f"HTTP {st}")

# ══ F) الإرجاع: جزء من الصرف يرجع للمخزن ══════════════════════════════════════
print("\n■ F) الإرجاع: 0.5 كجم ترجع من المطبخ للمخزن الرئيسي")
R_QTY = 0.5
ret_amount = round(R_QTY * cost_after, 2)
st, ret = api("POST", "/api/warehouse/returns", TOK,
              {"dispatchId": DISP_ID, "items": [{"itemName": ITEM_NAME, "qty": R_QTY}], "reason": f"فحص السلسلة {RUN}"})
check("إرجاع جزء من الكمية (201)", st == 201, f"HTTP {st} {ret.get('error','') if st!=201 else ''}")
ret_exp = (ret.get("expenses") or [{}])[0]
check("عكس مصروف سالب على قسم المطبخ", float(ret_exp.get("amount", 0)) < 0 and ret_exp.get("deptId") == "kitchen",
      f"{ret_exp.get('amount')}")
RET_EXP_ID = ret_exp.get("id")

kit_after_ret = float(sql1(f"SELECT on_hand FROM inventory_location_balances WHERE inventory_id={ARROZ} AND location_id=2")[0])
main_after_ret = float(sql1(f"SELECT on_hand FROM inventory_location_balances WHERE inventory_id={ARROZ} AND location_id=1")[0])
check("مخزن المطبخ نقص −0.5 (البضاعة خرجت فعلًا)", abs(kit_after_ret - (kit_after_sale - R_QTY)) < 0.001,
      f"{kit_after_sale} → {kit_after_ret}")
check("المخزن الرئيسي زاد +0.5", abs(main_after_ret - (main_after_appr + R_QTY)) < 0.001, f"{main_after_appr} → {main_after_ret}")

st, over_ret = api("POST", "/api/warehouse/returns", TOK,
                   {"dispatchId": DISP_ID, "items": [{"itemName": ITEM_NAME, "qty": 99}], "reason": "فحص رفض الإرجاع الزائد"})
check("رفض إرجاع أكبر من المستلم (409)", st == 409 and over_ret.get("error") == "RETURN_QTY_EXCEEDED", f"HTTP {st}")

# ══ G) التحويل المخزني: طلب → اعتماد → شحن → استلام ═══════════════════════════
print("\n■ G) التحويل المخزني MAIN → KITCHEN (دورة كاملة)")
T_QTY = 1.0
st, tr = api("POST", "/api/warehouse/transfers", TOK,
             {"source_location_id": 1, "destination_location_id": 2,
              "items": [{"inventory_id": int(ARROZ), "requested_qty": T_QTY}], "notes": f"فحص السلسلة {RUN}"})
check("إنشاء طلب تحويل (201)", st == 201 and tr.get("id"), f"HTTP {st} {tr.get('error','')}")
TR_ID = tr.get("id") if st == 201 else None
st, appr_tr = api("POST", f"/api/warehouse/transfers/{TR_ID}/approve", TOK, {})
check("اعتماد التحويل وحجز الكمية", st == 200 and appr_tr.get("status") == "reserved", f"HTTP {st}")
res = float(sql1(f"SELECT reserved FROM inventory_location_balances WHERE inventory_id={ARROZ} AND location_id=1")[0])
check("حجز 1 كجم في المصدر (reserved=1)", abs(res - T_QTY) < 0.001, f"reserved={res}")
st, dsp_tr = api("POST", f"/api/warehouse/transfers/{TR_ID}/dispatch", TOK, {})
check("شحن التحويل (in_transit)", st == 200 and dsp_tr.get("status") == "in_transit", f"HTTP {st}")
st, rcv_tr = api("POST", f"/api/warehouse/transfers/{TR_ID}/receive", TOK, {})
check("استلام التحويل كاملًا", st == 200 and rcv_tr.get("status") == "received", f"HTTP {st}")
kit_after_tr = float(sql1(f"SELECT on_hand FROM inventory_location_balances WHERE inventory_id={ARROZ} AND location_id=2")[0])
check("مخزن المطبخ زاد +1 بالتحويل", abs(kit_after_tr - (kit_after_ret + T_QTY)) < 0.001, f"{kit_after_ret} → {kit_after_tr}")
res_after = float(sql1(f"SELECT reserved FROM inventory_location_balances WHERE inventory_id={ARROZ} AND location_id=1")[0])
check("الحجز انفض بعد الشحن (reserved=0)", abs(res_after) < 0.001, f"reserved={res_after}")

print("\n" + "─" * 72)
print(f"المرحلة الأولى (A-G): {PASS} PASS / {FAIL} FAIL")
print("─" * 72)
with open(f"/home/z/my-project/karim-erp/scripts/.fullchain_state_{RUN}.json", "w") as f:
    json.dump({"RUN": RUN, "TOK": TOK, "SID": SID, "INV_ID": INV_ID, "INV_NO": INV_NO,
               "DISP_ID": DISP_ID, "BATCH_ID": BATCH_ID, "PID": PID, "ORDER_ID": ORDER_ID,
               "SHIFT_ID": SHIFT_ID, "TR_ID": TR_ID, "KPOS_ID": KPOS_ID,
               "DISP_EXP_ID": DISP_EXP_ID, "RET_EXP_ID": RET_EXP_ID,
               "PROD_NAME": PROD_NAME, "SUP": SUP, "ARROZ": ARROZ,
               "snap_counts": snap_counts, "snap_inv": {k: list(v) for k, v in snap_inv.items()},
               "snap_bal": {f"{k[0]}|{k[1]}": list(v) for k, v in snap_bal.items()},
               "ledger_pre": float(sql1(f"SELECT COALESCE(sum(quantity_delta),0) FROM inventory_ledger WHERE inventory_id={ARROZ}")[0][0]),
               "bal_pre": float(sql1(f"SELECT COALESCE(sum(on_hand),0) FROM inventory_location_balances WHERE inventory_id={ARROZ}")[0][0]),
               "PASS": PASS, "FAIL": FAIL}, f)
if FAIL:
    print("FAILED — راجع الأخطاء أعلاه قبل المتابعة")
    sys.exit(1)
print(f"state saved: scripts/.fullchain_state_{RUN}.json — شغّل live_fullchain_audit_part2.py للتقارير والتنظيف")
sys.exit(0)
