'use strict';
/** عقود التسجيل الذاتي — نقية (بلا قاعدة بيانات، بلا شبكة). */
const { provisionTenant, validate, SLUG_RE } = require('../backend/saas/onboarding');
const { register: registerRoutes, isEnabled, allow, MAX_PER_IP } = require('../backend/saas/onboarding-routes');

const good = {
    slug: 'My_Shop'.replace('_', '-'),
    name: 'مطعمي',
    admin: { username: 'owner1', password: 'StrongPassw0rd!', name: 'المالك' },
    planId: 'pro',
};

function fakeClient(overrides = {}) {
    return {
        calls: [],
        released: false,
        async query(sql, params) {
            this.calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
            if (overrides.failOn && sql.includes(overrides.failOn)) { throw new Error('boom'); }
            if (overrides.slugTaken && sql.includes('SELECT 1 FROM tenants')) { return { rowCount: 1, rows: [{}] }; }
            return { rows: [], rowCount: 0 };
        },
        release() { this.released = true; },
    };
}
function poolWith(client) { return { async connect() { return client; } }; }

describe('onboarding / validate', () => {
    test('يُطبع الـslug ويملأ الافتراضات', () => {
        const v = validate({ slug: 'MyShop', name: 'مطعم', admin: { username: 'abc', password: '123456789012' } });
        expect(v.slug).toBe('myshop');
        expect(v.currency).toBe('SAR');
        expect(v.locale).toBe('ar');
        expect(v.planId).toBe('free');
    });

    test.each(['bad_slug', 'a', '-start', 'end-', 'has space'])('يرفض slug غير صالح: %p', (slug) => {
        expect(SLUG_RE.test(slug)).toBe(false);
        expect(() => validate({ ...good, slug })).toThrow('INVALID_SLUG');
    });

    test('يرفض كلمة مرور قصيرة وبريد مكسور', () => {
        expect(() => validate({ ...good, admin: { ...good.admin, password: 'short' } })).toThrow('WEAK_PASSWORD');
        expect(() => validate({ ...good, admin: { ...good.admin, email: 'nope' } })).toThrow('INVALID_EMAIL');
    });
});

describe('onboarding / provisionTenant', () => {
    test('ينشئ الكيانات الخمسة في معاملة واحدة ويُغلقها', async () => {
        const client = fakeClient();
        const out = await provisionTenant({ pool: poolWith(client), input: good, bcryptRounds: 4 });
        expect(out.ok).toBe(true);
        expect(out.slug).toBe('my-shop');
        expect(out.plan).toBe('pro');
        expect(out.password).toBeUndefined();
        expect(JSON.stringify(out)).not.toContain('StrongPassw0rd');

        const sql = client.calls.map((c) => c.sql);
        expect(sql[0]).toBe('BEGIN');
        expect(sql.some((s) => s.includes('INSERT INTO tenants'))).toBe(true);
        expect(sql.some((s) => s.includes('INSERT INTO users'))).toBe(true);
        expect(sql.some((s) => s.includes('INSERT INTO tenant_users'))).toBe(true);
        expect(sql.some((s) => s.includes('INSERT INTO tenant_settings'))).toBe(true);
        expect(sql.some((s) => s.includes('INSERT INTO subscriptions'))).toBe(true);
        expect(sql[sql.length - 1]).toBe('COMMIT');
        expect(client.released).toBe(true);

        const userCall = client.calls.find((c) => c.sql.includes('INSERT INTO users'));
        expect(userCall.params[2]).not.toBe(good.admin.password);
        expect(userCall.params[2]).toMatch(/^\$2[aby]\$/);
    });

    test('يرفض slug مكرر ويتعافى بالـROLLBACK', async () => {
        const client = fakeClient({ slugTaken: true });
        await expect(provisionTenant({ pool: poolWith(client), input: good, bcryptRounds: 4 }))
            .rejects.toMatchObject({ code: 'SLUG_TAKEN', status: 409 });
        expect(client.calls.map((c) => c.sql)).toContain('ROLLBACK');
        expect(client.calls.map((c) => c.sql)).not.toContain('COMMIT');
        expect(client.released).toBe(true);
    });

    test('أي فشل في المنتصف ⇒ ROLLBACK كامل', async () => {
        const client = fakeClient({ failOn: 'tenant_settings' });
        await expect(provisionTenant({ pool: poolWith(client), input: good, bcryptRounds: 4 }))
            .rejects.toThrow('boom');
        expect(client.calls.map((c) => c.sql)).toContain('ROLLBACK');
        expect(client.released).toBe(true);
    });
});

describe('onboarding-routes / حماية نقطة الدخول', () => {
    test('isEnabled مطفأ افتراضياً', () => {
        expect(isEnabled(undefined)).toBe(false);
        expect(isEnabled('false')).toBe(false);
        expect(isEnabled('1')).toBe(true);
    });

    test('المسار 404 عند الإطفاء', async () => {
        let handler = null;
        registerRoutes({ post: (_path, fn) => { handler = fn; } });
        const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
        const saved = process.env.SAAS_SIGNUP_ENABLED;
        delete process.env.SAAS_SIGNUP_ENABLED;
        await handler({ ip: '127.0.0.1', body: {} }, res);
        process.env.SAAS_SIGNUP_ENABLED = saved;
        expect(res.statusCode).toBe(404);
        expect(res.body.error).toBe('NOT_FOUND');
    });

    test('حد 5 محاولات لكل IP', () => {
        const ip = '10.0.0.test-onboarding';
        for (let i = 0; i < MAX_PER_IP; i++) { expect(allow(ip)).toBe(true); }
        expect(allow(ip)).toBe(false);
    });
});
