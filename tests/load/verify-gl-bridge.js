// التحقق من جسر يارسوفت اللحظي (R3) على drill — نسخة نظيفة
'use strict';
const pool = new (require('pg').Pool)({ host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.LOADTEST_PG_PASSWORD || process.env.PGPASSWORD || '', database: 'karim_erp_drill', max: 3 });
let failed = 0;
const record = (n, ok, d) => { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + n + ' | ' + d); if (!ok) { failed++; } };
const q = async (sql, params) => (await pool.query(sql, params)).rows;

(async () => {
    await pool.connect();
    const { bridgeRevenueToGl } = require('C:/Users/RemoteHome/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/backend/yarasoft/gl-bridge.js');
    const today = new Date().toISOString().slice(0, 10);

    // B1: صف إيراد اليوم → قيد Dr 1000 / Cr 4000 متوازن
    const rid1 = 990000001;
    await pool.query(`INSERT INTO revenues (id, "deptId", source, amount, date, notes) VALUES ($1,'kitchen','كاشير 1',230.00,CURRENT_DATE,'اختبار جسر R3') ON CONFLICT (id) DO NOTHING`, [rid1]);
    const out1 = await bridgeRevenueToGl(pool, { revenueId: rid1, source: 'كاشير 1', amount: 230.00, date: today });
    const je1 = (await q(`SELECT SUM(l.debit) dr, SUM(l.credit) cr,
            SUM(CASE WHEN l.account_code='1000' THEN l.debit END) cash_dr,
            SUM(CASE WHEN l.account_code='4000' THEN l.credit END) rev_cr
         FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id
         WHERE e.source_type='yarasoft_revenue' AND e.source_id=$1`, [String(rid1)]))[0];
    record('B1 صف إيراد → قيد متوازن 1000/4000', !out1.skipped && Math.abs(Number(je1.dr) - Number(je1.cr)) <= 0.01 && Number(je1.cash_dr) === 230 && Number(je1.rev_cr) === 230, `entry=${out1.entry ? out1.entry.entry_no : '(replay)'} dr=${je1.dr} cr=${je1.cr}`);

    // B2: إعادة الجسر → replay بلا ازدواج
    const before = (await q(`SELECT count(*)::int n FROM journal_entries WHERE source_type='yarasoft_revenue' AND source_id=$1`, [String(rid1)]))[0].n;
    const out2 = await bridgeRevenueToGl(pool, { revenueId: rid1, source: 'كاشير 1', amount: 230.00, date: today });
    const after = (await q(`SELECT count(*)::int n FROM journal_entries WHERE source_type='yarasoft_revenue' AND source_id=$1`, [String(rid1)]))[0].n;
    record('B2 إعادة الجسر → replay بلا ازدواج', out2.replay === true && before === 1 && after === 1, `replay=${out2.replay} entries=${after}`);

    // B3: تاريخ قبل القطع → skipped
    const rid3 = 990000003;
    await pool.query(`INSERT INTO revenues (id, "deptId", source, amount, date, notes) VALUES ($1,'kitchen','كاشير 4',100.00,'2026-09-15','تاريخي') ON CONFLICT (id) DO NOTHING`, [rid3]);
    const out3 = await bridgeRevenueToGl(pool, { revenueId: rid3, source: 'كاشير 4', amount: 100, date: '2026-09-15' });
    record('B3 تاريخ قبل القطع → skipped', out3.skipped === 'before_cutover', JSON.stringify(out3));

    // B4: مبلط؛ غير موجب → skipped
    const out4 = await bridgeRevenueToGl(pool, { revenueId: 990000004, source: 'x', amount: 0, date: today });
    record('B4 مبلط؛ غير موجب → skipped', out4.skipped === 'non_positive_amount', JSON.stringify(out4));

    console.log(failed === 0 ? 'GL_BRIDGE_VERIFIED' : 'BRIDGE_FAILING');
    await pool.end();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });

