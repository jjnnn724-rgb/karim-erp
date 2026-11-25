import { describe, expect, it } from 'vitest';
import { canReopenCfo, canWriteCfo, journalTotals, parseAmountCents, periodPath, validateJournalEntry } from './cfo-write';

describe('cfo-write', () => {
    it('يحوّل المبالغ إلى سنتات بدقة ويرفض الكسور الأطول', () => {
        expect(parseAmountCents('120.5')).toBe(12050);
        expect(parseAmountCents('1,200.05')).toBe(120005);
        expect(parseAmountCents('')).toBe(0);
        expect(parseAmountCents('1.234')).toBeNull();
        expect(parseAmountCents('-5')).toBeNull();
    });

    it('يجمع المدين والدائن بالسنت ويحكم التوازن', () => {
        const totals = journalTotals([
            { accountCode: '1100', debit: '100.10', credit: '' },
            { accountCode: '4100', debit: '', credit: '100.10' },
        ]);
        expect(totals).toEqual({ debit: 10010, credit: 10010, balanced: true });
        expect(journalTotals([{ accountCode: '1100', debit: '1', credit: '' }]).balanced).toBe(false);
    });

    it('يقبل قيدًا متوازنًا ويعيد الحمولة', () => {
        const result = validateJournalEntry(
            '2026-11-10',
            [
                { accountCode: '1100', debit: '250.00', credit: '' },
                { accountCode: '4100', debit: '', credit: '250.00' },
            ],
            'draft',
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.payload.status).toBe('draft');
            expect(result.payload.lines).toEqual([
                { account_code: '1100', debit: 250, credit: 0 },
                { account_code: '4100', debit: 0, credit: 250 },
            ]);
        }
    });

    it('يرفض غير المتوازن والسطر ذا الوجهين والقيد الناقص', () => {
        expect(
            validateJournalEntry(
                '2026-11-10',
                [
                    { accountCode: '1100', debit: '100', credit: '' },
                    { accountCode: '4100', debit: '', credit: '99' },
                ],
                'posted',
            ),
        ).toMatchObject({ ok: false });
        expect(
            validateJournalEntry(
                '2026-11-10',
                [
                    { accountCode: '1100', debit: '100', credit: '100' },
                    { accountCode: '4100', debit: '', credit: '100' },
                ],
                'posted',
            ),
        ).toMatchObject({ ok: false });
        expect(
            validateJournalEntry(
                '2026-11-10',
                [
                    { accountCode: '1100', debit: '100', credit: '' },
                    { accountCode: '', debit: '', credit: '100' },
                ],
                'posted',
            ),
        ).toMatchObject({ ok: false });
    });

    it('يرفض تاريخًا غير صالح', () => {
        expect(validateJournalEntry('10/11/2026', [], 'draft')).toEqual({
            ok: false,
            error: 'التاريخ بصيغة YYYY-MM-DD',
        });
    });

    it('يبني مسار الفترة ويشفّرها', () => {
        expect(periodPath('2026-11', 'close')).toBe('/api/accounting/periods/2026-11/close');
        expect(periodPath('2026-11', 'open')).toBe('/api/accounting/periods/2026-11/open');
    });

    it('يفصل صلاحية الكتابة عن صلاحية إعادة الفتح', () => {
        expect(canWriteCfo('accountant')).toBe(true);
        expect(canWriteCfo('auditor')).toBe(false);
        expect(canReopenCfo('accountant')).toBe(false);
        expect(canReopenCfo('admin')).toBe(true);
    });
});
