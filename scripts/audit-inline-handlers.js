#!/usr/bin/env node
/**
 * audit-inline-handlers.js — مدقّق المعالجات السطرية داخل قوالب HTML
 * ══════════════════════════════════════════════════════════════════════════
 * لماذا: شاشات V2 والواجهة القديمة تبني HTML عبر قوالب نصية تضع
 * `onclick="someFn(...)"`. هذه المعالجات تُنفَّذ في النطاق العالمي —
 * فإن كان الملف وحدة (module) بلا تصدير الدالة، fell onto ReferenceError
 * عند الضغط، والصورة صامتة: الزر موجود ولا يفعل شيئاً.
 *
 * هذا المدقّق يجد كل الحالات من هذا النوع في المستودع.
 *
 * القواعد:
 *   · سكربت عادي (script src بدون type=module)  → دواله عالمية ✓
 *   · وحدة (module) تُنسخ إلى window عبر Object.assign → يجب أن تكون
 *     ضمن قائمة التصدير، وإلا فالمعالج معطّل ✗
 *   · أي معالج يشير إلى دالة غير معرّفة إطلاقاً ✗
 *
 * التشغيل: node scripts/audit-inline-handlers.js [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');

const HANDLER_ATTRS = 'click|input|change|keydown|keyup|submit|focus|blur|load|contextmenu|dblclick|pointerdown|touchstart';
const HANDLER_RE = new RegExp(`on(?:${HANDLER_ATTRS})\\s*=\\s*["'\`]([A-Za-z_$][\\w$]*)\\s*\\(`, 'g');
// أسماء مبنية-in في JS وليست دوالاً من الكود — تُستبعد (كثير منها مطابقة
// عرضية لبداية تعبير داخل قيمة المعالج).
const BUILTINS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'await', 'new',
    'typeof', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'do', 'else',
]);

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {walk(full, out);}
        else if (/\.(js|html)$/.test(entry.name)) {out.push(full);}
    }
    return out;
}

const files = walk(APP);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/** ١) السكربتات العادية (globals) — من وسوم script في HTML */
const classicGlobals = new Map();   // file → set(functionName)
const classicFiles = new Set();
const htmlFiles = files.filter((f) => f.endsWith('.html'));
for (const html of htmlFiles) {
    const src = fs.readFileSync(html, 'utf8');
    const re = /<script\s+src=["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(src))) {
        if (/type\s*=\s*["']module["']/.test(m[0])) {continue;}
        const target = path.resolve(path.dirname(html), m[1].split('?')[0]);
        if (fs.existsSync(target)) {classicFiles.add(target);}
    }
}

/** ٢) الدوال المعرَّفة في كل ملف (JS و HTML — دوال HTML عالمية في صفحتها) */
const definedIn = new Map();   // file → Set(names)
for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const names = new Set();
    const patterns = [
        /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
        /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g,
        /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*function/g,
    ];
    for (const re of patterns) {
        let m;
        while ((m = re.exec(src))) {names.add(m[1]);}
    }
    definedIn.set(f, names);
}

/** ٣) الوحدات المنسوخة إلى window عبر main.js */
const mainSrc = fs.readFileSync(path.join(APP, 'js', 'main.js'), 'utf8');
const exposedModules = new Map();   // file → Set(exported names)
const importRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await import\(\s*['"]([^'"]+)['"]\s*\)/g;
const assignRe = /Object\.assign\(\s*window\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;
const imported = new Map();
let m;
while ((m = importRe.exec(mainSrc))) {imported.set(m[1], m[2]);}
const assigned = new Set();
while ((m = assignRe.exec(mainSrc))) {assigned.add(m[1]);}
const mainDir = path.join(APP, 'js');
const toModulePath = (spec) => {
    const target = path.resolve(mainDir, spec.split('?')[0]);
    return fs.existsSync(target) ? target : null;
};
for (const [varName, spec] of imported) {
    if (!assigned.has(varName)) {continue;}
    const target = toModulePath(spec);
    if (!target) {continue;}
    const src = fs.readFileSync(target, 'utf8');
    const exported = new Set();
    const expRe = /export\s*\{([^}]*)\}/g;
    let e;
    while ((e = expRe.exec(src))) {
        for (const part of e[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/).pop().trim();
            if (name) {exported.add(name);}
        }
    }
    // export const/function
    const expDeclRe = /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
    while ((e = expDeclRe.exec(src))) {exported.add(e[1]);}
    exposedModules.set(target, exported);
}
// safeBridge modules: كل مسار يُمرَّر إلى safeBridge يُنسخ إلى window
const safeBridgeCallRe = /safeBridge\(\s*['"]([^'"]+)['"]/g;
while ((m = safeBridgeCallRe.exec(mainSrc))) {
    const target = toModulePath(m[1]);
    if (!target) {continue;}
    const src = fs.readFileSync(target, 'utf8');
    const exported = new Set();
    const expRe = /export\s*\{([^}]*)\}/g;
    let e;
    while ((e = expRe.exec(src))) {
        for (const part of e[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/).pop().trim();
            if (name) {exported.add(name);}
        }
    }
    const expDeclRe = /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
    while ((e = expDeclRe.exec(src))) {exported.add(e[1]);}
    exposedModules.set(target, exported);
}

/** ٣ب) الدوال المُسنَدة صراحة إلى window (window.X = ...) في أي مكان */
const explicitGlobals = new Set();
for (const f of files.filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /(?:window|w)\s*\.\s*([A-Za-z_$][\w$]*)\s*=/g;
    let g;
    while ((g = re.exec(src))) {explicitGlobals.add(g[1]);}
}

/** ٤) الدوال العامة المتاحة في السكربتات العادية */
for (const f of classicFiles) {
    const names = definedIn.get(f) || new Set();
    classicGlobals.set(f, names);
}

/** ٥) المسح: كل معالج سطري يشير إلى معرّف */
const findings = [];
/** سطر داخل تعليق (توثيق/شرح) لا ينفَّذ ⇒ لا يُفحص. */
function isCommentLine(src, index) {
    const lineStart = src.lastIndexOf('\n', index) + 1;
    const lineEnd = src.indexOf('\n', index);
    const line = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd).trim();
    return line.startsWith('*') || line.startsWith('//') || line.startsWith('<!--') || line.startsWith('#');
}
for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    if (!HANDLER_RE.test(src)) {continue;}
    HANDLER_RE.lastIndex = 0;
    let hit;
    while ((hit = HANDLER_RE.exec(src))) {
        if (isCommentLine(src, hit.index)) {continue;}
        const name = hit[1];
        if (BUILTINS.has(name)) {continue;}
        const line = src.slice(0, hit.index).split('\n').length;
        const inThisFile = (definedIn.get(f) || new Set()).has(name);

        if (f.endsWith('.html')) {
            // دالة معرَّفة داخل نفس ملف HTML عالمية في تلك الصفحة
            const local = (definedIn.get(f) || new Set()).has(name);
            if (local) {continue;}
            // في HTML: المتاح هو السكربتات العادية + المسنَدة إلى window
            const ok = explicitGlobals.has(name)
                || [...classicGlobals.values()].some((set) => set.has(name))
                || [...exposedModules.values()].some((set) => set.has(name));
            if (!ok) {findings.push({ file: rel(f), line, handler: name, reason: 'غير معرّفة في أي نطاق عام' });}
            continue;
        }

        if (inThisFile) {
            if (classicFiles.has(f)) {continue;}                     // سكربت عادي →	global ✓
            if (explicitGlobals.has(name)) {continue;}               // مُسنَدة إلى window صراحةً ✓
            const exported = exposedModules.get(f);
            if (exported) {
                if (!exported.has(name)) {
                    findings.push({ file: rel(f), line, handler: name, reason: 'وحدة تُنسخ إلى window — والدالة غير مُصدَّرة' });
                }
                continue;
            }
            findings.push({ file: rel(f), line, handler: name, reason: 'وحدة غير مُسنَدة إلى window — المعالج لا يجد الدالة' });
            continue;
        }

        // يشير إلى دالة في ملف آخر
        const fromClassic = [...classicGlobals.entries()].some(([, set]) => set.has(name));
        const fromExposed = [...exposedModules.entries()].some(([, set]) => set.has(name));
        if (!fromClassic && !fromExposed && !explicitGlobals.has(name)) {
            findings.push({ file: rel(f), line, handler: name, reason: 'لا تُعرف في أي نطاق عام' });
        }
    }
}

