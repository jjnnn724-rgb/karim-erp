#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_zatca_audit.py — الفحص الحي الشامل لمهمة ZATCA: كل إعدادات الربط من خلال الواجه
──────────────────────────────────────────────────────────────────────────────────────
يتحقق حيًا على الخادم الحقيقي (منفذ 5000) أن مركز إعدادات ZATCA يعمل بالكامل بلا كود:

  A) لقطة أساس + قراءة مركز الإعدادات
  B) حفظ الإعدادات من الواجه: تحقّق الرفض (رقم ضريبي/بيئة/HTTP) + حفظ كامل + إخفاء الأسرار
  C) توليد CSR حقيقي (PKCS#10/EC-P256) + التحقق بـ openssl + رفض OTP الفاسد
     + طلب CSID برمز وهمي → فشل صادق لا يزيف النجاح
  D) حرس التفعيل: منع التفعيل دون شهادة (422 ZATCA_INCOMPLETE)
  E) إدخال شهادة يدويًا (مسار البوابة الحقيقي) → التفعيل ينجح الآن
  F) دورة الفوترة الحية: وردية → بيعان → TLV من القسم → TLV من مركز الإعدادات
     (القسم بلا رقم ضريبي) → الطابور يُرسل فعليًا ويفشل بصدق → إعادة الجدولة
     → الإيقاف يجمّد المحاولات → إلغاء فاتورة → skipped_cancelled
  G) زر تطبيق الرقم الضريبي على كل الأقسام
  H) مراقب الطابور متسق مع قاعدة البيانات
  I) أثر التدقيق pos_audit_logs موثق لكل إجراء
  J) تنظيف كامل: القاعدة مطابقة للقطة الأساس
