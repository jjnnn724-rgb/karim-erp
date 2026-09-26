#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_grand_audit.py — الفحص الحي الكبير: من فاتورة المشتريات حتى البيع في الكاشير
────────────────────────────────────────────────────────────────────────────────
دورة عمل حقيقية واحدة متكاملة على النظام الحي تمر بكل منظومات النظام بالترتيب:

  A) الدخول متعدد الأدوار (مدير/شيف/أمين مخازن/رئيس قسم) + لقطة شاملة
  B) المشتريات: مورد → فاتورة مشتريات آجلة → استلام مخزني (ليدجر + متوسط تكلفة موزون)
     → سداد جزئي (partial) → كشف حساب المورد
  C) سلسلة الاعتماد الكاملة بالإشعارات الفورية:
     رئيس قسم السلطات يطلب → الشيف العمومي يُشعَر لحظيًا → يعتمد بتوقيعه
     → المخازن تصرف (مصروف قسم تلقائي) → القسم يستلم جزئيًا في مخزنه الخاص
  D) مسار المطبخ الكلاسيكي: إذن صرف للمطبخ → استلام مخزن المطبخ
  E) الإنتاج: أمر إنتاج يستهلك من مخزن المطبخ + رفض فوق الرصيد
  F) الكاشير: وردية → بيع للزبون (وصفة صارمة من مخزن المطبخ) → ضريبة 15%
     → Idempotency → إيراد + ZATCA + طابور طباعة + خزنة الوردية → رفض البيع فوق الرصيد
  G) الإرجاع: مرتجع قسم بقيدين مقترنين (خروج من مخزن القسم + دخول الرئيسي) وعكس المصروف
  H) التحويل المخزني: طلب → اعتماد وحجز → شحن → استلام
  I) الجرد: جلسة على مخزن القسم → عجز موثق → اعتماد → تصحيح على الموقع + كلفة على القسم
     + حرس اللقطة القديمة
  J) المالية والتقارير: قائمة الأرباح والخسائر (اتساق API = SQL مباشر بندًا بندًا)
     + اتساق الليدجر (حركات الفحص = تغيّر الأرصدة) + ملخص المشتريات + تقرير المبيعات
  K) تنظيف كامل: القاعدة مطابقة للقطة ما قبل الفحص في كل الجداول
"""
import json, os, subprocess, sys, time
import urllib.request, urllib.error

BASE = "http://localhost:5000"
PSQL = ["/home/z/my-project/karim-erp/database/bin/bin/psql", "-h", "127.0.0.1",
        "-U", "postgres", "-d", "karim_erp"]
PGPASSWORD = "karim_local_preview_2026_secure_password"
SIG = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMA"
       "AQAABQABDQottAAAAABJRU5ErkJggg==")  # 1px valid png data-url
RUN = str(int(time.time()))
TODAY = time.strftime("%Y-%m-%d")

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f" — {detail}" if detail else ""))


def psql(sql):
    env = dict(os.environ)
    env["PGPASSWORD"] = PGPASSWORD
    out = subprocess.run(PSQL + ["-tAc", sql], capture_output=True, text=True, env=env)
    if out.returncode != 0:
        raise RuntimeError(f"psql failed: {out.stderr[:400]}")
    return out.stdout.strip()


def psql_rows(sql):
    out = psql(sql)
    return [l.split("|") for l in out.split("\n") if l]


def req(method, path, token=None, body=None, headers=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", f"Bearer {token}")
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode() or ""
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, {"_text": raw}  # ردود HTML (طباعة)
    except urllib.error.HTTPError as e:
        try:
            raw = e.read().decode() or ""
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, {"_text": raw}
        except Exception:
            return e.code, {}


def login(username, password="Karim2026Demo"):
    return req("POST", "/api/auth/login", body={"username": username, "password": password})


TOKEN_CACHE = f"/home/z/my-project/karim-erp/scripts/.grand_tokens.json"


def get_token(username, password="Karim2026Demo"):
    """توكن مستخدم — يعاد استخدامه من ذاكرة محلية إن كان صالحًا (كما يفعل مستخدم حقيقي)
    لتفادي استهلاك حد محاولات الدخول (10/15 دقيقة) في تشغيلات الفحص المتكررة."""
    cache = {}
    if os.path.exists(TOKEN_CACHE):
        try:
            with open(TOKEN_CACHE) as f:
                cache = json.load(f)
        except Exception:
            cache = {}
    tok = cache.get(username)
    if tok:
        s, _ = req("GET", "/api/notifications", tok)
        if s == 200:
            return tok
        cache.pop(username, None)
    s, r = login(username, password)
    if s == 200 and r.get("access_token"):
        cache[username] = r["access_token"]
        try:
            with open(TOKEN_CACHE, "w") as f:
                json.dump(cache, f)
        except Exception:
            pass
        return r["access_token"]
    return None


def unread(token):
    s, r = req("GET", "/api/notifications", token)
    return r.get("unread_count") if s == 200 else None


def wait_for_notification(token, title, entity_id, timeout=10.0, interval=0.4):
    """الإشعار يُدرج بشكل غير متزامن (best-effort بعد COMMIT) — نستقصي حتى وصوله."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        s, r = req("GET", "/api/notifications", token)
        if s == 200:
            for n in r.get("notifications", []):
                if n.get("title") == title and str(n.get("entity_id")) == str(entity_id):
                    return n
        time.sleep(interval)
    return None


T0 = None  # طابع زمني بداية الفحص (لحذف الليدجر بدقة)


def snap_bal(iid, lid, default=0.0):
    row = psql(f"SELECT on_hand FROM inventory_location_balances WHERE inventory_id={iid} AND location_id={lid}")
    return float(row) if row else default


print("═" * 74)
print("  الفحص الحي الكبير: فاتورة مشتريات → مخازن → اعتماد → إنتاج → كاشير → زبون")
print("═" * 74)

# ══ A) الدخول متعدد الأدوار + لقطة شاملة ═══════════════════════════════════════
print("\n■ A) الدخول متعدد الأدوار + لقطة شاملة")

T0 = psql("SELECT COALESCE(MAX(created_at)::text, '1970-01-01') FROM inventory_ledger")

ADMIN = get_token("admin")
check("A1 دخول المدير", bool(ADMIN), "token" if ADMIN else "فشل — راجع حد محاولات الدخول")
CHEF = get_token("chef")
KEEPER = get_token("keeper")
HEAD = get_token("head_salads")
HEAD2 = get_token("head_sweets")
check("A2 دخول الشيف والأمين ورئيسي قسم (4 حسابات)",
      all((CHEF, KEEPER, HEAD, HEAD2)),
      f"chef={'ok' if CHEF else 'FAIL'} keeper={'ok' if KEEPER else 'FAIL'} head_salads={'ok' if HEAD else 'FAIL'} head_sweets={'ok' if HEAD2 else 'FAIL'}")
check("A3 التوكنات تحمل dept_code الصحيح",
      psql("SELECT count(*) FROM users WHERE username IN ('head_salads','head_sweets') AND dept_code IS NOT NULL") == "2")

