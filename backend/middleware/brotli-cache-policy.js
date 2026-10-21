'use strict';
/**
 * brotli-cache-policy.js — سياسة تنظيف كاش Brotli
 * ────────────────────────────────────────────────────────────────────────────
 * المشكلة: مفتاح نسخة الكاش يحمل mtime الملف الأصلي، فأي إعادة بناء للأصول
 * تُنتج نسخة جديدة وتترك القديمة — أي أن الكاش ينمو بلا حد عبر النشر المتكرر.
 *
 * السياسة (ثلاث طبقات، بهذا الترتيب):
 *   1) بقايا الأجزاء الناقصة (*.tmp من انهيار سابق) — تُمسح دائمًا.
 *   2) العمر: أي نسخة أقدم من maxAgeDays (7) تُحذف.
 *   3) الحجم: إن تجاوز الباقي maxBytes (100MB) نحذف الأقدم mtime حتى ينزل تحته.
 *      mtime هنا وقت إنشاء النسخة → أقرب بديل عملي لـ LRU على نظام ملفات عادي.
 *
 * التوقيت: أول كنستة بعد 30 ثانية (بعد انتهاء التسخين) ثم كل 6 ساعات بمؤقّت unref.
 * السلامة: لا ترمي أبدًا — أي فشل = تخطٍّ صامت، والخدمة لا تتأثر.
 */
const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_MB = 100;
const DEFAULT_MAX_AGE_DAYS = 7;
const DEFAULT_SWEEP_MS = 6 * 60 * 60 * 1000;
const INITIAL_SWEEP_MS = 30 * 1000;   // بعد التسخين فلا ننافسه على القرص

const EVICT_REASONS = new Set(['tmp', 'age', 'size', 'manual']);

/**
 * حدود الكاش من البيئة — تحقّق صارم: رقم فاسد لا يجوز أن يعطّل الحماية.
 * @param {object} [env]
 * @returns {{maxBytes:number, maxAgeDays:number, sweepMs:number}}
 */
function resolveCacheLimits(env) {
    const e = env || process.env;
    const mb = parseFloat(e.BROTLI_CACHE_MAX_MB || '');
    const days = parseFloat(e.BROTLI_CACHE_MAX_AGE_DAYS || '');
    const sweep = parseFloat(e.BROTLI_CACHE_SWEEP_MS || '');
    return {
        maxBytes: Math.round((Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_MB) * 1024 * 1024),
        maxAgeDays: Number.isFinite(days) && days > 0 ? days : DEFAULT_MAX_AGE_DAYS,
        sweepMs: Number.isFinite(sweep) && sweep > 0 ? sweep : DEFAULT_SWEEP_MS,
    };
}

/**
 * @param {{cacheDir:string, metrics?:object, maxBytes?:number, maxAgeDays?:number, now?:Function}} options
 * @returns {{cacheDir:string, maxBytes:number, maxAgeDays:number, sweepMs:number,
 *            stats:Function, enforce:Function, clear:Function, start:Function, stop:Function}}
 */
