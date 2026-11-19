#!/usr/bin/env node
/**
 * migration-immutability — حاجز عدم المساس بتاريخ الترحيلات (عقيدة القلعة).
 * ════════════════════════════════════════════════════════════════════════════
 * الترحيلات المطبقة على الإنتاج تاريخ لا يُعدّل ولا يُحذف — الإصلاح بترحيل جديد.
 * البصمات في scripts/migration-checksums.json (متتبعة في git):
 *   - تعديل/حذف ترحيل مسجل ⇒ فشل حاجب.
 *   - ترحيل جديد غير مسجل ⇒ فشل حاجب حتى يُسجَّل صراحةً بـ--update (خطوة مراجعة واعية).
 *   - --update يضيف الجديد فقط؛ لا يغيّر بصمة موجودة أبدًا (ratchet).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MIG_DIR = path.join(ROOT, 'database', 'migrations');
const BASELINE = path.join(__dirname, 'migration-checksums.json');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function current() {
    const out = {};
    for (const f of fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort()) {
        out[f] = sha(path.join(MIG_DIR, f));
    }
    return out;
}
function loadBaseline() {
    if (!fs.existsSync(BASELINE)) {return {};}
    return JSON.parse(fs.readFileSync(BASELINE, 'utf8')).checksums || {};
}

const mode = process.argv[2] || '--check';
const cur = current();
const base = loadBaseline();

if (mode === '--update') {
    let added = 0;
    for (const [f, h] of Object.entries(cur)) {
        if (base[f] && base[f] !== h) {
            console.error(`✗ مرفوض: ${f} مسجل ببصمة مختلفة — التاريخ لا يُعدّل. الإصلاح بترحيل جديد.`);
            process.exit(1);
        }
        if (!base[f]) { base[f] = h; added++; console.log(`+ سُجل ترحيل جديد: ${f}`); }
    }
    fs.writeFileSync(BASELINE, JSON.stringify({ _comment: 'بصمات تاريخ الترحيلات — لا تُعدّل يدويًا؛ الإضافة عبر --update فقط (حاجز القلعة).', checksums: base }, null, 2) + '\n');
    console.log(`✓ migration-immutability: ${added} جديدًا مسجلًا، الإجمالي ${Object.keys(base).length}`);
    process.exit(0);
}

// --check
const violations = [];
for (const [f, h] of Object.entries(base)) {
    if (!cur[f]) { violations.push(`حُذف ترحيل مسجل: ${f}`); }
    else if (cur[f] !== h) { violations.push(`عُدّل ترحيل مسجل: ${f}`); }
}
const unregistered = Object.keys(cur).filter((f) => !base[f]);
if (violations.length) {
    console.error('✗ migration-immutability فشل — تاريخ الترحيلات مصون:');
    for (const v of violations) {console.error('   • ' + v);}
    console.error('   الإصلاح بترحيل جديد فقط، ولا تعدّل/تحذف ملفًا طُبق على الإنتاج.');
    process.exit(1);
}
if (unregistered.length) {
    console.error('✗ migration-immutability: ترحيلات جديدة غير مسجلة (سجلها بعد المراجعة):');
    for (const f of unregistered) {console.error('   • ' + f);}
    console.error('   node scripts/migration-immutability.js --update');
    process.exit(1);
}
console.log(`✓ migration-immutability: ${Object.keys(base).length} ترحيلًا مصونًا، لا عبث.`);
