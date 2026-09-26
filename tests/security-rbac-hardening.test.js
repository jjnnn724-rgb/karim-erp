/**
 * Security RBAC Hardening Tests — تدقيق أمني 2026-09-03
 * ────────────────────────────────────────────────────────────────────────────
 * يغطي إصلاحات التدقيق الأمني الشامل:
 *
 * 1. خريطة أدوار الكتابة للكيانات العامة (OPEN_ENTITY_WRITE_ROLES):
 *    كانت POST/PUT/DELETE على 16 كياناً مفتوحة لأي حساب مُصادق — أُثبت حياً
 *    أن مستخدم مطبخ أنشأ (201) وحذف (200) مصروفًا قبل الإصلاح.
 *
 * 2. بوابة تدوير كلمة المرور (must_change_password) في jwtAuth:
 *    كانت تُحجب فقط في requireRole، وتتسلل عبر مسارات jwtAuth الخام.
 *
 * 3. دورة حياة الجلسة: تدوير رمز التحديث (rotation) + الخروج بإبطال الرموز.
 *
 * Run: npx jest tests/security-rbac-hardening.test.js
 */

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const path = require('path');
const bcrypt = require('bcryptjs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
    OPEN_ENTITY_WRITE_ROLES,
    getEntityWriteRoles,
    entitySchemas,
} = require('../backend/schema-registry');
const {
    jwtAuth, requireRole, refreshHandler, logoutHandler,
    signAccessToken, issueRefreshToken, verifyAccessToken,
} = require('../backend/cashier-module/jwt-middleware');
const { pool } = require('../backend/shared-pool');

// ─── Helpers ─────────────────────────────────────────────────────────────────
function mockRes() {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    return res;
}

function makeReq(overrides = {}) {
    return Object.assign({ headers: {}, path: '/api/expenses', method: 'GET', body: {} }, overrides);
}

const ALL_SYSTEM_ROLES = new Set([
    'admin', 'manager', 'cashier', 'kitchen', 'warehouse',
    'dept_head', 'auditor', 'accountant', 'hr', 'employee',
]);

// ─── 1) خريطة أدوار الكتابة للكيانات العامة ────────────────────────────────
describe('Security Hardening — Generic Entity Write Guards', () => {

    it('يجب أن يكون لكل كيان عام قابل للكتابة قائمة أدوار غير فارغة', () => {
        const openEntities = Object.keys(OPEN_ENTITY_WRITE_ROLES);
        expect(openEntities.length).toBeGreaterThanOrEqual(14);
        for (const entity of openEntities) {
            const roles = getEntityWriteRoles(entity);
            expect(Array.isArray(roles)).toBe(true);
            expect(roles.length).toBeGreaterThan(0);
        }
    });

    it('كل الأدوار في الخريطة أدوار نظامية معروفة', () => {
        for (const roles of Object.values(OPEN_ENTITY_WRITE_ROLES)) {
            for (const role of roles) {
                expect(ALL_SYSTEM_ROLES.has(role)).toBe(true);
            }
        }
    });

    it('الكيانات الإدارية ليست في الخريطة (لها حرس admin/manager مستقل)', () => {
        expect(getEntityWriteRoles('users')).toBeNull();
        expect(getEntityWriteRoles('payroll')).toBeNull();
        expect(getEntityWriteRoles('settings')).toBeNull();
        expect(getEntityWriteRoles('dispatches')).toBeNull();
    });

    it('الإشعارات والحضور خارج الخريطة (مفتوحة مصمّمة بحرس مخصص)', () => {
        // notifications: كل مستخدم يرسل إشعارات
        expect(getEntityWriteRoles('notifications')).toBeNull();
        // attendance: خدمة ذاتية مسورة بالملكية (enforceAttendanceSelfService)
        // وليس بدور — وإلا انكسر تسجيل حضور الموظفين في بوابة الموظف
        expect(getEntityWriteRoles('attendance')).toBeNull();
    });

    it('الكيانات المالية مقفلة على أدوار الحسابات فقط', () => {
        expect(getEntityWriteRoles('expenses')).toEqual(['admin', 'manager', 'accountant']);
        expect(getEntityWriteRoles('revenues')).toEqual(['admin', 'manager', 'accountant']);
        expect(getEntityWriteRoles('purchaseInvoices')).toContain('warehouse');
        expect(getEntityWriteRoles('purchaseInvoices')).not.toContain('kitchen');
    });

    it('الكيانات التشغيلية تسمح بأدوارها التشغيلية فقط', () => {
        expect(getEntityWriteRoles('inventory')).not.toContain('kitchen');
        expect(getEntityWriteRoles('recipes')).toContain('kitchen');
        expect(getEntityWriteRoles('weightReadings')).toContain('kitchen');
        expect(getEntityWriteRoles('kitchenReturns')).toContain('dept_head');
        expect(getEntityWriteRoles('employees')).not.toContain('kitchen');
        expect(getEntityWriteRoles('employees')).not.toContain('warehouse');
    });

    it('كل كيان في الخريطة له مخطط مسجل في سجل المخططات', () => {
        for (const entity of Object.keys(OPEN_ENTITY_WRITE_ROLES)) {
            expect(entitySchemas[entity]).toBeDefined();
        }
    });
});

