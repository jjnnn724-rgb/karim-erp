import { describe, expect, it } from 'vitest';
import { canWritePayroll, deductionPreviewPath, PAYROLL_WRITE_TEXT, payrollMonthError } from './payroll-write';

describe('payroll-write', () => {
    it('يقبل الشهر بصيغة YYYY-MM ويرفض غيرها', () => {
        expect(payrollMonthError('2026-11')).toBe('');
        expect(payrollMonthError('2026-1')).toBe('الشهر بصيغة YYYY-MM');
        expect(payrollMonthError('')).toBe('الشهر بصيغة YYYY-MM');
        expect(payrollMonthError('2026-13')).toBe('شهر غير صالح');
        expect(payrollMonthError('2026-00')).toBe('شهر غير صالح');
    });

    it('يبني مسار المعاينة بنفس معاملات الخادم', () => {
        expect(deductionPreviewPath('2026-11', true)).toBe('/api/hr/deductions/preview?month=2026-11&skip_fridays=1');
        expect(deductionPreviewPath('2026-11', false)).toBe('/api/hr/deductions/preview?month=2026-11&skip_fridays=0');
    });

    it('يقصر الكتابة على أدوار الخادم admin/hr/manager', () => {
        expect(canWritePayroll('admin')).toBe(true);
        expect(canWritePayroll('hr')).toBe(true);
        expect(canWritePayroll('manager')).toBe(true);
        expect(canWritePayroll('accountant')).toBe(false);
        expect(canWritePayroll(null)).toBe(false);
    });

    it('يعلن تأكيد التطبيق بإجمالي وعدد الصفوف', () => {
        expect(PAYROLL_WRITE_TEXT.applyConfirm('2026-11', '120.50', 3)).toContain('120.50');
        expect(PAYROLL_WRITE_TEXT.applied('2026-11', 3, '120.50')).toContain('2026-11');
    });
});
