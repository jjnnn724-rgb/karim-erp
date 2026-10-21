#!/usr/bin/env node
'use strict';
/**
 * summarize-csp-violations.js — تلخيص تقرير مخالفات CSP الدائم
 * ────────────────────────────────────────────────────────────────────────────
 * يقرأ logs/csp-violations.jsonl (أو أي مسار) ويطبع ملخصًا قابلًا للقرار:
 *   · حسب التوجيه (script-src-attr | script-src-elem | …)
 *   · حسب المستند
 *   · المواضع الأكثر تكرارًا (ملف:سطر) ⇒ قائمة الإصلاح
 *
 * الاستخدام:
 *   node scripts/summarize-csp-violations.js [مسار الملف] [--days 7]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
let file = path.join(ROOT, 'logs', 'csp-violations.jsonl');
let days = 7;
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--days') {days = Number(args[i + 1]) || 7; i++; continue;}
    if (a.startsWith('--')) {continue;}
    file = a;
}

if (!fs.existsSync(file)) {
    console.log(`لا يوجد ملف مخالفات بعد: ${file}`);
    console.log('(يعني: لا مخالفات مسجّلة — أو القياس لم يُفعَّل بعد)');
    process.exit(0);
}

const since = Date.now() - days * 24 * 3600 * 1000;
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
const rows = [];
for (const l of lines) {
    try {
        const o = JSON.parse(l);
        const ts = Date.parse(o.ts || '');
        if (!Number.isFinite(ts) || ts < since) {continue;}
        rows.push(o);
    } catch (_) { /* سطر تالف — نتجاهله */ }
}

const byDirective = new Map();
const byDocument = new Map();
const bySource = new Map();
for (const r of rows) {
    byDirective.set(r.directive, (byDirective.get(r.directive) || 0) + 1);
    byDocument.set(r.document, (byDocument.get(r.document) || 0) + 1);
    if (r.source) {bySource.set(r.source, (bySource.get(r.source) || 0) + 1);}
}

const top = (m, n = 15) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const total = rows.length;

console.log(`\nتقرير مخالفات CSP — آخر ${days} يوم`);
console.log(`الملف: ${file}`);
console.log(`الإجمالي: ${total} مخالفة\n`);

console.log('حسب التوجيه:');
for (const [k, v] of top(byDirective)) {console.log(`  ${String(v).padStart(6)}x  ${k}`);}

console.log('\nحسب المستند:');
for (const [k, v] of top(byDocument)) {console.log(`  ${String(v).padStart(6)}x  ${k || '(غير محدد)'}`);}

console.log('\nأكثر المواضع تكرارًا (قائمة الإصلاح):');
for (const [k, v] of top(bySource, 20)) {console.log(`  ${String(v).padStart(6)}x  ${k}`);}

const first = rows.length ? rows[0].ts : null;
const last = rows.length ? rows[rows.length - 1].ts : null;
console.log(`\nالمدى الزمني: ${first || '-'} ← ${last || '-'}\n`);
