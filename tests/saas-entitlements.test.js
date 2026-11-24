'use strict';
/** عقود حدود الاشتراك — نقية (بلا قاعدة بيانات، بلا شبكة). */
const { createEntitlements, METRICS } = require('../backend/saas/entitlements');

const ID = '11111111-1111-4111-8111-111111111111';
function poolWith(subRows, usageRows = []) {
    return {
        calls: [],
        async query(sql, params) {
            this.calls.push({ sql, params });
            if (sql.includes('FROM subscriptions')) { return { rows: subRows }; }
            if (sql.includes('usage_counters')) { return { rows: usageRows }; }
            return { rows: [] };
        },
    };
}
const proRow = {
    status: 'active', plan_id: 'pro', name: 'احترافي',
    max_branches: 5, max_users: 50, max_sales_per_month: null, max_storage_mb: 5000,
    current_period_end: null,
};

describe('entitlements / snapshot', () => {
    test('يقرأ الاشتراك والخطة والاستخدام', async () => {
        const e = createEntitlements({ pool: poolWith([proRow], [{ metric: 'branches', value: '3' }]) });
        const s = await e.snapshot(ID);
        expect(s.plan).toBe('pro');
        expect(s.limits.branches).toBe(5);
        expect(s.used.branches).toBe(3);
        expect(e.poolCalls).toBeUndefined();
    });

    test('غياب الاشتراك ⇒ خطة free كحد آمن', async () => {
        const e = createEntitlements({ pool: poolWith([]) });
        const s = await e.snapshot(ID);
        expect(s.plan).toBe('free');
        expect(s.limits).toEqual({ branches: 1, users: 5, sales: 100, storage_mb: 100 });
    });

    test('فشل مخزن الحدود ⇒ free لا Unlimited', async () => {
        const warn = jest.fn();
        const pool = { async query() { throw new Error('down'); } };
        const e = createEntitlements({ pool, logger: { warn } });
        const s = await e.snapshot(ID);
        expect(s.status).toBe('unavailable');
        expect(s.limits.users).toBe(5);
        expect(warn).toHaveBeenCalled();
    });

    test('بلا مستأجر ⇒ null', async () => {
        const e = createEntitlements({ pool: poolWith([]) });
        expect(await e.snapshot(null)).toBeNull();
    });
});

describe('entitlements / check', () => {
    test('يسمح تحت الحد', async () => {
        const e = createEntitlements({ pool: poolWith([proRow], [{ metric: 'branches', value: '3' }]) });
        expect(await e.check(ID, 'branches', 1)).toMatchObject({ allowed: true, remaining: 1 });
    });

    test('يرفض عند تجاوز الحد', async () => {
        const e = createEntitlements({ pool: poolWith([proRow], [{ metric: 'branches', value: '5' }]) });
        expect(await e.check(ID, 'branches', 1)).toMatchObject({
            allowed: false, reason: 'PLAN_LIMIT_REACHED', limit: 5,
        });
    });

    test('يسمح بلا حدود عند NULL', async () => {
        const e = createEntitlements({ pool: poolWith([proRow]) });
        expect(await e.check(ID, 'sales', 10_000)).toMatchObject({ allowed: true, unlimited: true });
    });

    test('يرفض قياساً غير معروف', async () => {
        const e = createEntitlements({ pool: poolWith([proRow]) });
        expect(await e.check(ID, 'drop_table')).toMatchObject({ allowed: false, reason: 'INVALID_METRIC' });
    });

    test('يرفض اشتراكاً ملغياً أو متأخراً', async () => {
        for (const status of ['canceled', 'past_due']) {
            const e = createEntitlements({ pool: poolWith([{ ...proRow, status }]) });
            expect(await e.check(ID, 'branches')).toMatchObject({ allowed: false, reason: 'SUBSCRIPTION_INACTIVE' });
        }
    });

    test('METRICS مغلقة', () => {
        expect([...METRICS].sort()).toEqual(['branches', 'sales', 'storage_mb', 'users']);
    });

    test('الكاش يمنع إعادة القراءة وclearCache يمسحه', async () => {
        const pool = poolWith([proRow]);
        const e = createEntitlements({ pool });
        await e.snapshot(ID);
        await e.snapshot(ID);
        expect(pool.calls.filter((c) => c.sql.includes('FROM subscriptions'))).toHaveLength(1);
        e.clearCache();
        await e.snapshot(ID);
        expect(pool.calls.filter((c) => c.sql.includes('FROM subscriptions'))).toHaveLength(2);
    });
});
