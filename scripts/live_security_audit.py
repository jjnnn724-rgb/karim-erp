#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_security_audit.py — التدقيق الأمني الحي الشامل (2026-09-03)
════════════════════════════════════════════════════════════════════
يختبر النظام الحي على localhost:5000 عبر 9 مجموعات فحص:

  A. مصفوفة الوصول المجهول        (Unauthenticated access matrix)
  B. هجمات JWT (none-alg / توقيع مزيف / منتهي / توكن تجديد كتوكن وصول)
  C. مصفوفة كتابة الأدوار بعد الإصلاح (RBAC write matrix)
  D. القراءات الحساسة (رواتب/مستخدمون/مالية)
  E. الخدمة الذاتية للحضور (لا تزوير حضور الآخرين)
  F. حقن SQL (حقن تسجيل الدخول + الترتيب + المعرفات + قياس الزمن)
  G. حرق محدد الدخول (brute force → 429)
  H. ترويسات الأمان (CSP / nosniff / XFO / لا بصمة خادم)
  I. نظافة الأخطاء (لا stack traces في الإنتاج)
  J. دورة كلمة المرور الأولية (must_change_password حياً)
  K. إيقاف الحساب يُسقط الجلسة الحية (فحص النشط + التخزين المؤقت)
  L. تخزين XSS (يُخزن خاماً في الـ API — الواجهة تهرب — يُنظف فوراً)
  M. منطق الأعمال (كميات سالبة / تلاعب أسعار)
  N. صفر بقايا (مطابقة لقطة الجداول قبل/بعد)

