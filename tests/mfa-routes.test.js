/**
 * mfa-routes.test.js — المصادقة الثنائية على قاعدة الاختبار المعزولة
 * ────────────────────────────────────────────────────────────────────────────
 * يسلك التدفق الحقيقي كاملًا: دخول بكلمة المرور ⇢ تذكرة تسجيل ⇢ QR ⇢ تأكيد ⇢
 * جلسة ⇢ دخول ثانٍ يطلب الرمز ⇢ تحقق ⇢ رمز استرداد ⇢ إسقاط بمدير.
 * كما يثبت أن تذكرة MFA لا تفتح أي مسار محمي، وأن تدوير كلمة المرور الأولية
 * لا يمنح جلسة قبل العامل الثاني.
 *
 * Run (isolated DB):
 *   NODE_ENV=test DB_NAME=karim_erp_test KARIM_TEST_DB_NAME=karim_erp_test \
 *   KARIM_TEST_DB_ISOLATED=1 npx jest tests/mfa-routes.test.js --runInBand
 */

process.env.MFA_ENFORCE = '1';
process.env.MFA_REQUIRED_ROLES = 'owner,admin';

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const bcrypt = require('../backend/pw-crypto');
const totp = require('../backend/totp');
const { pool } = require('../backend/shared-pool');
const {
    jwtAuth, loginHandler, changePasswordHandler,
    verifyMfaTicket, verifyAccessToken, signMfaTicket,
} = require('../backend/cashier-module/jwt-middleware');
const mfaRoutes = require('../backend/cashier-module/mfa-routes');

const PASSWORD = 'MfaTestPass12345';
const NEW_PASSWORD = 'MfaTestPass67890';
const stamp = Date.now();
const adminUsername = `mfa_probe_admin_${stamp}`;
const rotatingUsername = `mfa_probe_rot_${stamp}`;

let adminId = null;
let rotatingId = null;

function mockRes() {
    const res = { statusCode: 200, body: null, headers: {} };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    res.set = (key, value) => { res.headers[key] = value; return res; };
    return res;
}

function makeReq(overrides = {}) {
    return Object.assign({ headers: {}, body: {}, ip: '127.0.0.1', path: '/api/auth/login', method: 'POST' }, overrides);
}

function userFromTicket(ticket) {
    return {
        id: parseInt(ticket.sub, 10),
        role: ticket.role,
        name: ticket.name,
        dept_code: ticket.dept_code || null,
        branch_id: ticket.branch_id ?? null,
        must_change_password: false,
    };
}

async function createUser(username, { mustChange = false, role = 'admin' } = {}) {
    const hash = await bcrypt.hash(PASSWORD, 12);
    // users.id بلا DEFAULT في هذا المخطط — التطبيق نفسه يولّده من MAX(id)+1.
    const r = await pool.query(
        `INSERT INTO users (id, username, password, role, name, active, must_change_password)
         VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM users), $1, $2, $3, $4, TRUE, $5) RETURNING id;`,
        [username, hash, role, 'MFA Probe', mustChange]
    );
    return Number(r.rows[0].id);
}

async function loginTicket(username) {
    const res = mockRes();
    await loginHandler(makeReq({ body: { username, password: PASSWORD } }), res);
    return res;
}

async function lastUsedStep(userId) {
    const r = await pool.query('SELECT last_used_step FROM user_mfa WHERE user_id = $1;', [userId]);
    return Number(r.rows[0].last_used_step);
}