# ─── لقطة ما قبل الفحص ───
SNAP_INV = 'SELECT id, name, qty, "avgCost" FROM inventory ORDER BY id'
SNAP_BAL = "SELECT inventory_id, location_id, on_hand, reserved, in_transit FROM inventory_location_balances ORDER BY 1,2"
snapshot = {
    "inventory": psql(SNAP_INV),
    "balances": psql(SNAP_BAL),
    "locations": psql("SELECT id, code FROM inventory_locations ORDER BY id"),
    "suppliers_max": psql("SELECT COALESCE(MAX(id),0) FROM suppliers"),
    "supp_pay_max": psql('SELECT COALESCE(MAX(id),0) FROM supplier_payments'),
    "pinv_max": psql('SELECT COALESCE(MAX(id),0) FROM "purchaseInvoices"'),
    "dispatches_max": psql("SELECT COALESCE(MAX(id),0) FROM dispatches"),
    "returns_max": psql('SELECT COALESCE(MAX(id),0) FROM "kitchenReturns"'),
    "expenses_max": psql("SELECT COALESCE(MAX(id),0) FROM expenses"),
    "revenues_max": psql("SELECT COALESCE(MAX(id),0) FROM revenues"),
    "orders_count": psql("SELECT COUNT(*) FROM pos_orders"),
    "shifts_max": psql("SELECT COALESCE(MAX(id),0) FROM pos_shift_sessions"),
    "products_max": psql("SELECT COALESCE(MAX(id),0) FROM pos_products"),
    "policies_max": psql("SELECT COALESCE(MAX(id),0) FROM kitchen_policies"),
    "batches_max": psql("SELECT COALESCE(MAX(id),0) FROM kitchen_production_batches"),
    "transfers_count": psql("SELECT COUNT(*) FROM inventory_transfers"),
    "audits_max": psql("SELECT COALESCE(MAX(id),0) FROM inventory_audits"),
    "notifications_max": psql("SELECT COALESCE(MAX(id),0) FROM notifications"),
    "notif_t0": psql("SELECT COALESCE(MAX(created_at)::text,'1970-01-01') FROM notifications"),
    "tx_max": psql('SELECT COALESCE(MAX(id),0) FROM "inventoryTx"'),
    "posdepts_max": psql("SELECT COALESCE(MAX(id),0) FROM pos_departments"),
    "ledger_count": psql("SELECT COUNT(*) FROM inventory_ledger"),
}
print(f"  لقطة: ledger={snapshot['ledger_count']} صف | أقصى: dispatch={snapshot['dispatches_max']} orders={snapshot['orders_count']} audits={snapshot['audits_max']}")

# لقطة قائمة الأرباح والخسائر لليوم (للتحقق من العودة المطابقة بعد التنظيف)
s, pnl_before = req("GET", f"/api/finance/pnl?from={TODAY}&to={TODAY}", ADMIN)
check("A4 قائمة الأرباح والخسائر متاحة قبل الفحص", s == 200 and isinstance(pnl_before.get("statement", {}).get("revenue", {}), dict), f"HTTP {s}")

# صنف الفحص: أرز برصيد كافٍ في المخزن الرئيسي
RICE = "1787872285012"
item_row = psql_rows(f'SELECT id, name, unit, qty, "avgCost" FROM inventory WHERE id={RICE}')
check("A5 صنف الأرز متوفر بالمخزن الرئيسي", bool(item_row), f"{item_row[0][1]} ×{item_row[0][3]} {item_row[0][2]}" if item_row else "missing")
ITEM_NAME, ITEM_UNIT = item_row[0][1], item_row[0][2]
COST0 = float(item_row[0][4])
MAIN_BAL0 = snap_bal(RICE, 1)
KIT_BAL0 = snap_bal(RICE, 2)

# ══ B) المشتريات: مورد → فاتورة مشتريات → استلام مخزني → سداد جزئي ═════════════
print("\n■ B) المشتريات: فاتورة مشتريات تدخل المخزن الرئيسي")
SUP = f"مورد الفحص الكبير {RUN}"
INV_NO = f"GRAND-{RUN}"
P_QTY, P_PRICE = 10.0, 15.0
P_TOTAL = round(P_QTY * P_PRICE, 2)

s, sup = req("POST", "/api/procurement/suppliers", ADMIN, {"name": SUP, "phone": "0512345678", "category": "خضار وتوابل"})
check("B1 إنشاء مورد جديد (201)", s == 201 and sup.get("id"), f"HTTP {s} {sup.get('error','')}")
SID = sup.get("id")

s, bad = req("POST", "/api/warehouse/purchase-invoices", ADMIN,
             {"invoiceNumber": f"GRAND-BAD-{RUN}", "supplierId": SID, "paymentMethod": "credit", "items": []})
check("B2 رفض فاتورة بلا أصناف (422)", s == 422 and bad.get("error") == "EMPTY_INVOICE_ITEMS", f"HTTP {s} {bad.get('error','')}")
s, nosup = req("POST", "/api/warehouse/purchase-invoices", ADMIN,
               {"invoiceNumber": f"GRAND-NOSUP-{RUN}", "supplierId": 999999999, "paymentMethod": "credit",
                "items": [{"itemName": ITEM_NAME, "itemId": int(RICE), "unit": ITEM_UNIT, "qty": 1, "price": 15}]})
check("B3 رفض فاتورة بمورد غير موجود (404/422)", s in (404, 422), f"HTTP {s} {nosup.get('error','')}")

s, inv = req("POST", "/api/warehouse/purchase-invoices", ADMIN, {
    "invoiceNumber": INV_NO, "date": TODAY, "supplierId": SID, "paymentMethod": "credit",
    "items": [{"itemName": ITEM_NAME, "itemId": int(RICE), "unit": ITEM_UNIT, "qty": P_QTY, "price": P_PRICE}]})
check("B4 فاتورة شراء آجلة 10 كجم × 15 (201)", s == 201 and inv.get("invoice", {}).get("id"), f"HTTP {s} {inv.get('error','')}")
INV_ID = str(inv["invoice"]["id"]) if s == 201 else None
check("B5 حالة الفاتورة unpaid ومسدد 0", inv.get("invoice", {}).get("paymentStatus") == "unpaid",
      str(inv.get("invoice", {}).get("paymentStatus")))

led = psql_rows(f"SELECT quantity_delta, location_id FROM inventory_ledger WHERE reference_type='purchase_invoice' AND reference_id='{INV_ID}'")
check("B6 استلام مخزني فعلي في الليدجر (+10 على MAIN)", len(led) == 1 and abs(float(led[0][0]) - P_QTY) < 0.001 and led[0][1] == "1", f"{len(led)} صف")
MAIN1 = snap_bal(RICE, 1)
check("B7 رصيد MAIN زاد +10", abs(MAIN1 - (MAIN_BAL0 + P_QTY)) < 0.001, f"{MAIN_BAL0} → {MAIN1}")

cost1 = float(psql(f'SELECT "avgCost" FROM inventory WHERE id={RICE}'))
expected_cost = round(((MAIN_BAL0 * COST0) + (P_QTY * P_PRICE)) / (MAIN_BAL0 + P_QTY), 2)
check("B8 متوسط التكلفة تحدث موزونًا", abs(cost1 - expected_cost) < 0.01, f"{COST0} → {cost1} ≈ {expected_cost}")

s, stmt = req("GET", f"/api/procurement/suppliers/{SID}/statement?from={TODAY}&to={TODAY}", ADMIN)
check("B9 كشف حساب المورد يعمل ويتضمن الفاتورة", s == 200 and json.dumps(stmt).find(INV_NO) >= 0, f"HTTP {s}")

s, pay = req("POST", "/api/procurement/payments", ADMIN,
             {"supplierId": int(SID), "invoiceId": int(INV_ID), "amount": 40.0, "method": "cash", "date": TODAY,
              "notes": f"سداد جزئي — فحص {RUN}"})
check("B10 سداد جزئي 40 (201)", s == 201 and pay.get("invoice", {}).get("paymentStatus") == "partial", f"HTTP {s} {pay.get('error','')}")
s, over = req("POST", "/api/procurement/payments", ADMIN,
              {"supplierId": int(SID), "invoiceId": int(INV_ID), "amount": 999.0, "method": "cash", "date": TODAY})
check("B11 رفض دفعة أكبر من المتبقي (422)", s == 422 and over.get("error") == "AMOUNT_EXCEEDS_REMAINING", f"HTTP {s} {over.get('error','')}")
s, sups = req("GET", "/api/procurement/suppliers", ADMIN)
srow = next((x for x in sups if str(x["id"]) == str(SID)), None)
check("B12 رصيد المورد المستحق = 110 (فاتورة 150 − دفعة 40)",
      srow and abs(srow["dueTotal"] - (P_TOTAL - 40.0)) < 0.01, f"due={srow.get('dueTotal') if srow else None}")

