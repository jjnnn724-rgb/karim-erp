/**
 * ui-flags.ts — مفاتيح واجهة صغيرة وقابلة للرجوع (Stage 9).
 *
 * القاعدة: أي تحسين بصري جديد يبدأ مغلقًا؛ القديم يبقى متاحًا فورًا بإيقاف
 * المفتاح (لا حاجة لنشر أو ترحيل). تُقرأ القيمة من localStorage في المتصفح،
 * ويمكن حقنها في الاختبارات عبر نفس الآلية.
 */
const PREFIX = 'karim_ui_flag_';

export function isUiFlagOn(name: string, fallback = false): boolean {
    if (typeof name !== 'string' || !name.trim()) {return fallback;}
    try {
        const raw = globalThis.localStorage?.getItem(PREFIX + name.trim());
        if (raw === null || raw === undefined) {return fallback;}
        return raw === '1' || raw === 'true';
    } catch {
        return fallback;
    }
}

export function setUiFlag(name: string, enabled: boolean): void {
    try {
        globalThis.localStorage?.setItem(PREFIX + name, enabled ? '1' : '0');
    } catch {
        /* مساحة تخزين محجوبة — التطبيق يبقى على الوضع الافتراضي */
    }
}
