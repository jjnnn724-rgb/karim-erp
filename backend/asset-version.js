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

   ملاحظة نشر: القيمة تُقرأ مرةً عند إقلاع السيرفر؛ بعد رفع الإصدار يلزم
   إعادة تشغيله ليعرف الرقم الجديد — وإلى أن يُعاد، الطلبات الجديدة تُخدم
   بسياسة no-cache (الآمنة) بلا أي خطأ. */

'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'scripts', 'frontend-version.json');

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
function assetVersion(url) {
    const match = /[?&]v=([^&#]+)/.exec(String(url || ''));
    if (!match) {return '';}
    try {return decodeURIComponent(match[1]).trim();}
    catch (_) {return '';}
}

const CURRENT = loadFrontendVersion();

function isCurrentAssetVersion(url, version = CURRENT) {
    if (!version) {return false;}
    return assetVersion(url) === version;
}

module.exports = { STATE_FILE, loadFrontendVersion, assetVersion, isCurrentAssetVersion, CURRENT };
