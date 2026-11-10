import { loadFixture } from '@karim/testing';
import { describe, expect, test } from 'vitest';
import {
    accountSchema,
    chartResponseSchema,
    journalEntryReadSchema,
    journalResponseSchema,
    trialBalanceResponseSchema,
    vatReturnResponseSchema,
    vatSettlementRequestSchema,
} from './accounting.js';
import { dateOnlyFromIso, dateOnlyToLegacyIso } from './date-only.js';
import { errorResponseSchema } from './errors.js';

/**
 * بوابة G2: كل التقاط يُمرَّر بمخطَّطه **دون أي تعديل على البيانات**.
 * أي حقل يخالف هنا يعني أن المخطط يخالف القديم، لا أن الالتقاط خاطئ.
 */

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
    const copy = { ...value };
    delete copy[key];
    return copy;
}

describe('/chart', () => {
    const fixture = loadFixture('chart');

    test('البيانات الملتقطة تُطابق المخطط كاملة', () => {
        expect(fixture.meta.status).toBe(200);
        const accounts = chartResponseSchema.parse(fixture.body);
        expect(accounts).toHaveLength(124);
        expect(accounts[0]).toEqual({
            code: '1',
            name_ar: 'الأصول',
            name_en: 'Assets',
            type: 'asset',
            parent_code: null,
            is_postable: false,
            is_active: true,
        });
    });

    test('كل حساب فردي صالح، والأكواد مرتّبة', () => {
        const accounts = chartResponseSchema.parse(fixture.body);
        for (const account of accounts) {
            expect(accountSchema.safeParse(account).success).toBe(true);
        }
        const codes = accounts.map((account) => account.code);
        expect([...codes].sort()).toEqual(codes);
    });

    test('يرفض نوع حساب غير معروف', () => {
        const bad = {
            code: '9',
            name_ar: 'x',
            name_en: null,
            type: 'cash',
            parent_code: null,
            is_postable: true,
            is_active: true,
        };
        expect(accountSchema.safeParse(bad).success).toBe(false);
    });

    test('يرفض حقلًا زائدًا لم يُلتقط', () => {
        const withId = {
            code: '1',
            name_ar: 'الأصول',
            name_en: 'Assets',
            type: 'asset',
            parent_code: null,
            is_postable: false,
            is_active: true,
            id: '1',
        };
        expect(accountSchema.safeParse(withId).success).toBe(false);
    });
});

describe('/journal', () => {
    const fixture = loadFixture('journal');

    test('البيانات الملتقطة تُطابق المخطط كاملة', () => {
        const entries = journalResponseSchema.parse(fixture.body);
        expect(entries).toHaveLength(20);
        expect(entries[0]?.entry_no).toBe('JE-20261107-0021');
    });

    test('معرّفات bigint نصوص، والمبالغ أرقام — عقد القديم', () => {
        const entries = journalResponseSchema.parse(fixture.body);
        for (const entry of entries) {
            expect(typeof entry.id).toBe('string');
            expect(entry.date.endsWith('T21:00:00.000Z')).toBe(true);
            for (const line of entry.lines) {
                expect(typeof line.debit).toBe('number');
                expect(typeof line.credit).toBe('number');
            }
        }
    });

    test('رقم القيد يكشف التاريخ الحقيقي: 21:00Z يوم 6 = DATE يوم 7', () => {
        const entries = journalResponseSchema.parse(fixture.body);
        const first = entries[0];
        if (!first) {
            throw new Error('لا قيود في الالتقاط');
        }
        expect(first.entry_no).toBe('JE-20261107-0021');
        expect(first.date).toBe('2026-11-06T21:00:00.000Z');
        expect(dateOnlyFromIso(first.date)).toBe('2026-11-07');
        expect(dateOnlyToLegacyIso(dateOnlyFromIso(first.date))).toBe(first.date);
    });

    test('كل قيد ملتقط متوازن', () => {
        const entries = journalResponseSchema.parse(fixture.body);
        for (const entry of entries) {
            const debit = entry.lines.reduce((total, line) => total + line.debit, 0);
            const credit = entry.lines.reduce((total, line) => total + line.credit, 0);
            expect(debit).toBeCloseTo(credit, 2);
        }
    });

    test('يرفض المال كنص — تصحيحٌ خاطئ للعقد', () => {
        const entries = journalResponseSchema.parse(fixture.body);
        const first = entries[0];
        expect(first).toBeDefined();
        if (!first) {
            return;
        }
        const mutated = {
            ...first,
            lines: first.lines.map((line) => ({ ...line, debit: String(line.debit), credit: String(line.credit) })),
        };
        expect(journalEntryReadSchema.safeParse(mutated).success).toBe(false);
    });

    test('يرفض تاريخ DATE بتوقيت UTC بدل الرياض', () => {
        const entries = journalResponseSchema.parse(fixture.body);
        const first = entries[0];
        if (!first) {
            throw new Error('لا قيود في الالتقاط');
        }
        const mutated = { ...first, date: first.date.replace('T21:00:00.000Z', 'T00:00:00.000Z') };
        expect(journalEntryReadSchema.safeParse(mutated).success).toBe(false);
    });

    test('يرفض حالة غير معروفة وحقلًا زائدًا', () => {
        const entries = journalResponseSchema.parse(fixture.body);
        const first = entries[0];
        if (!first) {
            throw new Error('لا قيود في الالتقاط');
        }
        expect(journalEntryReadSchema.safeParse({ ...first, status: 'cancelled' }).success).toBe(false);
        expect(journalEntryReadSchema.safeParse({ ...first, extra: 1 }).success).toBe(false);
    });

    test('يقبل قيدًا بلا سطور — LEFT JOIN القديم يُصدر []', () => {
        const entries = journalResponseSchema.parse(fixture.body);
        const first = entries[0];
        if (!first) {
            throw new Error('لا قيود في الالتقاط');
        }
        expect(journalEntryReadSchema.safeParse({ ...first, lines: [] }).success).toBe(true);
    });
});

