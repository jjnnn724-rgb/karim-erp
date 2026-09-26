#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_invoice_sync_audit.py — التدقيق الحي لمزامنة فاتورة الشراء بلا تحديث يدوي (Task 25)
───────────────────────────────────────────────────────────────────────────────────────────
يُثبت أن استجابة إنشاء فاتورة الشراء تحمل كميات المخزن المُحدَّثة فعلاً
(بعد ترحيل دفتر الاستلام) — كانت قديمة فتُجبر الواجهة على تحديث يدوي.
"""
import json, os, subprocess, sys, time

BASE = "http://localhost:5000"
CWD = "/home/z/my-project/karim-erp"
RUN = f"inv{int(time.time())}"
ENV = os.path.join(CWD, ".env")
PSQL_BIN = os.path.join(CWD, "database/bin/bin/psql")

def pw():
    for line in open(ENV):
        if line.startswith("DB_PASSWORD="):
            return line.split("=", 1)[1].strip()
    return ""

PW = pw()
results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), str(detail)[:200]))
    print(("✅" if ok else "❌"), name, "" if ok else f"— {str(detail)[:200]}")

def psql(sql, db="karim_erp"):
    r = subprocess.run([PSQL_BIN, "-h", "localhost", "-U", "postgres", "-d", db, "-t", "-A", "-c", sql],
                       capture_output=True, text=True, env={**os.environ, "PGPASSWORD": PW}, cwd=CWD)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip().splitlines()[-1] if r.stderr else "psql failed")
    return r.stdout.strip().splitlines()[0].strip() if r.stdout.strip() else ""

import urllib.request, urllib.error
def req(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if body is not None: r.add_header("Content-Type", "application/json")
    if token: r.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read()
            try: j = json.loads(raw)
            except Exception: j = None
            return resp.status, j
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: j = json.loads(raw)
        except Exception: j = None
        return e.code, j
    except Exception as e:
        return 0, {"err": str(e)}

def tbl(t):
    return '"inventoryTx"' if t == 'inventoryTx' else ('"purchaseInvoices"' if t == 'purchaseInvoices' else t)

SNAP = ["pos_orders", "pos_order_items", "pos_shift_sessions", "inventory_ledger", "inventoryTx",
        "purchaseInvoices", "inventory", "expenses", "users", "pos_products"]
baseline = {t: psql(f"SELECT COUNT(*) FROM {tbl(t)}") for t in SNAP}
check("A1 لقطة أساس", all(v.isdigit() for v in baseline.values()), str(baseline)[:100])

s, login = req("POST", "/api/auth/login", body={"username": "admin", "password": "Karim2026Demo"})
TOK = login.get("access_token")
check("A2 دخول المدير", s == 200 and TOK, f"HTTP {s}")

ITEM = f"خامة مزامنة الفاتورة {RUN}"
INV_NO_1 = f"SYN1-{RUN}"
INV_NO_2 = f"SYN2-{RUN}"

# ═══ ب1: فاتورة جديدة بصنف جديد — الاستجابة تحمل الكمية بعد الاستلام (7 لا 0) ═══
s, r1 = req("POST", "/api/warehouse/purchase-invoices", TOK, {
    "invoiceNumber": INV_NO_1, "date": "2026-09-02", "supplierName": f"مورد {RUN}",
    "paymentMethod": "cash",
    "items": [{"itemName": ITEM, "qty": 7, "unit": "كجم", "price": 5.0}],
})
check("B1 فاتورة أولى (صنف جديد 7 وحدات) أنشئت", s == 201 and r1.get("invoice"), f"HTTP {s} {json.dumps(r1)[:120]}")
inv_rows = r1.get("inventory") or []
row1 = next((x for x in inv_rows if x.get("name") == ITEM), None)
check("B2 الاستجابة تحمل صف الصنف", row1 is not None, json.dumps(inv_rows)[:120])
check("B3 الكمية في الاستجابة = 7 (بعد الاستلام — لا صفر قديم)",
      row1 is not None and float(row1["qty"]) == 7.0, f"qty={row1 and row1['qty']}")
db_qty = psql(f"SELECT qty FROM inventory WHERE name='{ITEM}'")
check("B4 قاعدة البيانات = 7 مطابقة للاستجابة", float(db_qty) == 7.0, f"db={db_qty}")
check("B5 حركة المخزون في الاستجابة مسجلة", len(r1.get("transactions") or []) == 1)

# ═══ ب2: فاتورة ثانية لنفس الصنف — الاستجابة تحمل 10 لا 7 (هنا كان الخلل القديم) ═══
time.sleep(0.3)
s, r2 = req("POST", "/api/warehouse/purchase-invoices", TOK, {
    "invoiceNumber": INV_NO_2, "date": "2026-09-02", "supplierName": f"مورد {RUN}",
    "paymentMethod": "cash",
    "items": [{"itemName": ITEM, "qty": 3, "unit": "كجم", "price": 6.0}],
})
check("C1 فاتورة ثانية (3 وحدات لنفس الصنف) أنشئت", s == 201, f"HTTP {s}")
row2 = next((x for x in (r2.get("inventory") or []) if x.get("name") == ITEM), None)
check("C2 كمية الاستجابة = 10 (7+3) — القديم كان يرجع 7 ويجبر على ريفرش",
      row2 is not None and float(row2["qty"]) == 10.0, f"qty={row2 and row2['qty']}")
db_qty2 = psql(f"SELECT qty FROM inventory WHERE name='{ITEM}'")
check("C3 قاعدة البيانات = 10 مطابقة", float(db_qty2) == 10.0, f"db={db_qty2}")
avg = float(row2["avgCost"]) if row2 else 0
check("C4 متوسط التكلفة محسوب صحيحًا ((7×5)+(3×6))/10 = 5.3", abs(avg - 5.3) < 0.001, f"avgCost={avg}")

# ═══ ج: الفاتورتان في قائمة الفواتير (ما تعرضه الواجهة) ═══
count = psql(f"SELECT COUNT(*) FROM \"purchaseInvoices\" WHERE \"invoiceNumber\" IN ('{INV_NO_1}','{INV_NO_2}')")
check("D1 الفاتورتان في قاعدة البيانات (القائمة تعرضهما)", count == "2", f"count={count}")
ledger = psql(f"SELECT COUNT(*) FROM inventory_ledger WHERE reference_type='purchase_invoice' AND idempotency_key LIKE 'purchase:%'")
check("D2 حركتا استلام في الدفتر بمفاتيح التقاط", int(ledger) >= 2, f"ledger={ledger}")

# ═══ هـ: التنظيف الكامل ومطابقة اللقطة ═══
psql(f"DELETE FROM inventory_ledger WHERE reference_type='purchase_invoice' AND reference_id IN (SELECT id::text FROM \"purchaseInvoices\" WHERE \"invoiceNumber\" IN ('{INV_NO_1}','{INV_NO_2}'))")
psql(f"DELETE FROM \"inventoryTx\" WHERE \"invoiceNumber\" IN ('{INV_NO_1}','{INV_NO_2}')")
psql(f"DELETE FROM \"purchaseInvoices\" WHERE \"invoiceNumber\" IN ('{INV_NO_1}','{INV_NO_2}')")
psql(f"DELETE FROM inventory_location_balances WHERE inventory_id IN (SELECT id FROM inventory WHERE name='{ITEM}')")
psql(f"DELETE FROM inventory WHERE name='{ITEM}'")
check("E1 بقايا الفحص حُذفت (فواتير/حركات/صنف)",
      psql(f"SELECT COUNT(*) FROM \"purchaseInvoices\" WHERE \"invoiceNumber\" LIKE '%{RUN}%'") == "0"
      and psql(f"SELECT COUNT(*) FROM inventory WHERE name LIKE '%{RUN}%'") == "0")
after = {t: psql(f"SELECT COUNT(*) FROM {tbl(t)}") for t in SNAP}
drift = {t: (baseline[t], after[t]) for t in SNAP if baseline[t] != after[t]}
check("E2 مطابقة اللقطة: صفر بقايا", not drift, str(drift)[:140])

passed = sum(1 for _, ok, _ in results if ok)
failed = len(results) - passed
print(f"\n{'═' * 60}")
print(f"═══ نتيجة تدقيق مزامنة الفاتورة: {passed} ناجح / {failed} فاشل ═══")
print(f"{'═' * 60}")
sys.exit(0 if failed == 0 else 1)
