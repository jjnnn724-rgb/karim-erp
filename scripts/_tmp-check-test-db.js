'use strict';
/* مؤقت: فحص وجود قاعدة الاختبار المعزولة (قراءة فقط) */
require('dotenv').config();
const { Client } = require('pg');
(async () => {
    const c = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: 'postgres',
    });
    await c.connect();
    const r = await c.query("SELECT datname FROM pg_database WHERE datname LIKE 'karim%' ORDER BY 1");
    console.log(r.rows.map((x) => x.datname).join('\n'));
    await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
