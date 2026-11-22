// tests/load/stage3-tests.tmp.js — اختبارات الواقع على النسخة المعزولة (5001)
// T1 دفع مزدوج idempotent آ· T2 سباق آخر قطعة آ· T4 قطع منتصف معاملة (حتمي بقفل) آ· T3 سباق رواتب
'use strict';
const https = require('https');
const { Client } = require('pg');

const BASE_HOST = '127.0.0.1';
const BASE_PORT = 5001;
// Never hard-code this: it used to live here and leaked to a public remote.
const API_KEY = process.env.API_KEY || '';
const DEPT = 99901, PRODUCT = 999001, ING = 999001, SHIFT = 999001;
const results = [];
function record(name, pass, detail) {
    results.push({ name, pass, detail });
    console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + ' | ' + detail);
}

function req(method, path, { token, body, headers = {} } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const r = https.request({
            host: BASE_HOST, port: BASE_PORT, path, method,
            rejectUnauthorized: false,
            headers: {
                'Content-Type': 'application/json', 'x-api-key': API_KEY,
                ...(token ? { Authorization: 'Bearer ' + token } : {}),
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
                ...headers,
            },
        }, (res) => {
            let b = '';
            res.on('data', c => b += c);
            res.on('end', () => resolve({ s: res.statusCode, b }));
        });
        r.on('error', e => resolve({ s: 0, b: 'NET:' + e.message }));
        r.setTimeout(30000, () => { r.destroy(new Error('CLIENT_TIMEOUT')); });
        if (data) { r.write(data); }
        r.end();
    });
}
function dbClient() {
    return new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.LOADTEST_PG_PASSWORD || process.env.PGPASSWORD || '', database: 'karim_erp_stage3' });
}
async function q(sql, params = []) {
    const c = dbClient();
    await c.connect();
    try { return (await c.query(sql, params)).rows; } finally { await c.end().catch(() => {}); }
}
const saleBody = (qty, price) => ({
    department_id: DEPT,
    items: [{ product_id: PRODUCT, quantity: qty, unit_price: price, discount: 0 }],
    payments: [{ method: 'cash', amount: +(qty * price * 1.15).toFixed(2) }],
});

