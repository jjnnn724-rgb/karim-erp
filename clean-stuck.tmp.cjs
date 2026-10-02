// clean-stuck-items.tmp.cjs — تنظيف أصناف الاختبار الثلاثة المعلقة عبر المسار المخصص force.
const fs = require('fs');
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
}
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const jwt = require('jsonwebtoken');
const TOKEN = jwt.sign({ sub: '1', role: 'admin', name: 'مدير النظام', sid: null, pwd_change: false }, process.env.JWT_ACCESS_SECRET, { expiresIn: '10m', algorithm: 'HS256' });
const HDRS = { Authorization: `Bearer ${TOKEN}`, 'x-api-key': process.env.API_KEY || '' };
const { Client } = require('pg');
(async () => {
    const c = new Client({ host: '127.0.0.1', port: 5432, database: 'karim_erp', user: 'postgres', password: process.env.DB_PASSWORD });
    await c.connect();
    const stuck = (await c.query("SELECT id, name FROM inventory WHERE name LIKE '\\_\\_CRUD\\_E2E%' ESCAPE '\\' OR name LIKE '\\_\\_DEL500%'")).rows;
    for (const it of stuck) {
        const r = await fetch('https://127.0.0.1:5000/api/warehouse/inventory/' + it.id + '/force', { method: 'DELETE', headers: HDRS });
        console.log(it.name, '→', r.status, r.status === 200 ? 'محذوف عبر المسار المخصص ✅' : await r.text().then((t) => t.slice(0, 100)));
    }
    const left = (await c.query("SELECT COUNT(*)::int AS n FROM inventory WHERE name LIKE '\\_\\_CRUD%' OR name LIKE '\\_\\_DEL500%'")).rows[0].n;
    console.log('متبقي:', left);
    await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
