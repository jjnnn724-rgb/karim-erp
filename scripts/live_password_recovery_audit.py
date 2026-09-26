#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_password_recovery_audit.py — التدقيق الحي لاستعادة كلمة المرور الذاتية (Task 37)
════════════════════════════════════════════════════════════════════════════
يثبت على الخادم الحي (localhost:5000) أن الموظف الذي نسي كلمة مروره يستطيع
تغييرها بنفسه برمز لمرة واحدة يصدره المدير:

  [0] الفحص الأولي: الخادم والعاملان الخلفيان.
  [A] بوابات الوصول: غير المصادق 401، وأدوار غير الإدارة 403، وحساب
      غير موجود 404 — إصدار الرمز للإدارة فقط.
  [B] إصدار الرمز: 6 أرقام، يُخزن مجزأً SHA-256 لا خاماً، صلاحية 10 دقائق،
      وإصدار جديد يبطل السابق (صف واحد غير مستخدم فقط).
  [C] دورة chef الكاملة: رمز خاطئ 401 (يعdds المحاولات) → كلمة ضعيفة 422 →
      الرمز الصحيح 200 (كلمة جديدة فعلاً + استهلاك الرمز + سحب جلسات
      التجديد) → دخول بالجديدة 200 والقديمة 401 → إعادة استخدام الرمز 401 →
      الرمز المنتهي 401 → استرجاع الهاش الأصلي ودخول الأصلية 200.
  [D] قفل الرمز على keeper: 5 محاولات خاطئة → 429 حتى بالرمز الصحيح،
      وكلمة مرور keeper لا تتغير إطلاقاً.
  [U] التوصيل الواجهي: روابط ونوافذ وأزرار الاستعادة في الدخولين واللوحة.
  [Z] صفر بقايا: مطابقة لقطة الجداول قبل/بعد + استرجاع كامل لكلمة chef.

ملاحظة: صفوف pos_audit_logs للتدقيق (إصدار/استعادة) أدلة append-only
بفاعلين حقيقيين — تبقى كوثائق عملية لا كنفايات.

Usage: python3 scripts/live_password_recovery_audit.py
Exit code 0 = كل الفحوص نجحت.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "http://127.0.0.1:5000"
ROOT = os.path.join(os.path.dirname(__file__), "..")
ENV_PATH = os.path.join(ROOT, ".env")
PSQL = os.path.join(ROOT, "database", "bin", "bin", "psql")
DEMO_PASSWORD = "Karim2026Demo"
CHEF = "chef"
KEEPER = "keeper"

PASS, FAIL = 0, 0
FAILURES = []


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


def http(method, path, token=None, body=None, timeout=25):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    time.sleep(0.3)
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


def bcrypt_check(password, hash_):
    """التحقق من التجزئة عبر node (bcryptjs) — البايثون لا يملك المكتبة."""
    out = subprocess.run(
        ["node", "-e", "const b=require('bcryptjs');process.stdout.write(String(b.compareSync(process.argv[1], process.argv[2])))", password, hash_],
        cwd=ROOT, capture_output=True, text=True, timeout=20,
    )
    return out.stdout.strip() == "true"


def pid_alive(pattern):
    out = subprocess.run(["pgrep", "-f", pattern], capture_output=True, text=True)
    return out.returncode == 0 and out.stdout.strip() != ""


