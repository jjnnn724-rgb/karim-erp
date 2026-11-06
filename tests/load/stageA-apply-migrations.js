'use strict';
/* تطبيق 136 + 137 على karim_erp_staging فقط — مع تسجيل السجل
   القاعدة مكتوبة نصًّا هنا (لا DB_NAME): لا نسخة من هذا الملف تعمل على الإنتاج.
   الإنتاج: node database/scripts/run-migration.js بقرار مالك + نسخة احتياطية.
   القفل advisory بمفاتيح ثابتة يُسلسل من يشارك نفس المفاتيح فقط (ليس قفل
   run-migration.js — ذاك ملف MIGRATION_LOCK)، وهو كافٍ هنا لأن staging لا يشاركه أحد. */
const fs = require('fs');
const { Client } = require('pg');
require('../../backend/shared-pool');
const DIR = require('path').join(__dirname, '..', '..', 'database', 'migrations') + '/';
const files = process.argv.slice(2);
(async () => {
    const c = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: 'karim_erp_staging' });
    await c.connect();
    await c.query('SELECT pg_advisory_lock(1262796881, 1296647506)');
    try {
        for (const f of files) {
            const has = (await c.query('SELECT 1 FROM schema_migrations WHERE version = $1', [f])).rows[0];
            if (has) { console.log(`SKIP ${f} (مُسجّل مسبقًا)`); continue; }
            const sql = fs.readFileSync(DIR + f, 'utf8');
            const t0 = Date.now();
            await c.query(sql);
            await c.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', [f]);
            console.log(`APPLIED ${f} (${Date.now() - t0} ms)`);
        }
    } finally {
        await c.query('SELECT pg_advisory_unlock(1262796881, 1296647506)');
        await c.end();
    }
})().catch(e => { console.error('FAILED', e.message.slice(0, 400)); process.exit(1); });
