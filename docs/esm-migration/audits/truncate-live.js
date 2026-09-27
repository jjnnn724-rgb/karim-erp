const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Kimo20177', database: 'karim_erp' });
  await c.connect();
  const t = await c.query("SELECT string_agg('\"' || table_name || '\"', ', ' ORDER BY table_name) AS list FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> 'settings'");
  await c.query('TRUNCATE TABLE ' + t.rows[0].list + ' RESTART IDENTITY CASCADE');
  console.log('live tables truncated (settings preserved)');
  const check = await c.query("SELECT (SELECT count(*) FROM users) u, (SELECT count(*) FROM employees) e, (SELECT count(*) FROM settings) s");
  console.log('after truncate → users:', check.rows[0].u, '| employees:', check.rows[0].e, '| settings:', check.rows[0].s);
  await c.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
