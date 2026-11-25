import { describe, expect, it } from 'vitest';
import {
    adjustmentKindName,
    contractState,
    evaluationStars,
    payrollSheetCsv,
    validateAdjustment,
    validateAdvance,
    validateContract,
    validateEvaluation,
} from './payroll-suite';

describe('payroll-suite', () => {
    it('يرفض سلفة بلا موظف أو مبلغ', () => {
        expect(validateAdvance({ employeeId: 0, amount: 100, monthlyDeduction: 0, date: '2026-11-11' })).not.toBe('');
        expect(validateAdvance({ employeeId: 4, amount: 0, monthlyDeduction: 0, date: '2026-11-11' })).not.toBe('');
        expect(validateAdvance({ employeeId: 4, amount: 100, monthlyDeduction: 0, date: '11/11/2026' })).not.toBe('');
        expect(validateAdvance({ employeeId: 4, amount: 100, monthlyDeduction: -1, date: '2026-11-11' })).not.toBe('');
        expect(validateAdvance({ employeeId: 4, amount: 100, monthlyDeduction: 50, date: '2026-11-11' })).toBe('');
    });

    it('يرفض بندًا بشهر أو نوع غير صالح', () => {
        const base = { employeeId: 4, month: '2026-11', kind: 'penalty', amount: 10, reason: '' };
        expect(validateAdjustment({ ...base, month: '2026-13' })).not.toBe('');
        expect(validateAdjustment({ ...base, kind: 'x' })).not.toBe('');
        expect(validateAdjustment({ ...base, amount: 0 })).not.toBe('');
        expect(validateAdjustment(base)).toBe('');
        expect(adjustmentKindName('bonus')).toBe('علاوة');
        expect(adjustmentKindName('weird')).toBe('weird');
    });

    it('يرفض عقدًا معكوس التواريخ ويحسب حالته', () => {
        expect(validateContract({ employeeId: 4, startDate: '2026-12-01', endDate: '2026-11-01', salary: 0 })).not.toBe('');
        expect(validateContract({ employeeId: 4, startDate: '2026-01-01', endDate: '2026-12-31', salary: 0 })).toBe('');
        const today = new Date(Date.UTC(2026, 10, 11));
        expect(contractState('2026-10-01', today)).toEqual({ label: 'منتهٍ', tone: 'danger' });
        expect(contractState('2026-11-20', today)).toEqual({ label: 'متبقٍ 9 يوم', tone: 'warning' });
        expect(contractState('2027-06-01', today)).toEqual({ label: 'سارٍ', tone: 'success' });
        expect(contractState('bad', today).tone).toBe('warning');
    });

    it('يرفض تقييمًا خارج 1..5', () => {
        const base = { employeeId: 4, period: '2026-11', score: 5, notes: '', evaluator: '' };
        expect(validateEvaluation({ ...base, score: 0 })).not.toBe('');
        expect(validateEvaluation({ ...base, score: 6 })).not.toBe('');
        expect(validateEvaluation({ ...base, score: 3.5 })).not.toBe('');
        expect(validateEvaluation({ ...base, period: '2026-11-01' })).not.toBe('');
        expect(validateEvaluation(base)).toBe('');
        expect(evaluationStars(3)).toBe('★★★☆☆');
        expect(evaluationStars(9)).toBe('★★★★★');
    });

    it('يصدّر كشف الرواتب CSV بترميز صحيح', () => {
        const csv = payrollSheetCsv([
            { name: 'علي "الكبير"', dept: 'المطبخ', position: 'شيف', salary: '3000.00', days: 21 },
            { name: 'سارة', dept: '—', position: '—', salary: null, days: 0 },
        ]);
        const lines = csv.split('\r\n');
        expect(lines).toHaveLength(3);
        expect(lines[0]).toBe('"الموظف","القسم","المنصب","الراتب الأساسي","أيام الحضور"');
        expect(lines[1]).toContain('"علي ""الكبير"""');
        expect(lines[2]).toContain('"سارة","—","—","","0"');
    });
});
