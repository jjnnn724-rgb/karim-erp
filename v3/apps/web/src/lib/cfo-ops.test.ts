import { describe, expect, it } from 'vitest';
import { isValidDate, isValidMonth, parseSignedCents, validateAsset, validateBudget, validateStatement } from './cfo-ops';

describe('cfo-ops', () => {
    it('يميّز التواريخ والأشهر الصحيحة من غيرها', () => {
        expect(isValidDate('2026-11-10')).toBe(true);
        expect(isValidDate('2026-02-30')).toBe(false);
        expect(isValidDate('10/11/2026')).toBe(false);
        expect(isValidMonth('2026-11')).toBe(true);
        expect(isValidMonth('2026-13')).toBe(false);
    });

    it('يقرأ مبلغ الكشف الموقّع بالسنت', () => {
        expect(parseSignedCents('-1,250.50')).toBe(-125050);
        expect(parseSignedCents('80')).toBe(8000);
        expect(parseSignedCents('1.234')).toBeNull();
    });

    it('يتحقق من حركة الكشف ويبني حمولتها', () => {
        const result = validateStatement('2026-11-10', 'تحويل مورد', '-250.25', '1010');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.payload).toEqual({
                account_code: '1010',
                stmt_date: '2026-11-10',
                description: 'تحويل مورد',
                amount: -250.25,
            });
        }
        expect(validateStatement('2026-11-10', '', '100', '1010')).toMatchObject({ ok: false });
        expect(validateStatement('2026-11-10', 'حركة', '0', '1010')).toMatchObject({ ok: false });
    });

    it('يرفض أصلًا بقيمة تخريدية تتجاوز التكلفة أو عمرًا صفريًا', () => {
        expect(validateAsset('فرن', '10000', '60', '500').ok).toBe(true);
        expect(validateAsset('فرن', '10000', '0', '0')).toMatchObject({ ok: false });
        expect(validateAsset('فرن', '10000', '60', '10000')).toMatchObject({ ok: false });
    });

    it('يطلب بيانًا أو حسابًا للموازنة ويرفض المبلغ السالب', () => {
        const result = validateBudget('2026-11', 'مصروفات تشغيل', '', '5000');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.payload.label).toBe('مصروفات تشغيل');
        }
        expect(validateBudget('2026-11', '', '', '5000')).toMatchObject({ ok: false });
        expect(validateBudget('2026-11', 'بند', '', '-5')).toMatchObject({ ok: false });
        expect(validateBudget('11-2026', 'بند', '', '5')).toMatchObject({ ok: false });
    });
});
