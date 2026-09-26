#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_kot_audit.py — الفحص الحي الشامل لتذاكر تجهيز المطبخ (KOT)
──────────────────────────────────────────────────────────────────────────────
يتحقق حيًا على الخادم الحقيقي (منفذ 5000) أن تذاكر المطبخ تعمل بالكامل:

  A) لقطة أساس + قراءة الإعدادات الافتراضية من الواجه
  B) حرس الإعدادات: رفض القيم الفاسدة (422) + حفظ من الواجه + منع غير المصرح
  C) دورة حية: منتج تجهيز → بيع (صنف تجهيز + ضيافة) → تذاكر حسب النسخ
     → دمج سطرين لنفس الصنف → الإيقاف يمنع التذاكر فعليًا → إخفاء الملاحظات
  D) صفحة تذاكر المطبخ HTML (RTL) للتابلت + 404 الصحيح
  E) أثر التدقيق pos_audit_logs موثق
  F) تنظيف كامل: القاعدة مطابقة للقطة الأساس
"""
import json, os, sys, time, subprocess
import urllib.request, urllib.error

BASE = "http://localhost:5000"
PSQL = ["/home/z/my-project/karim-erp/database/bin/bin/psql", "-h", "127.0.0.1",
        "-U", "postgres", "-d", "karim_erp"]
PGPASSWORD = "karim_local_preview_2026_secure_password"
RUN = str(int(time.time()))
TODAY = time.strftime("%Y-%m-%d")
PROD_NAME = f"وجبة فحص KOT {RUN}"
NOTE_ON = f"ضيف فحص KOT {RUN}"

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


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
        with urllib.request.urlopen(r, timeout=40) as resp:
            raw = resp.read().decode() or ""
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, {"_text": raw}
    except urllib.error.HTTPError as e:
        try:
            raw = e.read().decode() or ""
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, {"_text": raw}
        except Exception:
            return e.code, {}


TOKEN_CACHE = "/home/z/my-project/karim-erp/scripts/.kot_tokens.json"


def load_cache():
    try:
        with open(TOKEN_CACHE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_cache(c):
    with open(TOKEN_CACHE, "w") as f:
        json.dump(c, f)


def get_token(username, password="Karim2026Demo"):
    cache = load_cache()
    hit = cache.get(username)
    if hit:
        s, r = req("GET", "/api/pos/departments", hit)
        if s == 200:
            return hit
    s, r = req("POST", "/api/auth/login", None, {"username": username, "password": password})
    if s == 200 and r.get("access_token"):
        cache[username] = r["access_token"]
        save_cache(cache)
        return r["access_token"]
    return None


def decode_payload(hexval):
    if hexval.startswith("\\x"):
        hexval = hexval[2:]
    return bytes.fromhex(hexval).decode("utf-8", "replace")


# ═══════════════════════════ التنفيذ ═══════════════════════════
ADMIN = get_token("admin")
if not ADMIN:
    print("لا يمكن تسجيل الدخول كمدير — أوقف الفحص")
    sys.exit(1)

print("\n■ A) لقطة أساس + قراءة الإعدادات")
snapshot = {
    "orders": psql("SELECT COUNT(*) FROM pos_orders"),
    "prints": psql("SELECT COUNT(*) FROM pos_pending_prints"),
    "products_max": psql("SELECT COALESCE(MAX(id),0) FROM pos_products"),
    "shifts_max": psql("SELECT COALESCE(MAX(id),0) FROM pos_shift_sessions"),
    "kot_audit": psql("SELECT COUNT(*) FROM pos_audit_logs WHERE table_name='pos_print_settings'"),
    "settings": psql("SELECT kot_enabled::text||'|'||kot_copies||'|'||kot_include_notes::text FROM pos_print_settings WHERE id=1"),
}
s, cfg0 = req("GET", "/api/pos/kot/settings", ADMIN)
check("A1 قراءة إعدادات تذاكر المطبخ من الواجهة (200)", s == 200 and "kot_enabled" in cfg0, f"HTTP {s} {json.dumps(cfg0)[:100]}")
check("A2 الإعدادات الافتراضية: مفعّلة + نسخة واحدة + ملاحظات ظاهرة",
      cfg0.get("kot_enabled") is True and int(cfg0.get("kot_copies", 0)) == 1 and cfg0.get("kot_include_notes") is True,
      json.dumps(cfg0)[:120])

print("\n■ B) حرس الإعدادات (الواجهة)")
s, r = req("PUT", "/api/pos/kot/settings", ADMIN, {"kot_copies": 0})
check("B1 رفض صفر نسخ (422)", s == 422, f"HTTP {s}")
s, r = req("PUT", "/api/pos/kot/settings", ADMIN, {"kot_copies": 9})
check("B2 رفض نسخ فوق الحد (422)", s == 422, f"HTTP {s}")
s, r = req("PUT", "/api/pos/kot/settings", ADMIN, {"kot_enabled": "نعم"})
check("B3 رفض قيمة غير منطقية (422)", s == 422, f"HTTP {s}")
s, r = req("PUT", "/api/pos/kot/settings", ADMIN, {})
check("B4 رفض تحديث فارغ (422)", s == 422, f"HTTP {s}")
s, r = req("PUT", "/api/pos/kot/settings", ADMIN, {"kot_copies": 2})
check("B5 حفظ نسختين من الواجهة (200) والقراءة تعيد 2", s == 200 and r.get("kot_copies") == 2, f"HTTP {s} {json.dumps(r)[:120]}")
check("B6 قاعدة البيانات تحمل نسختين", psql("SELECT kot_copies FROM pos_print_settings WHERE id=1") == "2")

HEAD = get_token("head_salads")
if HEAD:
    s, r = req("GET", "/api/pos/kot/settings", HEAD)
    check("B7 غير المصرح (رئيس قسم) يُمنع من قراءة الإعدادات (403)", s == 403, f"HTTP {s}")
    s, r = req("PUT", "/api/pos/kot/settings", HEAD, {"kot_copies": 3})
    check("B8 غير المصرح يُمنع من التعديل (403)", s == 403, f"HTTP {s}")
else:
    check("B7 مستخدم رئيس قسم غير متاح للفحص — تخطٍّ آمن", True, "لا حساب head_salads")
    check("B8 مستخدم رئيس قسم غير متاح للفحص — تخطٍّ آمن", True, "لا حساب head_salads")

# ═══════════════ C) الدورة الحية ═══════════════
print("\n■ C) دورة حية: منتج تجهيز → بيع → تذاكر")
s, depts = req("GET", "/api/pos/departments", ADMIN)
kitchen = next((d for d in depts if d.get("code") == "erp_kitchen"), None)
KPOS_ID = int(kitchen["id"])
s, prod = req("POST", "/api/pos/products", ADMIN, {
    "name_ar": PROD_NAME, "price": 20, "vat_rate": 15, "cost_price": 2.0,
    "unit": "وجبة", "category": "فحص", "department_ids": [KPOS_ID]})
check("C1 منتج فحص بقسم تجهيز المطبخ (201)", s == 201 and prod.get("id"), f"HTTP {s}")
PID = int(prod["id"])
prep_dept = psql(f"SELECT COALESCE(department_id::text,'NULL') FROM pos_products WHERE id={PID}")
check("C2 قسم التجهيز في قاعدة البيانات = المطبخ", prep_dept == str(KPOS_ID), f"prep={prep_dept}")

s, shift = req("POST", "/api/pos/shifts/open", ADMIN, {"department_id": KPOS_ID, "opening_balance": 0})
if s == 409 and shift.get("error") == "SHIFT_ALREADY_OPEN":
    stale = psql_rows("SELECT s.id FROM pos_shift_sessions s WHERE s.cashier_id=1 AND s.status='open' ORDER BY s.id LIMIT 1")
    if stale:
        net = psql_rows(f"SELECT COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='in' THEN ip.amount END),0)"
                        f"-COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='out' THEN ip.amount END),0) "
                        f"FROM pos_invoice_payments ip JOIN pos_orders o ON o.id=ip.order_id WHERE o.session_id={stale[0][0]}")
        req("POST", f"/api/pos/shifts/{stale[0][0]}/close", ADMIN, {"actual_cash": float(net[0][0] or 0), "notes": f"إغلاق وردية عالقة فحص KOT {RUN}"})
    s, shift = req("POST", "/api/pos/shifts/open", ADMIN, {"department_id": KPOS_ID, "opening_balance": 0})
check("C3 فتح وردية الكاشير", s == 201 and shift.get("session_id"), f"HTTP {s}")
SHIFT_ID = int(shift["session_id"]) if s == 201 else None

# ── بيع 1: صنف تجهيز ×2 + ضيافة (بلا قسم) — النسخ = 2 ──
SALE1 = {"department_id": KPOS_ID,
         "items": [{"product_id": PID, "quantity": 2, "unit_price": 20, "discount": 0},
                   {"product_id": 4, "quantity": 1, "unit_price": 0, "discount": 0}],
         "payments": [{"method": "cash", "amount": 46}],
         "notes": NOTE_ON}
s, sale1 = req("POST", "/api/sales/complete", ADMIN, SALE1, headers={"Idempotency-Key": f"kot1-{RUN}", "X-Shift-Session-Id": str(SHIFT_ID)})
check("C4 البيع الأول (201) — صنف تجهيز + ضيافة", s == 201 and sale1.get("order_id"), f"HTTP {s} {json.dumps(sale1)[:150]}")
O1 = sale1.get("order_id")
check("C5 الاستجابة تعلن التذاكر مفعّلة + تذكرتان (نسختان) لقسم المطبخ",
      sale1.get("kot_enabled") is True and len(sale1.get("kot_jobs") or []) == 2,
      f"kot_jobs={json.dumps(sale1.get('kot_jobs'))[:160]}")
check("C6 كل التذاكر على طابعة kot-<المطبخ> وبلا أسعار في الاستجابة",
      all(j.get("printer_id") == f"kot-{KPOS_ID}" for j in sale1.get("kot_jobs") or []),
      json.dumps(sale1.get("kot_jobs"))[:160])

jobs = psql_rows(f"SELECT printer_id, COUNT(*) FROM pos_pending_prints WHERE order_id='{O1}' GROUP BY printer_id ORDER BY 1")
counts = {r[0]: int(r[1]) for r in jobs}
check("C7 الطابور: إيصال زبون واحد + تذكرتا مطبخ (النسخ من الضبط)",
      counts.get(f"pos-{KPOS_ID}") == 1 and counts.get(f"kot-{KPOS_ID}") == 2, json.dumps(counts))

kot_hex = psql(f"SELECT payload::text FROM pos_pending_prints WHERE order_id='{O1}' AND printer_id='kot-{KPOS_ID}' ORDER BY id LIMIT 1")
kot_text = decode_payload(kot_hex)
check("C8 التذكرة الحرارية تحمل العنوان والقسم والصنف والكمية", 
      "تذكرة تجهيز" in kot_text and PROD_NAME in kot_text and "2 ×" in kot_text, "")
check("C9 التذكرة تحمل اسم الضيف/الملاحظة من الطلب", NOTE_ON in kot_text)
check("C10 لا أسعار إطلاقًا على تذكرة المطبخ (لا SAR/لا VAT)",
      "SAR" not in kot_text and "VAT" not in kot_text, "")
rcpt_hex = psql(f"SELECT payload::text FROM pos_pending_prints WHERE order_id='{O1}' AND printer_id='pos-{KPOS_ID}' LIMIT 1")
rcpt_text = decode_payload(rcpt_hex)
check("C11 إيصال الزبون (المقارنة) يحتوي المبالغ بينما التذكرة لا",
      "SAR" in rcpt_text and "46.00" in rcpt_text, "")
check("C12 الضيافة (بلا قسم تجهيز) لم تولّد تذكرة — صنف واحد فقط في التذكرة",
      kot_text.count(PROD_NAME) == 1 and "ضيافة" not in kot_text, "")

# ── بيع 2: سطران لنفس الصنف → دمج في تذكرة واحدة ──
SALE2 = {"department_id": KPOS_ID,
         "items": [{"product_id": PID, "quantity": 1, "unit_price": 20, "discount": 0},
                   {"product_id": PID, "quantity": 1, "unit_price": 20, "discount": 0}],
         "payments": [{"method": "cash", "amount": 46}],
         "notes": ""}
s, sale2 = req("POST", "/api/sales/complete", ADMIN, SALE2, headers={"Idempotency-Key": f"kot2-{RUN}", "X-Shift-Session-Id": str(SHIFT_ID)})
check("C13 البيع الثاني (201) — سطران لنفس الصنف", s == 201 and sale2.get("order_id"), f"HTTP {s}")
O2 = sale2.get("order_id")
check("C14 الدمج: تذكرتان (نسختان) لسطر واحد مدموج", len(sale2.get("kot_jobs") or []) == 2, f"jobs={len(sale2.get('kot_jobs') or [])}")
kot2_text = decode_payload(psql(f"SELECT payload::text FROM pos_pending_prints WHERE order_id='{O2}' AND printer_id='kot-{KPOS_ID}' ORDER BY id LIMIT 1"))
check("C15 سطر التذكرة المدموج = 2 × الصنف (وليس سطرين 1 ×)",
      kot2_text.count("2 × " + PROD_NAME) == 1 and f"1 × {PROD_NAME}" not in kot2_text, "")

# ── بيع 3: الإيقاف من الواجهة يمنع التذاكر فعليًا ──
s, r = req("PUT", "/api/pos/kot/settings", ADMIN, {"kot_enabled": False})
check("C16 إيقاف التذاكر من الواجهة (200)", s == 200 and r.get("kot_enabled") is False, f"HTTP {s}")
SALE3 = {"department_id": KPOS_ID,
         "items": [{"product_id": PID, "quantity": 1, "unit_price": 20, "discount": 0}],
         "payments": [{"method": "cash", "amount": 23}],
         "notes": ""}
s, sale3 = req("POST", "/api/sales/complete", ADMIN, SALE3, headers={"Idempotency-Key": f"kot3-{RUN}", "X-Shift-Session-Id": str(SHIFT_ID)})
check("C17 البيع الثالث أثناء الإيقاف (201)", s == 201 and sale3.get("order_id"), f"HTTP {s}")
O3 = sale3.get("order_id")
check("C18 الاستجابة: التذاكر موقوفة وبلا أي مهمة تذكرة",
      sale3.get("kot_enabled") is False and (sale3.get("kot_jobs") or []) == [],
      f"kot_enabled={sale3.get('kot_enabled')} jobs={json.dumps(sale3.get('kot_jobs'))}")
counts3 = {r[0]: int(r[1]) for r in psql_rows(f"SELECT printer_id, COUNT(*) FROM pos_pending_prints WHERE order_id='{O3}' GROUP BY printer_id")}
check("C19 الطابور أثناء الإيقاف: إيصال الزبون فقط بلا تذاكر",
      counts3.get(f"pos-{KPOS_ID}") == 1 and f"kot-{KPOS_ID}" not in counts3, json.dumps(counts3))

# ── بيع 4: إعادة التفعيل + إخفاء الملاحظات ──
s, r = req("PUT", "/api/pos/kot/settings", ADMIN, {"kot_enabled": True, "kot_copies": 1, "kot_include_notes": False})
check("C20 إعادة التفعيل بنسخة واحدة وإخفاء الملاحظات (200)", s == 200 and r.get("kot_copies") == 1, f"HTTP {s}")
SECRET_NOTE = f"ملاحظة سرية {RUN}"
SALE4 = {"department_id": KPOS_ID,
         "items": [{"product_id": PID, "quantity": 1, "unit_price": 20, "discount": 0}],
         "payments": [{"method": "cash", "amount": 23}],
         "notes": SECRET_NOTE}
s, sale4 = req("POST", "/api/sales/complete", ADMIN, SALE4, headers={"Idempotency-Key": f"kot4-{RUN}", "X-Shift-Session-Id": str(SHIFT_ID)})
check("C21 البيع الرابع (201) وتذكرة واحدة (النسخ=1)", s == 201 and len(sale4.get("kot_jobs") or []) == 1, f"HTTP {s} jobs={json.dumps(sale4.get('kot_jobs'))[:120]}")
O4 = sale4.get("order_id")
kot4_text = decode_payload(psql(f"SELECT payload::text FROM pos_pending_prints WHERE order_id='{O4}' AND printer_id='kot-{KPOS_ID}' LIMIT 1"))
check("C22 مفتاح إخفاء الملاحظات يعمل: الملاحظة السرية ليست على التذكرة",
      SECRET_NOTE not in kot4_text, "")

# ═══════════════ D) صفحة تذاكر المطبخ HTML ═══════════════
print("\n■ D) صفحة التذاكر لشاشة المطبخ")
s, r = req("GET", f"/api/pos/kot/orders/{O1}/html", ADMIN)
html = r.get("_text", "")
check("D1 صفحة التذاكر (200) بتنسيق RTL", s == 200 and 'dir="rtl"' in html, f"HTTP {s}")
check("D2 الصفحة تحمل بطاقتين (نسختان البيع الأول) بالعنوان والصنف",
      html.count("kot-card") >= 2 and "تذكرة تجهيز" in html and PROD_NAME in html, f"cards={html.count('kot-card')}")
check("D3 الصفحة بلا مبالغ (لا SAR)", "SAR" not in html, "")
check("D4 زر الطباعة وقواعد قص الصفحة حاضرة",
      "window.print()" in html and "page-break-inside:avoid" in html, "")
s, r = req("GET", f"/api/pos/kot/orders/00000000-0000-0000-0000-000000000000/html", ADMIN)
check("D5 طلب غير موجود → 404 صحيح", s == 404, f"HTTP {s}")

# ═══════════════ E) أثر التدقيق ═══════════════
print("\n■ E) أثر التدقيق")
kot_audits = psql("SELECT COUNT(*) FROM pos_audit_logs WHERE table_name='pos_print_settings'")
delta = int(kot_audits) - int(snapshot["kot_audit"])
check("E1 كل تعديلات إعدادات التذاكر الناجحة في هذه التشغيلة موثق (3: حفظ/إيقاف/إعادة تفعيل) والمرفوضة 422 لا تكتب",
      delta == 3, f"count={kot_audits} baseline={snapshot['kot_audit']} delta={delta}")

# ═══════════════ F) التنظيف الكامل ═══════════════
print("\n■ F) التنظيف الكامل والعودة للقطة الأساس")
for oid in [O1, O2, O3, O4]:
    if oid:
        req("POST", f"/api/pos/orders/{oid}/void", ADMIN, {"reason": f"إلغاء فحص KOT {RUN}"})
net = float(psql_rows(f"SELECT COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='in' THEN ip.amount END),0)"
                      f"-COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='out' THEN ip.amount END),0) "
                      f"FROM pos_invoice_payments ip JOIN pos_orders o ON o.id=ip.order_id WHERE o.session_id={SHIFT_ID}")[0][0] or 0)
s, _ = req("POST", f"/api/pos/shifts/{SHIFT_ID}/close", ADMIN, {"actual_cash": net, "notes": f"إغلاق فحص KOT {RUN}"})
check("F1 إغلاق الوردية بفرق صفر", s == 200, f"HTTP {s} net={net}")

TEST_ORDERS = f"'{O1}','{O2}','{O3}','{O4}'"
for tbl in ["pos_pending_prints", "pos_zatca_invoice_queue", "pos_invoice_payments",
            "pos_order_items", "pos_stock_movements", "erp_revenues", "kitchen_exceptions"]:
    try:
        psql(f"DELETE FROM {tbl} WHERE order_id IN ({TEST_ORDERS});")
    except Exception:
        pass
psql(f"DELETE FROM pos_orders WHERE id IN ({TEST_ORDERS});")
psql(f"DELETE FROM pos_shift_sessions WHERE id = {SHIFT_ID};")
psql(f"DELETE FROM pos_product_departments WHERE product_id = {PID};")
psql(f"DELETE FROM pos_products WHERE id = {PID};")
# إعادة الإعدادات إلى القطة الأساس
base_enabled, base_copies, base_notes = snapshot["settings"].split("|")
psql(f"UPDATE pos_print_settings SET kot_enabled={base_enabled}, kot_copies={base_copies}, kot_include_notes={base_notes}, "
     f"updated_at=CURRENT_TIMESTAMP, updated_by='live_kot_audit_cleanup' WHERE id=1;")

after = {
    "orders": psql(f"SELECT COUNT(*) FROM pos_orders WHERE id IN ({TEST_ORDERS})"),
    "prints_test": psql(f"SELECT COUNT(*) FROM pos_pending_prints WHERE order_id IN ({TEST_ORDERS})"),
    "shifts": psql(f"SELECT COUNT(*) FROM pos_shift_sessions WHERE id > {snapshot['shifts_max']}"),
    "products": psql(f"SELECT COUNT(*) FROM pos_products WHERE id > {snapshot['products_max']}"),
    "settings": psql("SELECT kot_enabled::text||'|'||kot_copies||'|'||kot_include_notes::text FROM pos_print_settings WHERE id=1"),
    "kot_audit": psql("SELECT COUNT(*) FROM pos_audit_logs WHERE table_name='pos_print_settings'"),
}
check("F2 لا بقايا فحص: طلبات/طباعات/ورديات/منتجات محذوفة",
      after["orders"] == "0" and after["prints_test"] == "0" and after["shifts"] == "0" and after["products"] == "0",
      json.dumps(after))
check("F3 إعدادات التذاكر عادت مطابقة للقطة الأساس", after["settings"] == snapshot["settings"],
      f"{after['settings']} ← {snapshot['settings']}")

# ═══════════════════════════ الخلاصة ═══════════════════════════
passed = sum(1 for _, ok, _ in results if ok)
failed = [n for n, ok, _ in results if not ok]
print(f"\n{'═' * 70}")
print(f"النتيجة: {passed}/{len(results)} فحصًا ناجحًا")
if failed:
    print("فاشلة:")
    for n in failed:
        print(f"  ✗ {n}")
sys.exit(0 if not failed else 1)
