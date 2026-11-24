'use strict';
/** عقود متريات SaaS — نقية. */
const { record, snapshot, prometheusFormat, reset, EVENTS, MAX_TENANTS } = require('../backend/saas/saas-metrics');

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

beforeEach(() => reset());

describe('saas-metrics', () => {
    test('تسجيل حدث بلا مستأجر', () => {
        record('signup_attempt');
        expect(snapshot().totals.signup_attempt).toBe(1);
        expect(snapshot().trackedTenants).toBe(0);
    });

    test('تسجيل أحداث لكل مستأجر على حدة', () => {
        record('quota_denied', T1);
        record('quota_allowed', T1);
        record('quota_denied', T2);
        const s = snapshot();
        expect(s.totals.quota_denied).toBe(2);
        expect(s.trackedTenants).toBe(2);
        expect(s.top).toEqual(expect.arrayContaining([
            expect.objectContaining({ tenantId: T1, quota_denied: 1, quota_allowed: 1 }),
            expect.objectContaining({ tenantId: T2, quota_denied: 1 }),
        ]));
    });

    test('يتجاهل حدثاً غير معروف', () => {
        record('drop_database');
        expect(Object.values(snapshot().totals).every((v) => v === 0)).toBe(true);
    });

    test('سقف cardinality: ما بعد 200 مستأجر يُحصى في other', () => {
        for (let i = 0; i < MAX_TENANTS + 5; i++) {
            record('tenant_required', `tenant-${i}`);
        }
        const s = snapshot();
        expect(s.trackedTenants).toBe(MAX_TENANTS);
        expect(s.otherTenants).toBe(5);
        expect(s.totals.tenant_required).toBe(MAX_TENANTS + 5);
    });

    test('reset يصفّر كل شيء', () => {
        record('signup_ok', T1);
        reset();
        const s = snapshot();
        expect(s.totals.signup_ok).toBe(0);
        expect(s.top).toHaveLength(0);
        expect(s.otherTenants).toBe(0);
    });

    test('prometheusFormat يخرج HELP/TYPE وعدّادات صحيحة', () => {
        record('quota_denied', T1);
        const text = prometheusFormat();
        expect(text).toContain('# TYPE karim_saas_events_total counter');
        expect(text).toContain('karim_saas_events_total{event="quota_denied"} 1');
        expect(text).toContain('karim_saas_tracked_tenants 1');
        expect(text).toContain(`tenant="${T1}"`);
    });

    test('EVENTS مغلقة', () => {
        expect(EVENTS).toContain('resolver_unavailable');
        expect(EVENTS).toContain('quota_denied');
        expect(Object.keys(snapshot().totals).sort()).toEqual([...EVENTS].sort());
    });
});
