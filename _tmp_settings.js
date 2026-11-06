const { pool } = require('./backend/shared-pool');
const { resolvePunchSettings } = require('./backend/punch-portal-logic');
(async () => {
  const r = await pool.query('SELECT key, value, updated_at FROM punch_settings ORDER BY key');
  console.log('LIVE punch_settings:');
  for (const x of r.rows) console.log(`  ${x.key} = ${x.value}`);
  const s = resolvePunchSettings(r.rows, process.env);
  console.log('RESOLVED:', JSON.stringify(s));
  const n = await pool.query(`SELECT decision, COUNT(*) c FROM punch_attempts WHERE attempted_at>='2026-10-01' GROUP BY 1`);
  console.log('ATTEMPTS Oct+:', JSON.stringify(n.rows));
  const codes = await pool.query(`SELECT reject_code, COUNT(*) c FROM punch_attempts WHERE decision='rejected' AND attempted_at>='2026-10-01' GROUP BY 1 ORDER BY 2 DESC`);
  console.log('REJECT CODES:', JSON.stringify(codes.rows));
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
