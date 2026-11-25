import type { V3JournalEntry } from '@karim/shared';
import { describe, expect, it } from 'vitest';
import { formatMoney, statusLabel, totalCredit, totalDebit } from './format';

const entry: V3JournalEntry = {
    id: '1',
    entry_no: 'JE-20261107-0021',
    date: '2026-11-07',
    memo: 'قيد تجريبي',
    source_type: 'manual',
    source_id: null,
    status: 'posted',
    created_by: '2',
    created_at: '2026-11-07T10:00:00.000Z',
    approved_by: null,
    approved_at: null,
    branch_id: null,
    created_by_name: 'محاسب',
    voided_at: null,
    voided_by: null,
    voided_by_name: null,
    void_reason: null,
    lines: [
        { account_code: '4000', debit: '0.00', credit: '40.50', memo: null },
        { account_code: '5000', debit: '40.50', credit: '0.00', memo: null },
    ],
};

describe('عرض المال', () => {
    it('يعرض NUMERIC(14,2) نصًّا بأرقام لاتينية وفاصل آلاف', () => {
        expect(formatMoney('1234.50')).toBe('1,234.50');
        expect(formatMoney('40.00')).toBe('40.00');
    });

    it('لا يخترع رقمًا من نصٍّ غير مالي', () => {
        expect(formatMoney('—')).toBe('—');
    });

    it('يجمع المدين والدائن نصًّا على المليم', () => {
        expect(totalDebit(entry)).toBe('40.50');
        expect(totalCredit(entry)).toBe('40.50');
    });

    it('يجمع بلا فقد للمليم عند حدّ الصيغة المالية (NUMERIC(14,2))', () => {
        const edge = {
            ...entry,
            lines: [
                { account_code: '1', debit: '99999999999999.99', credit: '0.00', memo: null },
                { account_code: '2', debit: '0.01', credit: '0.00', memo: null },
            ],
        };
        expect(totalDebit(edge)).toBe('100000000000000.00');
        expect(formatMoney('99999999999999.99')).toBe('99,999,999,999,999.99');
    });

    it('يجمع سطورًا كثيرة بلا انحراف', () => {
        const many = {
            ...entry,
            lines: Array.from({ length: 100 }, (_unused, index) => ({
                account_code: String(index + 1),
                debit: '0.01',
                credit: '0.00',
                memo: null,
            })),
        };
        expect(totalDebit(many)).toBe('1.00');
    });
});

describe('تسميات العرض', () => {
    it('يترجم حالات القيد', () => {
        expect(statusLabel('posted')).toBe('مرحّل');
        expect(statusLabel('void')).toBe('ملغى');
    });

    it('يبقي القيمة غير المعروفة حرفيًا', () => {
        expect(statusLabel('weird')).toBe('weird');
    });
});