(async () => {
    // دخول
    const login = await req('POST', '/api/auth/login', { body: { username: 'admin', password: process.env.KARIM_FIXED_ADMIN_PASSWORD || '' } });
    let token = null;
    try { token = JSON.parse(login.b).access_token; } catch (_) {}
    if (!token) { console.error('LOGIN_FAIL', login.s, login.b.slice(0, 200)); process.exit(1); }
    console.log('LOGIN OK (clone server)');

    // ═══ T1: دفع مزدوج بنفس Idempotency-Key ═══
    {
        const key = 'stage3-t1-' + Date.now();
        const r1 = await req('POST', '/api/sales/complete', { token, body: saleBody(1, 115), headers: { 'Idempotency-Key': key, 'x-shift-session-id': String(SHIFT) } });
        const r2 = await req('POST', '/api/sales/complete', { token, body: saleBody(1, 115), headers: { 'Idempotency-Key': key, 'x-shift-session-id': String(SHIFT) } });
        const orders = await q(`SELECT count(*)::int AS n FROM pos_orders WHERE department_id=$1`, [DEPT]);
        const orderIds = await q(`SELECT id FROM pos_orders WHERE department_id=$1 ORDER BY id`, [DEPT]);
        let glEntry = [];
        if (orderIds.length) {
            glEntry = await q(`SELECT entry_no, status FROM journal_entries WHERE source_type='pos_sale' AND source_id=$1`, [String(orderIds[0].id)]);
        }
        const qty = await q(`SELECT qty FROM inventory WHERE id=$1`, [ING]);
        record('T1a بيع بنفس المفتاح مرتين (replay)', r1.s === 201 && r2.s === 201, `r1=${r1.s} r2=${r2.s}`);
        record('T1b أمر بيع واحد فقط (لا ازدواج)', orders[0].n === 1, `pos_orders=${orders[0].n}`);
        record('T1c قيد GL pos_sale أُنشئ', glEntry.length === 1 && glEntry[0].status === 'posted', JSON.stringify(glEntry));
        record('T1d خصم مكون واحد (2→1)', Number(qty[0].qty) === 1, `qty=${qty[0].qty}`);
    }

    // ═══ T2: سباق بيع آخر قطعة (المتبقي 1، طلبان متزامنان qty=1) ═══
    {
        const keyA = 'stage3-t2a-' + Date.now();
        const keyB = 'stage3-t2b-' + Date.now();
        const [ra, rb] = await Promise.all([
            req('POST', '/api/sales/complete', { token, body: saleBody(1, 115), headers: { 'Idempotency-Key': keyA, 'x-shift-session-id': String(SHIFT) } }),
            req('POST', '/api/sales/complete', { token, body: saleBody(1, 115), headers: { 'Idempotency-Key': keyB, 'x-shift-session-id': String(SHIFT) } }),
        ]);
        const ok = [ra, rb].filter(x => x.s === 201).length;
        const conflict = [ra, rb].filter(x => x.s === 409).length;
        const bal = await q(`SELECT on_hand FROM inventory_location_balances WHERE inventory_id=$1`, [ING]);
        const negLedger = await q(`SELECT count(*)::int AS n FROM inventory_location_balances WHERE inventory_id=$1 AND on_hand < 0`, [ING]);
        const qty = await q(`SELECT qty FROM inventory WHERE id=$1`, [ING]);
        record('T2a بالضبط 201 واحدة + 409 واحدة', ok === 1 && conflict === 1, `201=${ok} 409=${conflict} codes=${[ra.s, rb.s]}`);
        record('T2b لا رصيد سالب في الدفتر', negLedger[0].n === 0 && Number(qty[0].qty) === 0, `on_hand=${bal[0]?.on_hand} qty=${qty[0].qty} negRows=${negLedger[0].n}`);
    }

    // ═══ T4: قطع منتصف المعاملة (حتمي: قفل الوردية ثم قتل الاتصال) ═══
    {
        await q(`UPDATE inventory SET qty=3 WHERE id=$1 RETURNING qty`, [ING]);
        await q(`UPDATE inventory_location_balances SET on_hand=3 WHERE inventory_id=$1 RETURNING on_hand`, [ING]);
        const c = dbClient();
        await c.connect();
        await c.query('BEGIN');
        await c.query(`SELECT id FROM pos_shift_sessions WHERE id=$1 FOR UPDATE`, [SHIFT]); // احتكار قفل الوردية
        const key = 'stage3-t4-' + Date.now();
        const salePromise = req('POST', '/api/sales/complete', { token, body: saleBody(1, 115), headers: { 'Idempotency-Key': key, 'x-shift-session-id': String(SHIFT) } });
        await new Promise(r => setTimeout(r, 1500)); // البيع الآن عالق على قفل الوردية داخل المعاملة
        const killed = await c.query(
            `SELECT pg_terminate_backend(pid) AS ok, pid FROM pg_stat_activity
             WHERE datname='karim_erp_stage3' AND application_name <> 'pg' AND pid <> pg_backend_pid()
             AND query LIKE '%sales/complete%' OR (datname='karim_erp_stage3' AND state='idle in transaction' AND application_name <> 'pg' AND pid <> pg_backend_pid())`);
        await c.query('COMMIT'); // تحرير القفل
        const r = await salePromise; // سيفشل بقطع اتصال (57P01) أو يكتمل إن فات التوقيت
        await new Promise(r2 => setTimeout(r2, 500));
        const orders = await q(`SELECT count(*)::int AS n FROM pos_orders WHERE department_id=$1`, [DEPT]);
        const qty = await q(`SELECT qty FROM inventory WHERE id=$1`, [ING]);
        const killedCount = killed.rows.filter(x => x.ok).length;
        const interrupted = r.s === 0 || /57P01|ECONNRESET|terminated/.test(r.b);
        record('T4a قُطع الاتصال أثناء المعاملة', interrupted, `killed=${killedCount} resp=${r.s}`);
        record('T4b رولباك كامل: لا أمر بيع جديد ولا خصم', orders[0].n === 3 && Number(qty[0].qty) === 3, `orders=${orders[0].n} qty=${qty[0].qty}`);
        // إعادة المحاولة بنفس المفتاح يجب أن تنجح نظيفة (صف idempotency تراجع مع المعاملة)
        const retry = await req('POST', '/api/sales/complete', { token, body: saleBody(1, 115), headers: { 'Idempotency-Key': key, 'x-shift-session-id': String(SHIFT) } });
        const orders2 = await q(`SELECT count(*)::int AS n FROM pos_orders WHERE department_id=$1`, [DEPT]);
        record('T4c إعادة المحاولة بعد القطع تنجح نظيفة', retry.s === 201 && orders2[0].n === 4, `retry=${retry.s} orders=${orders2[0].n}`);
        await c.end().catch(() => {});
    }

    // ═══ T3: سباق توليد رواتب متزامن (فحص الخطر الموثق: لا UNIQUE) ═══
    {
        const month = '2026-10';
        const body = { month };
        const [p1, p2] = await Promise.all([
            req('POST', '/api/hr/payroll-runs/generate', { token, body }),
            req('POST', '/api/hr/payroll-runs/generate', { token, body }),
        ]);
        await new Promise(r => setTimeout(r, 1000));
        const dup = await q(
            `SELECT "employeeId", count(*)::int AS n FROM payroll WHERE month=$1 GROUP BY 1 HAVING count(*)>1 LIMIT 5`, [month]);
        const total = await q(`SELECT count(*)::int AS n FROM payroll WHERE month=$1`, [month]);
        const emps = await q(`SELECT count(*)::int AS n FROM employees WHERE status<>'منتهي'`);
        record('T3a استجابتا التوليد المتزامن', [p1, p2].every(x => [200, 201, 409, 423].includes(x.s)), `p1=${p1.s} p2=${p2.s}`);
        record('T3b فحص الازدواج (employeeId,month)', dup.length === 0, `dupes=${dup.length} rows=${total[0].n} employees=${emps[0].n}${dup.length ? ' ← الخطر الموثق وقع فعلاً' : ' ← لم يقع (الإدراج سريع التسلسل أو الحارس يعمل)'}`);
    }

    console.log('\n=== ملخص ===');
    const failed = results.filter(r => !r.pass);
    console.log(`النتيجة: ${results.length - failed.length}/${results.length} ناجحة`);
    process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });

