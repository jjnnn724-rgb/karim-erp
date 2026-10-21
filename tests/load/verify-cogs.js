// طھط­ظ‚ظ‚ V1 ظ†ظ‡ط§ط¦ظٹ ط¨ط¹ط¯ ط¥طµظ„ط§ط­ ط¥ط´ط§ط±ط© COGS: ط¨ظٹط¹ ط¬ط¯ظٹط¯ â†’ ظ‚ظٹط¯ ظٹط­ظˆظٹ 5000/1200 ظ…طھظˆط§ط²ظ†
'use strict';
const https = require('https');
const { Client } = require('pg');
const API_KEY = '110c4ed2acfb2f7ed50b7ec6b58b7df7261396888839936d';
function req(method, path, { token, body, headers = {} } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const r = https.request({ host: '127.0.0.1', port: 5002, path, method, rejectUnauthorized: false,
            headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY,
                ...(token ? { Authorization: 'Bearer ' + token } : {}),
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } },
            (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ s: res.statusCode, b })); });
        r.on('error', e => resolve({ s: 0, b: 'NET:' + e.message }));
        if (data) { r.write(data); }
        r.end();
    });
}
async function q(sql, params = []) {
    const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Kimo20177', database: 'karim_erp_drill' });
    await c.connect();
    try { return (await c.query(sql, params)).rows; } finally { await c.end().catch(() => {}); }
}
(async () => {
    await new Promise(r => setTimeout(r, 14000));
    const login = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'karim@20177' } });
    const token = JSON.parse(login.b).access_token;
    const before = (await q(`SELECT count(*)::int AS n FROM journal_entries WHERE source_type='pos_sale'`))[0].n;
    const sale = await req('POST', '/api/sales/complete', { token,
        body: { department_id: 99901, items: [{ product_id: 999001, quantity: 2, unit_price: 115, discount: 0 }], payments: [{ method: 'cash', amount: 264.50 }] },
        headers: { 'Idempotency-Key': 'v1fix-' + Date.now(), 'x-shift-session-id': '999001' } });
    await new Promise(r => setTimeout(r, 2500)); // ط§ظ†طھط¸ط§ط± ط§ظ„طھط±ط­ظٹظ„ post-commit
    const after = (await q(`SELECT count(*)::int AS n FROM journal_entries WHERE source_type='pos_sale'`))[0].n;
    const je = (await q(
        `SELECT e.entry_no, SUM(l.debit) dr, SUM(l.credit) cr,
                SUM(CASE WHEN l.account_code='5000' THEN l.debit END) AS cogs_dr,
                SUM(CASE WHEN l.account_code='1200' THEN l.credit END) AS inv_cr
         FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id
         WHERE e.source_type='pos_sale' GROUP BY e.entry_no ORDER BY e.entry_no DESC LIMIT 1`))[0];
    console.log('sale=' + sale.s + ' journals=' + before + '->' + after);
    console.log('latest journal:', JSON.stringify(je));
    const ok = sale.s === 201 && after === before + 1 && Number(je.cogs_dr) === 20 && Number(je.inv_cr) === 30
        && Math.abs(Number(je.dr) - Number(je.cr)) <= 0.01;
    console.log(ok ? 'V1_COGS_VERIFIED (dr=cr, cogs=20=2x10, inventory credited)' : 'V1_STILL_FAILING');
    process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });


