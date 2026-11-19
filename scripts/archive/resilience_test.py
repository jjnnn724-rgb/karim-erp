#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
resilience_test.py — عدّاء الصمود الحقيقي لنظام حورس ERP (Task 24)
════════════════════════════════════════════════════════════════════
بعد أن أثبت load_test.py (Task 23) الأداء تحت الحمل، يثبت هذا السيناريو
الصمود: النظام يظل صحيحًا ويستعيد نفسه تحت أسوأ ما قد يحدث في المطعم:

  A) تنظيف مسبق + لقطة أساس (بيانات + ذاكرة الخادم + اتصالات القاعدة)
  B) اختحام 180 ثانية: 4 محطات قراءة + محطة بيع مستمرة — ثبات زمن
     الاستجابة + حرس تسريب الذاكرة + ذرية العدّ في القاعدة
  C) انقطاع رقيق تحت الحمل: SIGTERM أثناء بيع حي → الحارس يعيد
     التشغيل تلقائيًا → إعادة إرسال كل مفاتيح التكرار → فاتورة واحدة
     لكل مفتاح بالضبط (لا خسارة ولا ازدواج — قصة «هل دُفع مرتين؟»)
  D) انقطاع عنيف: kill -9 أثناء بيع حي → نفس الضمانات + كل فاتورة
     مكتملة الأبناء (ذرية WAL)
  E) حرب النسخ الاحتياطي: نسخة كاملة → تحقق SHA-256 → استرجاع في قاعدة
     تدريب معزولة → مقارنة عدّ الجداول → إسقاط — القاعدة الحية لم تُمس
  F) طابور ZATCA: صفوف processing عالقة من انهيار سابق تُستعاد حتى مع
     التفعيل موقوفًا + العامل يتراجع تلقائيًا لوضع SQL دون Redis
  G) تنظيف شامل + مطابقة اللقطة حرفيًا (صفر بقايا)

الاستخدام: python3 scripts/resilience_test.py [--soak-seconds 180]
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import threading
import time

# العدّاء يجب أن يُشغَّل من جذر المشروع (مسارات psql و.env نسبية)
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from load_test import Client, req, login, psql, psql_rows, pct, stats_line  # noqa: E402

BASE = "http://localhost:5000"
RUN = str(int(time.time()))
TAG = f"صمود{RUN}"
KEY_PREFIX = f"resil-{RUN}"
DRILL_DB = "karim_erp_drill"

RESULTS = []
def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok)))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))

def health():
    s, r, _ = req("GET", "/api/health")
    return (s, r)

def wait_health(timeout_s=90):
    """ينتظر عودة الخادم بعد إعادة تشغيل الحارس. يرجع زمن العطلة بالثواني أو -1."""
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        s, r = health()
        if s == 200 and r.get("status") == "ok":
            return time.time() - t0
        time.sleep(1.0)
    return -1

def server_pid():
    """PID ابن الخادم المملوك للحارس الحي (وليس أي عملية يتيمة)."""
    wpid = None
    try:
        with open("logs/watchdog.pid") as f:
            wpid = int(f.read().strip())
    except Exception:
        pass
    if wpid:
        r = subprocess.run(["ps", "--ppid", str(wpid), "-o", "pid,cmd", "--no-headers"],
                           capture_output=True, text=True)
        for line in r.stdout.splitlines():
            if "backend/server.js" in line:
                return int(line.split()[0])
    r = subprocess.run(["pgrep", "-f", "backend/server.js"], capture_output=True, text=True)
    pids = [int(x) for x in r.stdout.split()]
    return pids[0] if pids else None

def mem_snapshot():
    s, r = health()
    m = r.get("checks", {}).get("memory", {})
    def to_mb(v):
        try:
            return float(str(v).replace("MB", "").strip())
        except Exception:
            return 0.0
    return {"rss": to_mb(m.get("rss")), "heap": to_mb(m.get("heapUsed")),
            "ok": s == 200 and r.get("status") == "ok"}

def db_conn_count():
    return int(psql("SELECT COUNT(*) FROM pg_stat_activity WHERE datname='karim_erp'") or 0)

