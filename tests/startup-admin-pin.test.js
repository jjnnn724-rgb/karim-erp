/**
 * startup-admin-pin.test.js — تثبيت كلمة مرور admin من .env عند الإقلاع
 * ═══════════════════════════════════════════════════════════════════════════
 * الدافع: خدمة Windows تشغّل `node backend/server.js --service` مباشرة ولا
 * تمرّ بمسار scripts/karimerp.js الذي يثبّت كلمة المرور. فكانت قيمة
 * KARIM_FIXED_ADMIN_PASSWORD في .env لا تحكم الخدمة إطلاقًا، وأي إعادة
 * تعيين لهشّ كلمة مرور admin في القاعدة كانت تبقى سارية حتى الإقلاع التالي.
 *
 * العقد هنا سلوكي (pool وهمي)، لا قراءة للملف: ما نتحقق منه هو الأثر
 * على القاعدة، لا شكل الكود.
 */
const bcrypt = require('bcryptjs');

describe('تثبيت كلمة مرور admin عند الإقلاع', () => {
    const ENV_KEY = 'KARIM_FIXED_ADMIN_PASSWORD';
    let original;
    let startup;

    beforeEach(() => {
        original = process.env[ENV_KEY];
        jest.resetModules();
        startup = require('../backend/startup');
    });

    afterEach(() => {
        if (original === undefined) {delete process.env[ENV_KEY];}
        else {process.env[ENV_KEY] = original;}
    });

    /** pool وهمي: يردّ صف admin ويعيد كل استعلام مُنفَّذ. */
    function fakePool(adminRow) {
        const calls = [];
        return {
            calls,
            query: jest.fn(async (sql, params) => {
                calls.push({ sql: String(sql), params });
                if (/FROM users WHERE username = 'admin'/i.test(String(sql))) {
                    return { rows: adminRow ? [adminRow] : [] };
                }
                return { rows: [], rowCount: 0 };
            }),
        };
    }

    test('بلا قيمة في .env لا كتابة ولا تثبيت ولا لمس لقاعدة البيانات', async () => {
        delete process.env[ENV_KEY];
        const pool = fakePool({ id: '1', password: '$2a$12$whatever' });
        const result = await startup.pinAdminPassword(pool, { writeAudit: jest.fn() });
        expect(result.details.pinned).toBe(false);
        expect(result.details.reason).toBe('no_fixed_password');
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('قيمة ضعيفة تُتجاهل ولا تُكتب — لا نقفل المالك خارج النظام', async () => {
        process.env[ENV_KEY] = 'short1';
        const pool = fakePool({ id: '1', password: '$2a$12$whatever' });
        const result = await startup.pinAdminPassword(pool, { writeAudit: jest.fn() });
        expect(result.details.pinned).toBe(false);
        expect(result.details.reason).toBe('weak_value_skipped');
        expect(result.warnings.map((w) => w.code)).toContain('WEAK_FIXED_ADMIN_PASSWORD');
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('قيمة بلا أرقام تُتجاهل حتى لو طويلة', async () => {
        process.env[ENV_KEY] = 'OnlyLettersHere';
        const pool = fakePool({ id: '1', password: '$2a$12$whatever' });
        const result = await startup.pinAdminPassword(pool, { writeAudit: jest.fn() });
        expect(result.details.reason).toBe('weak_value_skipped');
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('كلمة المرور مطابقة أصلًا: لا كتابة ولا تدقيق', async () => {
        process.env[ENV_KEY] = 'Str0ngEnoughPass';
        const hash = await bcrypt.hash('Str0ngEnoughPass', 12);
        const pool = fakePool({ id: '1', password: hash });
        const audit = jest.fn();
        const result = await startup.pinAdminPassword(pool, { writeAudit: audit });
        expect(result.details.pinned).toBe(false);
        expect(result.details.reason).toBe('already_matching');
        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(audit).not.toHaveBeenCalled();
    });

    test('اختلاف: يُكتب هاش جديد يطابق القيمة ويُسجَّل في التدقيق', async () => {
        process.env[ENV_KEY] = 'Str0ngEnoughPass';
        const oldHash = await bcrypt.hash('SomeOtherPass1', 12);
        const pool = fakePool({ id: '1', password: oldHash });
        const audit = jest.fn();
        const result = await startup.pinAdminPassword(pool, { writeAudit: audit });

        expect(result.details.pinned).toBe(true);
        const update = pool.calls.find((c) => /UPDATE users SET password/i.test(c.sql));
        expect(update).toBeTruthy();
        expect(update.params[1]).toBe('1');
        expect(await bcrypt.compare('Str0ngEnoughPass', update.params[0])).toBe(true);
        expect(await bcrypt.compare('SomeOtherPass1', update.params[0])).toBe(false);
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0].action).toBe('ADMIN_PASSWORD_PINNED');
    });

    test('فشل كتابة التدقيق لا يُسقط التثبيت ولا يمرّ بصمت', async () => {
        process.env[ENV_KEY] = 'Str0ngEnoughPass';
        const pool = fakePool({ id: '1', password: await bcrypt.hash('Other1Pass', 12) });
        const audit = jest.fn().mockRejectedValue(new Error('audit down'));
        const result = await startup.pinAdminPassword(pool, { writeAudit: audit });
        expect(result.details.pinned).toBe(true);
        expect(result.warnings.map((w) => w.code)).toContain('AUDIT_WRITE_FAILED');
    });

    test('لا مستخدم admin: تحذير بلا كتابة', async () => {
        process.env[ENV_KEY] = 'Str0ngEnoughPass';
        const pool = fakePool(null);
        const result = await startup.pinAdminPassword(pool, { writeAudit: jest.fn() });
        expect(result.details.reason).toBe('no_admin_user');
        expect(pool.query).toHaveBeenCalledTimes(1);
    });
});
