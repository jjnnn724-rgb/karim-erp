// ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظ‚ظٹظˆط¯ 095 ط¹ظ„ظ‰ drill (ظ†ط³ط®ط© ظ†ط¸ظٹظپط© â€” ط£ط±ظ‚ط§ظ… ظپط±ظٹط¯ط© ظ„ظƒظ„ طھط´ط؛ظٹظ„)
'use strict';
const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Kimo20177', database: 'karim_erp_drill' });
let failed = 0;
const record = (n, ok, d) => { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + n + ' | ' + d); if (!ok) { failed++; } };
const stamp = Date.now().toString(36).toUpperCase();
async function attempt(name, expectError, sql) {
    try {
        await c.query('BEGIN');
        await c.query(sql);
        await c.query('COMMIT');
        record(name, !expectError, 'accepted');
        return true;
    } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        record(name, expectError, e.message.slice(0, 100));
        return false;
    }
}
(async () => {
    await c.connect();
    const nextId = (off) => `(SELECT COALESCE(MAX(id),0)+${off} FROM journal_entries)`;
    // T1: ظ…ظ†ط´ظˆط± ط¨ظ„ط§ ط£ط³ط·ط± â†’ ظ…ط±ظپظˆط¶ ط¹ظ†ط¯ ط§ظ„ط§ظ„طھط²ط§ظ…
    await attempt('T1 ظ‚ظٹط¯ posted ط¨ظ„ط§ ط£ط³ط·ط± ظٹظڈط±ظپط¶', true, `
        INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status)
        VALUES (${nextId(1)}, 'JE-T-${stamp}-1', CURRENT_DATE, 'test', 'manual', 'm095-${stamp}-1', 'posted')`);
    // T2: ظ…ظ†ط´ظˆط± ظ…طھظˆط§ط²ظ† ط¨ط³ط·ط±ظٹظ† â†’ ظ…ظ‚ط¨ظˆظ„
    await attempt('T2 ظ‚ظٹط¯ posted ظ…طھظˆط§ط²ظ† ظٹظڈظ‚ط¨ظ„', false, `
        WITH e AS (INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status)
            VALUES (${nextId(2)}, 'JE-T-${stamp}-2', CURRENT_DATE, 'test', 'manual', 'm095-${stamp}-2', 'posted') RETURNING id)
        INSERT INTO journal_lines (id, entry_id, account_code, debit, credit)
        SELECT (SELECT COALESCE(MAX(id),0)+1 FROM journal_lines), e.id, '1000', 50, 0 FROM e
        UNION ALL SELECT (SELECT COALESCE(MAX(id),0)+2 FROM journal_lines), e.id, '4000', 0, 50 FROM e`);
    // T2b: ظ…ظ†ط´ظˆط± ط؛ظٹط± ظ…طھظˆط§ط²ظ† ط¨ط³ط·ط±ظٹظ† â†’ ظ…ط±ظپظˆط¶ ط¹ظ†ط¯ ط§ظ„ط§ظ„طھط²ط§ظ…
    await attempt('T2b ظ‚ظٹط¯ posted ط؛ظٹط± ظ…طھظˆط§ط²ظ† (ط³ط·ط±ط§ظ†) ظٹظڈط±ظپط¶', true, `
        WITH e AS (INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status)
            VALUES (${nextId(3)}, 'JE-T-${stamp}-2b', CURRENT_DATE, 'test', 'manual', 'm095-${stamp}-2b', 'posted') RETURNING id)
        INSERT INTO journal_lines (id, entry_id, account_code, debit, credit)
        SELECT (SELECT COALESCE(MAX(id),0)+1 FROM journal_lines), e.id, '1000', 50, 0 FROM e
        UNION ALL SELECT (SELECT COALESCE(MAX(id),0)+2 FROM journal_lines), e.id, '4000', 0, 30 FROM e`);
    // T3: طھط¹ط¯ظٹظ„ ظ‡ظˆظٹط© ظ…ظ†ط´ظˆط± â†’ ظ…ط±ظپظˆط¶
    await attempt('T3 طھط¹ط¯ظٹظ„ memo ظ‚ظٹط¯ ظ…ظ†ط´ظˆط± ظٹظڈط±ظپط¶', true, `
        UPDATE journal_entries SET memo = 'طھظ„ط§ط¹ط¨ ' || '${stamp}'
        WHERE id = (SELECT id FROM journal_entries WHERE status='posted' ORDER BY id LIMIT 1)`);
    // T4: طھط؛ظٹظٹط± status â†’ ظ…ط³ظ…ظˆط­
    await attempt('T4 طھط؛ظٹظٹط± status (postedâ†’void) ظ…ط³ظ…ظˆط­', false, `
        UPDATE journal_entries SET status='void'
        WHERE id = (SELECT id FROM journal_entries WHERE status='posted' ORDER BY id DESC LIMIT 1)`);
    // T5: ظ…ط³ظˆط¯ط© ط؛ظٹط± ظ…طھظˆط§ط²ظ†ط© â†’ ظ…ظ‚ط¨ظˆظ„ط© (طھطµظ…ظٹظ…)
    await attempt('T5 ظ…ط³ظˆط¯ط© ط¨ظ„ط§ ط£ط³ط·ط± ظ…ظ‚ط¨ظˆظ„ط© (طھطµظ…ظٹظ…)', false, `
        INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status)
        VALUES (${nextId(4)}, 'JE-T-${stamp}-5', CURRENT_DATE, 'test', 'manual', 'm095-${stamp}-5', 'draft')`);
    console.log(failed === 0 ? 'DB_INVARIANTS_VERIFIED' : 'INVARIANTS_FAILING');
    await c.end();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });

