#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""probe_idempotency.py — مجس تشخيصي: بيع ثم إعادة بنفس المفتاح (يجب 200 replay بنفس الفاتورة)"""
import sys, time, json
sys.path.insert(0, 'scripts')
import os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from load_test import Client, req, login

tok = login("admin", "Karim2026Demo")
s, depts, _ = req("GET", "/api/pos/departments", tok)
KPOS = int(next(d for d in depts if d.get("code") == "erp_kitchen")["id"])

# وردية ومنتج لحظيان للمجس
s, prod, _ = req("POST", "/api/pos/products", tok, {
    "name_ar": "صنف مجس تشخيصي", "price": 10, "vat_rate": 15, "cost_price": 1.0,
    "unit": "وحدة", "category": "مجس", "department_ids": [KPOS]})
PID = int(prod["id"])
s, shift, _ = req("POST", "/api/pos/shifts/open", tok, {"department_id": KPOS, "opening_balance": 0})
SHIFT = int(shift.get("session_id", 0))
print(f"product={PID} shift={SHIFT}")

sale = {"department_id": KPOS, "items": [{"product_id": PID, "quantity": 1, "unit_price": 10, "discount": 0}],
        "payments": [{"method": "cash", "amount": 11.5}], "notes": "probe-replay"}
c = Client(tok)
try:
    h = {"Idempotency-Key": "probe-replay-key-1", "X-Shift-Session-Id": str(SHIFT)}
    s1, r1, dt1 = c.req("POST", "/api/sales/complete", sale, headers=h)
    print(f"original: status={s1} order={r1.get('order_id')} replay={r1.get('_idempotent_replay')} {dt1:.0f}ms")
    time.sleep(0.5)
    s2, r2, dt2 = c.req("POST", "/api/sales/complete", sale, headers=h)
    print(f"replay:   status={s2} order={r2.get('order_id')} replay={r2.get('_idempotent_replay')} {dt2:.0f}ms")
    print("same order:", r1.get("order_id") == r2.get("order_id"))
    print("VERDICT:", "PASS — آلية التكرار تعمل" if s2 in (200, 201) and r1.get("order_id") == r2.get("order_id") else "FAIL")
finally:
    c.close()

# تنظيف المجس
import subprocess
def psql(q):
    env = dict(__import__("os").environ)
    for line in open(".env"):
        if line.startswith("DB_PASSWORD="):
            env["PGPASSWORD"] = line.split("=", 1)[1].strip()
    r = subprocess.run(["database/bin/bin/psql", "-h", "localhost", "-U", "postgres", "-d", "karim_erp", "-t", "-A"],
                       input=q, capture_output=True, text=True, env=env, timeout=30)
    return r.stdout.strip()
oid = psql("SELECT id::text FROM pos_orders WHERE CAST(notes AS TEXT)='probe-replay'")
if oid:
    for t in ["pos_pending_prints", "pos_zatca_invoice_queue", "pos_invoice_payments", "pos_order_items", "erp_revenues"]:
        try: psql(f"DELETE FROM {t} WHERE order_id='{oid}';")
        except Exception: pass
    psql(f"DELETE FROM pos_orders WHERE id='{oid}';")
psql("DELETE FROM pos_idempotency_keys WHERE key='probe-replay-key-1';")
net = psql(f"SELECT COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='in' THEN ip.amount END),0)-COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='out' THEN ip.amount END),0) FROM pos_invoice_payments ip JOIN pos_orders o ON o.id=ip.order_id WHERE o.session_id={SHIFT}")
req("POST", f"/api/pos/shifts/{SHIFT}/close", tok, {"actual_cash": float(net or 0), "notes": "إغلاق مجس تشخيصي"})
psql(f"DELETE FROM pos_shift_sessions WHERE id={SHIFT};")
psql(f"DELETE FROM pos_products WHERE id={PID};")
try: psql(f"DELETE FROM pos_audit_logs WHERE table_name IN ('pos_shift_sessions','pos_products') AND row_pk IN ('{SHIFT}','{PID}','{str(SHIFT)}','{str(PID)}');")
except Exception: pass
print("cleanup done")
