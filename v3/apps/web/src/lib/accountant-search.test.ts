import { describe, expect, it } from 'vitest';
import { validateAccountantDashboardSearch } from './accountant-search';

describe('validateAccountantDashboardSearch', () => {
    it('يحفظ نطاقًا صحيحًا ونص البحث', () => {
        expect(
            validateAccountantDashboardSearch({
                from: '2026-11-01',
                to: '2026-11-30',
                q: 'مبيعات',
            }),
        ).toEqual({ from: '2026-11-01', to: '2026-11-30', q: 'مبيعات' });
    });

    it('يرفض التواريخ غير الحقيقية والنطاق المعكوس أو الأطول من 366 يومًا', () => {
        expect(validateAccountantDashboardSearch({ from: '2026-02-31', to: '2026-03-01' })).toEqual({});
        expect(validateAccountantDashboardSearch({ from: '2026-11-30', to: '2026-11-01' })).toEqual({});
        expect(validateAccountantDashboardSearch({ from: '2025-01-01', to: '2026-01-03' })).toEqual({});
    });

    it('يقيّد نص البحث إلى 200 محرف ويتجاهل القيم غير النصية', () => {
        expect(validateAccountantDashboardSearch({ q: 'x'.repeat(205) }).q).toHaveLength(200);
        expect(validateAccountantDashboardSearch({ q: 1 })).toEqual({});
    });
});
