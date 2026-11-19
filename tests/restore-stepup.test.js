/**
 * restore-stepup.test.js — تأمين 2026-11 (M1): تذكرة التحقق الإضافي للاستعادة.
 * اختبارات نقية (بلا DB): تشفير التذاكر وأغراضها وعمرها فقط.
 */
const {
    signMfaTicket, verifyMfaTicket, MFA_TICKET_TTL, jwtAuth,
} = require('../backend/cashier-module/jwt-middleware');

const USER = { id: 7, role: 'admin', name: 'مدير', dept_code: null, branch_id: null };

describe('تذكرة restore_stepup — عقد الغرض والعمر', () => {
    test('العمر 5 دقائق ضمن عائلة تذاكر MFA', () => {
        expect(MFA_TICKET_TTL.restore_stepup).toBe('5m');
    });

    test('توقيع ثم تحقق بالغرض الصحيح → هوية + jti فريد', () => {
        const t = signMfaTicket(USER, 'restore_stepup');
        const p = verifyMfaTicket(t, ['restore_stepup']);
        expect(p.sub).toBe('7');
        expect(p.role).toBe('admin');
        expect(p.purpose).toBe('restore_stepup');
        expect(typeof p.jti).toBe('string');
        expect(p.jti.length).toBeGreaterThan(8);
        expect(p.exp - p.iat).toBe(300);
        const t2 = signMfaTicket(USER, 'restore_stepup');
        expect(verifyMfaTicket(t2, ['restore_stepup']).jti).not.toBe(p.jti);
    });

    test('تذكرة الاستعادة لا تُقبل كتذكرة MFA دخول (فصل الأغراض)', () => {
        const t = signMfaTicket(USER, 'restore_stepup');
        expect(() => verifyMfaTicket(t, ['mfa', 'mfa_enroll'])).toThrow('WRONG_TICKET_PURPOSE');
    });

    test('تذكرة MFA العادية لا تُقبل كتحقق استعادة', () => {
        const t = signMfaTicket(USER, 'mfa');
        expect(() => verifyMfaTicket(t, ['restore_stepup'])).toThrow('WRONG_TICKET_PURPOSE');
    });

    test('تذكرة الاستعادة ليست access — jwtAuth يرفضها (توقيع صالح لكن غرض خاطئ)', async () => {
        const t = signMfaTicket(USER, 'restore_stepup');
        const req = { headers: { authorization: `Bearer ${t}` }, path: '/api/system/restore', method: 'POST' };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();
        await jwtAuth(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('غرض غير معروف يرفض التوقيع', () => {
        expect(() => signMfaTicket(USER, 'whatever')).toThrow('INVALID_MFA_PURPOSE');
    });
});