# ═════════════════════════ عوامل الحمل ═════════════════════════
def read_worker(token, seconds, mix, bucket, stop):
    c = Client(token)
    try:
        i = 0
        deadline = time.time() + seconds
        while time.time() < deadline and not stop.is_set():
            path = mix[i % len(mix)]
            s, r, dt = c.req("GET", path)
            minute = int((seconds - max(0, deadline - time.time())) // 60)
            with bucket["lock"]:
                bucket["lat"].append((minute, dt))
                bucket["status"].append(s)
            i += 1
            time.sleep(0.75)
    finally:
        c.close()

def sale_stream(token, dept_id, pid, shift_id, tag, key_prefix, cadence, out, stop_at=None, keep_going=None):
    """حلقة بيع متسلسلة بمفاتيح فريدة. تسجل كل نتيجة (حتى الفشل) للإعادة لاحقًا."""
    c = Client(token)
    k = 0
    try:
        while True:
            if stop_at is not None and time.time() >= stop_at:
                break
            if keep_going is not None and not keep_going.is_set() and k > 0:
                break
            key = f"{key_prefix}-{k}"
            sale = {"department_id": dept_id,
                    "items": [{"product_id": pid, "quantity": 1, "unit_price": 10, "discount": 0}],
                    "payments": [{"method": "cash", "amount": 11.5}],
                    "notes": tag}
            s, r, dt = c.req("POST", "/api/sales/complete", sale,
                             headers={"Idempotency-Key": key, "X-Shift-Session-Id": str(shift_id)})
            out.append({"key": key, "sale": sale, "status": s, "order_id": str(r.get("order_id") or "") if isinstance(r, dict) else ""})
            k += 1
            time.sleep(cadence)
    finally:
        c.close()

def replay_keys(token, shift_id, records):
    """إعادة إرسال كل المفاتيح بعد الاستعادة — المرجع النهائي للعدّ.
    ملاحظة مهمة: الإعادة ترجع 201 أيضًا (الحالة المخزنة) مع راية _idempotent_replay
    لذلك التمييز بين جديدة/معادة يكون بالراية لا برمز الحالة."""
    c = Client(token)
    replayed = []
    try:
        for rec in records:
            s, r, dt = c.req("POST", "/api/sales/complete", rec["sale"],
                             headers={"Idempotency-Key": rec["key"], "X-Shift-Session-Id": str(shift_id)})
            oid = str(r.get("order_id") or "") if isinstance(r, dict) else ""
            is_replay = bool(r.get("_idempotent_replay")) if isinstance(r, dict) else False
            replayed.append({"key": rec["key"], "status": s, "order_id": oid, "replay": is_replay})
            time.sleep(0.12)
    finally:
        c.close()
    return replayed

def replay_summary(replayed):
    fresh = sum(1 for x in replayed if not x["replay"])
    cached = sum(1 for x in replayed if x["replay"])
    codes = {c: sum(1 for x in replayed if x["status"] == c) for c in set(x["status"] for x in replayed)}
    return f"codes={codes} (مخزّنة={cached} جديدة={fresh})"

def robust_sale(token, dept_id, pid, shift_id, tag, key, attempts=3):
    """بيع بمحاولات إعادة (قصة الكاشير: أول اتصال قد يقع — المهم الالتزام الذري)."""
    sale = {"department_id": dept_id,
            "items": [{"product_id": pid, "quantity": 1, "unit_price": 10, "discount": 0}],
            "payments": [{"method": "cash", "amount": 11.5}], "notes": tag}
    c = Client(token)
    try:
        for i in range(attempts):
            s, r, dt = c.req("POST", "/api/sales/complete", sale,
                             headers={"Idempotency-Key": key, "X-Shift-Session-Id": str(shift_id)})
            if s in (200, 201):
                return s, r
            time.sleep(1.0)
        return s, r
    finally:
        c.close()

def order_integrity(tag):
    """كل فاتورة بالوسم مكتملة: بنود + مدفوعات + uuid."""
    bad = psql(f"""
        SELECT COUNT(*) FROM pos_orders o
         WHERE CAST(o.notes AS TEXT)='{tag}'
           AND (o.invoice_uuid IS NULL
                OR NOT EXISTS (SELECT 1 FROM pos_order_items i WHERE i.order_id=o.id)
                OR NOT EXISTS (SELECT 1 FROM pos_invoice_payments p WHERE p.order_id=o.id))""")
    return int(bad or 0)

def count_orders(tag):
    return int(psql(f"SELECT COUNT(*) FROM pos_orders WHERE CAST(notes AS TEXT)='{tag}'") or 0)

def delete_orders(tag):
    ids = psql(f"SELECT COALESCE(STRING_AGG(quote_literal(id::text), ','), 'NULL') FROM pos_orders WHERE CAST(notes AS TEXT)='{tag}'")
    if ids != "NULL":
        for tbl in ["pos_pending_prints", "pos_zatca_invoice_queue", "pos_invoice_payments",
                    "pos_order_items", "erp_revenues"]:
            try:
                psql(f"DELETE FROM {tbl} WHERE order_id IN ({ids});")
            except Exception:
                pass
        psql(f"DELETE FROM pos_orders WHERE id IN ({ids});")

def take_snapshot():
    return {
        "shifts_max": psql("SELECT COALESCE(MAX(id),0) FROM pos_shift_sessions"),
        "products_max": psql("SELECT COALESCE(MAX(id),0) FROM pos_products"),
        "queue_sum": psql("SELECT COALESCE(SUM(id),0) FROM pos_zatca_invoice_queue"),
        "revenues_max": psql("SELECT COALESCE(MAX(id),0) FROM erp_revenues"),
        "idem_count": psql("SELECT COUNT(*) FROM pos_idempotency_keys WHERE key LIKE 'resil-%'"),
    }

# ═════════════════════════ السيناريو الرئيسي ═════════════════════════
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--soak-seconds", type=int, default=180)
    args = ap.parse_args()

    print("═" * 70)
    print("  حورس ERP — عدّاء الصمود الحقيقي (اختحام + انقطاع + استعادة + نسخ)")
    print("═" * 70)

    # ═══ A) تنظيف مسبق + لقطة أساس ═══
    print("\n■ A) التنظيف المسبق واللقطة الأساس")
    open_shifts = psql_rows("SELECT s.id FROM pos_shift_sessions s WHERE s.status='open' "
                            "AND NOT EXISTS (SELECT 1 FROM pos_orders o WHERE o.session_id=s.id AND CAST(o.notes AS TEXT) !~ '^صمود[0-9]+$')")
    for (sid,) in open_shifts:
        psql(f"UPDATE pos_shift_sessions SET status='closed', closed_at=COALESCE(closed_at,CURRENT_TIMESTAMP), "
             f"actual_cash=0, notes='إغلاق وردية عالقة قبل فحص الصمود {RUN}' WHERE id={sid};")
    for tag in [t for t in psql("SELECT DISTINCT CAST(notes AS TEXT) FROM pos_orders WHERE CAST(notes AS TEXT) ~ '^صمود[0-9]+$'").splitlines() if t]:
        delete_orders(tag)
    psql("DELETE FROM pos_idempotency_keys WHERE key LIKE 'resil-%';")
    psql("DELETE FROM pos_shift_sessions WHERE notes ~ 'إغلاق فحص الصمود|إغلاق وردية عالقة قبل فحص الصمود' AND status='closed';")
    psql("DELETE FROM pos_products WHERE name_ar ~ 'صنف صمود [0-9]+';")
    snap = take_snapshot()
    mem0 = mem_snapshot()
    conns0 = db_conn_count()
    check("A1 اللقطة الأساس ملتقطة (بيانات+ذاكرة+اتصالات)",
          all(v is not None for v in snap.values()) and mem0["ok"],
          f"mem rss={mem0['rss']:.0f}MB heap={mem0['heap']:.0f}MB conns={conns0}")

    # ═══ B) اختحام 180 ثانية ═══
    print(f"\n■ B) اختحام مستمر ({args.soak_seconds}s): 4 محطات قراءة + محطة بيع")
    tokens = {}
    for u in ["admin", "chef", "keeper", "head_salads", "head_sweets"]:
        try:
            tokens[u] = login(u, "Karim2026Demo")
        except AssertionError as e:
            print(f"  (تنبيه) {e}")
    check("B0 الدخول المتعدد جاهز", len(tokens) >= 4, f"حسابات={list(tokens)}")

    s, depts, _ = req("GET", "/api/pos/departments", tokens["admin"])
    kitchen = next((d for d in depts if d.get("code") == "erp_kitchen"), None)
    KPOS = int(kitchen["id"]) if kitchen else int(depts[0]["id"])
    s, prod, _ = req("POST", "/api/pos/products", tokens["admin"], {
        "name_ar": f"صنف صمود {RUN}", "price": 10, "vat_rate": 15, "cost_price": 1.0,
        "unit": "وحدة", "category": "فحص صمود", "department_ids": [KPOS]})
    PID = int(prod.get("id", 0)) if s in (200, 201) else 0
    check("B0.1 منتج الفحص جاهز", s in (200, 201) and PID > 0, f"HTTP {s} id={PID}")

    s, shift, _ = req("POST", "/api/pos/shifts/open", tokens["admin"], {"department_id": KPOS, "opening_balance": 0})
    if s == 409:
        stale = psql_rows("SELECT id FROM pos_shift_sessions WHERE status='open' ORDER BY id LIMIT 1")
        if stale:
            net = float(psql_rows(
                f"SELECT COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='in' THEN ip.amount END),0)"
                f"-COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='out' THEN ip.amount END),0) "
                f"FROM pos_invoice_payments ip JOIN pos_orders o ON o.id=ip.order_id WHERE o.session_id={stale[0][0]}")[0][0] or 0)
            req("POST", f"/api/pos/shifts/{stale[0][0]}/close", tokens["admin"], {"actual_cash": net, "notes": f"إغلاق وردية عالقة قبل فحص الصمود {RUN}"})
        s, shift, _ = req("POST", "/api/pos/shifts/open", tokens["admin"], {"department_id": KPOS, "opening_balance": 0})
    SHIFT = int(shift.get("session_id", 0)) if s in (200, 201) else 0
    check("B0.2 وردية الكاشير مفتوحة", s in (200, 201) and SHIFT > 0, f"HTTP {s} shift={SHIFT}")

    READ_MIX = ["/api/health", "/api/orders", "/api/pos/departments", "/api/notifications", "/api/inventory"]
    rb = {"lock": threading.Lock(), "lat": [], "status": []}
    stop = threading.Event()
    threads = [threading.Thread(target=read_worker, args=(tokens[u], args.soak_seconds, READ_MIX, rb, stop), daemon=True)
               for u in list(tokens)[:4]]
    soak_out = []
    soak_deadline = time.time() + args.soak_seconds
    sthread = threading.Thread(target=sale_stream, args=(tokens["admin"], KPOS, PID, SHIFT, TAG, f"{KEY_PREFIX}-soak", 1.2, soak_out, soak_deadline), daemon=True)
    t0 = time.perf_counter()
    for th in threads:
        th.start()
    sthread.start()
    for th in threads:
        th.join()
    sthread.join()
    wall = time.perf_counter() - t0

    r_status = rb["status"]
    r_err = sum(1 for x in r_status if x >= 500 or x == 0)
    r_429 = sum(1 for x in r_status if x == 429)
    check("B1 الاختحام: صفر أخطاء قراءة 5xx/انقطاع", r_err == 0, f"errors={r_err} n={len(r_status)}")
    check("B2 الاختحام: لا اختناق 429 للحمل المشروع", r_429 == 0, f"429={r_429}")

    s_ok = [x for x in soak_out if x["status"] in (200, 201)]
    s_err = [x for x in soak_out if x["status"] >= 500 or x["status"] == 0]
    check("B3 الاختحام: كل عمليات البيع نجحت دون 5xx", len(s_err) == 0 and len(s_ok) >= 3,
          f"بيع ناجح={len(s_ok)} فاشل={len(s_err)}")
    db_soak = count_orders(TAG)
    check("B4 القاعدة سجلت بيع الاختحام بالعدد بالضبط (ذرية 3 دقائق)", db_soak == len(s_ok),
          f"db={db_soak} api={len(s_ok)}")

    by_min = {}
    for minute, dt in rb["lat"]:
        by_min.setdefault(minute, []).append(dt)
    minutes = sorted(by_min)
    if len(minutes) >= 2:
        p95_first = pct(sorted(by_min[minutes[0]]), 95)
        p95_last = pct(sorted(by_min[minutes[-1]]), 95)
        check("B5 ثبات الأداء: p95 آخر دقيقة ≤ 2× الأولى (+50ms سماح)",
              p95_last <= 2 * p95_first + 50,
              f"أول={p95_first:.0f}ms آخر={p95_last:.0f}ms")
    else:
        check("B5 ثبات الأداء (دقائق كافية)", False, f"minutes={minutes}")

    mem1 = mem_snapshot()
    check("B6 حرس تسريب الذاكرة: heap ≤ +40MB وrss ≤ +120MB بعد الاختحام",
          0 < mem1["heap"] <= mem0["heap"] + 40 and 0 < mem1["rss"] <= mem0["rss"] + 120,
          f"heap {mem0['heap']:.0f}→{mem1['heap']:.0f}MB | rss {mem0['rss']:.0f}→{mem1['rss']:.0f}MB")
    conns1 = db_conn_count()
    check("B7 اتصالات القاعدة مستقرة تحت الحمل (≤30)", conns1 <= 30,
          f"{conns0}→{conns1} (pool max=25)")
    s, r = health()
    check("B8 الخادم سليم بعد الاختحام", s == 200 and r.get("status") == "ok", f"HTTP {s}")

    # ═══ C) انقطاع رقيق تحت الحمل (SIGTERM) ═══
    print("\n■ C) انقطاع رقيق: SIGTERM أثناء بيع حي → استعادة → إعادة المفاتيح")
    TAG_C = f"{TAG}-grace"
    grace_out = []
    N_GRACE = 14
    grace_deadline = time.time() + 6 + N_GRACE * 0.45
    gthread = threading.Thread(target=sale_stream, args=(tokens["admin"], KPOS, PID, SHIFT, TAG_C, f"{KEY_PREFIX}-grace", 0.45, grace_out, grace_deadline), daemon=True)
    gthread.start()
    time.sleep(6)
    spid = server_pid()
    check("C1 PID الخادم متحدد للاختبار", spid is not None, f"pid={spid}")
    if spid:
        os.system(f"kill -TERM {spid}")
    gthread.join()

    downtime = wait_health(90)
    check("C2 الحارس أعاد الخادم بعد SIGTERM تلقائيًا (السياسة الجديدة)",
          downtime >= 0, f"عطلة={downtime:.1f}s" if downtime >= 0 else "لم يعد خلال 90s")

    replay_g = replay_keys(tokens["admin"], SHIFT, grace_out)
    g_all2xx = all(x["status"] in (200, 201) for x in replay_g)
    g_oids = {x["order_id"] for x in replay_g if x["order_id"]} | {x["order_id"] for x in grace_out if x["order_id"]}
    check("C3 إعادة كل مفاتيح الانقطاع الرقيق: كلها 2xx (لا 409/لا 5xx)", g_all2xx, replay_summary(replay_g))
    check("C4 فاتورة واحدة بالضبط لكل مفتاح (لا ازدواج ولا خسارة)",
          len(g_oids) == len(grace_out), f"مفاتيح={len(grace_out)} فواتير فريدة={len(g_oids)}")
    db_grace = count_orders(TAG_C)
    check("C5 القاعدة: عدد فواتير ما بعد الانقطاع = عدد المفاتيح بالضبط", db_grace == len(grace_out),
          f"db={db_grace} keys={len(grace_out)}")
    check("C6 كل فواتير الانقطاع الرقيق مكتملة (بنود+مدفوعات+uuid)", order_integrity(TAG_C) == 0,
          f"ناقصة={order_integrity(TAG_C)}")

    # ═══ D) انقطاع عنيف تحت الحمل (kill -9) ═══
    print("\n■ D) انقطاع عنيف: kill -9 أثناء بيع حي → استعادة → إعادة المفاتيح")
    TAG_D = f"{TAG}-crash"
    crash_out = []
    N_CRASH = 14
    crash_deadline = time.time() + 6 + N_CRASH * 0.45
    cthread = threading.Thread(target=sale_stream, args=(tokens["admin"], KPOS, PID, SHIFT, TAG_D, f"{KEY_PREFIX}-crash", 0.45, crash_out, crash_deadline), daemon=True)
    cthread.start()
    time.sleep(6)
    spid2 = server_pid()
    check("D1 PID الخادم متحدد قبل القتل العنيف", spid2 is not None, f"pid={spid2}")
    if spid2:
        os.system(f"kill -9 {spid2}")
    cthread.join()

    downtime2 = wait_health(90)
    check("D2 الحارس أعاد الخادم بعد kill -9 تلقائيًا",
          downtime2 >= 0, f"عطلة={downtime2:.1f}s" if downtime2 >= 0 else "لم يعد خلال 90s")

    replay_c = replay_keys(tokens["admin"], SHIFT, crash_out)
    c_all2xx = all(x["status"] in (200, 201) for x in replay_c)
    c_oids = {x["order_id"] for x in replay_c if x["order_id"]} | {x["order_id"] for x in crash_out if x["order_id"]}
    check("D3 إعادة كل مفاتيح الانهيار: كلها 2xx", c_all2xx, replay_summary(replay_c))
    check("D4 فاتورة واحدة بالضبط لكل مفتاح رغم القتل العنيف",
          len(c_oids) == len(crash_out), f"مفاتيح={len(crash_out)} فواتير فريدة={len(c_oids)}")
    db_crash = count_orders(TAG_D)
    check("D5 القاعدة: فواتير ما بعد الانهيار = عدد المفاتيح بالضبط (WAL ذرية)", db_crash == len(crash_out),
          f"db={db_crash} keys={len(crash_out)}")
    check("D6 كل فواتير الانهيار مكتملة الأبناء", order_integrity(TAG_D) == 0,
          f"ناقصة={order_integrity(TAG_D)}")

    d7_ok, d7_detail = False, ""
    for i in range(3):
        s, r = robust_sale(tokens["admin"], KPOS, PID, SHIFT, f"{TAG}-post", f"{KEY_PREFIX}-post", attempts=2)
        if s in (200, 201):
            d7_ok, d7_detail = True, f"HTTP {s} (محاولة {i+1})"
            break
        d7_detail = f"HTTP {s}"
    check("D7 الوردية حية والبيع يعمل بعد الانقطاعين (بمحاولات الكاشير)", d7_ok, d7_detail)


    # ═══ E) حرب النسخ الاحتياطي: نسخة → تحقق → استرجاع في قاعدة تدريب ═══
    print("\n■ E) حرب النسخ الاحتياطي (نسخة كاملة → SHA-256 → استرجاع معزول → مقارنة)")
    TABLES = ["users", "departments", "pos_products", "pos_orders", "pos_order_items",
              "inventory_ledger", "dispatches", "notifications"]
    live_counts = {t: int(psql(f"SELECT COUNT(*) FROM {t}") or 0) for t in TABLES}
    env = dict(os.environ)
    with open(".env") as f:
        for line in f:
            if line.startswith("DB_PASSWORD="):
                env["PGPASSWORD"] = line.split("=", 1)[1].strip()
    env["KARIM_BACKUP_DIR"] = os.path.join(os.getcwd(), "database", "backups", f"drill-{RUN}")
    r = subprocess.run(["node", "database/scripts/backup.js"], capture_output=True, text=True, env=env, timeout=300, cwd=os.getcwd())
    check("E1 أمر النسخ الاحتياطي نجح", r.returncode == 0, (r.stderr or r.stdout).strip().splitlines()[-1][:120] if (r.stderr or r.stdout) else "")

    status_path = os.path.join(env["KARIM_BACKUP_DIR"], "daily-backup-status.json")
    try:
        with open(status_path) as f:
            bst = json.load(f)
    except Exception:
        bst = {}
    dump = os.path.join(env["KARIM_BACKUP_DIR"], bst.get("file", ""))
    dump_ok = bst.get("ok") and os.path.exists(dump) and bst.get("bytes", 0) > 0
    check("E2 ملف النسخة موجود وغير فارغ", dump_ok, f"{bst.get('file')} bytes={bst.get('bytes')}")

    digest = ""
    if dump_ok:
        with open(dump, "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()
    check("E3 بصمة SHA-256 مطابقة للسجل", dump_ok and digest == bst.get("sha256"),
          f"{digest[:16]}… == {str(bst.get('sha256'))[:16]}…")

    restored = False
    if dump_ok:
        PSQL = os.path.join("database", "bin", "bin", "psql")
        subprocess.run([PSQL, "-h", "localhost", "-U", "postgres", "-d", "postgres",
                        "-c", f"DROP DATABASE IF EXISTS {DRILL_DB};"], env=env, capture_output=True, text=True, timeout=60)
        rc = subprocess.run([PSQL, "-h", "localhost", "-U", "postgres", "-d", "postgres",
                             "-c", f"CREATE DATABASE {DRILL_DB};"], env=env, capture_output=True, text=True, timeout=60)
        if rc.returncode == 0:
            rr = subprocess.run([PSQL, "-h", "localhost", "-U", "postgres", "-d", DRILL_DB,
                                 "-v", "ON_ERROR_STOP=1", "-f", dump], env=env, capture_output=True, text=True, timeout=600)
            restored = rr.returncode == 0
            if not restored:
                print(f"  (استرجاع فشل) {(rr.stderr or '')[:300]}")
        else:
            print(f"  (إنشاء قاعدة التدريب فشل) {(rc.stderr or '')[:150]}")
    check("E4 الاسترجاع في قاعدة التدريب نجح كاملًا", restored, DRILL_DB)

    drill_equal = False
    if restored:
        PSQL = os.path.join("database", "bin", "bin", "psql")
        mism = []
        for t in TABLES:
            drc = subprocess.run([PSQL, "-h", "localhost", "-U", "postgres",
                                  "-d", DRILL_DB, "-t", "-A", "-c", f"SELECT COUNT(*) FROM {t};"],
                                 env=env, capture_output=True, text=True, timeout=60)
            dc = int(drc.stdout.strip() or 0)
            if dc != live_counts[t]:
                mism.append(f"{t}: حية={live_counts[t]} مستعادة={dc}")
        drill_equal = not mism
        check("E5 عدّ 8 جداول في المستعادة مطابق للحية بندًا بندًا", drill_equal, "; ".join(mism) or "مطابقة تامة")
        subprocess.run([PSQL, "-h", "localhost", "-U", "postgres", "-d", "postgres",
                        "-c", f"DROP DATABASE IF EXISTS {DRILL_DB};"], env=env, capture_output=True, text=True, timeout=60)
    live_after = {t: int(psql(f"SELECT COUNT(*) FROM {t}") or 0) for t in TABLES}
    check("E6 القاعدة الحية لم تُمَس أثناء الحرب", live_after == live_counts, "مطابقة")

    # ═══ F) طابور ZATCA: استعادة العالق + تراجع تلقائي دون Redis ═══
    print("\n■ F) طابور ZATCA: صفوف processing عالقة تُستعاد (حتى مع الإيقاف) + تراجع دون Redis")
    prev_enabled = (psql("SELECT enabled FROM zatca_settings WHERE id=1") or "f").strip()
    psql("UPDATE zatca_settings SET enabled=false WHERE id=1;")
    # فاتورتا الفحص تُنشآن هنا باستقلال تام عن D7 (بمحاولات إعادة)
    robust_sale(tokens["admin"], KPOS, PID, SHIFT, f"{TAG}-post", f"{KEY_PREFIX}-post-a")
    robust_sale(tokens["admin"], KPOS, PID, SHIFT, f"{TAG}-post", f"{KEY_PREFIX}-post-b")
    f_oids = [x[0] for x in psql_rows(f"SELECT id::text FROM pos_orders WHERE CAST(notes AS TEXT)='{TAG}-post' LIMIT 2")]
    check("F1 فاتورتا الفحص جاهزتان للطابور", len(f_oids) == 2, f"ids={len(f_oids)}")
    # البيع يُنشئ صفًا 'queued' لكل فاتورة تلقائيًا — نحوّل صفّيه إلى 'processing' عالق منذ 20 دقيقة
    # (محاكاة دقيقة: عامل طالب الصف ثم انهار قبل الإكمال)
    inserted = 0
    for oid in f_oids:
        try:
            psql(f"UPDATE pos_zatca_invoice_queue SET status='processing', attempts=1, "
                 f"queued_at=CURRENT_TIMESTAMP - INTERVAL '20 minutes', "
                 f"last_attempt_at=CURRENT_TIMESTAMP - INTERVAL '20 minutes' "
                 f"WHERE order_id='{oid}';")
            inserted += 1
        except Exception as e:
            print(f"  (تحديث طابور فشل) {str(e)[:120]}")
    check("F2 صفّا processing عالقان منذ 20 دقيقة (محاكاة انهيار عامل)", inserted == 2, f"updated={inserted}")

    # عامل بدون SKIP_BULLMQ — Redis غائب → يجب أن يتراجع لـ SQL polling ويستعيد الصفوف
    wenv = {k: v for k, v in env.items() if k != "SKIP_BULLMQ"}
    wenv["SKIP_BULLMQ"] = "0"
    wenv["BULLMQ_READY_TIMEOUT_MS"] = "4000"
    try:
        w = subprocess.Popen(["node", "backend/cashier-module/zatca-worker.js"], env=wenv,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=os.getcwd(),
                             start_new_session=True)
        time.sleep(18)  # 4s مهلة Redis → تراجع → دورة أولى بعد 10s
        w.terminate()
        try:
            wout, _ = w.communicate(timeout=10)
        except Exception:
            w.kill()
            wout, _ = w.communicate()
    except Exception as e:
        wout = str(e)
    fallback_seen = "falling back to SQL polling" in (wout or "")
    check("F3 العامل تراجع تلقائيًا لـ SQL polling بعد غياب Redis", fallback_seen,
          "رسالة التراجع ظهرت في مخرجاته" if fallback_seen else (wout or "")[-160:].replace("\n", " "))

    row_status = psql_rows(f"SELECT status, COALESCE(last_error,'') FROM pos_zatca_invoice_queue WHERE order_id IN ({','.join(chr(39)+o+chr(39) for o in f_oids)})" if f_oids else "SELECT 'none','none'")
    reclaimed = [x for x in row_status if x[0] == "failed" and "Reclaimed" in x[1]]
    check("F4 الصفوف العالقة استُعادت إلى failed رغم ZATCA موقوفًا (الإصلاح الجديد)",
          len(reclaimed) == 2, f"حالات={ [x[0] for x in row_status] }")
    sent = [x for x in row_status if x[0] in ("reported", "processing")]
    check("F5 التجميد محفوظ: صفر صفوف reported/processing والمفتاح موقوف", len(sent) == 0,
          f"reported/processing={len(sent)} — الإيقاف يجمّد الإرسال فعلًا")

    # ═══ G) التنظيف الكامل + مطابقة اللقطة ═══
    print("\n■ G) التنظيف الكامل ومطابقة اللقطة")
    for tag in [TAG, TAG_C, TAG_D, f"{TAG}-post"]:
        delete_orders(tag)
    psql(f"DELETE FROM pos_idempotency_keys WHERE key LIKE '{KEY_PREFIX}-%';")
    if f_oids:
        psql(f"DELETE FROM pos_zatca_invoice_queue WHERE order_id IN ({','.join(chr(39)+o+chr(39) for o in f_oids)});")
    psql("DELETE FROM pos_zatca_invoice_queue q WHERE NOT EXISTS (SELECT 1 FROM pos_orders o WHERE o.id::text = q.order_id);")
    net = float(psql_rows(
        f"SELECT COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='in' THEN ip.amount END),0)"
        f"-COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='out' THEN ip.amount END),0) "
        f"FROM pos_invoice_payments ip JOIN pos_orders o ON o.id=ip.order_id WHERE o.session_id={SHIFT}")[0][0] or 0)
    s, _, _ = req("POST", f"/api/pos/shifts/{SHIFT}/close", tokens["admin"], {"actual_cash": net, "notes": f"إغلاق فحص الصمود {RUN}"})
    check("G1 إغلاق وردية الفحص بفرق صفر", s == 200, f"HTTP {s} net={net}")
    psql(f"DELETE FROM pos_shift_sessions WHERE id = {SHIFT};")
    psql(f"DELETE FROM pos_products WHERE id = {PID};")
    try:
        psql(f"DELETE FROM pos_audit_logs WHERE table_name IN ('pos_shift_sessions','pos_products') AND row_pk IN ('{SHIFT}','{PID}','{str(SHIFT)}','{str(PID)}');")
    except Exception:
        pass
    psql(f"UPDATE zatca_settings SET enabled={'true' if prev_enabled.lower().startswith('t') else 'false'} WHERE id=1;")

    snap2 = take_snapshot()
    same = all(snap2[k] == snap[k] for k in snap)
    check("G2 اللقطة النهائية مطابقة للأساس حرفيًا (صفر بقايا)", same,
          "; ".join(f"{k}: {snap[k]}→{snap2[k]}" for k in snap if snap[k] != snap2[k]) or "مطابقة تامة")
    open_after = psql("SELECT COUNT(*) FROM pos_shift_sessions WHERE status='open'")
    check("G3 لا ورديات مفتوحة متبقية", int(open_after or 0) == 0, f"open={open_after}")
    s, r = health()
    check("G4 الخادم سليم في نهاية السيناريو", s == 200 and r.get("status") == "ok", f"HTTP {s}")

    # ═══ الخلاصة ═══
    total = len(RESULTS)
    passed = sum(1 for _, ok in RESULTS if ok)
    print("\n" + "═" * 70)
    print(f"  النتيجة: {passed}/{total} — {'النظام يصمد فعلًا ✓' if passed == total else 'ثمّة إخفاقات تحتاج إصلاحًا ✗'}")
    print("═" * 70)
    for name, ok in RESULTS:
        if not ok:
            print(f"  ✗ {name}")
    sys.exit(0 if passed == total else 1)

if __name__ == "__main__":
    main()
