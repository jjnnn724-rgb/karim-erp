import { describe, expect, it } from 'vitest';
import {
    PRINT_COMPANY_EN,
    PRINT_COMPANY_FALLBACK,
    PRINT_LOGO_FALLBACK,
    printBrandName,
    printLogoSrc,
    printRunnerTitle,
    printStamp,
} from './print';

/**
 * هوية الطباعة — النصوص والقواعد المنقولة من `core/print-system.js` و
 * `v2/print-branding.js`. أي انحراف عن البدائل أو صيغة الختم يكسر تكافؤ الطباعة.
 */

describe('هوية الطباعة — الاسم والشعار', () => {
    it('يعود للاسم الثابت عند غياب settings.name', () => {
        expect(printBrandName(null)).toBe(PRINT_COMPANY_FALLBACK);
        expect(printBrandName({})).toBe(PRINT_COMPANY_FALLBACK);
        expect(printBrandName({ name: '   ' })).toBe(PRINT_COMPANY_FALLBACK);
    });

    it('يستخدم settings.name بعد التطبيع', () => {
        expect(printBrandName({ name: '  مطاعم الشرفة  ' })).toBe('مطاعم الشرفة');
    });

    it('يدعم اسم الشركة والشعار الذي رفعه المستخدم في إعدادات V3', () => {
        expect(printBrandName({ name: 'مطعم الفرع الجديد' })).toBe('مطعم الفرع الجديد');
        expect(printLogoSrc({ logoB64: 'data:image/jpeg;base64,LOGO' })).toBe('data:image/jpeg;base64,LOGO');
    });

    it('الشعار: base64 خام أو data: أو URL أو مسار same-origin، والنص/الإيموجي بديل', () => {
        expect(printLogoSrc({})).toBe(PRINT_LOGO_FALLBACK);
        expect(printLogoSrc({ logoB64: 'data:image/png;base64,AAA' })).toBe('data:image/png;base64,AAA');
        expect(printLogoSrc({ logoB64: 'QUJD' })).toBe('data:image/png;base64,QUJD');
        expect(printLogoSrc({ logo: 'https://example.test/logo.png' })).toBe('https://example.test/logo.png');
        // المسار يبقى same-origin (لا اختلاق أصل localhost) — عقد 2026-11.
        expect(printLogoSrc({ logoB64: '/app/assets/x.png' })).toBe('/app/assets/x.png');
        // شعار نصي/إيموجي (settings.logo في قاعدة الاختبار «🍽️») ليس صورة ⇒ البديل،
        // ولا request محجوب بـCSP يفشل عقد الكونسول الحي.
        expect(printLogoSrc({ logo: '🍽️' })).toBe(PRINT_LOGO_FALLBACK);
        expect(printLogoSrc({ logo: 'مطاعم' })).toBe(PRINT_LOGO_FALLBACK);
    });

    it('السطر الإنجليزي ثابت كما في V2', () => {
        expect(PRINT_COMPANY_EN).toBe('AL SHURFA AL ALAMI RESTAURANTS');
    });
});

describe('هوية الطباعة — الختم والتذييل', () => {
    it('الختم بصيغة dd/mm/yyyy hh:mm مع بادئة «طُبع»', () => {
        expect(printStamp(new Date(2026, 10, 9, 2, 5))).toBe('طُبع 09/11/2026 02:05');
        expect(printStamp(new Date(2026, 0, 1, 23, 59))).toBe('طُبع 01/01/2026 23:59');
    });

    it('عنوان التذييل يضغط المسافات ويُقصّ الفارغ', () => {
        expect(printRunnerTitle('  تقرير   المبيعات ')).toBe('تقرير المبيعات');
        expect(printRunnerTitle(null)).toBe('');
    });
});
