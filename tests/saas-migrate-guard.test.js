'use strict';
/**
 * عقود حارس ترحيل SaaS — كلها نقية (بلا قاعدة بيانات، بلا شبكة).
 * تثبت أن الإنتاج والقواعد المشتركة محجوبة، وأن النسخ المنفصلة فقط مسموحة.
 */
const { validate, parseArgs, SAFE_SUFFIXES, PROD_DB, SHARED_TEST_DB } = require('../scripts/saas-migrate-guard');

const baseEnv = { DB_NAME: '', NODE_ENV: 'development' };
const goodArgs = {
    target: 'karim_tenant_dev',
    // ملف حقيقي موجود — الحارس يتحقق من الوجود على القرص.
    migration: '153_login_lockouts.sql',
    confirm: true,
    dryRun: true,
};

describe('saas-migrate-guard / parseArgs', () => {
    test('يقرأ الوسطاء الصريحين', () => {
        const parsed = parseArgs([
            '--target=karim_copy_a',
            '--migration=155_tenants_foundation.sql',
            '--i-confirm-copy',
            '--dry-run',
        ]);
        expect(parsed.error).toBeUndefined();
        expect(parsed.args).toEqual({
            target: 'karim_copy_a',
            migration: '155_tenants_foundation.sql',
            confirm: true,
            dryRun: true,
        });
    });

    test('يرفض وسيطًا غير معروف', () => {
        expect(parseArgs(['--force']).error).toMatch(/وسيط غير معروف/);
    });
});

describe('saas-migrate-guard / validate', () => {
    test('يمرّر هدف نسخة منفصلة صحيح', () => {
        const verdict = validate(goodArgs, baseEnv);
        expect(verdict).toEqual({
            ok: true,
            target: 'karim_tenant_dev',
            migration: '153_login_lockouts.sql',
            dryRun: true,
        });
    });

    test.each(SAFE_SUFFIXES)('يقبل اللاحقة %s', (suffix) => {
        expect(validate({ ...goodArgs, target: `shop${suffix}` }, baseEnv).ok).toBe(true);
    });

    test('يرفض الإنتاج بالاسم', () => {
        expect(PROD_DB).toBe('karim_erp');
        const verdict = validate({ ...goodArgs, target: PROD_DB }, baseEnv);
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/ممنوع استهداف/);
    });

    test('يرفض قاعدة الاختبار المشتركة', () => {
        expect(SHARED_TEST_DB).toBe('karim_erp_test');
        expect(validate({ ...goodArgs, target: SHARED_TEST_DB }, baseEnv).ok).toBe(false);
    });

    test('يرفض NODE_ENV=production حتى لو الاسم آمن', () => {
        const verdict = validate(goodArgs, { ...baseEnv, NODE_ENV: 'production' });
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/NODE_ENV=production/);
    });

    test('يرفض مضيفًا غير loopback (سياسة assertIsolatedTarget)', () => {
        const verdict = validate(goodArgs, { ...baseEnv, DB_HOST: 'db.production.internal' });
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/ليس loopback/);
    });

    test('يرفض غياب تأكيد النسخ', () => {
        expect(validate({ ...goodArgs, confirm: false }, baseEnv).reason).toMatch(/--i-confirm-copy/);
    });

    test('يرفض غياب الهدف أو الترحيل', () => {
        expect(validate({ ...goodArgs, target: '' }, baseEnv).reason).toMatch(/--target/);
        expect(validate({ ...goodArgs, migration: '' }, baseEnv).reason).toMatch(/--migration/);
    });

    test('يرفض تعارض DB_NAME مع الهدف', () => {
        const verdict = validate(goodArgs, { ...baseEnv, DB_NAME: 'karim_erp' });
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toMatch(/تعارض/);
    });

    test('يرفض مسارات الترحيل والملفات المعدّلة', () => {
        expect(validate({ ...goodArgs, migration: '../../etc/passwd.sql' }, baseEnv).ok).toBe(false);
        expect(validate({ ...goodArgs, migration: '003_cashier_module.sql.bak' }, baseEnv).ok).toBe(false);
        expect(validate({ ...goodArgs, migration: '155_x_down.sql' }, baseEnv).ok).toBe(false);
    });

    test('يرفض اسمًا بلا لاحقة آمنة', () => {
        expect(validate({ ...goodArgs, target: 'karim_erp_backup' }, baseEnv).ok).toBe(false);
    });
});
