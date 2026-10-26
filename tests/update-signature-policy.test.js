/**
 * update-signature-policy.test.js — سياسة تثبيت التحديثات (توقيع Authenticode)
 * ────────────────────────────────────────────────────────────────────────────
 * لماذا هذه السياسة: التحديثات غير موقّعة اليوم، مع autoDownload +
 * autoInstallOnAppQuit ⇒ ثنائي من مصدر مُخترَق يُثبَّت تلقائيًا.
 * الاختبار يثبّت السلوك الذي نريده بالضبط:
 *   · العبث (HashMismatch/NotTrusted) يُرفض في كل الأوضاع.
 *   · الناشر المزيّف يُرفض.
 *   · غير الموقّع: يُسمح مع تحذير (وضعنا الحالي) ويُرفض في وضع required.
 *   · required لا يقبل إلا موقّعًا من الناشر المتوقّع.
 */
const {
    decideUpdateInstall,
    normalizeMode,
    isExpectedPublisher,
} = require('../electron/update-signature-policy');

describe('سياسة توقيع التحديثات', () => {
    test('وضع غير معروف يعود للافتراضي (prefer)', () => {
        expect(normalizeMode(undefined)).toBe('prefer');
        expect(normalizeMode('nonsense')).toBe('prefer');
        expect(normalizeMode('REQUIRED')).toBe('required');
        expect(normalizeMode('off')).toBe('off');
    });

    test('توقيع صالح من ناشر متوقّع ⇒ تثبيت', () => {
        const d = decideUpdateInstall({
            status: 'Valid',
            signerSubject: 'CN=Karim ERP, O=Al Shurfa Global, C=SA',
            mode: 'prefer',
            expectedPublisher: 'Karim ERP',
        });
        expect(d.allow).toBe(true);
        expect(d.action).toBe('install');
        expect(d.code).toBe('SIGNED_OK');
    });

    test('عبث في الملف (HashMismatch) ⇒ رفض قاطع في كل الأوضاع', () => {
        for (const mode of ['prefer', 'required', 'off']) {
            const d = decideUpdateInstall({ status: 'HashMismatch', mode });
            expect(d.allow).toBe(false);
            expect(d.action).toBe('block');
            expect(d.code).toBe('TAMPERED');
        }
    });

    test('توقيع من ناشر غير متوقّع ⇒ رفض (حماية من انتحال الناشر)', () => {
        const d = decideUpdateInstall({
            status: 'Valid',
            signerSubject: 'CN=Evil Corp, O=Whatever',
            mode: 'prefer',
            expectedPublisher: 'Karim ERP',
        });
        expect(d.allow).toBe(false);
        expect(d.code).toBe('PUBLISHER_MISMATCH');
    });

    test('غير موقّع ⇒ يُسمح مع تحذير في prefer (وضعنا الحالي)', () => {
        const d = decideUpdateInstall({ status: 'NotSigned', mode: 'prefer' });
        expect(d.allow).toBe(true);
        expect(d.action).toBe('warn');
        expect(d.code).toBe('UNSIGNED');
    });

    test('غير موقّع ⇒ رفض في required', () => {
        const d = decideUpdateInstall({ status: 'NotSigned', mode: 'required' });
        expect(d.allow).toBe(false);
        expect(d.code).toBe('UNSIGNED_REQUIRED');
    });

    test('required: نتيجة غير مجهولة تُرفض', () => {
        for (const st of ['Unknown', 'Error', 'Unsupported', '']) {
            const d = decideUpdateInstall({ status: st, mode: 'required' });
            expect(d.allow).toBe(false);
        }
    });

    test('prefer: تعذّر الفحص ⇒ يُسمح مع تحذير (لا كسر للتحديثات)', () => {
        const d = decideUpdateInstall({ status: 'Error', mode: 'prefer' });
        expect(d.allow).toBe(true);
        expect(d.action).toBe('warn');
    });

    test('وضع off ⇒ يُسمح (تشخيص فقط) دون كسر', () => {
        const d = decideUpdateInstall({ status: 'NotSigned', mode: 'off' });
        expect(d.allow).toBe(true);
        expect(d.code).toBe('POLICY_OFF');
    });

    test('مطابقة الناشر: substring غير حسّاسة لحالة الأحرف', () => {
        expect(isExpectedPublisher('CN=karim erp, O=X', 'Karim ERP')).toBe(true);
        expect(isExpectedPublisher('CN=Other', 'Karim ERP')).toBe(false);
        // بلا ناشر متوقّع ⇒ لا فحص
        expect(isExpectedPublisher('CN=Any', '')).toBe(true);
        // ناشر متوقّع لكن التوقيع بلا subject ⇒ لا يُطابق
        expect(isExpectedPublisher('', 'Karim ERP')).toBe(false);
    });

    test('القرار يحمل سببًا عربيًا قابلًا للعرض', () => {
        const d = decideUpdateInstall({ status: 'HashMismatch', mode: 'prefer' });
        expect(typeof d.reason).toBe('string');
        expect(d.reason.length).toBeGreaterThan(10);
    });
});
