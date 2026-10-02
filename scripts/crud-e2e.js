// crud-e2e.tmp.cjs — E2E للـ CRUD العام: إنشاء/قراءة/تعديل/حذف عبر API الحية.
// النتائج تُكتب JSON — تُقارن قبل وبعد فصل الـ CRUD (يجب أن تتطابق حرفيًا).
const fs = require('fs');
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
}
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { execFileSync } = require('child_process');
const jwt = require('jsonwebtoken');
const TOKEN = jwt.sign({ sub: '1', role: 'admin', name: 'مدير النظام', sid: null, pwd_change: false }, process.env.JWT_ACCESS_SECRET, { expiresIn: '10m', algorithm: 'HS256' });
const HDRS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'x-api-key': process.env.API_KEY || '' };
const BASE = 'https://127.0.0.1:5000/api';
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');

async function call(method, path, body) {
    const r = await fetch(BASE + path, { method, headers: HDRS, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (_) {}
    return { status: r.status, body: j };
}
const out = { stamp: STAMP, checks: [] };
const check = (name, ok, got) => { out.checks.push({ name, ok, got: String(got).slice(0, 90) }); console.log((ok ? '✅' : '❌') + ' ' + name + ' → ' + String(got).slice(0, 90)); };

(async () => {
    // 1) قائمة موظفين (GET مع pagination headers)
    const list = await call('GET', '/employees?page=1&limit=5');
    check('GET /employees 200', list.status === 200, `status=${list.status} rows=${list.body?.data?.length} total=${list.body?.pagination?.total}`);

    // 2) إنشاء صنف مخزون (entity = inventory)
    const itemName = '__CRUD_E2E_' + STAMP + '__';
    const created = await call('POST', '/inventory', { name: itemName, category: 'اختبار', unit: 'كجم', qty: 7, avgCost: 5, minQty: 1, weight: 0 });
    const itemId = created.body?.id;
    check('POST /inventory 201', created.status === 201 && !!itemId, `status=${created.status} id=${itemId}`);

    // 3) قراءة الصنف المحدث (balance seed تلقائي)
    const got = await call('GET', '/inventory/' + itemId);
    check('GET /inventory/:id 200 + qty=7', got.status === 200 && Number(got.body?.qty) === 7, `qty=${got.body?.qty}`);

    // 4) تعديل
    const upd = await call('PUT', '/inventory/' + itemId, { minQty: 3 });
    check('PUT /inventory/:id 200 + minQty=3', upd.status === 200 && Number(upd.body?.minQty) === 3, `minQty=${upd.body?.minQty}`);

    // 5) إنشاء قسم (entity له parent_code validation)
    const dep = await call('POST', '/departments', { code: 'E2E' + STAMP.slice(-4), name: 'قسم اختبار ' + STAMP });
    check('POST /departments 201', dep.status === 201 || dep.status === 200, `status=${dep.status}`);

    // 6) حذف القسم والصنف (تنظيف)
    const delDep = await call('DELETE', '/departments/' + (dep.body?.id || '0'));
    check('DELETE /departments', delDep.status === 200 || delDep.status === 204 || delDep.status === 404, `status=${delDep.status}`);
    const delInv = await call('DELETE', '/warehouse/inventory/' + itemId + '/force');
    check('DELETE /warehouse/inventory/:id/force', delInv.status === 200 || delInv.status === 204, `status=${delInv.status}`);

    // 7) رفض مجهول (بدون توكن → 401)
    const anon = await fetch(BASE + '/employees', { headers: { 'x-api-key': process.env.API_KEY || '' } });
    check('GET /employees بدون توكن → 401', anon.status === 401, `status=${anon.status}`);

    out.allOk = out.checks.every((c) => c.ok);
    fs.writeFileSync('crud-e2e-result.tmp.json', JSON.stringify(out, null, 1));
    console.log('\nE2E-CRUD ' + (out.allOk ? 'ALL-OK' : 'HAS-FAILURES') + ' (' + out.checks.filter((c) => c.ok).length + '/' + out.checks.length + ')');
    process.exit(out.allOk ? 0 : 1);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
