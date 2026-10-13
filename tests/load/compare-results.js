#!/usr/bin/env node
/** tests/load/compare-results.js — مقارنة قبل/بعد من ملفي نتائج العدّة نفسها */
'use strict';
const fs = require('fs');
const path = require('path');

const beforeFile = process.argv[2] || path.join(__dirname, 'results', 'load-before-2026-10-04.json');
const afterFile = process.argv[3] || path.join(__dirname, 'results', 'load-after-2026-10-04.json');
const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterFile, 'utf8'));

function fmt(n) { return (n == null) ? '—' : (typeof n === 'number' ? (Math.round(n * 10) / 10).toLocaleString('en-US') : n); }
function row(label, b, a, unit, higherIsBetter) {
    let delta = '';
    if (typeof b === 'number' && typeof a === 'number' && b !== 0) {
        const d = Math.round(((a - b) / b) * 1000) / 10;
        const good = higherIsBetter ? d >= 0 : d <= 0;
        delta = (d >= 0 ? '+' : '') + d + '% ' + (good ? '✓' : '✗');
    }
    return `| ${label} | ${fmt(b)} | ${fmt(a)} | ${delta} | ${unit || ''} |`;
}

const bs = Object.fromEntries(before.scenarios.map((s) => [s.label, s]));
const as = Object.fromEntries(after.scenarios.map((s) => [s.label, s]));
const labels = [...new Set([...before.scenarios.map((s) => s.label), ...after.scenarios.map((s) => s.label)])];

console.log('## جدول المقارنة (نفس العدّة، نفس السيناريوهات، نفس الجهاز)\n');
console.log('| السيناريو | المقياس | قبل | بعد | الفرق |');
console.log('|---|---|---|---|---|');
for (const l of labels) {
    const b = bs[l], a = as[l];
    if (!b || !a) { continue; }
    console.log(row(`${l} — RPS`, b.rps, a.rps, 'req/s', true).replace('| ' + l, '|').replace(/^| /, '| ' + l + ' | RPS '));
    console.log(row(`${l} — p50`, b.p50, a.p50, 'ms', false).replace(/^/, '').replace('|', '|').slice(0, 0) || '');
    // أبسط عرض: سطر لكل مقياس
}
