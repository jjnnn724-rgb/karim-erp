#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 20 — فحص حي شامل:
  A) الإشعارات الفورية الموجّهة على سلسلة اعتماد طلبات الصرف كاملة
     (تقديم رئيس قسم → اعتماد/رفض الشيف → صرف المخازن → استلام القسم)
  B) الجرد المؤجل: جرد كل مخزن على حدة — جلسة على مخزن قسم، لقطة من
     رصيد الموقع، عجز موثق، اعتماد بقيدين في الليدجر، كلفة على القسم،
     وحرس اللقطة القديمة (stale snapshot)
  C) تنظيف كامل بأرصدة مطابقة للقطة ما قبل الفحص
"""
import json
import urllib.request
import urllib.error

BASE = 'http://localhost:5000'
PSQL = ['/home/z/my-project/karim-erp/database/bin/bin/psql', '-h', '127.0.0.1',
        '-U', 'postgres', '-d', 'karim_erp', '-tAc']
import os
import subprocess
PGPASSWORD = 'karim_local_preview_2026_secure_password'
SIG = ('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMA'
       'AQAABQABDQottAAAAABJRU5ErkJggg==')  # 1px valid png data-url

results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    mark = 'PASS' if ok else 'FAIL'
    print(f'[{mark}] {name}' + (f' — {detail}' if detail else ''))


def psql(sql):
    env = dict(os.environ)
    env['PGPASSWORD'] = PGPASSWORD
    out = subprocess.run(PSQL + [sql], capture_output=True, text=True, env=env)
    if out.returncode != 0:
        raise RuntimeError(f'psql failed: {out.stderr[:300]}')
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


def unread(token):
    s, r = req('GET', '/api/notifications', token)
    if s != 200:
        return None
    return r.get('unread_count')


def wait_for_notification(token, title, entity_id, timeout=8.0, interval=0.4):
    """الإدراج غير متزامن (fire-and-forget بعد نجاح العملية) — نستقصي حتى وصول الإشعار."""
    import time
    deadline = time.time() + timeout
    while time.time() < deadline:
        s, r = req('GET', '/api/notifications', token)
        if s == 200:
            for n in r.get('notifications', []):
                if n.get('title') == title and str(n.get('entity_id')) == str(entity_id):
                    return n
        time.sleep(interval)
    return None


def latest_for(token, title=None):
    s, r = req('GET', '/api/notifications', token)
    rows = r.get('notifications', []) if s == 200 else []
    if title:
        rows = [n for n in rows if n.get('title') == title]
    return rows[0] if rows else None


print('== A0) الإقلاع والدخول ==')
snap_ok = True
s, admin = login('admin')
check('A0.1 دخول المدير', s == 200 and 'access_token' in admin, f'{s}')
ADMIN = admin.get('access_token')
s, chef_l = login('chef')
s, keeper_l = login('keeper')
s, head_l = login('head_salads')
check('A0.2 دخول الشيف/الأمين/رئيس القسم',
      all('access_token' in x for x in (chef_l, keeper_l, head_l)))
CHEF = chef_l.get('access_token')
KEEPER = keeper_l.get('access_token')
HEAD = head_l.get('access_token')

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
    'audits_max': psql('SELECT COALESCE(MAX(id),0) FROM inventory_audits'),
    'audit_items_max': psql('SELECT COALESCE(MAX(id),0) FROM inventory_audit_items'),
    'audit_events_max': psql('SELECT COALESCE(MAX(id),0) FROM inventory_audit_workflow_events'),
    'notifications_max': psql('SELECT COALESCE(MAX(id),0) FROM notifications'),
    'ledger_count': psql('SELECT COUNT(*) FROM inventory_ledger'),
}
print('== Snapshot taken ==')

# صنف من المخزن الرئيسي برصيد كافٍ
item = None
for line in snapshot['inventory'].split('\n'):
    if not line:
        continue
    iid, name, qty, cost = line.split('|')
    if float(qty) >= 30:
        item = {'id': iid, 'name': name, 'qty': float(qty), 'cost': float(cost)}
        break
check('A0.3 يوجد صنف برصيد كافٍ في المخزن الرئيسي', item is not None)
ITEM_NAME = item['name']
ITEM_COST = item['cost']

# ═══ A) سلسلة الإشعارات الفورية ═══
print('\n== A) سلسلة الإشعارات الفورية ==')
base_chef, base_keeper, base_head = unread(CHEF), unread(KEEPER), unread(HEAD)
check('A1 قراءة عدّاد غير المقروء للأطراف الثلاثة',
      all(isinstance(x, int) for x in (base_chef, base_keeper, base_head)),
      f'chef={base_chef} keeper={base_keeper} head={base_head}')

# 1) رئيس القسم يقدّم طلب صرف
s, created = req('POST', '/api/dispatches', HEAD, body={
    'deptCode': 'salads', 'deptName': 'قسم السلطات', 'date': '2026-09-02',
    'items': [{'itemName': ITEM_NAME, 'qty': 10, 'unit': 'وحدة'}],
    'notes': 'احتياج أسبوعي — فحص إشعارات',
})
check('A2 رئيس القسم أنشأ طلب صرف', s == 201 and created.get('id'), f'{s}')
D1 = created.get('id')
if not D1:
    print('FATAL: فشل إنشاء طلب الصرف — لا معنى لبقية السلسلة. الرد:', created)
    raise SystemExit(1)

chef_notif = wait_for_notification(CHEF, 'طلب صرف جديد', D1)
check('A3 الشيف العمومي أُشعِر فوراً بطلب جديد',
      chef_notif is not None,
      chef_notif and f"notif#{chef_notif['id']}" or 'لم يصل خلال 8 ثوانٍ')
check('A4 الإشعار موجَّه للشيف حصراً (رئيس القسم لم يُشعَر بنفسه)',
      unread(HEAD) == base_head, f'head unread {base_head}→{unread(HEAD)}')
check('A5 المخازن لم تُشعَر بعد — الخطوة التالية هي الشيف',
      unread(KEEPER) == base_keeper, f'keeper unread {base_keeper}→{unread(KEEPER)}')
check('A6 صف الإشعار مخزّن بمستخدم ومرجع صحيح',
      psql(f"SELECT COUNT(*) FROM notifications WHERE id={chef_notif['id']} "
           f"AND user_id IS NOT NULL AND entity='dispatches' AND link='dispatch' "
           f"AND read=false AND user_id=(SELECT id FROM users WHERE username='chef')") == '1')

# 2) الشيف يعتمد
s, apr = req('POST', f'/api/warehouse/dispatches/{D1}/chef-approve', CHEF, {'signatureData': SIG, 'notes': 'اعتماد'})
check('A7 الشيف اعتمد الطلب', s == 200 and apr.get('dispatch', {}).get('status') == 'chef_approved', f'{s}')
head_n = wait_for_notification(HEAD, 'اعتماد الشيف العمومي', D1)
keeper_n = wait_for_notification(KEEPER, 'اعتماد الشيف العمومي', D1)
check('A8 رئيس القسم أُشعِر بالاعتماد', head_n is not None and str(head_n.get('entity_id')) == str(D1))
check('A9 المخازن أُشعِرت بانتظار الصرف', keeper_n is not None and str(keeper_n.get('entity_id')) == str(D1))
check('A10 الشيف لم يُشعِر نفسه بقرار اعتماده (زيادته الوحيدة إشعار الإنشاء)',
      unread(CHEF) == base_chef + 1, f'{base_chef + 1}→{unread(CHEF)}')

# 3) المخازن تصرف
s, appr = req('POST', f'/api/warehouse/dispatches/{D1}/approve', KEEPER, {
    'signatureData': SIG,
    'approvedItems': [{'itemName': ITEM_NAME, 'qty': 10, 'unit': 'وحدة'}],
})
check('A11 المخازن اعتمدت وصرفت', s == 200 and appr.get('dispatch', {}).get('status') == 'approved', f'{s}')
head_n2 = wait_for_notification(HEAD, 'تم صرف الطلب', D1)
check('A12 رئيس القسم أُشعِر بتم الصرف', head_n2 is not None)
chef_n2 = wait_for_notification(CHEF, 'تم صرف الطلب', D1)
check('A13 الشيف أُشعِر بتم الصرف', chef_n2 is not None)

# 4) القسم يستلم (الشيف يستلم بالنيابة)
s, rcv = req('POST', f'/api/warehouse/dispatches/{D1}/receive', CHEF, {
    'items': [{'itemName': ITEM_NAME, 'receivedQty': 8, 'notes': 'استلام جزئي'}],
    'signatureData': SIG, 'notes': 'استلام جزئي',
})
check('A14 استلام جزئي موثق', s == 200 and rcv.get('dispatch', {}).get('status') == 'partially_received', f'{s}')
keep_n3 = wait_for_notification(KEEPER, 'استلام القسم', D1)
check('A15 المخازن أُشعِرت بالاستلام', keep_n3 is not None)

# 5) تعليم كمقروء — عزل بين المستخدمين
chef_unread_id = chef_notif['id']
s, rr = req('POST', '/api/notifications/read', CHEF, {'ids': [chef_unread_id]})
check('A16 تعليم إشعار الشيف كمقروء', s == 200 and rr.get('updated') == 1, f'{s} {rr}')
check('A17 عدّاد الشيف نزل بواحد فقط (يبقى إشعار الصرف)', unread(CHEF) == base_chef + 1, f'{base_chef + 1}←{unread(CHEF)}')
s, rr = req('POST', '/api/notifications/read-all', KEEPER)
check('A18 تعليم الكل للأمين يجعل صندوقه صفر', unread(KEEPER) == 0, f'{rr}')

# 6) رفض الشيف — رئيس القسم يرى السبب
s, d2 = req('POST', '/api/dispatches', HEAD, body={
    'deptCode': 'salads', 'deptName': 'قسم السلطات', 'date': '2026-09-02',
    'items': [{'itemName': ITEM_NAME, 'qty': 50, 'unit': 'وحدة'}],
    'notes': 'طلب ثانٍ للرفض',
})
D2 = d2.get('id')
s, _ = req('POST', f'/api/warehouse/dispatches/{D2}/chef-reject', CHEF, {'signatureData': SIG, 'reason': 'الكمية أكبر من الاحتياج'})
head_rej = wait_for_notification(HEAD, 'رفض الشيف العمومي', D2)
check('A19 رفض الشيف وصل لرئيس القسم بالسبب',
      head_rej is not None and 'الاحتياج' in str(head_rej.get('message')) and str(head_rej.get('entity_id')) == str(D2))

# ═══ B) الجرد المؤجل — جرد مخزن القسم على حدة ═══
print('\n== B) جرد كل مخزن على حدة ==')
s, locs = req('GET', '/api/warehouse/inventory/locations', ADMIN)
salads_store = next((l for l in locs if l.get('code') == 'STORE-SALADS'), None)
check('B1 قائمة مخازن الجرد تعمل ومخزن السلطات فيها',
      s == 200 and salads_store is not None and salads_store.get('items_count', 0) >= 1,
      f"{s} items={salads_store and salads_store['items_count']}")
STORE_ID = salads_store['id']

s, prev = req('GET', f'/api/warehouse/inventory/locations/{STORE_ID}/preview?mode=all', ADMIN)
check('B2 المعاينة الحية للمخزن تعمل', s == 200 and prev.get('items_count', 0) >= 1, f'{s} {prev}')

s, aud = req('POST', '/api/warehouse/inventory/audits', ADMIN, body={
    'locationId': STORE_ID, 'countedAt': '2026-09-02', 'periodType': 'monthly',
    'notes': 'جرد مخزن السلطات — فحص حي',
})
AUD1 = aud.get('audit', {}).get('id')
check('B3 جلسة جرد على مخزن السلطات بالعدد المتوقع من المعاينة',
      s == 201 and aud.get('itemCount') == prev.get('items_count'),
      f"{s} created={aud.get('itemCount')} preview={prev.get('items_count')}")
check('B4 الجلسة مرتبطة بالموقع في القاعدة',
      psql(f"SELECT warehouse_scope || ':' || COALESCE(location_id::text,'NULL') FROM inventory_audits WHERE id={AUD1}") == f'STORE-SALADS:{STORE_ID}')

s, det = req('GET', f'/api/warehouse/inventory/audits/{AUD1}', ADMIN)
check('B5 تفاصيل الجلسة تُظهر اسم المخزن', det.get('location_name') == salads_store.get('name_ar'),
      det.get('location_name'))
target = next((i for i in det.get('items', []) if i.get('item_name') == ITEM_NAME), None)
check('B6 الصنف المصروف موجود في لقطة المخزن برصيد موجب',
      target is not None and float(target['system_qty']) >= 1,
      target and f"system={target['system_qty']} (رصيد المخزن الفعلي)" or 'missing')
SYS_QTY = float(target['system_qty']) if target else 0

# عجز موثق: عدّ وحدة واحدة أقل من رصيد المخزن الفعلي
s, _ = req('PUT', f'/api/warehouse/inventory/audits/{AUD1}/counts/{target["item_id"]}', ADMIN,
           {'countedQty': SYS_QTY - 1, 'notes': 'عجز وحدة'})
s, det2 = req('GET', f'/api/warehouse/inventory/audits/{AUD1}', ADMIN)
t2 = next((i for i in det2['items'] if i['item_id'] == target['item_id']), None)
check('B7 الفرق الفوري محسوب على رصيد المخزن (عجز -1)',
      t2 and t2.get('variance_qty') == -1 and abs(float(t2.get('variance_value', 0)) + ITEM_COST) < 0.01,
      t2 and f"var={t2['variance_qty']} val={t2['variance_value']}" or 'none')

s, _ = req('POST', f'/api/warehouse/inventory/audits/{AUD1}/submit', ADMIN, {'signatureData': SIG})
s, apr1 = req('POST', f'/api/warehouse/inventory/audits/{AUD1}/approve', ADMIN, {'signatureData': SIG})
check('B8 اعتماد جلسة مخزن القسم نجح', s == 200 and apr1.get('audit', {}).get('status') == 'approved', f'{s}')

check('B9 حركة تصحيح جرد في الليدجر على مخزن السلطات بفرق -1',
      psql(f"SELECT COUNT(*) FROM inventory_ledger WHERE transaction_type='count_correction' "
           f"AND location_id={STORE_ID} AND inventory_id={target['item_id']} AND quantity_delta=-1 "
           f"AND reference_type='inventory_audit' AND reference_id='{AUD1}'") == '1')

bal_salads = float(psql(f"SELECT on_hand FROM inventory_location_balances WHERE inventory_id={target['item_id']} AND location_id={STORE_ID}"))
check('B10 رصيد مخزن السلطات نزل وحدة واحدة فعلياً', abs(bal_salads - (SYS_QTY - 1)) < 0.001, f'on_hand={bal_salads} expected={SYS_QTY - 1}')
main_loc_id = psql("SELECT id FROM inventory_locations WHERE code='MAIN-WAREHOUSE'")
bal_main = float(psql(f"SELECT on_hand FROM inventory_location_balances WHERE inventory_id={target['item_id']} AND location_id={main_loc_id}"))
snap_main_lines = [l for l in snapshot['balances'].split('\n') if l.startswith(f"{target['item_id']}|{main_loc_id}|")]
snap_main = float(snap_main_lines[0].split('|')[2]) if snap_main_lines else 0.0
check('B11 رصيد المخزن الرئيسي تغيّر فقط بمقدار صرف الطلب (-10) ولم يتأثر بالجرد',
      abs(bal_main - (snap_main - 10)) < 0.001, f'main={bal_main} snap={snap_main}')

total_qty = psql(f"SELECT qty FROM inventory WHERE id={target['item_id']}")
sum_qty = psql(f"SELECT COALESCE(SUM(on_hand),0) FROM inventory_location_balances WHERE inventory_id={target['item_id']}")
check('B12 الإسقاط العالمي أعيد حسابه = مجموع المواقع', abs(float(total_qty) - float(sum_qty)) < 0.001,
      f'qty={total_qty} sum={sum_qty}')

exp = psql(f"SELECT COUNT(*) FROM expenses WHERE \"adjustmentType\"='count_correction' "
           f"AND \"deptId\"='salads' AND amount={ITEM_COST} AND id > {snapshot['expenses_max']}")
check('B13 عجز الجرد سُجل كلفة على قسم السلطات تلقائياً', exp == '1', f'rows={exp}')

# حرس اللقطة القديمة: جلسة A ثم جلسة B تغير الرصيد ثم اعتماد A يجب أن يفشل
s, audA = req('POST', '/api/warehouse/inventory/audits', ADMIN, {'locationId': STORE_ID, 'countedAt': '2026-09-02'})
AUDA = audA['audit']['id']
s, audB = req('POST', '/api/warehouse/inventory/audits', ADMIN, {'locationId': STORE_ID, 'countedAt': '2026-09-02'})
AUDB = audB['audit']['id']
s, _ = req('PUT', f'/api/warehouse/inventory/audits/{AUDB}/counts/{target["item_id"]}', ADMIN, {'countedQty': SYS_QTY + 2})
s, _ = req('POST', f'/api/warehouse/inventory/audits/{AUDB}/submit', ADMIN, {'signatureData': SIG})
s, _ = req('POST', f'/api/warehouse/inventory/audits/{AUDB}/approve', ADMIN, {'signatureData': SIG})
s, stale = req('POST', f'/api/warehouse/inventory/audits/{AUDA}/approve', ADMIN, {'signatureData': SIG})
check('B14 حرس اللقطة القديمة يمنع اعتماد جلسة تغير رصيد المخزن بعدها (409)',
      s == 409 and stale.get('error') == 'AUDIT_STALE_SNAPSHOT', f'{s} {stale.get("error")}')
s, _ = req('POST', f'/api/warehouse/inventory/audits/{AUDA}/cancel', ADMIN, {'reason': 'جلسة قديمة بعد تغير الرصيد — فحص حي'})
check('B15 إلغاء الجلسة المتقادمة موثق', s == 200)

check('B16 جلسات الفحص الثلاث كلها مرتبطة بمخزن (لا جلسات بلا موقع)',
      psql(f"SELECT COUNT(*) FROM inventory_audits WHERE id IN ({AUD1},{AUDA},{AUDB}) AND location_id={STORE_ID}") == '3')

# ═══ C) التنظيف والتحقق النهائي ═══
print('\n== C) التنظيف ==')
for disp_id in [D1, D2]:
    psql(f'DELETE FROM dispatch_workflow_events WHERE dispatch_id={disp_id}')
    psql(f'DELETE FROM expenses WHERE notes LIKE \'%#{disp_id}%\'')
    psql(f'DELETE FROM "inventoryTx" WHERE "dispatchId"=\'DIS-{disp_id}\'')
    psql(f'DELETE FROM inventory_ledger WHERE (reference_type=\'dispatch\' AND reference_id=\'DIS-{disp_id}\') '
         f'OR (reference_type=\'dispatch_receipt\' AND reference_id=\'{disp_id}\')')
    psql(f'DELETE FROM dispatches WHERE id={disp_id}')
for aud_id in [AUD1, AUDA, AUDB]:
    psql(f'DELETE FROM inventory_audit_workflow_events WHERE audit_id={aud_id}')
    psql(f'DELETE FROM inventory_audit_items WHERE audit_id={aud_id}')
    psql(f'DELETE FROM inventory_ledger WHERE reference_type=\'inventory_audit\' AND reference_id=\'{aud_id}\'')
    psql(f'DELETE FROM inventory_audits WHERE id={aud_id}')
psql(f'DELETE FROM notifications WHERE id > {snapshot["notifications_max"]}')
psql(f'DELETE FROM expenses WHERE id > {snapshot["expenses_max"]}')
psql(f'DELETE FROM "inventoryTx" WHERE id > {snapshot["tx_max"]}')
psql(f'DELETE FROM "kitchenReturns" WHERE id > {snapshot["returns_max"]}')
psql(f'DELETE FROM inventory_ledger WHERE transaction_type=\'count_correction\' AND created_at > NOW() - INTERVAL \'2 hours\'')
psql(f'DELETE FROM expenses WHERE "adjustmentType"=\'count_correction\' AND id > {snapshot["expenses_max"]}')

# حذف صفوف رصيد أُنشئت خلال الفحص ولم تكن في اللقطة (مخازن جديدة مثلاً)
snap_pairs = set()
for line in snapshot['balances'].split('\n'):
    if line:
        iid, lid, _ = line.split('|')
        snap_pairs.add((iid, lid))
for line in psql(SNAP_BAL + "").split('\n'):
    pass  # (للاطمئنان فقط — الاستعادة أعلاه كفت كل صفوف اللقطة)
extra_rows = psql("SELECT inventory_id, location_id FROM inventory_location_balances ORDER BY 1,2").split('\n')
for line in extra_rows:
    if not line:
        continue
    iid, lid = line.split('|')
    if (iid, lid) not in snap_pairs:
        psql(f'DELETE FROM inventory_location_balances WHERE inventory_id={iid} AND location_id={lid}')
        psql(f'UPDATE inventory SET qty = COALESCE((SELECT SUM(on_hand) FROM inventory_location_balances WHERE inventory_id={iid}), 0) WHERE id={iid}')

# استعادة الأرصدة من اللقطة مباشرة
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

check('C1 أرصدة المخزون مطابقة للقطة', psql(SNAP_INV) == snapshot['inventory'])
check('C2 أرصدة المواقع مطابقة للقطة', psql(SNAP_BAL) == snapshot['balances'])
check('C3 لا بقايا إشعارات من الفحص', psql(f'SELECT COUNT(*) FROM notifications WHERE id > {snapshot["notifications_max"]}') == '0')
check('C4 لا بقايا إذن من الفحص', psql(f'SELECT COUNT(*) FROM dispatches WHERE id > {snapshot["dispatches_max"]}') == '0')
check('C5 لا بقايا جلسات جرد من الفحص', psql(f'SELECT COUNT(*) FROM inventory_audits WHERE id > {snapshot["audits_max"]}') == '0')
check('C6 الليدجر عداده مطابق للقطة', psql('SELECT COUNT(*) FROM inventory_ledger') == snapshot['ledger_count'])

passed = sum(1 for _, ok, _ in results if ok)
failed = [n for n, ok, _ in results if not ok]
print(f'\n════════ النتيجة: {passed}/{len(results)} PASS ════════')
if failed:
    print('FAILURES:', failed)
    raise SystemExit(1)
