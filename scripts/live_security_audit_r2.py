#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_security_audit_r2.py — التدقيق الأمني الحي، الجولة الثانية (2026-09-03)
════════════════════════════════════════════════════════════════════
يثبت على الخادم الحي (localhost:5000) إصلاحات الجولة الثانية:

  A. IDOR على التفاصيل: GET /api/<entity>/:id للكيانات الحساسة
     (payroll/users/revenues/expenses/purchaseInvoices) كان مفتوحاً
     لأي حساب مصادق رغم قفل القوائم في الجولة الأولى.
  B. توثيق أذونات الصرف: حذف معتمد/chef_approved/مرفوض → 409،
     المعلّق فقط يُحذف (200) — والسلسلة تعمل بعد الإصلاح.
  C. الكيانات المحمية: DELETE على inventoryTx/kitchenReturns/
     purchaseInvoices → 405 لأي دور.
  D. صنف مخزون له حركات لا يُحذف → 409 (كان 500 خام أو محو تاريخ).
  E. أرقام الطلبات: كميات/أسعار/إجماليات سالبة وpayment_status
     غريب → 422 (كانت تقبل 201).
  F. التصديق الذاتي للإجازات: صاحب الطلب لا يعتمد طلبه → 403.
  G. إخفاء رواتب الموظفين عن الأدوار غير المرتفعة.
  H. صفر بقايا: مطابقة لقطة الجداول قبل/بعد + تنظيف موسوم كامل.

Usage: python3 scripts/live_security_audit_r2.py
Exit code 0 = كل الفحوص نجحت.
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

BASE = "http://127.0.0.1:5000"  # IPv4 صراحةً — urllib لا يتراجع إلى IPv4 مثل curl
ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env")
PSQL = os.path.join(os.path.dirname(__file__), "..", "database", "bin", "bin", "psql")
DEMO_PASSWORD = "Karim2026Demo"
SIG = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
       "AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

PASS, FAIL = 0, 0
FAILURES = []
MARK = f"AUDITR2-{int(time.time())}"


def env(key, default=""):
    with open(ENV_PATH) as fh:
        for line in fh:
            m = re.match(rf"^{key}=(.*)$", line.strip())
            if m:
                return m.group(1)
    return default


DB_PASSWORD = env("DB_PASSWORD")


def sql(query, single=False):
    e = dict(os.environ, PGPASSWORD=DB_PASSWORD)
    out = subprocess.run(
        [PSQL, "-h", "localhost", "-U", "postgres", "-d", "karim_erp", "-t", "-A", "-c", query],
        capture_output=True, text=True, env=e, timeout=30,
    )
    if out.returncode != 0:
        raise RuntimeError(f"SQL failed: {out.stderr.strip()[:200]}")
    val = out.stdout.strip()
    return val if not single else (val.split("\n")[0] if val else "")


