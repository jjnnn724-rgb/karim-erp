const fs = require('fs');
const { Client } = require('pg');
const TEMP = { host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Kimo20177', database: 'karim_erp_restore_tmp' };
const LIVE = { host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Kimo20177', database: 'karim_erp' };
const cols = `table_name, column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default, udt_name`;

(async () => {
  const t = new Client(TEMP); await t.connect();
  const l = new Client(LIVE); await l.connect();

  // 1) missing TABLES in live
  const tTables = (await t.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows.map(r => r.table_name);
  const lTables = new Set((await l.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows.map(r => r.table_name));
  const missingTables = tTables.filter(x => !lTables.has(x));
  for (const tbl of missingTables) {
    console.log('CREATE missing table:', tbl);
    const { execSync } = require('child_process');
    const tmpf = __dirname + '/.ddl-tmp.sql';
    execSync(`"C:/Program Files/PostgreSQL/18/bin/pg_dump.exe" -U postgres -d karim_erp_restore_tmp --schema-only --no-owner --table="public.${tbl}" -f "${tmpf}"`);
    execSync(`"C:/Program Files/PostgreSQL/18/bin/psql.exe" -U postgres -d karim_erp -q -v ON_ERROR_STOP=1 -f "${tmpf}"`);
    fs.unlinkSync(tmpf);
  }

  // 2) missing COLUMNS in existing live tables
  const tCols = (await t.query(`SELECT ${cols} FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`)).rows;
  const lCols = (await l.query(`SELECT ${cols} FROM information_schema.columns WHERE table_schema='public'`)).rows;
  const lKey = new Set(lCols.map(c => c.table_name + '.' + c.column_name));
  let added = 0;
  for (const c of tCols) {
    const key = c.table_name + '.' + c.column_name;
    if (lKey.has(key)) continue;
    let type = c.data_type === 'character varying' ? `varchar(${c.character_maximum_length || 255})`
      : c.data_type === 'numeric' ? `numeric(${c.numeric_precision || 20},${c.numeric_scale || 6})`
      : c.udt_name === 'timestamptz' ? 'timestamptz'
      : c.data_type === 'ARRAY' ? c.udt_name + '[]'
      : c.data_type;
    const def = c.column_default ? ' DEFAULT ' + c.column_default : '';
    console.log('ADD COLUMN:', key, type + def);
    await l.query(`ALTER TABLE "public"."${c.table_name}" ADD COLUMN "${c.column_name}" ${type}${def}`);
    added++;
  }
  console.log('--- sync complete: tables created:', missingTables.length, '| columns added:', added);
  await t.end(); await l.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
