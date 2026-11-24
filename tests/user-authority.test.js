/**
 * user-authority.test.js — هرمية الحسابات وحماية آخر مالك/مسؤول
 * ═══════════════════════════════════════════════════════════════════════
 * يغلق الانحدار الذي كشفه تدقيق 2026-10-27: مدير كان يستطيع تعديل حساب
 * المالك/المسؤول العام أو إصدار رمز استعادة له (استيلاء عمودي)، ومسؤول
 * يستطيع استهداف مسؤول آخر (استيلاء أفقي). الاختبارات هنا نقية، إضافة إلى
 * فحص ربط المسارات بالمصدر (server.js + password-recovery-routes.js).
 */
const fs = require('fs');
const path = require('path');
const {
    canManage, evaluateUserMutation, evaluateLastPrivileged, rankOf,
} = require('../backend/user-authority');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const deny = (out) => {
    expect(out.ok).toBe(false);
    return out;
};

describe('الترتيب الهرمي — owner > admin > manager > بقية الأدوار', () => {
    test('owner أعلى من admin، وadmin أعلى من manager', () => {
        expect(rankOf('owner')).toBeGreaterThan(rankOf('admin'));
        expect(rankOf('admin')).toBeGreaterThan(rankOf('manager'));
        expect(rankOf('manager')).toBeGreaterThan(rankOf('cashier'));
    });

    test('المدير يدير الأدنى فقط — لا admin/owner/ند', () => {
        expect(canManage('manager', 'cashier')).toBe(true);
        expect(canManage('manager', 'kitchen')).toBe(true);
        expect(canManage('manager', 'accountant')).toBe(true);
        expect(canManage('manager', 'manager')).toBe(false);
        expect(canManage('manager', 'auditor')).toBe(false);
        expect(canManage('manager', 'admin')).toBe(false);
        expect(canManage('manager', 'owner')).toBe(false);
    });

    test('المسؤول العام يدير manager وأدنى، ولا يدير admin آخر ولا owner', () => {
        expect(canManage('admin', 'manager')).toBe(true);
        expect(canManage('admin', 'cashier')).toBe(true);
        expect(canManage('admin', 'auditor')).toBe(true);
        expect(canManage('admin', 'admin')).toBe(false);
        expect(canManage('admin', 'owner')).toBe(false);
    });

    test('المالك يدير الجميع بما فيهم owner آخر', () => {
        expect(canManage('owner', 'owner')).toBe(true);
        expect(canManage('owner', 'admin')).toBe(true);
        expect(canManage('owner', 'cashier')).toBe(true);
    });

    test('دور غير إداري أو مجهول لا يدير أحدًا', () => {
        expect(canManage('cashier', 'employee')).toBe(false);
        expect(canManage('', 'cashier')).toBe(false);
        expect(canManage('owner', 'ghost_role')).toBe(false);
    });
});

describe('evaluateUserMutation — المصفوفة الأمنية', () => {
    test('التعديل: مدير على مالك/مسؤول/ند → 403، وعلى كاشير → مسموح', () => {
        expect(deny(evaluateUserMutation({
            operation: 'update', actorRole: 'manager', actorId: 1, targetId: 9,
            targetRole: 'owner', patch: { name: 'x' },
        })).code).toBe('TARGET_OUT_OF_SCOPE');
        expect(deny(evaluateUserMutation({
            operation: 'update', actorRole: 'manager', actorId: 1, targetId: 9,
            targetRole: 'admin', patch: { password: 'Abcd12345678' },
        })).code).toBe('TARGET_OUT_OF_SCOPE');
        expect(deny(evaluateUserMutation({
            operation: 'update', actorRole: 'manager', actorId: 1, targetId: 9,
            targetRole: 'manager', patch: { name: 'x' },
        })).code).toBe('TARGET_OUT_OF_SCOPE');
        expect(evaluateUserMutation({
            operation: 'update', actorRole: 'manager', actorId: 1, targetId: 9,
            targetRole: 'cashier', patch: { name: 'x' },
        }).ok).toBe(true);
    });

    test('مدير لا يستطيع تغيير كلمة مرور المسؤول العام (الثغرة الأصلية)', () => {
        const out = deny(evaluateUserMutation({
            operation: 'update', actorRole: 'manager', actorId: 7, targetId: 1,
            targetRole: 'owner', patch: { password: 'Anything123456' },
        }));
        expect(out.status).toBe(403);
    });

    test('المسؤول العام لا يستهدف مسؤولًا آخر (منع الاستيلاء الأفقي)', () => {
        expect(deny(evaluateUserMutation({
            operation: 'update', actorRole: 'admin', actorId: 2, targetId: 3,
            targetRole: 'admin', patch: { active: false },
        })).code).toBe('TARGET_OUT_OF_SCOPE');
        expect(evaluateUserMutation({
            operation: 'update', actorRole: 'admin', actorId: 2, targetId: 3,
            targetRole: 'manager', patch: { name: 'x' },
        }).ok).toBe(true);
    });

    test('الذات: لا تغيير دور ولا إيقاف ولا حذف — والاسم وكلمة المرور مسموحان', () => {
        expect(deny(evaluateUserMutation({
            operation: 'update', actorRole: 'admin', actorId: 2, targetId: 2,
            targetRole: 'admin', patch: { role: 'cashier' },
        })).code).toBe('SELF_ROLE_CHANGE_FORBIDDEN');
        expect(deny(evaluateUserMutation({
            operation: 'update', actorRole: 'manager', actorId: 2, targetId: 2,
            targetRole: 'manager', patch: { active: false },
        })).code).toBe('SELF_DEACTIVATE_FORBIDDEN');
        expect(deny(evaluateUserMutation({
            operation: 'delete', actorRole: 'owner', actorId: 2, targetId: 2,
            targetRole: 'owner',
        })).code).toBe('SELF_DELETE_FORBIDDEN');
        expect(evaluateUserMutation({
            operation: 'update', actorRole: 'admin', actorId: 2, targetId: 2,
            targetRole: 'admin', patch: { name: 'اسم جديد', password: 'Abcd12345678' },
        }).ok).toBe(true);
    });

    test('الإنشاء: منح owner/admin للمالك وحده، والمدير يلد أدنى منه فقط', () => {
        expect(deny(evaluateUserMutation({
            operation: 'create', actorRole: 'admin', patch: { role: 'owner' },
        })).code).toBe('OWNER_ASSIGNMENT_FORBIDDEN');
        expect(deny(evaluateUserMutation({
            operation: 'create', actorRole: 'admin', patch: { role: 'admin' },
        })).code).toBe('ROLE_ASSIGNMENT_FORBIDDEN');
        expect(evaluateUserMutation({
            operation: 'create', actorRole: 'owner', patch: { role: 'owner' },
        }).ok).toBe(true);
        expect(evaluateUserMutation({
            operation: 'create', actorRole: 'manager', patch: { role: 'cashier' },
        }).ok).toBe(true);
        expect(deny(evaluateUserMutation({
            operation: 'create', actorRole: 'manager', patch: { role: 'manager' },
        })).code).toBe('ROLE_ASSIGNMENT_FORBIDDEN');
        expect(deny(evaluateUserMutation({
            operation: 'create', actorRole: 'manager', patch: {},
        })).code).toBe('ROLE_REQUIRED');
    });

    test('رمز الاستعادة: لا لحساب مساوٍ أو أعلى أو لنفسك', () => {
        expect(deny(evaluateUserMutation({
            operation: 'reset-code', actorRole: 'manager', actorId: 1, targetId: 9,
            targetRole: 'owner',
        })).code).toBe('RESET_TARGET_OUT_OF_SCOPE');
        expect(deny(evaluateUserMutation({
            operation: 'reset-code', actorRole: 'admin', actorId: 1, targetId: 9,
            targetRole: 'admin',
        })).code).toBe('RESET_TARGET_OUT_OF_SCOPE');
        expect(deny(evaluateUserMutation({
            operation: 'reset-code', actorRole: 'manager', actorId: 5, targetId: 5,
            targetRole: 'cashier',
        })).code).toBe('SELF_RESET_CODE_FORBIDDEN');
        expect(evaluateUserMutation({
            operation: 'reset-code', actorRole: 'admin', actorId: 1, targetId: 9,
            targetRole: 'cashier',
        }).ok).toBe(true);
    });

    test('دور إداري غير معروف لا يمر', () => {
        expect(deny(evaluateUserMutation({
            operation: 'update', actorRole: 'cashier', targetRole: 'cashier', patch: { name: 'x' },
        })).code).toBe('USER_MANAGEMENT_FORBIDDEN');
    });
});

