#!/usr/bin/env node
'use strict';
/**
 * frontend-version.js — إدارة إصدار الواجهة (cache-busting) بلا يدوي
 * ══════════════════════════════════════════════════════════════════════
 * المشكلة التي يحلّها:
 *   إصدار الواجهة كان يُرفع يدويًا (`?v=4.9.77` في وسوم <script>)، ومنه
 *   يولّد الخادم `CACHE_VERSION` لـService Worker ⇒ لو نُسيت الزيادة، بقي
 *   العملاء على النسخة القديمة من الكاش **أيامًا** (وهو ما حدث فعليًا:
 *   تعديلات الواجهة اليوم لم تصل للمتصفح أصلاً).
 *
 * الحل:
 *   · --compute : يحسب بصمة المحتوى (hash) لملفات الواجهة + يعرض الإصدار.
 *   · --bump    : يرفع رقم النسخة (patch) ويكتبها في كل وسوم ?v= الخاصة
 *                 بعائلة الإصدار الحالي، ثم يسجّل البصمة الجديدة.
 *   · --check   : بوابة CI — تفشل إن تغيّرت ملفات الواجهة دون رفع النسخة.
 *
 * البصمة تُحسب من محتوى الملفات (لا من تاريخها) ⇒ أي تعديل يُلزم بالزيادة.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const STATE_FILE = path.join(ROOT, 'scripts', 'frontend-version.json');

const IGNORED_DIRS = new Set(['node_modules', 'vendor', '.git', 'coverage', 'logs', 'uploads', 'data']);

/** ملفات الواجهة المؤثرة على الكاش (تُستثنى ملفاتها غير المتأثرة). */
function collectFiles(dir, out = []) {
    if (!fs.existsSync(dir)) {return out;}
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (IGNORED_DIRS.has(e.name)) {continue;}
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {collectFiles(full, out);}
        else if (/\.(html|js|css|json|webmanifest)$/.test(e.name)) {out.push(full);}
    }
    return out;
}

/** بصمة محتوى مستقرة (ترتيب ثابت + hash لكل ملف). */
function contentHash() {
    const files = collectFiles(APP).sort();
    const h = crypto.createHash('sha256');
    for (const f of files) {
        h.update(path.relative(APP, f).split(path.sep).join('/'));
        h.update('\0');
        try {h.update(fs.readFileSync(f));} catch (_) {h.update('unreadable');}
        h.update('\0');
    }
    return h.digest('hex').slice(0, 16);
}

/** الإصدار الحالي = النسخة من وسوم main.js في index.html (هي مصدر CACHE_VERSION). */
function currentVersion() {
    const index = path.join(APP, 'index.html');
    if (!fs.existsSync(index)) {return null;}
    const m = fs.readFileSync(index, 'utf8').match(/main\.js\?v=([\d.]+)/);
    return m ? m[1] : null;
}

function bumpPatch(version) {
    const parts = String(version).split('.').map((n) => parseInt(n, 10) || 0);
    while (parts.length < 3) {parts.push(0);}
    parts[parts.length - 1] += 1;
    return parts.join('.');
}

/**
 * يرفع كل وسوم ?v=<الإصدار الحالي> في صفحات الواجهة **و ملفاتها**
 * إلى الإصدار الجديد. (ملفات JS مهمة: main.js يستدعي الوحدات عبر
 * safeBridge('./features/x.js?v=4.9.77') وهذه الروابط تدخل كاش الـSW.)
 */
function rewriteVersion(oldV, newV) {
    const files = [];
    const collect = (dir, depth) => {
        if (depth > 3) {return;}
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (IGNORED_DIRS.has(e.name)) {continue;}
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {collect(full, depth + 1);}
            else if (/\.(html|js)$/.test(e.name)) {files.push(full);}
        }
    };
    collect(APP, 0);
    let changed = 0;
    for (const p of files) {
        const src = fs.readFileSync(p, 'utf8');
        // main.js هو مرجع عائلة التطبيق كله (imports + safeBridge) ⇒ كل
        // ?v= فيه belong لعائلة واحدة تُرفع بالكامل (وإلا تختلف روابط
        // كاش الـSW عن النسخة ⇒ اختبار الاتساق يفشل).
        const isAppHub = path.basename(p) === 'main.js' && path.basename(path.dirname(p)) === 'js';
        let out = src;
        if (isAppHub) {
            out = out.replace(/\?v=[\d.]+/g, `?v=${newV}`);
        } else {
            out = out.replace(new RegExp(`(\\?v=)${oldV.replace(/\./g, '\\.')}\\b`, 'g'), `$1${newV}`);
        }
        if (out !== src) {
            fs.writeFileSync(p, out, 'utf8');
            changed += 1;
        }
    }
    return changed;
}

function readState() {
    try {return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));} catch (_) {return null;}
}
function writeState(state) {
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

const mode = process.argv.includes('--bump') ? 'bump'
    : process.argv.includes('--check') ? 'check'
        : process.argv.includes('--compute') ? 'compute' : 'help';

const version = currentVersion();
const hash = contentHash();
const state = readState();

if (mode === 'compute') {
    console.log(JSON.stringify({ version, hash, state }, null, 2));
} else if (mode === 'bump') {
    if (!version) {
        console.error('تعذّر قراءة الإصدار الحالي من index.html (main.js?v=…)');
        process.exit(1);
    }
    const next = bumpPatch(version);
    const changed = rewriteVersion(version, next);
    writeState({ version: next, hash: contentHash(), updatedAt: new Date().toISOString() });
    console.log(`الإصدار: ${version} → ${next} (عُدّلت ${changed} صفحة)`);
} else if (mode === 'check') {
    if (!state) {
        console.error('✗ لا يوجد scripts/frontend-version.json — شغّل: node scripts/frontend-version.js --bump');
        process.exit(1);
    }
    if (state.version !== version) {
        console.error(`✗ الإصدار في index.html (${version}) ≠ المسجَّل (${state.version}) — شغّل --bump`);
        process.exit(1);
    }
    if (state.hash !== hash) {
        console.error('✗ تغيّرت ملفات الواجهة بعد آخر زيادة — العملاء سيبقون على نسخة قديمة.');
        console.error('   شغّل: node scripts/frontend-version.js --bump');
        process.exit(1);
    }
    console.log(`✓ إصدار الواجهة ${version} متسق مع محتوى الملفات (${hash})`);
} else {
    console.log('الاستخدام: node scripts/frontend-version.js [--compute|--bump|--check]');
}