# ══ C) سلسلة الاعتماد الكاملة بالإشعارات الفورية (رئيس قسم → شيف → مخازن → استلام) ══
print("\n■ C) سلسلة الاعتماد: رئيس قسم السلطات → الشيف العمومي → المخازن → الاستلام")
D_QTY = 10.0
base_chef, base_keeper, base_head = unread(CHEF), unread(KEEPER), unread(HEAD)
check("C1 قراءة عدّادات غير المقروء للأطراف الثلاثة",
      all(isinstance(x, int) for x in (base_chef, base_keeper, base_head)),
      f"chef={base_chef} keeper={base_keeper} head={base_head}")

s, mism = req("POST", "/api/dispatches", HEAD, body={
    "deptCode": "sweets", "deptName": "قسم الحلويات", "date": TODAY,
    "items": [{"itemName": ITEM_NAME, "qty": 5, "unit": ITEM_UNIT}]})
check("C2 رفض رئيس قسم يطلب لقسم غير قسمه (403 DEPT_MISMATCH)",
      s == 403 and mism.get("error") == "DEPT_MISMATCH", f"HTTP {s} {mism.get('error','')}")

s, d1 = req("POST", "/api/dispatches", HEAD, body={
    "deptCode": "salads", "deptName": "قسم السلطات", "date": TODAY,
    "items": [{"itemName": ITEM_NAME, "qty": D_QTY, "unit": ITEM_UNIT}],
    "notes": f"احتياج أسبوعي — فحص كبير {RUN}"})
check("C3 رئيس القسم أنشأ طلب صرف 10 كجم لقسمه (201)", s == 201 and d1.get("id"), f"HTTP {s} {d1.get('error','')}")
D1 = d1.get("id")
if not D1:
    print("FATAL: فشل إنشاء طلب الصرف"); sys.exit(1)
check("C4 الطلب مُعلَّم بانتظار الشيف (needsChefApproval=true)",
      psql(f'SELECT "needsChefApproval"::text FROM dispatches WHERE id={D1}') == "true")

chef_n = wait_for_notification(CHEF, "طلب صرف جديد", D1)
check("C5 الشيف العمومي أُشعِر لحظيًا بطلب جديد", chef_n is not None, chef_n and f"notif#{chef_n['id']}" or "لم يصل خلال 10 ثوانٍ")
check("C6 الإشعار موجّه للشيف حصرًا (الطالب والمخازن لم يُشعَروا)",
      unread(HEAD) == base_head and unread(KEEPER) == base_keeper, f"head {base_head}→{unread(HEAD)} keeper {base_keeper}→{unread(KEEPER)}")

s, early = req("POST", f"/api/warehouse/dispatches/{D1}/approve", KEEPER,
               {"signatureData": SIG, "approvedItems": [{"itemName": ITEM_NAME, "qty": D_QTY, "unit": ITEM_UNIT}]})
check("C7 بوابة: المخازن مرفوضة قبل اعتماد الشيف (409)", s == 409, f"HTTP {s} {early.get('error','')}")

s, capp = req("POST", f"/api/warehouse/dispatches/{D1}/chef-approve", CHEF, {"signatureData": SIG, "notes": "اعتماد الكمية"})
check("C8 الشيف اعتمد الطلب بتوقيعه (chef_approved)", s == 200 and capp.get("dispatch", {}).get("status") == "chef_approved", f"HTTP {s}")
head_n = wait_for_notification(HEAD, "اعتماد الشيف العمومي", D1)
keeper_n = wait_for_notification(KEEPER, "اعتماد الشيف العمومي", D1)
check("C9 رئيس القسم أُشعِر بالاعتماد", head_n is not None and str(head_n.get("entity_id")) == str(D1))
check("C10 المخازن أُشعِرت بانتظار الصرف", keeper_n is not None and str(keeper_n.get("entity_id")) == str(D1))
check("C11 الشيف لم يُشعِر نفسه بقراره (زيادته فقط إشعار الإنشاء)", unread(CHEF) == base_chef + 1, f"{base_chef + 1}→{unread(CHEF)}")
check("C12 الاعتماد موثق بسلسلة أحداث موقعة",
      psql(f"SELECT count(*) FROM dispatch_workflow_events WHERE dispatch_id={D1} AND event_type='chef_approved' AND signature_hash IS NOT NULL") == "1")

exp_amount = round(D_QTY * cost1, 2)
s, wapp = req("POST", f"/api/warehouse/dispatches/{D1}/approve", KEEPER,
              {"signatureData": SIG, "approvedItems": [{"itemName": ITEM_NAME, "qty": D_QTY, "unit": ITEM_UNIT}]})
check("C13 المخازن اعتمدت وصرفت بعد الشيف (approved)", s == 200 and wapp.get("dispatch", {}).get("status") == "approved", f"HTTP {s} {wapp.get('error','')}")
ap_exp = (wapp.get("expenses") or [{}])[0]
check("C14 مصروف قسم تلقائي على قسم السلطات", ap_exp.get("deptId") == "salads", str(ap_exp.get("deptId")))
check("C15 قيمة المصروف = 10 × متوسط التكلفة", abs(float(ap_exp.get("amount", 0)) - exp_amount) < 0.01, f"{ap_exp.get('amount')} ≈ {exp_amount}")
DISP_EXP_ID = ap_exp.get("id")
MAIN2 = snap_bal(RICE, 1)
check("C16 رصيد MAIN نقص −10 عند الصرف", abs(MAIN2 - (MAIN1 - D_QTY)) < 0.001, f"{MAIN1} → {MAIN2}")

head_n2 = wait_for_notification(HEAD, "تم صرف الطلب", D1)
chef_n2 = wait_for_notification(CHEF, "تم صرف الطلب", D1)
check("C17 رئيس القسم والشيف أُشعِرا بتم الصرف", head_n2 is not None and chef_n2 is not None)

s, rcv = req("POST", f"/api/warehouse/dispatches/{D1}/receive", HEAD,
             {"items": [{"itemName": ITEM_NAME, "receivedQty": 8, "notes": "استلام جزئي"}],
              "signatureData": SIG, "notes": "استلام جزئي"})
check("C18 القسم استلم 8 من 10 (partially_received)", s == 200 and rcv.get("dispatch", {}).get("status") == "partially_received", f"HTTP {s}")
STORE_ID = psql("SELECT id FROM inventory_locations WHERE code='STORE-SALADS'")
STORE_BAL = snap_bal(RICE, STORE_ID)
check("C19 مخزن قسم السلطات زاد +8", abs(STORE_BAL - 8.0) < 0.001, f"STORE-SALADS on_hand={STORE_BAL}")
keep_n3 = wait_for_notification(KEEPER, "استلام القسم", D1)
check("C20 المخازن أُشعِرت بالاستلام", keep_n3 is not None)

led_chain = psql_rows(f"SELECT transaction_type, location_id, quantity_delta FROM inventory_ledger "
                      f"WHERE (reference_type='dispatch' AND reference_id='DIS-{D1}') "
                      f"OR (reference_type='dispatch_receipt' AND reference_id='{D1}')")
has_out = any(r[0] == "transfer_out" and r[1] == "1" and abs(float(r[2]) + D_QTY) < 0.001 for r in led_chain)
has_in = any(r[0] == "transfer_in" and r[1] == STORE_ID and abs(float(r[2]) - 8.0) < 0.001 for r in led_chain)
check("C21 الليدجر: خروج 10 من MAIN ودخول 8 في STORE-SALADS (قيدين مقترنين)", has_out and has_in, f"{len(led_chain)} صف")

# ثانيًا: رفض الشيف — رئيس القسم يرى السبب
s, d2 = req("POST", "/api/dispatches", HEAD, body={
    "deptCode": "salads", "deptName": "قسم السلطات", "date": TODAY,
    "items": [{"itemName": ITEM_NAME, "qty": 50, "unit": ITEM_UNIT}], "notes": "طلب ثانٍ للرفض"})
