import { describe, expect, it } from 'vitest';
import { buildPnlLines, pnlResponseSchema } from './pnl';

/**
 * العقد الحقيقي: الشكل أدناه منسوخ من ردّ الإنتاج الفعلي
 * `GET /api/finance/pnl` بتاريخ 2026-11-09 (فترة 2026-11-01 → 2026-11-10)،
 * مع تقليص القوائم الطويلة فقط. أهم ما كان يكسر المخطط:
 *  - `payroll.months` مصفوفة مفاتيح `YYYY-MM` لا رقمًا.
 *  - `by_department` يحمل `rolledUp` و`subDepartments` بعد الترحيل للأب.
 *  - `margin_pct` قد يكون `null` (إيراد صفري).
 *  - حقول إضافية: `internal_moves`، `expense_row_count`، `losses/gains`.
 */
const livePayload = {
    period: { from: '2026-11-01', to: '2026-11-10' },
    previous_period: { from: '2026-10-22', to: '2026-10-31' },
    statement: {
        period: { from: '2026-11-01', to: '2026-11-10' },
        revenue: {
            pos_net: 0,
            manual: 689445.33,
            total: 689445.33,
            pos_gross: 0,
            vat_collected: 0,
            pos_discounts: 0,
            invoice_count: 0,
            manual_count: 9232,
        },
        cogs: { dispatch: 204207.59, returns: -41.26, net: 204166.33, count: 1085 },
        gross_profit: { amount: 485279, margin_pct: 70.39 },
        shrinkage: { amount: 0, count: 0, losses: 0, gains: 0 },
        operating: { items: [], total: 0, count: 0 },
        internal_moves: { amount: 0, count: 32 },
        payroll: { total: 0, count: 0, months: [] },
        net_profit: { amount: 485279, margin_pct: 70.39 },
        expense_row_count: 1117,
        by_department: [
            {
                code: 'ys_cc_9',
                name: 'مبيعات كاشير 9',
                revenue: 379119.66,
                manual: 379119.66,
                cogs: 0,
                shrinkage: 0,
                operating: 0,
                net: 379119.66,
                margin_pct: 100,
            },
            {
                code: 'kitchen',
                name: 'المطبخ',
                revenue: 0,
                manual: 0,
                cogs: 176133.32,
                shrinkage: 0,
                operating: 0,
                net: -176133.32,
                margin_pct: null,
                subDepartments: [
                    { code: 'sweets', name: 'قسم الحلواني', revenue: 0, operating: 0, net: -8496.59 },
                ],
            },
            {
                code: 'sweets',
                name: 'قسم الحلواني',
                revenue: 0,
                manual: 0,
                cogs: 8496.59,
                shrinkage: 0,
                operating: 0,
                net: -8496.59,
                margin_pct: null,
                rolledUp: true,
            },
        ],
        daily_series: [{ date: '2026-11-01', revenue: 68166.6, cogs: 28332.4, opex: 0 }],
        checks: { balanced: true },
    },
    comparison: {
        revenue: { current: 689445.33, previous: 845467.46, delta: -156022.13, pct: -18.45 },
        net_profit: { current: 485279, previous: 605092.05, delta: -119813.05, pct: -19.8 },
    },
    generated_at: '2026-11-09T21:05:24.160Z',
    generated_by: 'مدير النظام',
};

describe('عقد قائمة الأرباح والخسائر', () => {
    it('يقبل ردّ الإنتاج كما هو', () => {
        const parsed = pnlResponseSchema.safeParse(livePayload);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.statement?.payroll?.months).toEqual([]);
            expect(parsed.data.statement?.by_department?.[2]?.rolledUp).toBe(true);
        }
    });

    it('يرفض `payroll.months` كرقم — شكل الاستجابة القديم المكسور', () => {
        const broken = structuredClone(livePayload);
        broken.statement.payroll = { total: 2000, count: 1, months: 1 } as never;
        expect(pnlResponseSchema.safeParse(broken).success).toBe(false);
    });

    it('يعدّ الأشهر من المصفوفة لا من قيمة واحدة', () => {
        const statement = {
            ...livePayload.statement,
            payroll: { total: 2000, count: 1, months: ['2026-10'] },
        };
        const payrollLine = buildPnlLines(statement).find((line) => line.id === 'payroll');
        expect(payrollLine?.hint).toBe('1 شهرًا مرحّلًا');
        expect(payrollLine?.value).toBe(2000);
    });
});