describe('/trial-balance', () => {
    const fixture = loadFixture('trial-balance');

    test('البيانات الملتقطة تُطابق المخطط كاملة', () => {
        const report = trialBalanceResponseSchema.parse(fixture.body);
        expect(report.from).toBe('2026-10-01');
        expect(report.to).toBe('2026-10-31');
        expect(report.accounts).toHaveLength(124);
        expect(report.balanced).toBe(true);
        expect(report.total_debit).toBe(report.total_credit);
    });

    test('المبالغ هنا نصوص NUMERIC لا أرقام — عقد القديم', () => {
        const report = trialBalanceResponseSchema.parse(fixture.body);
        for (const account of report.accounts) {
            expect(typeof account.debit).toBe('string');
            expect(typeof account.credit).toBe('string');
        }
    });

    test('يرفض ميزانًا غير متوازن الشكل (totals كنصوص)', () => {
        const report = trialBalanceResponseSchema.parse(fixture.body);
        expect(trialBalanceResponseSchema.safeParse({ ...report, total_debit: '4290326.37' }).success).toBe(false);
    });
});

describe('/vat-return', () => {
    const fixture = loadFixture('vat-return');

    test('البيانات الملتقطة تُطابق المخطط كاملة', () => {
        expect(fixture.meta.status).toBe(200);
        const report = vatReturnResponseSchema.parse(fixture.body);
        expect(report.from).toBe('2026-10-01');
        expect(report.input_vat).toBe(81517.48);
        expect(report.carry_forward_credit).toBe(81517.48);
        expect(report.purchases_crosscheck.count).toBe(259);
        expect(report.purchases_crosscheck.vat).toBe(81517.48);
    });

    test('يرفض حقلًا ناقصًا أو زائدًا', () => {
        const report = vatReturnResponseSchema.parse(fixture.body);
        expect(vatReturnResponseSchema.safeParse(omit(report, 'net_payable')).success).toBe(false);
        expect(vatReturnResponseSchema.safeParse({ ...report, extra: true }).success).toBe(false);
    });
});

describe('أخطاء 401/403 الملتقطة', () => {
    test('الشكل { error, message } في الحالتين', () => {
        const unauthorized = loadFixture('chart-no-auth');
        const forbidden = loadFixture('chart-forbidden-role');
        expect(unauthorized.meta.status).toBe(401);
        expect(forbidden.meta.status).toBe(403);
        expect(errorResponseSchema.parse(unauthorized.body)).toEqual({
            error: 'UNAUTHORIZED',
            message: 'Missing Bearer token.',
        });
        expect(errorResponseSchema.parse(forbidden.body).error).toBe('FORBIDDEN');
    });
});

describe('vatSettlementRequestSchema', () => {
    test('يقبل معاينة وترحيلًا', () => {
        expect(vatSettlementRequestSchema.parse({ month: '2026-10' })).toEqual({ month: '2026-10' });
        expect(vatSettlementRequestSchema.parse({ month: '2026-10', apply: true })).toEqual({
            month: '2026-10',
            apply: true,
        });
    });

    test('يرفض شهرًا غير صالح أو حقلًا زائدًا', () => {
        expect(vatSettlementRequestSchema.safeParse({ month: '2026-13' }).success).toBe(false);
        expect(vatSettlementRequestSchema.safeParse({ month: '2026-1' }).success).toBe(false);
        expect(vatSettlementRequestSchema.safeParse({ month: '2026-10', apply: 'yes' }).success).toBe(false);
        expect(vatSettlementRequestSchema.safeParse({ month: '2026-10', force: true }).success).toBe(false);
    });
});