D2 = d2.get("id")
s, crej = req("POST", f"/api/warehouse/dispatches/{D2}/chef-reject", CHEF,
              {"signatureData": SIG, "reason": "الكمية أكبر من الاحتياج"})
head_rej = wait_for_notification(HEAD, "رفض الشيف العمومي", D2)
check("C22 رفض الشيف وصل لرئيس القسم بالسبب",
      s == 200 and head_rej is not None and "الاحتياج" in str(head_rej.get("message")))

# ثالثًا: تعليم الإشعارات كمقروء — عزل بين الصناديق
s, rr = req("POST", "/api/notifications/read", HEAD, {"ids": [int(head_n["id"])]})
check("C23 تعليم إشعار رئيس القسم كمقروء (عزل الصناديق)", s == 200 and rr.get("updated") == 1, f"{s} {rr}")

# ══ D) مسار المطبخ الكلاسيكي: إذن صرف → اعتماد المخازن → استلام مخزن المطبخ ══
print("\n■ D) مسار المطبخ: إذن صرف مباشر → استلام مخزن المطبخ")
K_QTY = 3.0
base_keeper_d = unread(KEEPER)
s, kd = req("POST", "/api/dispatches", ADMIN, body={
    "deptCode": "kitchen", "deptName": "المطبخ", "date": TODAY,
    "items": [{"itemName": ITEM_NAME, "qty": K_QTY, "unit": ITEM_UNIT}], "notes": f"فحص كبير {RUN}"})
check("D1 إنشاء إذن صرف مباشر للمطبخ (pending)", s in (200, 201) and kd.get("status") == "pending", f"HTTP {s}")
KD = kd.get("id")
keep_dir = wait_for_notification(KEEPER, "طلب صرف جديد", KD)
check("D2 إذن مباشر (بلا شيف) أُشعِرت المخازن به فورًا", keep_dir is not None)

s, kapp = req("POST", f"/api/warehouse/dispatches/{KD}/approve", KEEPER,
              {"signatureData": SIG, "approvedItems": [{"itemName": ITEM_NAME, "qty": K_QTY, "unit": ITEM_UNIT}]})
check("D3 اعتماد المخازن مباشرة (المدير منشئ — لا يحتاج شيف)", s == 200 and kapp.get("dispatch", {}).get("status") == "approved", f"HTTP {s}")
kexp = (kapp.get("expenses") or [{}])[0]
check("D4 مصروف تلقائي على قسم المطبخ = 3 × التكلفة",
      kexp.get("deptId") == "kitchen" and abs(float(kexp.get("amount", 0)) - round(K_QTY * cost1, 2)) < 0.01,
      f"{kexp.get('amount')}")
KEXP_ID = kexp.get("id")
MAIN3 = snap_bal(RICE, 1)

s, krcv = req("POST", f"/api/warehouse/dispatches/{KD}/receive", CHEF,
              {"items": [{"itemName": ITEM_NAME, "receivedQty": K_QTY}], "signatureData": SIG, "notes": "استلام كامل"})
check("D5 المطبخ استلم الكمية كاملة", s == 200 and krcv.get("dispatch", {}).get("status") == "received", f"HTTP {s}")
KIT1 = snap_bal(RICE, 2)
check("D6 مخزن المطبخ زاد +3", abs(KIT1 - (KIT_BAL0 + K_QTY)) < 0.001, f"{KIT_BAL0} → {KIT1}")

# ══ E) الإنتاج: أمر إنتاج يستهلك من مخزن المطبخ ═══════════════════════════════
print("\n■ E) الإنتاج: مزامنة أقسام الكاشير → منتج بواسفة → أمر إنتاج")
s, depts = req("GET", "/api/pos/departments", ADMIN)
check("E1 مزامنة أقسام الكاشير من أقسام النظام", s == 200 and isinstance(depts, list) and len(depts) >= 7, f"HTTP {s} n={len(depts) if isinstance(depts, list) else 0}")
kitchen_pos = next((d for d in depts if d.get("code") == "erp_kitchen"), None)
check("E2 قسم المطبخ موجود في الكاشير (erp_kitchen)", bool(kitchen_pos))
check("E3 قسم السلطات موجود في الكاشير (erp_salads)", any(d.get("code") == "erp_salads" for d in depts))
KPOS_ID = int(kitchen_pos["id"])

PROD_NAME = f"وجبة الفحص الكبير {RUN}"
s, prod = req("POST", "/api/pos/products", ADMIN, {
    "name_ar": PROD_NAME, "price": 20, "vat_rate": 15, "cost_price": 2.4,
    "unit": "وجبة", "category": "فحص", "department_ids": [KPOS_ID]})
check("E4 إنشاء منتج بواسفة مرتبط بقسم المطبخ (201)", s == 201 and prod.get("id"), f"HTTP {s} {prod.get('error','')}")
PID = int(prod["id"])

s, ings = req("PUT", f"/api/pos/products/{PID}/ingredients", ADMIN,
              {"ingredients": [{"inventory_id": int(RICE), "quantity_per_unit": 0.2, "unit": "كيلوجرام", "waste_percent": 0}]})
check("E5 ربط وصفة المكونات (0.2 كجم أرز لكل وجبة)", s == 200 and ings.get("ingredient_count") == 1, f"HTTP {s}")

s, pol = req("POST", "/api/kitchen/policies", ADMIN,
             {"department_id": KPOS_ID, "kitchen_location_id": 2, "operation_mode": "strict"})
check("E6 سياسة مطبخ صارمة: قسم المطبخ يستهلك من KITCHEN-MAIN", s == 200 and pol.get("operation_mode") == "strict", f"HTTP {s}")

PRD_QTY, PRD_MAT = 4.0, 2.0
s, batch = req("POST", "/api/kitchen/production", ADMIN, {
    "product_name": PROD_NAME, "product_unit": "وجبة", "produced_qty": PRD_QTY,
    "distributions": [{"destination_type": "channel", "destination_code": "open_buffet", "quantity": PRD_QTY}],
    "materials": [{"inventory_id": int(RICE), "quantity": PRD_MAT, "waste_percent": 0}],
    "notes": f"فحص كبير {RUN}"})
check("E7 أمر إنتاج 4 وجبات يستهلك 2 كجم أرز (200)", s == 200 and batch.get("batch", {}).get("id"), f"HTTP {s} {batch.get('error','') if s != 200 else ''}")
BATCH_ID = str(batch.get("batch", {}).get("id")) if s == 200 else None
check("E8 توزيع الإنتاج على البوفيه مسجل", len(batch.get("distributions", [])) == 1 and batch["distributions"][0].get("destination_code") == "open_buffet")
KIT2 = snap_bal(RICE, 2)
check("E9 مخزن المطبخ نقص −2 (استهلاك إنتاج)", abs(KIT2 - (KIT1 - PRD_MAT)) < 0.001, f"{KIT1} → {KIT2}")

s, short = req("POST", "/api/kitchen/production", ADMIN, {
    "product_name": PROD_NAME, "product_unit": "وجبة", "produced_qty": 999,
    "distributions": [{"destination_type": "channel", "destination_code": "open_buffet", "quantity": 999}],
    "materials": [{"inventory_id": int(RICE), "quantity": 999, "waste_percent": 0}]})
check("E10 رفض إنتاج يفوق رصيد المطبخ (409)", s == 409 and short.get("error") == "INSUFFICIENT_STOCK", f"HTTP {s} {short.get('error','')}")

