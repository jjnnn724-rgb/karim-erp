'use strict';
/* rotate-logs.js — تدوير سجلات الأتمتة (ليست سجلات السيرفر الحية): حد 3MB × 3 نسخ. */
const fs = require('fs');
const path = require('path');

const FILES = [
    'logs/stale-close.log',
    'logs/morning-automation.log',
    'logs/attendance-health.log',
    'database/backups/punch-reconcile.log',
];
const MAX = 3 * 1024 * 1024, KEEP = 3;

for (const rel of FILES) {
    const f = path.join(__dirname, '..', rel);
    try {
        const st = fs.statSync(f);
        if (st.size < MAX) { continue; }
        for (let i = KEEP - 1; i >= 1; i--) {
            const a = `${f}.${i}`, b = `${f}.${i + 1}`;
            if (fs.existsSync(a)) { fs.renameSync(a, b); }
        }
        fs.renameSync(f, `${f}.1`);
        console.log(`ROTATED:${rel}`);
    } catch (e) {
        if (e && e.code !== 'ENOENT') { console.log(`ROTATE_SKIP:${rel}:${e.message}`); }
    }
}
process.exit(0);
