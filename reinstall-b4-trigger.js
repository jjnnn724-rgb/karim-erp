const { pool } = require('./backend/shared-pool.js');

async function main() {
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
    console.log('Trigger re-installed (blocks UPDATE on ys_b4_ext)');
    
    const { rows: r } = await pool.query("SELECT COUNT(*)::int AS count FROM revenues WHERE \"deptId\" = 'ys_b4_ext'");
    console.log('ys_b4_ext rows in revenues:', r[0].count);
    
    process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