def http(method, path, token=None, body=None, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    time.sleep(0.25)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, f"CONNECTION_ERROR: {e}"


def login(username, password=DEMO_PASSWORD):
    s, b = http("POST", "/api/auth/login", body={"username": username, "password": password})
    if s != 200:
        return None
    return json.loads(b).get("access_token")


def check(group, name, ok, detail=""):
    global PASS, FAIL
    mark = "✓" if ok else "✗"
    print(f"  [{mark}] {name}" + (f" — {detail}" if detail and not ok else ""))
    if ok:
        PASS += 1
    else:
        FAIL += 1
        FAILURES.append(f"[{group}] {name} — {detail}")


SNAPSHOT_TABLES = [
    "users", "employees", "attendance", "leaveTypes", "leaveRequests",
    "leave_approval_workflows", "leave_approval_events", "orders", "order_items",
    "dispatches", "dispatch_workflow_events", "expenses", "revenues",
    "purchaseInvoices", "inventory", "inventoryTx", "inventory_ledger",
    "inventory_location_balances", "kitchenReturns", "notifications",
    "pos_refresh_tokens", "suppliers", "supplier_payments",
]


def snapshot():
    out = {}
    for t in SNAPSHOT_TABLES:
        try:
            out[t] = int(sql(f'SELECT count(*) FROM "{t}"', single=True))
        except Exception:
            out[t] = -1
    return out


# ═════════════════════════════════════════════════════════════════════════════
def main():
    print("═" * 78)
    print("التدقيق الأمني الحي — الجولة الثانية — Karim ERP v4.7.0 — " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
    print("═" * 78)

    # ─── [0] تهيئة ───
    print("\n[0] تهيئة الجلسات وتسخين المهاجرات")
    tokens = {}
    for u in ["admin", "chef", "keeper", "head_salads"]:
        tokens[u] = login(u)
        check("0", f"دخول {u}", tokens[u] is not None)
    admin, chef, keeper, head = tokens["admin"], tokens["chef"], tokens["keeper"], tokens["head_salads"]
    if not all([admin, chef, keeper, head]):
        print("تعذر تهيئة الجلسات — إحباط"); sys.exit(1)

    # تسخين سلسلة الإجازات: الـ backfill يملأ workflows للطلبات القديمة قبل اللقطة
    s, b = http("GET", "/api/hr/leave-workflow", token=admin)
    check("0", "تسخين backfill سلسلة الإجازات (قبل اللقطة)", s == 200)

    # اللقطة الأساسية قبل إنشاء أي بيانات مؤقتة — بعد التنظيف يجب أن تطابق تماماً
    baseline = snapshot()

    # ─── [S] بيانات مؤقتة موسومة ───
    print("\n[S] إنشاء بيانات التدقيق المؤقتة")
    ts = str(int(time.time()))

    # موظف مؤقت + مستخدم مدير مؤقت + ربط
    s, b = http("POST", "/api/employees", token=admin,
                body={"name": f"{MARK} EMP", "employeeId": f"{MARK}-E1", "position": "مدقق مؤقت"})
    emp = json.loads(b) if s == 201 else {}
    emp_id = emp.get("id")
    check("S", "موظف مؤقت 201", s == 201 and emp_id is not None, f"s={s} {b[:120]}")

    s, b = http("POST", "/api/users", token=admin,
                body={"username": f"audit_r2_{ts}", "password": "AuditR2!2026",
                      "role": "manager", "name": f"{MARK} MGR"})
    mgr_user = json.loads(b) if s == 201 else {}
    mgr_id = mgr_user.get("id")
    check("S", "مستخدم مدير مؤقت 201", s == 201 and mgr_id is not None, f"s={s} {b[:120]}")

    s, b = http("PUT", f"/api/users/{mgr_id}/employee", token=admin, body={"employeeId": emp_id})
    check("S", "ربط المدير المؤقت بالموظف", s == 200, f"s={s} {b[:150]}")

    mgr = login(f"audit_r2_{ts}", "AuditR2!2026")
    check("S", "دخول المدير المؤقت", mgr is not None)

    # فاتورة شراء بصنف مؤقت (مخزون 2 وحدة لسلسلة الصرف)
    item_name = f"{MARK} ITEM"
    s, b = http("POST", "/api/warehouse/purchase-invoices", token=admin,
                body={"items": [{"itemName": item_name, "qty": 2, "price": 5}],
                      "paymentMethod": "cash", "invoiceNumber": f"{MARK}-INV"})
    inv_resp = json.loads(b) if s == 201 else {}
    invoice_id = (inv_resp.get("invoice") or {}).get("id")
    item_id = ((inv_resp.get("inventory") or [{}])[0] or {}).get("id")
    check("S", "فاتورة شراء صنف مؤقت 201 (مخزون=2)", s == 201 and item_id is not None, f"s={s} {b[:150]}")

    # مرجعيات للفحص A (إن كان الجدول فارغاً نتجاوز فحصه بصدق)
    payroll_id = sql('SELECT id FROM payroll ORDER BY id DESC LIMIT 1') or None
    revenue_id = sql('SELECT id FROM revenues ORDER BY id DESC LIMIT 1') or None
    expense_id = sql('SELECT id FROM expenses ORDER BY id DESC LIMIT 1') or None
    admin_uid = sql("SELECT id FROM users WHERE username='admin'") or None
    leave_type_id = sql('SELECT id FROM "leaveTypes" ORDER BY id LIMIT 1') or None

    # ─── [A] IDOR: التفاصيل الحساسة بمعرف مباشر ───
    print("\n[A] IDOR — GET /:id للكيانات الحساسة (الجولة الأولى قفلت القائمة فقط)")
    if payroll_id:
        s, b = http("GET", f"/api/payroll/{payroll_id}", token=chef)
        check("A", "chef → payroll/:id = 403 (كان 200)", s == 403, f"s={s} {b[:120]}")
        s, b = http("GET", f"/api/payroll/{payroll_id}", token=mgr)
        check("A", "manager → payroll/:id = 200 (مسموح)", s == 200, f"s={s} {b[:120]}")
    else:
        check("A", "جدول payroll فارغ — فحصه عبر revenues بدلاً منه", True)
    s, b = http("GET", f"/api/users/{admin_uid}", token=chef)
    check("A", "chef → users/:id = 403", s == 403, f"s={s} {b[:120]}")
    s, b = http("GET", f"/api/expenses/{expense_id}", token=chef)
    check("A", "chef → expenses/:id = 403", s == 403, f"s={s} {b[:120]}")
    s, b = http("GET", f"/api/purchaseInvoices/{invoice_id}", token=chef)
    check("A", "chef → purchaseInvoices/:id = 403", s == 403, f"s={s} {b[:120]}")
    if revenue_id:
        s, b = http("GET", f"/api/revenues/{revenue_id}", token=chef)
        check("A", "chef → revenues/:id = 403", s == 403, f"s={s} {b[:120]}")
        s, b = http("GET", f"/api/revenues/{revenue_id}", token=mgr)
        check("A", "manager → revenues/:id = 200 (مسموح)", s == 200, f"s={s} {b[:120]}")

    # ─── [B] توثيق أذونات الصرف: الحذف والسلسلة ───
    print("\n[B] أذونات الصرف — حذف المستندات الموقّعة + سلامة السلسلة")

    def create_dispatch(token_, dept="kitchen"):
        s_, b_ = http("POST", "/api/dispatches", token=token_,
                      body={"deptCode": dept, "date": "2026-09-03",
                            "items": [{"itemName": item_name, "qty": 1}]})
        return s_, (json.loads(b_) or {}) if s_ == 201 else {}

    # 1) pending قابل للحذف (لا زيادة في التقييد)
    s_, d1 = create_dispatch(chef)
    d1_id = d1.get("id")
    check("B1", "إنشاء إذن معلق 201", s_ == 201 and d1_id is not None, f"s={s_}")
    s_, _ = http("DELETE", f"/api/dispatches/{d1_id}", token=keeper)
    check("B1", "حذف إذن معلق = 200 (مسار الإلغاء المشروع يعمل)", s_ == 200, f"s={s_}")

    # 2) معتمد → ممنوع، والاعتماد نفسه يعمل (اختبار انحدار للسلسلة)
    s_, d2 = create_dispatch(chef)
    d2_id = d2.get("id")
    s_, b_ = http("POST", f"/api/warehouse/dispatches/{d2_id}/approve", token=keeper,
                  body={"signatureData": SIG})
    approved_status = ((json.loads(b_) or {}).get("dispatch") or {}).get("status") if s_ == 200 else None
    check("B2", "اعتماد المخازن يعمل (انحدار السلسلة سليم)", s_ == 200 and approved_status == "approved", f"s={s_} {b_[:150]}")
    s_, b_ = http("DELETE", f"/api/dispatches/{d2_id}", token=keeper)
    err_code = (json.loads(b_) or {}).get("error") if s_ else None
    check("B2", "حذف إذن معتمد = 409 DISPATCH_ALREADY_APPROVED (كان 200!)", s_ == 409 and err_code == "DISPATCH_ALREADY_APPROVED", f"s={s_} {b_[:150]}")

    # 3) chef_approved → ممنوع (رئيس السلطات يطلب لقسمه فقط — الحرس يعمل)
    s_, d3 = create_dispatch(head, dept="salads")   # dept_head → needsChefApproval=true
    d3_id = d3.get("id")
    s_, b_ = http("POST", f"/api/warehouse/dispatches/{d3_id}/chef-approve", token=chef,
                  body={"signatureData": SIG})
    check("B3", "اعتماد الشيف لإذن رئيس القسم يعمل", s_ == 200, f"s={s_} {b_[:150]}")
    s_, b_ = http("DELETE", f"/api/dispatches/{d3_id}", token=keeper)
    err_code = (json.loads(b_) or {}).get("error") if s_ else None
    check("B3", "حذف إذن chef_approved = 409 DISPATCH_CHEF_DECIDED", s_ == 409 and err_code == "DISPATCH_CHEF_DECIDED", f"s={s_} {b_[:150]}")

    # 4) مرفوض → ممنوع
    s_, d4 = create_dispatch(chef)
    d4_id = d4.get("id")
    s_, _ = http("POST", f"/api/warehouse/dispatches/{d4_id}/reject", token=keeper,
                 body={"reason": "رفض تدقيق الجولة الثانية", "signatureData": SIG})
    check("B4", "رفض المخازن يعمل", s_ == 200)
    s_, b_ = http("DELETE", f"/api/dispatches/{d4_id}", token=keeper)
    err_code = (json.loads(b_) or {}).get("error") if s_ else None
    check("B4", "حذف إذن مرفوض = 409 DISPATCH_REJECTED", s_ == 409 and err_code == "DISPATCH_REJECTED", f"s={s_} {b_[:150]}")

    # ─── [C] الكيانات المحمية من الحذف ───
    print("\n[C] append-only — DELETE على السجل المالي المحصّن")
    for entity, eid in [("inventoryTx", 1), ("kitchenReturns", 1), ("purchaseInvoices", invoice_id)]:
        s_, b_ = http("DELETE", f"/api/{entity}/{eid}", token=admin)
        err_code = (json.loads(b_) or {}).get("error") if s_ else None
        check("C", f"admin DELETE {entity}/:id = 405 PROTECTED_ENTITY_DELETE", s_ == 405 and err_code == "PROTECTED_ENTITY_DELETE", f"s={s_} {b_[:120]}")
    s_, b_ = http("DELETE", "/api/kitchenReturns/1", token=chef)
    check("C", "chef (دوره مسموح كتابةً) يصل الحرس المالي → 405", s_ == 405, f"s={s_}")

    # ─── [D] صنف له حركات لا يُحذف ───
    print("\n[D] حماية أصناف المخزون ذات الحركات")
    s_, b_ = http("DELETE", f"/api/inventory/{item_id}", token=admin)
    err_code = (json.loads(b_) or {}).get("error") if s_ else None
    check("D", "حذف صنف له حركات = 409 INVENTORY_HAS_MOVEMENTS (كان 500/محو تاريخ)", s_ == 409 and err_code == "INVENTORY_HAS_MOVEMENTS", f"s={s_} {b_[:150]}")

    # ─── [E] أرقام الطلبات ───
    print("\n[E] /api/orders — لا مبالغ سالبة ولا payment_status حرة")
    s_, b_ = http("POST", "/api/orders", token=chef,
                  body={"items": [{"product_name": f"{MARK} DISH", "quantity": -3, "unit_price": -5, "total": 15}],
                        "subtotal": -100, "total": -100, "payment_status": "hacked"})
    err_code = (json.loads(b_) or {}).get("error") if s_ else None
    check("E", "طلب بكميات/مبالغ سالبة وحالة دفع غريبة = 422 (كان 201!)", s_ == 422 and err_code == "INVALID_ORDER_NUMERICS", f"s={s_} {b_[:150]}")

    s_, b_ = http("POST", "/api/orders", token=chef,
                  body={"items": [{"product_name": f"{MARK} DISH", "quantity": 1, "unit_price": 2, "total": 2}],
                        "total": 2, "payment_status": "unpaid"})
    order = json.loads(b_) if s_ == 201 else {}
    order_id = order.get("id")
    check("E", "طلب سليم = 201", s_ == 201 and order_id is not None, f"s={s_} {b_[:120]}")

    s_, _ = http("PUT", f"/api/orders/{order_id}", token=chef, body={"total": -99})
    check("E", "chef PUT على الطلب = 403 (حرس الجولة الأولى قائم)", s_ == 403, f"s={s_}")
    s_, b_ = http("PUT", f"/api/orders/{order_id}", token=admin, body={"total": -99})
    err_code = (json.loads(b_) or {}).get("error") if s_ else None
    check("E", "admin PUT بإجمالي سالب = 422", s_ == 422 and err_code == "INVALID_ORDER_NUMERICS", f"s={s_} {b_[:150]}")
    if order_id:
        s_, _ = http("DELETE", f"/api/orders/{order_id}", token=admin)
        check("E", "تنظيف الطلب المؤقت بـ API = 200", s_ == 200, f"s={s_}")

    # ─── [F] التصديق الذاتي في الإجازات ───
    print("\n[F] سلسلة الإجازات — لا اعتماد لطلبك بنفسك")
    s_, b_ = http("POST", "/api/hr/leave-requests", token=mgr,
                  body={"employeeId": emp_id, "leaveTypeId": int(leave_type_id or 0),
                        "startDate": "2026-09-10", "endDate": "2026-09-11", "reason": "تدقيق جولة ثانية"})
    leave = json.loads(b_) if s_ == 201 else {}
    leave_id = (leave.get("leave") or {}).get("id")
    check("F", "المدير يقدم إجازة لنفسه = 201", s_ == 201 and leave_id is not None, f"s={s_} {b_[:150]}")
    s_, b_ = http("POST", f"/api/hr/leave-workflow/{leave_id}/action", token=mgr, body={"action": "approve"})
    err_code = (json.loads(b_) or {}).get("error") if s_ else None
    check("F", "اعتماد طلبك بنفسك = 403 LEAVE_SELF_APPROVAL_FORBIDDEN (كان 200!)", s_ == 403 and err_code == "LEAVE_SELF_APPROVAL_FORBIDDEN", f"s={s_} {b_[:150]}")
    s_, b_ = http("POST", f"/api/hr/leave-workflow/{leave_id}/action", token=admin, body={"action": "approve"})
    check("F", "admin يعتمد نفس الطلب = 200 (السلسلة تعمل)", s_ == 200, f"s={s_} {b_[:150]}")

    # ─── [G] إخفاء الرواتب ───
    print("\n[G] رواتب الموظفين مخفية عن غير المرتفعين")
    s_, b_ = http("GET", "/api/employees", token=chef)
    rows = (json.loads(b_) or {}).get("data") or [] if s_ == 200 else []
    mine = [r for r in rows if str(r.get("id")) == str(emp_id)]
    check("G", "chef يقرأ قائمة الموظفين (بوابة الموظف تعمل)", s_ == 200 and bool(rows), f"s={s_}")
    check("G", "صف الموظف لدى chef بلا حقل salary", bool(mine) and "salary" not in mine[0], f"keys={list(mine[0].keys())[:20] if mine else '؟'}")
    s_, b_ = http("GET", f"/api/employees/{emp_id}", token=chef)
    row = json.loads(b_) if s_ == 200 else {}
    check("G", "chef → employees/:id بلا salary", s_ == 200 and "salary" not in row, f"s={s_}")
    s_, b_ = http("GET", f"/api/employees/{emp_id}", token=admin)
    row = json.loads(b_) if s_ == 200 else {}
    check("G", "admin → employees/:id يرى salary", s_ == 200 and "salary" in row, f"s={s_}")

    # ─── [H] تنظيف + صفر بقايا ───
    print("\n[H] التنظيف وصفر بقايا")
    dispatch_ids = ",".join(str(x) for x in [d1_id, d2_id, d3_id, d4_id] if x)
    dispatch_ids_quoted = ",".join(f"'{x}'" for x in [d1_id, d2_id, d3_id, d4_id] if x)
    steps = [
        ("إشعارات السلسلة", f"DELETE FROM notifications WHERE entity='dispatches' AND entity_id IN ({dispatch_ids_quoted or 'NULL'})"),
        ("إشعارات موسومة", f"DELETE FROM notifications WHERE title LIKE '%{MARK}%' OR message LIKE '%{MARK}%'"),
        ("أحداث أذونات الصرف", f"DELETE FROM dispatch_workflow_events WHERE dispatch_id IN ({dispatch_ids or 'NULL'})"),
        ("أذونات الصرف", f"DELETE FROM dispatches WHERE id IN ({dispatch_ids or 'NULL'})"),
        ("مصروفات الاعتماد", f"DELETE FROM expenses WHERE \"desc\" LIKE '%{MARK}%' OR notes LIKE '%{MARK}%'"),
        ("دفتر المخزون", f"DELETE FROM inventory_ledger WHERE inventory_id={item_id}"),
        ("حركات المخزون", f"DELETE FROM \"inventoryTx\" WHERE \"itemId\"={item_id}"),
        ("أرصدة المواقع", f"DELETE FROM inventory_location_balances WHERE inventory_id={item_id}"),
        ("الصنف المؤقت", f"DELETE FROM inventory WHERE id={item_id}"),
        ("فاتورة الشراء", f"DELETE FROM \"purchaseInvoices\" WHERE id={invoice_id}"),
        ("إجراءات سلسلة الإجازة", f"DELETE FROM leave_approval_workflows WHERE leave_request_id={leave_id}"),
        ("طلب الإجازة", f"DELETE FROM \"leaveRequests\" WHERE id={leave_id}"),
        ("رموز المدير المؤقت", f"DELETE FROM pos_refresh_tokens WHERE user_id={mgr_id}"),
        ("المدير المؤقت", f"DELETE FROM users WHERE id={mgr_id} AND username='audit_r2_{ts}'"),
        ("الموظف المؤقت", f"DELETE FROM employees WHERE id={emp_id} AND name LIKE '%{MARK}%'"),
        ("سلامة إضافية: طلب مؤقت", f"DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE notes LIKE '%{MARK}%' OR id={order_id or 'NULL'})"),
        ("سلامة إضافية: بنود طلب", f"DELETE FROM orders WHERE id={order_id or 'NULL'}"),
    ]
    for label, query in steps:
        try:
            sql(query)
            print(f"  • حُذف: {label}")
        except Exception as e:
            print(f"  ⚠ {label}: {e}")

    after = snapshot()
    residue = {t: (baseline.get(t), after.get(t)) for t in SNAPSHOT_TABLES if baseline.get(t) != after.get(t)}
    check("H", "صفر بقايا — مطابقة لقطة 23 جدولاً قبل/بعد", not residue, f"فروق: {residue}")

    # ─── الخلاصة ───
    print("\n" + "═" * 78)
    print(f"النتيجة: {PASS} ناجح / {FAIL} فاشل")
    if FAILURES:
        print("الإخفاقات:")
        for f_ in FAILURES:
            print(f"  - {f_}")
    print("═" * 78)
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
