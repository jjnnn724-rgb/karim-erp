// Protect ys_b4_ext revenues from UPDATE/DELETE by YaraSoft sync
// Runs once to install the trigger
const { pool } = require('./backend/shared-pool.js');

const TRIGGERS = [
  // ─── revenues: prevent UPDATE/DELETE on ys_b4_ext rows ───
  {
    name: 'protect_ys_b4_ext_revenues',
    table: 'revenues',
    sql: `
CREATE OR REPLACE FUNCTION protect_ys_b4_ext_revenues() RETURNS TRIGGER AS $$
BEGIN
    IF OLD."deptId" = 'ys_b4_ext' THEN
        RAISE EXCEPTION ' yy_b4_ext protected: لا يمكن تعديل أو حذف إيرادات بيع خارجي (من استيراد YaraSoft)';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`
  },
  {
    name: 'trg_protect_ys_b4_ext_revenues',
    table: 'revenues',
    sql: `
DROP TRIGGER IF EXISTS trg_protect_ys_b4_ext_revenues ON revenues;
CREATE TRIGGER trg_protect_ys_b4_ext_revenues
    BEFORE UPDATE OR DELETE ON revenues
    FOR EACH ROW
    EXECUTE FUNCTION protect_ys_b4_ext_revenues();
`
  },
];

async function main() {
  try {
    console.log('Installing triggers...');
    for (const t of TRIGGERS) {
      await pool.query(t.sql);
      console.log(`  ✓ ${t.name} on ${t.table}`);
    }
    console.log('\n✓ ys_b4_ext protection installed');
    process.exit(0);
  } catch (e) {
    console.error('✗ Error:', e.message);
    process.exit(1);
  }
}

main();
