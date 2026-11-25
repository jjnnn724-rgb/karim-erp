'use strict';
/**
 * انتقال V3 المجدول — مصدر الحقيقة الواحد لسؤالين:
 *   1. هل V3 هو مدخل النظام الآن؟ (`v3Primary`)
 *   2. متى يقلبه النظام بنفسه؟ (`switchAt`)
 *
 * القرار في `frontend/v3/rollout.json` لا في الكود، فلا حاجة لإعادة تشغيل
 * عند تغيير الموعد: الملف يُقرأ عند كل طلب مع كاشٍ قصير (15 ثانية) مبني على
 * mtime. التجاوز اليدوي للطوارئ عبر متغير البيئة `V3_PRIMARY`:
 *   V3_PRIMARY=1  → V3 مدخل الآن، تجاهل الموعد.
 *   V3_PRIMARY=0  → V2 مدخل دائمًا، حتى بعد الموعد.
 *
 * موعد بلا منطقة زمنية = خطأ إعداد لا موعد: نرفضه ونبقى على V2.
 */
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'frontend', 'v3', 'rollout.json');
const INDEX_FILE = path.join(__dirname, '..', 'frontend', 'v3', 'index.html');
const CACHE_MS = 15_000;

let cache = { at: 0, mtimeMs: -1, config: null };

function readConfig() {
    const now = Date.now();
    let mtimeMs = -1;
    try {
        mtimeMs = fs.statSync(CONFIG_FILE).mtimeMs;
    } catch (_) {
        return null;
    }
    if (cache.config && now - cache.at < CACHE_MS && mtimeMs === cache.mtimeMs) {
        return cache.config;
    }
    let config = null;
    try {
        const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object') {
            config = parsed;
        }
    } catch (_) {
        config = null;
    }
    cache = { at: now, mtimeMs, config };
    return config;
}

/** لحظة القلب (ms) أو null إن كان الإعداد تالفًا/غائبًا. */
function switchAt() {
    const config = readConfig();
    const raw = config && typeof config.switchAt === 'string' ? config.switchAt : '';
    // ISO مع إزاحة صريحة: بلا إزاحة يفسّره V8 محليًا فيختلف بين الخادم والمتصفح.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
        return null;
    }
    const at = Date.parse(raw);
    return Number.isFinite(at) ? at : null;
}

function v3Primary(now = Date.now()) {
    const override = String(process.env.V3_PRIMARY ?? '').trim();
    if (override === '1') {
        return true;
    }
    if (override === '0') {
        return false;
    }
    const at = switchAt();
    return at !== null && now >= at;
}

/** هل المدخل الآن V2 رغم أن V3 جاهز للمعاينة؟ (يحكم شارة «معاينة» في V3) */
function v3Preview(now = Date.now()) {
    return !v3Primary(now);
}

/** بُنية V3 على القرص؟ لا تحويل إلى مسارٍ غير موجود مهما قال الموعد. */
function v3Ready() {
    try {
        return fs.statSync(INDEX_FILE).isFile();
    } catch (_) {
        return false;
    }
}

/** القرار النهائي لمدخل `/` و`/app`: الموعد + وجود البُنية معًا. */
function v3Entry(now = Date.now()) {
    return v3Primary(now) && v3Ready();
}

module.exports = { v3Primary, v3Preview, v3Ready, v3Entry, switchAt };
