'use strict';
/**
 * journal-void-only-policy.test.js — السياسة كلها في ملف واحد: القيد المرحّل لا يُمسح.
 * ────────────────────────────────────────────────────────────────────────────────
 * Phase A (2026-11-06) حوّل 12 موقعًا من `DELETE FROM journal_*` إلى الإبطال عبر
 * `backend/journal-void.js`، و136+095 أغلقا الباب في القاعدة. لكن القاعدة لا تحمي
 * نفسها من **كود جديد** يفتح `DELETE` مرة أخرى: المحفّظ يرفض، والرفض يقع داخل
 * `.catch` صامت أو داخل معاملة تنظيف — فيبقى النظام مرحّلًا بلا أثر. هذا الملف هو
 * العقد الذي يمنع ذلك نصيًّا، قبل أن يصل إلى القاعدة.
 *
 * الاستثناء الوحيد المرخّص: teardown الاختبارات — `SET LOCAL coa.allow_hard_delete`
 * مع وجود `journal-void` في نفس الدالة (أي أن المسار يعرف السياسة ويختار البوابة
 * صراحةً لمهمة مرخّصة على بيانات اختبار، لا على دفتر عام).
 *
 * ما لا يسويه هذا الملف: هو Canary نصّي لا حارس دلالي — فحص البوابة على مستوى الملف
 * (لا على مستوى المعاملة)، فالمنع الحقيقي يبقى في القاعدة (136 يرفض الربط بلا بوابة،
 * و137/138 يسجّلان ما جرى). `backend/` يُفحص بصفر تسامح لأن أي إصابة هناك تنفيذ لا عقد.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'backups', 'tmp', 'logs', 'docs', 'frontend', 'public', 'database', 'electron-builder-cache']);

/** كل ملفات JS تحت مجلد معيّن، بلا تبعيات ولا مبانٍ. */
function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name) || entry.name.includes('ReparsePoint')) {continue;}
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(p, out); }
        else if (/\.(cjs|mjs|js)$/.test(entry.name)) { out.push(p); }
    }
    return out;
}

const DELETE_RE = /DELETE\s+FROM\s+["']?(?:public\.)?journal_(?:lines|entries)\b/i;
const GATE_RE = /coa\.allow_hard_delete/i;

function scan(dirRel) {
    const hits = [];
    for (const abs of walk(path.join(ROOT, dirRel))) {
        const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
        const src = fs.readFileSync(abs, 'utf8');
        src.split(/\r?\n/).forEach((line, i) => {
            if (DELETE_RE.test(line)) { hits.push({ rel, line: i + 1, text: line.trim().slice(0, 110) }); }
        });
    }
    return hits;
}

describe('سياسة الإبطال فقط — لا مسار تطبيق يمسح قيودًا مرحّلة', () => {
    test('backend/ نظيف تمامًا من DELETE FROM journal_*', () => {
        const hits = scan('backend');
        expect(hits.map((h) => `${h.rel}:${h.line} — ${h.text}`)).toEqual([]);
    });

    test('الجذر والـworker/middleware لا يمسحون الدفتر', () => {
        for (const dir of ['workers', 'middleware', 'shared', 'services']) {
            const abs = path.join(ROOT, dir);
            if (!fs.existsSync(abs)) {continue;}
            const hits = scan(dir);
            expect(hits.map((h) => `${h.rel}:${h.line}`)).toEqual([]);
        }
    });

    test('scripts/ لا يحذف قيودًا بلا بوابة صريحة في نفس الملف', () => {
        const offenders = [];
        for (const h of scan('scripts')) {
            const src = fs.readFileSync(path.join(ROOT, h.rel), 'utf8');
            if (!GATE_RE.test(src)) { offenders.push(`${h.rel}:${h.line}`); }
        }
        expect(offenders).toEqual([]);
    });

    test('تنظيفات الاختبارات تمر من البوابة المرخّصة لا من الحذف المجرد', () => {
        const offenders = [];
        for (const h of scan('tests')) {
            const src = fs.readFileSync(path.join(ROOT, h.rel), 'utf8');
            if (!GATE_RE.test(src)) { offenders.push(`${h.rel}:${h.line} — ${h.text}`); }
        }
        expect(offenders).toEqual([]);
    });

    test('نقطة التصحيح الوحيدة تُصدِّر الدوال الثلاث ولا شيء يلفّها', () => {
        const jv = fs.readFileSync(path.join(ROOT, 'backend', 'journal-void.js'), 'utf8');
        expect(jv).toMatch(/module\.exports = \{ voidSourceJournals, voidJournalById, nextRevisionSourceId \}/);
        // العبارات الستّ ثابتة: لا قالب SQL نصّي (بوابة الأمان sql-interp حصّتها صفر هنا)
        expect(jv).not.toMatch(/\.query\s*\(\s*`[^`]*\$\{/);
        for (const name of ['SQL_SRC_MIG', 'SQL_SRC_MIG_PREFIX', 'SQL_SRC_LEGACY', 'SQL_SRC_LEGACY_PREFIX', 'SQL_BY_ID_MIG', 'SQL_BY_ID_LEGACY']) {
            expect(jv).toContain(`const ${name} =`);
        }
    });

    test('ترحيل 136 مكتوب ومُعلَّن الترتيب قبله', () => {
        const dir = path.join(ROOT, 'database', 'migrations');
        for (const f of ['136_coa_journal_void_only.sql', '137_journal_void_audit.sql', '138_journal_lines_audit.sql']) {
            if (!fs.existsSync(path.join(dir, f))) {throw new Error(`ملف الترحيل مفقود: ${f}`);}
        }
        // البوابة في 136 لا تعمل بلا 095 (الحصانة) و137 (السجل) — الترتيب موثّق في الملف نفسه
        const m136 = fs.readFileSync(path.join(dir, '136_coa_journal_void_only.sql'), 'utf8');
        expect(m136).toMatch(/allow_hard_delete/);
        expect(m136).toMatch(/POSTED_JOURNAL_NO_HARD_DELETE/);
    });
});
