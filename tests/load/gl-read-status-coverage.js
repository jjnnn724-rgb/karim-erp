'use strict';
/**
 * gl-read-status-coverage.js — هل كل قراءة أستاذ تفلتر status='posted'؟
 * ───────────────────────────────────────────────────────────────────────
 * فرضية Phase A كلها قائمة على جملة واحدة: «الإبطال يُخرج القيد من الأرصدة لأن
 * كل قراءات الأستاذ تفلتر status='posted'». لو استعلام واحد لا يفعل، فصفحة
 * كاملة تعرض مبالغ مُبطلة — والفرضية تصير كاذبة. هذا الفحص نصّي (لا يكتب ولا
 * يستدعي شي): لكل كتلة استعلام تذكر journal_lines/journal_entries داخل backend/،
 * يبحث في نافذة ±14 سطرًا عن فلتر حالة صريح، ويصنّف:
 *   filtered   — فيه status = 'posted' (أو 'void' مقصودًا لعدّاد المُبطَل)
 *   draft-only — فيه status = 'draft' (قوائم المسودات — عرض لا أرصدة)
 *   listing    — سرد صفوف مفردة (SELECT e.* / RETURNING) بلا تجميع: العرض فيه
 *                الحالة نفسها للعميل، فلا يُعدّ تسريب رصيد
 *   REVIEW     — لا فلتر ولا تجميع واضح ⇒ يُراجع يدويًا
 * يشغّل: node tests/load/gl-read-status-coverage.js [backend]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', process.argv[2] || 'backend');
const files = [];
(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {walk(p);} else if (/\.js$/.test(e.name)) {files.push(p);}
    }
})(ROOT);

const GL = /\bjournal_(lines|entries)\b/;
const out = { filtered: [], 'draft-only': [], listing: [], REVIEW: [] };
let blocks = 0;

for (const abs of files) {
    const rel = path.relative(path.join(__dirname, '..', '..'), abs).replace(/\\/g, '/');
    const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        if (!GL.test(lines[i])) {continue;}
        const from = Math.max(0, i - 12), to = Math.min(lines.length - 1, i + 12);
        const window = lines.slice(from, to + 1).join('\n');
        // تجميع رصيد؟ (SUM/COUNT/GROUP OVER balances) مقابل سرد صفوف
        const aggregate = /(SUM\s*\(|COUNT\s*\()/i.test(window) && !/SELECT\s+e\.\*/i.test(window);
        blocks++;
        if (/status\s*(?:=|IN)\s*'posted'/i.test(window) || /status\s*=\s*'void'/i.test(window)) {
            out.filtered.push(`${rel}:${i + 1}`);
        } else if (/status\s*=\s*'draft'/i.test(window)) {
            out['draft-only'].push(`${rel}:${i + 1}`);
        } else if (!aggregate) {
            out.listing.push(`${rel}:${i + 1}`);
        } else {
            out.REVIEW.push(`${rel}:${i + 1} :: ${lines[i].trim().slice(0, 110)}`);
        }
        i = to; // تجاوز النافذة المفحوصة حتى لا يُعدّ نفس الكتلة مرتين
    }
}

console.log(`كتل قراءة على journal_*: ${blocks} في ${files.length} ملفًا`);
for (const k of ['filtered', 'draft-only', 'listing', 'REVIEW']) {
    console.log(`  ${k.padEnd(11)} ${out[k].length}`);
}
if (out.REVIEW.length) {
    console.log('\n⚠ يحتاج مراجعة يدوية (تجميع بلا فلتر حالة في النافذة):');
    for (const r of out.REVIEW) {console.log('  ' + r);}
} else {
    console.log('\nRESULT ✅ لا تجميع أستاذ واحد بلا فلتر حالة — فرضية Phase A قائمة نصيًّا');
}
