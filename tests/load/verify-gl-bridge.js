// ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط¬ط³ط± ظٹط§ط±ط³ظˆظپطھ ط§ظ„ظ„ط­ط¸ظٹ (R3) ط¹ظ„ظ‰ drill â€” ظ†ط³ط®ط© ظ†ط¸ظٹظپط©
'use strict';
const pool = new (require('pg').Pool)({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Kimo20177', database: 'karim_erp_drill', max: 3 });
let failed = 0;
const record = (n, ok, d) => { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + n + ' | ' + d); if (!ok) { failed++; } };
const q = async (sql, params) => (await pool.query(sql, params)).rows;

(async () => {
    await pool.connect();
    const { bridgeRevenueToGl } = require('C:/Users/RemoteHome/Desktop/k/karimabdelhamedeldsouky/karimabdelhamed12/karim-erp/backend/yarasoft/gl-bridge.js');
    const today = new Date().toISOString().slice(0, 10);

    // B1: طµظپ ط¥ظٹط±ط§ط¯ ط§ظ„ظٹظˆظ… â†’ ظ‚ظٹط¯ Dr 1000 / Cr 4000 ظ…طھظˆط§ط²ظ†
    const rid1 = 990000001;
    await pool.query(`INSERT INTO revenues (id, "deptId", source, amount, date, notes) VALUES ($1,'kitchen','ظƒط§ط´ظٹط± 1',230.00,CURRENT_DATE,'ط§ط®طھط¨ط§ط± ط¬ط³ط± R3') ON CONFLICT (id) DO NOTHING`, [rid1]);
    const out1 = await bridgeRevenueToGl(pool, { revenueId: rid1, source: 'ظƒط§ط´ظٹط± 1', amount: 230.00, date: today });
    const je1 = (await q(`SELECT SUM(l.debit) dr, SUM(l.credit) cr,
            SUM(CASE WHEN l.account_code='1000' THEN l.debit END) cash_dr,
            SUM(CASE WHEN l.account_code='4000' THEN l.credit END) rev_cr
         FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id
         WHERE e.source_type='yarasoft_revenue' AND e.source_id=$1`, [String(rid1)]))[0];
    record('B1 طµظپ ط¥ظٹط±ط§ط¯ â†’ ظ‚ظٹط¯ ظ…طھظˆط§ط²ظ† 1000/4000', !out1.skipped && Math.abs(Number(je1.dr) - Number(je1.cr)) <= 0.01 && Number(je1.cash_dr) === 230 && Number(je1.rev_cr) === 230, `entry=${out1.entry ? out1.entry.entry_no : '(replay)'} dr=${je1.dr} cr=${je1.cr}`);

    // B2: ط¥ط¹ط§ط¯ط© ط§ظ„ط¬ط³ط± â†’ replay ط¨ظ„ط§ ط§ط²ط¯ظˆط§ط¬
    const before = (await q(`SELECT count(*)::int n FROM journal_entries WHERE source_type='yarasoft_revenue' AND source_id=$1`, [String(rid1)]))[0].n;
    const out2 = await bridgeRevenueToGl(pool, { revenueId: rid1, source: 'ظƒط§ط´ظٹط± 1', amount: 230.00, date: today });
    const after = (await q(`SELECT count(*)::int n FROM journal_entries WHERE source_type='yarasoft_revenue' AND source_id=$1`, [String(rid1)]))[0].n;
    record('B2 ط¥ط¹ط§ط¯ط© ط§ظ„ط¬ط³ط± â†’ replay ط¨ظ„ط§ ط§ط²ط¯ظˆط§ط¬', out2.replay === true && before === 1 && after === 1, `replay=${out2.replay} entries=${after}`);

    // B3: طھط§ط±ظٹط® ظ‚ط¨ظ„ ط§ظ„ظ‚ط·ط¹ â†’ skipped
    const rid3 = 990000003;
    await pool.query(`INSERT INTO revenues (id, "deptId", source, amount, date, notes) VALUES ($1,'kitchen','ظƒط§ط´ظٹط± 4',100.00,'2026-09-15','طھط§ط±ظٹط®ظٹ') ON CONFLICT (id) DO NOTHING`, [rid3]);
    const out3 = await bridgeRevenueToGl(pool, { revenueId: rid3, source: 'ظƒط§ط´ظٹط± 4', amount: 100, date: '2026-09-15' });
    record('B3 طھط§ط±ظٹط® ظ‚ط¨ظ„ ط§ظ„ظ‚ط·ط¹ â†’ skipped', out3.skipped === 'before_cutover', JSON.stringify(out3));

    // B4: ظ…ط¨ظ„ط؛ ط؛ظٹط± ظ…ظˆط¬ط¨ â†’ skipped
    const out4 = await bridgeRevenueToGl(pool, { revenueId: 990000004, source: 'x', amount: 0, date: today });
    record('B4 ظ…ط¨ظ„ط؛ ط؛ظٹط± ظ…ظˆط¬ط¨ â†’ skipped', out4.skipped === 'non_positive_amount', JSON.stringify(out4));

    console.log(failed === 0 ? 'GL_BRIDGE_VERIFIED' : 'BRIDGE_FAILING');
    await pool.end();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });

