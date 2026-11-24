'use strict';
/** عقود إعدادات المستأجر — نقية (بلا قاعدة بيانات، بلا شبكة). */
const { createTenantSettings, loadBrandSource, CURRENCY_RE } = require('../backend/saas/tenant-settings');
const { tenantContext } = require('../backend/saas/tenant-context');
const { AsyncLocalStorage: store, updateTenantContext } = require('../backend/middleware/correlation');

const ID = '11111111-1111-4111-8111-111111111111';
const env = { DEFAULT_LANGUAGE: 'en', CURRENCY_DEFAULT: 'USD', DEFAULT_TAX_RATE: '0.10' };
function poolWith(rows) { return { async query() { return { rows }; } }; }

describe('tenant-settings', () => {
    test('يحمّل المفاتيح من قاعدة المستأجر', async () => {
        const s = createTenantSettings({ pool: poolWith([
            { key: 'locale', value: 'ar' },
            { key: 'tax_rate', value: 0.15 },
            { key: 'branding', value: { name: 'مطعمي', currency: 'SAR' } },
        ]), env });
        const got = await s.localization(ID);
        expect(got.lang).toBe('ar');
        expect(got.tax_rate).toBe(0.15);
        expect(got.currency).toBe('SAR');
        expect(got.branding.name).toBe('مطعمي');
    });

    test('يرجع null بلا مستأجر — فيبقى fallback العام', async () => {
        const s = createTenantSettings({ pool: poolWith([]), env });
        expect(await s.localization(null)).toBeNull();
    });

    test('يرجع null عند غياب صفوف أو فشل القاعدة', async () => {
        const s1 = createTenantSettings({ pool: poolWith([]), env });
        expect(await s1.localization(ID)).toBeNull();
        const s2 = createTenantSettings({ pool: { async query() { throw new Error('down'); } }, env });
        expect(await s2.localization(ID)).toBeNull();
    });

    test('يفضّل branding.currency على العملة العامة', async () => {
        const s = createTenantSettings({ pool: poolWith([
            { key: 'branding', value: { currency: 'EGP' } },
        ]), env });
        expect((await s.localization(ID)).currency).toBe('EGP');
    });

    test('يرفض عملة غير ISO وضريبة خارج النطاق', async () => {
        const s = createTenantSettings({ pool: poolWith([
            { key: 'branding', value: { currency: '???' } },
            { key: 'tax_rate', value: 5 },
        ]), env });
        const got = await s.localization(ID);
        expect(got.currency).toBe('SAR');
        expect(got.tax_rate).toBe(0.10);
    });

    test('CURRENCY_RE يسمح 3 أحرف فقط', () => {
        expect(CURRENCY_RE.test('SAR')).toBe(true);
        expect(CURRENCY_RE.test('US')).toBe(false);
        expect(CURRENCY_RE.test('USDT')).toBe(false);
    });

    test('الكاش يمنع استعلاماً ثانياً وclearCache يمسحه', async () => {
        let calls = 0;
        const pool = { async query() { calls++; return { rows: [{ key: 'locale', value: 'ar' }] }; } };
        const s = createTenantSettings({ pool, env });
        await s.load(ID);
        await s.load(ID);
        expect(calls).toBe(1);
        s.clearCache();
        await s.load(ID);
        expect(calls).toBe(2);
    });
});

describe('loadBrandSource / هوية مشتركة', () => {
    test('بلا سياق يقرأ صف settings العام بمعاملات', async () => {
        let captured = null;
        const pool = { async query(sql, params) { captured = { sql, params }; return { rows: [{ name: 'عام', currency: 'SAR', logoB64: '' }] }; } };
        const out = await loadBrandSource(pool);
        expect(out.name).toBe('عام');
        expect(captured.params).toEqual(['main_settings']);
        expect(captured.sql).toContain('$1');
    });

    test('مع سياق مستأجر يقرأ هوية المستأجر لا الصف العام', async () => {
        const tenantId = ID;
        const pool = {
            async query(sql, _params) {
                if (sql.includes('tenant_settings')) {
                    return { rows: [{ key: 'branding', value: { name: 'مطعمي', currency: 'EGP', logoB64: '' } }] };
                }
                throw new Error('global settings should not be queried');
            },
        };
        const out = await new Promise((resolve, reject) => {
            store.run({ requestId: 'r', tenantId: null, tenantClient: null }, () => {
                updateTenantContext({ id: tenantId, slug: 'shop' });
                loadBrandSource(pool).then(resolve, reject);
            });
        });
        expect(out).toEqual({ name: 'مطعمي', currency: 'EGP', logoB64: '' });
    });
});

describe('tenant-context / i18n is tenant-scoped', () => {
    test('i18n/config لا يُتخطّى عند التفعيل', async () => {
        const next = jest.fn();
        const res = { statusCode: 200, json() { return this; }, status(c) { this.statusCode = c; return this; } };
        const resolver = { async resolve() { return { id: ID, slug: 'shorfa', source: 'db' }; } };
        await tenantContext({ enabled: true, resolver })(
            { path: '/api/i18n/config', headers: { host: 'shorfa.karim-erp.com' } }, res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });
});
