const bcrypt = require('bcryptjs');
const { pool } = require('../../backend/shared-pool');

// ─── الإصلاح 2026-11-04 (N2): لا كلمات مرور في الكود المتتبَّع ─────────────
// كانت هذه الأداة تطبع وتُعيد ضبط كلمات مرور حقيقية (Admin@2026 / Karim2026)
// من ملف متتبَّع. الآن كل القيم تأتي من البيئة حصريًا — وبلاها تتوقّف.
//
// الاستخدام:
//   $env:RESET_CANDIDATES='[{"username":"admin","passwords":["..."]}]'
//   $env:RESET_TARGETS='[{"username":"admin","password":"..."}]'
//   node tools/legacy/reset_passwords.cjs
const candidates = JSON.parse(process.env.RESET_CANDIDATES || '[]');
const targets = JSON.parse(process.env.RESET_TARGETS || '[]');

if (!Array.isArray(candidates) || !Array.isArray(targets) || (!candidates.length && !targets.length)) {
    console.error('RESET_CANDIDATES / RESET_TARGETS غير مضبوطين (JSON) — أُلغي التنفيذ (لا كلمات مرور في الكود).');
    process.exit(1);
}

(async () => {
  try {
    console.log('========== BCRYPT PASSWORD VERIFICATION ==========\n');
    for (const t of candidates) {
      const r = await pool.query('SELECT id, username, password, role, name FROM users WHERE LOWER(username)=LOWER($1)', [t.username]);
      if (r.rows.length === 0) { console.log(`@${t.username}: NOT FOUND`); continue; }
      const u = r.rows[0];
      console.log(`\n@${t.username} (ID=${u.id}, role=${u.role}, name=${u.name})`);
      console.log(`  Stored hash prefix: ${u.password.substring(0, 12)}...`);
      let anyMatch = false;
      for (const pw of (t.passwords || [])) {
        const ok = await bcrypt.compare(pw, u.password);
        console.log(`    bcrypt.compare(<candidate ${pw.length} chars>) => ${ok ? '✅ MATCH' : '❌ no match'}`);
        if (ok) anyMatch = true;
      }
      if (!anyMatch) console.log(`  ⚠ NO MATCH for ${t.username} with any tested password. Needs reset!`);
    }

    console.log('\n\n========== RESETTING PASSWORDS (from RESET_TARGETS) ==========');
    for (const t of targets) {
      const newHash = await bcrypt.hash(t.password, 12);
      const up = await pool.query('UPDATE users SET password=$1, must_change_password=FALSE WHERE username=$2 RETURNING id, username', [newHash, t.username]);
      console.log(`  @${t.username}: rows=${up.rowCount}`);
      if (up.rows.length > 0) {
        const v = await bcrypt.compare(t.password, newHash);
        console.log(`  Verify new hash: ${v ? 'OK' : 'FAIL'}`);
      }
    }
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
})();
