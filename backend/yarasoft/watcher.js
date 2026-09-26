/**
 * yarasoft/watcher.js — اكتشاف الملفات (Phase 3)
 * ────────────────────────────────────────────────────────────────────────────
 * SMB لا يوفر أحداث نظام ملفات موثوقة عبر الشبكة، والمواصفة تمنع الاعتماد
 * على الأحداث وحدها — لذلك:
 *   • فحص بدء التشغيل الكامل (Startup scan) قبل أي شيء
 *   • دوران مسحي (polling) كل YARASOFT_SCAN_INTERVAL — لا يعتمد على fs.watch
 *   • يشمل مجلد Invoices (الجديد) و Invoices_Processing (بانتظار حل ربط)
 *   • تتبع الملفات المعروفة بالمسار+الحجم+mtime — الجديد فقط يدخل الطابور
 */

'use strict';

const path = require('path');
const files = require('./files');
const { joinShare } = require('./config');

function matchesPatterns(fileName, patterns) {
    if (!patterns || !patterns.length) {return true;}
    const lower = fileName.toLowerCase();
    return patterns.some(p => lower.endsWith(p.startsWith('.') ? p : `.${p}`));
}

/**
 * ScanCycle — مسح مجلد: يحدّث known بالملفات الحالية ويرجع الجديد فقط
 * مع قائمة المسارات الموجودة فعليًا (للتنظيف الصحيح للذاكرة).
 */
async function scanDirectory(dirPath, known, { patterns, now = Date.now(), depth = 0, maxDepth = 3, relDir = '' } = {}) {
    const found = [];
    const allLowerPaths = new Set();
    const entries = await files.listDir(dirPath);
    for (const entry of entries) {
        const full = path.join(dirPath, entry.name);
        // مجلد فرعي = جهاز كاشير (Cashier1...) — تعمّق مع تتبع المجلد النسبي
        if (entry.isDirectory && entry.isDirectory()) {
            if (entry.name.startsWith('.')) {continue;}
            if (depth >= maxDepth) {continue;}
            const sub = await scanDirectory(full, known, {
                patterns, now, depth: depth + 1, maxDepth,
                relDir: relDir ? `${relDir}/${entry.name}` : entry.name,
            });
            found.push(...sub.found);
            sub.allLowerPaths.forEach(p => allLowerPaths.add(p));
            continue;
        }
        if (!entry.isFile || !entry.isFile()) {continue;}
        if (entry.name.startsWith('~$') || entry.name.startsWith('.')) {continue;} // ملفات مؤقتة من Office/POS
        if (!matchesPatterns(entry.name, patterns)) {continue;}
        const key = full.toLowerCase();
        allLowerPaths.add(key);
        try {
            const stat = await files.statFile(full);
            const sig = `${stat.size}:${Math.floor(stat.mtimeMs)}`;
            if (known.has(key) && known.get(key) === sig) {continue;} // معروف ولم يتغير
            known.set(key, sig);
            found.push({ filePath: full, fileName: entry.name, relDir, size: stat.size, mtimeMs: stat.mtimeMs, discoveredAt: now });
        } catch (error) {
            if (!files.isTransientError(error)) {throw error;} // الشبكة تُترك للدورة القادمة
            throw error;
        }
    }
    return { found, allLowerPaths };
}

/** إزالة المفاتيح للملفات التي لم تعد موجودة (نقلت/حُذفت) لتحرير الذاكرة */
function pruneKnown(known, existingLowerPaths) {
    for (const key of [...known.keys()]) {
        if (!existingLowerPaths.has(key)) {known.delete(key);}
    }
}

module.exports = { scanDirectory, matchesPatterns, pruneKnown, joinShare };