/** ٦) أوامر التفويض (data-karim-action / data-karim-also) — نفس منطق المعالجات
 *  السطرية: اسم غير موجود = زر صامت لا يفعل شيئًا. */
for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const attr of ['data-karim-action', 'data-karim-also']) {
        const re = new RegExp(`${attr}\\s*=\\s*["']([A-Za-z_$][\\w$]*)["']`, 'g');
        let hit;
        while ((hit = re.exec(src))) {
            if (isCommentLine(src, hit.index)) {continue;}
            const name = hit[1];
            if (BUILTINS.has(name)) {continue;}
            const line = src.slice(0, hit.index).split('\n').length;
            const inThisFile = (definedIn.get(f) || new Set()).has(name);
            if (inThisFile && classicFiles.has(f)) {continue;}
            if (explicitGlobals.has(name)) {continue;}
            const exported = exposedModules.get(f);
            if (exported) {
                if (!exported.has(name)) {
                    findings.push({ file: rel(f), line, handler: name, reason: 'وحدة تُنسخ إلى window — والدالة غير مُصدَّرة' });
                }
                continue;
            }
            const ok = [...classicGlobals.values()].some((set) => set.has(name))
                || [...exposedModules.values()].some((set) => set.has(name));
            if (!ok) {
                findings.push({ file: rel(f), line, handler: name, reason: 'أمر تفويض يشير إلى دالة غير موجودة' });
            }
        }
    }
}

if (process.argv.includes('--json')) {
    console.log(JSON.stringify(findings, null, 2));
} else {
    console.log(`\nمعالجات سطرية معطّلة: ${findings.length}\n`);
    const byFile = new Map();
    for (const f of findings) {
        if (!byFile.has(f.file)) {byFile.set(f.file, []);}
        byFile.get(f.file).push(f);
    }
    for (const [file, list] of byFile) {
        console.log(`  ${file}`);
        for (const f of list) {console.log(`     سطر ${f.line}: ${f.handler} — ${f.reason}`);}
    }
    console.log('');
}
process.exit(findings.length ? 1 : 0);