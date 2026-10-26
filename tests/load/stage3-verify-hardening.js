// التحقق من التعديلات الأربعة على drill (منفذ 5002)
// V1: COGS في قيد البيع (C1) · V2: منع كتابة qty عبر CRUD (C3)
// V3: سياسة approval = deny (C6) · V4: رفض البيع في فترة مقفلة (R20)
'use strict';
const https = require('https');
const { Client } = require('pg');
// Never hard-code this: it used to live here and leaked to a public remote.
const API_KEY = process.env.API_KEY || '';
const PORT = 5002;
const DEPT = 99901, PRODUCT = 999001, SHIFT = 999001;
let failed = 0;
const record = (n, ok, d) => { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + n + ' | ' + d); if (!ok) { failed++; } };

function req(method, path, { token, body, headers = {} } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const r = https.request({ host: '127.0.0.1', port: PORT, path, method, rejectUnauthorized: false,
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
    return new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Kimo20177', database: 'karim_erp_drill' });
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
    console.log('LOGIN OK (drill:5002)');

    // بذرة نفس بذور Stage 3
    await q(`INSERT INTO inventory (id, name, qty, "avgCost", unit, category) VALUES (999001, 'DRILL-TEST', 5, 10, 'piece', 'test') ON CONFLICT (id) DO UPDATE SET qty=5, "avgCost"=10`);
    await q(`INSERT INTO pos_departments (id, code, name_ar, is_active) OVERRIDING SYSTEM VALUE VALUES (99901, 'DRILL', 'DRILL-DEPT', true) ON CONFLICT (id) DO UPDATE SET is_active=true`);
    await q(`INSERT INTO pos_products (id, name_ar, department_id, price, vat_rate, is_active, unit) OVERRIDING SYSTEM VALUE VALUES (999001, 'DRILL-PRODUCT', 99901, 115, 15, true, 'piece') ON CONFLICT (id) DO UPDATE SET is_active=true`);
    await q(`DELETE FROM pos_product_ingredients WHERE product_id=999001`);
    await q(`INSERT INTO pos_product_ingredients (product_id, inventory_id, quantity_per_unit, unit) VALUES (999001, 999001, 1, 'piece')`);
    await q(`INSERT INTO pos_shift_sessions (id, department_id, cashier_id, status, opening_balance, opened_at) OVERRIDING SYSTEM VALUE VALUES (999001, 99901, 1, 'open', 0, NOW()) ON CONFLICT (id) DO NOTHING`);

    // ── V1: بيع → قيد GL يحوي COGS ومتوازن ──
    const r1 = await req('POST', '/api/sales/complete', { token, body: saleBody(2, 115), headers: { 'Idempotency-Key': 'v1-' + Date.now(), 'x-shift-session-id': String(SHIFT) } });
    const orderId = (() => { try { return JSON.parse(r1.b).order?.id || JSON.parse(r1.b).id; } catch (_) { return null; } })();
    const je = await q(
        `SELECT e.id, e.entry_no, SUM(l.debit) dr, SUM(l.credit) cr,
                SUM(CASE WHEN l.account_code='5000' THEN l.debit END) AS cogs_dr,
                SUM(CASE WHEN l.account_code='1200' THEN l.credit END) AS inv_cr
         FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id
         WHERE e.source_type='pos_sale' AND e.source_id=$1 GROUP BY e.id, e.entry_no`, [String(orderId)]);
    record('V1a بيع drill نجح', r1.s === 201, `status=${r1.s} order=${orderId}`);
    record('V1b قيد البيع يحوي COGS 5000/1200', je.length === 1 && Number(je[0].cogs_dr) > 0 && Number(je[0].inv_cr) === Number(je[0].cogs_dr), JSON.stringify(je[0] || {}));
    record('V1c القيد متوازن', je.length === 1 && Math.abs(Number(je[0].dr) - Number(je[0].cr)) <= 0.01, `dr=${je[0]?.dr} cr=${je[0]?.cr}`);

    // ── V2: تحديث qty عبر CRUD → 422 ──
    const invId = (await q(`SELECT id FROM inventory WHERE id=999001`))[0].id;
    const u1 = await req('PUT', '/api/inventory/' + invId, { token, body: { qty: 999 } });
    const u2 = await req('PUT', '/api/inventory/' + invId, { token, body: { weight: 2.5 } });
    record('V2a تحديث qty مرفوض 422', u1.s === 422, `status=${u1.s} ${u1.b.slice(0, 80)}`);
    record('V2b تحديث حقل عادي (weight) ما زال يعمل', u2.s === 200, `status=${u2.s}`);

    // ── V3: سياسة approval = deny (الموقع MAIN أصبح approval في drill) ──
    const r3 = await req('POST', '/api/sales/complete', { token, body: saleBody(50, 115), headers: { 'Idempotency-Key': 'v3-' + Date.now(), 'x-shift-session-id': String(SHIFT) } });
    record('V3a بيع أكبر من الرصيد مع policy=approval مرفوض 409 (سابقًا كان سيمر سالبًا)', r3.s === 409, `status=${r3.s}`);

    // ── V4: إقفال فترة 2026-10 → رفض بيع 423 ثم فتح → نجاح ──
    await q(`UPDATE accounting_periods SET closed=true, closed_at=NOW(), closed_by=1 WHERE period='2026-10'`);
    const r4 = await req('POST', '/api/sales/complete', { token, body: saleBody(1, 115), headers: { 'Idempotency-Key': 'v4a-' + Date.now(), 'x-shift-session-id': String(SHIFT) } });
    record('V4a بيع في فترة مقفلة → 423 PERIOD_CLOSED', r4.s === 423 && /PERIOD_CLOSED|مقفل/.test(r4.b), `status=${r4.s} ${r4.b.slice(0, 100)}`);
    await q(`UPDATE accounting_periods SET closed=false, closed_at=NULL, closed_by=NULL WHERE period='2026-10'`);
    const r5 = await req('POST', '/api/sales/complete', { token, body: saleBody(1, 115), headers: { 'Idempotency-Key': 'v4b-' + Date.now(), 'x-shift-session-id': String(SHIFT) } });
    record('V4b بعد إعادة الفتح البيع ينجح', r5.s === 201, `status=${r5.s}`);

    console.log(failed === 0 ? '\nALL_HARDENING_VERIFIED' : `\nFAILURES: ${failed}`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
