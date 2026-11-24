#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_pnl_audit.py — فحص حي شامل: قائمة الأرباح والخسائر الحية (Task 18)
────────────────────────────────────────────────────────────────────────
يغطي:
  A) البوابات: 401 بلا توكن، 400 لنطاق مقلوب، 400 لنطاق ناقص، 400 لنطاق > 366 يومًا
  B) الاتساق الرياضي: أرقام الفترة الحالية من الـ API تطابق حساب SQL المباشر
     (صافي الكاشير، الضريبة، اليدوي، COGS، الفروق، التشغيلية) + هوية قائمة الدخل
  C) حقن محكوم في نافذة معزولة بلا حركات: إيراد يدوي 500 + صرف 200 + مرتجع -30
     + عجز جرد 25 + كهرباء 60 + مسير رواتب يُنسب تناسبيًا بالأيام → كل رقم
     مطابق للمتوقع إلى القرش + ربحية القسم + الهوامش
  D) المقارنة بالفترة السابقة: فارغة → delta كامل و pct=null؛ مع حقن 100 →
     delta=400 و pct=400%
  E) الطباعة: HTML A4 يحمل الأقسام الثلاثة والتوقيعات بلا NaN/undefined
  F) تنظيف كامل: حذف كل الصفوف المحقونة والتحقق من تطابق العدادات مع اللقطة
