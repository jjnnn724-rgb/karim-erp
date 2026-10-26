// T4 rerun — قطع منتصف المعاملة (استهداف دقيق: الاتصال المنتظر على القفل)
'use strict';
const https = require('https');
const { Client } = require('pg');
// Never hard-code this: it used to live here and leaked to a public remote.
const API_KEY = process.env.API_KEY || '';
const DEPT = 99901, PRODUCT = 999001, ING = 999001, SHIFT = 999001;

function req(method, path, { token, body, headers = {} } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const r = https.request({ host: '127.0.0.1', port: 5001, path, method, rejectUnauthorized: false,
            headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY,
                ...(token ? { Authorization: 'Bearer ' + token } : {}),
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } },
            (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ s: res.statusCode, b })); });
        r.on('error', e => resolve({ s: 0, b: 'NET:' + e.message }));
        r.setTimeout(30000, () => { r.destroy(new Error('CLIENT_TIMEOUT')); });
        if (data) { r.write(data); }
        r.end();
    });
}
function dbClient() {
    return new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Kimo20177', database: 'karim_erp_stage3' });
}
async function q(sql, params = []) {
    const c = dbClient(); await c.connect();
    try { return (await c.query(sql, params)).rows; } finally { await c.end().catch(() => {}); }
}
const saleBody = (qty, price) => ({
    department_id: DEPT,
    items: [{ product_id: PRODUCT, quantity: qty, unit_price: price, discount: 0 }],
    payments: [{ method: 'cash', amount: +(qty * price * 1.15).toFixed(2) }],
});

(async () => {
    const login = await req('POST', '/api/auth/login', { body: { username: 'admin', password: process.env.KARIM_FIXED_ADMIN_PASSWORD || '' } });
    const token = JSON.parse(login.b).access_token;

    // تزويد مخزون للنسخة
    await q(`UPDATE inventory SET qty=5 WHERE id=$1`, [ING]);
    await q(`UPDATE inventory_location_balances SET on_hand=5 WHERE inventory_id=$1`, [ING]);
    const base = await q(`SELECT (SELECT count(*)::int FROM pos_orders WHERE department_id=$1) AS orders, (SELECT qty FROM inventory WHERE id=$2) AS qty`, [DEPT, ING]);
    console.log('BASELINE orders=' + base[0].orders + ' qty=' + base[0].qty);

    // قفل الوردية من اتصال تحكم مستقل → البيع سيتجمد داخل المعاملة على القفل
    const ctrl = dbClient();
    await ctrl.connect();
    await ctrl.query('BEGIN');
    await ctrl.query(`SELECT id FROM pos_shift_sessions WHERE id=$1 FOR UPDATE`, [SHIFT]);
    const key = 'stage3-t4b-' + Date.now();
    const salePromise = req('POST', '/api/sales/complete', { token, body: saleBody(1, 115), headers: { 'Idempotency-Key': key, 'x-shift-session-id': String(SHIFT) } });
    await new Promise(r => setTimeout(r, 1500));

    // إثبات التجميد ثم قتل الاتصال المنتظر على القفل تحديدًا
    const waiting = await ctrl.query(
        `SELECT pid, state, wait_event_type, left(query, 60) AS q FROM pg_stat_activity
         WHERE datname='karim_erp_stage3' AND wait_event_type='Lock' AND pid <> pg_backend_pid()`);
    console.log('WAITING_ON_LOCK=' + waiting.rows.length, JSON.stringify(waiting.rows.map(r => r.state)));
    const killed = await ctrl.query(
        `SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity
         WHERE datname='karim_erp_stage3' AND wait_event_type='Lock' AND pid <> pg_backend_pid()`);
    const killedCount = killed.rows.filter(x => x.ok).length;
    await ctrl.query('COMMIT');
    const r = await salePromise;
    await new Promise(r2 => setTimeout(r2, 800));
    const after = await q(`SELECT (SELECT count(*)::int FROM pos_orders WHERE department_id=$1) AS orders, (SELECT qty FROM inventory WHERE id=$2) AS qty`, [DEPT, ING]);
    const resp = (r.s === 0 || /57P01|ECONNRESET|terminated/i.test(r.b)) ? 'CONNECTION_KILLED' : 'HTTP_' + r.s;

    let pass = true;
    const record = (name, ok, detail) => { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + ' | ' + detail); if (!ok) { pass = false; } };
    record('T4a sale frozen mid-tx then connection killed', waiting.rows.length >= 1 && killedCount >= 1, `waiting=${waiting.rows.length} killed=${killedCount} resp=${resp}`);
    record('T4b full rollback: no new order, no stock deducted', after[0].orders === base[0].orders && Number(after[0].qty) === 5, `orders=${base[0].orders}->${after[0].orders} qty=${after[0].qty}`);
    const retry = await req('POST', '/api/sales/complete', { token, body: saleBody(1, 115), headers: { 'Idempotency-Key': key, 'x-shift-session-id': String(SHIFT) } });
    const afterRetry = await q(`SELECT (SELECT count(*)::int FROM pos_orders WHERE department_id=$1) AS orders, (SELECT qty FROM inventory WHERE id=$2) AS qty`, [DEPT, ING]);
    record('T4c clean retry with same key succeeds', retry.s === 201 && afterRetry[0].orders === base[0].orders + 1 && Number(afterRetry[0].qty) === 4, `retry=${retry.s} orders=${afterRetry[0].orders} qty=${afterRetry[0].qty}`);
    await ctrl.end().catch(() => {});
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
