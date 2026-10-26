#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_dept_cost_audit.py — فحص حي شامل: كلفة الأقسام الحقيقية (Task 15)
────────────────────────────────────────────────────────────────────────
يغطي:
  1) إذن صرف لقسم البوفيه المفتوح → يُسجَّل تلقائيًا مصروفًا على القسم (dispatch)
  2) استلام المطبخ الكميّات + إرجاع جزء → عكس مصروف سالب على نفس القسم
  3) جرد مخزن المطبخ بعجز → مصروف "عجز جرد" على القسم صاحب المخزن (count_correction)
  4) اتساق الإجماليات عبر /api/expenses وتطابق المبالغ مع متوسط التكلفة
  5) تنظيف كامل وإرجاع الأرصدة لمكانها بالضبط
"""
import json, re, subprocess, sys, time
import urllib.request

BASE = "http://localhost:5000"
PSQL = "/home/z/my-project/karim-erp/database/bin/bin/psql"
PGENV = {"PGPASSWORD": "karim_local_preview_2026_secure_password", "PATH": "/usr/bin:/bin"}
SIGNATURE = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg"
             "YPgPAAEDAQAIicLsAAAABJRU5ErkJggg==")

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
print("فحص حي: كلفة الأقسام — كل صرف/فرق جرد يُسجَّل مصروفًا على القسم")
print("═" * 68)

# ── 0) تسجيل الدخول ──────────────────────────────────────────────────────────
st, login = api("POST", "/api/auth/login", body={"username": "admin", "password": "Karim2026Demo"})
check("تسجيل دخول المدير", st == 200 and login.get("access_token"))
TOK = login["access_token"]

# ── 1) لقطة ما قبل الاختبار (بعد تنظيف أي آثار استكشاف سابقة) ────────────────
sql("DELETE FROM dispatches WHERE notes='probe'")  # إذن استكشاف قديم إن وُجد
snap_items = {r[0]: (float(r[1]), float(r[2]), r[3]) for r in sql(
    'SELECT id::text, qty, "avgCost", unit FROM inventory')}
snap_bal = {(r[0], r[1]): float(r[2]) for r in sql(
    "SELECT inventory_id::text, location_id::text, on_hand FROM inventory_location_balances")}
snap_exp = int(sql("SELECT count(*) FROM expenses")[0][0])
snap_disp = int(sql("SELECT count(*) FROM dispatches")[0][0])
print(f"  لقطة: {len(snap_items)} صنف، {len(snap_bal)} رصيد موقع، {snap_exp} مصروف، {snap_disp} إذن")

# بضاعة كافية في المخزن الرئيسي
item = None
for r in sql('SELECT i.id::text, i.name, b.on_hand, i."avgCost", i.unit, l.code '
             'FROM inventory i JOIN inventory_location_balances b ON b.inventory_id=i.id '
             'JOIN inventory_locations l ON l.id=b.location_id WHERE l.code=\'MAIN-WAREHOUSE\' AND b.on_hand>=2'):
    item = {"id": r[0], "name": r[1], "mainQty": float(r[2]), "cost": float(r[3]), "unit": r[4], "loc": r[5]}
    break
check("يوجد صنف برصيد كافٍ في المخزن الرئيسي", bool(item), f"{item['name']} ×{item['mainQty']} @ {item['cost']}" if item else "")

DISPATCH_QTY = 2.0
RETURN_QTY = 1.0
exp_amount = round(DISPATCH_QTY * item["cost"], 2)
ret_amount = round(RETURN_QTY * item["cost"], 2)

# ── 2) إذن صرف لقسم البوفيه المفتوح ────────────────────────────────────────
print("\n── دورة الصرف على قسم البوفيه المفتوح ──")
disp_id = None
st, created = api("POST", "/api/dispatches", TOK, {
    "deptCode": "open_buffet", "deptName": "البوفيه المفتوح",
    "items": [{"itemName": item["name"], "qty": DISPATCH_QTY, "unit": item["unit"]}],
    "notes": "فحص حي: مصروف القسم تلقائي"})
check("إنشاء إذن صرف للبوفيه", st in (200, 201), f"HTTP {st}")
disp_id = str(created.get("id")) if st in (200, 201) else None
check("الإذن بدولة الانتظار", bool(disp_id) and created.get("status") == "pending", str(created.get("status")))

st, appr = api("POST", f"/api/warehouse/dispatches/{disp_id}/approve", TOK,
               {"signatureData": SIGNATURE, "approveNotes": "فحص حي"})
check("اعتماد الإذن من المخزن", st == 200, f"HTTP {st}")
ap_exp = (appr.get("expenses") or [{}])[0]
check("مصروف تلقائي بقسم البوفيه", ap_exp.get("deptId") == "open_buffet", str(ap_exp.get("deptId")))
check("قيمة المصروف = الكمية × متوسط التكلفة", abs(float(ap_exp.get("amount", 0)) - exp_amount) < 0.01,
      f"{ap_exp.get('amount')} ≈ {exp_amount}")
check("نوع الحركة dispatch", ap_exp.get("adjustmentType") == "dispatch")
DISPATCH_EXP_ID = ap_exp.get("id")

st, rcv = api("POST", f"/api/warehouse/dispatches/{disp_id}/receive", TOK,
              {"items": [{"itemName": item["name"], "receivedQty": DISPATCH_QTY}],
               "signatureData": SIGNATURE, "notes": "استلام كامل"})
check("استلام القسم بالكمية الكاملة", st == 200 and rcv.get("dispatch", {}).get("status") == "received", f"HTTP {st}")

st, ret = api("POST", "/api/warehouse/returns", TOK,
              {"dispatchId": disp_id, "items": [{"itemName": item["name"], "qty": RETURN_QTY}],
               "reason": "فحص حي: إرجاع جزء"})
check("إرجاع جزء من الكمية", st == 201, f"HTTP {st}")
ret_exp = (ret.get("expenses") or [{}])[0]
check("عكس المصروف سالب على نفس القسم", float(ret_exp.get("amount", 0)) < 0 and ret_exp.get("deptId") == "open_buffet",
      f"{ret_exp.get('amount')} @ {ret_exp.get('deptId')}")
check("نوع الحركة dispatch_return", ret_exp.get("adjustmentType") == "dispatch_return")
RETURN_EXP_ID = ret_exp.get("id")

# ── 3) جرد مخزن المطبخ بعجز ────────────────────────────────────────────────
print("\n── عجز جرد على مخزن المطبخ (KITCHEN-MAIN) ──")
kitem = None
for r in sql('SELECT i.id::text, i.name, b.on_hand, i."avgCost", i.unit '
             'FROM inventory i JOIN inventory_location_balances b ON b.inventory_id=i.id '
             'JOIN inventory_locations l ON l.id=b.location_id WHERE l.code=\'KITCHEN-MAIN\' AND b.on_hand>=1'):
    kitem = {"id": r[0], "name": r[1], "kQty": float(r[2]), "cost": float(r[3]), "unit": r[4]}
    break
check("يوجد صنف في مخزن المطبخ", bool(kitem), f"{kitem['name']} ×{kitem['kQty']}" if kitem else "")

SHORT = 1.0
short_val = round(SHORT * kitem["cost"], 2)
# نظام_الكمية في الجرد = الرصيد العام (inventory.qty) وليس رصيد الموقع
sys_qty = float(sql(f'SELECT qty FROM inventory WHERE id={kitem["id"]}')[0][0])
st, aud = api("POST", "/api/warehouse/inventory/audits", TOK, {
    "warehouseScope": "KITCHEN-MAIN", "countedAt": "2026-08-30",
    "items": [{"itemId": int(kitem["id"]), "countedQty": round(sys_qty - SHORT, 3)}],
    "notes": "فحص حي: عجز جرد القسم"})
check("إنشاء جلسة جرد مخزن المطبخ", st == 201, f"HTTP {st} {aud.get('error','')}")
AUD_ID = aud["audit"]["id"]
st, sub = api("POST", f"/api/warehouse/inventory/audits/{AUD_ID}/submit", TOK, {"signatureData": SIGNATURE})
check("إرسال الجرد بتوقيع", st == 200, f"HTTP {st}")
st, appr2 = api("POST", f"/api/warehouse/inventory/audits/{AUD_ID}/approve", TOK, {"signatureData": SIGNATURE})
check("اعتماد الجرد وتطبيق العجز", st == 200, f"HTTP {st} {appr2.get('message','') if st != 200 else ''}")
a_exp = (appr2.get("expenses") or [{}])[0] if st == 200 else {}
check("مصروف «عجز جرد» ظهر تلقائيًا", bool(a_exp) and "عجز جرد" in str(a_exp.get("desc", "")), str(a_exp.get("desc", ""))[:60])
check("القسم صاحب المخزن = kitchen", a_exp.get("deptId") == "kitchen", str(a_exp.get("deptId")))
check("قيمة العجز = الكمية الناقصة × التكلفة", abs(float(a_exp.get("amount", 0)) - short_val) < 0.01,
      f"{a_exp.get('amount')} ≈ {short_val}")
check("نوع الحركة count_correction", a_exp.get("adjustmentType") == "count_correction")
AUDIT_EXP_ID = a_exp.get("id")

# ── 4) اتساق الإجماليات من /api/expenses ────────────────────────────────────
print("\n── اتساق كلفة الأقسام عبر الواجهة ──")
st, rows = api("GET", "/api/expenses", TOK)
rows = rows if isinstance(rows, list) else rows.get("data", [])
ob_rows = [e for e in rows if e.get("deptId") == "open_buffet"]
kit_rows = [e for e in rows if e.get("deptId") == "kitchen"]
ob_total = sum(float(e.get("amount", 0)) for e in ob_rows)
check("قسم البوفيه لديه مصروفات مسجلة", len(ob_rows) >= 2, f"{len(ob_rows)} بند")
check("صافي البوفيه = صرف − مرتجع", abs(ob_total - (exp_amount - ret_amount)) < 0.01, f"{ob_total} ≈ {exp_amount - ret_amount}")
kit_count_adj = sum(float(e.get("amount", 0)) for e in kit_rows if e.get("adjustmentType") == "count_correction")
check("كلفة عجز الجرد ظاهرة في مصروفات المطبخ", abs(kit_count_adj - short_val) < 0.01, f"{kit_count_adj} ≈ {short_val}")

db_dept = sql('SELECT "deptId", sum(amount) FROM expenses GROUP BY 1 ORDER BY 1')
print(f"  DB totals: {[(r[0], r[1]) for r in db_dept]}")

# ── 5) التنظيف الكامل وإرجاع الأرصدة ────────────────────────────────────────
print("\n── تنظيف بيانات الفحص ──")
ids = ",".join(str(x) for x in [DISPATCH_EXP_ID, RETURN_EXP_ID, AUDIT_EXP_ID] if x)
sql(f"DELETE FROM expenses WHERE id IN ({ids})" if ids else "SELECT 1")
sql(f"DELETE FROM dispatch_workflow_events WHERE dispatch_id={disp_id}")
sql(f"DELETE FROM dispatches WHERE id={disp_id}")
sql(f"DELETE FROM inventory_audit_workflow_events WHERE audit_id={AUD_ID}")
sql(f"DELETE FROM inventory_audit_items WHERE audit_id={AUD_ID}")
sql(f"DELETE FROM inventory_audits WHERE id={AUD_ID}")
sql(f"DELETE FROM inventory_ledger WHERE reference_id IN ('DIS-{disp_id}', '{AUD_ID}', '{disp_id}')")
sql(f"DELETE FROM \"kitchenReturns\" WHERE \"dispatchId\"='{disp_id}'")
for iid, (qty, cost, unit) in snap_items.items():
    sql(f'UPDATE inventory SET qty={qty}, "avgCost"={cost} WHERE id={iid}')
for (iid, lid), on_hand in snap_bal.items():
    sql(f"UPDATE inventory_location_balances SET on_hand={on_hand} WHERE inventory_id={iid} AND location_id={lid}")

after_exp = int(sql("SELECT count(*) FROM expenses")[0][0])
after_disp = int(sql("SELECT count(*) FROM dispatches")[0][0])
after_items = {r[0]: (float(r[1]), float(r[2]), r[3]) for r in sql('SELECT id::text, qty, "avgCost", unit FROM inventory')}
after_bal = {(r[0], r[1]): float(r[2]) for r in sql(
    "SELECT inventory_id::text, location_id::text, on_hand FROM inventory_location_balances")}
check("عدد المصروفات عاد كما كان", after_exp == snap_exp, f"{after_exp} == {snap_exp}")
check("عدد الأذونات عاد كما كان", after_disp == snap_disp, f"{after_disp} == {snap_disp}")
check("أرصدة الأصناف مطابقة تمامًا", after_items == snap_items)
check("أرصدة المواقع مطابقة تمامًا", after_bal == snap_bal)
# الجلسة المعتمدة محذوفة — لا أثر لها
left_aud = sql(f"SELECT count(*) FROM inventory_audits WHERE id={AUD_ID}")[0][0]
check("لا أثر لجلسة الجرد التجريبية", left_aud == "0")

print("\n" + "═" * 68)
print(f"النتيجة: {PASS} PASS / {FAIL} FAIL")
print("═" * 68)
sys.exit(1 if FAIL else 0)