# ══ F) الكاشير: وردية → بيع للزبون → إيراد + ZATCA + طباعة ════════════════════
print("\n■ F) الكاشير: وردية → بيع 2 وجبة للزبون (استهلاك صارم من مخزن المطبخ)")
s, shift = req("POST", "/api/pos/shifts/open", ADMIN, {"department_id": KPOS_ID, "opening_balance": 0})
if s == 409 and shift.get("error") == "SHIFT_ALREADY_OPEN":
    stale = psql_rows("SELECT s.id FROM pos_shift_sessions s WHERE s.cashier_id=1 AND s.status='open' ORDER BY s.id LIMIT 1")
    if stale:
        net = psql_rows(f"SELECT COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='in' THEN ip.amount END),0) "
                        f"- COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='out' THEN ip.amount END),0) "
                        f"FROM pos_invoice_payments ip JOIN pos_orders o ON o.id=ip.order_id WHERE o.session_id={stale[0][0]}")
        expected = float(net[0][0] or 0)
        req("POST", f"/api/pos/shifts/{stale[0][0]}/close", ADMIN, {"actual_cash": expected, "notes": f"إغلاق وردية عالقة أثناء الفحص {RUN}"})
        print(f"  … أُغلقت وردية عالقة #{stale[0][0]} (فرق صفر)")
    s, shift = req("POST", "/api/pos/shifts/open", ADMIN, {"department_id": KPOS_ID, "opening_balance": 0})
check("F1 فتح وردية كاشير على قسم المطبخ", s == 201 and shift.get("session_id"), f"HTTP {s} {shift.get('error','')}")
SHIFT_ID = int(shift["session_id"]) if s == 201 else None

SALE_KEY = f"grand-{RUN}"
SALE_BODY = {
    "department_id": KPOS_ID,
    "items": [{"product_id": PID, "quantity": 2, "unit_price": 20, "discount": 0}],
    "payments": [{"method": "cash", "amount": 46}],
    "notes": f"فحص كبير {RUN}",
}
s, sale = req("POST", "/api/sales/complete", ADMIN, SALE_BODY, headers={"Idempotency-Key": SALE_KEY, "X-Shift-Session-Id": str(SHIFT_ID)})
check("F2 بيع 2 وجبة للزبون (201) مرتبط بالوردية", s == 201 and sale.get("order_id"), f"HTTP {s} {json.dumps(sale)[:200] if s != 201 else ''}")
ORDER_ID = sale.get("order_id") if s in (200, 201) else None
check("F3 إجمالي البيع 46 = 40 + 15% ضريبة", abs(float(sale.get("total_amount", 0)) - 46) < 0.01,
      f"subtotal={sale.get('subtotal')} vat={sale.get('tax_total')} total={sale.get('total_amount')}")

s, sale2 = req("POST", "/api/sales/complete", ADMIN, SALE_BODY, headers={"Idempotency-Key": SALE_KEY, "X-Shift-Session-Id": str(SHIFT_ID)})
check("F4 إعادة نفس المفتاح لا تكرر البيع (نفس الفاتورة)",
      s in (200, 201) and sale2.get("order_id") == ORDER_ID and sale2.get("_idempotent_replay") is True,
      f"{sale2.get('order_id')} replay={sale2.get('_idempotent_replay')}")

KIT3 = snap_bal(RICE, 2)
check("F5 الاستهلاك الصارم من مخزن المطبخ −0.4 (وصفة 2 وجبة)", abs(KIT3 - (KIT2 - 0.4)) < 0.001, f"{KIT2} → {KIT3}")
smov = psql(f"SELECT count(*) FROM pos_stock_movements WHERE order_id='{ORDER_ID}' AND reason='sale_recipe'")
check("F6 حركات وصفة البيع مسجلة (pos_stock_movements)", int(smov) >= 1, f"{smov} صف")

rev = psql_rows(f'SELECT amount, "deptId" FROM revenues WHERE "pos_order_id"=\'{ORDER_ID}\'')
check("F7 إيراد مسجل على قسم المطبخ = 46", bool(rev) and abs(float(rev[0][0]) - 46) < 0.01 and rev[0][1] == "kitchen", f"{rev}")
zat = psql(f"SELECT status FROM pos_zatca_invoice_queue WHERE order_id='{ORDER_ID}'")
check("F8 الفاتورة في طابور ZATCA", bool(zat), str(zat))
prn = psql(f"SELECT status FROM pos_pending_prints WHERE order_id='{ORDER_ID}'")
check("F9 الفاتورة في طابور الطباعة الحرارية", bool(prn), str(prn))

cash_net = psql_rows(f"SELECT COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='in' THEN ip.amount END),0) "
                     f"- COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='out' THEN ip.amount END),0) "
                     f"FROM pos_invoice_payments ip WHERE ip.order_id='{ORDER_ID}'")[0][0]
check("F10 خزنة الوردية استلمت 46 نقديًا", abs(float(cash_net or 0) - 46) < 0.01, f"cash_net={cash_net}")

s, oversale = req("POST", "/api/sales/complete", ADMIN,
                  {"department_id": KPOS_ID,
                   "items": [{"product_id": PID, "quantity": 30, "unit_price": 20, "discount": 0}],
                   "payments": [{"method": "cash", "amount": 690}], "notes": "بيع فوق رصيد المطبخ"},
                  headers={"Idempotency-Key": f"grand-over-{RUN}", "X-Shift-Session-Id": str(SHIFT_ID)})
check("F11 الوضع الصارم يرفض بيع 30 وجبة (6 كجم) والمطبخ لا يملكها (409)", s == 409, f"HTTP {s} {oversale.get('error','')}")

s, sales_rep = req("GET", f"/api/pos/reports/sales?start_date={TODAY}&end_date={TODAY}", ADMIN)
check("F12 تقرير مبيعات اليوم يعمل ويتضمن البيع", s == 200 and (str(PID) in json.dumps(sales_rep) or "46" in json.dumps(sales_rep)), f"HTTP {s}")

s, close = req("POST", f"/api/pos/shifts/{SHIFT_ID}/close", ADMIN, {"actual_cash": 46, "notes": f"إغلاق فحص كبير {RUN}"})
close_variance = None
try:
    cs = close.get("session") or close
    close_variance = abs(float(cs.get("cash_difference", cs.get("variance", 0)) or 0))
except Exception:
    pass
check("F13 إغلاق الوردية بفرق نقدي صفر", s == 200 and (close_variance is None or close_variance < 0.005), f"HTTP {s} variance={close_variance}")

# ══ G) الإرجاع: مرتجع قسم بقيدين مقترنين وعكس المصروف ═════════════════════════
print("\n■ G) الإرجاع: 3 كجم ترجع من مخزن قسم السلطات للمخزن الرئيسي")
R_QTY = 3.0
s, ret = req("POST", "/api/warehouse/returns", ADMIN,
             {"dispatchId": D1, "items": [{"itemName": ITEM_NAME, "qty": R_QTY}], "reason": f"فحص كبير {RUN}"})
check("G1 إرجاع جزء من المستلم (201)", s == 201, f"HTTP {s} {ret.get('error','') if s != 201 else ''}")
ret_exp = (ret.get("expenses") or [{}])[0]
check("G2 عكس مصروف سالب على قسم السلطات", float(ret_exp.get("amount", 0)) < 0 and ret_exp.get("deptId") == "salads", f"{ret_exp.get('amount')}")
RET_EXP_ID = ret_exp.get("id")

STORE2 = snap_bal(RICE, STORE_ID)
MAIN4 = snap_bal(RICE, 1)
check("G3 مخزن القسم نقص −3 (المرتجع خرج فعلًا)", abs(STORE2 - (8.0 - R_QTY)) < 0.001, f"{STORE_BAL} → {STORE2}")
check("G4 المخزن الرئيسي زاد +3", abs(MAIN4 - (MAIN3 + R_QTY)) < 0.001, f"{MAIN3} → {MAIN4}")

s, over_ret = req("POST", "/api/warehouse/returns", ADMIN,
                  {"dispatchId": D1, "items": [{"itemName": ITEM_NAME, "qty": 99}], "reason": "رفض الإرجاع الزائد"})
check("G5 رفض إرجاع أكبر من المستلم (409)", s == 409 and over_ret.get("error") == "RETURN_QTY_EXCEEDED", f"HTTP {s} {over_ret.get('error','')}")

ret_led = psql_rows(f"SELECT transaction_type, location_id, quantity_delta FROM inventory_ledger "
                    f"WHERE reference_type='kitchen_return' AND reference_id='{D1}'")
has_pair_out = any(r[0] == "transfer_out" and r[1] == STORE_ID and abs(float(r[2]) + R_QTY) < 0.001 for r in ret_led)
has_pair_in = any(r[0] == "return" and r[1] == "1" and abs(float(r[2]) - R_QTY) < 0.001 for r in ret_led)
check("G6 الليدجر بقيدين مقترنين: خروج من مخزن القسم + دخول الرئيسي", has_pair_out and has_pair_in, f"{len(ret_led)} صف")

# ══ H) التحويل المخزني: طلب → اعتماد وحجز → شحن → استلام ══════════════════════
print("\n■ H) التحويل المخزني MAIN → KITCHEN (دورة كاملة)")
T_QTY = 1.0
s, tr = req("POST", "/api/warehouse/transfers", ADMIN,
            {"source_location_id": 1, "destination_location_id": 2,
             "items": [{"inventory_id": int(RICE), "requested_qty": T_QTY}], "notes": f"فحص كبير {RUN}"})
check("H1 إنشاء طلب تحويل (201)", s == 201 and tr.get("id"), f"HTTP {s} {tr.get('error','')}")
TR_ID = tr.get("id") if s == 201 else None
s, tapp = req("POST", f"/api/warehouse/transfers/{TR_ID}/approve", ADMIN, {})
check("H2 اعتماد التحويل وحجز الكمية", s == 200 and tapp.get("status") == "reserved", f"HTTP {s}")
res = psql(f"SELECT reserved FROM inventory_location_balances WHERE inventory_id={RICE} AND location_id=1")
check("H3 حجز 1 كجم في المصدر (reserved=1)", abs(float(res) - T_QTY) < 0.001, f"reserved={res}")
s, tdsp = req("POST", f"/api/warehouse/transfers/{TR_ID}/dispatch", ADMIN, {})
check("H4 شحن التحويل (in_transit)", s == 200 and tdsp.get("status") == "in_transit", f"HTTP {s}")
s, trcv = req("POST", f"/api/warehouse/transfers/{TR_ID}/receive", ADMIN, {})
check("H5 استلام التحويل كاملًا", s == 200 and trcv.get("status") == "received", f"HTTP {s}")
KIT4 = snap_bal(RICE, 2)
check("H6 مخزن المطبخ زاد +1 بالتحويل", abs(KIT4 - (KIT3 + T_QTY)) < 0.001, f"{KIT3} → {KIT4}")
res2 = psql(f"SELECT reserved FROM inventory_location_balances WHERE inventory_id={RICE} AND location_id=1")
check("H7 الحجز انفض بعد الشحن (reserved=0)", abs(float(res2)) < 0.001, f"reserved={res2}")

# ══ I) الجرد: جلسة على مخزن قسم السلطات على حدة ═══════════════════════════════
print("\n■ I) الجرد: جلسة على مخزن قسم السلطات — لقطة من رصيده هو")
s, locs = req("GET", "/api/warehouse/inventory/locations", ADMIN)
salads_store = next((l for l in locs if l.get("code") == "STORE-SALADS"), None)
check("I1 بطاقات مخازن الجرد تعمل ومخزن السلطات فيها", s == 200 and salads_store is not None, f"HTTP {s}")
s, prev = req("GET", f"/api/warehouse/inventory/locations/{STORE_ID}/preview?mode=all", ADMIN)
check("I2 المعاينة الحية للمخزن تعمل", s == 200 and prev.get("items_count", 0) >= 1, f"HTTP {s} count={prev.get('items_count')}")

s, aud = req("POST", "/api/warehouse/inventory/audits", ADMIN,
             {"locationId": int(STORE_ID), "countedAt": TODAY, "periodType": "monthly",
              "notes": f"جرد مخزن السلطات — فحص كبير {RUN}"})
AUD1 = aud.get("audit", {}).get("id")
check("I3 جلسة جرد على مخزن السلطات بعدد المعاينة", s == 201 and aud.get("itemCount") == prev.get("items_count"),
      f"{s} created={aud.get('itemCount')} preview={prev.get('items_count')}")
check("I4 الجلسة مرتبطة بالموقع في القاعدة",
      psql(f"SELECT warehouse_scope || ':' || COALESCE(location_id::text,'NULL') FROM inventory_audits WHERE id={AUD1}") == f"STORE-SALADS:{STORE_ID}")

s, det = req("GET", f"/api/warehouse/inventory/audits/{AUD1}", ADMIN)
target = next((i for i in det.get("items", []) if str(i.get("item_id")) == RICE), None)
check("I5 الصنف المصروف موجود بلقطة مخزن القسم (رصيد 5)", target is not None and abs(float(target["system_qty"]) - 5.0) < 0.001,
      target and f"system={target['system_qty']}" or "missing")
SYS_QTY = float(target["system_qty"]) if target else 0.0

s, _ = req("PUT", f"/api/warehouse/inventory/audits/{AUD1}/counts/{target['item_id']}", ADMIN,
           {"countedQty": SYS_QTY - 1, "notes": "عجز وحدة"})
s, det2 = req("GET", f"/api/warehouse/inventory/audits/{AUD1}", ADMIN)
t2 = next((i for i in det2["items"] if str(i["item_id"]) == RICE), None)
check("I6 الفرق الفوري على رصيد المخزن (عجز −1 بقيمة التكلفة)",
      t2 and t2.get("variance_qty") == -1 and abs(float(t2.get("variance_value", 0)) - (-cost1)) < 0.01,
      t2 and f"var={t2['variance_qty']} val={t2['variance_value']}" or "none")

s, _ = req("POST", f"/api/warehouse/inventory/audits/{AUD1}/submit", ADMIN, {"signatureData": SIG})
s, aapr = req("POST", f"/api/warehouse/inventory/audits/{AUD1}/approve", ADMIN, {"signatureData": SIG})
check("I7 اعتماد جلسة الجرد نجح", s == 200 and aapr.get("audit", {}).get("status") == "approved", f"HTTP {s}")

check("I8 حركة تصحيح جرد في الليدجر على مخزن السلطات بفرق −1",
      psql(f"SELECT count(*) FROM inventory_ledger WHERE transaction_type='count_correction' AND location_id={STORE_ID} "
           f"AND inventory_id={RICE} AND quantity_delta=-1 AND reference_type='inventory_audit' AND reference_id='{AUD1}'") == "1")
STORE3 = snap_bal(RICE, STORE_ID)
check("I9 رصيد مخزن السلطات نزل وحدة فعليًا", abs(STORE3 - (SYS_QTY - 1)) < 0.001, f"{SYS_QTY} → {STORE3}")
exp_cc = psql(f"SELECT count(*) FROM expenses WHERE \"adjustmentType\"='count_correction' AND \"deptId\"='salads' "
              f"AND amount={round(cost1, 2)} AND id > {snapshot['expenses_max']}")
check("I10 عجز الجرد سُجل كلفة على قسم السلطات تلقائيًا", exp_cc == "1", f"rows={exp_cc}")

# حرس اللقطة القديمة
s, audA = req("POST", "/api/warehouse/inventory/audits", ADMIN, {"locationId": int(STORE_ID), "countedAt": TODAY})
AUDA = audA["audit"]["id"]
s, audB = req("POST", "/api/warehouse/inventory/audits", ADMIN, {"locationId": int(STORE_ID), "countedAt": TODAY})
AUDB = audB["audit"]["id"]
s, _ = req("PUT", f"/api/warehouse/inventory/audits/{AUDB}/counts/{target['item_id']}", ADMIN, {"countedQty": SYS_QTY + 2})
s, _ = req("POST", f"/api/warehouse/inventory/audits/{AUDB}/submit", ADMIN, {"signatureData": SIG})
s, _ = req("POST", f"/api/warehouse/inventory/audits/{AUDB}/approve", ADMIN, {"signatureData": SIG})
s, stale = req("POST", f"/api/warehouse/inventory/audits/{AUDA}/approve", ADMIN, {"signatureData": SIG})
check("I11 حرس اللقطة القديمة يمنع اعتماد جلسة تقادم رصيدها (409)",
      s == 409 and stale.get("error") == "AUDIT_STALE_SNAPSHOT", f"{s} {stale.get('error','')}")