function createCachePolicy(options) {
    const opts = options || {};
    if (!opts.cacheDir) { throw new Error('createCachePolicy: cacheDir مطلوب'); }
    const cacheDir = path.resolve(opts.cacheDir);
    const limits = resolveCacheLimits();
    const maxBytes = Number.isFinite(opts.maxBytes) && opts.maxBytes > 0 ? opts.maxBytes : limits.maxBytes;
    const maxAgeDays = Number.isFinite(opts.maxAgeDays) && opts.maxAgeDays > 0 ? opts.maxAgeDays : limits.maxAgeDays;
    const metrics = opts.metrics || null;
    const clock = typeof opts.now === 'function' ? opts.now : Date.now;
    let interval = null;

    const note = (fn) => {
        if (!metrics) { return; }
        try { fn(metrics); } catch (_) { /* القياس لا يكسر التنظيف */ }
    };

    /** يقرأ محتوى مجلد الكاش المسطّح — يتخطى أي ملف يختفي أثناء القراءة */
    function scan() {
        let entries;
        try { entries = fs.readdirSync(cacheDir, { withFileTypes: true }); } catch (_) { return []; }
        const out = [];
        for (const entry of entries) {
            if (!entry.isFile()) { continue; }
            try {
                const st = fs.statSync(path.join(cacheDir, entry.name));
                out.push({ name: entry.name, size: st.size, mtimeMs: st.mtimeMs });
            } catch (_) { /* أُخلي بين السطور */ }
        }
        return out;
    }

    /** جزء ناقص من انهيار سابق: الاسم النهائي دائمًا `<مفتاح>.<pid>.tmp` */
    function isTemp(name) { return name.endsWith('.tmp'); }

    function unlink(entry, reason, acc) {
        try {
            fs.unlinkSync(path.join(cacheDir, entry.name));
        } catch (_) { return false; }
        acc.files++;
        acc.bytes += entry.size;
        const bucket = acc.byReason[reason] || (acc.byReason[reason] = { files: 0, bytes: 0 });
        bucket.files++;
        bucket.bytes += entry.size;
        return true;
    }

    function report(removed, acc) {
        for (const reason of Object.keys(acc.byReason)) {
            const bucket = acc.byReason[reason];
            if (EVICT_REASONS.has(reason)) {
                note((m) => m.evicted(reason, bucket.files, bucket.bytes));
            }
        }
        return Object.assign({ at: new Date(clock()).toISOString() }, removed, {
            removedFiles: acc.files,
            removedBytes: acc.bytes,
            byReason: Object.assign({}, acc.byReason),
        });
    }

    /** قراءة فقط: وصف حالة الكاش بلا أي تعديل */
    function stats() {
        const entries = scan();
        const now = clock();
        const ageCutoff = now - maxAgeDays * DAY_MS;
        let bytes = 0;
        let tmpFiles = 0;
        let tmpBytes = 0;
        let expiredFiles = 0;
        let expiredBytes = 0;
        let oldestMs = null;
        for (const e of entries) {
            bytes += e.size;
            if (oldestMs === null || e.mtimeMs < oldestMs) { oldestMs = e.mtimeMs; }
            if (isTemp(e.name)) { tmpFiles++; tmpBytes += e.size; continue; }
            if (e.mtimeMs < ageCutoff) { expiredFiles++; expiredBytes += e.size; }
        }
        return {
            cacheDir,
            files: entries.length,
            bytes,
            maxBytes,
            maxAgeDays,
            usageRatio: maxBytes ? Math.round((bytes / maxBytes) * 10000) / 10000 : null,
            oldestAt: oldestMs === null ? null : new Date(oldestMs).toISOString(),
            tmp: { files: tmpFiles, bytes: tmpBytes },
            expired: { files: expiredFiles, bytes: expiredBytes },
        };
    }

    /** تنفيذ السياسة الآن — تُرجِع تفصيل ما حُذف ولماذا */
    function enforce() {
        const acc = { files: 0, bytes: 0, byReason: Object.create(null) };
        const entries = scan();
        const now = clock();
        const ageCutoff = now - maxAgeDays * DAY_MS;
        const survivors = [];

        for (const e of entries) {
            if (isTemp(e.name)) { unlink(e, 'tmp', acc); continue; }
            if (e.mtimeMs < ageCutoff) { unlink(e, 'age', acc); continue; }
            survivors.push(e);
        }

        let keptBytes = survivors.reduce((n, e) => n + e.size, 0);
        let keptFiles = survivors.length;
        if (keptBytes > maxBytes) {
            survivors.sort((a, b) => a.mtimeMs - b.mtimeMs); // الأقدم أولًا
            for (const e of survivors) {
                if (keptBytes <= maxBytes) { break; }
                if (unlink(e, 'size', acc)) { keptBytes -= e.size; keptFiles--; }
            }
        }

        return report({ scanned: entries.length, kept: { files: keptFiles, bytes: keptBytes } }, acc);
    }

    /** مسح كامل يدوي (CLI) — الخادم سيعيد الضغط عند أول طلب */
    function clear() {
        const acc = { files: 0, bytes: 0, byReason: Object.create(null) };
        for (const e of scan()) { unlink(e, 'manual', acc); }
        return report({ scanned: acc.files }, acc);
    }

    /** كنستة دورية بمؤقّت unref — لا تُبقي العملية حيّة */
    function start() {
        if (interval) { return; }
        const initial = setTimeout(() => { enforce(); }, INITIAL_SWEEP_MS);
        if (initial && typeof initial.unref === 'function') { initial.unref(); }
        interval = setInterval(() => { enforce(); }, limits.sweepMs);
        if (interval && typeof interval.unref === 'function') { interval.unref(); }
    }

    function stop() {
        if (interval) { clearInterval(interval); interval = null; }
    }

    return {
        cacheDir,
        maxBytes,
        maxAgeDays,
        sweepMs: limits.sweepMs,
        stats,
        enforce,
        clear,
        start,
        stop,
    };
}

module.exports = { createCachePolicy, resolveCacheLimits, EVICT_REASONS, DEFAULT_MAX_MB, DEFAULT_MAX_AGE_DAYS };
