#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_procurement_audit.py — فحص حي شامل: مركز المشتريات والموردين (Task 16)
────────────────────────────────────────────────────────────────────────
يغطي:
  1) دليل الموردين: إنشاء، تكرار اسم 409، حمولة ناقصة 422، تعطيل/تفعيل
  2) فاتورة شراء مرتبطة بمورد (آجل) → paymentStatus/unpaid + استلام مخزني فعلي بالليدجر
  3) كشف حساب مورد: رصيد جارٍ صحيح + طيّ ما قبل الفترة + فلتر إلى-تاريخ
  4) دفعة جزئية → partial — رفض دفعة أكبر من المتبقي — تسديد كامل → paid
  5) رفض دفعات/فواتير لمورد موقوف — رفض حذف مورد له حركات — حذف مورد نظيف يعمل
  6) اتساق الملخص: المستحق = افتتاحي + مشتريات − دفعات
  7) تنظيف كامل وإرجاع الأرصدة مطابقة تمامًا للقطة ما قبل الفحص
"""
import json, subprocess, sys, time
import urllib.request

BASE = "http://localhost:5000"
PSQL = "/home/z/my-project/karim-erp/database/bin/bin/psql"
PGENV = {"PGPASSWORD": "karim_local_preview_2026_secure_password", "PATH": "/usr/bin:/bin"}

PASS, FAIL = 0, 0
def check(label, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✓ {label}" + (f" — {detail}" if detail else ""))
    else:    FAIL += 1; print(f"  ✗ {label}" + (f" — {detail}" if detail else ""))

def api(method, path, token=None, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=20) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def sql(query):
    out = subprocess.run([PSQL, "-h", "localhost", "-U", "postgres", "-d", "karim_erp",
                          "-At", "-F", "|", "-c", query],
                         capture_output=True, text=True, env=PGENV, timeout=30)
    if out.returncode != 0:
        raise RuntimeError(f"SQL failed: {out.stderr.strip()}")
    return [l.split("|") for l in out.stdout.strip().split("\n") if l]

print("═" * 68)
print("فحص حي: مركز المشتريات والموردين — موردون، دفعات، كشوف حساب")
print("═" * 68)

# ── 0) تسجيل الدخول ──────────────────────────────────────────────────────────
st, login = api("POST", "/api/auth/login", body={"username": "admin", "password": "Karim2026Demo"})
check("تسجيل دخول المدير", st == 200 and login.get("access_token"))
TOK = login["access_token"]

SUP = "مورد فحص المشتريات 2026"
INV_NO = "AUD-PROC-2026-001"

# ── تنظيف أي آثار من تشغيل سابق (ولقطة ما قبل الفحص) ────────────────────────
old = sql(f"SELECT id::text FROM suppliers WHERE name='{SUP}'")
for r in old:
    sql(f"DELETE FROM supplier_payments WHERE \"supplierId\"={r[0]}")
    sql(f"DELETE FROM suppliers WHERE id={r[0]}")
sql(f"DELETE FROM supplier_payments p USING \"purchaseInvoices\" i WHERE p.\"invoiceId\"=i.id AND i.\"invoiceNumber\"='{INV_NO}'")
sql(f"DELETE FROM inventory_ledger WHERE reference_type='purchase_invoice' AND reference_id IN (SELECT id::text FROM \"purchaseInvoices\" WHERE \"invoiceNumber\"='{INV_NO}')")
sql(f"DELETE FROM \"inventoryTx\" WHERE \"invoiceNumber\"='{INV_NO}'")
sql(f"DELETE FROM \"purchaseInvoices\" WHERE \"invoiceNumber\"='{INV_NO}'")

snap_items = {r[0]: (float(r[1]), float(r[2]), float(r[3] or 0)) for r in sql(
    'SELECT id::text, qty, "avgCost", COALESCE(weight,0) FROM inventory')}
# أرصدة المواقع تُلتقط مباشرة وتُعاد مباشرة — لا تُعاد الحساب من الليدجر
# (المخزون التاريخي القديم غير موثق كاملًا في الليدجر فتعاد الحساب تفسدها)
snap_bal = {(r[0], r[1]): float(r[2]) for r in sql(
    'SELECT inventory_id::text, location_id::text, on_hand FROM inventory_location_balances')}
snap_sum = int(sql('SELECT COUNT(*) FROM suppliers')[0][0])
print(f"  لقطة: {len(snap_items)} صنف، {snap_sum} مورد")

# بضاعة متاحة في المخزن الرئيسي
item = None
for r in sql('SELECT i.id::text, i.name, b.on_hand, i."avgCost", i.unit '
             'FROM inventory i JOIN inventory_location_balances b ON b.inventory_id=i.id '
             'JOIN inventory_locations l ON l.id=b.location_id '
             'WHERE l.code=\'MAIN-WAREHOUSE\' AND b.on_hand>=5 ORDER BY i.id LIMIT 1'):
    item = r
if not item:
    print("لا توجد بضاعة كافية — فشل"); sys.exit(1)
ITEM_ID, ITEM_NAME, ITEM_QTY, ITEM_COST, ITEM_UNIT = item[0], item[1], float(item[2]), float(item[3]), item[4]
P_QTY, P_PRICE = 10, ITEM_COST
P_TOTAL = round(P_QTY * P_PRICE, 2)
print(f"  بضاعة الفحص: {ITEM_NAME} — كمية {P_QTY} × {P_PRICE} = {P_TOTAL}")

# ── 1) دليل الموردين ─────────────────────────────────────────────────────────
print("\n■ دليل الموردين")
st, before_sum = api("GET", "/api/procurement/summary", TOK)
check("GET /procurement/summary يعمل", st == 200 and "dueTotal" in before_sum)

st, sup = api("POST", "/api/procurement/suppliers", TOK,
              {"name": SUP, "phone": "0555123456", "category": "فحص", "openingBalance": 100})
check("إنشاء مورد برصيد افتتاحي 100", st == 201 and sup.get("id") and float(sup.get("openingBalance")) == 100, f"id={sup.get('id')}")
SID = sup["id"]

st, dup = api("POST", "/api/procurement/suppliers", TOK, {"name": SUP})
check("رفض تكرار اسم المورد (409)", st == 409 and dup.get("error") == "SUPPLIER_DUPLICATE")

st, bad = api("POST", "/api/procurement/suppliers", TOK, {})
check("رفض حمولة ناقصة (422)", st == 422 and bad.get("error") == "INVALID_SUPPLIER")

st, neg = api("POST", "/api/procurement/suppliers", TOK, {"name": "رصيد سالب", "openingBalance": -5})
check("رفض رصيد افتتاحي سالب (422)", st == 422)
if st == 201: sql(f"DELETE FROM suppliers WHERE id={neg['id']}")

st, lst = api("GET", "/api/procurement/suppliers", TOK)
row = next((s for s in lst if str(s["id"]) == str(SID)), None)
check("قائمة الموردين تتضمن المورد الجديد بحقول محسوبة", row is not None and row.get("dueTotal") == 100,
      f"dueTotal={row.get('dueTotal') if row else None}")

# ── 2) فاتورة شراء مرتبطة (آجل) ──────────────────────────────────────────────
print("\n■ فاتورة شراء مرتبطة بمورد (آجل)")
st, inv = api("POST", "/api/warehouse/purchase-invoices", TOK, {
    "invoiceNumber": INV_NO, "date": time.strftime("%Y-%m-%d"),
    "supplierId": SID, "paymentMethod": "credit",
    "items": [{"itemName": ITEM_NAME, "itemId": int(ITEM_ID), "category": "فحص",
               "unit": ITEM_UNIT, "qty": P_QTY, "price": P_PRICE}]})
check("إنشاء الفاتورة المرتبطة (201)", st == 201 and inv.get("invoice", {}).get("id"))
INV_ID = str(inv["invoice"]["id"])
check("حالة السداد unpaid والمسدد 0", inv["invoice"]["paymentStatus"] == "unpaid" and float(inv["invoice"]["paidAmount"]) == 0)
check("الفاتورة مرتبطة بمعرف المورد", str(inv["invoice"].get("supplierId")) == str(SID))
check("اسم المورد اتحد تلقائيًا في الفاتورة", inv["invoice"].get("supplierName") == SUP)

led = sql(f"SELECT quantity_delta FROM inventory_ledger WHERE reference_type='purchase_invoice' AND reference_id='{INV_ID}'")
check("استلام مخزني فعلي في الليدجر (+10)", len(led) == 1 and abs(float(led[0][0]) - P_QTY) < 0.001)

qty_now = float(sql(f'SELECT qty FROM inventory WHERE id={ITEM_ID}')[0][0])
check("رصيد الصنف زاد فعليًا", abs(qty_now - (snap_items[ITEM_ID][0] + P_QTY)) < 0.001, f"{snap_items[ITEM_ID][0]} → {qty_now}")

st, lst = api("GET", "/api/procurement/suppliers", TOK)
row = next((s for s in lst if str(s["id"]) == str(SID)), None)
check("رصيد المورد = 100 + فاتورته = المستحق الصحيح", row and abs(row["dueTotal"] - (100 + P_TOTAL)) < 0.01, f"dueTotal={row.get('dueTotal')}")
check("عدد فواتير المورد وإجمالي مشترياته صحيح", row and row["invoiceCount"] == 1 and abs(row["purchasesTotal"] - P_TOTAL) < 0.01)

# ── 3) كشف الحساب ────────────────────────────────────────────────────────────
print("\n■ كشف الحساب")
st, stmt = api("GET", f"/api/procurement/suppliers/{SID}/statement", TOK)
check("توليد الكشف", st == 200 and stmt.get("statement"))
s = stmt["statement"]
check("رصيد افتتاحي للفترة = 100", s["openingBalance"] == 100, f"opening={s['openingBalance']}")
check("صف فاتورة مدين برصيد جارٍ 220", len(s["rows"]) == 1 and s["rows"][0]["type"] == "invoice" and abs(s["rows"][0]["balance"] - (100 + P_TOTAL)) < 0.01)
check("الختامي = 220", abs(s["totals"]["closing"] - (100 + P_TOTAL)) < 0.01)

st, stmt2 = api("GET", f"/api/procurement/suppliers/{SID}/statement?from=2099-01-01", TOK)
check("فلتر من تاريخ مستقبلي → كشف فارغ برصيد مطوي 220", stmt2["statement"]["rows"] == [] and abs(stmt2["statement"]["openingBalance"] - (100 + P_TOTAL)) < 0.01,
      f"opening={stmt2['statement']['openingBalance']}")

# ── 4) الدفعات ───────────────────────────────────────────────────────────────
print("\n■ الدفعات")
st, pay1 = api("POST", "/api/procurement/payments", TOK,
               {"supplierId": SID, "amount": 30, "method": "cash", "date": time.strftime("%Y-%m-%d"), "invoiceId": int(INV_ID)})
check("دفعة جزئية 30 مرتبطة بالفاتورة", st == 201 and float(pay1["payment"]["amount"]) == 30)
check("الفاتورة صارت partial (مسدد 30)", pay1["invoice"]["paymentStatus"] == "partial" and float(pay1["invoice"]["paidAmount"]) == 30)
check("المستحق في الرد = افتتاحي 100 + فاتورة 100 − دفعة 30 = 170", abs(pay1["supplierDueTotal"] - (100 + P_TOTAL - 30)) < 0.01, f"due={pay1['supplierDueTotal']}")

st, over = api("POST", "/api/procurement/payments", TOK,
               {"supplierId": SID, "amount": 999, "method": "cash", "date": time.strftime("%Y-%m-%d"), "invoiceId": int(INV_ID)})
check("رفض دفعة أكبر من المتبقي (422)", st == 422 and over.get("error") == "AMOUNT_EXCEEDS_REMAINING", f"remaining={over.get('remaining')}")

st, pay2 = api("POST", f"/api/procurement/invoices/{INV_ID}/pay", TOK, {"method": "bank"})
check("تسديد كامل المتبقي عبر بوابة /pay", st == 201 and abs(float(pay2["payment"]["amount"]) - (P_TOTAL - 30)) < 0.01, f"amount={pay2['payment']['amount']}")
PAY_FULL_ID = pay2["payment"]["id"]
check("الفاتورة صارت paid بالكامل", pay2["invoice"]["paymentStatus"] == "paid" and abs(float(pay2["invoice"]["paidAmount"]) - P_TOTAL) < 0.01)

st, lst = api("GET", "/api/procurement/suppliers", TOK)
row = next((s for s in lst if str(s["id"]) == str(SID)), None)
check("بعد التسديد الكامل: المستحق رجع للرصيد الافتتاحي 100", row and abs(row["dueTotal"] - 100) < 0.01, f"due={row.get('dueTotal') if row else None}")

st, pays = api("GET", f"/api/procurement/payments?supplierId={SID}", TOK)
check("قائمة الدفعات مرشحة بالمورد (دفعتان = إجمالي الفاتورة)", st == 200 and len(pays) == 2 and abs(sum(float(p["amount"]) for p in pays) - P_TOTAL) < 0.01, f"sum={sum(float(p['amount']) for p in pays)}")

# ── 5) الحمايات ──────────────────────────────────────────────────────────────
print("\n■ الحمايات")
st, _ = api("POST", f"/api/procurement/suppliers/{SID}/toggle", TOK)
check("إيقاف المورد", st == 200 and _["is_active"] is False)
st, pf = api("POST", "/api/procurement/payments", TOK, {"supplierId": SID, "amount": 5, "date": time.strftime("%Y-%m-%d")})
check("رفض دفعة لمورد موقوف (409)", st == 409 and pf.get("error") == "SUPPLIER_INACTIVE")
st, inf = api("POST", "/api/warehouse/purchase-invoices", TOK, {
    "invoiceNumber": "AUD-PROC-BLOCKED", "supplierId": SID, "paymentMethod": "cash",
    "items": [{"itemName": ITEM_NAME, "itemId": int(ITEM_ID), "qty": 1, "price": P_PRICE}]})
check("رفض فاتورة لمورد موقوف (409)", st == 409 and inf.get("error") == "SUPPLIER_INACTIVE")
st, _ = api("POST", f"/api/procurement/suppliers/{SID}/toggle", TOK)
check("إعادة تفعيل المورد", st == 200 and _["is_active"] is True)

st, delf = api("DELETE", f"/api/procurement/suppliers/{SID}", TOK)
check("رفض حذف مورد له حركات (409)", st == 409 and delf.get("error") == "SUPPLIER_HAS_TRANSACTIONS")

st, tmp = api("POST", "/api/procurement/suppliers", TOK, {"name": "مورد نظيف مؤقت فحص"})
check("إنشاء مورد نظيف للحذف", st == 201)
st, d = api("DELETE", f"/api/procurement/suppliers/{tmp['id']}", TOK)
check("حذف مورد بلا حركات ينجح", st == 200 and d.get("ok") is True)

# ── 6) عكس دفعة + اتساق الملخص ───────────────────────────────────────────────
print("\n■ العكس واتساق الملخص")
pays = sql(f"SELECT id::text, amount FROM supplier_payments WHERE \"supplierId\"={SID} ORDER BY id")
st, rev = api("DELETE", f"/api/procurement/payments/{PAY_FULL_ID}", TOK)
check("عكس دفعة التسديد الكامل (admin)", st == 200 and rev.get("ok"))
check("الفاتورة رجعت partial بعد العكس", rev["invoice"]["paymentStatus"] == "partial" and abs(float(rev["invoice"]["paidAmount"]) - 30) < 0.01, f"paid={rev['invoice']['paidAmount']}")

st, after_sum = api("GET", "/api/procurement/summary", TOK)
due_expected = 100 + P_TOTAL - 30  # افتتاحي + فاتورة − الدفعة الجزئية المتبقية
check("ملخص المركز متسق رياضيًا (قبل + مستحق الفحص = بعد)",
      abs(after_sum["dueTotal"] - (before_sum["dueTotal"] + due_expected)) < 0.01,
      f"before={before_sum['dueTotal']} after={after_sum['dueTotal']} expected={before_sum['dueTotal'] + due_expected}")
check("عدد الفواتير غير المسددة زاد بواحدة", after_sum["unpaidInvoices"] == before_sum["unpaidInvoices"] + 1)

# ── 7) تنظيف كامل: مطابقة القطة تمامًا ───────────────────────────────────────
print("\n■ التنظيف")
sql(f"DELETE FROM supplier_payments WHERE \"supplierId\"={SID}")
sql(f"DELETE FROM inventory_ledger WHERE reference_type='purchase_invoice' AND reference_id='{INV_ID}'")
sql(f"DELETE FROM \"inventoryTx\" WHERE \"invoiceNumber\"='{INV_NO}'")
sql(f"DELETE FROM \"purchaseInvoices\" WHERE id={INV_ID}")
sql(f"DELETE FROM suppliers WHERE id={SID}")
sql(f"DELETE FROM suppliers WHERE name IN ('رصيد سالب','مورد نظيف مؤقت فحص')")
# استعادة مباشرة من اللقطة (أرصدة المواقع + الإجماليات + التكلفة)
for (iid, lid), val in snap_bal.items():
    sql(f"UPDATE inventory_location_balances SET on_hand={val} WHERE inventory_id={iid} AND location_id={lid}")
for iid, (old_qty, old_cost, old_weight) in snap_items.items():
    sql(f'UPDATE inventory SET qty={old_qty}, "avgCost"={old_cost}, weight={old_weight} WHERE id={iid}')

now_items = {r[0]: (float(r[1]), float(r[2]), float(r[3] or 0)) for r in sql(
    'SELECT id::text, qty, "avgCost", COALESCE(weight,0) FROM inventory')}
now_bal = {(r[0], r[1]): float(r[2]) for r in sql(
    'SELECT inventory_id::text, location_id::text, on_hand FROM inventory_location_balances')}
check("أرصدة الأصناف مطابقة للقطة تمامًا", now_items == snap_items)
check("أرصدة مواقع المخزن مطابقة للقطة تمامًا", now_bal == snap_bal)
n_sup = int(sql('SELECT COUNT(*) FROM suppliers')[0][0])
check("الموردون رجعوا لعدّ ما قبل الفحص", n_sup == snap_sum, f"{snap_sum} → {n_sup}")
st, final_sum = api("GET", "/api/procurement/summary", TOK)
check("ملخص المستحق رجع لما قبل الفحص", abs(final_sum["dueTotal"] - before_sum["dueTotal"]) < 0.01,
      f"{before_sum['dueTotal']} → {final_sum['dueTotal']}")

print("\n" + "═" * 68)
print(f"النتيجة النهائية: {PASS} PASS / {FAIL} FAIL")
print("═" * 68)
sys.exit(1 if FAIL else 0)
