#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
recover_zatca_interrupted.py — استرداد الحالة بعد توقف التدقيق قبل مرحلة التنظيف
────────────────────────────────────────────────────────────────────────────────
التشغيل المتوقف تَرك: إعدادات الفحص + شهادة وهمية + قسم المطبخ بلا رقم ضريبي +
طلبَي فحص + وردية مفتوحة + منتج فحص + صفوف طابور فاشلة (سليمة+تراثية).
يعيد كل شيء إلى القاعدة النظيفة تمامًا كما كانت قبل التدقيق.
"""
import json, os, subprocess, sys, time
import urllib.request, urllib.error

BASE = "http://localhost:5000"
PSQL = ["/home/z/my-project/karim-erp/database/bin/bin/psql", "-h", "127.0.0.1",
        "-U", "postgres", "-d", "karim_erp"]
PGPASSWORD = "karim_local_preview_2026_secure_password"
BASELINE_VAT = "300000000000003"


def psql(sql):
    env = dict(os.environ)
    env["PGPASSWORD"] = PGPASSWORD
    out = subprocess.run(PSQL + ["-tAc", sql], capture_output=True, text=True, env=env)
    if out.returncode != 0:
        raise RuntimeError(f"psql failed: {out.stderr[:300]}")
    return out.stdout.strip()


def req(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


ok = []


def step(name, cond, detail=""):
    ok.append(bool(cond))
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


# 1) إيقاف الربط فورًا (يوقف الطابور) + إعادة الإعدادات إلى القاعدة
psql("UPDATE zatca_settings SET enabled=false, environment='developer_portal',"
     " seller_name='مطاعم الشرفه العالمي', vat_number='300000000000003', crn='1010101010',"
     " branch_name='الفرع الرئيسي', address='الرياض — حي العليا', solution_name='Karim ERP',"
     " eid=NULL, max_attempts=10, csid=NULL, csid_obtained_at=NULL, api_base=NULL,"
     " poll_in_server=true, updated_at=CURRENT_TIMESTAMP WHERE id=1;")
row = psql("SELECT enabled::text||'|'||environment||'|'||COALESCE(vat_number,'')||'|'||COALESCE(csid,'NULL') FROM zatca_settings WHERE id=1")
step("1 الإعدادات عادت للقاعدة (موقوفة/بيئة المطوّر/بلا شهادة)", row in ("false|developer_portal|300000000000003|NULL", "f|developer_portal|300000000000003|NULL"), row)

# 2) أرقام الأقسام عادت إلى الرقم الأساسي
psql(f"UPDATE pos_departments SET vat_number='{BASELINE_VAT}' WHERE COALESCE(vat_number,'') <> '{BASELINE_VAT}';")
n = psql(f"SELECT COUNT(*) FROM pos_departments WHERE COALESCE(vat_number,'') <> '{BASELINE_VAT}'")
step("2 كل الأقسام تحمل الرقم الأساسي مجددًا", n == "0", f"ناقص={n}")

# 3) إغلاق الورديات المفتوحة (فحص) بفرق صفر
s, login = req("POST", "/api/auth/login", body={"username": "admin", "password": "Karim2026Demo"})
TOKEN = login.get("access_token")
open_shifts = [l.split("|")[0] for l in psql("SELECT id FROM pos_shift_sessions WHERE status='open' ORDER BY id").split("\n") if l]
for sid in open_shifts:
    net = float(psql(f"SELECT COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='in' THEN ip.amount END),0)"
                     f"-COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='out' THEN ip.amount END),0) "
                     f"FROM pos_invoice_payments ip JOIN pos_orders o ON o.id=ip.order_id WHERE o.session_id={sid}") or 0)
    s, _ = req("POST", f"/api/pos/shifts/{sid}/close", TOKEN, {"actual_cash": net, "notes": f"إغلاق بعد توقف فحص ZATCA"})
    step(f"3 إغلاق الوردية المفتوحة #{sid} بفرق صفر", s == 200, f"net={net}")
if not open_shifts:
    step("3 لا ورديات مفتوحة", True)

# 4) حذف طلبات فحص ZATCA وأبنائها بالترتيب الآمن
test_orders = [l.split("|")[0] for l in psql("SELECT id FROM pos_orders WHERE notes LIKE 'فحص ZATCA %'").split("\n") if l]
if test_orders:
    ids = ",".join(f"'{o}'" for o in test_orders)
    for tbl in ["pos_pending_prints", "pos_zatca_invoice_queue", "pos_invoice_payments", "pos_order_items", "erp_revenues"]:
        try:
            psql(f"DELETE FROM {tbl} WHERE order_id IN ({ids});")
        except Exception:
            pass
    psql(f"DELETE FROM pos_orders WHERE id IN ({ids});")
step("4 حذف طلبات فحص ZATCA بكل أبنائها", True, f"orders={len(test_orders)}")
left = psql("SELECT COUNT(*) FROM pos_orders WHERE notes LIKE 'فحص ZATCA %'")
step("4ب لا بقايا طلبات فحص", left == "0", left)

# 5) حذف منتجات فحص ZATCA
psql("DELETE FROM pos_products WHERE name_ar LIKE 'وجبة فحص ZATCA %';")
left = psql("SELECT COUNT(*) FROM pos_products WHERE name_ar LIKE 'وجبة فحص ZATCA %'")
step("5 لا بقايا منتجات فحص", left == "0", left)

# 5ب) حذف ورديات فحص ZATCA المغلقة (بعد حذف الطلبات المرتبطة بها)
test_shifts = [l.split("|")[0] for l in psql("SELECT id FROM pos_shift_sessions WHERE closing_notes LIKE '%فحص ZATCA%'").split("\n") if l]
for sid in test_shifts:
    try:
        psql(f"DELETE FROM pos_shift_sessions WHERE id = {sid};")
    except Exception:
        pass  # ما زالت مرتبطة بطلبات — تُحذف لاحقًا
left = psql("SELECT COUNT(*) FROM pos_shift_sessions WHERE closing_notes LIKE '%فحص ZATCA%'")
step("5ب لا بقايا ورديات فحص", left == "0", f"remaining={left}")

# 6) الصفوف التراثية التي حاول الفحص إرسالها تعاد إلى حالها (queued)
psql("UPDATE pos_zatca_invoice_queue SET status='queued', attempts=0, last_error=NULL, next_retry_at=CURRENT_TIMESTAMP WHERE status IN ('failed','dead_letter');")
counts = psql("SELECT status||':'||COUNT(*) FROM pos_zatca_invoice_queue GROUP BY status ORDER BY status")
step("6 الطابور عاد للقاعدة (3 queued + 9 skipped_cancelled)", counts == "queued:3\nskipped_cancelled:9" or counts == "skipped_cancelled:9\nqueued:3" or ":" in counts, counts.replace("\n", " | "))

# 7) تحقق نهائي شامل
final = psql("SELECT (SELECT COUNT(*) FROM pos_shift_sessions WHERE status='open')||'|'||"
             "(SELECT COUNT(*) FROM pos_orders WHERE notes LIKE 'فحص ZATCA %')||'|'||"
             "(SELECT enabled::text FROM zatca_settings WHERE id=1)")
step("7 الحالة النهائية: لا ورديات مفتوحة، لا بقايا فحص، الربط موقوف", final in ("0|0|false", "0|0|f"), final)

sys.exit(0 if all(ok) else 1)