describe('MFA — تدفق التسجيل والدخول الكامل', () => {
    let enrollTicket = null;
    let enrollTokenRaw = null;
    let secret = null;
    let recoveryCodes = null;

    beforeAll(async () => {
        adminId = await createUser(adminUsername);
        rotatingId = await createUser(rotatingUsername, { mustChange: true });
    });

    afterAll(async () => {
        for (const id of [adminId, rotatingId].filter(Boolean)) {
            await pool.query('DELETE FROM pos_refresh_tokens WHERE user_id = $1;', [id]).catch(() => {});
            await pool.query('DELETE FROM user_mfa WHERE user_id = $1;', [id]).catch(() => {});
            await pool.query('DELETE FROM users WHERE id = $1;', [id]).catch(() => {});
        }
        await pool.end().catch(() => {});
    });

    it('الدخول بكلمة المرور وحدها يعيد تذكرة تسجيل لا جلسة', async () => {
        const res = await loginTicket(adminUsername);
        expect(res.statusCode).toBe(200);
        expect(res.body.mfa_enrollment_required).toBe(true);
        expect(res.body.access_token).toBeUndefined();
        expect(res.body.refresh_token).toBeUndefined();
        expect(typeof res.body.mfa_token).toBe('string');
        enrollTokenRaw = res.body.mfa_token;
        enrollTicket = verifyMfaTicket(enrollTokenRaw, ['mfa_enroll']);
        expect(enrollTicket.purpose).toBe('mfa_enroll');
        expect(Number(enrollTicket.sub)).toBe(adminId);
    });

    it('تذكرة التسجيل لا تفتح أي مسار محمي عبر jwtAuth', () => {
        expect(enrollTokenRaw).toBeTruthy();
        const res = mockRes();
        let passed = false;
        jwtAuth(
            makeReq({ headers: { authorization: `Bearer ${enrollTokenRaw}` }, path: '/api/pos/departments', method: 'GET' }),
            res,
            () => { passed = true; }
        );
        expect(passed).toBe(false);
        expect(res.statusCode).toBe(401);
        expect(res.body.error).toBe('TOKEN_INVALID');
    });

    it('setup يعيد سرًّا ورمز QR', async () => {
        const res = mockRes();
        await mfaRoutes.setupHandler(
            makeReq({ user: userFromTicket(enrollTicket), mfaTicket: enrollTicket, body: {} }),
            res
        );
        expect(res.statusCode).toBe(200);
        expect(res.body.secret).toMatch(/^[A-Z2-7]+$/);
        expect(res.body.otpauth_uri).toContain('otpauth://totp/');
        expect(res.body.qr_data_url).toMatch(/^data:image\/png;base64,/);
        secret = res.body.secret;
    });

    it('confirm يرفض صيغة غير رقمية (422) قبل لمس الحالة', async () => {
        const res = mockRes();
        await mfaRoutes.confirmHandler(
            makeReq({ user: userFromTicket(enrollTicket), mfaTicket: enrollTicket, body: { code: 'abcdef' } }),
            res
        );
        expect(res.statusCode).toBe(422);
    });

    it('confirm بالرمز الصحيح يفعّل MFA ويعيد جلسة و8 رموز استرداد', async () => {
        const res = mockRes();
        const code = totp.totp(secret, { at: Date.now() });
        await mfaRoutes.confirmHandler(
            makeReq({ user: userFromTicket(enrollTicket), mfaTicket: enrollTicket, body: { code } }),
            res
        );
        expect(res.statusCode).toBe(200);
        expect(typeof res.body.access_token).toBe('string');
        expect(typeof res.body.refresh_token).toBe('string');
        expect(res.body.recovery_codes).toHaveLength(8);
        expect(verifyAccessToken(res.body.access_token).purpose).toBe('access');
        expect(res.body.mfa_enabled).toBe(true);
        recoveryCodes = res.body.recovery_codes;
    });

    it('الدخول التالي يطلب الرمز الثاني (mfa) لا التسجيل', async () => {
        const res = await loginTicket(adminUsername);
        expect(res.body.mfa_required).toBe(true);
        expect(res.body.mfa_enrollment_required).toBeUndefined();
        expect(res.body.access_token).toBeUndefined();
        expect(verifyMfaTicket(res.body.mfa_token, ['mfa']).purpose).toBe('mfa');
    });

    it('verify يرفض إعادة استعمال الخطوة المستهلكة (409)', async () => {
        const login = await loginTicket(adminUsername);
        const ticket = verifyMfaTicket(login.body.mfa_token, ['mfa']);
        const usedStep = await lastUsedStep(adminId);
        const replay = mockRes();
        await mfaRoutes.verifyHandler(
            makeReq({
                user: userFromTicket(ticket),
                mfaTicket: ticket,
                body: { code: totp.totp(secret, { at: usedStep * 30_000 }) },
            }),
            replay
        );
        expect(replay.statusCode).toBe(409);
        expect(replay.body.error).toBe('MFA_CODE_REUSED');
    });

    it('verify بالرمز التالي ينجح ويصدر جلسة', async () => {
        const login = await loginTicket(adminUsername);
        const ticket = verifyMfaTicket(login.body.mfa_token, ['mfa']);
        const usedStep = await lastUsedStep(adminId);
        const fresh = mockRes();
        await mfaRoutes.verifyHandler(
            makeReq({
                user: userFromTicket(ticket),
                mfaTicket: ticket,
                body: { code: totp.totp(secret, { at: (usedStep + 1) * 30_000 }) },
            }),
            fresh
        );
        expect(fresh.statusCode).toBe(200);
        expect(typeof fresh.body.access_token).toBe('string');
        expect(fresh.body.mfa_enabled).toBe(true);
    });

    it('رمز الاسترداد يعمل مرة واحدة فقط', async () => {
        const login = await loginTicket(adminUsername);
        const ticket = verifyMfaTicket(login.body.mfa_token, ['mfa']);
        const reqUser = userFromTicket(ticket);

        const first = mockRes();
        await mfaRoutes.verifyHandler(
            makeReq({ user: reqUser, mfaTicket: ticket, body: { recovery_code: recoveryCodes[0] } }),
            first
        );
        expect(first.statusCode).toBe(200);
        expect(typeof first.body.access_token).toBe('string');

        const reuse = mockRes();
        await mfaRoutes.verifyHandler(
            makeReq({ user: reqUser, mfaTicket: ticket, body: { recovery_code: recoveryCodes[0] } }),
            reuse
        );
        expect(reuse.statusCode).toBe(401);
        expect(reuse.body.error).toBe('INVALID_RECOVERY_CODE');
    });

    it('الحالة تكشف التفعيل وما تبقى من رموز استرداد', async () => {
        const res = mockRes();
        await mfaRoutes.statusHandler(makeReq({ user: userFromTicket(enrollTicket), method: 'GET' }), res);
        expect(res.body.enabled).toBe(true);
        expect(res.body.required).toBe(true);
        expect(res.body.recovery_codes_left).toBe(7);
    });

    it('التعطيل الذاتي ممنوع للدور الإلزامي', async () => {
        const res = mockRes();
        await mfaRoutes.disableHandler(
            makeReq({ user: userFromTicket(enrollTicket), body: { password: PASSWORD, code: '123456' } }),
            res
        );
        expect(res.statusCode).toBe(409);
        expect(res.body.error).toBe('MFA_REQUIRED_FOR_ROLE');
    });

    it('مدير غير مالك لا يستطيع مسح تسجيل حساب إداري آخر', async () => {
        const res = mockRes();
        await mfaRoutes.adminResetHandler(
            makeReq({ user: { id: 1, role: 'admin', name: 'Admin' }, body: { username: adminUsername } }),
            res
        );
        expect(res.statusCode).toBe(403);
    });

    it('المالك يمسح التسجيل فتعود الحالة غير مفعّلة', async () => {
        const res = mockRes();
        await mfaRoutes.adminResetHandler(
            makeReq({ user: { id: 1, role: 'owner', name: 'Owner' }, body: { username: adminUsername } }),
            res
        );
        expect(res.statusCode).toBe(200);

        const status = mockRes();
        await mfaRoutes.statusHandler(makeReq({ user: { id: adminId, role: 'admin', name: 'MFA Probe' }, method: 'GET' }), status);
        expect(status.body.enabled).toBe(false);
    });

    it('تدوير كلمة المرور الأولية لا يمنح جلسة قبل العامل الثاني', async () => {
        const login = await loginTicket(rotatingUsername);
        expect(login.body.password_change_required).toBe(true);
        const restrictedToken = login.body.access_token;
        expect(typeof restrictedToken).toBe('string');

        const changed = mockRes();
        await changePasswordHandler(
            makeReq({
                user: { id: rotatingId, role: 'admin', name: 'MFA Probe' },
                body: { current_password: PASSWORD, new_password: NEW_PASSWORD },
            }),
            changed
        );
        expect(changed.statusCode).toBe(200);
        expect(changed.body.access_token).toBeUndefined();
        expect(changed.body.mfa_enrollment_required).toBe(true);
        expect(typeof changed.body.mfa_token).toBe('string');
        expect(verifyMfaTicket(changed.body.mfa_token, ['mfa_enroll']).purpose).toBe('mfa_enroll');
    });
});

describe('signMfaTicket — غرض التذكرة وحدها', () => {
    it('ترفض الغرض غير المعروف', () => {
        expect(() => signMfaTicket({ id: 1, role: 'admin', name: 'x' }, 'session')).toThrow('INVALID_MFA_PURPOSE');
    });
});
