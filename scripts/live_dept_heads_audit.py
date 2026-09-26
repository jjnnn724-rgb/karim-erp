#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
live_dept_heads_audit.py — فحص حي شامل لسلسلة اعتماد طلبات الصرف (Task 19)
═══════════════════════════════════════════════════════════════════════════
رئيس القسم ينشئ طلب صرف → الشيف العمومي يعتمده → المخازن تصرف وتخصم
(مصروف قسم تلقائي) → القسم يستلم في مخزنه الخاص → إرجاع جزئي عكسي.
"""
import json
import subprocess
import sys
import urllib.request
import urllib.error

BASE = 'http://localhost:5000'
PSQL = ['/home/z/my-project/karim-erp/database/bin/bin/psql', '-h', '127.0.0.1',
        '-U', 'postgres', '-d', 'karim_erp', '-tAc']
PGPASSWORD = 'karim_local_preview_2026_secure_password'
SIG = ('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMA'
       'AQAABQABDQottAAAAABJRU5ErkJggg==')  # 1px valid png data-url

results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    mark = 'PASS' if ok else 'FAIL'
    print(f'[{mark}] {name}' + (f' — {detail}' if detail else ''))


def psql(sql):
    env = {'PGPASSWORD': PGPASSWORD, 'PATH': '/usr/bin:/bin'}
    out = subprocess.run(PSQL + [sql], capture_output=True, text=True, env=env, timeout=30)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip())
    return out.stdout.strip()


def req(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header('Content-Type', 'application/json')
    if token:
        r.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or '{}')
        except Exception:
            return e.code, {}


def login(username, password='Karim2026Demo'):
    return req('POST', '/api/auth/login', body={'username': username, 'password': password})


# ─── لقطة ما قبل الفحص ───
SNAP_INV = "SELECT id, name, qty, \"avgCost\" FROM inventory ORDER BY id"
SNAP_BAL = "SELECT inventory_id, location_id, on_hand FROM inventory_location_balances ORDER BY 1,2"
snapshot = {
    'inventory': psql(SNAP_INV),
    'balances': psql(SNAP_BAL),
    'dispatches_max': psql('SELECT COALESCE(MAX(id),0) FROM dispatches'),
    'expenses_max': psql('SELECT COALESCE(MAX(id),0) FROM expenses'),
    'tx_max': psql('SELECT COALESCE(MAX(id),0) FROM "inventoryTx"'),
    'returns_max': psql('SELECT COALESCE(MAX(id),0) FROM "kitchenReturns"'),
    'ledger_max': psql('SELECT COUNT(*) FROM inventory_ledger'),
    'notifications_max': psql('SELECT COALESCE(MAX(id),0) FROM notifications'),
    'stores_before': psql("SELECT code FROM inventory_locations ORDER BY code"),
    'salads_expenses': psql("SELECT COUNT(*) FROM expenses WHERE \"deptId\"='salads'"),
}
print('== Snapshot taken ==')

# ═══ A) المصادقة والأدوار ═══
print('\n== A) المصادقة والأدوار ==')
s, adm = login('admin')
check('A1 دخول المدير', s == 200 and adm.get('access_token'), str(s))
ADMIN = adm.get('access_token')

s, chef = login('chef')
check('A2 دخول الشيف العمومي (chef)', s == 200 and chef.get('access_token'))
check('A3 دور الشيف kitchen والاسم "الشيف العمومي"',
      chef.get('user', {}).get('role') == 'kitchen' and chef.get('user', {}).get('name') == 'الشيف العمومي')
CHEF = chef.get('access_token')

heads = {}
for u, dept in [('head_salads', 'salads'), ('head_sweets', 'sweets'), ('head_bakery', 'bakery'),
                ('head_hot_kitchen', 'hot_kitchen'), ('head_external', 'external_sales')]:
    s, data = login(u)
    ok = s == 200 and data.get('access_token') and data.get('user', {}).get('dept_code') == dept \
        and data.get('user', {}).get('role') == 'dept_head'
    check(f'A4 حساب {u} (dept_head مرتبط بـ {dept})', ok)
    heads[dept] = data.get('access_token')
SALADS = heads['salads']

s, bad = login('head_salads', 'WrongPassword123!')
check('A5 كلمة مرور خاطئة مرفوضة', s == 401)

# ═══ B) حماية إنشاء الطلبات ═══
print('\n== B) حماية إنشاء الطلبات ==')
s, r = req('POST', '/api/dispatches', SALADS, {
    'deptCode': 'sweets', 'deptName': 'قسم الحلواني',
    'items': [{'itemName': 'ارز', 'qty': 5, 'unit': 'كيلوجرام'}], 'date': '2026-09-02'})
check('B1 رئيس السلطات لا ينشئ طلبًا لقسم الحلواني (403 DEPT_MISMATCH)',
      s == 403 and r.get('error') == 'DEPT_MISMATCH', f'{s} {r.get("error", "")}')

s, r = req('POST', '/api/dispatches', SALADS, {
    'deptCode': 'nonexistent_dept', 'items': [{'itemName': 'ارز', 'qty': 5}], 'date': '2026-09-02'})
check('B2 قسم غير قسمه (وإن كان وهميًا) مرفوض 403', s == 403, f'{s}')

s, r = req('POST', '/api/dispatches', CHEF, {
    'deptCode': 'salads', 'deptName': 'x', 'items': [{'itemName': 'ارز', 'qty': 1}],
    'needsChefApproval': True, 'status': 'approved', 'chefApprovedBy': 'hacker', 'date': '2026-09-02'})
check('B3 حقول سلسلة الاعتماد لا تُقبل عبر CRUD العام',
      s == 400 and r.get('error') in ('WORKFLOW_FIELDS_FORBIDDEN', 'INVALID_PAYLOAD'), f'{s} {r.get("error", "")}')

s, r = req('POST', '/api/dispatches', CHEF, {
    'deptCode': 'salads', 'deptName': 'قسم السلطات',
    'items': [{'itemName': 'ارز', 'qty': 4, 'unit': 'كيلوجرام'}],
    'notes': 'طلب مباشر من الشيف', 'date': '2026-09-02'})
check('B4 الشيف العمومي ينشئ طلبًا مباشرًا (بلا بوابة شيف — منشئ موثوق)', s == 201, f'{s}')
chef_dispatch_id = r.get('id')
check('B4b طلب الشيف بلا needsChefApproval', r.get('needsChefApproval') is False)

s, r = req('POST', '/api/dispatches', SALADS, {
    'items': [{'itemName': 'ارز', 'qty': 25, 'unit': 'كيلوجرام'},
              {'itemName': 'دجاج', 'qty': 10, 'unit': 'حبه دجاج'}],
    'notes': 'احتياج أسبوعي — سلطات', 'date': '2026-09-02'})
check('B5 رئيس السلطات ينشئ طلب صرف لقسمه (201) حتى بلا deptCode في الجسم', s == 201, f'{s}')
DISPATCH_ID = r.get('id')
check('B6 الطلب موسوم needsChefApproval=true و creatorRole=dept_head و deptCode=salads',
      r.get('needsChefApproval') is True and r.get('creatorRole') == 'dept_head' and r.get('deptCode') == 'salads')
check('B7 deptName جاء من جدول الأقسام (قسم السلطات)', r.get('deptName') == 'قسم السلطات')

# ═══ C) بوابة الاعتماد قبل الشيف ═══
print('\n== C) بوابة الاعتماد ==')
s, r = req('POST', f'/api/warehouse/dispatches/{DISPATCH_ID}/approve', ADMIN, {
    'signatureData': SIG, 'approveNotes': 'محاولة تخطي الشيف'})
check('C1 المخازن ممنوعة من الاعتماد قبل الشيف (409 CHEF_APPROVAL_REQUIRED)',
      s == 409 and r.get('error') == 'CHEF_APPROVAL_REQUIRED', f'{s}')

s, r = req('POST', f'/api/warehouse/dispatches/{DISPATCH_ID}/reject', ADMIN, {
    'signatureData': SIG, 'reason': 'محاولة رفض مخازن قبل الشيف'})
check('C2 رفض المخازن قبل الشيف مرفوض', s == 409 and r.get('error') == 'CHEF_APPROVAL_REQUIRED', f'{s}')

s, r = req('POST', f'/api/warehouse/dispatches/{DISPATCH_ID}/chef-approve', SALADS, {'signatureData': SIG})
check('C3 رئيس القسم لا يعتمد بدل الشيف (403)', s == 403, f'{s}')

s, r = req('POST', f'/api/warehouse/dispatches/{chef_dispatch_id}/chef-approve', CHEF, {'signatureData': SIG})
check('C4 الشيف لا يعتمد طلبًا لا يحتاج اعتماده (409 CHEF_APPROVAL_NOT_REQUIRED)',
      s == 409 and r.get('error') == 'CHEF_APPROVAL_NOT_REQUIRED', f'{s}')

s, r = req('POST', f'/api/warehouse/dispatches/{DISPATCH_ID}/chef-approve', CHEF, {})
check('C5 اعتماد الشيف بلا توقيع مرفوض 422', s == 422, f'{s}')

# ═══ D) اعتماد الشيف العمومي ═══
print('\n== D) اعتماد الشيف العمومي ==')
qty_arz_before = float(psql("SELECT qty FROM inventory WHERE name='ارز'"))
qty_djaj_before = float(psql("SELECT qty FROM inventory WHERE name='دجاج'"))

s, r = req('POST', f'/api/warehouse/dispatches/{DISPATCH_ID}/chef-approve', CHEF, {
    'signatureData': SIG, 'notes': 'معتمد — احتياج مشروع'})
check('D1 الشيف يعتمد الطلب (status=chef_approved)',
      s == 200 and r.get('dispatch', {}).get('status') == 'chef_approved', f'{s}')
check('D2 chefApprovedBy بالاسم العربي', r.get('dispatch', {}).get('chefApprovedBy') == 'الشيف العمومي')
check('D3 لا خصم مخزني عند اعتماد الشيف',
      abs(float(psql("SELECT qty FROM inventory WHERE name='ارز'")) - qty_arz_before) < 1e-9)

s, r = req('POST', f'/api/warehouse/dispatches/{DISPATCH_ID}/chef-approve', CHEF, {'signatureData': SIG})
check('D4 إعادة اعتماد الشيف مرفوضة (409 DISPATCH_NOT_PENDING)',
      s == 409 and r.get('error') == 'DISPATCH_NOT_PENDING', f'{s}')

# ═══ E) صرف المخازن (خصم + مصروف تلقائي) ═══
print('\n== E) صرف المخازن ==')
s, r = req('POST', f'/api/warehouse/dispatches/{DISPATCH_ID}/approve', ADMIN, {
    'approvedItems': [
        {'itemName': 'ارز', 'unit': 'كيلوجرام', 'requestedQty': 25, 'approvedQty': 20, 'avgCost': 12.0},
        {'itemName': 'دجاج', 'unit': 'حبه دجاج', 'requestedQty': 10, 'approvedQty': 10, 'avgCost': 11.7}],
    'approveNotes': 'صرف جزئي للأرز', 'signatureData': SIG})
check('E1 المخازن تعتمد بعد الشيف (status=approved)',
      s == 200 and r.get('dispatch', {}).get('status') == 'approved', f'{s}')
check('E2 خصم الأرز 20 من المخزون العام',
      abs(float(psql("SELECT qty FROM inventory WHERE name='ارز'")) - (qty_arz_before - 20)) < 1e-6)
check('E3 خصم الدجاج 10',
      abs(float(psql("SELECT qty FROM inventory WHERE name='دجاج'")) - (qty_djaj_before - 10)) < 1e-6)
salads_exp_total = float(psql("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE \"deptId\"='salads'"))
check('E4 مصروف تلقائي 240+117=357 على قسم salads', abs(salads_exp_total - 357) < 0.01, str(salads_exp_total))
check('E5 بندان autoGenerated من نوع dispatch',
      psql("SELECT COUNT(*) FROM expenses WHERE \"deptId\"='salads' AND \"adjustmentType\"='dispatch' AND \"autoGenerated\"") == '2')

s, r = req('POST', f'/api/warehouse/dispatches/{DISPATCH_ID}/approve', ADMIN, {'signatureData': SIG})
check('E6 الاعتماد المزدوج مرفوض (409 DISPATCH_ALREADY_APPROVED)',
      s == 409 and r.get('error') == 'DISPATCH_ALREADY_APPROVED', f'{s}')

# ═══ F) الاستلام في مخزن القسم الخاص ═══
print('\n== F) الاستلام في مخزن القسم ==')
s, r = req('POST', f'/api/warehouse/dispatches/{DISPATCH_ID}/receive', SALADS, {'signatureData': SIG})
check('F1 رئيس القسم لا يسجل الاستلام (403 — الاستلام للشيف/الإدارة)', s == 403, f'{s}')

s, r = req('POST', f'/api/warehouse/dispatches/{DISPATCH_ID}/receive', CHEF, {
    'items': [{'itemName': 'ارز', 'receivedQty': 20}, {'itemName': 'دجاج', 'receivedQty': 8}],
    'notes': 'عجز 2 دجاج عند الاستلام', 'signatureData': SIG})
check('F2 الشيف يستلم (partially_received: دجاج 8 من 10)',
      s == 200 and r.get('dispatch', {}).get('status') == 'partially_received', f'{s}')

check('F3 مخزن القسم STORE-SALADS أُنشئ مرتبطًا بقسم salads',
      psql("SELECT dept_code FROM inventory_locations WHERE code='STORE-SALADS'") == 'salads')
bal = psql("SELECT b.on_hand FROM inventory_location_balances b JOIN inventory_locations l ON l.id=b.location_id "
           "JOIN inventory i ON i.id=b.inventory_id WHERE l.code='STORE-SALADS' AND i.name='ارز'")
check('F4 رصيد الأرز في مخزن السلطات = 20', abs(float(bal) - 20) < 1e-6, bal)
bal2 = psql("SELECT b.on_hand FROM inventory_location_balances b JOIN inventory_locations l ON l.id=b.location_id "
            "JOIN inventory i ON i.id=b.inventory_id WHERE l.code='STORE-SALADS' AND i.name='دجاج'")
check('F5 رصيد الدجاج في مخزن السلطات = 8', abs(float(bal2) - 8) < 1e-6, bal2)

# ═══ G) إرجاع جزئي من مخزن القسم ═══
print('\n== G) إرجاع جزئي ==')
s, r = req('POST', '/api/warehouse/returns', ADMIN, {
    'dispatchId': str(DISPATCH_ID),
    'items': [{'itemName': 'ارز', 'qty': 5}],
    'reason': 'فائض عن حاجة القسم', 'notes': 'إرجاع جزئي'})
check('G1 إرجاع 5 أرز للمخزن الرئيسي (201)', s == 201, f'{s}')
check('G2 قيدان مقترنان للإرجاع (transfer_out + return)',
      psql("SELECT COUNT(*) FROM inventory_ledger WHERE reference_type='kitchen_return' "
           f"AND reference_id='{DISPATCH_ID}' AND transaction_type IN ('transfer_out','return')") == '2')
bal_after = float(psql("SELECT b.on_hand FROM inventory_location_balances b JOIN inventory_locations l ON l.id=b.location_id "
                       "JOIN inventory i ON i.id=b.inventory_id WHERE l.code='STORE-SALADS' AND i.name='ارز'"))
check('G3 رصيد الأرز بمخزن السلطات انخفض إلى 15 (لا ازدواج)', abs(bal_after - 15) < 1e-6, bal_after)
check('G4 عكس مصروف سالب -60 على salads (dispatch_return)',
      float(psql("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE \"deptId\"='salads' AND \"adjustmentType\"='dispatch_return'")) == -60.0)

# ═══ H) سلسلة الأحداث الموثقة ═══
print('\n== H) سلسلة الأحداث ==')
events = psql(f'SELECT event_type FROM dispatch_workflow_events WHERE dispatch_id={DISPATCH_ID} ORDER BY id').split('\n')
check('H1 الأحداث بالترتيب: chef_approved ← warehouse_approved ← kitchen_received',
      events == ['chef_approved', 'warehouse_approved', 'kitchen_received'], str(events))
signed = psql(f"SELECT COUNT(*) FROM dispatch_workflow_events WHERE dispatch_id={DISPATCH_ID} "
              "AND signature_hash IS NOT NULL AND event_hash IS NOT NULL AND previous_event_hash IS NOT NULL")
check('H2 أحداث الشيف والاعتماد موقعة ومربعة بالسلسلة (hash+prev)', signed == '2', signed)

# ═══ I) رفض الشيف الموثق + اتساق الأقسام ═══
print('\n== I) رفض الشيف واتساق الأقسام ==')
s, r = req('POST', '/api/dispatches', heads['sweets'], {
    'items': [{'itemName': 'ارز', 'qty': 2}], 'date': '2026-09-02'})
check('I1 رئيس الحلواني ينشئ طلبًا لقسمه', s == 201, f'{s}')
SWEETS_ID = r.get('id')
s, r = req('POST', f'/api/warehouse/dispatches/{SWEETS_ID}/chef-reject', CHEF, {
    'reason': 'الكمية غير مناسبة لاحتياج القسم', 'signatureData': SIG})
check('I2 الشيف يرفض برفض موثق (rejected)', s == 200 and r.get('dispatch', {}).get('status') == 'rejected', f'{s}')
check('I3 سبب الرفض محفوظ',
      psql(f'SELECT "rejectionReason" FROM dispatches WHERE id={SWEETS_ID}') == 'الكمية غير مناسبة لاحتياج القسم')
check('I4 chefRejectedBy = الشيف العمومي',
      psql(f'SELECT "chefRejectedBy" FROM dispatches WHERE id={SWEETS_ID}') == 'الشيف العمومي')

check('I5 الأقسام الخمسة في POS بخريطة legacy صحيحة',
      psql("SELECT COUNT(*) FROM pos_departments WHERE legacy_dept_code IN "
           "('salads','sweets','bakery','hot_kitchen','external_sales') AND is_active") == '5')
check('I6 الأقسام الخمسة في جدول departments',
      psql("SELECT COUNT(*) FROM departments WHERE code IN "
           "('salads','sweets','bakery','hot_kitchen','external_sales')") == '5')

s, r = req('POST', f'/api/warehouse/dispatches/{SWEETS_ID}/approve', ADMIN, {'signatureData': SIG})
check('I7 المخازن لا تعتمد طلبًا مرفوضًا من الشيف (409 DISPATCH_REJECTED)',
      s == 409 and r.get('error') == 'DISPATCH_REJECTED', f'{s}')

# ═══ J) التنظيف ═══
print('\n== J) التنظيف ==')
for disp_id in [x for x in (DISPATCH_ID, SWEETS_ID, chef_dispatch_id) if x]:
    psql(f'DELETE FROM dispatch_workflow_events WHERE dispatch_id={disp_id}')
    psql(f'DELETE FROM expenses WHERE notes LIKE \'%#{disp_id}%\'')
    psql(f'DELETE FROM "inventoryTx" WHERE "dispatchId"=\'DIS-{disp_id}\'')
    psql(f'DELETE FROM "kitchenReturns" WHERE "dispatchId"=\'{disp_id}\'')
    psql(f"DELETE FROM inventory_ledger WHERE (reference_type='dispatch' AND reference_id='DIS-{disp_id}') "
         f"OR (reference_type='dispatch_receipt' AND reference_id='{disp_id}') "
         f"OR (reference_type='kitchen_return' AND reference_id='{disp_id}')")
    psql(f'DELETE FROM dispatches WHERE id={disp_id}')

psql(f'DELETE FROM notifications WHERE id > {snapshot["notifications_max"]}')
psql(f'DELETE FROM expenses WHERE id > {snapshot["expenses_max"]}')
psql(f'DELETE FROM "inventoryTx" WHERE id > {snapshot["tx_max"]}')
psql(f'DELETE FROM "kitchenReturns" WHERE id > {snapshot["returns_max"]}')
psql(f'DELETE FROM dispatches WHERE id > {snapshot["dispatches_max"]}')
# صفوف الليدجر تُحذف لكل إذن بحسب مرجعه أعلاه (id من نوع uuid — لا max)

# استعادة الأرصدة من اللقطة (استعادة مباشرة من اللقطة — ليست إعادة حساب من ليدجر تاريخي)
for line in snapshot['inventory'].split('\n'):
    if not line:
        continue
    iid, name, qty, cost = line.split('|')
    psql(f'UPDATE inventory SET qty={qty}, "avgCost"={cost} WHERE id={iid}')
for line in snapshot['balances'].split('\n'):
    if not line:
        continue
    iid, lid, on_hand = line.split('|')
    psql(f'UPDATE inventory_location_balances SET on_hand={on_hand} WHERE inventory_id={iid} AND location_id={lid}')

# حذف مخازن الأقسام التي أنشأها الفحص إن كانت جديدة
stores_before = {x for x in snapshot['stores_before'].split('\n') if x}
for store in ['STORE-SALADS', 'STORE-SWEETS', 'STORE-BAKERY', 'STORE-HOT-KITCHEN', 'STORE-EXTERNAL']:
    if store not in stores_before:
        psql(f"DELETE FROM inventory_location_balances WHERE location_id=(SELECT id FROM inventory_locations WHERE code='{store}')")
        psql(f"DELETE FROM inventory_locations WHERE code='{store}'")

# التحقق النهائي من التطابق
check('J1 أرصدة المخزون مطابقة للقطة', psql(SNAP_INV) == snapshot['inventory'])
check('J2 أرصدة المواقع مطابقة للقطة', psql(SNAP_BAL) == snapshot['balances'])
check('J3 لا بقايا إذن من الفحص',
      psql("SELECT COUNT(*) FROM dispatches WHERE notes LIKE '%احتياج أسبوعي%'") == '0')
check('J4 مصاريف salads عادت لعدّتها السابقة',
      psql("SELECT COUNT(*) FROM expenses WHERE \"deptId\"='salads'") == snapshot['salads_expenses'])

# ═══ النتيجة ═══
passed = sum(1 for _, ok, _ in results if ok)
failed = [n for n, ok, _ in results if not ok]
print(f'\n═══ RESULT: {passed}/{len(results)} PASS ═══')
if failed:
    print('FAILED:')
    for n in failed:
        print('  -', n)
    sys.exit(1)