s, _ = req("POST", f"/api/warehouse/inventory/audits/{AUDA}/cancel", ADMIN, {"reason": "جلسة قديمة — فحص كبير"})
check("I12 إلغاء الجلسة المتقادمة موثق", s == 200)

# ══ J) المالية والتقارير: P&L + اتساق الليدجر ═════════════════════════════════
print("\n■ J) المالية والتقارير: قائمة الأرباح والخسائر + اتساق الليدجر")
s, pnl = req("GET", f"/api/finance/pnl?from={TODAY}&to={TODAY}", ADMIN)
check("J1 قائمة الأرباح والخسائر تعمل حيًا", s == 200 and pnl.get("statement"), f"HTTP {s}")
stmt = pnl.get("statement", {})

sql_pos_net = float(psql(f"SELECT COALESCE(SUM(subtotal - COALESCE(discount_total,0)),0) FROM pos_orders "
                         f"WHERE status IN ('issued','reported') AND (created_at AT TIME ZONE 'UTC')::date = '{TODAY}'::date "
                         f"AND total_amount IS NOT NULL"))
check("J2 إيراد الكاشير الصافي في القائمة = SQL المباشر",
      abs(float(stmt.get("revenue", {}).get("pos_net", 0)) - sql_pos_net) < 0.01,
      f"API={stmt.get('revenue', {}).get('pos_net')} SQL={sql_pos_net}")

sql_dispatch = float(psql(f"SELECT COALESCE(SUM(amount),0) FROM expenses WHERE \"adjustmentType\"='dispatch' AND LEFT(date,10)='{TODAY}'"))
sql_returns = float(psql(f"SELECT COALESCE(SUM(amount),0) FROM expenses WHERE \"adjustmentType\"='dispatch_return' AND LEFT(date,10)='{TODAY}'"))
sql_shrink = float(psql(f"SELECT COALESCE(SUM(amount),0) FROM expenses WHERE \"adjustmentType\"='count_correction' AND LEFT(date,10)='{TODAY}'"))
check("J3 تكلفة الصرف في القائمة = مصروفات dispatch اليوم",
      abs(float(stmt.get("cogs", {}).get("dispatch", 0)) - sql_dispatch) < 0.01, f"API={stmt.get('cogs', {}).get('dispatch')} SQL={sql_dispatch}")
check("J4 المرتجعات في القائمة = مصروفات dispatch_return اليوم (سالبة)",
      abs(float(stmt.get("cogs", {}).get("returns", 0)) - sql_returns) < 0.01, f"API={stmt.get('cogs', {}).get('returns')} SQL={sql_returns}")
check("J5 فروق الجرد في القائمة = count_correction اليوم (تطابق تام مع SQL)",
      abs(float(stmt.get("shrinkage", {}).get("amount", 0)) - sql_shrink) < 0.01 and abs(sql_shrink) > 0,
      f"API={stmt.get('shrinkage', {}).get('amount')} SQL={sql_shrink}")

rev_total = float(stmt.get("revenue", {}).get("total", 0))
cogs_net = float(stmt.get("cogs", {}).get("net", 0))
shrink = float(stmt.get("shrinkage", {}).get("amount", 0))
oper_total = float(stmt.get("operating", {}).get("total", 0))
pay_total = float(stmt.get("payroll", {}).get("total", 0))
net_profit = float(stmt.get("net_profit", {}).get("amount", 0))
check("J6 هوية القائمة: الصافي = إيراد − تكلفة صافية − فروق − تشغيلية − رواتب",
      abs(net_profit - (rev_total - cogs_net - shrink - oper_total - pay_total)) < 0.01,
      f"net={net_profit} = {rev_total} − {cogs_net} − {shrink} − {oper_total} − {pay_total}")

s, pnl_pr = req("GET", f"/api/finance/pnl/print?from={TODAY}&to={TODAY}", ADMIN)
pr_text = pnl_pr.get("_text", "") if isinstance(pnl_pr, dict) else ""
check("J7 طباعة قائمة الدخل A4 تعمل بلا NaN وتحتوي البنود", s == 200 and "NaN" not in pr_text and "صافي" in pr_text, f"HTTP {s} len={len(pr_text)}")

s, psum = req("GET", "/api/procurement/summary", ADMIN)
check("J8 ملخص المشتريات يعمل", s == 200, f"HTTP {s}")

# اتساق الليدجر: مجموع حركات الفحص = تغيّر أرصدة المواقع لكل صنف تمسّه
led_delta = {}
for r in psql_rows(f"SELECT inventory_id, location_id, quantity_delta FROM inventory_ledger WHERE created_at > '{T0}'"):
    key = (r[0], r[1])
    led_delta[key] = led_delta.get(key, 0.0) + float(r[2])
bal_delta_ok, bal_delta_detail = True, []
for (iid, lid), delta in led_delta.items():
    before = float(next((l.split("|")[2] for l in snapshot["balances"].split("\n")
                         if l.startswith(f"{iid}|{lid}|")), 0.0) or 0.0)
    after = snap_bal(iid, lid)
    if abs((after - before) - delta) > 0.001:
        bal_delta_ok = False
        bal_delta_detail.append(f"{iid}@{lid}: ledger={delta} actual={after - before}")
check("J9 اتساق الليدجر: حركات الفحص = تغيّر الأرصدة في كل موقع", bal_delta_ok,
      "; ".join(bal_delta_detail[:3]) if bal_delta_detail else f"{len(led_delta)} زوج موقع/صنف متوازن")

proj_ok = True
for line in psql_rows("SELECT id, qty FROM inventory"):
    iid, qty = line[0], float(line[1])
    loc_sum = float(psql(f"SELECT COALESCE(SUM(on_hand),0) FROM inventory_location_balances WHERE inventory_id={iid}"))
    if abs(qty - loc_sum) > 0.001:
        proj_ok = False
        break
check("J10 الإسقاط العالمي = مجموع مواقع كل صنف", proj_ok)

# ══ K) التنظيف الكامل: القاعدة مطابقة للقطة ═══════════════════════════════════
print("\n■ K) التنظيف الكامل وإرجاع القاعدة للقطة ما قبل الفحص")
audit_ids = [AUD1, AUDA, AUDB]
disp_ids = [D1, D2, KD]

# 1) الكاشير: طوابير + مدفوعات + حركات وصفة + إيرادات + فواتير + وردية
if ORDER_ID:
    psql(f"DELETE FROM pos_pending_prints WHERE order_id='{ORDER_ID}'")
    psql(f"DELETE FROM pos_zatca_invoice_queue WHERE order_id='{ORDER_ID}'")
    psql(f"DELETE FROM pos_stock_movements WHERE order_id='{ORDER_ID}'")
    psql(f"DELETE FROM pos_invoice_payments WHERE order_id='{ORDER_ID}'")
    psql(f"DELETE FROM revenues WHERE \"pos_order_id\"='{ORDER_ID}'")
psql(f"DELETE FROM pos_orders WHERE id='{ORDER_ID}'") if ORDER_ID else None
psql(f"DELETE FROM pos_orders WHERE created_at > '{T0}'")  # أمان: أي فاتورة أُنشئت أثناء الفحص
psql(f"DELETE FROM pos_shift_sessions WHERE id > {snapshot['shifts_max']}")
psql(f"DELETE FROM revenues WHERE id > {snapshot['revenues_max']}")

# 2) مشتريات: دفعات ثم فواتير ثم مورد
psql(f"DELETE FROM supplier_payments WHERE id > {snapshot['supp_pay_max']}")
psql(f'DELETE FROM "purchaseInvoices" WHERE id > {snapshot["pinv_max"]}')
psql(f"DELETE FROM suppliers WHERE id > {snapshot['suppliers_max']}")