// ─── 2) بوابة تدوير كلمة المرور في jwtAuth ──────────────────────────────────
describe('Security Hardening — jwtAuth Password Rotation Gate', () => {

    it('حساب must_change_password يُرفض من أي مسار عملي بـ 403', () => {
        const token = signAccessToken({ id: 99901, role: 'cashier', name: 'روتيشن', must_change_password: true });
        const req = makeReq({ headers: { authorization: `Bearer ${token}` }, path: '/api/expenses' });
        const res = mockRes();
        const next = jest.fn();
        jwtAuth(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.body.error).toBe('PASSWORD_CHANGE_REQUIRED');
    });

    it('نفس الحساب يصل لمسار تدوير كلمة المرور فقط', () => {
        const token = signAccessToken({ id: 99901, role: 'cashier', name: 'روتيشن', must_change_password: true });
        for (const allowed of ['/api/auth/change-password', '/api/auth/refresh', '/api/auth/logout']) {
            const req = makeReq({ headers: { authorization: `Bearer ${token}` }, path: allowed, method: 'POST' });
            const res = mockRes();
            const next = jest.fn();
            jwtAuth(req, res, next);
            expect(next).toHaveBeenCalledWith();
            expect(res.statusCode).toBe(200);
        }
    });

    it('حساب سليم يمر بلا عوائق', () => {
        const token = signAccessToken({ id: 1, role: 'admin', name: 'أدمن', must_change_password: false });
        const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
        const res = mockRes();
        const next = jest.fn();
        jwtAuth(req, res, next);
        expect(next).toHaveBeenCalledWith();
        expect(req.user.role).toBe('admin');
    });

    it('توكن تالف يُرفض بـ 401', () => {
        const req = makeReq({ headers: { authorization: 'Bearer not.a.jwt' } });
        const res = mockRes();
        const next = jest.fn();
        jwtAuth(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.body.error).toBe('TOKEN_INVALID');
    });

    it('غياب الترويسة يُرفض بـ 401', () => {
        const req = makeReq({});
        const res = mockRes();
        const next = jest.fn();
        jwtAuth(req, res, next);
        expect(res.statusCode).toBe(401);
        expect(res.body.error).toBe('UNAUTHORIZED');
    });
});

