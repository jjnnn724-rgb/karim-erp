/**
 * update-signature-policy.js — سياسة تثبيت التحديثات (توقيع Authenticode)
 * ────────────────────────────────────────────────────────────────────────────
 * المشكلة: حزمة التحديثات اليوم **غير موقّعة** (electron-builder:
 * signAndEditExecutable=false و verifyUpdateCodeSignature=false)، ومع ذلك
 * autoDownload + autoInstallOnAppQuit ⇒ يُنزَّل ثنائي ويُثبَّت تلقائيًا.
 * لو أُ compromise مصدر التحديث (GitHub release أو مجلد /updates على السيرفر)
 * يُدفع ثنائي خبيث لكل العملاء بصمت.
 *
 * السياسة هنا (منطق خالص — قابل للاختبار بلا Electron):
 *   · Tampering (HashMismatch / NotTrusted) ⇒ **رفض دائمًا** مهما كانت السياسة.
 *   · Valid لكن لناشر غير متوقّع ⇒ **رفض** (حماية من انتحال الناشر).
 *   · NotSigned (وضعنا الحالي: لا شهادة بعد) ⇒ تثبيت مع **تحذير مسجَّل**.
 *   · required ⇒ لا يُثبَّت إلا ما كان موقّعًا من الناشر المتوقّع.
 *
 * أوضاع الاستخدام (متغير البيئة KARIM_UPDATE_SIGNATURE_MODE):
 *   prefer  (افتراضي) — يوقّع المزوّد + يرفض العبث، ويسمح بـ NotSigned بتحذير
 *   required           — لا يقبل إلا موقّعًا من الناشر المتوقّع
 *   off                — بلا تحقق (مرفوض مهنيًا؛ يبقى موجودًا للتشخيص فقط)
 *
 * بعد استصدار شهادة Authenticode: غيّر الوضع إلى required وحدّد
 * KARIM_UPDATE_EXPECTED_PUBLISHER، وفعّل signAndEditExecutable في البناء.
 */
'use strict';

const MODES = ['off', 'prefer', 'required'];
const DEFAULT_MODE = 'prefer';

/**
 * حالات Get-AuthenticodeSignature (Windows):
 *   Valid | NotSigned | HashMismatch | NotTrusted | Unknown | Error
 * نضيف Unsupported لغير ويندوز.
 */
const BLOCKING_STATUSES = ['HashMismatch', 'NotTrusted'];

/** يوحّد صيغة الوضع (الافتراضي prefer عند قيمة غير معروفة). */
function normalizeMode(mode) {
    const m = String(mode == null ? '' : mode).trim().toLowerCase();
    return MODES.includes(m) ? m : DEFAULT_MODE;
}

/**
 * هل الناشر (من.subject) يطابق الناشر المتوقّع؟
 * المطابقة substring غير حسّاسة لحالة الأحرف — لأن subject يحتوي
 * "CN=Name, O=Org, …" فلا نريد مطابقة حرفًا بحرف.
 */
function isExpectedPublisher(signerSubject, expectedPublisher) {
    const expected = String(expectedPublisher || '').trim().toLowerCase();
    if (!expected) {return true;} // لم يُحدَّد ناشر ⇒ لا فحوص publisher
    const subject = String(signerSubject || '').trim().toLowerCase();
    if (!subject) {return false;}
    return subject.includes(expected);
}

/**
 * القرار النهائي للتثبيت.
 * @param {{status?:string, signerSubject?:string, mode?:string, expectedPublisher?:string}} input
 * @returns {{allow:boolean, action:'install'|'warn'|'block', code:string, reason:string}}
 */
function decideUpdateInstall(input = {}) {
    const {
        status: rawStatus,
        signerSubject = '',
        mode,
        expectedPublisher = '',
    } = input || {};

    const m = normalizeMode(mode);
    const status = String(rawStatus || '').trim();
    const publisherOk = isExpectedPublisher(signerSubject, expectedPublisher);

    const block = (code, reason) => ({ allow: false, action: 'block', code, reason });
    const allow = (code, reason, action = 'install') => ({ allow: true, action, code, reason });

    // عبث أو ثقة مفقودة ⇒ رفض قاطع في كل الأوضاع (حتى off — وضع التشخيص
    // لا يجوز أن يسمح بملفٍّ معروف العبث به).
    if (BLOCKING_STATUSES.includes(status)) {
        return block('TAMPERED',
            `توقيع الملف غير صالح (${status}) — رفض التثبيت حمايةً من العبث.`);
    }

    if (m === 'off') {
        return allow('POLICY_OFF', 'التحقق من التوقيع معطّل صراحةً (وضع تشخيصي فقط).', 'warn');
    }

    if (status === 'Valid') {
        if (!publisherOk) {
            return block('PUBLISHER_MISMATCH',
                `الملف موقّع لكن من ناشر غير متوقّع (المتوقّع: ${expectedPublisher}).`);
        }
        return allow('SIGNED_OK', 'التحديث موقّع ومن ناشر موثوق.');
    }

    if (status === 'NotSigned') {
        if (m === 'required') {
            return block('UNSIGNED_REQUIRED',
                'التحديث غير موقّع والوضع required يرفض التثبيت — فعّل توقيع الحزم.');
        }
        return allow('UNSIGNED', 'التحديث غير موقّع (لا شهادة إصدار بعد) — تم التثبيت مع تحذير.', 'warn');
    }

    // Unknown / Error / Unsupported / فارغ: لم نتمكن من الفحص
    if (m === 'required') {
        return block('UNVERIFIABLE',
            `تعذّر التحقق من التوقيع (${status || 'بلا نتيجة'}) والوضع required يرفض التثبيت.`);
    }
    return allow('UNVERIFIABLE', `تعذّر التحقق من التوقيع (${status || 'بلا نتيجة'}) — تم التثبيت مع تحذير.`, 'warn');
}

module.exports = {
    decideUpdateInstall,
    normalizeMode,
    isExpectedPublisher,
    MODES,
    DEFAULT_MODE,
    BLOCKING_STATUSES,
};