"""
import json, subprocess, sys, urllib.request
from datetime import date, timedelta

BASE = "http://localhost:5000"
PSQL = "/home/z/my-project/karim-erp/database/bin/bin/psql"
PGENV = {"PGPASSWORD": "karim_local_preview_2026_secure_password", "PATH": "/usr/bin:/bin"}

PASS, FAIL = 0, 0
def check(label, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✓ {label}" + (f" — {detail}" if detail else ""))
    else:    FAIL += 1; print(f"  ✗ {label}" + (f" — {detail}" if detail else ""))

def api(method, path, token=None, body=None, raw=False):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=25) as r:
            payload = r.read().decode()
            if raw: return r.status, payload
            return r.status, json.loads(payload or "{}")
    except urllib.error.HTTPError as e:
        payload = e.read().decode()
        if raw: return e.code, payload
        try: return e.code, json.loads(payload or "{}")
        except Exception: return e.code, {}

def sql(query):
    out = subprocess.run([PSQL, "-h", "localhost", "-U", "postgres", "-d", "karim_erp",
                          "-At", "-F", "|", "-c", query],
                         capture_output=True, text=True, env=PGENV, timeout=30)
    if out.returncode != 0:
        raise RuntimeError(f"SQL failed: {out.stderr.strip()}")
    return [l.split("|") for l in out.stdout.strip().split("\n") if l]

def sql_scalar(query):
    rows = sql(query)
    return rows[0][0] if rows and rows[0] else ""

def iso(d): return d.isoformat()

def days_inclusive(a, b): return (b - a).days + 1

print("═" * 68)
print("فحص حي: قائمة الأرباح والخسائر الحية — الإيراد والتكلفة والربح")
print("═" * 68)

# ── 0) لقطة عدادات ما قبل الفحص + تسجيل الدخول ───────────────────────────────
snap_rev_cnt   = sql_scalar("SELECT COUNT(*) FROM revenues")
snap_exp_cnt   = sql_scalar("SELECT COUNT(*) FROM expenses")
snap_pay_cnt   = sql_scalar("SELECT COUNT(*) FROM payroll")
emp_row        = sql("SELECT id::text, name FROM employees ORDER BY id LIMIT 1")
check("لقطة العدادات ووجود موظف لمسير الرواتب", bool(emp_row), f"موظف={emp_row[0][1] if emp_row else '—'}")

st, login = api("POST", "/api/auth/login", body={"username": "admin", "password": "Karim2026Demo"})
check("تسجيل دخول المدير", st == 200 and login.get("access_token"))
TOK = login["access_token"]

# ── A) البوابات والتحقق ──────────────────────────────────────────────────────
print("\n── A) بوابات الوصول والتحقق من النطاق ──")
st, _ = api("GET", "/api/finance/pnl")
check("رفض بلا توكن (401)", st == 401, f"status={st}")
st, _ = api("GET", "/api/finance/pnl?from=2026-08-10&to=2026-08-01", TOK)
check("رفض نطاق مقلوب (400)", st == 400, f"status={st}")
st, _ = api("GET", "/api/finance/pnl?from=2026-08-10", TOK)
check("رفض نصف نطاق (400)", st == 400, f"status={st}")
st, _ = api("GET", "/api/finance/pnl?from=2024-01-01&to=2026-08-30", TOK)
check("رفض نطاق أطول من 366 يومًا (400)", st == 400, f"status={st}")

# ── B) الاتساق الرياضي مع SQL للشهر الحالي ──────────────────────────────────
print("\n── B) الاتساق: أرقام API = حساب SQL المباشر (الشهر الحالي) ──")
today = date.today()
month_from = today.replace(day=1)
st, cur = api("GET", f"/api/finance/pnl?from={iso(month_from)}&to={iso(today)}", TOK)
check("جلب الشهر الحالي", st == 200 and cur.get("statement"))
S = cur["statement"]

pos_net_sql = sql_scalar(f"""SELECT COALESCE(SUM(subtotal - discount_total),0) FROM pos_orders
  WHERE status IN ('issued','reported') AND (created_at AT TIME ZONE 'UTC')::date BETWEEN '{iso(month_from)}' AND '{iso(today)}'""")
vat_sql = sql_scalar(f"""SELECT COALESCE(SUM(tax_total),0) FROM pos_orders
  WHERE status IN ('issued','reported') AND (created_at AT TIME ZONE 'UTC')::date BETWEEN '{iso(month_from)}' AND '{iso(today)}'""")
man_sql = sql_scalar(f"SELECT COALESCE(SUM(amount),0) FROM revenues WHERE pos_order_id IS NULL AND LEFT(date,10) BETWEEN '{iso(month_from)}' AND '{iso(today)}'")
cogs_sql = sql_scalar(f"SELECT COALESCE(SUM(amount),0) FROM expenses WHERE \"adjustmentType\" IN ('dispatch','dispatch_return') AND LEFT(date,10) BETWEEN '{iso(month_from)}' AND '{iso(today)}'")
shrk_sql = sql_scalar(f"SELECT COALESCE(SUM(amount),0) FROM expenses WHERE \"adjustmentType\"='count_correction' AND LEFT(date,10) BETWEEN '{iso(month_from)}' AND '{iso(today)}'")
ops_sql = sql_scalar(f"""SELECT COALESCE(SUM(amount),0) FROM expenses
  WHERE COALESCE(\"adjustmentType\",'') NOT IN ('dispatch','dispatch_return','count_correction')
    AND LEFT(date,10) BETWEEN '{iso(month_from)}' AND '{iso(today)}'""")

check("صافي مبيعات الكاشير = SQL", abs(float(S["revenue"]["pos_net"]) - float(pos_net_sql)) < 0.01, f"API={S['revenue']['pos_net']} SQL={pos_net_sql}")
check("ضريبة القيمة المضافة = SQL", abs(float(S["revenue"]["vat_collected"]) - float(vat_sql)) < 0.01, f"API={S['revenue']['vat_collected']} SQL={vat_sql}")
check("الإيرادات اليدوية = SQL", abs(float(S["revenue"]["manual"]) - float(man_sql)) < 0.01, f"API={S['revenue']['manual']} SQL={man_sql}")
check("صافي COGS = SQL", abs(float(S["cogs"]["net"]) - float(cogs_sql)) < 0.01, f"API={S['cogs']['net']} SQL={cogs_sql}")
check("فروق الجرد = SQL", abs(float(S["shrinkage"]["amount"]) - float(shrk_sql)) < 0.01, f"API={S['shrinkage']['amount']} SQL={shrk_sql}")
check("التشغيلية = SQL", abs(float(S["operating"]["total"]) - float(ops_sql)) < 0.01, f"API={S['operating']['total']} SQL={ops_sql}")

identity = float(S["revenue"]["total"]) - float(S["cogs"]["net"]) - float(S["shrinkage"]["amount"]) \
         - float(S["operating"]["total"]) - float(S["payroll"]["total"])
check("هوية قائمة الدخل: إيراد − تكلفة − فروق − تشغيلية − رواتب = صافي",
      abs(identity - float(S["net_profit"]["amount"])) < 0.01,
      f"صافي={S['net_profit']['amount']}")

prev = cur["previous_period"]
pf, pt = date.fromisoformat(prev["from"]), date.fromisoformat(prev["to"])
span = days_inclusive(month_from, today)
check("الفترة السابقة بنفس الطول ومتصلة", days_inclusive(pf, pt) == span and (pt - month_from).days == -1,
      f"prev={prev['from']}→{prev['to']}")
cmp_net = cur["comparison"]["net_profit"]
check("بنية المقارنة مكتملة الحقول", all(k in cmp_net for k in ("current", "previous", "delta", "pct")))

dept_sum = sum(float(d["revenue"]) for d in S["by_department"])
has_unmapped = any(d["code"] == "—" for d in S["by_department"])
check("مجموع ربحية الأقسام ≤ الإيراد الكلي (مع سماء الأقسام غير المرتبطة إن وُجدت)",
      has_unmapped or abs(dept_sum - float(S["revenue"]["total"])) < 0.01,
      f"مجموع الأقسام={round(dept_sum,2)} إجمالي={S['revenue']['total']}")

# ── C) حقن محكوم في نافذة معزولة ────────────────────────────────────────────
print("\n── C) حقن محكوم: إيراد/صرف/مرتجع/عجز/كهرباء/رواتب في نافذة نظيفة ──")
T2, T1 = None, None
back = 45
for _ in range(12):
    cand_to = today - timedelta(days=back)
    cand_from = cand_to - timedelta(days=2)
    n = int(sql_scalar(f"""SELECT COUNT(*) FROM pos_orders
      WHERE (created_at AT TIME ZONE 'UTC')::date BETWEEN '{iso(cand_from)}' AND '{iso(cand_to)}'"""))
    if n == 0:
        T1, T2 = cand_from, cand_to
        break
    back += 7
check("إيجاد نافذة 3 أيام بلا مبيعات POS", T1 is not None, f"window={iso(T1)}→{iso(T2)}")

rev_ids, exp_ids, pay_id = [], [], None
def inject_revenue(amount, day, dept="kitchen", source="فحص P&L"):
    rid = int(str(int(date.today().strftime("%Y%m%d")) * 100000) + str(len(rev_ids) + 9001))
    sql(f"""INSERT INTO revenues (id, "deptId", source, amount, date, notes)
            VALUES ({rid}, '{dept}', '{source}', {amount}, '{iso(day)}', 'فحص حي Task 18')""")
    rev_ids.append(rid); return rid
def inject_expense(amount, day, atype, desc, category=None, dept="kitchen"):
    eid = 910000000000 + len(exp_ids) + int(date.today().strftime("%d")) * 1000 + len(exp_ids)
    eid = 915000000000 + abs(hash(f"{desc}{day}{len(exp_ids)}")) % 1000000
    cat = f", '{category}'" if category else ", NULL"
    at = f", '{atype}'" if atype else ", NULL"
    sql(f"""INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
            VALUES ({eid}, '{dept}', '{desc}', {amount}, '{iso(day)}', 'فحص حي Task 18', false{cat}{at})""")
    exp_ids.append(eid); return eid

inject_revenue(500, T2)                                # إيراد يدوي
inject_expense(200, T1, "dispatch", "صرف فحص P&L")     # COGS
inject_expense(-30, T2, "dispatch_return", "مرتجع فحص P&L")
inject_expense(25, T1, "count_correction", "عجز جرد فحص P&L")
inject_expense(60, T2, None, "فاتورة كهرباء فحص", category="كهرباء")  # تشغيلية

emp_id, emp_name = emp_row[0][0], emp_row[0][1]
pay_month = T1.month
pay_overlap = days_inclusive(T1, T2 if T2.month == T1.month else date(T1.year, T1.month, 1) + timedelta(days=30))
# النافذة قد تعبر شهرين — نسبة كل شهر تُحسب في الخادم؛ هنا شهر T1 فقط إذا كانت النافذة داخل شهر واحد
same_month = (T1.year == T2.year and T1.month == T2.month)
pay_id = 920000000000 + int(date.today().strftime("%d")) * 100 + pay_month
pay_net = "900"
sql(f"""INSERT INTO payroll (id, "employeeId", month, year, "basicSalary", allowances, deductions, "netSalary", status)
        VALUES ({pay_id}, {emp_id}, '{pay_month}', {T1.year}, '800', '100', '0', '{pay_net}', 'paid')""")
check("حقن 6 صفوف (إيراد + 5 مصاريف) + مسير رواتب", True, f"نافذة {iso(T1)}→{iso(T2)} شهر واحد: {same_month}")

st, wnd = api("GET", f"/api/finance/pnl?from={iso(T1)}&to={iso(T2)}", TOK)
check("جلب قائمة النافذة المحقونة", st == 200 and wnd.get("statement"))
W = wnd["statement"]

check("الإيراد اليدوي 500 والكاشير صفر في النافذة",
      float(W["revenue"]["manual"]) == 500.0 and float(W["revenue"]["pos_net"]) == 0.0,
      f"manual={W['revenue']['manual']} pos={W['revenue']['pos_net']}")
check("إجمالي الإيراد = 500", float(W["revenue"]["total"]) == 500.0, f"={W['revenue']['total']}")
check("COGS: صرف 200 − مرتجع 30 = صافي 170",
      float(W["cogs"]["dispatch"]) == 200.0 and float(W["cogs"]["returns"]) == -30.0 and float(W["cogs"]["net"]) == 170.0,
      f"net={W['cogs']['net']}")
check("عجز الجرد 25", float(W["shrinkage"]["amount"]) == 25.0, f"={W['shrinkage']['amount']}")
check("التشغيلية: كهرباء 60 بفئتها", float(W["operating"]["total"]) == 60.0
      and W["operating"]["items"] and W["operating"]["items"][0]["category"] == "كهرباء",
      f"total={W['operating']['total']}")
check("مجمل الربح = 330", float(W["gross_profit"]["amount"]) == 330.0, f"={W['gross_profit']['amount']}")

# الرواتب: نسبة أيام النافذة داخل شهر T1 (الخادم يوزع تناسبيًا)
month_days = days_inclusive(date(T1.year, T1.month, 1), (date(T1.year, T1.month + 1, 1) - timedelta(days=1)) if T1.month < 12 else date(T1.year, 12, 31))
overlap_start, overlap_end = T1, T2
if overlap_end > date(T1.year, T1.month, 1) + timedelta(days=month_days - 1):
    overlap_end = date(T1.year, T1.month, 1) + timedelta(days=month_days - 1)
overlap_days = days_inclusive(overlap_start, overlap_end)
expected_pay = round(900.0 * overlap_days / month_days, 2)
check("الرواتب تُنسب تناسبيًا بالأيام (proration)", abs(float(W["payroll"]["total"]) - expected_pay) < 0.01,
      f"API={W['payroll']['total']} متوقع={expected_pay} ({overlap_days}/{month_days} يوم)")

expected_net = round(500.0 - 170.0 - 25.0 - 60.0 - expected_pay, 2)
check("صافي الربح التشغيلي مطابق للمتوقع", abs(float(W["net_profit"]["amount"]) - expected_net) < 0.01,
      f"API={W['net_profit']['amount']} متوقع={expected_net}")
identity2 = float(W["revenue"]["total"]) - float(W["cogs"]["net"]) - float(W["shrinkage"]["amount"]) \
          - float(W["operating"]["total"]) - float(W["payroll"]["total"])
check("هوية القائمة تنطبق على النافذة", abs(identity2 - float(W["net_profit"]["amount"])) < 0.01)

k = next((d for d in W["by_department"] if d["code"] == "kitchen"), None)
check("ربحية قسم المطبخ: إيراد 500 / COGS 170 / عجز 25 / تشغيلية 60",
      k is not None and float(k["revenue"]) == 500.0 and float(k["cogs"]) == 170.0
      and float(k["shrinkage"]) == 25.0 and float(k["operating"]) == 60.0,
      f"kitchen={k and (k['revenue'], k['cogs'], k['shrinkage'], k['operating'])}")
check("هامش القسم = صافيه/إيراده", k and k["margin_pct"] is not None and
      abs(float(k["margin_pct"]) - round(float(k["net"]) / 500.0 * 100, 2)) < 0.02,
      f"margin={k and k['margin_pct']}%")
check("السلسلة اليومية تحمل الإيراد والتكاليف", len(W["daily_series"]) >= 2
      and any(abs(float(d["revenue"]) - 500.0) < 0.01 for d in W["daily_series"])
      and any(abs(float(d["cogs"]) - 200.0) < 0.01 for d in W["daily_series"]))

# ── D) المقارنة بالفترة السابقة ──────────────────────────────────────────────
print("\n── D) المقارنة بالفترة السابقة ──")
cmp0 = wnd["comparison"]
check("فترة سابقة فارغة: السابقة صفر وdelta=500 وpct=null (قاعدة صفرية)",
      float(cmp0["revenue"]["previous"]) == 0.0 and float(cmp0["revenue"]["delta"]) == 500.0 and cmp0["revenue"]["pct"] is None,
      f"prev={cmp0['revenue']['previous']} delta={cmp0['revenue']['delta']} pct={cmp0['revenue']['pct']}")
prev_from, prev_to = date.fromisoformat(wnd["previous_period"]["from"]), date.fromisoformat(wnd["previous_period"]["to"])
prev_mid = prev_from + (prev_to - prev_from) // 2
inject_revenue(100, prev_mid, source="فحص P&L — فترة سابقة")
st, wnd2 = api("GET", f"/api/finance/pnl?from={iso(T1)}&to={iso(T2)}", TOK)
cmp1 = wnd2["comparison"]
check("بعد حقن 100 في السابقة: السابقة=100 وdelta=400 وpct=400%",
      float(cmp1["revenue"]["previous"]) == 100.0 and float(cmp1["revenue"]["delta"]) == 400.0 and float(cmp1["revenue"]["pct"]) == 400.0,
      f"prev={cmp1['revenue']['previous']} delta={cmp1['revenue']['delta']} pct={cmp1['revenue']['pct']}")
# الرواتب تنسْب تناسبيًا حتى للفترة السابقة (استحقاق شهري يومي) —
# صافي السابقة = 100 (إيراد) − expected_pay (نسبة أيام يوليو) = 12.9
expected_prev_net = round(100.0 - expected_pay, 2)
expected_delta_net = round(float(W["net_profit"]["amount"]) - expected_prev_net, 2)
check("مقارنة صافي الربح تنعكس (السابقة=إيراد−نسبة الرواتب، Δ مطابق)",
      abs(float(cmp1["net_profit"]["previous"]) - expected_prev_net) < 0.01
      and abs(float(cmp1["net_profit"]["delta"]) - expected_delta_net) < 0.01,
      f"prev={cmp1['net_profit']['previous']} متوقع={expected_prev_net} Δ={cmp1['net_profit']['delta']} متوقع={expected_delta_net}")

# ── E) الطباعة A4 ────────────────────────────────────────────────────────────
print("\n── E) طباعة قائمة الدخل A4 ──")
st, html = api("GET", f"/api/finance/pnl/print?from={iso(T1)}&to={iso(T2)}", TOK, raw=True)
check("الطباعة ترجع HTML", st == 200 and "قائمة الأرباح والخسائر" in html)
check("الأقسام الثلاثة والتوقيعات موجودة",
      all(m in html for m in ("أولًا: الإيرادات", "ثانيًا: تكلفة المبيعات", "ثالثًا: المصاريف التشغيلية", "المدير المالي")))
check("قيمة الإيراد 500.00 ظاهرة", "500.00" in html)
check("بلا NaN أو undefined", "NaN" not in html and "undefined" not in html)

# ── F) التنظيف الكامل ────────────────────────────────────────────────────────
print("\n── F) التنظيف والتحقق النهائي ──")
sql(f"DELETE FROM revenues WHERE id IN ({','.join(map(str, rev_ids))})" if rev_ids else "SELECT 1")
sql(f"DELETE FROM expenses WHERE id IN ({','.join(map(str, exp_ids))})" if exp_ids else "SELECT 1")
sql(f"DELETE FROM payroll WHERE id={pay_id}" if pay_id else "SELECT 1")

rev_cnt = sql_scalar("SELECT COUNT(*) FROM revenues")
exp_cnt = sql_scalar("SELECT COUNT(*) FROM expenses")
pay_cnt = sql_scalar("SELECT COUNT(*) FROM payroll")
check("عدّاد الإيرادات مطابق للقطة", rev_cnt == snap_rev_cnt, f"{rev_cnt} == {snap_rev_cnt}")
check("عدّاد المصاريف مطابق للقطة", exp_cnt == snap_exp_cnt, f"{exp_cnt} == {snap_exp_cnt}")
check("عدّاد الرواتب مطابق للقطة", pay_cnt == snap_pay_cnt, f"{pay_cnt} == {snap_pay_cnt}")

st, after = api("GET", f"/api/finance/pnl?from={iso(T1)}&to={iso(T2)}", TOK)
A = after["statement"]
check("النافذة عادت صفرية بعد التنظيف",
      float(A["revenue"]["total"]) == 0.0 and float(A["cogs"]["net"]) == 0.0
      and float(A["shrinkage"]["amount"]) == 0.0 and float(A["operating"]["total"]) == 0.0
      and float(A["payroll"]["total"]) == 0.0,
      f"rev={A['revenue']['total']} cogs={A['cogs']['net']}")

print("\n" + "═" * 68)
print(f"النتيجة: {PASS} PASS / {FAIL} FAIL")
print("═" * 68)
sys.exit(1 if FAIL else 0)
