'use strict';
/** عقود حل المستأجر من DB — نقية (بلا قاعدة بيانات، بلا شبكة). */
const { createTenantResolver, DEFAULT_TTL_MS } = require('../backend/saas/tenant-resolver');
const { tenantContext } = require('../backend/saas/tenant-context');

const ID = '11111111-1111-4111-8111-111111111111';
const envMap = new Map([['devshop', ID.replace(/^1/, '9')]]);

function poolReturning(rows) {
    return { async query() { return { rows }; } };
}

describe('tenant-resolver / createTenantResolver', () => {
    test('يحل من صف tenants ويعيد source=db', async () => {
        const r = createTenantResolver({ pool: poolReturning([{ id: ID, slug: 'shorfa' }]) });
        expect(await r.resolve('shorfa')).toEqual({ id: ID, slug: 'shorfa', source: 'db' });
    });

    test('يستخدم معاملات SQL لا إلصاق نصي', async () => {
        let captured = null;
        const pool = { async query(sql, params) { captured = { sql, params }; return { rows: [] }; } };
        const r = createTenantResolver({ pool, envMap });
        await r.resolve('shorfa');
        expect(captured.params).toEqual(['shorfa']);
        expect(captured.sql).toContain('$1');
        expect(captured.sql).not.toContain('shorfa');
    });

    test('يرجع لخريطة البيئة عند غياب الصف', async () => {
        const r = createTenantResolver({ pool: poolReturning([]), envMap });
        const got = await r.resolve('devshop');
        expect(got.source).toBe('env');
        expect(got.id).toBe(envMap.get('devshop'));
    });

    test('يرجع لخريطة البيئة عند فشل القاعدة', async () => {
        const warn = jest.fn();
        const pool = { async query() { throw new Error('db down'); } };
        const r = createTenantResolver({ pool, envMap, logger: { warn } });
        const got = await r.resolve('devshop');
        expect(got.source).toBe('env');
        expect(warn).toHaveBeenCalledTimes(1);
    });

    test('يرجع null لمستأجر غير معروف', async () => {
        const r = createTenantResolver({ pool: poolReturning([]) });
        expect(await r.resolve('unknown')).toBeNull();
    });

    test('الكاش يمنع استعلاماً ثانياً قبل انتهاء TTL', async () => {
        let calls = 0;
        const pool = { async query() { calls++; return { rows: [{ id: ID, slug: 'shorfa' }] }; } };
        const r = createTenantResolver({ pool, ttlMs: DEFAULT_TTL_MS });
        await r.resolve('shorfa');
        await r.resolve('shorfa');
        expect(calls).toBe(1);
    });

    test('ينتهي الكاش فيعيد الاستعلام', async () => {
        let calls = 0;
        const pool = { async query() { calls++; return { rows: [{ id: ID, slug: 'shorfa' }] }; } };
        const r = createTenantResolver({ pool, ttlMs: -1 });
        await r.resolve('shorfa');
        await r.resolve('shorfa');
        expect(calls).toBe(2);
    });

    test('clearCache يمسح الكاش', async () => {
        let calls = 0;
        const pool = { async query() { calls++; return { rows: [{ id: ID, slug: 'shorfa' }] }; } };
        const r = createTenantResolver({ pool });
        await r.resolve('shorfa');
        r.clearCache();
        await r.resolve('shorfa');
        expect(calls).toBe(2);
    });
});

describe('tenant-context with async resolver', () => {
    function fakeRes() {
        return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    }

    test('ينتظر الحل من DB ثم يكمل', async () => {
        const resolver = { async resolve() { return { id: ID, slug: 'shorfa', source: 'db' }; } };
        const next = jest.fn();
        const req = { path: '/api/products', headers: { host: 'shorfa.karim-erp.com' } };
        const res = fakeRes();
        await tenantContext({ enabled: true, resolver })(req, res, next);
        expect(res.statusCode).toBe(200);
        expect(next).toHaveBeenCalledTimes(1);
        expect(req.tenant.id).toBe(ID);
    });

    test('503 fail-closed عند فشل الحل', async () => {
        const resolver = { async resolve() { throw new Error('boom'); } };
        const next = jest.fn();
        const res = fakeRes();
        await tenantContext({ enabled: true, resolver })(
            { path: '/api/products', headers: { host: 'shorfa.karim-erp.com' } }, res, next);
        expect(res.statusCode).toBe(503);
        expect(res.body.error).toBe('TENANT_RESOLVER_UNAVAILABLE');
        expect(next).not.toHaveBeenCalled();
    });
});
