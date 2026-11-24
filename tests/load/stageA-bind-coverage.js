'use strict';
/**
 * stageA-bind-coverage.js — تغطية وسائط العبارات الستّ الثابتة في journal-void.js
 * ─────────────────────────────────────────────────────────────────────────────
 * V12 يبني SQL بـfake ولا يربطه بقاعدة، فمسار ما قبل 137 (وسائط أقل) لا يُنفّذ
 * فعلًا إلا على قاعدة غير مهاجرة. هنا يُربط كل فرع فعليًا: staging (مُهاجرة 137)
 * وkarim_erp_test (غير مُهاجرة)، وكل عبارة داخل معاملة مجهَضة — لا كتابة تبقى.
 * PostgreSQL يرفض الربط إن زادت الوسائط عمّا تذكره الجملة (08P01)، فهذه بوابة
 * صامتة كانت ستُجهض كل إبطال على قاعدة غير مهاجرة لو غلط الترقيم.
 */
const { Client } = require('pg');
require('../../backend/shared-pool');
const JV = require('../../backend/journal-void');

const CASES = [
    { name: 'voidSourceJournals(مرجع دقيق)', run: (c) => JV.voidSourceJournals(c, { sourceType: 'expense', sourceIds: '1', reason: 'r', actor: 'a', actorUserId: 1 }) },
    { name: 'voidSourceJournals(matchPrefix)', run: (c) => JV.voidSourceJournals(c, { sourceType: 'expense', sourceIds: ['1', '2'], matchPrefix: true, reason: 'r', actor: 'a', actorUserId: 1 }) },
    { name: 'voidJournalById', run: (c) => JV.voidJournalById(c, { entryId: 1, reason: 'r', actor: 'a', actorUserId: 1 }) },
];

(async () => {
    let fails = 0;
    for (const dbname of ['karim_erp_staging', 'karim_erp_test']) {
        const c = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: dbname });
        await c.connect();
        const cols = (await c.query(
            `SELECT COUNT(*)::int n FROM information_schema.columns
              WHERE table_catalog = current_database() AND table_name = 'journal_entries' AND column_name = 'voided_at'`)).rows[0].n;
        console.log(`\n── ${dbname} (أعمدة الإبطال: ${cols ? 'موجودة ⇒ فرع 137' : 'غائبة ⇒ فرع ما قبل 137'})`);
        for (const t of CASES) {
            await c.query('BEGIN');
            try {
                const out = await t.run(c);
                console.log(`   ✓ ${t.name} — ربط مقبول (voided=${out.voided})`);
            } catch (e) {
                fails++;
                console.log(`   ✗ ${t.name} — ${e.code || ''} ${e.message.slice(0, 160)}`);
            } finally {
                await c.query('ROLLBACK').catch(() => {});
            }
        }
        await c.end();
    }
    if (fails) {console.error(`RESULT ❌ ${fails} عبارة رفضت الربط`); process.exit(1);}
    console.log('\nRESULT ✅ كل العبارات تربط وسائطها على قاعدة مُهاجرة وغير مُهاجرة');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
