'use strict';
/* Runs the project's migration runner against karim_erp_test only. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();
const env = { ...process.env };
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) { env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }
}
// Isolated target only — never the live database, whatever .env says.
env.DB_NAME = 'karim_erp_test';
env.KARIM_TEST_DB_NAME = 'karim_erp_test';
env.NODE_ENV = 'test';
const r = spawnSync(process.execPath, [path.join('database', 'scripts', 'run-migration.js')], { cwd: root, env, encoding: 'utf8' });
console.log((r.stdout || '').trim().split(/\r?\n/).slice(-15).join('\n'));
if (r.status !== 0) { console.log((r.stderr || '').trim().split(/\r?\n\s*/).slice(-10).join('\n')); }
process.exit(r.status || 0);