describe('evaluateLastPrivileged — لا إقصاء لآخر حساب رفيع', () => {
    test('آخر owner نشط محمي من التعطيل/التخفيض/الحذف', () => {
        for (const next of [
            { nextRole: 'owner', nextActive: false },
            { nextRole: 'admin', nextActive: true },
            { nextRole: 'cashier', nextActive: true },
        ]) {
            const out = evaluateLastPrivileged({
                targetRole: 'owner', ...next, activeOwners: 1, activeAdmins: 3,
            });
            expect(out && out.code).toBe('LAST_OWNER_FORBIDDEN');
        }
    });

    test('وجود owner آخر يجعل تخفيض owner مسموحًا', () => {
        expect(evaluateLastPrivileged({
            targetRole: 'owner', nextRole: 'admin', nextActive: true,
            activeOwners: 2, activeAdmins: 0,
        })).toBeNull();
    });

    test('آخر admin محمي فقط عند غياب owner نشط', () => {
        expect(evaluateLastPrivileged({
            targetRole: 'admin', nextRole: 'cashier', nextActive: true,
            activeOwners: 0, activeAdmins: 1,
        }).code).toBe('LAST_ADMIN_FORBIDDEN');
        expect(evaluateLastPrivileged({
            targetRole: 'admin', nextRole: 'cashier', nextActive: true,
            activeOwners: 1, activeAdmins: 1,
        })).toBeNull();
    });

    test('الأدوار العادية لا تخضع لحارس آخر حساب', () => {
        expect(evaluateLastPrivileged({
            targetRole: 'manager', nextActive: false, activeOwners: 1, activeAdmins: 1,
        })).toBeNull();
    });
});

describe('ربط المصدر — كل مسار كتابة يمر بالحارس', () => {
    test('server.js: إنشاء/تعديل/حذف الحسابات يستدعي evaluateUserMutation', () => {
        const src = read('backend/server.js');
        expect(src).toMatch(/const authzCreate = userAuthority\.evaluateUserMutation/);
        expect(src).toMatch(/const authzUpdate = userAuthority\.evaluateUserMutation/);
        expect(src).toMatch(/const authzDelete = userAuthority\.evaluateUserMutation/);
        expect(src).toMatch(/evaluateLastPrivileged/);
    });

    test('حذف المستخدم تعطيل ناعم — لا DELETE FROM users', () => {
        const src = read('backend/server.js');
        expect(src).toMatch(/UPDATE users SET active=FALSE WHERE id=\$1/);
        expect(src).not.toMatch(/DELETE FROM "users"/);
        expect(src).toMatch(/USER_DEACTIVATED/);
    });

    test('رمز الاستعادة يمر بالحارس قبل الإصدار', () => {
        const src = read('backend/cashier-module/password-recovery-routes.js');
        expect(src).toMatch(/operation: 'reset-code'/);
        expect(src).toMatch(/PASSWORD_RESET_CODE_DENIED/);
    });

    test('لا كتابة جديدة إلى password_vault من مسارات الحسابات', () => {
        for (const f of ['backend/server.js', 'backend/cashier-module/password-recovery-routes.js',
            'backend/cashier-module/jwt-middleware.js']) {
            expect(read(f)).not.toMatch(/encryptForVault|SET password_vault/i);
        }
    });
});
