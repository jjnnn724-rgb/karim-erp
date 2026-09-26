#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_delivery_printer_audit.py — التدقيق الحي للتسليم النهائي (Task 36)
════════════════════════════════════════════════════════════════════════════
يثبت على الخادم الحي (localhost:5000) جاهزية التسليم:

  [0] الجلسات والحسابات المفتوحة: دخول الأدوار، صفر حسابات معطلة،
      صفر توكنات منتهية (التنظيف الأوتوماتيكي عامل)، العاملان الخلفيان أحياء.
  [S] بيانات مؤقتة موسومة: فاتورة شراء + منتج اختبار في قسم البيع الخارجي.
  [P] إدارة الطابعات والاكتشاف: بوابات الأدوار، تسجيل/تعديل/حذف، probe
      (وصل/فصل)، scan لاكتشاف الطابعات على الشبكة، تحقق المخططات (422/409).
  [C] السلسلة الأوتوماتيكية كاملة: بيع حقيقي → إيصال + KOT تلقائيًا →
      العامل يطبع على طابعة ESC/POS وهمية (TCP 9100) خلال ثوانٍ → إعادة
      طباعة → replay بمفتاح idempotency بلا ازدواج مهام.
  [D] صفر بقايا: تنظيف موسوم كامل + مطابقة لقطة الجداول قبل/بعد.

Usage: python3 scripts/live_delivery_printer_audit.py
Exit code 0 = كل الفحوص نجحت.
"""

import json
import os
import re
import socketserver
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

BASE = "http://127.0.0.1:5000"
ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env")
PSQL = os.path.join(os.path.dirname(__file__), "..", "database", "bin", "bin", "psql")
DEMO_PASSWORD = "Karim2026Demo"
CAPTURE_FILE = os.path.join(os.path.dirname(__file__), "..", "logs", "fake-printer-capture.bin")

PASS, FAIL = 0, 0
FAILURES = []
MARK = f"DLC-{int(time.time())}"

# ─── الطابعة الوهمية ESC/POS (TCP 9100) — تستقبل البايتات وتحفظها ───────────
RECEIVED = []          # قائمة كتل البايتات الواردة
_prn_server = None
_prn_thread = None


class FakePrinterHandler(socketserver.BaseRequestHandler):
    def handle(self):
        data = b""
        while True:
            chunk = self.request.recv(4096)
            if not chunk:
                break
            data += chunk
        if data:
            RECEIVED.append(data)
            with open(CAPTURE_FILE, "ab") as fh:
                fh.write(b"\n<<<CONN-" + str(time.time()).encode() + b">>>\n")
                fh.write(data)


def start_fake_printer(port=9100):
    global _prn_server, _prn_thread
    try:
        os.remove(CAPTURE_FILE)
    except OSError:
        pass
    socketserver.TCPServer.allow_reuse_address = True
    _prn_server = socketserver.TCPServer(("127.0.0.1", port), FakePrinterHandler)
    _prn_thread = threading.Thread(target=_prn_server.serve_forever, daemon=True)
    _prn_thread.start()
    return port


def stop_fake_printer():
    if _prn_server:
        _prn_server.shutdown()
        _prn_server.server_close()


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


def http(method, path, token=None, body=None, headers=None, timeout=25):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
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
        return None, None
    j = json.loads(b)
    return j.get("access_token"), j.get("refresh_token") or j.get("refreshToken")


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
    "users", "employees", "orders", "order_items", "dispatches",
    "dispatch_workflow_events", "expenses", "revenues", "purchaseInvoices",
    "inventory", "inventoryTx", "inventory_ledger",
    "inventory_location_balances", "kitchenReturns", "notifications",
    "pos_refresh_tokens", "suppliers", "supplier_payments",
    "pos_printers", "pos_pending_prints", "pos_orders", "pos_order_items",
    "pos_invoice_payments", "pos_shift_sessions", "pos_zatca_invoice_queue",
    "pos_products", "pos_idempotency_keys",
]


def snapshot():
    out = {}
    for t in SNAPSHOT_TABLES:
        try:
            out[t] = int(sql(f'SELECT count(*) FROM "{t}"', single=True))
        except Exception:
            out[t] = -1
    return out


def pid_alive(pattern):
    out = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True)
    return out.returncode == 0 and out.stdout.strip() != ""


# ═════════════════════════════════════════════════════════════════════════════
def main():
    global PASS, FAIL
    print("═" * 78)
    print("التدقيق الحي للتسليم النهائي — Karim ERP v4.7.0 — " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
    print("═" * 78)
    audit_start_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S+00")

    # تنظيف بقايا تاريخية موثقة (مهام 08-30 لطابعة pos-13 غير المسجلة) قبل اللقطة
    print("\n[i] تنظيف بقايا تاريخية قبل اللقطة")
    old_jobs = sql("SELECT count(*) FROM pos_pending_prints WHERE printer_id = 'pos-13'", single=True)
    if old_jobs != "0":
        sql("DELETE FROM pos_pending_prints WHERE printer_id = 'pos-13'")
    print(f"  [i] حُذفت {old_jobs} مهمة قديمة لطابعة pos-13 غير المسجلة")

    # اللقطة الأساسية قبل أي جلسات/بيانات — بعد التنظيف يجب أن تطابق تماماً
    baseline = snapshot()

    # ─── [0] الجلسات والحسابات المفتوحة والعاملون ───
    print("\n[0] الجلسات والحسابات المفتوحة والعاملون الخلفيون")
    port = start_fake_printer()
    check("0", "الطابعة الوهمية ESC/POS تستمع على 127.0.0.1:9100", port == 9100)

    tokens, refreshes = {}, {}
    for u in ["admin", "chef", "keeper", "head_salads"]:
        tokens[u], refreshes[u] = login(u)
        check("0", f"دخول {u} (access+refresh)", tokens[u] is not None and refreshes[u] is not None)
    admin, chef, keeper = tokens["admin"], tokens["chef"], tokens["keeper"]
    if not all([admin, chef, keeper]):
        print("تعذر تهيئة الجلسات — إحباط")
        stop_fake_printer()
        sys.exit(1)

    check("0", "الحسابات المفتوحة: صفر حسابات معطلة في users",
          sql("SELECT count(*) FROM users WHERE active = false", single=True) == "0")
    check("0", "كل حسابات النظام التسعة نشطة (admin+chef+keeper+6 رؤساء أقسام)",
          sql("SELECT count(*) FROM users WHERE active = true", single=True) == "9")
    check("0", "التوكنات: صفر توكنات منتهية (التنظيف الأوتوماتيكي عامل)",
          sql("SELECT count(*) FROM pos_refresh_tokens WHERE expires_at < CURRENT_TIMESTAMP", single=True) == "0")
    check("0", "عامل الطباعة print-worker حي كعملية", pid_alive("cashier-module/print-worker.js"))
    check("0", "عامل ZATCA حي كعملية", pid_alive("cashier-module/zatca-worker.js"))

    # ─── [S] بيانات مؤقتة موسومة ───
    print("\n[S] بيانات التدقيق المؤقتة")
    s, b = http("POST", "/api/warehouse/purchase-invoices", token=admin,
                body={"items": [{"itemName": f"{MARK} ITEM", "qty": 2, "price": 5}],
                      "paymentMethod": "cash", "invoiceNumber": f"{MARK}-INV"})
    inv = json.loads(b) if s == 201 else {}
    invoice_id = (inv.get("invoice") or {}).get("id")
    item_id = ((inv.get("inventory") or [{}])[0] or {}).get("id")
    check("S", "فاتورة شراء صنف مؤقت 201", s == 201 and invoice_id is not None, f"s={s} {b[:120]}")

    ext_dept = int(sql("SELECT id FROM pos_departments WHERE code='erp_external_sales'", single=True))
    kitchen_dept = int(sql("SELECT id FROM pos_departments WHERE code='erp_kitchen'", single=True))
    s, b = http("POST", "/api/pos/products", token=admin,
                body={"name_ar": f"{MARK} PROD", "department_id": ext_dept, "price": 15,
                      "stock_quantity": 10, "vat_rate": 15})
    prod = json.loads(b) if s in (200, 201) else {}
    product_id = prod.get("id")
    check("S", f"منتج اختبار في قسم البيع الخارجي (dept {ext_dept})", s in (200, 201) and product_id, f"s={s} {b[:150]}")

    # ─── [P] إدارة الطابعات والاكتشاف ───
    print("\n[P] إدارة الطابعات والاكتشاف — بوابات + probe + scan")
    receipt_pid, kot_pid = f"pos-{ext_dept}", f"kot-{ext_dept}"
    kot2_pid = f"kot-{kitchen_dept}"

    s, b = http("POST", "/api/pos/printers", token=chef,
                body={"kind": "receipt", "department_id": ext_dept, "connection_type": "network", "address": "127.0.0.1:9100"})
    check("P", "chef → تسجيل طابعة = 403 (بوابة الدور)", s == 403, f"s={s}")
    s, b = http("POST", "/api/pos/printers", token=keeper,
                body={"kind": "receipt", "department_id": ext_dept, "connection_type": "network", "address": "127.0.0.1:9100"})
    check("P", "keeper → تسجيل طابعة = 403 (بوابة الدور)", s == 403, f"s={s}")

    for pid_, kind_, label in [(receipt_pid, "receipt", "إيصالات القسم"), (kot_pid, "kot", "مطبخ القسم"), (kot2_pid, "kot", "مطبخ عام")]:
        s, b = http("POST", "/api/pos/printers", token=admin,
                    body={"id": pid_, "kind": kind_, "name": f"طابعة {label} (تدقيق)", "connection_type": "network", "address": "127.0.0.1:9100"})
        check("P", f"admin تسجيل طابعة {pid_} ({label}) = 201", s == 201, f"s={s} {b[:120]}")

    s, b = http("POST", "/api/pos/printers", token=admin,
                body={"id": receipt_pid, "kind": "receipt", "department_id": ext_dept, "connection_type": "network", "address": "127.0.0.1:9100"})
    check("P", "تسجيل مكرر = 409 (لا ازدواج)", s == 409, f"s={s}")
    s, b = http("POST", "/api/pos/printers", token=admin,
                body={"kind": "receipt", "department_id": ext_dept, "connection_type": "network", "address": "عنوان غير صالح!"})
    check("P", "عنوان فاسد = 422 (zod)", s == 422, f"s={s}")
    s, b = http("POST", "/api/pos/printers", token=admin,
                body={"kind": "receipt", "department_id": ext_dept, "connection_type": "usb", "address": "whatever"})
    check("P", "نوع usb مرفوض 422 (يتطلب escpos-usb — لا مهام مستحيلة)", s == 422, f"s={s}")

    s, b = http("POST", "/api/pos/printers/probe", token=admin, body={"id": receipt_pid})
    j = json.loads(b) if s == 200 else {}
    check("P", "probe الطابعة الحية → reachable=true بزمن استجابة", s == 200 and j.get("reachable") is True and isinstance(j.get("latency_ms"), int), f"s={s} {b[:120]}")
    s, b = http("GET", "/api/pos/printers", token=admin)
    lst = json.loads(b) if s == 200 else {}
    online_map = {p["id"]: p for p in lst.get("printers", [])}
    check("P", "probe رفع is_online=true في القاعدة", online_map.get(receipt_pid, {}).get("is_online") is True)

    dead_pid = "zztest-dead-printer"
    s, b = http("POST", "/api/pos/printers", token=admin,
                body={"id": dead_pid, "kind": "receipt", "connection_type": "network", "address": "127.0.0.1:1"})
    check("P", f"تسجيل طابعة ميتة للفحص ({dead_pid}) = 201", s == 201, f"s={s}")
    s, b = http("POST", "/api/pos/printers/probe", token=admin, body={"id": dead_pid})
    j = json.loads(b) if s == 200 else {}
    check("P", "probe الطابعة الميتة → reachable=false برمز خطأ", s == 200 and j.get("reachable") is False and j.get("error"), f"s={s} {b[:120]}")
    s, b = http("GET", "/api/pos/printers", token=admin)
    lst = json.loads(b) if s == 200 else {}
    online_map = {p["id"]: p for p in lst.get("printers", [])}
    check("P", "probe هبط is_online=false للطابعة الميتة", online_map.get(dead_pid, {}).get("is_online") is False)
    s, b = http("DELETE", f"/api/pos/printers/{dead_pid}", token=admin)
    check("P", "حذف الطابعة الميتة 200", s == 200, f"s={s}")

    s, b = http("POST", "/api/pos/printers/scan", token=admin,
                body={"subnet": "127.0.0.0", "port": 9100, "timeout_ms": 200})
    j = json.loads(b) if s == 200 else {}
    found = any(h.get("ip") == "127.0.0.1" for h in j.get("reachable", []))
    check("P", "scan الشبكة اكتشف الطابعة الوهمية 127.0.0.1:9100", s == 200 and found, f"s={s} reachable={j.get('reachable')}")
    s, b = http("POST", "/api/pos/printers/scan", token=admin, body={"subnet": "not-a-subnet"})
    check("P", "scan بشبكة فاسدة = 422", s == 422, f"s={s}")
    s, b = http("POST", "/api/pos/printers/scan", token=chef, body={"subnet": "127.0.0.0"})
    check("P", "chef → scan = 403 (بوابة الدور)", s == 403, f"s={s}")

    # ─── [C] السلسلة الأوتوماتيكية الكاملة ───
    print("\n[C] البيع → طباعة تلقائية (إيصال + KOT) → إعادة طباعة → replay")
    s, b = http("POST", "/api/pos/shifts/open", token=admin,
                body={"department_id": ext_dept, "opening_balance": 500})
    shift = json.loads(b) if s in (200, 201) else {}
    session_id = shift.get("session_id") or shift.get("id")
    check("C", f"فتح وردية على قسم البيع الخارجي (dept {ext_dept})", s in (200, 201) and session_id, f"s={s} {b[:150]}")

    s, b = http("GET", f"/api/pos/products?department_id={ext_dept}", token=admin)
    plist = json.loads(b) if s == 200 else []
    rows = plist if isinstance(plist, list) else (plist.get("products") or [])
    prod_row = next((p for p in rows if int(p.get("id") or 0) == int(product_id or -1)), rows[0] if rows else {})
    unit_price = float(prod_row.get("price") or 15)
    check("C", "قراءة سعر المنتج من قائمة الكاشير", bool(prod_row), f"s={s} {b[:120]}")

    total = round(unit_price * 1.15, 2)  # سعر × 1 + ضريبة 15%
    idem_key = f"{MARK}-SALE-1"
    s, b = http("POST", "/api/sales/complete", token=admin,
                body={"department_id": ext_dept, "session_id": session_id,
                      "items": [{"product_id": product_id, "quantity": 1, "unit_price": unit_price, "discount": 0}],
                      "payments": [{"method": "cash", "amount": total}]},
                headers={"Idempotency-Key": idem_key, "X-Shift-Session-Id": str(session_id)})
    sale = json.loads(b) if s in (200, 201) else {}
    order_id = sale.get("order_id") or (sale.get("order") or {}).get("id")
    check("C", "بيع حقيقي 201/202 (مفتاح idempotency موسوم)", s in (200, 201) and order_id, f"s={s} {b[:180]}")

    jobs0 = sql(f"SELECT count(*) FROM pos_pending_prints WHERE order_id = '{order_id}'", single=True)
    check("C", "أُنشئت مهام طباعة تلقائياً بعد البيع (≥2: إيصال + KOT)", int(jobs0) >= 2, f"jobs={jobs0}")
    receipt_job = sql(f"SELECT count(*) FROM pos_pending_prints WHERE order_id = '{order_id}' AND printer_id = '{receipt_pid}'", single=True)
    check("C", f"مهمة الإيصال موجهة للطابعة القياسية {receipt_pid}", int(receipt_job) >= 1, f"count={receipt_job}")

    # انتظار العامل حتى يطبع كل المهام (poll كل 2 ثانية)
    printed, waited = False, 0
    while waited < 15:
        time.sleep(2)
        waited += 2
        remaining = sql(f"SELECT count(*) FROM pos_pending_prints WHERE order_id = '{order_id}' AND status <> 'printed'", single=True)
        if int(remaining) == 0:
            printed = True
            break
    check("C", f"العامل طبع كل المهام تلقائياً خلال {waited}ث (pending→printed)", printed)

    all_printed = sql(f"SELECT count(*) FROM pos_pending_prints WHERE order_id = '{order_id}' AND status='printed'", single=True)
    check("C", "حالة كل المهام = printed في القاعدة", int(all_printed) == int(jobs0), f"printed={all_printed}/{jobs0}")

    blob = b"".join(RECEIVED)
    check("C", "الطابعة الوهمية استقبلت بايتات ESC/POS فعلاً", len(blob) > 100, f"bytes={len(blob)}")
    check("C", "الإيصال يبدأ بتهيئة ESC/POS (0x1B 0x40)", b"\x1b@" in blob)
    check("C", "الإيصال يحمل مبلغًا بصيغة SAR (fmtMoney)", "SAR".encode() in blob)
    prod_name_bytes = f"{MARK} PROD".encode()
    check("C", "اسم الصنف ظهر في البايتات المطبوعة", prod_name_bytes in blob)
    kot_jobs = sql(f"SELECT count(*) FROM pos_pending_prints WHERE order_id = '{order_id}' AND printer_id LIKE 'kot-%'", single=True)
    if int(kot_jobs) > 0:
        kot_blob = sql(f"SELECT encode(payload,'escape') FROM pos_pending_prints WHERE order_id = '{order_id}' AND printer_id LIKE 'kot-%' LIMIT 1")
        check("C", "تذكرة المطبخ بلا أسعار (لا SAR على KOT)", "SAR" not in kot_blob)
        check("C", "تذكرة المطبخ تحمل اسم الصنف", "PROD" in kot_blob)

    s, b = http("POST", f"/api/pos/orders/{order_id}/reprint", token=admin)
    check("C", "إعادة الطباعة 200 (طابعة متصلة مسجلة)", s == 200, f"s={s} {b[:140]}")
    time.sleep(5)
    reprint_done = sql(f"SELECT count(*) FROM pos_pending_prints WHERE order_id = '{order_id}' AND status='printed'", single=True)
    check("C", "مهمة إعادة الطباعة اكتملت printed", int(reprint_done) > int(all_printed), f"printed={reprint_done}")

    jobs_after_replay = sql(f"SELECT count(*) FROM pos_pending_prints WHERE order_id = '{order_id}'", single=True)
    s, b = http("POST", "/api/sales/complete", token=admin,
                body={"department_id": ext_dept, "session_id": session_id,
                      "items": [{"product_id": product_id, "quantity": 1, "unit_price": unit_price, "discount": 0}],
                      "payments": [{"method": "cash", "amount": total}]},
                headers={"Idempotency-Key": idem_key, "X-Shift-Session-Id": str(session_id)})
    jobs_final = sql(f"SELECT count(*) FROM pos_pending_prints WHERE order_id = '{order_id}'", single=True)
    check("C", "replay بنفس المفتاح لا يولّد مهام طباعة جديدة (لا ازدواج)", s in (200, 201) and jobs_final == jobs_after_replay, f"s={s} {jobs_after_replay}→{jobs_final}")

    # دورة حياة التوكن: تدوير ثم خروج يبطل
    s, b = http("POST", "/api/auth/refresh", body={"refresh_token": refreshes["admin"]})
    check("C", "تدوير refresh token = 200 (القديم يُستهلك)", s == 200, f"s={s} {b[:100]}")
    s, b = http("POST", "/api/auth/refresh", body={"refresh_token": refreshes["admin"]})
    check("C", "إعادة استخدام التوكن القديم المدور = 401 (اكتشاف إعادة استخدام)", s == 401, f"s={s}")

    # ─── [D] صفر بقايا ───
    print("\n[D] صفر بقايا — تنظيف موسوم كامل + مطابقة اللقطة")
    if order_id:
        sql(f"DELETE FROM pos_pending_prints WHERE order_id = '{order_id}'")
        sql(f"DELETE FROM pos_zatca_invoice_queue WHERE order_id = '{order_id}'")
        sql(f"DELETE FROM revenues WHERE pos_order_id = '{order_id}'")
        sql(f"DELETE FROM pos_invoice_payments WHERE order_id = '{order_id}'")
        sql(f"DELETE FROM pos_order_items WHERE order_id = '{order_id}'")
        sql(f"DELETE FROM pos_orders WHERE id = '{order_id}'")
        sql(f"DELETE FROM pos_idempotency_keys WHERE key = '{idem_key}'")
    if session_id:
        http("POST", f"/api/pos/shifts/{session_id}/close", token=admin,
             body={"closing_balance": 500 + total, "note": f"{MARK} close"})
        sql(f"DELETE FROM pos_shift_sessions WHERE id = {int(session_id)}")
    if product_id:
        sql(f"DELETE FROM pos_products WHERE id = {int(product_id)}")
    sql(f"DELETE FROM inventory_ledger WHERE inventory_id = {int(item_id)}" if item_id else "SELECT 1")
    sql(f"DELETE FROM inventory_location_balances WHERE inventory_id = {int(item_id)}" if item_id else "SELECT 1")
    sql(f"DELETE FROM \"inventoryTx\" WHERE \"itemId\" = {int(item_id)}" if item_id else "SELECT 1")
    sql(f"DELETE FROM inventory WHERE id = {int(item_id)}" if item_id else "SELECT 1")
    sql(f"DELETE FROM \"purchaseInvoices\" WHERE id = {int(invoice_id)}" if invoice_id else "SELECT 1")
    sql(f"DELETE FROM pos_printers WHERE id IN ('{receipt_pid}','{kot_pid}','{kot2_pid}')")
    sql(f"DELETE FROM pos_refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE username IN ('admin','chef','keeper','head_salads')) AND issued_at > '{audit_start_iso}'")
    sql(f"DELETE FROM notifications WHERE title LIKE '%{MARK}%' OR message LIKE '%{MARK}%'")

    check("D", "صفر مهام طباعة متبقية للتدقيق",
          sql(f"SELECT count(*) FROM pos_pending_prints WHERE printer_id IN ('{receipt_pid}','{kot_pid}','{kot2_pid}')", single=True) == "0")
    check("D", "صفر طابعات مسجلة متبقية للتدقيق",
          sql(f"SELECT count(*) FROM pos_printers WHERE id IN ('{receipt_pid}','{kot_pid}','{kot2_pid}','{dead_pid}')", single=True) == "0")
    check("D", "صفر منتجات اختبار متبقية",
          sql(f"SELECT count(*) FROM pos_products WHERE name_ar LIKE '%{MARK}%'", single=True) == "0")

    after = snapshot()
    residue = {t: (baseline.get(t), after.get(t)) for t in SNAPSHOT_TABLES if baseline.get(t) != after.get(t)}
    check("D", "صفر بقايا — مطابقة لقطة 27 جدولاً قبل/بعد", not residue, f"فروق: {residue}")

    check("D", "العاملان الخلفيان ما زالا أحياء بعد التدقيق", pid_alive("cashier-module/print-worker.js") and pid_alive("cashier-module/zatca-worker.js"))
    stop_fake_printer()

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
