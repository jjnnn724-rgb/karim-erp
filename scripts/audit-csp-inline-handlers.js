#!/usr/bin/env node
'use strict';
/**
 * audit-inline-handlers.js — جرد كامل للمعالجات السطرية والسكربتات inline
 * ══════════════════════════════════════════════════════════════════════════
 * لماذا لا يكفي تقرير المتصفح: في وضع Report-Only يبلّغ المتصفح عن جزء
 * فقط من المخالفات (أولamuples في الصفحة)، فالقرارSecurity لا يمكن
 * بناؤه على رقم ناقص. هذا المدقّق يعطي العدد الحقيقي من المصدر.
 *
 * لكل صفحة HTML:
 *   · معالجات سطرية  : onclick="..."及其他سمات on*
 *   · سكربتات inline  : <script> بلا src
 *   · معالجات مولّدة   : قوالب JS فيها on*= (تُعدّ من ملفات JS)
 *
 * الاستخدام:
 *   node scripts/audit-inline-handlers.js            # تقرير
 *   node scripts/audit-inline-handlers.js --json     # JSON
 *   node scripts/audit-inline-handlers.js --check <ملف json>   # بوابة (فشل عند تجاوز الميزانية)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');

const HANDLER_ATTR_RE = /[^.\w]on(click|input|change|submit|keydown|keyup|focus|blur|load|error|contextmenu|dblclick|pointerdown|pointerup|touchstart|touchend|mouseover|mouseenter|mouseleave|wheel|drag\w*|drop|select|scroll|resize|toggle|animationstart|animationend|transitionend|copy|cut|paste|beforeunload|unload|hashchange|popstate|message|storage|offline|online|play|pause|ended|timeupdate|canplay|loadedmetadata|seeking|volumechange|waiting|progress|abort|invalid|reset|search|show|close|command|beforeprint|afterprint|fullscreenchange|visibilitychange)\s*=\s*"/gi;
const INLINE_SCRIPT_RE = /<script(?![^>]*\ssrc\s*=)[^>]*>/gi;

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) {return out;}
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'vendor' || e.name.startsWith('.')) {continue;}
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {walk(full, out);}
        else if (/\.(js|html)$/.test(e.name)) {out.push(full);}
    }
    return out;
}

const files = walk(APP);
const pages = [];
let totalHandlers = 0;
let totalInlineScripts = 0;

for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    const src = fs.readFileSync(f, 'utf8');
    const isHtml = f.endsWith('.html');
    // نتجاهل التعليقات (أمثلة التوثيق) — ما يُنفَّذ فقط هو ما يُحتسب
    // نتجاهل التعليقات: // … و /* … *// و<!-- … -->
    const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('<!--') || t.startsWith('#'));
        })
        .join('\n');
    const handlers = (code.match(HANDLER_ATTR_RE) || []).length;
    const inlineScripts = isHtml ? (code.match(INLINE_SCRIPT_RE) || []).length : 0;
    if (handlers || inlineScripts) {
        pages.push({ file: rel, handlers, inlineScripts });
        totalHandlers += handlers;
        totalInlineScripts += inlineScripts;
    }
}

pages.sort((a, b) => (b.handlers + b.inlineScripts) - (a.handlers + a.inlineScripts));
const report = { totalHandlers, totalInlineScripts, pages };

if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log(`\nمعالجات سطرية: ${totalHandlers}   سكربتات inline: ${totalInlineScripts}\n`);
    console.log('ملف                                    معالجات   inline');
    for (const p of pages) {
        console.log(`${p.file.padEnd(38)} ${String(p.handlers).padStart(6)} ${String(p.inlineScripts).padStart(8)}`);
    }
    console.log('');
}

