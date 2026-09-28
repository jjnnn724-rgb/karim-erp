const { pool } = require('./backend/shared-pool.js');
const fs = require('fs');

async function main() {
    try {
        // Step 1: Delete existing ys_b4_ext revenues from Karim ERP local table
        const result = await pool.query(
            `SELECT COUNT(*)::int AS count FROM revenues WHERE "deptId" = 'ys_b4_ext'`
        );
        const count = result.rows[0].count;
        console.log('ys_b4_ext rows found:', count);
        
        if (count > 0) {
            await pool.query(`DELETE FROM revenues WHERE "deptId" = 'ys_b4_ext'`);
            console.log(`Deleted ${count} ys_b4_ext revenue rows from Karim ERP local table`);
        }

        // Step 2: Remove BILLS4 → ys_b4_ext mapping from schema.js
        const schemaPath = __dirname + '/backend/yarasoft/schema.js';
        let schema = fs.readFileSync(schemaPath, 'utf8');
        
        const linesToRemove = [
            "    ['BILLS4', null, 'ys_b4_ext', 'بيع خارجي', 'External Sales'],\n",
            "    ['BILLS4', '', 'ys_b4_ext', 'بيع خارجي', 'External Sales'],\n"
        ];
        
        let removed = 0;
        for (const line of linesToRemove) {
            if (schema.includes(line)) {
                schema = schema.replace(line, '');
                removed++;
                console.log('Removed BILLS4→ys_b4_ext mapping line');
            }
        }
        
        if (removed > 0) {
            fs.writeFileSync(schemaPath, schema);
            console.log(`Schema updated: removed ${removed} mapping line(s)`);
        } else {
            console.log('No BILLS4→ys_b4_ext mapping found in schema.js');
        }
        
        console.log('Done');
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
}

main();