// ─── 3) دورة حياة الجلسة (تدوير + خروج) — قاعدة بيانات حقيقية ───────────────
describe('Security Hardening — Refresh/Logout Lifecycle', () => {
    let tempUserId = null;
    const TEMP_USERNAME = 'sec_audit_tmp_lifecycle';

    beforeAll(async () => {
        const hash = await bcrypt.hash('TmpAudit!2026x', 10);
        // جدول users يستخدم معرّات مولّدة تطبيقياً (بلا DEFAULT) — نفس نمط uid()
        const tempId = Date.now() * 1000 + Math.floor(Math.random() * 999);
        const inserted = await pool.query(
            `INSERT INTO users (id, username, password, role, name, active)
             VALUES ($1, $2, $3, 'cashier', 'مستخدم تدقيق أمني', true)
             RETURNING id`,
            [tempId, TEMP_USERNAME, hash]
        );
        tempUserId = inserted.rows[0].id;
    });

    afterAll(async () => {
        await pool.query('DELETE FROM pos_refresh_tokens WHERE user_id = $1', [tempUserId]);
        await pool.query('DELETE FROM users WHERE id = $1 AND username = $2', [tempUserId, TEMP_USERNAME]);
        await pool.end().catch(() => {});
    });

    it('إصدار رمز تحديث ثم تدويره ينتج زوجاً جديداً ويستهلك القديم', async () => {
        const raw = await issueRefreshToken({ id: tempUserId }, { ip: '127.0.0.1' });
        expect(raw).toHaveLength(96);

        const res = mockRes();
        await refreshHandler(makeReq({ body: { refresh_token: raw } }), res);
        expect(res.statusCode).toBe(200);
        expect(res.body.access_token).toBeTruthy();
        expect(res.body.refresh_token).toBeTruthy();
        expect(res.body.refresh_token).not.toBe(raw);
        expect(res.body.user.id).toBe(tempUserId);
        // التحقق من أن التوكن الجديد يعمل فعلاً
        const payload = verifyAccessToken(res.body.access_token);
        expect(String(payload.sub)).toBe(String(tempUserId));
    });

    it('إعادة استعمال رمز مدوَّر تُرفض بـ 401', async () => {
        const raw = await issueRefreshToken({ id: tempUserId }, { ip: '127.0.0.1' });
        const first = mockRes();
        await refreshHandler(makeReq({ body: { refresh_token: raw } }), first);
        expect(first.statusCode).toBe(200);

        const second = mockRes();
        await refreshHandler(makeReq({ body: { refresh_token: raw } }), second);
        expect(second.statusCode).toBe(401);
        expect(second.body.error).toBe('REFRESH_TOKEN_INVALID');
    });

    it('رمز تحديث مجهول يُرفض بـ 401', async () => {
        const res = mockRes();
        await refreshHandler(makeReq({ body: { refresh_token: 'f'.repeat(96) } }), res);
        expect(res.statusCode).toBe(401);
    });

    it('جسم ناقص يُرفض بـ 400', async () => {
        const res = mockRes();
        await refreshHandler(makeReq({ body: {} }), res);
        expect(res.statusCode).toBe(400);
    });

    it('الخروج يُبطل كل رموز التجديد الخاصة بالمستخدم', async () => {
        // ابدأ من حالة نظيفة (الاختبارات السابقة تترك رموزاً مدوّرة نشطة)
        await pool.query('DELETE FROM pos_refresh_tokens WHERE user_id = $1', [tempUserId]);
        await issueRefreshToken({ id: tempUserId }, { ip: '127.0.0.1' });
        await issueRefreshToken({ id: tempUserId }, { ip: '127.0.0.1' });

        const res = mockRes();
        await logoutHandler(makeReq({ user: { id: tempUserId }, path: '/api/auth/logout' }), res);
        expect(res.statusCode).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.revoked).toBe(2);

        const remaining = await pool.query(
            'SELECT count(*)::int AS n FROM pos_refresh_tokens WHERE user_id = $1', [tempUserId]
        );
        expect(remaining.rows[0].n).toBe(0);
    });
});

// ─── 4) صحة عامة لـ requireRole بعد التعديلات ───────────────────────────────
describe('Security Hardening — requireRole Sanity', () => {
    it('يرفض الدور غير المصرّح به ويمنع حساب التدوير', () => {
        const middleware = requireRole('admin', 'manager');
        const req = makeReq({ user: { id: 2, role: 'kitchen', must_change_password: false } });
        const res = mockRes();
        const next = jest.fn();
        middleware(req, res, next);
        expect(res.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
    });
});
