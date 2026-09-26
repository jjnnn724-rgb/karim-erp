require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const db = new Pool({
    user: process.env.DB_USER || 'postgres', host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'karim_erp', password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432, max: 4,
});
const q = (t, p) => db.query(t, p);
const one = async (t, p) => (await q(t, p)).rows[0];
(async () => {
    const RUN = 'probe' + Date.now().toString(36);
    const a = await one(`INSERT INTO inventory (id, name, category, unit, qty, "avgCost", "minQty")
         VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM inventory), $1,'فحص حمل','وحدة',55,2.5,0) RETURNING id`, [`مكون A ${RUN}`]);
    console.log('A result:', a);
    const b = await one(`INSERT INTO inventory (id, name, category, unit, qty, "avgCost", "minQty")
         VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM inventory), $1,'فحص حمل','وحدة',10,3.0,0)`, [`مكون B ${RUN}`]);
    console.log('B result:', b);
    // cleanup
    if (a?.id) {await q('DELETE FROM inventory WHERE id=$1', [a.id]);}
    if (b?.id) {await q('DELETE FROM inventory WHERE id=$1', [b.id]);}
    await db.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
