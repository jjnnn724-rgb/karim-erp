// tests/load/stage3-tests.tmp.js â€” ط§ط®طھط¨ط§ط±ط§طھ ط§ظ„ظˆط§ظ‚ط¹ ط¹ظ„ظ‰ ط§ظ„ظ†ط³ط®ط© ط§ظ„ظ…ط¹ط²ظˆظ„ط© (5001)
// T1 ط¯ظپط¹ ظ…ط²ط¯ظˆط¬ idempotent آ· T2 ط³ط¨ط§ظ‚ ط¢ط®ط± ظ‚ط·ط¹ط© آ· T4 ظ‚ط·ط¹ ظ…ظ†طھطµظپ ظ…ط¹ط§ظ…ظ„ط© (ط­طھظ…ظٹ ط¨ظ‚ظپظ„) آ· T3 ط³ط¨ط§ظ‚ ط±ظˆط§طھط¨
'use strict';
const https = require('https');
const { Client } = require('pg');

const BASE_HOST = '127.0.0.1';
const BASE_PORT = 5001;
const API_KEY = '110c4ed2acfb2f7ed50b7ec6b58b7df7261396888839936d';
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
    return new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Kimo20177', database: 'karim_erp_stage3' });
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
    // ط¯ط®ظˆظ„
    const login = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'karim@20177' } });
    let token = null;
    try { token = JSON.parse(login.b).access_token; } catch (_) {}
    if (!token) { console.error('LOGIN_FAIL', login.s, login.b.slice(0, 200)); process.exit(1); }
    console.log('LOGIN OK (clone server)');

    // â•گâ•گâ•گ T1: ط¯ظپط¹ ظ…ط²ط¯ظˆط¬ ط¨ظ†ظپط³ Idempotency-Key â•گâ•گâ•گ
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
        record('T1a ط¨ظٹط¹ ط¨ظ†ظپط³ ط§ظ„ظ…ظپطھط§ط­ ظ…ط±طھظٹظ† (replay)', r1.s === 201 && r2.s === 201, `r1=${r1.s} r2=${r2.s}`);
        record('T1b ط£ظ…ط± ط¨ظٹط¹ ظˆط§ط­ط¯ ظپظ‚ط· (ظ„ط§ ط§ط²ط¯ظˆط§ط¬)', orders[0].n === 1, `pos_orders=${orders[0].n}`);
        record('T1c ظ‚ظٹط¯ GL pos_sale ط£ظڈظ†ط´ط¦', glEntry.length === 1 && glEntry[0].status === 'posted', JSON.stringify(glEntry));
        record('T1d ط®طµظ… ظ…ظƒظˆظ† ظˆط§ط­ط¯ (2â†’1)', Number(qty[0].qty) === 1, `qty=${qty[0].qty}`);
    }

    // â•گâ•گâ•گ T2: ط³ط¨ط§ظ‚ ط¨ظٹط¹ ط¢ط®ط± ظ‚ط·ط¹ط© (ط§ظ„ظ…طھط¨ظ‚ظٹ 1طŒ ط·ظ„ط¨ط§ظ† ظ…طھط²ط§ظ…ظ†ط§ظ† qty=1) â•گâ•گâ•گ
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
        record('T2a ط¨ط§ظ„ط¶ط¨ط· 201 ظˆط§ط­ط¯ط© + 409 ظˆط§ط­ط¯ط©', ok === 1 && conflict === 1, `201=${ok} 409=${conflict} codes=${[ra.s, rb.s]}`);
        record('T2b ظ„ط§ ط±طµظٹط¯ ط³ط§ظ„ط¨ ظپظٹ ط§ظ„ط¯ظپطھط±', negLedger[0].n === 0 && Number(qty[0].qty) === 0, `on_hand=${bal[0]?.on_hand} qty=${qty[0].qty} negRows=${negLedger[0].n}`);
    }

    // â•گâ•گâ•گ T4: ظ‚ط·ط¹ ظ…ظ†طھطµظپ ط§ظ„ظ…ط¹ط§ظ…ظ„ط© (ط­طھظ…ظٹ: ظ‚ظپظ„ ط§ظ„ظˆط±ط¯ظٹط© ط«ظ… ظ‚طھظ„ ط§ظ„ط§طھطµط§ظ„) â•گâ•گâ•گ
    {
        await q(`UPDATE inventory SET qty=3 WHERE id=$1 RETURNING qty`, [ING]);
        await q(`UPDATE inventory_location_balances SET on_hand=3 WHERE inventory_id=$1 RETURNING on_hand`, [ING]);
        const c = dbClient();
        await c.connect();
        await c.query('BEGIN');
        await c.query(`SELECT id FROM pos_shift_sessions WHERE id=$1 FOR UPDATE`, [SHIFT]); // ط§ط­طھظƒط§ط± ظ‚ظپظ„ ط§ظ„ظˆط±ط¯ظٹط©
        const key = 'stage3-t4-' + Date.now();
        const salePromise = req('POST', '/api/sales/complete', { token, body: saleBody(1, 115), headers: { 'Idempotency-Key': key, 'x-shift-session-id': String(SHIFT) } });
        await new Promise(r => setTimeout(r, 1500)); // ط§ظ„ط¨ظٹط¹ ط§ظ„ط¢ظ† ط¹ط§ظ„ظ‚ ط¹ظ„ظ‰ ظ‚ظپظ„ ط§ظ„ظˆط±ط¯ظٹط© ط¯ط§ط®ظ„ ط§ظ„ظ…ط¹ط§ظ…ظ„ط©
        const killed = await c.query(
            `SELECT pg_terminate_backend(pid) AS ok, pid FROM pg_stat_activity
             WHERE datname='karim_erp_stage3' AND application_name <> 'pg' AND pid <> pg_backend_pid()
             AND query LIKE '%sales/complete%' OR (datname='karim_erp_stage3' AND state='idle in transaction' AND application_name <> 'pg' AND pid <> pg_backend_pid())`);
        await c.query('COMMIT'); // طھط­ط±ظٹط± ط§ظ„ظ‚ظپظ„
        const r = await salePromise; // ط³ظٹظپط´ظ„ ط¨ظ‚ط·ط¹ ط§طھطµط§ظ„ (57P01) ط£ظˆ ظٹظƒطھظ…ظ„ ط¥ظ† ظپط§طھ ط§ظ„طھظˆظ‚ظٹطھ
        await new Promise(r2 => setTimeout(r2, 500));
        const orders = await q(`SELECT count(*)::int AS n FROM pos_orders WHERE department_id=$1`, [DEPT]);
        const qty = await q(`SELECT qty FROM inventory WHERE id=$1`, [ING]);
        const killedCount = killed.rows.filter(x => x.ok).length;
        const interrupted = r.s === 0 || /57P01|ECONNRESET|terminated/.test(r.b);
        record('T4a ظ‚ظڈط·ط¹ ط§ظ„ط§طھطµط§ظ„ ط£ط«ظ†ط§ط، ط§ظ„ظ…ط¹ط§ظ…ظ„ط©', interrupted, `killed=${killedCount} resp=${r.s}`);
        record('T4b ط±ظˆظ„ط¨ط§ظƒ ظƒط§ظ…ظ„: ظ„ط§ ط£ظ…ط± ط¨ظٹط¹ ط¬ط¯ظٹط¯ ظˆظ„ط§ ط®طµظ…', orders[0].n === 3 && Number(qty[0].qty) === 3, `orders=${orders[0].n} qty=${qty[0].qty}`);
        // ط¥ط¹ط§ط¯ط© ط§ظ„ظ…ط­ط§ظˆظ„ط© ط¨ظ†ظپط³ ط§ظ„ظ…ظپطھط§ط­ ظٹط¬ط¨ ط£ظ† طھظ†ط¬ط­ ظ†ط¸ظٹظپط© (طµظپ idempotency طھط±ط§ط¬ط¹ ظ…ط¹ ط§ظ„ظ…ط¹ط§ظ…ظ„ط©)
        const retry = await req('POST', '/api/sales/complete', { token, body: saleBody(1, 115), headers: { 'Idempotency-Key': key, 'x-shift-session-id': String(SHIFT) } });
        const orders2 = await q(`SELECT count(*)::int AS n FROM pos_orders WHERE department_id=$1`, [DEPT]);
        record('T4c ط¥ط¹ط§ط¯ط© ط§ظ„ظ…ط­ط§ظˆظ„ط© ط¨ط¹ط¯ ط§ظ„ظ‚ط·ط¹ طھظ†ط¬ط­ ظ†ط¸ظٹظپط©', retry.s === 201 && orders2[0].n === 4, `retry=${retry.s} orders=${orders2[0].n}`);
        await c.end().catch(() => {});
    }

    // â•گâ•گâ•گ T3: ط³ط¨ط§ظ‚ طھظˆظ„ظٹط¯ ط±ظˆط§طھط¨ ظ…طھط²ط§ظ…ظ† (ظپط­طµ ط§ظ„ط®ط·ط± ط§ظ„ظ…ظˆط«ظ‚: ظ„ط§ UNIQUE) â•گâ•گâ•گ
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
        const emps = await q(`SELECT count(*)::int AS n FROM employees WHERE status<>'ظ…ظ†طھظ‡ظٹ'`);
        record('T3a ط§ط³طھط¬ط§ط¨طھط§ ط§ظ„طھظˆظ„ظٹط¯ ط§ظ„ظ…طھط²ط§ظ…ظ†', [p1, p2].every(x => [200, 201, 409, 423].includes(x.s)), `p1=${p1.s} p2=${p2.s}`);
        record('T3b ظپط­طµ ط§ظ„ط§ط²ط¯ظˆط§ط¬ (employeeId,month)', dup.length === 0, `dupes=${dup.length} rows=${total[0].n} employees=${emps[0].n}${dup.length ? ' â†گ ط§ظ„ط®ط·ط± ط§ظ„ظ…ظˆط«ظ‚ ظˆظ‚ط¹ ظپط¹ظ„ط§ظ‹' : ' â†گ ظ„ظ… ظٹظ‚ط¹ (ط§ظ„ط¥ط¯ط±ط§ط¬ ط³ط±ظٹط¹ ط§ظ„طھط³ظ„ط³ظ„ ط£ظˆ ط§ظ„ط­ط§ط±ط³ ظٹط¹ظ…ظ„)'}`);
    }

    console.log('\n=== ظ…ظ„ط®طµ ===');
    const failed = results.filter(r => !r.pass);
    console.log(`ط§ظ„ظ†طھظٹط¬ط©: ${results.length - failed.length}/${results.length} ظ†ط§ط¬ط­ط©`);
    process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });

