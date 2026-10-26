#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
load_test.py — عدّاء حمل احترافي لنظام حورس ERP (مكتبة قياسية فقط)
════════════════════════════════════════════════════════════════════
يقيس قدرة النظام على تحمّل ضغط الشغل الحقيقي (كاشيرات متعددة + لوحات + جرد):

  A) لقطة أساس (حدود المعرفات + عدّادات الطوابير)
  B) تهيئة: دخول 5 هويات (محطات عمل) + منتج فحص + وردية
  C) حمل قراءة مستمر: 5 هويات × مزيج نقاط ساخنة × مدة — p50/p95/p99
  D) حمل كتابة (بيع): 4 خيوط × 15 بيعًا بمفاتيح فريدة — البيع أثقل معاملة
  E) عاصفة التكرار: 16 خيطًا على نفس مفتاح Idempotency — فاتورة واحدة بالضبط
  F) ذروة مفاجئة: 60 طلبًا متزامنًا مختلطًا — سلوك pool وقاطع الحماية
  G) تنظيف كامل والعودة للقطة (تحقق حرفي)

الاستخدام: python3 scripts/load_test.py [--reads-seconds 25] [--quick]
"""
import json, sys, time, threading, statistics, argparse, urllib.request, urllib.error
from http.client import HTTPConnection

BASE_HOST, BASE_PORT = "localhost", 5000
RUN = str(int(time.time()))
TAG = f"حمل{RUN}"

# ─────────────────────────── HTTP helper (keep-alive) ───────────────────────────
def _request(conn, method, path, token=None, body=None, headers=None, timeout=30):
    hdrs = {"Content-Type": "application/json"}
    if token: hdrs["Authorization"] = f"Bearer {token}"
    if headers: hdrs.update(headers)
    payload = json.dumps(body).encode() if body is not None else None
    t0 = time.perf_counter()
    try:
        conn.request(method, path, body=payload, headers=hdrs)
        resp = conn.getresponse()
        data = resp.read()
        dt = (time.perf_counter() - t0) * 1000.0
        try: j = json.loads(data.decode()) if data else {}
        except Exception: j = {"_raw": data[:120].decode(errors="replace")}
        return resp.status, j, dt
    except Exception as e:
        return 0, {"error": str(e)}, (time.perf_counter() - t0) * 1000.0

class Client:
    """اتصال مستمر لكل عامل — يحاكي محطة كاشير حقيقية بـ keep-alive"""
    def __init__(self, token=None):
        self.token = token
        self.conn = None
    def connect(self):
        self.conn = HTTPConnection(BASE_HOST, BASE_PORT, timeout=30)
    def req(self, method, path, body=None, headers=None, timeout=30):
        if self.conn is None:
            self.connect()
        try:
            s, j, dt = _request(self.conn, method, path, self.token, body, headers, timeout)
            if s == 0:  # مقطوع الاتصال — أعد المحاولة على اتصال جديد مرة واحدة
                self.conn.close(); self.connect()
                s, j, dt = _request(self.conn, method, path, self.token, body, headers, timeout)
            return s, j, dt
        except Exception:
            try: self.conn.close()
            except Exception: pass
            self.conn = None
            return 0, {"error": "conn"}, 9999.0
    def close(self):
        try: self.conn.close()
        except Exception: pass

def req(method, path, token=None, body=None, headers=None):
    c = Client(token)
    try: return c.req(method, path, body, headers)
    finally: c.close()

def login(username, password):
    s, r, _ = req("POST", "/api/auth/login", body={"username": username, "password": password})
    assert s == 200, f"login {username} failed: {s} {r}"
    return r.get("access_token") or r.get("token")

# ─────────────────────────── psql مباشر ───────────────────────────
import subprocess
PG = ["database/bin/bin/psql", "-h", "localhost", "-U", "postgres", "-d", "karim_erp", "-t", "-A"]
ENV = {**__import__("os").environ}
def _pw():
    with open(".env") as f:
        for line in f:
            if line.startswith("DB_PASSWORD="): return line.split("=", 1)[1].strip()
ENV["PGPASSWORD"] = _pw()
def psql(q):
    r = subprocess.run(PG, input=q, capture_output=True, text=True, env=ENV, timeout=30)
    if r.returncode != 0: raise RuntimeError(r.stderr.strip()[:200])
    return r.stdout.strip()
def psql_rows(q):
    out = psql(q)
    return [line.split("|") for line in out.splitlines() if line]

# ─────────────────────────── إحصاءات زمنية ───────────────────────────
def pct(sorted_vals, p):
    if not sorted_vals: return 0.0
    k = min(len(sorted_vals) - 1, max(0, int(round((p / 100.0) * len(sorted_vals) + 0.5)) - 1))
    return sorted_vals[k]
def stats_line(vals):
    if not vals: return "لا عينات"
    sv = sorted(vals)
    return (f"n={len(sv)} p50={pct(sv,50):.0f}ms p95={pct(sv,95):.0f}ms "
            f"p99={pct(sv,99):.0f}ms max={sv[-1]:.0f}ms")

RESULTS = []
def check(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))

# ─────────────────────────── عامل قراءة عام ───────────────────────────
def read_worker(user, token, seconds, mix, bucket, stop):
    c = Client(token)
    try:
        i = 0
        deadline = time.time() + seconds
        while time.time() < deadline and not stop.is_set():
            path = mix[i % len(mix)]
            s, r, dt = c.req("GET", path)
            with bucket["lock"]:
                bucket["lat"][path].append(dt)
                bucket["status"][path].append(s)
            i += 1
            time.sleep(0.75)  # ~1.3 rps/هوية — داخل حدود المعدل المشروعة (100/دقيقة/مستخدم)
    finally:
        c.close()

def sale_worker(token, dept_id, pid, shift_id, n, tag_prefix, bucket):
    c = Client(token)
    try:
        for k in range(n):
            key = f"load-{tag_prefix}-{RUN}-{k}-{threading.get_ident()}"
            sale = {"department_id": dept_id,
                    "items": [{"product_id": pid, "quantity": 1, "unit_price": 10, "discount": 0}],
                    "payments": [{"method": "cash", "amount": 11.5}],
                    "notes": TAG}
            s, r, dt = c.req("POST", "/api/sales/complete", sale,
                             headers={"Idempotency-Key": key, "X-Shift-Session-Id": str(shift_id)})
            with bucket["lock"]:
                bucket["lat"].append(dt); bucket["status"].append(s)
                if s in (200, 201) and r.get("order_id"): bucket["order_ids"].append(str(r["order_id"]))
    finally:
        c.close()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reads-seconds", type=int, default=25)
    ap.add_argument("--sales-per-thread", type=int, default=15)
    args = ap.parse_args()

    print("═" * 70)
    print("  حورس ERP — اختبار الحمل الاحترافي (قراءة/كتابة/تكرار/ذروة)")
    print("═" * 70)

    # ═══ A) تنظيف مسبق لأي بقايا جولات سابقة + لقطة أساس ═══
    print("\n■ A) تنظيف مسبق + لقطة الأساس")
    # 1) ورديات مفتوحة عالقة من جولات سابقة: تُغلق بفرق صفر إن لم تحمل طلبات غير فحصية
    open_shifts = psql_rows("SELECT s.id FROM pos_shift_sessions s WHERE s.status='open' "
                            "AND NOT EXISTS (SELECT 1 FROM pos_orders o WHERE o.session_id=s.id AND CAST(o.notes AS TEXT) !~ '^حمل[0-9]+$')")
    for (sid,) in open_shifts:
        psql(f"UPDATE pos_shift_sessions SET status='closed', closed_at=COALESCE(closed_at,CURRENT_TIMESTAMP), "
             f"actual_cash=0, notes='إغلاق وردية عالقة قبل فحص الحمل {RUN}' WHERE id={sid};")
    # 2) فواتير حمل سابقة (pos_orders.id من نوع UUID) وأطفالها
    stale_orders = psql("SELECT COALESCE(STRING_AGG(quote_literal(id::text), ','), 'NULL') FROM pos_orders WHERE CAST(notes AS TEXT) ~ '^حمل[0-9]+$'")
    if stale_orders != "NULL":
        for tbl in ["pos_pending_prints", "pos_zatca_invoice_queue", "pos_invoice_payments",
                    "pos_order_items", "erp_revenues"]:
            try: psql(f"DELETE FROM {tbl} WHERE order_id IN ({stale_orders});")
            except Exception: pass
        psql(f"DELETE FROM pos_orders WHERE id IN ({stale_orders});")
        print(f"  (تنظيف مسبق) حُذفت {len(stale_orders.split(','))} فاتورة من جولة سابقة")
    # 3) ورديات/منتجات فحص سابقة
    psql("DELETE FROM pos_shift_sessions WHERE notes ~ 'إغلاق فحص الحمل|إغلاق وردية عالقة قبل فحص الحمل' AND status='closed';")
    psql("DELETE FROM pos_products WHERE name_ar ~ 'صنف حمل [0-9]+';")
    # 4) اللقطة بعد التنظيف
    snap = {
        "shifts_max": psql("SELECT COALESCE(MAX(id),0) FROM pos_shift_sessions"),
        "products_max": psql("SELECT COALESCE(MAX(id),0) FROM pos_products"),
        "queue": psql("SELECT COALESCE(SUM(id),0) FROM pos_zatca_invoice_queue"),
        "revenues_max": psql("SELECT COALESCE(MAX(id),0) FROM erp_revenues"),
    }
    check("A1 لقطة الأساس ملتقطة (بعد تنظيف بقايا الحمل)", all(v is not None for v in snap.values()),
          f"shifts<={snap['shifts_max']} products<={snap['products_max']}")

    # ═══ B) تهيئة: 5 محطات + منتج + وردية ═══
    print("\n■ B) تهيئة المحطات")
    USERS = [("admin", "Karim2026Demo"), ("chef", "Karim2026Demo"), ("keeper", "Karim2026Demo"),
             ("head_salads", "Karim2026Demo"), ("head_sweets", "Karim2026Demo")]
    tokens = {}
    for u, p in USERS:
        try: tokens[u] = login(u, p)
        except AssertionError as e: print(f"  (تنبيه) {e}")
    check("B1 الدخول المتعدد (5 محطات)", len(tokens) >= 4, f"حسابات جاهزة={list(tokens)}")

    s, depts, _ = req("GET", "/api/pos/departments", tokens["admin"])
    kitchen = next((d for d in depts if d.get("code") == "erp_kitchen"), None)
    KPOS = int(kitchen["id"]) if kitchen else int(depts[0]["id"])
    s, prod, _ = req("POST", "/api/pos/products", tokens["admin"], {
        "name_ar": f"صنف حمل {RUN}", "price": 10, "vat_rate": 15, "cost_price": 1.0,
        "unit": "وحدة", "category": "فحص حمل", "department_ids": [KPOS]})
    PID = int(prod.get("id", 0)) if s in (200, 201) else 0
    check("B2 منتج الفحص جاهز على قسم الكاشير", s in (200, 201) and PID > 0, f"HTTP {s} id={PID}")

    s, shift, _ = req("POST", "/api/pos/shifts/open", tokens["admin"], {"department_id": KPOS, "opening_balance": 0})
    if s == 409:
        stale = psql_rows("SELECT id FROM pos_shift_sessions WHERE status='open' ORDER BY id LIMIT 1")
        if stale:
            net = float(psql_rows(f"SELECT COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='in' THEN ip.amount END),0)"
                                  f"-COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='out' THEN ip.amount END),0) "
                                  f"FROM pos_invoice_payments ip JOIN pos_orders o ON o.id=ip.order_id WHERE o.session_id={stale[0][0]}")[0][0] or 0)
            req("POST", f"/api/pos/shifts/{stale[0][0]}/close", tokens["admin"], {"actual_cash": net, "notes": f"إغلاق وردية عالقة قبل فحص الحمل {RUN}"})
        s, shift, _ = req("POST", "/api/pos/shifts/open", tokens["admin"], {"department_id": KPOS, "opening_balance": 0})
    SHIFT_ID = int(shift.get("session_id", 0)) if s in (200, 201) else 0
    check("B3 وردية الكاشير مفتوحة", s in (200, 201) and SHIFT_ID > 0, f"HTTP {s} shift={SHIFT_ID}")

    # ═══ C) حمل قراءة مستمر ═══
    print(f"\n■ C) حمل قراءة مستمر ({args.reads_seconds}s × {len(tokens)} محطات)")
    READ_MIX = ["/api/health", "/api/orders", "/api/pos/departments", "/api/notifications", "/api/inventory"]
    bucket = {"lock": threading.Lock(), "lat": {p: [] for p in READ_MIX}, "status": {p: [] for p in READ_MIX}}
    stop = threading.Event()
    threads = [threading.Thread(target=read_worker, args=(u, t, args.reads_seconds, READ_MIX, bucket, stop), daemon=True)
               for u, t in tokens.items()]
    t0 = time.perf_counter()
    for th in threads: th.start()
    for th in threads: th.join()
    wall = time.perf_counter() - t0
    total_reqs = sum(len(v) for v in bucket["lat"].values())
    all_lat = [x for v in bucket["lat"].values() for x in v]
    all_status = [s2 for v in bucket["status"].values() for s2 in v]
    errs = sum(1 for s2 in all_status if s2 >= 500 or s2 == 0)
    rate_limited = sum(1 for s2 in all_status if s2 == 429)
    rps = total_reqs / wall if wall > 0 else 0
    check("C1 الصحة: صفر أخطاء 5xx/انقطاع في حمل القراءة", errs == 0, f"errors={errs}")
    check("C2 لا اختناق 429 ضمن الحمل المشروع", rate_limited == 0, f"429={rate_limited}")
    sv = sorted(all_lat)
    check("C3 زمن استجابة القراءة p95 ≤ 250ms", pct(sv, 95) <= 250, stats_line(all_lat) + f" rps={rps:.1f}")
    for p in READ_MIX:
        lat = sorted(bucket["lat"][p]); codes = bucket["status"][p]
        bad = sum(1 for c2 in codes if c2 >= 500 or c2 == 0)
        check(f"C4-{READ_MIX.index(p)+1} {p}", bad == 0, stats_line(lat) + f" codes:200x{codes.count(200)}")

    # ═══ D) حمل كتابة (البيع — أثقل معاملة: قيد ذري + وصفة + ZATCA + طباعة) ═══
    print(f"\n■ D) حمل بيع متوازٍ (4 خيوط × {args.sales_per_thread} بيعًا)")
    wbucket = {"lock": threading.Lock(), "lat": [], "status": [], "order_ids": []}
    sthreads = [threading.Thread(target=sale_worker, args=(tokens["admin"], KPOS, PID, SHIFT_ID, args.sales_per_thread, f"w{i}", wbucket), daemon=True)
                for i in range(4)]
    t0 = time.perf_counter()
    for th in sthreads: th.start()
    for th in sthreads: th.join()
    swall = time.perf_counter() - t0
    ok_sales = sum(1 for s2 in wbucket["status"] if s2 in (200, 201))
    expected = 4 * args.sales_per_thread
    check("D1 كل عمليات البيع نجحت 201/200", ok_sales == expected, f"{ok_sales}/{expected}")
    check("D2 معرفات فواتير فريدة بلا تكرار", len(set(wbucket["order_ids"])) == expected, f"unique={len(set(wbucket['order_ids']))}")
    sv = sorted(wbucket["lat"])
    check("D3 زمن البيع p95 ≤ 800ms", pct(sv, 95) <= 800, stats_line(wbucket["lat"]) + f" throughput={expected/swall:.1f} sale/s")
    db_created = psql(f"SELECT COUNT(*) FROM pos_orders WHERE CAST(notes AS TEXT)='{TAG}'")
    check("D4 القاعدة سجلت العدد بالضبط (ذرية كاملة)", int(db_created or 0) == expected, f"db={db_created} expected={expected}")

    # ═══ E) عاصفة التكرار: نفس المفتاح × 16 خيطًا ═══
    print("\n■ E) عاصفة التكرار (نفس Idempotency-Key × 16 خيطًا متزامنًا)")
    storm_key = f"storm-{RUN}"
    storm_sale = {"department_id": KPOS,
                  "items": [{"product_id": PID, "quantity": 1, "unit_price": 10, "discount": 0}],
                  "payments": [{"method": "cash", "amount": 11.5}], "notes": TAG}
    sbucket = {"lock": threading.Lock(), "statuses": [], "order_ids": []}
    def storm_worker():
        c = Client(tokens["admin"])
        try:
            s, r, _ = c.req("POST", "/api/sales/complete", storm_sale,
                            headers={"Idempotency-Key": storm_key, "X-Shift-Session-Id": str(SHIFT_ID)})
            with sbucket["lock"]:
                sbucket["statuses"].append(s)
                if s in (200, 201) and r.get("order_id"): sbucket["order_ids"].append(str(r["order_id"]))
        finally:
            c.close()
    threads = [threading.Thread(target=storm_worker, daemon=True) for _ in range(16)]
    for th in threads: th.start()
    for th in threads: th.join()
    uniq = set(sbucket["order_ids"])
    check("E1 عاصفة التكرار: كل الاستجابات نجحت دون 5xx", all(s2 in (200, 201, 409) for s2 in sbucket["statuses"]),
          f"codes={ {c2: sbucket['statuses'].count(c2) for c2 in set(sbucket['statuses'])} }")
    check("E2 فاتورة واحدة بالضبط من 16 طلبًا متزامنًا", len(uniq) == 1, f"unique_order_ids={len(uniq)}")
    db_after_storm = int(psql(f"SELECT COUNT(*) FROM pos_orders WHERE CAST(notes AS TEXT)='{TAG}'") or 0)
    check("E3 القاعدة: العاصفة أضافت فاتورة واحدة بالضبط فوق حمل البيع", db_after_storm == expected + 1,
          f"db={db_after_storm} expected={expected + 1} (60 بيع + 1 عاصفة)")

    # ═══ F) ذروة مفاجئة: 60 طلبًا في لحظة ═══
    print("\n■ F) ذروة مفاجئة (60 طلبًا متزامنًا مختلطًا)")
    spike_paths = ["/api/health", "/api/orders", "/api/pos/departments", "/api/notifications"]
    fbucket = {"lock": threading.Lock(), "lat": [], "status": []}
    def spike_worker(tok, paths):
        c = Client(tok)
        try:
            for p in paths:
                s, r, dt = c.req("GET", p)
                with fbucket["lock"]:
                    fbucket["lat"].append(dt); fbucket["status"].append(s)
        finally:
            c.close()
    toks = list(tokens.values())
    threads = []
    for i in range(60):
        p = [spike_paths[i % len(spike_paths)]]
        threads.append(threading.Thread(target=spike_worker, args=(toks[i % len(toks)], p), daemon=True))
    t0 = time.perf_counter()
    for th in threads: th.start()
    for th in threads: th.join()
    swall = time.perf_counter() - t0
    sv = sorted(fbucket["lat"])
    bad = sum(1 for s2 in fbucket["status"] if s2 >= 500 or s2 == 0)
    check("F1 الذروة: صفر أخطاء 5xx", bad == 0, f"errors={bad}")
    check("F2 الذروة: 60 طلبًا تخدم كلها ≤ 3s", sv[-1] <= 3000 if sv else False,
          stats_line(fbucket["lat"]) + f" wall={swall:.2f}s")
    s, h, _ = req("GET", "/api/health")
    check("F3 الخادم سليم بعد الذروة (لا تسريب اتصالات)", s == 200 and h.get("status") == "ok", f"HTTP {s}")

    # ═══ G) التنظيف ═══
    print("\n■ G) التنظيف الكامل")
    net = float(psql_rows(f"SELECT COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='in' THEN ip.amount END),0)"
                          f"-COALESCE(SUM(CASE WHEN ip.method='cash' AND ip.direction='out' THEN ip.amount END),0) "
                          f"FROM pos_invoice_payments ip JOIN pos_orders o ON o.id=ip.order_id WHERE o.session_id={SHIFT_ID}")[0][0] or 0)
    s, _dt, _ = req("POST", f"/api/pos/shifts/{SHIFT_ID}/close", tokens["admin"], {"actual_cash": net, "notes": f"إغلاق فحص الحمل {RUN}"})
    check("G1 إغلاق الوردية بفرق صفر", s == 200, f"HTTP {s} net={net}")

    # فواتير الفحص بوسم التشغيل الفريد (pos_orders.id من نوع UUID)
    TEST_ORDERS = psql(f"SELECT COALESCE(STRING_AGG(quote_literal(id::text), ','), 'NULL') FROM pos_orders WHERE CAST(notes AS TEXT)='{TAG}'")
    if TEST_ORDERS != "NULL":
        for tbl in ["pos_pending_prints", "pos_zatca_invoice_queue", "pos_invoice_payments",
                    "pos_order_items", "erp_revenues"]:
            try: psql(f"DELETE FROM {tbl} WHERE order_id IN ({TEST_ORDERS});")
            except Exception: pass
        psql(f"DELETE FROM pos_orders WHERE id IN ({TEST_ORDERS});")
    psql(f"DELETE FROM pos_shift_sessions WHERE id = {SHIFT_ID};")
    psql(f"DELETE FROM pos_products WHERE id = {PID};")
    try: psql(f"DELETE FROM pos_audit_logs WHERE table_name IN ('pos_shift_sessions','pos_products') AND row_id IN ({SHIFT_ID},{PID});")
    except Exception: pass

    orphans = psql("SELECT COUNT(*) FROM pos_order_items oi WHERE NOT EXISTS (SELECT 1 FROM pos_orders o WHERE o.id=oi.order_id)")
    leftovers = psql(f"SELECT COUNT(*) FROM pos_orders WHERE CAST(notes AS TEXT)='{TAG}'")
    after = {
        "shifts_max": psql("SELECT COALESCE(MAX(id),0) FROM pos_shift_sessions"),
        "products_max": psql("SELECT COALESCE(MAX(id),0) FROM pos_products"),
        "revenues_max": psql("SELECT COALESCE(MAX(id),0) FROM erp_revenues"),
    }
    check("G2 القاعدة مطابقة للقطة (لا بقايا فحص ولا أيتام)",
          leftovers == "0" and orphans == "0" and after["shifts_max"] == snap["shifts_max"]
          and after["products_max"] == snap["products_max"] and after["revenues_max"] == snap["revenues_max"],
          f"leftovers={leftovers} orphans={orphans} {json.dumps(after, ensure_ascii=False)}")

    # ═══ الخلاصة ═══
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = [n for n, ok, _ in RESULTS if not ok]
    print("\n" + "═" * 70)
    print(f"النتيجة: {passed}/{len(RESULTS)} فحصًا ناجحًا")
    if failed:
        print("فاشلة:"); [print(f"  ✗ {n}") for n in failed]
    sys.exit(0 if not failed else 1)

if __name__ == "__main__":
    main()
