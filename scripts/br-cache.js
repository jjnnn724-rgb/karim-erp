#!/usr/bin/env node
'use strict';
/**
 * br-cache.js — أداة تشغيل كاش Brotli من الطرفية
 * ────────────────────────────────────────────────────────────────────────────
 *   node scripts/br-cache.js --stats     حالة الكاش (افتراضي)
 *   node scripts/br-cache.js --enforce   نفّذ سياسة التنظيف الآن (عمر + حجم)
 *   node scripts/br-cache.js --clear     امسح كل الكاش يدويًا
 *   أضف --json لأيٍّ منها لمخرجات قابلة للقراءة آليًا.
 *
 * يقرأ نفس متغيّرات البيئة التي يقرأها الخادم:
 *   BROTLI_CACHE_DIR (يتقدّم على الكل) · NODE_ENV=production → ./var/brotli-cache
 *   BROTLI_CACHE_MAX_MB (100) · BROTLI_CACHE_MAX_AGE_DAYS (7)
 *
 * ملاحظة: المسح لا يعطّل الخدمة — الخادم يعيد الضغط عند أول طلب لكل ملف.
 */
const path = require('path');

// .env اختياري: الأداة تعمل بلا بيئة أيضًا
try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
} catch (_) { /* dotenv غائب أو .env غير موجود — نكمل */ }

const { defaultCacheDir, POLICY_VERSION } = require('../backend/middleware/brotli-static');
const { createCachePolicy, resolveCacheLimits } = require('../backend/middleware/brotli-cache-policy');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const json = has('--json');

const limits = resolveCacheLimits();
const policy = createCachePolicy({ cacheDir: defaultCacheDir(), ...limits });

const mb = (bytes) => Math.round((bytes / 1048576) * 1000) / 1000;
const table = [
    ['مجلد الكاش', policy.cacheDir],
    ['إصدار السياسة', POLICY_VERSION],
    ['حد الحجم', `${mb(policy.maxBytes)} MB`],
    ['حد العمر', `${policy.maxAgeDays} يومًا`],
    ['دورة التنظيف', `${Math.round(policy.sweepMs / 60000)} دقيقة`],
];

function printStats(s) {
    table.forEach(([k, v]) => console.log(`${k.padEnd(16)}: ${v}`));
    console.log(`${'ملفات'.padEnd(16)}: ${s.files}`);
    console.log(`${'الحجم'.padEnd(16)}: ${mb(s.bytes)} MB (${(s.usageRatio * 100).toFixed(2)}% من الحد)`);
    console.log(`${'أقدم نسخة'.padEnd(16)}: ${s.oldestAt || '—'}`);
    console.log(`${'أجزاء ناقصة'.padEnd(16)}: ${s.tmp.files} ملفًا · ${mb(s.tmp.bytes)} MB`);
    console.log(`${'منتهية العمر'.padEnd(16)}: ${s.expired.files} ملفًا · ${mb(s.expired.bytes)} MB`);
}

let code = 0;
try {
    if (has('--clear')) {
        const r = policy.clear();
        if (json) { console.log(JSON.stringify(r, null, 2)); }
        else { console.log(`مُسح ${r.removedFiles} ملفًا · ${mb(r.removedBytes)} MB`); }
    } else if (has('--enforce')) {
        const r = policy.enforce();
        if (json) { console.log(JSON.stringify(r, null, 2)); }
        else {
            console.log(`حُذف ${r.removedFiles} ملفًا · ${mb(r.removedBytes)} MB`);
            for (const reason of Object.keys(r.byReason)) {
                console.log(`  ${reason}: ${r.byReason[reason].files} ملفًا · ${mb(r.byReason[reason].bytes)} MB`);
            }
            console.log(`بقي ${r.kept.files} ملفًا · ${mb(r.kept.bytes)} MB`);
        }
    } else {
        const s = policy.stats();
        if (json) { console.log(JSON.stringify(s, null, 2)); }
        else { printStats(s); }
    }
} catch (err) {
    console.error(`فشل: ${err.message}`);
    code = 1;
}
process.exit(code);
