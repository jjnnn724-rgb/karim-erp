#!/usr/bin/env node
/**
 * strict-audit.js — تدقيق صارم لسلامة بيانات الحضور
 * يفشل (exit 1) عند أي انتهاك. شغّله قبل الاعتماد الشهري:
 *   node scripts/strict-audit.js [YYYY-MM]
 * (متاح أيضًا بزر "تدقيق صارم" في واجهة الحضور والانصراف)
 */
'use strict';
process.chdir(require('path').join(__dirname, '..'));
const { runStrictAudit } = require('../backend/strict-audit-lib');
const { pool } = require('../backend/shared-pool');

async function main() {
  const month = String(process.argv[2] || '').match(/^\d{4}-\d{2}$/) ? process.argv[2] : null;
  const res = await runStrictAudit(month);
  for (const c of res.checks) {
    const extra = c.detail && c.detail.length
      ? ' ' + c.detail.map(d => `${d.emp || ''}(${d.lateDays}/${d.days})`).join('، ') : '';
    console.log(`${c.status}  ${c.name}: ${c.count}${extra}`);
  }
  await pool.end();
  if (!res.ok) {
    console.error(`\nSTRICT_AUDIT_FAILED: ${res.failures.length} failing check(s)`);
    process.exit(1);
  }
  console.log('\nSTRICT_AUDIT_OK: all checks passed');
}

main().catch(e => { console.error('STRICT_AUDIT_ERROR:', e.message); process.exit(1); });
