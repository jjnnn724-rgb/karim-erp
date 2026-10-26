const bcrypt = require('bcryptjs');
const { pool } = require('./backend/shared-pool');

const TEST_USERS = [
  { username: 'admin',   testPasswords: ['admin123', 'Karim2026', 'admin', 'Admin@2026'] },
  { username: 'emp-001', testPasswords: ['Karim2026', 'emp-001', '123456'] },
];

(async () => {
  try {
    console.log('========== BCRYPT PASSWORD VERIFICATION ==========\n');
    for (const t of TEST_USERS) {
      const r = await pool.query('SELECT id, username, password, role, name FROM users WHERE LOWER(username)=LOWER($1)', [t.username]);
      if (r.rows.length === 0) { console.log(`@${t.username}: NOT FOUND`); continue; }
      const u = r.rows[0];
      console.log(`\n@${t.username} (ID=${u.id}, role=${u.role}, name=${u.name})`);
      console.log(`  Stored hash prefix: ${u.password.substring(0, 12)}...`);
      let anyMatch = false;
      for (const pw of t.testPasswords) {
        const ok = await bcrypt.compare(pw, u.password);
        console.log(`    bcrypt.compare("${pw}") => ${ok ? '✅ MATCH' : '❌ no match'}`);
        if (ok) anyMatch = true;
      }
      if (!anyMatch) console.log(`  ⚠ NO MATCH for ${t.username} with any tested password. Needs reset!`);
    }

    console.log('\n\n========== RESETTING ADMIN PASSWORD to Admin@2026 ==========');
    const newHash = await bcrypt.hash('Admin@2026', 12);
    const up = await pool.query('UPDATE users SET password=$1, must_change_password=FALSE WHERE username=$2 RETURNING id, username', [newHash, 'admin']);
    console.log(`  Reset rows affected: ${up.rowCount}`);
    if (up.rows.length > 0) {
      const v = await bcrypt.compare('Admin@2026', newHash);
      console.log(`  Verify new hash: ${v ? 'OK' : 'FAIL'}`);
      console.log(`  ✅ ADMIN PASSWORD RESET SUCCESSFULLY → username: admin, password: Admin@2026`);
    }

    console.log('\n\n========== RESETTING EMP-001 PASSWORD to Karim2026 ==========');
    const eHash = await bcrypt.hash('Karim2026', 12);
    const up2 = await pool.query('UPDATE users SET password=$1, must_change_password=FALSE WHERE username=$2 RETURNING id, username', [eHash, 'emp-001']);
    console.log(`  Reset rows affected: ${up2.rowCount}`);
    if (up2.rows.length > 0) {
      console.log(`  ✅ EMP-001 PASSWORD RESET SUCCESSFULLY → username: emp-001, password: Karim2026`);
    }
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
})();
