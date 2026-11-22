// التحقق من قيود 095 على drill (نسخة نظيفة — أرقام فريدة لكل تشغيل)
'use strict';
const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: process.env.LOADTEST_PG_PASSWORD || process.env.PGPASSWORD || '', database: 'karim_erp_drill' });
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
    // T1: منشور بلا أسطر → مرفوض عند الالتزام
    await attempt('T1 قيد posted بلا أسطر يُرفض', true, `
        INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status)
        VALUES (${nextId(1)}, 'JE-T-${stamp}-1', CURRENT_DATE, 'test', 'manual', 'm095-${stamp}-1', 'posted')`);
    // T2: منشور متوازن بسطرين → مقبول
    await attempt('T2 قيد posted متوازن يُقبل', false, `
        WITH e AS (INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status)
            VALUES (${nextId(2)}, 'JE-T-${stamp}-2', CURRENT_DATE, 'test', 'manual', 'm095-${stamp}-2', 'posted') RETURNING id)
        INSERT INTO journal_lines (id, entry_id, account_code, debit, credit)
        SELECT (SELECT COALESCE(MAX(id),0)+1 FROM journal_lines), e.id, '1000', 50, 0 FROM e
        UNION ALL SELECT (SELECT COALESCE(MAX(id),0)+2 FROM journal_lines), e.id, '4000', 0, 50 FROM e`);
    // T2b: منشور غير متوازن بسطرين → مرفوض عند الالتزام
    await attempt('T2b قيد posted غير متوازن (سطران) يُرفض', true, `
        WITH e AS (INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status)
            VALUES (${nextId(3)}, 'JE-T-${stamp}-2b', CURRENT_DATE, 'test', 'manual', 'm095-${stamp}-2b', 'posted') RETURNING id)
        INSERT INTO journal_lines (id, entry_id, account_code, debit, credit)
        SELECT (SELECT COALESCE(MAX(id),0)+1 FROM journal_lines), e.id, '1000', 50, 0 FROM e
        UNION ALL SELECT (SELECT COALESCE(MAX(id),0)+2 FROM journal_lines), e.id, '4000', 0, 30 FROM e`);
    // T3: تعديل هوية منشور → مرفوض
    await attempt('T3 تعديل memo قيد منشور يُرفض', true, `
        UPDATE journal_entries SET memo = 'تلاعب ' || '${stamp}'
        WHERE id = (SELECT id FROM journal_entries WHERE status='posted' ORDER BY id LIMIT 1)`);
    // T4: تغيير status → مسموح
    await attempt('T4 تغيير status (posted→void) مسموح', false, `
        UPDATE journal_entries SET status='void'
        WHERE id = (SELECT id FROM journal_entries WHERE status='posted' ORDER BY id DESC LIMIT 1)`);
    // T5: مسودة غير متوازنة → مقبولة (تصميم)
    await attempt('T5 مسودة بلا أسطر مقبولة (تصميم)', false, `
        INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status)
        VALUES (${nextId(4)}, 'JE-T-${stamp}-5', CURRENT_DATE, 'test', 'manual', 'm095-${stamp}-5', 'draft')`);
    console.log(failed === 0 ? 'DB_INVARIANTS_VERIFIED' : 'INVARIANTS_FAILING');
    await c.end();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });

