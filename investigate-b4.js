const { pool } = require('./backend/shared-pool.js');

async function main() {
    console.log('=== ys_b4_ext Root Cause Investigation ===\n');

    // 1. Check revenues table
    const rev = await pool.query(
        `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(amount::numeric),0)::numeric AS total 
         FROM revenues WHERE "deptId" = 'ys_b4_ext'`
    );
    console.log(`1. revenues WHERE deptId='ys_b4_ext': ${rev.rows[0].cnt} rows, ${rev.rows[0].total} total`);
    if (rev.rows[0].cnt > 0) {
        const rows = await pool.query(
            `SELECT id, "deptId", source, amount, date, "external_ref" 
             FROM revenues WHERE "deptId" = 'ys_b4_ext' ORDER BY date DESC LIMIT 5`
        );
        console.log('   Recent rows:');
        for (const r of rows.rows) console.log(`   - ${r.date}: ${r.amount} (${r.source}) ref=${r.external_ref}`);
    }

    // 2. Check yarasoft_revenue_map
    const map = await pool.query(
        `SELECT * FROM yarasoft_revenue_map WHERE dept_code = 'ys_b4_ext'`
    );
    console.log(`\n2. yarasoft_revenue_map for ys_b4_ext: ${map.rows.length} entries`);
    for (const m of map.rows) {
        console.log(`   id=${m.id}, src_table=${m.src_table}, src_name=${m.src_name}, active=${m.active}`);
    }

    // 3. Check if any BILLS4 sync happened recently
    const logs = await pool.query(
        `SELECT id, source_file, status, created_at 
         FROM invoice_import_log 
         WHERE source_file LIKE '%BILLS4%' 
         ORDER BY created_at DESC LIMIT 3`
    );
    console.log(`\n3. Recent BILLS4 sync logs:`);
    for (const l of logs.rows) {
        console.log(`   id=${l.id}, file=${l.source_file}, status=${l.status}, at=${l.created_at}`);
    }

    // 4. Check schema.js REVENUE_MAP_SEED for BILLS4 entries
    const fs = require('fs');
    const schemaPath = __dirname + '/backend/yarasoft/schema.js';
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const b4Lines = schema.split('\n').filter(l => l.includes("'BILLS4'") && l.includes("'ys_b4_ext'"));
    console.log(`\n4. schema.js REVENUE_MAP_SEED BILLS4+ys_b4_ext lines: ${b4Lines.length}`);
    for (const l of b4Lines) console.log(`   ${l.trim()}`);

    // 5. Check server.js for PORT
    const serverJs = fs.readFileSync(__dirname + '/backend/server.js', 'utf8');
    const portMatch = serverJs.match(/PORT\s*=\s*process\.env\.PORT|\bPORT\b.*5001|listen.*5001/);
    console.log(`\n5. server.js PORT config: ${portMatch ? portMatch[0] : 'not found'}`);

    // 6. Check if server process is running
    const { execSync } = require('child_process');
    try {
        const ps = execSync('tasklist /FI "IMAGENAME eq node.exe" /FO CSV 2>/dev/null', { encoding: 'utf8' });
        const lines = ps.split('\n').filter(l => l.includes('node.exe'));
        console.log(`\n6. Running node.exe processes: ${lines.length}`);
        for (const l of lines) console.log(`   ${l}`);
    } catch(e) {
        console.log(`\n6. Process check error: ${e.message}`);
    }

    // 7. Check if any PostgreSQL function/trigger exists
    const trig = await pool.query(
        `SELECT trigger_name, event_object_table, action_statement 
         FROM information_schema.triggers 
         WHERE trigger_name LIKE '%ys_b4_ext%'`
    );
    console.log(`\n7. Triggers on ys_b4_ext: ${trig.rows.length}`);
    for (const t of trig.rows) {
        console.log(`   ${t.trigger_name} on ${t.event_object_table}`);
    }

    console.log('\n=== End of investigation ===');
    pool.end();
}

main().catch(e => { console.error(e.stack); process.exit(1); });
