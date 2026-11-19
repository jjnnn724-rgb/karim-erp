// reset-admin-pw.js — one-off: reset admin password to a known demo value
const bcrypt = require('bcryptjs');
const { Client } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

(async () => {
    const PW = process.argv[2] || 'Karim2026Demo';
    const hash = bcrypt.hashSync(PW, 12);
    const c = new Client({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'karim_erp',
    });
    await c.connect();
    await c.query(
        `UPDATE users SET password=$1, must_change_password=false, active=true WHERE username='admin'`,
        [hash]
    );
    const r = await c.query(`SELECT username, role, active FROM users WHERE username='admin'`);
    console.log('UPDATED:', JSON.stringify(r.rows[0]));
    // verify
    const v = await c.query(`SELECT password FROM users WHERE username='admin'`);
    console.log('VERIFY:', bcrypt.compareSync(PW, v.rows[0].password));
    await c.end();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
