import { describe, expect, it } from 'vitest';
import {
    alertsLogSchema,
    apAgingSchema,
    bankRecSchema,
    budgetVsActualSchema,
    custodySchema,
    fixedAssetsSchema,
    profitByCcSchema,
} from './cfo-growth';

/** الأشكال أدناه منسوخة من ردود الإنتاج الفعلي 2026-11-09 (`/api/accounting/*`). */

describe('عقود تبويبات المدير المالي السبعة', () => {
    it('ربحية المراكز', () => {
        const parsed = profitByCcSchema.safeParse({
            ok: true,
            from: '2026-11-01',
            to: '2026-11-10',
            centers: [{ cc: '—', cc_name: null, revenue: 941003.01, cogs: 0, expense: 0, net: 941003.01 }],
        });
        expect(parsed.success).toBe(true);
    });

    it('أعمار الذمم', () => {
        const parsed = apAgingSchema.safeParse({
            ok: true,
            count: 4,
            total: 47812.22,
            aging: [{ supplier: 'شركة اليسرة للأغذية', total: 47812.22, current: 47812.22, d30: 0, d60: 0, d90: 0, over90: 0 }],
        });
        expect(parsed.success).toBe(true);
    });

    it('التسوية البنكية', () => {
        const parsed = bankRecSchema.safeParse({
            ok: true,
            account: '1010',
            from: '2026-11-01',
            to: '2026-11-10',
            book: 0,
            statement: 0,
            diff: 0,
            unmatched: [],
        });
        expect(parsed.success).toBe(true);
    });

    it('الأصول المشتقة في الخادم (monthly/remaining)', () => {
        const parsed = fixedAssetsSchema.safeParse({
            ok: true,
            assets: [
                {
                    id: 3,
                    name: 'فرن مخبز',
                    cost: 12000,
                    salvage: 0,
                    accumulated: 2000,
                    life_months: 24,
                    status: 'active',
                    last_month: '2026-10',
                    monthly: 500,
                    remaining: 10000,
                },
            ],
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.assets?.[0]?.monthly).toBe(500);
        }
    });

    it('العهد', () => {
        const parsed = custodySchema.safeParse({
            ok: true,
            date: '2026-11-10',
            myPending: 0,
            rows: [
                {
                    id: 9,
                    custody_date: '2026-11-10',
                    from_cashier: 4,
                    to_cashier: 5,
                    from_name: 'سالم',
                    to_name: 'خالد',
                    amount: 750,
                    note: null,
                    ack_at: null,
                },
            ],
        });
        expect(parsed.success).toBe(true);
    });

    it('الموازنات — حقول الحكم من الخادم لا من الواجهة', () => {
        const parsed = budgetVsActualSchema.safeParse({
            ok: true,
            period: '2026-11',
            rows: [
                {
                    id: 5,
                    label: 'موازنة المشتريات',
                    account_code: '5000',
                    account_name: 'مشتريات',
                    acc_type: 'expense',
                    budget: 1000,
                    actual: 1300,
                    variance: 300,
                    over: true,
                    under: false,
                    alert: true,
                    pct: 130,
                },
            ],
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.rows?.[0]?.alert).toBe(true);
        }
    });

    it('سجل التنبيهات', () => {
        const parsed = alertsLogSchema.safeParse({
            ok: true,
            log: [
                {
                    key: 'stale-shifts:2026-11-10',
                    last_sent_at: '2026-11-09T21:03:24.952Z',
                    last_title: 'ورديات عالقة',
                    times_sent: 1,
                },
            ],
        });
        expect(parsed.success).toBe(true);
    });
});