SNAPSHOT_TABLES = ["users", "pos_password_reset_codes", "pos_refresh_tokens",
                   "pos_orders", "pos_products", "pos_shift_sessions"]


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
    global PASS, FAIL
    print("═" * 78)
    print("التدقيق الحي — استعادة كلمة المرور الذاتية — Karim ERP v4.7.0 — " +
          datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
    print("═" * 78)
    audit_start_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S+00")
    # بقايا تشغيل سابق متوقف (أكواد لم يُنظفها تشغيل انهار قبل [Z]) — الجدول
    # جديد والميزة لم تدخل إنتاجاً بعد، فلا يوجد رموز شرعية تُمس
    sql("DELETE FROM pos_password_reset_codes")
    baseline = snapshot()
    # نسخ صفوف توكنات ما قبل التدقيق — بعضها سيُسحب بواسطة الميزة نفسها
    # (سحب الجلسات عند نجاح الاستعادة) فنُعيدها حرفياً في [Z] لمطابقة اللقطة
    pre_tokens = sql("SELECT user_id, token_hash, device_info::text, ip_address, expires_at, issued_at FROM pos_refresh_tokens")
    pre_tokens_rows = [ln for ln in pre_tokens.split("\n") if ln.strip()]
    chef_hash_backup = sql(f"SELECT password FROM users WHERE username = '{CHEF}'", single=True)
    check("0", "هاش كلمة مرور chef محفوظ للاسترجاع", chef_hash_backup.startswith("$2"))

    # ─── [0] الفحص الأولي ───
    print("\n[0] الفحص الأولي")
    s, b = http("GET", "/api/health")
    check("0", "الخادم حي وسليم", s == 200)
    check("0", "عامل الطباعة حي كعملية", pid_alive("cashier-module/print-worker.js"))
    check("0", "عامل ZATCA حي كعملية", pid_alive("cashier-module/zatca-worker.js"))

    # ─── [A] بوابات الوصول ───
    print("\n[A] بوابات الوصول — الإدارة فقط تُصدر الرموز")
    s, b = http("POST", "/api/auth/forgot-password/request-code", body={"username": CHEF})
    check("A", "غير مصادق → إصدار رمز = 401", s == 401, f"s={s} {b[:100]}")

    chef_token = login(CHEF)
    check("A", "دخول chef بكلمة الأصلية", chef_token is not None)
    s, b = http("POST", "/api/auth/forgot-password/request-code", token=chef_token, body={"username": KEEPER})
    check("A", "chef (دور kitchen) → إصدار رمز = 403 (بوابة الدور)", s == 403, f"s={s} {b[:100]}")

    s, b = http("POST", "/api/auth/forgot-password/request-code", body={})
    check("A", "طلب فاسد بلا اسم مستخدم = 422/401", s in (401, 422), f"s={s}")

    admin_token = login("admin")
    check("A", "دخول admin", admin_token is not None)
    s, b = http("POST", "/api/auth/forgot-password/request-code", token=admin_token, body={"username": "no-such-user-xyz"})
    check("A", "حساب غير موجود → 404 (للمدير المصادق فقط)", s == 404, f"s={s}")

    # ─── [B] إصدار الرمز ───
    print("\n[B] إصدار رمز الاستعادة — 6 أرقام، مجزأً، ويبطل السابق")
    s, b = http("POST", "/api/auth/forgot-password/request-code", token=admin_token, body={"username": CHEF})
    j = json.loads(b) if s == 200 else {}
    code1 = j.get("code", "")
    check("B", "admin يُصدر رمزاً لـ chef = 200", s == 200 and re.fullmatch(r"\d{6}", code1), f"s={s} code={code1[:2]}**")
    check("B", "الصلاحية 600 ثانية", j.get("expires_in_seconds") == 600)
    rows = sql(f"SELECT count(*) FROM pos_password_reset_codes WHERE user_id = (SELECT id FROM users WHERE username='{CHEF}')", single=True)
    check("B", "صف رمز واحد غير مستخدم في القاعدة", rows == "1", f"rows={rows}")
    stored_hash = sql(f"SELECT code_hash FROM pos_password_reset_codes WHERE user_id = (SELECT id FROM users WHERE username='{CHEF}') ORDER BY id DESC LIMIT 1", single=True)
    check("B", "الرمز مخزن مجزأً SHA-256 لا خاماً", stored_hash == hashlib.sha256(code1.encode()).hexdigest())

    s, b = http("POST", "/api/auth/forgot-password/request-code", token=admin_token, body={"username": CHEF})
    j2 = json.loads(b) if s == 200 else {}
    code2 = j2.get("code", "")
    check("B", "إصدار رمز ثانٍ = 200 برمز مختلف", s == 200 and code2 and code2 != code1)
    rows = sql(f"SELECT count(*) FROM pos_password_reset_codes WHERE user_id = (SELECT id FROM users WHERE username='{CHEF}') AND used_at IS NULL", single=True)
    check("B", "الرمز الأول بُطل — صف غير مستخدم واحد فقط", rows == "1", f"rows={rows}")
    used_count = sql(f"SELECT count(*) FROM pos_password_reset_codes WHERE user_id = (SELECT id FROM users WHERE username='{CHEF}') AND code_hash = '{hashlib.sha256(code1.encode()).hexdigest()}'", single=True)
    check("B", "الأول حُذف فعلاً (لا يُترك كصف مستخدم)", used_count == "0", f"count={used_count}")

    # ─── [C] دورة chef الكاملة ───
    print("\n[C] دورة chef — خاطئ → ضعيف → صحيح → دخول → إعادة استخدام → منتهي → استرجاع")
    new_password = "ChefFresh2026x"

    s, b = http("POST", "/api/auth/forgot-password/reset", body={"username": CHEF, "code": "000000", "new_password": new_password})
    check("C", "رمز خاطئ → 401 برسالة موحدة", s == 401 and json.loads(b).get("error") == "RESET_FAILED", f"s={s}")
    attempts = sql(f"SELECT attempts FROM pos_password_reset_codes WHERE user_id = (SELECT id FROM users WHERE username='{CHEF}') ORDER BY id DESC LIMIT 1", single=True)
    check("C", "المحاولة الخاطئة رفعت العداد (1)", attempts == "1", f"attempts={attempts}")

    s, b = http("POST", "/api/auth/forgot-password/reset", body={"username": CHEF, "code": code2, "new_password": "weak123"})
    check("C", "كلمة مرور ضعيفة → 422", s == 422, f"s={s}")

    chef_tokens_before = sql(f"SELECT count(*) FROM pos_refresh_tokens WHERE user_id = (SELECT id FROM users WHERE username='{CHEF}')", single=True)
    s, b = http("POST", "/api/auth/forgot-password/reset", body={"username": CHEF, "code": code2, "new_password": new_password})
    check("C", "الرمز الصحيح + كلمة قوية → 200", s == 200 and json.loads(b).get("ok") is True, f"s={s} {b[:120]}")

    db_hash = sql(f"SELECT password FROM users WHERE username = '{CHEF}'", single=True)
    check("C", "كلمة المرور الجديدة فعالة في القاعدة (bcrypt)", bcrypt_check(new_password, db_hash))
    check("C", "كلمة المرور القديمة لم تعد صالحة", not bcrypt_check(DEMO_PASSWORD, db_hash))
    used_at = sql(f"SELECT used_at IS NOT NULL FROM pos_password_reset_codes WHERE code_hash = '{hashlib.sha256(code2.encode()).hexdigest()}'", single=True)
    check("C", "الرمز استُهلك (used_at مضبوط)", used_at == "t")
    chef_tokens_after = sql(f"SELECT count(*) FROM pos_refresh_tokens WHERE user_id = (SELECT id FROM users WHERE username='{CHEF}')", single=True)
    check("C", f"كل جلسات التجديد سُحبت ({chef_tokens_before} → 0)", chef_tokens_after == "0", f"after={chef_tokens_after}")

    s, b = http("POST", "/api/auth/login", body={"username": CHEF, "password": new_password})
    check("C", "دخول chef بكلمة المرور الجديدة = 200", s == 200, f"s={s}")
    s, b = http("POST", "/api/auth/login", body={"username": CHEF, "password": DEMO_PASSWORD})
    check("C", "دخول بكلمة المرور القديمة = 401", s == 401, f"s={s}")

    s, b = http("POST", "/api/auth/forgot-password/reset", body={"username": CHEF, "code": code2, "new_password": "ChefFresh2026y"})
    check("C", "إعادة استخدام الرمز المستهلك → 401", s == 401, f"s={s}")

    # رمز منتهي: إصدار ثم رفع expires_at للماضي عبر SQL (محاكاة مرور الوقت)
    s, b = http("POST", "/api/auth/forgot-password/request-code", token=admin_token, body={"username": CHEF})
    j3 = json.loads(b) if s == 200 else {}
    code3 = j3.get("code", "")
    sql(f"UPDATE pos_password_reset_codes SET expires_at = NOW() - INTERVAL '1 minute' WHERE code_hash = '{hashlib.sha256(code3.encode()).hexdigest()}'")
    s, b = http("POST", "/api/auth/forgot-password/reset", body={"username": CHEF, "code": code3, "new_password": "ChefFresh2026z"})
    check("C", "الرمز المنتهي → 401 حتى بالرمز الصحيح", s == 401, f"s={s}")

    # استرجاع كلمة chef الأصلية (نهاية الدورة — صفر بقايا وظيفية)
    sql(f"UPDATE users SET password = '{chef_hash_backup}' WHERE username = '{CHEF}'")
    s, b = http("POST", "/api/auth/login", body={"username": CHEF, "password": DEMO_PASSWORD})
    check("C", "بعد الاسترجاع: دخول chef بكلمة الأصلية = 200", s == 200, f"s={s}")
    restored_hash = sql(f"SELECT password FROM users WHERE username = '{CHEF}'", single=True)
    check("C", "الهاش المطابق حرفياً للنسخة الأصلية", restored_hash == chef_hash_backup)

    # ─── [D] قفل الرمز (على keeper — كلمة مروره لا تتغير) ───
    print("\n[D] قفل الرمز بعد 5 محاولات خاطئة — keeper يبقى بكلمته الأصلية")
    keeper_hash_before = sql(f"SELECT password FROM users WHERE username = '{KEEPER}'", single=True)
    s, b = http("POST", "/api/auth/forgot-password/request-code", token=admin_token, body={"username": KEEPER})
    j4 = json.loads(b) if s == 200 else {}
    kcode = j4.get("code", "")
    check("D", f"إصدار رمز لـ keeper", s == 200 and re.fullmatch(r"\d{6}", kcode), f"s={s}")
    last_s = None
    wrong_codes = [f"7{str(i) * 5}" for i in range(5)]
    if kcode in wrong_codes:  # حماية تصادم نظرية (5/1000000) — فشل صامت غير مقبول
        check("D", "رمز keeper منفصل عن رموز المحاولات الخاطئة", False, f"kcode={kcode}")
    for i, wrong in enumerate(wrong_codes):
        last_s, last_b = http("POST", "/api/auth/forgot-password/reset",
                              body={"username": KEEPER, "code": wrong, "new_password": "NeverChanges2026"})
        if i < 4:
            check("D", f"المحاولة {i+1}/5 خاطئة → 401", last_s == 401, f"s={last_s}")
    check("D", "المحاولة 5/5 → 429 (قفل)", last_s == 429, f"s={last_s}")
    s, b = http("POST", "/api/auth/forgot-password/reset",
                body={"username": KEEPER, "code": kcode, "new_password": "NeverChanges2026"})
    check("D", "الرمز الصحيح مرفوض بعد القفل → 429", s == 429, f"s={s}")
    keeper_hash_after = sql(f"SELECT password FROM users WHERE username = '{KEEPER}'", single=True)
    check("D", "كلمة مرور keeper لم تتغير إطلاقاً", keeper_hash_after == keeper_hash_before)

    # ─── [U] التوصيل الواجهي ───
    print("\n[U] التوصيل الواجهي — روابط ونوافذ وأزرار")
    app_html = open(os.path.join(ROOT, "frontend", "app", "index.html"), encoding="utf-8").read()
    pos_html = open(os.path.join(ROOT, "frontend", "app", "pos.html"), encoding="utf-8").read()
    app_js = open(os.path.join(ROOT, "frontend", "app", "js", "app.js"), encoding="utf-8").read()
    pos_js = open(os.path.join(ROOT, "frontend", "app", "js", "pos.js"), encoding="utf-8").read()
    check("U", "شاشة دخول النظام تحمل رابط «نسيت كلمة المرور؟»", "نسيت كلمة المرور؟" in app_html and "showForgotPasswordModal" in app_html)
    check("U", "شاشة دخول الكاشير تحمل الرابط + النافذة", "forgot-link" in pos_html and "forgot-password-modal" in pos_html)
    check("U", "الكاشير يملك زر تغيير كلمة المرور الطوعي", "change-password-btn" in pos_html and "change-password-modal" in pos_html)
    check("U", "لوحة المستخدمين تحمل زر إصدار الرمز", "issueResetCode" in app_js and "رمز استعادة لكلمة المرور" in app_js)
    check("U", "معالجات الاستعادة موصولة في app.js وpos.js", "submitForgotPassword" in app_js and "forgot-password/reset" in pos_js and "change-password" in pos_js)

    # ─── [Z] صفر بقايا ───
    print("\n[Z] صفر بقايا — استرجاع كامل + مطابقة اللقطة")
    sql("DELETE FROM pos_password_reset_codes")  # كل رموز التدقيق (لم يتبقَ رموز إنتاج)
    sql(f"DELETE FROM pos_refresh_tokens WHERE issued_at > '{audit_start_iso}'")
    # إعادة إدخال صفوف ما قبل التدقيق التي سحبتها الميزة نفسها (سحب جلسات الاستعادة)
    for row in pre_tokens_rows:
        parts = [p.strip() for p in row.split("|")]
        if len(parts) == 6:
            uid, thash, dev, ip, exp, iss = parts
            ip_sql = "NULL" if ip in ("", "NULL") else "'" + ip.replace("'", "") + "'"
            dev_sql = "'{}'::jsonb" if dev in ("", "NULL") else "'" + dev.replace("'", "") + "'::jsonb"
            sql(
                "INSERT INTO pos_refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at, issued_at) "
                f"SELECT {uid}, '{thash}', {dev_sql}, {ip_sql}, '{exp}', '{iss}' "
                f"WHERE NOT EXISTS (SELECT 1 FROM pos_refresh_tokens WHERE token_hash = '{thash}')"
            )
    after = snapshot()
    residue = {t: (baseline.get(t), after.get(t)) for t in SNAPSHOT_TABLES if baseline.get(t) != after.get(t)}
    check("Z", "مطابقة لقطة الجداول قبل/بعد (صفر بقايا بيانات)", not residue, f"فروق: {residue}")
    audit_rows = sql("SELECT count(*) FROM pos_audit_logs WHERE action IN ('PASSWORD_RESET_CODE_ISSUED','PASSWORD_SELF_RESET')", single=True)
    print(f"  [i] صفوف تدقيق append-only كأدلة عملية: {audit_rows} (إصدار/استعادة بفاعلين حقيقيين)")

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
