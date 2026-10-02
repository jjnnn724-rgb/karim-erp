#!/usr/bin/env node
// audit-silent-catch.js — بوابة «صفر صمت»: تعدّ كتل catch الفارغة في backend
// القاعدة: العدد لا يجوز أن يزيد عن خط الأساس المسجل (silence يخفي الأعطال).
// التشغيل: npm run audit:silent
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const RE = /catch\s*\([^)]*\)\s*\{\s*\}/g;
function walk(dir, out = []) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) { if (f.name !== 'node_modules') walk(p, out); continue; }
        if (!f.name.endsWith('.js')) {continue;}
        out.push(p);
    }
    return out;
}
const files = walk(path.join(ROOT, 'backend'));
const perFile = {};
let total = 0;
for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    const n = (s.match(RE) || []).length;
        if (n) { perFile[path.relative(ROOT, f).split(path.sep).join("/")] = n; total += n; }
}
const baselinePath = path.join(__dirname, 'silent-catch-baseline.json');
let baseline = null;
if (fs.existsSync(baselinePath)) { baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')); }
console.log(`كتل catch الفارغة في backend: ${total} (${files.length} ملف مفحوص)`);
const top = Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [f, n] of top) {console.log(`   ${n}\t${f}`);}
if (!baseline) {
    fs.writeFileSync(baselinePath, JSON.stringify({ total, perFile, recordedAt: new Date().toISOString() }, null, 2));
    console.log(`خط الأساس المسجل: ${total} — القاعدة: لا يزيد عنه (npm run audit:silent)`);
} else {
    if (total > baseline.total) {
        console.error(`❌ الفرق: +${total - baseline.total} كتلة صامتة جديدة فوق خط الأساس (${baseline.total})`);
        process.exit(1);
    }
    console.log(`✅ ضمن خط الأساس (${baseline.total}) — الفرق: ${baseline.total - total}`);
}
