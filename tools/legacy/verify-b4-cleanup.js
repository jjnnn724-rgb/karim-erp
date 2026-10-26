const { pool } = require('./backend/shared-pool.js');
const fs = require('fs');

async function main() {
    try {
        // 1. Re-install function + trigger
        const fn = `
CREATE OR REPLACE FUNCTION deny_ys_b4_ext_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD."deptId" = 'ys_b4_ext' THEN
        RAISE EXCEPTION 'ys_b4_ext protected: لا يمكن تعديل إيرادات بيع خارجي';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql`;
        await pool.query(fn);
        console.log('Function created');

        await pool.query('DROP TRIGGER IF EXISTS trg_protect_ys_b4_ext_revenues ON revenues');
        const triggerSql = `
CREATE TRIGGER trg_protect_ys_b4_ext_revenues
    BEFORE UPDATE ON revenues
    FOR EACH ROW
    WHEN (OLD."deptId" = 'ys_b4_ext')
    EXECUTE FUNCTION deny_ys_b4_ext_update()`;
        await pool.query(triggerSql);
        console.log('Trigger re-installed');

        // 2. Verify schema.js changes
        const schemaPath = __dirname + '/backend/yarasoft/schema.js';
        const schema = fs.readFileSync(schemaPath, 'utf8');
        const hasB4 = schema.includes('ys_b4_ext');
        console.log('schema.js still has ys_b4_ext:', hasB4);
        if (!hasB4) console.log('✓ BILLS4→ys_b4_ext mapping removed');

        // 3. Verify no ys_b4_ext rows in revenues
        const { rows: [{ count }] } = await pool.query(`SELECT COUNT(*)::int AS count FROM revenues WHERE "deptId" = 'ys_b4_ext'`);
        console.log('ys_b4_ext rows in revenues:', count);
        if (count === 0) console.log('✓ ys_b4_ext revenues deleted');

        console.log('✓ All done');
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}

main();
