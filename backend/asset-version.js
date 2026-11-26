/* asset-version.js — أيُّ إصدارٍ للواجهة تعتبره السيرفر «الحالي»؟
   ═══════════════════════════════════════════════════════════════════════════
   سياسة الكاش القديمة (2026-10): JS/CSS لا يُخزَّنان أبدًا (`no-cache`) حتى
   لو حمل الرابط `?v=`، ردًّا على حادث بقاء كودٍ قديم محجوبًا أسبوعين لأن
   يدًا نسيت رفع الرقم. الثمن: كل فتحٍ للصفحة يعيد التحقق من 80+ ملفًا.

   هنا الضمانة صارت آلية لا يدوية: `frontend-version.js --bump` يعيد كتابة
   كل صفحات HTML برقمٍ واحد، وبوابتا `test:frontend-version` و`v2-revision`
   تمنعان أن يتغيّر ملفٌ دون أن يتغيّر الرقم. فإذا كان `?v=` في الطلب مساويًا
   لإصدار `frontend-version.json` فالمحتوى الذي تحت هذا العنوان ثابتٌ بالبناء
   — ويجوز تخزينه immutable. أي رقمٍ آخر (أو غياب الرقم) يبقى `no-cache`
   كما كان، فالحادث القديم لا يتكرر: التعريف هنا لا يوسّع الثقة، بل يضيّقها
   إلى الرقم الذي تُثبته البوابات.

   ملاحظة نشر: القيمة تُقرأ من القرص وتُجدَّد ذاتيًا (أدناه) — بعد
   `frontend-version.js --bump` يلتقط السيرفر الرقم الجديد خلال نافذة التجديد
   بلا إعادة تشغيل. والقراءة الفاشلة لا تُخزَّن: تبقى no-cache وهي الآمنة. */

'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'scripts', 'frontend-version.json');

/** نافذة التجديد: قراءة واحدة كل سنتين مهما كان عدد الأصول المطلوبة. */
const REFRESH_MS = 2000;

/** يقرأ رقمًا بصيغة 4.9.186 فقط؛ أي شيء آخر (ملف تالف/غائب/فارغ) → '' */
function loadFrontendVersion(file = STATE_FILE) {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        const version = String(parsed && parsed.version || '').trim();
        return /^\d+(?:\.\d+)*$/.test(version) ? version : '';
    } catch (_) {
        return '';
    }
}

/** رقم `?v=` في رابط — '' إن غاب */
/** @param {*} url رابط الأصل */
function assetVersion(url) {
    const match = /[?&]v=([^&#]+)/.exec(String(url || ''));
    if (!match) {return '';}
    try {return decodeURIComponent(match[1]).trim();}
    catch (_) {return '';}
}

/**
 * قارئ ذوّي التحديث للإصدار الحالي.
 *
 * السابق كان يجمّد القيمة عند الإقلاع، فكل `--bump` (وبها عشرات في اليوم حين
 * تعمل جلسات متوازية) كان يُسقط الكاش الدائم عن كل الأصول في الإنتاج حتى
 * إعادة تشغيل — أي أن أسرع مسارٍ في النظام كان يُعطَّل بأبطأ طريقٍ للإصلاح.
 *
 * قرار التخزين: قيمة صالحة تُعاد قراءتها بعد REFRESH_MS فقط؛ والفشل ('') لا
 * يُخزَّن إطلاقًا، فيُلتقط أول ملفٍ سليم فورًا بلا انتظار النافذة. الأسوأ
 * الممكن إذن هو no-cache مؤقت — وهو الوضع قبل هذا الملف أصلًا.
 *
 * @param {{file?:string, now?:Function, read?:Function}} [deps] للحقن في الاختبارات
 */
function createVersionReader(deps = {}) {
    const file = deps.file || STATE_FILE;
    const now = deps.now || (() => Date.now());
    const read = deps.read || loadFrontendVersion;
    let lastReadMs = 0;
    let lastValue = '';
    return function currentFrontendVersion() {
        if (lastValue && (now() - lastReadMs) < REFRESH_MS) {return lastValue;}
        lastValue = read(file);
        lastReadMs = now();
        return lastValue;
    };
}

const currentFrontendVersion = createVersionReader();

/**
 * @param {*} url رابط الأصل
 * @param {string} [version] رقم الإصدار المطلوب (افتراضي: الحالي)
 */
function isCurrentAssetVersion(url, version = currentFrontendVersion()) {
    if (!version) {return false;}
    return assetVersion(url) === version;
}

module.exports = {
    STATE_FILE, REFRESH_MS, loadFrontendVersion, assetVersion,
    createVersionReader, isCurrentAssetVersion,
    // «CURRENT» أصبحت getter: تُقرَأ من القرص عند كل استخدام، لا عند الإقلاع.
    get CURRENT() {return currentFrontendVersion();}
};