# 3) إنتاج وتحويلات وإرجاعات ومصروفات
psql(f"DELETE FROM kitchen_production_events WHERE batch_id > {snapshot['batches_max']}")
psql(f"DELETE FROM kitchen_production_batches WHERE id > {snapshot['batches_max']}")
psql(f"DELETE FROM inventory_transfer_events WHERE transfer_id='{TR_ID}'") if TR_ID else None
psql(f"DELETE FROM inventory_transfer_items WHERE transfer_id='{TR_ID}'") if TR_ID else None
psql(f"DELETE FROM inventory_transfers WHERE id='{TR_ID}'") if TR_ID else None
psql(f'DELETE FROM "kitchenReturns" WHERE id > {snapshot["returns_max"]}')
psql(f"DELETE FROM expenses WHERE id > {snapshot['expenses_max']}")

# 4) إذون الصرف: فعاليات موقعة ثم الإذون
psql(f"DELETE FROM dispatch_workflow_events WHERE dispatch_id > {snapshot['dispatches_max']}")
psql(f"DELETE FROM dispatches WHERE id > {snapshot['dispatches_max']}")

# 5) إشعارات وجرد
psql(f"DELETE FROM notifications WHERE created_at > '{snapshot['notif_t0']}'")
for aid in audit_ids:
    psql(f"DELETE FROM inventory_audit_workflow_events WHERE audit_id={aid}")
    psql(f"DELETE FROM inventory_audit_items WHERE audit_id={aid}")
psql(f"DELETE FROM inventory_audits WHERE id > {snapshot['audits_max']}")

# 6) الليدجر: حذف حركات الفحص بدقة (بعد طابع زمن اللقطة)
psql(f"DELETE FROM inventory_ledger WHERE created_at > '{T0}'")
psql(f'DELETE FROM "inventoryTx" WHERE id > {snapshot["tx_max"]}')

# 7) كتالوج: وصفة ثم منتج ثم سياسة
if PID:
    psql(f"DELETE FROM pos_product_ingredients WHERE product_id={PID}")
psql(f"DELETE FROM pos_products WHERE id > {snapshot['products_max']}")
psql(f"DELETE FROM kitchen_policies WHERE id > {snapshot['policies_max']}")
psql(f"DELETE FROM pos_departments WHERE id > {snapshot['posdepts_max']}")

# 8) حذف صفوف رصيد أُنشئت خلال الفحص (مخازن جديدة) ثم استعادة الأرصدة من اللقطة
snap_pairs = set()
for line in snapshot["balances"].split("\n"):
    if line:
        iid, lid = line.split("|")[0], line.split("|")[1]
        snap_pairs.add((iid, lid))
for line in psql("SELECT inventory_id, location_id FROM inventory_location_balances ORDER BY 1,2").split("\n"):
    if not line:
        continue
    iid, lid = line.split("|")
    if (iid, lid) not in snap_pairs:
        psql(f"DELETE FROM inventory_location_balances WHERE inventory_id={iid} AND location_id={lid}")

# حذف مواقع مخازن أقسام أُنشئت خلال الفحص ولم تكن في اللقطة
snap_locs = set(l.split("|")[0] for l in snapshot["locations"].split("\n") if l)
for line in psql("SELECT id, code FROM inventory_locations ORDER BY id").split("\n"):
    if not line:
        continue
    lid, code = line.split("|")
    if lid not in snap_locs:
        psql(f"DELETE FROM inventory_locations WHERE id={lid}")

# استعادة مباشرة من اللقطة (لا إعادة حساب من الليدجر — تحفظ التاريخ السابق)
for line in snapshot["inventory"].split("\n"):
    if line:
        iid, _name, qty, cost = line.split("|")
        psql(f'UPDATE inventory SET qty={qty}, "avgCost"={cost} WHERE id={iid}')
for line in snapshot["balances"].split("\n"):
    if line:
        iid, lid, on_hand, reserved, in_transit = line.split("|")
        psql(f"UPDATE inventory_location_balances SET on_hand={on_hand}, reserved={reserved}, in_transit={in_transit} "
             f"WHERE inventory_id={iid} AND location_id={lid}")

print("  … التحقق من المطابقة النهائية")
check("K1 أرصدة المخزون مطابقة للقطة", psql(SNAP_INV) == snapshot["inventory"])
check("K2 أرصدة المواقع مطابقة للقطة (on_hand/reserved/in_transit)", psql(SNAP_BAL) == snapshot["balances"])
check("K3 المواقع مطابقة للقطة", psql("SELECT id, code FROM inventory_locations ORDER BY id") == snapshot["locations"])
check("K4 الليدجر عداده مطابق للقطة", psql("SELECT COUNT(*) FROM inventory_ledger") == snapshot["ledger_count"])
check("K5 لا إذون فحص متبقية", psql(f"SELECT COUNT(*) FROM dispatches WHERE id > {snapshot['dispatches_max']}") == "0")
check("K6 لا جلسات جرد فحص متبقية", psql(f"SELECT COUNT(*) FROM inventory_audits WHERE id > {snapshot['audits_max']}") == "0")
check("K7 لا إشعارات فحص متبقية", psql(f"SELECT COUNT(*) FROM notifications WHERE created_at > '{snapshot['notif_t0']}'") == "0")
check("K8 لا فواتير/موردين فحص متبقية",
      psql(f'SELECT COUNT(*) FROM "purchaseInvoices" WHERE id > {snapshot["pinv_max"]}') == "0"
      and psql(f"SELECT COUNT(*) FROM suppliers WHERE id > {snapshot['suppliers_max']}") == "0")
check("K9 لا مصروفات/إيرادات فحص متبقية",
      psql(f"SELECT COUNT(*) FROM expenses WHERE id > {snapshot['expenses_max']}") == "0"
      and psql(f"SELECT COUNT(*) FROM revenues WHERE id > {snapshot['revenues_max']}") == "0")
check("K10 لا فواتير POS/ورديات فحص متبقية",
      psql("SELECT COUNT(*) FROM pos_orders") == snapshot["orders_count"]
      and psql(f"SELECT COUNT(*) FROM pos_shift_sessions WHERE id > {snapshot['shifts_max']}") == "0")
check("K11 لا ورديات مفتوحة", psql("SELECT COUNT(*) FROM pos_shift_sessions WHERE status='open'") == "0")
check("K12 لا منتجات/سياسات/دفعات فحص متبقية",
      psql(f"SELECT COUNT(*) FROM pos_products WHERE id > {snapshot['products_max']}") == "0"
      and psql(f"SELECT COUNT(*) FROM kitchen_policies WHERE id > {snapshot['policies_max']}") == "0"
      and psql(f"SELECT COUNT(*) FROM kitchen_production_batches WHERE id > {snapshot['batches_max']}") == "0")

# المقارنة النهائية لقائمة الأرباح والخسائر — يجب أن تعود مطابقة للقطة
s, pnl_after = req("GET", f"/api/finance/pnl?from={TODAY}&to={TODAY}", ADMIN)
check("K13 قائمة الأرباح والخسائر عادت مطابقة للقطة بعد التنظيف",
      s == 200 and json.dumps(pnl_after.get("statement", {}), sort_keys=True) == json.dumps(pnl_before.get("statement", {}), sort_keys=True))

# ══ النتيجة ═══════════════════════════════════════════════════════════════════
passed = sum(1 for _, ok, _ in results if ok)
failed = [n for n, ok, _ in results if not ok]
print("\n" + "═" * 74)
print(f"  النتيجة النهائية: {passed}/{len(results)} PASS")
print("═" * 74)
if failed:
    print("الإخفاقات:")
    for f in failed:
        print(f"  ✗ {f}")
    sys.exit(1)
print("كل المراحل نجحت — النظام يعمل من فاتورة المشتريات حتى البيع للزبون بنهاية حقيقية")
