'use strict';
/**
 * عقود سياق المستأجر — نقية (بلا قاعدة بيانات، بلا خادم، بلا شبكة).
 * تثبت أن المطفأ no-op حرفياً، وأن المفعّل fail-closed ولا يثق بترويسة العميل.
 */
const {
    tenantContext,
    isEnabled,
    parseTenantMap,
    slugFromHost,
    resolveTenant,
    PUBLIC_PREFIXES,
} = require('../backend/saas/tenant-context');

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const map = new Map([['shorfa', TENANT_ID]]);

function fakeReq(overrides = {}) {
    return {
        path: '/api/products',
        originalUrl: '/api/products',
        headers: { host: 'shorfa.karim-erp.com' },
        ...overrides,
    };
}

function fakeRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

describe('tenant-context / isEnabled', () => {
    test.each([undefined, null, false, 'false', '0', 'off', 'NO', ''])('يقبل الإطفاء: %p', (v) => {
        expect(isEnabled(v)).toBe(false);
    });
    test.each([true, 'true', '1', 'YES', 'on'])('يقبل التفعيل: %p', (v) => {
        expect(isEnabled(v)).toBe(true);
    });
});

describe('tenant-context / parseTenantMap', () => {
    test('يقرأ slug:uuid صالحاً', () => {
        expect(parseTenantMap(`shorfa:${TENANT_ID},other:${OTHER_ID}`)).toEqual(new Map([
            ['shorfa', TENANT_ID],
            ['other', OTHER_ID],
        ]));
    });
    test('يتجاهل الإدخالات المزيفة والمشوّهة', () => {
        const parsed = parseTenantMap(`bad_slug:${TENANT_ID},shorfa:not-a-uuid,ok:${TENANT_ID}`);
        expect(parsed.size).toBe(1);
        expect(parsed.get('ok')).toBe(TENANT_ID);
    });
});

describe('tenant-context / slugFromHost', () => {
    test('يقرأ أول تسمية من subdomain', () => {
        expect(slugFromHost('shorfa.karim-erp.com:443')).toBe('shorfa');
        expect(slugFromHost('shorfa.karim-erp.com, proxy')).toBe('shorfa');
    });
    test('يرفض localhost و IP والنطاق الجذري', () => {
        expect(slugFromHost('localhost')).toBeNull();
        expect(slugFromHost('127.0.0.1')).toBeNull();
        expect(slugFromHost('app.karim-erp.com')).toBeNull();
    });
});

describe('tenant-context / resolveTenant', () => {
    test('يحل المستأجر من النطاق فقط', () => {
        expect(resolveTenant(fakeReq(), map)).toEqual({ id: TENANT_ID, slug: 'shorfa', source: 'subdomain' });
    });
    test('يرفض.slug غير مسجّل', () => {
        expect(resolveTenant(fakeReq({ headers: { host: 'attacker.karim-erp.com' } }), map)).toBeNull();
    });
    test('X-Forwarded-Host له الأولوية على Host', () => {
        const req = fakeReq({ headers: { host: 'attacker.example', 'x-forwarded-host': 'shorfa.karim-erp.com' } });
        expect(resolveTenant(req, map).id).toBe(TENANT_ID);
    });
});

describe('tenant-context / middleware', () => {
    test('عند الإطفاء: no-op تام حتى مع مضيف مجهول', () => {
        const next = jest.fn();
        const res = fakeRes();
        tenantContext({ enabled: false, map })(fakeReq({ headers: { host: 'unknown.example' } }), res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBe(200);
        expect(res.body).toBeNull();
    });

    test('عند التفعيل: 403 fail-closed بلا مستأجر', () => {
        const next = jest.fn();
        const res = fakeRes();
        tenantContext({ enabled: true, map })(fakeReq({ headers: { host: 'unknown.example' } }), res, next);
        expect(res.statusCode).toBe(403);
        expect(res.body.error).toBe('TENANT_REQUIRED');
        expect(next).not.toHaveBeenCalled();
    });

    test('عند التفعيل: يمرّر المسارات العامة', () => {
        for (const prefix of PUBLIC_PREFIXES) {
            const next = jest.fn();
            const res = fakeRes();
            tenantContext({ enabled: true, map })(fakeReq({ path: prefix, headers: {} }), res, next);
            expect(next).toHaveBeenCalledTimes(1);
        }
    });

    test('عند التفعيل: يضبط req.tenant ويكمل', () => {
        const next = jest.fn();
        const res = fakeRes();
        const req = fakeReq();
        tenantContext({ enabled: true, map })(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(req.tenant).toEqual({ id: TENANT_ID, slug: 'shorfa', source: 'subdomain' });
    });

    test('يرفض توكنًا بمعرّف مستأجر آخر (TENANT_MISMATCH)', () => {
        const next = jest.fn();
        const res = fakeRes();
        const req = fakeReq({ headers: { host: 'shorfa.karim-erp.com', authorization: 'Bearer fake' } });
        tenantContext({ enabled: true, map, verifyToken: () => ({ tid: OTHER_ID }) })(req, res, next);
        expect(res.statusCode).toBe(403);
        expect(res.body.error).toBe('TENANT_MISMATCH');
        expect(next).not.toHaveBeenCalled();
    });

    test('يتجاهل توكنًا غير صالح ويتركه لطبقة المصادقة', () => {
        const next = jest.fn();
        const res = fakeRes();
        const req = fakeReq({ headers: { host: 'shorfa.karim-erp.com', authorization: 'Bearer bad' } });
        tenantContext({ enabled: true, map, verifyToken: () => { throw new Error('expired'); } })(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBe(200);
    });
});