Usage: python3 scripts/live_security_audit.py
Exit code 0 = كل الفحوص نجحت.
"""

import json
import os
import re
import subprocess
import sys
import time
import base64
import hmac
import hashlib
import urllib.request
import urllib.error
from datetime import datetime, timezone

BASE = "http://localhost:5000"
ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env")
PSQL = os.path.join(os.path.dirname(__file__), "..", "database", "bin", "bin", "psql")
DEMO_PASSWORD = "Karim2026Demo"

PASS, FAIL = 0, 0
FAILURES = []
TEMP_USERS = []          # [(id, username)] للتنظيف
CREATED_ENTITIES = []    # [(entity, id)] للتنظيف


# ─── أدوات ───────────────────────────────────────────────────────────────────
def env(key, default=""):
    with open(ENV_PATH) as fh:
        for line in fh:
            m = re.match(rf"^{key}=(.*)$", line.strip())
            if m:
                return m.group(1)
    return default


DB_PASSWORD = env("DB_PASSWORD")


def sql(query, single=False):
    """تنفيذ SQL عبر psql المضمّن."""
    e = dict(os.environ, PGPASSWORD=DB_PASSWORD)
    out = subprocess.run(
        [PSQL, "-h", "localhost", "-U", "postgres", "-d", "karim_erp", "-t", "-A", "-c", query],
        capture_output=True, text=True, env=e, timeout=30,
    )
    if out.returncode != 0:
        raise RuntimeError(f"SQL failed: {out.stderr.strip()[:200]}")
    val = out.stdout.strip()
    return val if not single else (val.split("\n")[0] if val else "")


def http(method, path, token=None, body=None, raw_headers=None, timeout=15):
    """طلب HTTP كامل: (status, headers_dict, body_text, elapsed_ms)."""
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    for k, v in (raw_headers or {}).items():
        req.add_header(k, v)
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read().decode("utf-8", "replace"), int((time.time() - start) * 1000)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace"), int((time.time() - start) * 1000)
    except Exception as e:
        return 0, {}, f"CONNECTION_ERROR: {e}", int((time.time() - start) * 1000)


def login(username, password=DEMO_PASSWORD):
    s, _, b, _ = http("POST", "/api/auth/login", body={"username": username, "password": password})
    if s != 200:
        return None, None
    d = json.loads(b)
    return d.get("access_token"), d.get("refresh_token")


def check(group, name, ok, detail=""):
    global PASS, FAIL
    mark = "✓" if ok else "✗"
    line = f"  [{mark}] {name}" + (f" — {detail}" if detail and not ok else "")
    print(line)
    if ok:
        PASS += 1
    else:
        FAIL += 1
        FAILURES.append(f"[{group}] {name} — {detail}")


def snapshot():
    tables = ["users", "expenses", "revenues", "purchaseInvoices", "inventory",
              "inventoryTx", "employees", "attendance", "orders", "dispatches",
              "notifications", "pos_refresh_tokens", "pos_products", "recipes"]
    out = {}
    for t in tables:
        try:
            out[t] = int(sql(f'SELECT count(*) FROM "{t}"', single=True))
        except Exception:
            out[t] = -1
    return out


def cleanup():
    print("\n" + "═" * 30 + " التنظيف " + "═" * 30)
    for entity, eid in reversed(CREATED_ENTITIES):
        try:
            sql(f'DELETE FROM "{entity}" WHERE id={int(eid)}')
            print(f"  • حُذف {entity}#{eid}")
        except Exception as e:
            print(f"  ⚠ تعذر حذف {entity}#{eid}: {e}")
    for uid, uname in TEMP_USERS:
        try:
            sql(f"DELETE FROM pos_refresh_tokens WHERE user_id={uid}")
            sql(f"DELETE FROM users WHERE id={uid} AND username='{uname}'")
            print(f"  • حُذف المستخدم المؤقت {uname}#{uid}")
        except Exception as e:
            print(f"  ⚠ تعذر حذف {uname}: {e}")


def make_jwt(payload_b64_part, secret, alg="HS256", sig=None):
    """توليد JWT يدوياً للتحكم في الخوارزمية والتوقيع."""
    header = base64.urlsafe_b64encode(json.dumps({"alg": alg, "typ": "JWT"}).encode()).rstrip(b"=").decode()
    payload = payload_b64_part
    signing_input = f"{header}.{payload}".encode()
    if sig is None:
        signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()).rstrip(b"=").decode()
    else:
        signature = sig
    return f"{header}.{payload}.{signature}"


def b64(obj):
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()


# ═════════════════════════════════════════════════════════════════════════════
def main():
    print("═" * 78)
    print("التدقيق الأمني الحي الشامل — Karim ERP v4.7.0 — " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
    print("═" * 78)

    pre_snapshot = snapshot()

    # ─── التهيئة: توكنات الأدوار ───
    print("\n[0] تهيئة جلسات الأدوار")
    tokens = {}
    for role_user in ["admin", "chef", "keeper", "head_salads"]:
        t, _ = login(role_user)
        tokens[role_user] = t
        check("0", f"تسجيل دخول {role_user}", t is not None)
    admin, chef, keeper, head = tokens["admin"], tokens["chef"], tokens["keeper"], tokens["head_salads"]

    # ═══ A. الوصول المجهول ═══
    print("\n[A] مصفوفة الوصول المجهول — كل مسارات البيانات ترفض بلا توكن")
    protected = [
        "/api/users", "/api/payroll", "/api/expenses", "/api/revenues",
        "/api/employees", "/api/inventory", "/api/orders", "/api/dispatches",
        "/api/settings", "/api/state", "/api/metrics", "/api/notifications",
        "/api/procurement/suppliers", "/api/procurement/payments", "/api/procurement/summary",
        "/api/finance/pnl", "/api/hr/leave-workflow", "/api/pos/products",
    ]
    for p in protected:
        s, _, b, _ = http("GET", p)
        check("A", f"GET {p} بدون توكن → 401", s == 401, f"got {s}: {b[:80]}")
    s, _, _, _ = http("POST", "/api/sales/complete", body={})
    check("A", "POST /api/sales/complete بدون توكن → 401", s == 401, f"got {s}")
    s, _, _, _ = http("DELETE", "/api/users/1")
    check("A", "DELETE /api/users/1 بدون توكن → 401", s == 401, f"got {s}")

    # ═══ B. هجمات JWT ═══
    print("\n[B] هجمات JWT — تزوير/خوارزميات/توكنات تالفة")
    access_secret = env("JWT_ACCESS_SECRET")
    admin_payload = {"sub": "1", "role": "admin", "name": "pwn", "dept_code": None, "sid": None, "pwd_change": False}
    admin_b64 = b64(admin_payload)

    # B1: خوارزمية none
    header_none = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    tok_none = f"{header_none}.{admin_b64}."
    s, _, _, _ = http("GET", "/api/users", token=tok_none)
    check("B", "alg=none مرفوضة", s == 401, f"got {s}")

    # B2: خوارزمية غير مصرحة HS512
    tok_hs512 = make_jwt(admin_b64, access_secret, alg="HS512")
    s, _, _, _ = http("GET", "/api/users", token=tok_hs512)
    check("B", "alg=HS512 غير المصرحة مرفوضة", s == 401, f"got {s}")

    # B3: توقيع بسر خاطئ (تزوير كامل الشكل)
    tok_wrong_secret = make_jwt(admin_b64, "attacker-controlled-secret-0123456789abcdef")
    s, _, _, _ = http("GET", "/api/users", token=tok_wrong_secret)
    check("B", "توكن موقّع بسر خاطئ مرفوض", s == 401, f"got {s}")

    # B4: توقيع مزيف (بايتات عشوائية)
    tok_bad_sig = f"{base64.urlsafe_b64encode(json.dumps({'alg':'HS256','typ':'JWT'}).encode()).rstrip(b'=').decode()}.{admin_b64}.AAAA BBBB"
    s, _, _, _ = http("GET", "/api/users", token=tok_bad_sig.replace(" ", "+"))
    check("B", "توقيع مشوه مرفوض", s == 401, f"got {s}")

    # B5: توكن منتهي (exp في الماضي) بتوقيع صحيح
    expired_payload = dict(admin_payload, exp=1000000000, iat=999999999)
    tok_expired = make_jwt(b64(expired_payload), access_secret)
    s, _, _, _ = http("GET", "/api/users", token=tok_expired)
    check("B", "توكن منتهي مرفوض", s == 401, f"got {s}")

    # B6: توكن تجديد مُقدَّم كتوكن وصول
    _, keeper_refresh = login("keeper")
    if keeper_refresh:
        s, _, _, _ = http("GET", "/api/users", token=keeper_refresh)
        check("B", "توكن التجديد لا يعمل كتوكن وصول", s == 401, f"got {s}")
    else:
        check("B", "توكن التجديد لا يعمل كتوكن وصول", False, "لم يُصدر refresh token")

    # B7: غرابة الترويسة
    s, _, _, _ = http("GET", "/api/users", raw_headers={"Authorization": "Basic YWRtaW46YWRtaW4="})
    check("B", "Basic auth مرفوض", s == 401, f"got {s}")
    s, _, _, _ = http("GET", "/api/users", raw_headers={"Authorization": "Bearer"})
    check("B", "Bearer فارغ مرفوض", s == 401, f"got {s}")

    # B8: sub غير رقمي/غير موجود
    ghost = make_jwt(b64({"sub": "99999999999", "role": "admin", "name": "ghost", "pwd_change": False}), access_secret)
    s, _, _, _ = http("GET", "/api/users", token=ghost)
    # بتوقيع صحيح لكن مستخدم غير موجود: الفحص النشط (إنتاج) يجب أن يرفض
    check("B", "توكن مستخدم وهمي (sub غي��ي موجود) مرفوض بالفحص النشط", s in (401, 403), f"got {s}")

    # ═══ C. مصفوفة كتابة الأدوار (بعد الإصلاح) ═══
    print("\n[C] مصفوفة كتابة الأدوار — الكيانات العامة مقفلة على أصحابها")
    PROBE_BODIES = {
        "expenses":        {"amount": 1.0, "date": "2026-09-03", "desc": "AUDIT"},
        "revenues":        {"amount": 1.0, "date": "2026-09-03", "source": "AUDIT"},
        "inventoryTx":     {"date": "2026-09-03", "quantity": 1},
        "employees":       {"name": "AUDIT"},
        "shelves":         {"name": "AUDIT"},
        "recipes":         {"name": "AUDIT"},
    }
    # ما يجب أن يُمنع عن كل دور (requireRole يسبق التحقق من الجسم فأي جسم يكفي)
    forbidden_matrix = {
        "chef":        ["expenses", "revenues", "inventoryTx", "employees", "shelves"],
        "keeper":      ["expenses", "revenues", "employees", "recipes"],
        "head_salads": ["expenses", "revenues", "inventoryTx", "employees"],
    }
    for who, tk in [("chef", chef), ("keeper", keeper), ("head_salads", head)]:
        if not tk:
            continue
        for entity in forbidden_matrix[who]:
            s, _, b, _ = http("POST", f"/api/{entity}", token=tk, body=PROBE_BODIES[entity])
            check("C", f"{who} POST {entity} → 403", s == 403, f"got {s}: {b[:60]}")
        s, _, _, _ = http("DELETE", "/api/expenses/1", token=tk)
        check("C", f"{who} DELETE expenses/1 → 403", s == 403, f"got {s}")
        s, _, _, _ = http("PUT", "/api/orders/999999", token=tk, body={"total": 0})
        check("C", f"{who} PUT orders (تلاعب مالي) → 403", s == 403, f"got {s}")
        s, _, _, _ = http("POST", "/api/users", token=tk, body={"username": "pwn", "password": "x", "role": "admin", "name": "pwn"})
        check("C", f"{who} POST users (إنشاء أدمن) → 403", s == 403, f"got {s}")

    # السماح المشروع يبقى يعمل: الحرس لا يمنع أصحاب الدور (أي استجابة عدا 403)
    s, _, b, _ = http("POST", "/api/inventoryTx", token=keeper, body=PROBE_BODIES["inventoryTx"])
    check("C", "keeper POST inventoryTx ليس ممنوعاً (دور المخزن)", s != 403, f"got {s}")
    if s == 201:
        try:
            CREATED_ENTITIES.append(("inventoryTx", int(json.loads(b)["id"])))
        except Exception:
            pass
    s, _, b, _ = http("POST", "/api/shelves", token=keeper, body={"name": "AUDIT-SHELF-PROBE", "location": "audit"})
    check("C", "keeper POST shelves ليس ممنوعاً", s != 403, f"got {s}")
    if s == 201:
        try:
            CREATED_ENTITIES.append(("shelves", int(json.loads(b)["id"])))
        except Exception:
            pass
    s, _, b, _ = http("POST", "/api/recipes", token=chef, body={"name": "AUDIT-RECIPE"})
    check("C", "chef POST recipes ليس ممنوعاً (دور المطبخ)", s != 403, f"got {s}")
    if s == 201:
        try:
            CREATED_ENTITIES.append(("recipes", int(json.loads(b)["id"])))
        except Exception:
            pass

    # ═══ D. القراءات الحساسة ═══
    print("\n[D] القراءات الحساسة — المالية والرواتب والمستخدمون")
    for who, tk in [("chef", chef), ("keeper", keeper), ("head_salads", head)]:
        if not tk:
            continue
        for p in ["/api/users", "/api/payroll", "/api/revenues", "/api/expenses", "/api/purchaseInvoices"]:
            s, _, _, _ = http("GET", p, token=tk)
            check("D", f"{who} GET {p} → 403", s == 403, f"got {s}")
    for p in ["/api/users", "/api/payroll", "/api/revenues", "/api/expenses"]:
        s, _, _, _ = http("GET", p, token=admin)
        check("D", f"admin GET {p} → 200", s == 200, f"got {s}")

    # ═══ E. الخدمة الذاتية للحضور ═══
    print("\n[E] الخدمة الذاتية للحضور — لا تزوير حضور الآخرين (ولا تجاوز الملكية)")
    chef_emp = sql('SELECT id FROM employees WHERE "userId"=(SELECT id FROM users WHERE username=\'chef\') LIMIT 1', single=True)
    if chef_emp:
        # chef مرتبط بموظف: التزوير لموظف آخر يجب أن يُرفض بالملكية
        s, _, b, _ = http("POST", "/api/attendance", token=chef,
                          body={"employeeId": 999999, "date": "2026-09-03", "checkIn": "08:00", "late": False})
        check("E", "chef تزوير حضور موظف آخر → 403 ATTENDANCE_SELF_ONLY", s == 403 and "ATTENDANCE_SELF_ONLY" in b, f"got {s}: {b[:80]}")
    else:
        s, _, b, _ = http("POST", "/api/attendance", token=chef,
                          body={"employeeId": 999999, "date": "2026-09-03", "checkIn": "08:00", "late": False})
        check("E", "chef بلا ربط موظف: أي تسجيل حضور → 403 EMPLOYEE_LINK_REQUIRED",
              s == 403 and "EMPLOYEE_LINK_REQUIRED" in b, f"got {s}: {b[:80]}")
    s, _, b, _ = http("POST", "/api/attendance", token=chef,
                      body={"employeeId": "1; DROP TABLE attendance;--", "date": "2026-09-03", "checkIn": "08:00", "late": False})
    check("E", "حقن في employeeId يُرفض/يُهرب (لا 500 ولا تنفيذ)", s in (400, 403, 422), f"got {s}: {b[:60]}")

    # ═══ F. حقن SQL ═══
    print("\n[F] حقن SQL — تسجيل الدخول/الترتيب/المعرفات + قياس الزمن")
    payloads_login = [
        ("' OR '1'='1", "x"),
        ("admin'--", "x"),
        ("'||(SELECT pg_sleep(2))--", "x"),
    ]
    for i, (u, p) in enumerate(payloads_login, 1):
        s, _, b, ms = http("POST", "/api/auth/login", body={"username": u, "password": p})
        ok = s == 401 and ms < 1500
        check("F", f"حقن دخول #{i} ({u[:24]!r}) → 401 سريع", ok, f"status={s} time={ms}ms")

    s, _, b, _ = http("GET", "/api/inventory?sort=(SELECT%201)&order=ASC", token=admin)
    # التحليل: القيمة الخبيثة إما تُرفض بـ 400 أو تتحيد بسلامة إلى الترتيب
    # الافتراضي (allowlist) — المهم ألا تصبح القيمة الخبيثة هي الترتيب الفعلي
    try:
        eff_sort = json.loads(b).get("pagination", {}).get("sort", "")
    except Exception:
        eff_sort = "?"
    check("F", "حقن عمود الترتيب مُحايد (لا 400 فهو مرفوض، وإلا الافتراضي id)",
          s == 400 or (s == 200 and eff_sort == "id"), f"got {s} effective_sort={eff_sort!r}")
    s, _, b, _ = http("GET", "/api/inventory/1%20OR%201=1", token=admin)
    # الاستعلام مُعامل (بلا حقن) — معرف غير رقمي قد يفجّر 500 لكن بلا تسريب
    check("F", "حقن معرف السجل: بلا تسريب بيانات ولا stack",
          s in (400, 404, 422, 500) and "stack" not in b and "syntax" not in b.lower(), f"got {s}: {b[:80]}")
    s, _, _, ms = http("GET", "/api/inventory?limit=1&offset=0%3BSELECT%20pg_sleep(2)", token=admin)
    check("F", "حقن الإزاحة لا ينفذ (زمن سريع)", ms < 1500 and s in (200, 400), f"got {s} time={ms}ms")

    # ═══ G. حرق محدد الدخول ═══
    print("\n[G] محدد معدل الدخول — موجة brute force على مستخدم غير موجود")
    bf_user = "sec_audit_bruteforce_ghost"
    got_429 = False
    retry_after = ""
    for i in range(1, 30):
        s, h, b, _ = http("POST", "/api/auth/login", body={"username": bf_user, "password": "wrong-pass"})
        if s == 429:
            got_429 = True
            retry_after = h.get("Retry-After", "")
            check("G", f"429 بعد {i} محاولة + Retry-After", bool(retry_after), f"Retry-After={retry_after!r}")
            break
    if not got_429:
        check("G", "429 بعد موجة brute force", False, "لم يظهر 429 خلال 29 محاولة")

    # ═══ H. ترويسات الأمان ═══
    print("\n[H] ترويسات الأمان")
    s, h, _, _ = http("GET", "/api/health")
    check("H", "X-Content-Type-Options: nosniff", h.get("X-Content-Type-Options") == "nosniff")
    check("H", "X-Frame-Options: SAMEORIGIN", h.get("X-Frame-Options") == "SAMEORIGIN")
    check("H", "Referrer-Policy مضبوطة", "strict-origin" in h.get("Referrer-Policy", ""))
    csp = h.get("Content-Security-Policy", "")
    check("H", "Content-Security-Policy موجودة", bool(csp))
    check("H", "CSP تحجوم التأطير (frame-ancestors)", "frame-ancestors 'self'" in csp)
    check("H", "CSP تحظر object/embed", "object-src 'none'" in csp)
    check("H", "لا بصمة X-Powered-By", "X-Powered-By" not in h)

    # ═══ I. نظافة الأخطاء ═══
    print("\n[I] نظافة الأخطاء — لا تسريب في الإنتاج")
    # جسم JSON تالف تماماً
    req = urllib.request.Request(BASE + "/api/auth/login", data=b"{invalid-json", method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            s, b = resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        s, b = e.code, e.read().decode()
    check("I", "JSON تالف → 4xx بلا stack trace", 400 <= s < 500 and "stack" not in b, f"status={s} body={b[:100]}")
    s, _, b, _ = http("GET", "/api/definitely-not-a-route", token=admin)
    check("I", "مسار غير موجود → 404 نظيف", s == 404 and "stack" not in b, f"got {s}")
    s, _, b, _ = http("GET", "/api/health")
    d = json.loads(b) if s == 200 else {}
    check("I", "health لا يكشف مسارات داخلية", "pwd" not in json.dumps(d).lower() and "secret" not in json.dumps(d).lower())

    # ═══ J. دورة كلمة المرور الأولية (حي) ═══
    print("\n[J] must_change_password — الحساب الجديد مقيد حتى يُدوّر كلمته")
    ts = int(time.time() * 1000)
    tmp_user = f"sec_audit_rot_{ts}"
    rot_hash = subprocess.run(
        ["node", "-e", "console.log(require('bcryptjs').hashSync('RotPass2026!', 10))"],
        capture_output=True, text=True, cwd=os.path.join(os.path.dirname(__file__), ".."),
    ).stdout.strip()
    tmp_id = int(sql(
        f"INSERT INTO users (id, username, password, role, name, active, must_change_password) "
        f"VALUES ({ts}000, '{tmp_user}', '{rot_hash}', "
        f"'cashier', 'تدقيق دورة', true, true) RETURNING id", single=True))
    TEMP_USERS.append((tmp_id, tmp_user))
    t_rot, r_rot = login(tmp_user, "RotPass2026!")
    check("J", "دخول حساب مُلزم بالتدوير يصدر توكن + علم التدوير", t_rot is not None)
    s, _, b, _ = http("GET", "/api/notifications", token=t_rot)
    check("J", "حساب التدوير محجوب من مسارات العمل (403)", s == 403 and "PASSWORD_CHANGE_REQUIRED" in b, f"got {s}: {b[:80]}")
    s, _, b, _ = http("POST", "/api/auth/change-password", token=t_rot,
                      body={"current_password": "RotPass2026!", "new_password": "RotPass2026!x2"})
    check("J", "تدوير كلمة المرور عبر المسار المخصص يعمل", s == 200, f"got {s}: {b[:80]}")
    t_rot2, _ = login(tmp_user, "RotPass2026!x2")
    s, _, _, _ = http("GET", "/api/notifications", token=t_rot2)
    check("J", "بعد التدوير الحساب يعمل طبيعياً", s == 200, f"got {s}")

    # ═══ K. إيقاف الحساب يُسقط الجلسة ═══
    print("\n[K] إيقاف الحساب — الفحص النشط يسقط الجلسات الحية (ينتظر انتهاء ذاكرة 60ث)")
    ts2 = int(time.time() * 1000)
    tmp2 = f"sec_audit_deact_{ts2}"
    new_hash = subprocess.run(
        ["node", "-e", "console.log(require('bcryptjs').hashSync('DeactPass2026!', 10))"],
        capture_output=True, text=True, cwd=os.path.join(os.path.dirname(__file__), ".."),
    ).stdout.strip()
    tmp2_id = int(sql(
        f"INSERT INTO users (id, username, password, role, name, active) "
        f"VALUES ({ts2}000, '{tmp2}', '{new_hash}', 'cashier', 'تدقيق إيقاف', true) RETURNING id", single=True))
    TEMP_USERS.append((tmp2_id, tmp2))
    t_deact, r_deact = login(tmp2, "DeactPass2026!")
    check("K", "المستخدم المؤقت يدخل بنجاح", t_deact is not None)
    s, _, _, _ = http("GET", "/api/notifications", token=t_deact)
    check("K", "جلسة المستخدم النشط تعمل", s == 200, f"got {s}")
    sql(f"UPDATE users SET active=false WHERE id={tmp2_id}")
    print("  … انتظار 62 ثانية لانتهاء ذاكرة الفحص النشط (60ث) …")
    time.sleep(62)
    s, _, b, _ = http("GET", "/api/notifications", token=t_deact)
    check("K", "توكن مستخدم مُوقف → 401 ACCOUNT_DISABLED", s == 401 and "ACCOUNT_DISABLED" in b, f"got {s}: {b[:80]}")
    s, _, b, _ = http("POST", "/api/auth/refresh", body={"refresh_token": r_deact})
    check("K", "رمز تجديد مستخدم مُوقف → 401", s == 401, f"got {s}")
    sql(f"UPDATE users SET active=true WHERE id={tmp2_id}")  # سيُحذف في التنظيف على أي حال

    # ═══ L. تخزين XSS ═══
    print("\n[L] تخزين XSS — الـ API يخزن الخام (مسؤولية العرض على الواجهة التي تهرب بـ esc)")
    xss = "<script>alert('xss')</script><img src=x onerror=alert(1)>"
    s, _, b, _ = http("POST", "/api/expenses", token=admin, body={"amount": 1, "date": "2026-09-03", "desc": xss})
    check("L", "إنشاء مصروف بحمولة XSS (كمسؤول) يخزن خاماً كما هو مصمم", s == 201, f"got {s}")
    if s == 201:
        xid = int(json.loads(b)["id"])
        CREATED_ENTITIES.append(("expenses", xid))
        check("L", "الاستجابة تعيد الحمولة كما أُدخلت (بلا تنفيذ), تُهرب في العرض", xss in b)
    app_js = open(os.path.join(os.path.dirname(__file__), "..", "frontend", "app", "js", "app.js"), encoding="utf-8").read()
    check("L", "الواجهة تستخدم دالة تهريب esc() في القوالب", "function esc(" in app_js or "const esc" in app_js)
    idx_html = open(os.path.join(os.path.dirname(__file__), "..", "frontend", "app", "index.html"), encoding="utf-8").read()
    check("L", "لا سكربتات inline في index.html (CSP صارم ممكن)", "<script>" not in idx_html)

    # ═══ M. منطق الأعمال ═══
    print("\n[M] منطق الأعمال — رفض الكميات/الأسعار الخبيثة دون 500")
    s, _, b, _ = http("POST", "/api/sales/complete", token=admin, body={"items": [{"product_id": 1, "quantity": -5, "unit_price": 10}], "payment_method": "cash"})
    check("M", "كمية سالبة في البيع → رفض 4xx (لا 500)", 400 <= s < 500, f"got {s}: {b[:80]}")
    s, _, b, _ = http("POST", "/api/sales/complete", token=admin, body={"items": "not-an-array", "payment_method": "cash"})
    check("M", "جسم بيع مشوه → رفض 4xx (لا 500)", 400 <= s < 500, f"got {s}: {b[:80]}")
    s, _, b, _ = http("POST", "/api/expenses", token=admin, body={"amount": "not-a-number!", "date": "2026-09-03"})
    check("M", "مبلغ غير رقمي → رفض 4xx أو تجاهل آمن (لا 500)", s in (201, 400, 422), f"got {s}")
    if s == 201:
        CREATED_ENTITIES.append(("expenses", int(json.loads(b)["id"])))

    # ═══ N. صفر بقايا ═══
    print("\n[N] صفر بقايا — مطابقة لقطة الجداول بعد التنظيف")
    cleanup()
    post_snapshot = snapshot()
    residue_ok = True
    for t, before in pre_snapshot.items():
        after = post_snapshot.get(t, -1)
        if t == "pos_refresh_tokens":
            continue  # رموز الجلسات الحية (admin/chef/keeper) مشروعة وتتغير طبيعياً
        if after != before:
            residue_ok = False
            check("N", f"جدول {t} عاد لحالته ({before})", False, f"before={before} after={after}")
    if residue_ok:
        check("N", "كل الجداول مطابقة للقطة ما قبل التدقيق", True)

    # ═══ الخلاصة ═══
    print("\n" + "═" * 78)
    print(f"النتيجة: {PASS} نجح / {FAIL} فشل من {PASS + FAIL}")
    if FAILURES:
        print("الفحوص الفاشلة:")
        for f in FAILURES:
            print(f"  ✗ {f}")
    print("═" * 78)
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
