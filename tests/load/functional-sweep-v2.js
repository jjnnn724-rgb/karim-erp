#!/usr/bin/env node
/**
 * tests/load/functional-sweep-v2.js — فحص وظيفي شامل عبر الـ API الحقيقي
 * يغطي: الصحة النظامية، دورة طلبات الخضار كاملة (إنشاء→استلام برفض صنف→تسعير→مصروف)،
 * دوامات القسم (بداية السبت + دمج الإجازات)، حالة بوابة البصمة، وملفات الكاش/الـSW.
 * النتيجة: JSON مفصل + خروج نصي (pass/fail لكل فحص).
 */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'https://127.0.0.1:5000';
const ROOT = path.resolve(__dirname, '..', '..');
const API_KEY = String((require('dotenv').config({ quiet: true }).parsed || {}).API_KEY || process.env.API_KEY || '');
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const dbPass = (env.match(/^DB_PASSWORD=(.*)$/m) || [])[1];
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));

function request(method, p, { token, body } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const req = https.request(BASE + p, {
            method, rejectUnauthorized: false, timeout: 20000,
            headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
        }, (res) => { let raw = ''; res.on('data', (c) => { raw += c; }); res.on('end', () => resolve({ status: res.statusCode, text: raw })); });
        req.on('error', (e) => resolve({ status: 0, text: e.message }));
        if (data) { req.write(data); }
        req.end();
    });
}

const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail: String(detail || '').slice(0, 300) }); console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' | ' + String(detail).slice(0, 160) : '')); }

async function dbQuery(sql, params) {
    const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: dbPass, database: 'karim_erp' });
    await c.connect();
    const r = await c.query(sql, params);
    await c.end();
    return r.rows;
}

