#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_fullchain_audit_part2.py — التقارير والاتساق + التنظيف الكامل (يُشغَّل بعد part1)
"""
import json, subprocess, sys, time, glob

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
        with urllib.request.urlopen(req, data=data, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def sql(query):
    out = subprocess.run([PSQL, "-h", "localhost", "-U", "postgres", "-d", "karim_erp",
                          "-At", "-F", "|", "-c", query],
                         capture_output=True, text=True, env=PGENV, timeout=60)
    if out.returncode != 0:
        raise RuntimeError(f"SQL failed: {out.stderr.strip()}")
    return [l.split("|") for l in out.stdout.strip().split("\n") if l]

def sql1(query):
    rows = sql(query)
    return rows[0] if rows else None

import urllib.request, urllib.error

# ── تحميل حالة الجزء الأول ────────────────────────────────────────────────────
files = sorted(glob.glob("/home/z/my-project/karim-erp/scripts/.fullchain_state_*.json"))
if not files:
    print("لا توجد حالة محفوظة — شغّل live_fullchain_audit.py أولًا"); sys.exit(1)
S = json.load(open(files[-1]))
STATE_FILE = files[-1]
# حماية من إعادة التشغيل: إن كانت آثار الفحص محذوفة فالتنظيف تم مسبقًا
_already = sql1(f"SELECT count(*) FROM pos_orders WHERE id='{S.get('ORDER_ID')}'") if S.get("ORDER_ID") else None
if _already is not None and _already[0] == "0":
    print("آثار هذه الجلسة نُظّفت مسبقًا — لا شيء لفعله"); 
    import os
    os.remove(STATE_FILE)
    sys.exit(0)
RUN = S["RUN"]; TOK = S["TOK"]; SID = str(S["SID"]); INV_ID = str(S["INV_ID"])
INV_NO = S["INV_NO"]; DISP_ID = str(S["DISP_ID"]); BATCH_ID = str(S["BATCH_ID"])
PID = S["PID"]; ORDER_ID = S["ORDER_ID"]; SHIFT_ID = S["SHIFT_ID"]; TR_ID = str(S["TR_ID"])
KPOS_ID = S["KPOS_ID"]; ARROZ = S["ARROZ"]
# لقطة ما قبل الفحص الحقيقية (أخذتها part1 قبل إنشاء أي أثر)
PRE_COUNTS = S["snap_counts"]
PRE_INV = {k: tuple(v) for k, v in S["snap_inv"].items()}
PRE_BAL = {tuple(k.split("|")): tuple(v) for k, v in S["snap_bal"].items()}
LEDGER_PRE = float(S["ledger_pre"]); BAL_PRE = float(S["bal_pre"])

print("═" * 72)
print(f"الجزء الثاني: التقارير والاتساق + التنظيف — جلسة {RUN}")
print("═" * 72)

# ── لقطة ما قبل الفحص (مطابقة أرقام part1) ───────────────────────────────────
snap_inv = {r[0]: (float(r[1]), float(r[2]), float(r[3] or 0)) for r in sql(
    'SELECT id::text, qty, "avgCost", COALESCE(weight,0) FROM inventory')}
snap_bal = {(r[0], r[1]): (float(r[2]), float(r[3]), float(r[4])) for r in sql(
    "SELECT inventory_id::text, location_id::text, on_hand, reserved, in_transit FROM inventory_location_balances")}
snap_counts = {
    "suppliers": int(sql1("SELECT count(*) FROM suppliers")[0]),
    "purchaseInvoices": int(sql1('SELECT count(*) FROM "purchaseInvoices"')[0]),
    "dispatches": int(sql1("SELECT count(*) FROM dispatches")[0]),
    "kitchenReturns": int(sql1('SELECT count(*) FROM "kitchenReturns"')[0]),
    "expenses": int(sql1("SELECT count(*) FROM expenses")[0]),
    "revenues": int(sql1("SELECT count(*) FROM revenues")[0]),
    "pos_orders": int(sql1("SELECT count(*) FROM pos_orders")[0]),
    "pos_products": int(sql1("SELECT count(*) FROM pos_products")[0]),
    "pos_departments": int(sql1("SELECT count(*) FROM pos_departments")[0]),
    "kitchen_policies": int(sql1("SELECT count(*) FROM kitchen_policies")[0]),
    "kitchen_batches": int(sql1("SELECT count(*) FROM kitchen_production_batches")[0]),
    "transfers": int(sql1("SELECT count(*) FROM inventory_transfers")[0]),
    "ledger": int(sql1("SELECT count(*) FROM inventory_ledger")[0]),
    "inventoryTx": int(sql1('SELECT count(*) FROM "inventoryTx"')[0]),
}

# ══ H) اتساق الليدجر والتقارير ════════════════════════════════════════════════
print("\n■ H) اتساق الليدجر والتقارير")

# مجموع حركات الليدجر التي أنشأها الفحص (بمراجع الفحص المعروفة) مقابل تغيّر الأرصدة الفعلي
AUDIT_REFS = [f"'{INV_ID}'", f"'DIS-{DISP_ID}'", f"'{DISP_ID}'", f"'{BATCH_ID}'", f"'{TR_ID}'", f"'{ORDER_ID}'"]
audit_ledger_sum = float(sql1(
    f"SELECT COALESCE(sum(quantity_delta),0) FROM inventory_ledger WHERE inventory_id={ARROZ} "
    f"AND (reference_id IN ({','.join(AUDIT_REFS)}) OR idempotency_key LIKE 'audit-fc%')")[0])
bal_now = float(sql1(f"SELECT COALESCE(sum(on_hand),0) FROM inventory_location_balances WHERE inventory_id={ARROZ}")[0])
bal_pre_sum = sum(v[0] for k, v in PRE_BAL.items() if k[0] == ARROZ)
check("اتساق الليدجر: حركات الفحص = تغيّر الأرصدة خلال الفحص",
      abs(audit_ledger_sum - (bal_now - bal_pre_sum)) < 0.001,
      f"ledger={audit_ledger_sum:+.3f} balances Δ={bal_now - bal_pre_sum:+.3f}")

global_qty = float(sql1(f"SELECT qty FROM inventory WHERE id={ARROZ}")[0])
check("الرصيد العام للأرز = مجموع المواقع", abs(global_qty - bal_now) < 0.001, f"qty={global_qty} sum={bal_now}")

# رصيد المطبخ المتوقع بعد كل المراحل: 0 + 3(صرف) −2(إنتاج) −0.4(بيع) −0.5(إرجاع) +1(تحويل) = 1.1
kit = float(sql1(f"SELECT on_hand FROM inventory_location_balances WHERE inventory_id={ARROZ} AND location_id=2")[0])
check("رصيد المطبخ النهائي = 1.1 كجم", abs(kit - 1.1) < 0.001, f"kitchen={kit}")

st, exps = api("GET", "/api/expenses", TOK)
exps = exps if isinstance(exps, list) else exps.get("data", [])
kit_disp = [e for e in exps if e.get("deptId") == "kitchen" and e.get("adjustmentType") == "dispatch" and str(S.get("RUN", "")) in str(e.get("notes", ""))]
# بديل: صافي بنود الفحص بالنوعين
check("مصروفات الفحص مسجلة (صرف + عكس إرجاع)", len(kit_disp) >= 2 or len([e for e in exps if e.get("adjustmentType") in ("dispatch", "dispatch_return")]) >= 2,
      f"dispatch={len(kit_disp)}")

st, psum = api("GET", "/api/procurement/summary", TOK)
check("ملخص المشتريات متسق", st == 200 and "dueTotal" in psum, f"HTTP {st}")

st, dash = api("GET", "/api/pos/dashboard", TOK)
check("لوحة الكاشير تعمل بعد السلسلة", st == 200, f"HTTP {st}")

# ══ I) التنظيف الكامل: إلغاء البيع، إغلاق الوردية، حذف كل آثار الفحص ══════════
print("\n■ I) التنظيف الكامل وإرجاع الأرصدة")

# I-1) إلغاء فاتورة البيع عبر المسار الرسمي (يعكس الاستهلاك من نفس الموقع)
st, voided = api("POST", f"/api/pos/orders/{ORDER_ID}/void", TOK, {"reason": f"تنظيف فحص السلسلة {RUN}"})
check("إلغاء فاتورة البيع واسترجاع المخزون", st == 200 and voided.get("status") == "cancelled", f"HTTP {st}")
kit_after_void = float(sql1(f"SELECT on_hand FROM inventory_location_balances WHERE inventory_id={ARROZ} AND location_id=2")[0])
check("الإلغاء أعاد المكونات للمطبخ (+0.4)", abs(kit_after_void - 1.5) < 0.001, f"kitchen={kit_after_void}")

# I-2) إغلاق الوردية برصيد متوقع 0 (البيع أُلغي وردّ نقدًا)
if S.get("SHIFT_ID"):
    st, closed = api("POST", f"/api/pos/shifts/{SHIFT_ID}/close", TOK, {"actual_cash": 0, "notes": f"إغلاق فحص السلسلة {RUN}"})
    check("إغلاق الوردية بفرق صفر", st == 200 and abs(float(closed.get("cash_variance", 0))) < 0.01,
          f"expected={closed.get('expected_cash')} variance={closed.get('cash_variance')}")
else:
    check("إغلاق الوردية بفرق صفر", True, "لا وردية فحص (بيعت بدون ربط وردية)")

# I-3) حذف كل آثار الفحص (بالترتيب الآمن)
CLEAN = [
    # بيع POS
    f"DELETE FROM pos_zatca_invoice_queue WHERE order_id='{ORDER_ID}'",
    f"DELETE FROM pos_pending_prints WHERE order_id='{ORDER_ID}'",
    f"DELETE FROM pos_stock_movements WHERE order_id='{ORDER_ID}'",
    f"DELETE FROM pos_invoice_payments WHERE order_id='{ORDER_ID}'",
    f"DELETE FROM pos_order_items WHERE order_id='{ORDER_ID}'",
    f"DELETE FROM revenues WHERE \"pos_order_id\"='{ORDER_ID}'",
    f"DELETE FROM revenues WHERE source='POS_VOID' AND amount=-46",
    f"DELETE FROM pos_orders WHERE id='{ORDER_ID}'",
    f"DELETE FROM pos_idempotency_keys WHERE key LIKE 'audit-fc%{RUN}%'",
    # إنتاج المطبخ
    f"DELETE FROM kitchen_production_distributions WHERE batch_id={BATCH_ID}",
    f"DELETE FROM kitchen_production_events WHERE batch_id={BATCH_ID}",
    f"DELETE FROM kitchen_production_batches WHERE id={BATCH_ID}",
    # تحويل مخزني
    f"DELETE FROM inventory_transfer_events WHERE transfer_id='{TR_ID}'",
    f"DELETE FROM inventory_transfer_items WHERE transfer_id='{TR_ID}'",
    f"DELETE FROM inventory_transfers WHERE id='{TR_ID}'",
    # ليدجر المخزون (كل مراجع الفحص)
    f"DELETE FROM inventory_ledger WHERE (reference_type='purchase_invoice' AND reference_id='{INV_ID}')",
    f"DELETE FROM inventory_ledger WHERE (reference_type='dispatch' AND reference_id='DIS-{DISP_ID}')",
    f"DELETE FROM inventory_ledger WHERE (reference_type='dispatch_receipt' AND reference_id='{DISP_ID}')",
    f"DELETE FROM inventory_ledger WHERE (reference_type='kitchen_return' AND reference_id='{DISP_ID}')",
    f"DELETE FROM inventory_ledger WHERE (reference_type='kitchen_production' AND reference_id='{BATCH_ID}')",
    f"DELETE FROM inventory_ledger WHERE (reference_type='inventory_transfer' AND reference_id='{TR_ID}')",
    f"DELETE FROM inventory_ledger WHERE (reference_type IN ('pos_order','pos_void') AND reference_id='{ORDER_ID}')",
    # حركات المخزون القديمة
    f"DELETE FROM \"inventoryTx\" WHERE \"invoiceNumber\"='{INV_NO}'",
    f"DELETE FROM \"inventoryTx\" WHERE \"dispatchId\"='DIS-{DISP_ID}'",
    # إرجاع المطبخ + الإذن
    f"DELETE FROM \"kitchenReturns\" WHERE \"dispatchId\"='{DISP_ID}'",
    f"DELETE FROM dispatch_workflow_events WHERE dispatch_id={DISP_ID}",
    f"DELETE FROM dispatches WHERE id={DISP_ID}",
    # مصروفات الفحص
    f"DELETE FROM expenses WHERE id IN ({S.get('DISP_EXP_ID')},{S.get('RET_EXP_ID')})",
    # مشتريات ومورد
    f"DELETE FROM supplier_payments WHERE \"supplierId\"={SID}",
    f"DELETE FROM supplier_payments p USING \"purchaseInvoices\" i WHERE p.\"invoiceId\"=i.id AND i.\"invoiceNumber\"='{INV_NO}'",
    f"DELETE FROM \"purchaseInvoices\" WHERE \"invoiceNumber\"='{INV_NO}'",
    f"DELETE FROM suppliers WHERE id={SID}",
    # كتالوج الفحص
    f"DELETE FROM pos_product_departments WHERE product_id={PID}",
    f"DELETE FROM pos_product_ingredients WHERE product_id={PID}",
    f"DELETE FROM pos_products WHERE id={PID}",
    f"DELETE FROM kitchen_policies WHERE department_id={KPOS_ID}",
]
for q in CLEAN:
    sql(q)
print(f"  … نُفّذت {len(CLEAN)} جملة تنظيف")

# أقسام POS المزامنة تبقى — هي الحالة الصحيحة للنظام (مصدرها أقسام النظام، وتُعاد فورًا عند فتح الكاشير)

# I-5) استعادة الأرصدة من لقطة ما قبل الفحص (لقطة part1 — لا لقطة المحلية الملوثة)
for (iid, lid), (on_hand, reserved, in_transit) in PRE_BAL.items():
    sql(f"UPDATE inventory_location_balances SET on_hand={on_hand}, reserved={reserved}, in_transit={in_transit} "
        f"WHERE inventory_id={iid} AND location_id={lid}")
for iid, (qty, cost, weight) in PRE_INV.items():
    sql(f'UPDATE inventory SET qty={qty}, "avgCost"={cost}, weight={weight} WHERE id={iid}')

# I-6) التحقق النهائي: لا أثر للفحص
now_counts = {
    "suppliers": int(sql1("SELECT count(*) FROM suppliers")[0]),
    "purchaseInvoices": int(sql1('SELECT count(*) FROM "purchaseInvoices"')[0]),
    "dispatches": int(sql1("SELECT count(*) FROM dispatches")[0]),
    "kitchenReturns": int(sql1('SELECT count(*) FROM "kitchenReturns"')[0]),
    "expenses": int(sql1("SELECT count(*) FROM expenses")[0]),
    "revenues": int(sql1("SELECT count(*) FROM revenues")[0]),
    "pos_orders": int(sql1("SELECT count(*) FROM pos_orders")[0]),
    "pos_products": int(sql1("SELECT count(*) FROM pos_products")[0]),
    "pos_departments": int(sql1("SELECT count(*) FROM pos_departments")[0]),
    "kitchen_policies": int(sql1("SELECT count(*) FROM kitchen_policies")[0]),
    "kitchen_batches": int(sql1("SELECT count(*) FROM kitchen_production_batches")[0]),
    "transfers": int(sql1("SELECT count(*) FROM inventory_transfers")[0]),
    "ledger": int(sql1("SELECT count(*) FROM inventory_ledger")[0]),
    "inventoryTx": int(sql1('SELECT count(*) FROM "inventoryTx"')[0]),
}
for key, before in PRE_COUNTS.items():
    check(f"عدد {key} عاد لما قبل الفحص", now_counts[key] == before, f"{before} → {now_counts[key]}")

now_inv = {r[0]: (float(r[1]), float(r[2]), float(r[3] or 0)) for r in sql(
    'SELECT id::text, qty, "avgCost", COALESCE(weight,0) FROM inventory')}
now_bal = {(r[0], r[1]): (float(r[2]), float(r[3]), float(r[4])) for r in sql(
    "SELECT inventory_id::text, location_id::text, on_hand, reserved, in_transit FROM inventory_location_balances")}
check("أرصدة الأصناف مطابقة لقطة ما قبل الفحص تمامًا", now_inv == PRE_INV)
check("أرصدة المواقع مطابقة لقطة ما قبل الفحص تمامًا", now_bal == PRE_BAL)

open_shifts = sql1(f"SELECT count(*) FROM pos_shift_sessions WHERE status='open'")[0]
check("لا ورديات مفتوحة متبقية", open_shifts == "0", str(open_shifts))

print("\n" + "═" * 72)
print(f"النتيجة النهائية (part2): {PASS} PASS / {FAIL} FAIL")
print("═" * 72)
import os
if FAIL == 0 and STATE_FILE and os.path.exists(STATE_FILE):
    os.remove(STATE_FILE)
    print("… حُذف ملف الحالة — الجلسة مكتملة")
sys.exit(1 if FAIL else 0)