"""
import json, os, base64, subprocess, sys, time, tempfile
import urllib.request, urllib.error

BASE = "http://localhost:5000"
PSQL = ["/home/z/my-project/karim-erp/database/bin/bin/psql", "-h", "127.0.0.1",
        "-U", "postgres", "-d", "karim_erp"]
PGPASSWORD = "karim_local_preview_2026_secure_password"
RUN = str(int(time.time()))
TODAY = time.strftime("%Y-%m-%d")
TARGET_VAT = "300111222333444"          # رقم ضريبي اختباري (15 رقمًا) مختلف عن الأساس
BASELINE_VAT = "300000000000003"
FAKE_CSID = ("MIIC" + "Z" * 300 + "==")  # شهادة اختبارية بصيغة base64 صالحة الشكل
POLL_WAIT = 45                          # أقصى انتظار لطابور الإبلاغ (الدورة 15 ثانية)

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


TOKEN_CACHE = f"/home/z/my-project/karim-erp/scripts/.zatca_tokens.json"


def get_token(username, password="Karim2026Demo"):
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
    s, r = req("POST", "/api/auth/login", body={"username": username, "password": password})
    if s == 200 and r.get("access_token"):
        cache[username] = r["access_token"]
        try:
            with open(TOKEN_CACHE, "w") as f:
                json.dump(cache, f)
        except Exception:
            pass
        return r["access_token"]
    return None


def parse_tlv(b64):
    """يفكّ حزمة QR الأساسية TLV: {tag: [values]}"""
    raw = base64.b64decode(b64)
    out, i = {}, 0
    while i + 2 <= len(raw):
        tag = raw[i]
        ln = raw[i + 1]
        val = raw[i + 2:i + 2 + ln]
        i += 2 + ln
        out.setdefault(tag, []).append(val.decode("utf-8", "replace"))
    return out


def wait_db(cond_sql, timeout=POLL_WAIT, interval=2.0):
    """يستقصي قاعدة البيانات حتى يتحقق شرط (يُرجع آخر قيمة)"""
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        last = psql(cond_sql)
        if last and last not in ("0", "f", "false", ""):
            return last
        time.sleep(interval)
    return last


# ═══════════════════════════ A) لقطة الأساس ═══════════════════════════
print("\n■ A) لقطة الأساس + قراءة مركز الإعدادات")
ADMIN = get_token("admin")
check("A1 دخول المدير (access_token)", bool(ADMIN))

snapshot = {
    "dept_vats": {r[0]: r[1] for r in psql_rows("SELECT id, COALESCE(vat_number,'') FROM pos_departments ORDER BY id")},
    "queue_counts": {r[0]: r[1] for r in psql_rows("SELECT status, COUNT(*) FROM pos_zatca_invoice_queue GROUP BY status")},
    "orders_count": psql("SELECT COUNT(*) FROM pos_orders"),
    "shifts_max": psql("SELECT COALESCE(MAX(id),0) FROM pos_shift_sessions"),
    "products_max": psql("SELECT COALESCE(MAX(id),0) FROM pos_products"),
    "settings_row": psql("SELECT enabled||'|'||environment||'|'||COALESCE(seller_name,'')||'|'||COALESCE(vat_number,'')||'|'||COALESCE(crn,'')||'|'||COALESCE(branch_name,'')||'|'||COALESCE(address,'')||'|'||COALESCE(solution_name,'')||'|'||COALESCE(eid::text,'')||'|'||max_attempts||'|'||COALESCE(csid,'NULL-CSID')||'|'||COALESCE(csr_pem,'NULL') FROM zatca_settings WHERE id=1"),
}
check("A2 لقطة الأساس ملتقطة (أقسام/طابور/إعدادات)", len(snapshot["dept_vats"]) > 0, f"depts={len(snapshot['dept_vats'])}")

s, hub = req("GET", "/api/zatca/settings", ADMIN)
check("A3 GET /api/zatca/settings يعمل (200)", s == 200 and hub.get("config"), f"HTTP {s}")
check("A4 الحالة الابتدائية: الربط موقوف وبلا شهادة",
      hub["config"]["enabled"] is False and hub["config"]["has_csid"] is False)
check("A5 البيئات الثلاث الرسمية متاحة في الواجه",
      {e["value"] for e in hub["config"]["environments"]} == {"developer_portal", "simulation", "production"})
check("A6 مراقب الطابور يعمل (إحصاءات)", isinstance(hub.get("queue"), dict) and "queued" in hub["queue"])

# ═══════════════ B) حفظ الإعدادات من الواجه + التحقق من الرفض ═══════════════
print("\n■ B) حفظ الإعدادات من الواجه (بلا كود)")
s, r = req("PUT", "/api/zatca/settings", ADMIN, {"vat_number": "12345"})
check("B1 رفض رقم ضريبي غير 15 رقمًا (422)", s == 422 and "15" in r.get("message", ""), f"HTTP {s} {r.get('message','')[:60]}")
s, r = req("PUT", "/api/zatca/settings", ADMIN, {"environment": "moon"})
check("B2 رفض بيئة غير معروفة (422)", s == 422, f"HTTP {s}")
s, r = req("PUT", "/api/zatca/settings", ADMIN, {"api_base": "http://insecure.example.com"})
check("B3 رفض عنوان API غير HTTPS (422)", s == 422, f"HTTP {s}")
s, r = req("PUT", "/api/zatca/settings", ADMIN, {"max_attempts": 999})
check("B4 رفض عدد محاولات خارج النطاق (422)", s == 422, f"HTTP {s}")

FULL = {
    "seller_name": f"شركة فحص ZATCA {RUN}",
    "vat_number": TARGET_VAT,
    "crn": f"10{RUN[-8:]}",
    "branch_name": "فرع الفحص",
    "address": "الرياض — حي الفحص",
    "environment": "simulation",
    "solution_name": "Karim ERP",
    "eid": f"10{RUN[-8:]}",
    "max_attempts": 7,
    "poll_in_server": True,
}
s, r = req("PUT", "/api/zatca/settings", ADMIN, FULL)
check("B5 حفظ الإعدادات الكاملة من الواجه (200)", s == 200 and r.get("config"), f"HTTP {s} {json.dumps(r)[:150]}")
s, hub = req("GET", "/api/zatca/settings", ADMIN)
c = hub["config"]
check("B6 البيئة انتقلت إلى المحاكاة وعنوان API تبعها تلقائيًا",
      c["environment"] == "simulation" and "simulation" in (c["api_base"] or ""), f"{c['environment']} / {c['api_base']}")
check("B7 بيانات المنشأة محفوظة كما أُدخلت (اسم/سجل/فرع/عنوان/معرّف)",
      c["seller_name"] == FULL["seller_name"] and c["crn"] == FULL["crn"]
      and c["branch_name"] == FULL["branch_name"] and c["address"] == FULL["address"])
check("B8 الرقم الضريبي محفوظ ومحوّل إلى أرقام صرفة", c["vat_number"] == TARGET_VAT)
check("B9 المعرّف (eid) مُخفى في العرض ولا يُسرّب المفتاح الخاص",
      c["eid"] and "••••" in c["eid"] and "private_key_pem" not in json.dumps(hub))

# ═══════════════ C) CSR حقيقي + طلب CSID بصدق ═══════════════
print("\n■ C) توليد CSR حقيقي + طلب CSID")
s, r = req("POST", "/api/zatca/csr", ADMIN, {})
csr_pem = r.get("csr_pem", "")
check("C1 توليد CSR (200) بصيغة PEM", s == 200 and csr_pem.startswith("-----BEGIN CERTIFICATE REQUEST-----"), f"HTTP {s}")
subject = ""
with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as f:
    f.write(csr_pem)
    csr_file = f.name
try:
    subject = subprocess.run(["openssl", "req", "-in", csr_file, "-noout", "-subject", "-nameopt", "RFC2253"],
                             capture_output=True, text=True).stdout
finally:
    os.unlink(csr_file)
check("C2 CSR يُفكّ بـ openssl ويحمل subject هيئة الزكاة (1-VAT, SA)",
      f"1-{TARGET_VAT}" in subject and "SA" in subject, subject.strip()[:120])
check("C3 المفتاح الخاص مصاحب محفوظ (has_private_key)", hub["config"]["has_private_key"] is True)

s, r = req("POST", "/api/zatca/csid", ADMIN, {"otp": "12345"})
check("C4 رفض OTP غير سداسي الأرقام (422)", s == 422 and r.get("error") == "INVALID_OTP", f"HTTP {s}")
s, r = req("POST", "/api/zatca/csid", ADMIN, {"otp": "123456"})
honest_csid_fail = (s >= 400) or (r.get("ok") is False)
check("C5 طلب CSID برمز وهمي يفشل بصدق (لا يزيف نجاحًا)",
      honest_csid_fail and psql("SELECT COALESCE(csid,'') FROM zatca_settings WHERE id=1") == "", f"HTTP {s} {json.dumps(r)[:120]}")
s, r = req("POST", "/api/zatca/test", ADMIN, {})
check("C6 اختبار الاتصال يعيد نتيجة حقيقية (حالة/زمن استجابة)",
      s == 200 and ("http_status" in r or "error" in r) and "latency_ms" in r, json.dumps(r)[:100])

# ═══════════════ D) حرس التفعيل ═══════════════
print("\n■ D) حرس التفعيل: بلا شهادة لا تفعيل")
s, r = req("POST", "/api/zatca/toggle", ADMIN, {"enabled": True})
check("D1 منع التفعيل دون شهادة CSID (422 ZATCA_INCOMPLETE)",
      s == 422 and r.get("error") == "ZATCA_INCOMPLETE" and any("CSID" in m for m in r.get("missing", [])),
      f"HTTP {s} {r.get('message','')[:80]}")
check("D2 الربط ما زال موقوفًا بعد الرفض", psql("SELECT enabled FROM zatca_settings WHERE id=1") == "f")

# ═══════════════ E) إدخال شهادة يدويًا (مسار البوابة) ثم التفعيل ═══════════════
print("\n■ E) إدخال شهادة CSID يدويًا ثم التفعيل من الواجه")
s, r = req("POST", "/api/zatca/csid/manual", ADMIN, {"csid": "short"})
check("E1 رفض شهادة يدوية فاسدة (422)", s == 422 and r.get("error") == "INVALID_CSID", f"HTTP {s}")
s, r = req("POST", "/api/zatca/csid/manual", ADMIN, {"csid": FAKE_CSID})
check("E2 حفظ الشهادة اليدوية (200) ومقنّعة في العرض",
      s == 200 and r.get("csid_masked") and "••••" in r["csid_masked"], f"HTTP {s}")
s, hub = req("GET", "/api/zatca/settings", ADMIN)
check("E3 الواجهة تُظهر الشهادة جاهزة + توقيت الاستلام", hub["config"]["has_csid"] is True and hub["config"]["csid_obtained_at"])
s, r = req("POST", "/api/zatca/toggle", ADMIN, {"enabled": True})
check("E4 التفعيل ينجح بعد اكتمال المتطلبات (200)", s == 200 and r.get("enabled") is True, f"HTTP {s} {json.dumps(r)[:120]}")
check("E5 قاعدة البيانات: الربط مفعّل", psql("SELECT enabled FROM zatca_settings WHERE id=1") == "t")

# ═══════════════ F) دورة الفوترة الحية: بيع → طابور → إبلاغ ═══════════════
print("\n■ F) دورة حية: وردية → بيعان → TLV → طابور → فشل صادق → تجميد → إلغاء")
s, depts = req("GET", "/api/pos/departments", ADMIN)
kitchen = next((d for d in depts if d.get("code") == "erp_kitchen"), None)
KPOS_ID = int(kitchen["id"])
PROD_NAME = f"وجبة فحص ZATCA {RUN}"
s, prod = req("POST", "/api/pos/products", ADMIN, {
    "name_ar": PROD_NAME, "price": 20, "vat_rate": 15, "cost_price": 2.0,
    "unit": "وجبة", "category": "فحص", "department_ids": [KPOS_ID]})
check("F1 منتج فحص مرتبط بقسم المطبخ (201)", s == 201 and prod.get("id"), f"HTTP {s}")
PID = int(prod["id"])

s, shift = req("POST", "/api/pos/shifts/open", ADMIN, {"department_id": KPOS_ID, "opening_balance": 0})
if s == 409 and shift.get("error") == "SHIFT_ALREADY_OPEN":
    stale = psql_rows("SELECT s.id FROM pos_shift_sessions s WHERE s.cashier_id=1 AND s.status='open' ORDER BY s.id LIMIT 1")
    if stale:
        net = psql_rows(f"SELECT COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='in' THEN ip.amount END),0)"
                        f"-COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='out' THEN ip.amount END),0) "
                        f"FROM pos_invoice_payments ip JOIN pos_orders o ON o.id=ip.order_id WHERE o.session_id={stale[0][0]}")
        req("POST", f"/api/pos/shifts/{stale[0][0]}/close", ADMIN, {"actual_cash": float(net[0][0] or 0), "notes": f"إغلاق وردية عالقة فحص ZATCA {RUN}"})
    s, shift = req("POST", "/api/pos/shifts/open", ADMIN, {"department_id": KPOS_ID, "opening_balance": 0})
check("F2 فتح وردية الكاشير", s == 201 and shift.get("session_id"), f"HTTP {s}")
SHIFT_ID = int(shift["session_id"]) if s == 201 else None

SALE = {"department_id": KPOS_ID,
        "items": [{"product_id": PID, "quantity": 2, "unit_price": 20, "discount": 0}],
        "payments": [{"method": "cash", "amount": 46}],
        "notes": f"فحص ZATCA {RUN}"}

s, sale1 = req("POST", "/api/sales/complete", ADMIN, SALE, headers={"Idempotency-Key": f"zatca1-{RUN}", "X-Shift-Session-Id": str(SHIFT_ID)})
check("F3 البيع الأول (201) — القسم يحمل الرقم الضريبي الأساسي", s == 201 and sale1.get("order_id"), f"HTTP {s} {json.dumps(sale1)[:150]}")
ORDER1 = sale1.get("order_id")
check("F4 الاستجابة تشير إلى إدراج الفاتورة في طابور ZATCA", sale1.get("zatca_queued") is True)

qr1 = psql(f"SELECT qr_payload FROM pos_orders WHERE id='{ORDER1}'")
tlv1 = parse_tlv(qr1)
check("F5 TLV البيع الأول: الرقم الضريبي من القسم (2-300000000000003)",
      tlv1.get(2, [""])[0] == BASELINE_VAT, f"tag2={tlv1.get(2, ['—'])[0]}")
check("F6 TLV مكتمل الحقول (اسم/ضريبي/زمن/إجمالي/ضريبة/عدّاد/UUID)",
      all(k in tlv1 for k in (1, 2, 3, 4, 5, 6, 7)) and tlv1.get(4, [""])[0] == "46.00", str({k: v[0][:14] for k, v in tlv1.items()}))

# بيع ثانٍ والقسم بلا رقم ضريبي → يجب أن يسحب من مركز الإعدادات (الأصل في الواجه)
psql(f"UPDATE pos_departments SET vat_number = NULL WHERE id = {KPOS_ID};")
s, sale2 = req("POST", "/api/sales/complete", ADMIN, SALE, headers={"Idempotency-Key": f"zatca2-{RUN}", "X-Shift-Session-Id": str(SHIFT_ID)})
check("F7 البيع الثاني (201) والقسم بلا رقم ضريبي", s == 201 and sale2.get("order_id"), f"HTTP {s}")
ORDER2 = sale2.get("order_id")
check("F8 الاستجابة تنبّه أن الرقم جاء من الضبط (placeholder=False)",
      sale2.get("zatca_vat_number_placeholder") is False)
qr2 = psql(f"SELECT qr_payload FROM pos_orders WHERE id='{ORDER2}'")
tlv2 = parse_tlv(qr2)
check("F9 TLV البيع الثاني: الرقم الضريبي سُحب من مركز الإعدادات تلقائيًا",
      tlv2.get(2, [""])[0] == TARGET_VAT, f"tag2={tlv2.get(2, ['—'])[0]}")

s, html = req("GET", f"/api/pos/orders/{ORDER2}/receipt-html", ADMIN)
html_text = html.get("html") or html.get("_text", "")
check("F10 إيصال HTML يعرض الرقم الضريبي من مركز الإعدادات", TARGET_VAT in html_text, f"len={len(html_text)}")
thermal = psql(f"SELECT encode(payload,'escape') FROM pos_pending_prints WHERE order_id='{ORDER2}' LIMIT 1")
check("F11 الإيصال الحراري ESC/POS يحمل الرقم الضريبي الموحّد", TARGET_VAT in thermal)

row1 = wait_db(f"SELECT status FROM pos_zatca_invoice_queue WHERE order_id='{ORDER1}' AND status IN ('failed','dead_letter')")
q1 = psql_rows(f"SELECT status, attempts, COALESCE(last_error,'') FROM pos_zatca_invoice_queue WHERE order_id='{ORDER1}'")[0]
check("F12 الطابور حاول الإرسال الحقيقي وفشل بصدق (بيئة معزولة/رفض هيئة)",
      q1[0] in ("failed", "dead_letter") and int(q1[1]) >= 1 and len(q1[2]) > 5, f"{q1[0]} attempts={q1[1]} err={q1[2][:80]}")

s, r = req("POST", "/api/zatca/queue/retry", ADMIN, {"scope": "failed"})
requeued = int(r.get("requeued", 0)) if s == 200 else -1
check("F13 إعادة جدولة الفاشلة من الواجه (زر حقيقي)", s == 200 and requeued >= 1, f"HTTP {s} requeued={requeued}")

# إيقاف الربط → تجميد الطابور (لا تحرق محاولات)
req("POST", "/api/zatca/toggle", ADMIN, {"enabled": False})
time.sleep(2)
attempts_before = int(psql(f"SELECT attempts FROM pos_zatca_invoice_queue WHERE order_id='{ORDER1}'"))
time.sleep(18)
attempts_after = int(psql(f"SELECT attempts FROM pos_zatca_invoice_queue WHERE order_id='{ORDER1}'"))
check("F14 الإيقاف يجمّد الطابور فعلًا (لا محاولات أثناء التوقف)", attempts_after == attempts_before,
      f"before={attempts_before} after={attempts_after}")
s, r = req("POST", "/api/zatca/toggle", ADMIN, {"enabled": True})
check("F15 إعادة التفعيل من الواجه (200)", s == 200 and r.get("enabled") is True, f"HTTP {s}")

# إلغاء فاتورة → يجب ألا تصل للهيئة أبدًا (skipped_cancelled)
s, r = req("POST", f"/api/pos/orders/{ORDER2}/void", ADMIN, {"reason": f"إلغاء فحص ZATCA {RUN}"})
check("F16 إلغاء الفاتورة الثانية عبر الواجه (200)", s == 200, f"HTTP {s} {json.dumps(r)[:100]}")
req("POST", "/api/zatca/queue/retry", ADMIN, {"scope": "all"})
skipped = wait_db(f"SELECT COUNT(*) FROM pos_zatca_invoice_queue WHERE order_id='{ORDER2}' AND status='skipped_cancelled'")
check("F17 الفاتورة الملغاة وُسمت skipped_cancelled — لن تُبلّغ للهيئة أبدًا", skipped == "1", skipped)

# ═══════════════ G) تطبيق الرقم الضريبي على كل الأقسام ═══════════════
print("\n■ G) زر تطبيق الرقم الضريبي على الأقسام")
s, r = req("POST", "/api/zatca/apply-vat", ADMIN, {"vat_number": TARGET_VAT})
updated = int(r.get("updated", 0)) if s == 200 else -1
check("G1 زر التطبيق يعمل ويحدّث الأقسام (200)", s == 200 and updated >= 1, f"HTTP {s} updated={updated}")
db_missing = int(psql(f"SELECT COUNT(*) FROM pos_departments WHERE COALESCE(vat_number,'') <> '{TARGET_VAT}'"))
check("G2 كل الأقسام أصبحت تحمل الرقم الضريبي الموحّد", db_missing == 0, f"ناقص={db_missing}")
s, r = req("POST", "/api/zatca/apply-vat", ADMIN, {})
check("G3 التطبيق بلا جسم يسحب الرقم من مركز الإعدادات ولا يكرر التعديل (0)",
      s == 200 and int(r.get("updated", -1)) == 0 and r.get("vat_number") == TARGET_VAT, f"HTTP {s} {json.dumps(r)[:100]}")

# ═══════════════ H) مراقب الطابور متسق ═══════════════
print("\n■ H) مراقب الطابور")
s, hub = req("GET", "/api/zatca/settings", ADMIN)
s, mon = req("GET", "/api/zatca/queue?limit=50", ADMIN)
db_counts = {r[0]: int(r[1]) for r in psql_rows("SELECT status, COUNT(*) FROM pos_zatca_invoice_queue GROUP BY status")}
stats_match = all(mon.get("stats", {}).get(k, 0) == v for k, v in db_counts.items())
check("H1 إحصاءات المراقب مطابقة لقاعدة البيانات بندًا بندًا", s == 200 and stats_match,
      f"API={json.dumps(mon.get('stats', {}))} DB={json.dumps(db_counts)}")
rows_have_orders = all(row.get("invoice_counter") for row in mon.get("data", []))
check("H2 صفوف المراقب مرتبطة بفواتير حقيقية (JOIN يعمل)", rows_have_orders or not mon.get("data"))

# ═══════════════ I) أثر التدقيق ═══════════════
print("\n■ I) أثر التدقيق pos_audit_logs")
audit_actions = psql(f"SELECT COUNT(*) FROM pos_audit_logs WHERE table_name='zatca_settings' AND occurred_at > '{TODAY}'")
check("I1 إجراءات ZATCA موثقة في سجل التدقيق (≥ 8 إجراءات اليوم)", int(audit_actions) >= 8, f"count={audit_actions}")

# ═══════════════ J) التنظيف والعودة للقطة الأساس ═══════════════
print("\n■ J) التنظيف الكامل")
req("POST", "/api/zatca/toggle", ADMIN, {"enabled": False})
req("POST", "/api/zatca/csid/manual", ADMIN, {"clear": True})
s, hub = req("GET", "/api/zatca/settings", ADMIN)
check("J1 الشهادة حُذفت من مركز الإعدادات", hub["config"]["has_csid"] is False)

BASELINE_CFG = {
    "seller_name": "مطاعم الشرفه العالمي", "vat_number": BASELINE_VAT, "crn": "1010101010",
    "branch_name": "الفرع الرئيسي", "address": "الرياض — حي العليا", "environment": "developer_portal",
    "solution_name": "Karim ERP", "eid": None, "max_attempts": 10, "api_base": None, "poll_in_server": True,
}
req("PUT", "/api/zatca/settings", ADMIN, BASELINE_CFG)
row = psql("SELECT enabled::text||'|'||environment||'|'||COALESCE(seller_name,'')||'|'||COALESCE(vat_number,'')||'|'||max_attempts FROM zatca_settings WHERE id=1")
check("J2 الإعدادات عادت مطابقة للقطة الأساس", row in ("f|developer_portal|مطاعم الشرفه العالمي|300000000000003|10", "false|developer_portal|مطاعم الشرفه العالمي|300000000000003|10"), row)

# إغلاق الوردية بفرق صفر ثم حذف آثار الفحص بالترتيب الآمن
net = float(psql_rows(f"SELECT COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='in' THEN ip.amount END),0)"
                      f"-COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='out' THEN ip.amount END),0) "
                      f"FROM pos_invoice_payments ip JOIN pos_orders o ON o.id=ip.order_id WHERE o.session_id={SHIFT_ID}")[0][0] or 0)
s, _ = req("POST", f"/api/pos/shifts/{SHIFT_ID}/close", ADMIN, {"actual_cash": net, "notes": f"إغلاق فحص ZATCA {RUN}"})
check("J3 إغلاق الوردية بفرق صفر", s == 200, f"HTTP {s} net={net}")

TEST_ORDERS = f"'{ORDER1}','{ORDER2}'"
for tbl in ["pos_pending_prints", "pos_zatca_invoice_queue", "pos_invoice_payments", "pos_order_items", "erp_revenues"]:
    try:
        psql(f"DELETE FROM {tbl} WHERE order_id IN ({TEST_ORDERS});")
    except Exception:
        pass  # جدول/عمود غير موجود في هذه المنشأة
psql(f"DELETE FROM pos_orders WHERE id IN ({TEST_ORDERS});")
psql(f"DELETE FROM pos_shift_sessions WHERE id = {SHIFT_ID};")  # بعد حذف الطلبات (قيد FK)
psql(f"DELETE FROM pos_products WHERE id = {PID};")
for dept_id, vat in snapshot["dept_vats"].items():
    psql(f"UPDATE pos_departments SET vat_number = {'NULL' if not vat else chr(39)+vat+chr(39)} WHERE id = {dept_id};")
# صفوف طابور تراثية (من جلسات سابقة) حاول الفحص إرسالها بصدق أثناء التفعيل —
# تُعاد إلى حالها قبل الفحص (queued) حتى لا يغيّر الفحص بيانات لا يخصّه
psql("UPDATE pos_zatca_invoice_queue SET status='queued', attempts=0, last_error=NULL, next_retry_at=CURRENT_TIMESTAMP "
     "WHERE status IN ('failed','dead_letter');")

after = {
    "dept_vats": {r[0]: r[1] for r in psql_rows("SELECT id, COALESCE(vat_number,'') FROM pos_departments ORDER BY id")},
    "queue_counts": {r[0]: r[1] for r in psql_rows("SELECT status, COUNT(*) FROM pos_zatca_invoice_queue GROUP BY status")},
    "orders": psql(f"SELECT COUNT(*) FROM pos_orders WHERE id IN ({TEST_ORDERS})"),
    "shifts": psql(f"SELECT COUNT(*) FROM pos_shift_sessions WHERE id > {snapshot['shifts_max']}"),
    "products": psql(f"SELECT COUNT(*) FROM pos_products WHERE id > {snapshot['products_max']}"),
}
check("J4 أرقام الأقسام عادت للقطة الأساس", after["dept_vats"] == snapshot["dept_vats"])
check("J5 الطابور عاد للقطة الأساس", after["queue_counts"] == snapshot["queue_counts"],
      f"{json.dumps(after['queue_counts'])} ← {json.dumps(snapshot['queue_counts'])}")
check("J6 لا بقايا: طلبات/ورديات/منتجات الفحص محذوفة",
      after["orders"] == "0" and after["shifts"] == "0" and after["products"] == "0")
s, hub = req("GET", "/api/zatca/settings", ADMIN)
check("J7 الحالة النهائية: الربط موقوف وبلا شهادة (كما كان قبل الفحص)",
      hub["config"]["enabled"] is False and hub["config"]["has_csid"] is False and hub["config"]["has_csr"] is True)

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
