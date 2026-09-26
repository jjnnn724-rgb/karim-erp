#!/usr/bin/env node
// tools/employee-card/batch-all.js — توليد بطاقات كل الموظفين النشطين
'use strict';
process.chdir(require('path').join(__dirname, '..', '..'));
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { spawnSync } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
(async () => {
  const { pool } = require(path.join(ROOT, 'backend', 'shared-pool'));
  const rows = (await pool.query(`SELECT COALESCE(NULLIF("deviceUserId",''), "employeeId") AS fp FROM employees WHERE status='active' ORDER BY 1`)).rows
    .map(r => String(r.fp || '').trim()).filter(Boolean);
  await pool.end();
  console.log('total=' + rows.length);
  const ai = process.argv.indexOf('--start');
  const ci = process.argv.indexOf('--count');
  const start = ai >= 0 ? Math.max(0, Number(process.argv[ai + 1]) || 0) : 0;
  const slice = ci >= 0 ? rows.slice(start, start + (Number(process.argv[ci + 1]) || rows.length)) : rows.slice(start);
  console.log(`range ${start}..${start + slice.length}`);
  let ok = 0, fail = [];
  for (const fp of slice) {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'generate-card.js'), '--fp', fp], { encoding: 'utf-8', timeout: 120000 });
    if (r.status === 0) { ok++; }
    else { fail.push(fp); }
    if ((ok + fail.length) % 20 === 0) console.log(`progress ${ok + fail.length}/${rows.length}`);
  }
  console.log(JSON.stringify({ ok, failed: fail }));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
