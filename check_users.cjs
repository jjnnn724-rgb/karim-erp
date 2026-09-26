const { pool } = require('./backend/shared-pool');
(async () => {
  try {
    const r = await pool.query(`SELECT id, username, role, name, active, password, must_change_password,
      CASE WHEN password ~ '^\\$2[aby]\\$' THEN 'BCRYPT_OK' ELSE 'NOT_BCRYPT' END as pw_status
      FROM users ORDER BY id ASC LIMIT 15;`);
    console.log('\n========== USERS TABLE SAMPLE (15 rows) ==========');
    console.log('id | username       | role        | active | pw_status           | must_change | name');
    console.log('---+----------------+-------------+--------+---------------------+-------------+-----------------');
    for (const u of r.rows) {
      const s = `${String(u.id).padStart(2)} | ${u.username.padEnd(14)} | ${(u.role||'').padEnd(11)} | ${String(u.active).padEnd(6)} | ${u.pw_status.padEnd(19)} | ${String(u.must_change_password).padEnd(11)} | ${u.name}`;
      console.log(s);
    }
    console.log(`\nTotal: ${r.rows.length} shown. Running password count...`);
    const c = await pool.query(`SELECT COUNT(*)::int as total,
      SUM(CASE WHEN password ~ '^\\$2[aby]\\$' THEN 1 ELSE 0 END)::int as bcrypt_count,
      SUM(CASE WHEN active THEN 1 ELSE 0 END)::int as active_count
      FROM users;`);
    console.log(`  Total users: ${c.rows[0].total}`);
    console.log(`  BCRYPT:     ${c.rows[0].bcrypt_count}`);
    console.log(`  Not bcrypt: ${c.rows[0].total - c.rows[0].bcrypt_count}`);
    console.log(`  Active:     ${c.rows[0].active_count}`);
    if ((c.rows[0].total - c.rows[0].bcrypt_count) > 0) {
      const bad = await pool.query(`SELECT id, username, role, name FROM users WHERE password !~ '^\\$2[aby]\\$' ORDER BY id LIMIT 8;`);
      console.log('\n⚠ NON-BCRYPT USERS (first 8):');
      for (const u of bad.rows) console.log(`   ID ${u.id}: @${u.username} (${u.role}) - ${u.name}`);
    }
    process.exit(0);
  } catch (e) {
    console.error('DB ERROR:', e.message);
    process.exit(1);
  }
})();
