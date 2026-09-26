#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_hardening_audit.py — التدقيق الحي لمهمة التحصين المؤسسي (Task 24)
────────────────────────────────────────────────────────────────────────────────
يغطي: المراقبة الحية (/api/metrics + RBAC)، الحروق المثبتة للمحددات (429)،
حرس المعاملات المعلقة على مستوى القاعدة، رؤوس الأمان، سجل الطلبات البطيئة،
نسخة احتياطية حديثة + تمرين استرجاع كامل إلى قاعدة مؤقتة، إثباتات السباقات
من نتيجة فحص الحمل، وسقف مرآة app_state، وتنظيف صفر بقايا.
"""
import json, subprocess, sys, time, hashlib, glob, os

BASE = "http://localhost:5000"
RUN = f"hlt{int(time.time())}"
ENV = "/home/z/my-project/karim-erp/.env"
PSQL_BIN = "/home/z/my-project/karim-erp/database/bin/bin/psql"
CWD = "/home/z/my-project/karim-erp"
LOG = "/tmp/karim-server.log"

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
    return r.stdout.strip()

def psql_rows(sql, db="karim_erp"):
    out = psql(sql, db)
    return [line.split("|") for line in out.splitlines() if line]

import urllib.request, urllib.error
def req(method, path, token=None, body=None, headers=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if body is not None: r.add_header("Content-Type", "application/json")
    if token: r.add_header("Authorization", f"Bearer {token}")
    for k, v in (headers or {}).items(): r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read()
            try: j = json.loads(raw)
            except Exception: j = None
            return resp.status, j, dict(resp.headers)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: j = json.loads(raw)
        except Exception: j = None
        return e.code, j, dict(e.headers)
    except Exception as e:
        return 0, None, {"err": str(e)}

# ═══════════════ A. لقطة أساس + المراقبة الحية ═══════════════
print("\n═══ A. المراقبة الحية والأمان ═══")
SNAP_TABLES = ["pos_orders", "pos_order_items", "pos_shift_sessions", "inventory_ledger", "inventoryTx",
               "inventory_audits", "inventory_audit_items", "expenses", "users", "pos_products",
               "pos_pending_prints", "pos_zatca_invoice_queue", "inventory"]
baseline = {t: psql(f"SELECT COUNT(*) FROM {t.replace('inventoryTx', '\"inventoryTx\"')}") for t in SNAP_TABLES}
check("A1 لقطة أساس لكل الجداول الحساسة", all(v.isdigit() for v in baseline.values()), str(baseline)[:120])

s, health, _ = req("GET", "/api/health")
check("A2 الخادم حي", s == 200 and health.get("status") == "ok", f"HTTP {s}")

s, met, hdrs = req("GET", "/api/metrics")
check("A3 /api/metrics للغير موثق → 401", s == 401, f"HTTP {s}")
s, login, _ = req("POST", "/api/auth/login", body={"username": "admin", "password": "Karim2026Demo"})
TOK = login.get("access_token")
check("A4 دخول المدير", s == 200 and TOK, f"HTTP {s}")

s, met, hdrs = req("GET", "/api/metrics", TOK)
shape_ok = met and all(k in met for k in ("requests", "eventLoopLagUs", "memory", "cpu", "dbPool", "uptimeSec"))
lat = met.get("requests", {}).get("latency", {}) if met else {}
check("A5 /api/metrics للمدير — الشكل الكامل (عدادات/مئينات/حلقة أحداث/ذاكرة/مسبح)", s == 200 and shape_ok, f"HTTP {s} keys={list((met or {}).keys())[:8]}")
check("A6 المئينات حاضرة (p50/p95/p99 في نافذة 5 دقائق)",
      lat.get("last5m") and all(k in lat["last5m"] for k in ("p50", "p95", "p99", "max")), str(lat.get("last5m"))[:100])
check("A7 مسبح القاعدة يعلن حجمه (max) وفعله (total/idle/waiting)",
      met.get("dbPool", {}).get("max") == 25 and "total" in met.get("dbPool", {}), str(met.get("dbPool")))
check("A8 تأخر حلقة الأحداث مقيس بالمايكروثانية", bool(met.get("eventLoopLagUs")), str(met.get("eventLoopLagUs"))[:80])
check("A9 رأس Cache-Control: no-store على المراقبة", hdrs.get("Cache-Control") == "no-store", str(hdrs.get("Cache-Control")))

s, _, hdrs = req("GET", "/api/health")
sec_ok = hdrs.get("X-Content-Type-Options") == "nosniff" and hdrs.get("X-Frame-Options") == "SAMEORIGIN"
check("A10 رؤوس الأمان (nosniff + SAMEORIGIN) على كل الاستجابات", sec_ok, str({k: hdrs.get(k) for k in ("X-Content-Type-Options", "X-Frame-Options")}))

# عاصفة قراءة حية مصغرة — استقرار تحت الضغط
codes = []
t0 = time.time()
for i in range(120):
    c, _, _ = req("GET", "/api/health" if i % 2 else "/api/pos/dashboard", None if i % 2 else TOK)
    codes.append(c)
wall = time.time() - t0
five = [c for c in codes if c >= 500]
check("A11 عاصفة 120 طلبًا مختلطًا: صفر 5xx", len(five) == 0, f"5xx={len(five)} wall={wall:.1f}s")

# ═══════════════ B. الحروق: المحددات + RBAC ═══════════════
print("\n═══ B. المحددات وصلاحيات المراقبة ═══")
# bcrypt hash يُولد عبر node (bcryptjs) بدل مكتبة بايثون غير موجودة
import subprocess as _sp
hash_ = _sp.run(["node", "-e", "console.log(require('bcryptjs').hashSync('HLT#pass123',8))"],
                capture_output=True, text=True, cwd=CWD).stdout.strip()
tu_id = psql(f"INSERT INTO users (id, username, password, role, name, active) VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM users), '{RUN}', '{hash_}', 'cashier', 'فحص تحصين', true) RETURNING id")
tu_id = int(tu_id.splitlines()[0].strip())
check("B1 مستخدم رمي أُنشئ (يعزل حرق المحدد عن admin)", tu_id > 0, f"id={tu_id}")

s, tl, _ = req("POST", "/api/auth/login", body={"username": RUN, "password": "HLT#pass123"})
TU_TOK = tl.get("access_token")
codes = [req("POST", "/api/auth/login", body={"username": RUN, "password": "WRONG"})[0] for _ in range(26)]
t429 = codes.count(429)
check("B2 عاصفة دخول (26×) تُخنق بـ 429 بعد العتبة", t429 >= 5, f"429={t429}/26")
s, _, h = req("POST", "/api/auth/login", body={"username": RUN, "password": "WRONG"})
check("B3 الرد 429 يحمل Retry-After", s == 429 and h.get("Retry-After"), f"HTTP {s} retry={h.get('Retry-After')}")
s, _, h = req("GET", "/api/state", TU_TOK)
rl = h.get("X-RateLimit-Limit")
check("B4 رؤوس X-RateLimit على المسارات المحدودة", s in (200, 403) and rl is not None, f"HTTP {s} limit={rl}")
s2, _, _ = req("GET", "/api/metrics", TU_TOK)
check("B5 /api/metrics للكاشير → 403 (حرس الدور)", s2 == 403, f"HTTP {s2}")

# ═══════════════ C. الحروق على مستوى القاعدة ═══════════════
print("\n═══ C. حرس القاعدة ومرآة الحالة ═══")
guard = psql("SHOW idle_in_transaction_session_timeout")
guard_ms = "10000" if guard in ("10s", "10000", "10 s") else guard
check("C1 حرس المعاملات المعلقة مفعّل (10s) على مستوى القاعدة", guard_ms == "10000", f"setting={guard}")
rev_len = int(psql("SELECT jsonb_array_length(COALESCE(state_data->'revenues','[]'::jsonb)) FROM app_state WHERE id=1"))
check("C2 مرآة app_state محدودة السقف (≤300 إيرادًا)", rev_len <= 300, f"len={rev_len}")
slow_lines = subprocess.run(["grep", "-c", "[SLOW]", LOG], capture_output=True, text=True).stdout.strip()
check("C3 سجل الطلبات البطيئة نشط (سطور [SLOW] من فحص الحمل)", int(slow_lines or 0) >= 1, f"lines={slow_lines}")

# ═══════════════ D. نسخة احتياطية + تمرين استرجاع كامل ═══════════════
print("\n═══ D. النسخ الاحتياطي والاسترجاع ═══")
baks = sorted(glob.glob("/home/z/my-project/karim-erp/database/backups/karim-karim_erp-*.sql"))
check("D1 توجد نسخ احتياطية", len(baks) >= 1, f"count={len(baks)}")
bak = baks[-1]
size = os.path.getsize(bak)
check("D2 أحدث نسخة بحجم سليم (≥5MB)", size >= 5 * 1024 * 1024, f"{size/1048576:.1f}MB {os.path.basename(bak)}")
sha_file = bak + ".sha256"
if os.path.exists(sha_file):
    expected = open(sha_file).read().split()[0]
    actual = hashlib.sha256(open(bak, "rb").read()).hexdigest()
    check("D3 بصمة SHA-256 للنسخة مطابقة", expected == actual, f"{actual[:16]}…")
else:
    actual = hashlib.sha256(open(bak, "rb").read()).hexdigest()
    check("D3 بصمة SHA-256 محسوبة للنسخة", len(actual) == 64, actual[:16])

psql("DROP DATABASE IF EXISTS karim_erp_restore_drill")
psql("CREATE DATABASE karim_erp_restore_drill")
rt = subprocess.run([f"{CWD}/database/bin/bin/psql", "-h", "localhost", "-U", "postgres",
                     "-d", "karim_erp_restore_drill", "-f", bak],
                    capture_output=True, text=True, env={**os.environ, "PGPASSWORD": PW}, cwd=CWD)
check("D4 الاسترجاع إلى قاعدة مؤقتة نجح بلا أخطاء", rt.returncode == 0, (rt.stderr or "")[-120:])
match, mismatch = [], []
for t in SNAP_TABLES:
    q = f"SELECT COUNT(*) FROM {t.replace('inventoryTx', '\"inventoryTx\"')}"
    live, restored = psql(q), psql(q, "karim_erp_restore_drill")
    if t == "users":
        live = str(int(live) - 1)  # المستخدم الرمي أنشأه هذا التدقيق بعد أخذ النسخة
    (match if live == restored else mismatch).append(t)
check("D5 مطابقة عدد صفوف الجداول الحساسة كلها بعد الاسترجاع", not mismatch, f"mismatch={mismatch}")
tbl_live = psql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'")
tbl_rest = psql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'", "karim_erp_restore_drill")
check("D6 عدد الجداول الكامل متطابق (69/69)", tbl_live == tbl_rest, f"live={tbl_live} restored={tbl_rest}")
psql("DROP DATABASE karim_erp_restore_drill")
check("D7 القاعدة المؤقتة حُذفت (لا أثر)", psql("SELECT COUNT(*) FROM pg_database WHERE datname='karim_erp_restore_drill'") == "0")

# ═══════════════ E. إثباتات فحص الحمل والسباقات ═══════════════
print("\n═══ E. أدلة الحمل والسباقات ═══")
try:
    lt = json.load(open("/home/z/my-project/karim-erp/scripts/load_test_result.json"))
    passed = lt.get("passed"), lt.get("failed")
    check("E1 نتيجة فحص الحمل مسجلة ومكتملة (41 ناجح / 0 فاشل)", passed == (41, 0), f"passed={lt.get('passed')} failed={lt.get('failed')}")
    keys = [r["name"] for r in lt.get("results", []) if r.get("pass")]
    for needle, label in [
        ("55 بيعًا نجحت", "عاصفة 55 بيعًا متزامنًا نجحت"),
        ("مستحيل (5×409", "البيع بعد نفاد الرصيد مستحيل"),
        ("فاتورة واحدة فقط", "سباق مفتاح الالتقاط: فاتورة واحدة"),
        ("اعتماد واحد فقط", "سباق اعتماد الجرد: فائز واحد"),
        ("إغلاق واحد فقط", "سباق إغلاق الوردية: فائز واحد"),
        ("مطابقة اللقطة", "لا بقايا بعد فحص الحمل"),
    ]:
        check(f"E2 {label}", any(needle in k for k in keys), needle)
except FileNotFoundError:
    check("E1 نتيجة فحص الحمل موجودة", False, "load_test_result.json missing")

# ═══════════════ F. تنظيف ═══════════════
print("\n═══ F. التنظيف ومطابقة اللقطة ═══")
psql(f"DELETE FROM users WHERE id={tu_id}")
check("F1 المستخدم الرمي حُذف", psql(f"SELECT COUNT(*) FROM users WHERE id={tu_id}") == "0")
after = {t: psql(f"SELECT COUNT(*) FROM {t.replace('inventoryTx', '\"inventoryTx\"')}") for t in SNAP_TABLES}
drift = {t: (baseline[t], after[t]) for t in SNAP_TABLES if baseline[t] != after[t]}
check("F2 مطابقة اللقطة: صفر بقايا في كل الجداول الحساسة", not drift, str(drift)[:160])

passed = sum(1 for _, ok, _ in results if ok)
failed = len(results) - passed
print(f"\n{'═' * 60}")
print(f"═══ نتيجة التدقيق الحي للتحصين: {passed} ناجح / {failed} فاشل ═══")
print(f"{'═' * 60}")
sys.exit(0 if failed == 0 else 1)
