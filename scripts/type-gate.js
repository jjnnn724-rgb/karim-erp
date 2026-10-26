#!/usr/bin/env node
/**
 * scripts/type-gate.js — Quality gate for the financial core.
 * Fails (exit 1) if `tsc --noEmit` reports ANY error inside the critical
 * modules. The rest of the legacy codebase may evolve separately.
 *
 * Usage: npm run test:type:gate
 */
'use strict';
const { execSync } = require('child_process');

const CRITICAL = [
    'backend/accounting-periods.js',
    'backend/accounting-growth.js',
    'backend/accounting-routes.js',
    'backend/budget-alerts.js',
    'backend/cashier-module/day-close-routes.js',
    'backend/attendance-push/',
];

let out;
try {
    out = execSync('npx tsc --noEmit', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
}
const lines = out.split(/\r?\n/).filter(Boolean);
const hits = lines.filter((l) => CRITICAL.some((c) => l.includes(c)));
if (hits.length) {
    console.error(`TYPE-GATE FAILED: ${hits.length} error(s) in critical modules:`);
    hits.slice(0, 30).forEach((l) => console.error('  ' + l));
    process.exit(1);
}
console.log(`TYPE-GATE OK (${lines.length} total line(s) scanned, 0 in critical modules)`);