// ── كتابة خط الأساس (الميزانية المسموحة) ──
if (process.argv.includes('--write-baseline')) {    const target = process.argv[process.argv.indexOf('--write-baseline') + 1];
    if (!target) {console.error('--write-baseline يحتاج مسار ملف'); process.exit(1);}
    const filesMap = {};
    for (const p of pages) {filesMap[p.file] = p.handlers;}
    fs.writeFileSync(target, `${JSON.stringify({
        _comment: 'ميزانية المعالجات السطرية لكل ملف — لا تُرفع. أي زيادة تفشل CI. تُخفض مع كل دفعة تحويل إلى addEventListener.',
        totalHandlers,
        totalInlineScripts,
        files: filesMap,
    }, null, 2)}\n`, 'utf8');
    console.log(`كُتب خط الأساس: ${target} (${totalHandlers} معالجًا في ${Object.keys(filesMap).length} ملفًا)`);
    process.exit(0);
}

// ── بوابة الميزانية: ملف baseline يحدّ العدد المسموح ──
const checkIndex = process.argv.indexOf('--check');
if (checkIndex > -1) {
    const budgetFile = process.argv[checkIndex + 1];
    if (!budgetFile || !fs.existsSync(budgetFile)) {
        console.error(`--check يحتاج ملف ميزانية: ${budgetFile}`);
        process.exit(1);
    }
    const budget = JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
    const failures = [];
    for (const p of pages) {
        const allowed = Number((budget.files && budget.files[p.file]) || 0);
        if (p.handlers > allowed) {
            failures.push(`${p.file}: ${p.handlers} معالج (الحد ${allowed})`);
        }
    }
    const allowedTotal = Number(budget.totalHandlers || 0);
    if (totalHandlers > allowedTotal) {
        failures.push(`المجموع: ${totalHandlers} معالج (الحد ${allowedTotal})`);
    }
    if (failures.length) {
        console.error('✗ تجاوز ميزانية المعالجات السطرية:');
        for (const f of failures) {console.error(`   • ${f}`);}
        process.exit(1);
    }
    console.log(`✓ المعالجات السطرية ${totalHandlers} ≤ الميزانية ${allowedTotal}`);
}

// ── بوابة سكربتات inline: يجب ألا يوجد أي منها ──
// السبب: سكربت inline داخل HTML محجوب فعليًا بسياسة CSP المتروّضة
// (وجود nonce في script-src يجعل المتصفح يتجاهل 'unsafe-inline').
// أي سكربت inline جديد = كود صامت لا يعمل ⇒ بوابة تمنع تكرارها.
if (process.argv.includes('--check-inline-scripts')) {
    const offenders = pages.filter((p) => p.inlineScripts > 0);
    if (offenders.length) {
        console.error('✗ سكربتات inline موجودة (محجوبة بسياسة CSP — لا تعمل):');
        for (const p of offenders) {console.error(`   • ${p.file}: ${p.inlineScripts} سكربت`);}
        console.error('   الحل: انقلها إلى ملف .js خارجي وحمّله بـ <script src="...">.');
        process.exit(1);
    }
    console.log('✓ لا سكربتات inline في الواجهة (0)');
}

// ── بوابة التفويض: صفحة فيها data-karim-action تحمّل الموزّع ──
// بدون الموزّع، أزرار الصفحة صامتة (لا استجابة) — العطل لا يظهر في الاختبارات.
if (process.argv.includes('--check-dispatch')) {
    const missing = [];
    for (const f of files.filter((x) => x.endsWith('.html'))) {
        const src = fs.readFileSync(f, 'utf8');
        const usesDispatch = /data-karim-(action|also)\s*=/.test(src);
        const usesMediaFlip = /data-media-always/.test(src);
        if (!usesDispatch && !usesMediaFlip) {continue;}
        if (!/action-dispatch\.js/.test(src)) {
            missing.push(`${path.relative(ROOT, f).split(path.sep).join('/')}`);
        }
    }
    if (missing.length) {
        console.error('✗ صفحات تستخدم التفويض بلا تحميل الموزّع (أزرار صامتة):');
        for (const m of missing) {console.error(`   • ${m}`);}
        console.error('   الحل: أضف <script src="js/core/action-dispatch.js" defer></script>.');
        process.exit(1);
    }
    console.log('✓ كل صفحة تستخدم التفويض تحمّل الموزّع');
}
