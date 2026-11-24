/**
 * user-password-policy.test.js — تدوير كلمة المرور عند تعيينها من غير صاحبها
 * ═══════════════════════════════════════════════════════════════════════════
 * القاعدة الأمنية: كلمة مرور يضعها المدير/المسؤول لحساب غيره يعرفها معه،
 * فيُجبر الموظف على تغييرها عند أول دخول. هذه الاختبارات تحرس القاعدة
 * ومفتاح إيقافها وكسرها الصريح، ثم تتحقق أن مساري تعديل المستخدم في
 * server.js يطبّقانها فعلاً بجوار تجزئة كلمة المرور.
 */
const fs = require('fs');
const path = require('path');
const { forcesPasswordRotation } = require('../backend/user-password-policy');

describe('سياسة تدوير كلمة المرور', () => {
    test('المدير يعيّن كلمة مرور لموظف آخر ⇒ إجبار التغيير', () => {
        expect(forcesPasswordRotation({ env: {}, actorId: 1, targetId: 7, body: {} })).toBe(true);
    });

    test('صاحب الحساب يغيّر كلمته بنفسه ⇒ لا إجبار', () => {
        expect(forcesPasswordRotation({ env: {}, actorId: 7, targetId: 7, body: {} })).toBe(false);
    });

    test('الكسر الصريح must_change_password=false/0/"false" ⇒ يُحترم', () => {
        for (const override of [false, 0, 'false', '0']) {
            expect(forcesPasswordRotation({ env: {}, actorId: 1, targetId: 7, body: { must_change_password: override } }))
                .toBe(false);
        }
    });

    test('القيمة الصريحة true لا تُلغي الإجبار', () => {
        expect(forcesPasswordRotation({ env: {}, actorId: 1, targetId: 7, body: { must_change_password: true } }))
            .toBe(true);
    });

    test('مفتاح الإيقاف KARIM_FORCE_PASSWORD_CHANGE_ON_RESET=0 يوقف القاعدة', () => {
        expect(forcesPasswordRotation({
            env: { KARIM_FORCE_PASSWORD_CHANGE_ON_RESET: '0' }, actorId: 1, targetId: 7, body: {},
        })).toBe(false);
        expect(forcesPasswordRotation({
            env: { KARIM_FORCE_PASSWORD_CHANGE_ON_RESET: '1' }, actorId: 1, targetId: 7, body: {},
        })).toBe(true);
    });

    test('معرّف ناقص (عامل نظام/سكربت) ⇒ إجبار افتراضي', () => {
        expect(forcesPasswordRotation({ env: {}, body: {} })).toBe(true);
    });
});

describe('ربط السياسة بمساري تعديل المستخدم', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'backend', 'server.js'), 'utf8');

    test('server.js يستورد السياسة', () => {
        expect(src).toMatch(/require\('\.\/user-password-policy'\)/);
    });

    test('كل تجزئة كلمة مرور في التعديل يتبعها قرار الإجبار على must_change_password', () => {
        const hashes = [...src.matchAll(/filtered = \{ \.\.\.filtered, password: await bcrypt\.hash\(String\(filtered\.password\), 12\) \};([\s\S]{0,700})/g)];
        expect(hashes.length).toBeGreaterThanOrEqual(2);
        for (const [, tail] of hashes) {
            expect(tail).toMatch(/forcesPasswordRotation\(\{ actorId: req\.user\?\.id, targetId: id, body: req\.body \}\)/);
            expect(tail).toMatch(/filtered\.must_change_password = true;/);
        }
    });

    test('سجل التدقيق يحمل قرار الإجبار', () => {
        expect(src).toMatch(/force_password_change: filtered\.must_change_password === true/);
    });

    test('الحقل مقبول في مخطط users ليسقط الكسر الصريح بدل رفضه 400', () => {
        const registry = fs.readFileSync(path.join(__dirname, '..', 'backend', 'schema-registry.js'), 'utf8');
        const users = registry.slice(registry.indexOf('users: {'), registry.indexOf('// ─── HR Departments'));
        expect(users).toMatch(/writeable:[^\n]*'must_change_password'/);
        expect(users).toMatch(/must_change_password: TYPES\.BOOLEAN/);
    });
});