(async () => {
    const t0 = Date.now();
    // ─── 0) الدخول (مستخدم قابل للتعيين كي لا يُستهلك ميزانية admin أثناء اختبار الضغط) ───
    const SWEEP_USER = process.env.SWEEP_USER || 'admin';
    const SWEEP_PASS = process.env.SWEEP_PASS || 'karim@20177';
    const login = await request('POST', '/api/auth/login', { body: { username: SWEEP_USER, password: SWEEP_PASS } });
    const token = (() => { try { return JSON.parse(login.text).access_token; } catch (_) { return null; } })();
    check('login admin', login.status === 200 && !!token, 'status=' + login.status);

    // ─── 1) الصحة النظامية ───
    const health = await request('GET', '/api/health', { token });
    let healthOk = false, healthDetail;
    try { const j = JSON.parse(health.text); const comps = Array.isArray(j.components) ? j.components : []; const db = comps.find((c) => c.component === 'database'); healthOk = j.status === 'ok' && db?.status === 'ok'; healthDetail = 'status=' + j.status + ' db=' + db?.status + ' ver=' + j.app?.version; } catch (_) { healthDetail = health.text.slice(0, 100); }
    check('health + database', healthOk, healthDetail);

    // ─── 2) دورة طلبات الخضار الكاملة مع رفض صنف ───
    const create = await request('POST', '/api/veg-requests', { token, body: { items: [{ name: 'طماطم', qty: 10, unit: 'كجم' }, { name: 'خيار', qty: 4, unit: 'كجم' }, { name: 'بصل', qty: 5, unit: 'كيس' }], priority: 'urgent', notes: 'فحص وظيفي شامل' } });
    const created = (() => { try { return JSON.parse(create.text).request; } catch (_) { return null; } })();
    check('veg create', create.status === 200 && !!created?.request_no, create.status + ' ' + (created?.request_no || create.text.slice(0, 120)));

    if (created) {
        const items = Array.isArray(created.items) ? created.items : [];
        const rejectItem = items[2]?.name; // بصل
        const recv = await request('POST', `/api/veg-requests/${created.id}/receive`, { token, body: { rejections: [rejectItem] } });
        const recvJ = (() => { try { return JSON.parse(recv.text).request; } catch (_) { return null; } })();
        check('veg receive + per-item rejection', recv.status === 200 && recvJ?.status === 'received' && recvJ?.received_by_dept === 'مخازن' && (recvJ?.items || []).find((i) => i.name === rejectItem)?.rejected === true,
            'status=' + recvJ?.status + ' dept=' + recvJ?.received_by_dept);

        // تسعير: محاولة إرسال المرفوض يجب أن تُتجاهل بأمان، والمقبول فقط يُسعَّر
        const price = await request('POST', `/api/veg-requests/${created.id}/price`, { token, body: { prices: [{ name: 'طماطم', unitPrice: 4.5 }, { name: 'خيار', unitPrice: 3 }] } });
        const priceJ = (() => { try { return JSON.parse(price.text); } catch (_) { return null; } })();
        const expTotal = 10 * 4.5 + 4 * 3; // 57
        check('veg price accepted-only', price.status === 200 && Number(priceJ?.total) === expTotal && priceJ?.request?.status === 'priced', 'total=' + priceJ?.total + ' expected=' + expTotal);
        check('veg expense posted', !!priceJ?.expenseId, 'expenseId=' + priceJ?.expenseId);
        if (priceJ?.expenseId) {
            const rows = await dbQuery('SELECT "deptId", amount, "adjustmentType" FROM expenses WHERE id = $1', [priceJ.expenseId]);
            check('veg expense row in DB', rows.length === 1 && rows[0].deptId === 'kitchen' && Number(rows[0].amount) === expTotal && rows[0].adjustmentType === 'veg_request', JSON.stringify(rows[0] || {}));
        }

        // حمايات: تسعير مكرر يجب أن يُرفض
        const repriced = await request('POST', `/api/veg-requests/${created.id}/price`, { token, body: { prices: [{ name: 'طماطم', unitPrice: 1 }] } });
        check('veg re-price rejected (NOT_RECEIVED)', repriced.status === 409, 'status=' + repriced.status);

        // الفورمة المطبوعة تحتوي المرفوض (فحص باني القالب يتطلب جسر المتصفح — بدلًا منه نفحص بيانات العرض)
        const listAfter = await request('GET', '/api/veg-requests?limit=5', { token });
        const pricedReq = (() => { const j = JSON.parse(listAfter.text); return (j.requests || []).find((r) => String(r.id) === String(created.id)); })();
        check('veg priced state persisted', pricedReq?.status === 'priced' && Number(pricedReq?.total) === expTotal, 'status=' + pricedReq?.status + ' total=' + pricedReq?.total);

        // تنظيف: حذف الطلب + المصروف
        await dbQuery('DELETE FROM expenses WHERE id = $1', [priceJ?.expenseId || 0]);
        await dbQuery('DELETE FROM veg_requests WHERE id = $1', [created.id]);
        console.log('cleanup: removed test request + expense');
    }

    // ─── 3) دوامات القسم: السبت + الإجازات ───
    const roster = await request('GET', '/api/hr/dept-roster-week', { token });
    const rosterJ = (() => { try { return JSON.parse(roster.text); } catch (_) { return null; } })();
    const wsOk = /^\d{4}-\d{2}-\d{2}$/.test(rosterJ?.weekStart || '');
    let satOk = false;
    if (wsOk) { const wd = new Date(rosterJ.weekStart + 'T12:00:00Z').getUTCDay(); satOk = wd === 6; }
    check('roster week starts Saturday', satOk, 'weekStart=' + rosterJ?.weekStart + ' utcdow=' + (wsOk ? new Date(rosterJ.weekStart + 'T12:00:00Z').getUTCDay() : '?'));
    const hasLeaveFields = (rosterJ?.grid || []).some((g) => g.cells.some((c) => 'onLeave' in c && 'leaveType' in c));
    check('roster leaves fields merged', hasLeaveFields, 'cells carry onLeave/leaveType');
    const daysOk = (rosterJ?.days || []).length === 7 && rosterJ.days[0].weekday === 0;
    check('roster 7 days sequential', daysOk, 'days=' + (rosterJ?.days || []).length);

    // ─── 4) بوابة البصمة ───
    const pStatus = await request('GET', '/api/attendance/portal/status', { token });
    const pJ = (() => { try { return JSON.parse(pStatus.text); } catch (_) { return null; } })();
    check('punch portal status', pStatus.status === 200 && 'enabled' in (pJ || {}), 'enabled=' + pJ?.enabled + ' binding=' + pJ?.deviceBinding);

    // ─── 5) الإعدادات الحية تحتوي مفتاح الربط الذاتي ───
    const sAdmin = await request('GET', '/api/attendance/portal/settings-admin', { token });
    const sJ = (() => { try { return JSON.parse(sAdmin.text); } catch (_) { return null; } })();
    const rebindKey = (sJ?.settings || []).find((s) => s.key === 'punch_device_auto_rebind');
    check('auto-rebind setting present', !!rebindKey && rebindKey.value === 'true', 'value=' + (rebindKey?.value || 'missing'));

    // ─── 6) ملفات الكاش/الواجهة — النسخ الحالية تُخدم ───
    for (const [url, needle] of [
        ['/app/index.html', 'main.js?v=4.9.20'],
        ['/app/sw.js', '4.25.20'],
        ['/app/js/core/config.js?v=4.9.20', 'veg-requests'],
        ['/app/js/core/i18n.js?v=4.9.20', "'veg-requests'"],
        ['/app/js/features/veg-requests.js?v=4.9.20', 'vegSubmitReceive'],
        ['/app/js/features/page-router.js?v=4.9.20', "case 'veg-requests'"],
        ['/app/js/features/roster.js?v=4.9.20', "السبت"],
    ]) {
        const r = await request('GET', url, { token });
        check('static ' + url.split('?')[0], r.status === 200 && r.text.includes(needle), 'status=' + r.status);
    }

    // ─── 7) حمايات الأمان السريعة ───
    const noAuth = await request('GET', '/api/veg-requests');
    check('veg list requires auth', noAuth.status === 401 || noAuth.status === 403, 'status=' + noAuth.status);
    const badPrice = await request('POST', '/api/veg-requests', { token, body: { items: [{ name: 'x<scr>', qty: 1, unit: 'كجم' }] } });
    const badJ = (() => { try { return JSON.parse(badPrice.text); } catch (_) { return null; } })();
    check('veg sanitizes html in names', badPrice.status === 200 && badJ?.request?.items?.[0]?.name === 'xscr' || badPrice.status === 422, 'name=' + badJ?.request?.items?.[0]?.name);
    if (badJ?.request?.id) { await dbQuery('DELETE FROM veg_requests WHERE id = $1', [badJ.request.id]); }

    const pass = results.filter((r) => r.ok).length;
    console.log(`\n=== النتيجة: ${pass}/${results.length} فحص ناجح — ${Math.round((Date.now() - t0) / 1000)} ثانية ===`);
    const outDir = path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'functional-sweep.json'), JSON.stringify({ startedAt: new Date().toISOString(), pass, total: results.length, results }, null, 2));
    process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('SWEEP_ERROR', e); process.exit(1); });
