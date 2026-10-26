#!/usr/bin/env python3
"""
live_dept_panel_restore_audit.py — تدقيق حي لاستعادة dept-panel (Task 28-restored)
A مصادقة بأدوار حقيقية → B بوابة المسار الحية (401/403/200) → C بيانات اللوحة والنطاق
→ D طلب سالب (?dept=غير القسم) → E صفر بقايا (لا مصروفات اختبار)
"""
import json, sys, urllib.request, urllib.error

BASE = "http://localhost:5000/api"
results = []
def check(name, cond, detail=""):
    results.append((bool(cond), name, detail))
    print(("  ✓ " if cond else "  ✗ ") + name + (f" — {detail}" if detail else ""))

def req(method, path, token=None, expect_json=True, timeout=15):
    r = urllib.request.Request(BASE + path, method=method)
    if token: r.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
            return resp.status, (json.loads(body) if expect_json else body)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try: return e.code, json.loads(body)
        except Exception: return e.code, body
    except Exception as e:
        return 0, str(e)

print("A) مصادقة حقيقية")
tokens = {}
for user in ("admin", "chef", "head_salads", "head_fnb", "keeper"):
    st, body = req("POST", "/auth/login", expect_json=True) if False else (0, {})
    data = json.dumps({"username": user, "password": "Karim2026Demo"}).encode()
    r = urllib.request.Request(BASE + "/auth/login", data=data, method="POST",
                               headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            payload = json.loads(resp.read().decode())
            tokens[user] = payload.get("access_token")
            check(f"دخول {user}", resp.status == 200 and tokens[user], f"role={payload.get('user',{}).get('role')}")
    except urllib.error.HTTPError as e:
        check(f"دخول {user}", False, f"HTTP {e.code}")

print("B) بوابة المسار الحية")
st, _ = req("GET", "/warehouse/dept-panel")
check("المجهول مرفوض 401", st == 401, f"HTTP {st}")
st, body = req("GET", "/warehouse/dept-panel", tokens.get("keeper"))
check("أمين المخازن (خارج الأدوار) 403", st == 403, f"HTTP {st} {body.get('error','') if isinstance(body,dict) else ''}")
st, body = req("GET", "/warehouse/dept-panel", tokens.get("head_salads"))
check("head_salads يرى لوحة قسمه 200", st == 200, f"HTTP {st}")

print("C) بيانات اللوحة والنطاق")
st, body = req("GET", "/warehouse/dept-panel", tokens.get("head_salads"))
if st == 200 and isinstance(body, dict):
    check("scope مقفل على salads", body.get("scope", {}).get("deptCode") == "salads" and body.get("scope", {}).get("view") == "department")
    check("بيانات القسم حاضرة", (body.get("department") or {}).get("code") == "salads")
    check("تجميع المصروفات بحقولها", isinstance(body.get("expenses"), dict) and "total" in body["expenses"] and "bySource" in body["expenses"] and "skippedInvalid" in body["expenses"])
    check("إحصاء الأذونات حاضر", isinstance(body.get("dispatches"), dict) and "total" in body["dispatches"])
st, body = req("GET", "/warehouse/dept-panel", tokens.get("chef"))
if st == 200 and isinstance(body, dict):
    subs = sorted(s.get("code") for s in body.get("subDepartments", []))
    check("الشيف يرى المطبخ مع 7 أقسام فرعية", body.get("scope", {}).get("deptCode") == "kitchen" and subs == ["bakery","butcher","fnb","hot_kitchen","kstore","salads","sweets"], str(subs))
st, body = req("GET", "/warehouse/dept-panel?dept=sweets", tokens.get("admin"))
check("admin يطلب قسمًا بعينه 200", st == 200 and isinstance(body, dict) and (body.get("department") or {}).get("code") == "sweets", f"HTTP {st}")
st, body = req("GET", "/warehouse/dept-panel", tokens.get("head_fnb"))
check("head_fnb (الحساب المستعاد) يرى لوحة fnb", st == 200 and isinstance(body, dict) and body.get("scope", {}).get("deptCode") == "fnb", f"HTTP {st}")

print("D) الطلب السالب (لا IDOR)")
st, body = req("GET", "/warehouse/dept-panel?dept=fnb", tokens.get("head_salads"))
check("head_salads يطلب fnb → 403 DEPT_MISMATCH", st == 403 and (isinstance(body, dict) and body.get("error") == "DEPT_MISMATCH"), f"HTTP {st}")

print("E) صفر بقايا")
import subprocess, os
env = dict(os.environ)
env["PGPASSWORD"] = subprocess.check_output("grep '^DB_PASSWORD=' .env | cut -d= -f2-", shell=True, cwd="/home/z/my-project/karim-erp").decode().strip()
def psql(q):
    return subprocess.check_output(["./database/bin/bin/psql", "-h", "localhost", "-U", "postgres", "-d", "karim_erp", "-t", "-c", q],
                                   cwd="/home/z/my-project/karim-erp", env=env).decode().strip()
left = psql("SELECT COUNT(*) FROM expenses WHERE notes LIKE '%test-cleanup%' OR \"desc\" LIKE 'TEST%'")
check("لا مصروفات اختبار متبقية", left == "0", f"count={left}")
depts = psql("SELECT COUNT(*) FROM departments WHERE parent_code='kitchen'")
check("7 أقسام فرعية تحت المطبخ في القاعدة", depts == "7", f"count={depts}")

passed = sum(1 for ok, _, _ in results if ok)
print(f"\n═══ النتيجة: {passed}/{len(results)} ═══")
sys.exit(0 if passed == len(results) else 1)
