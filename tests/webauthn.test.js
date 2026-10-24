/**
 * webauthn.test.js — مفاتيح المرور (Passkeys) على قاعدة الاختبار المعزولة
 * ────────────────────────────────────────────────────────────────────────────
 * يسلك التدفق الحقيقي: كلمة المرور ⇢ تسجيل جهاز بتوقيع ECDSA حقيقي ⇢ دخول
 * لاحق لا يعطي جلسة قبل توقيع الجهاز ⇢ إعادة استخدام نفس التوقيع تُرفض ⇢
 * حذف الجهاز يعيد الحساب إلى المسار السابق.
 *
 * Run (isolated DB):
 *   NODE_ENV=test DB_NAME=karim_erp_test KARIM_TEST_DB_NAME=karim_erp_test \
 *   KARIM_TEST_DB_ISOLATED=1 npx jest tests/webauthn.test.js --runInBand
 */

process.env.MFA_ENFORCE = '1';
process.env.MFA_REQUIRED_ROLES = 'owner,admin';
process.env.WEBAUTHN_RP_ID = 'localhost';

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const bcrypt = require('../backend/pw-crypto');
const { pool } = require('../backend/shared-pool');
const { loginHandler, verifyMfaTicket } = require('../backend/cashier-module/jwt-middleware');
const webauthnStore = require('../backend/cashier-module/webauthn-store');
const webauthnRoutes = require('../backend/cashier-module/webauthn-routes');
const { createSoftAuthenticator } = require('./webauthn-soft-authenticator');

const PASSWORD = 'PasskeyTest123456';
const ORIGIN = 'http://localhost:5000';
const stamp = Date.now();
const username = `wa_probe_${stamp}`;

let userId = null;
let authenticator = null;

function mockRes() {
    const res = { statusCode: 200, body: null, headers: {} };
    res.status = (code) => {res.statusCode = code; return res;};
    res.json = (payload) => {res.body = payload; return res;};
    res.set = (key, value) => {res.headers[key] = value; return res;};
    return res;
}

function makeReq(overrides = {}) {
    return Object.assign({
        headers: { origin: ORIGIN, 'user-agent': 'jest-soft-authenticator' },
        body: {},
        params: {},
        ip: '127.0.0.1',
        path: '/api/auth/webauthn',
        method: 'POST',
    }, overrides);
}

async function createUser() {
    const hash = await bcrypt.hash(PASSWORD, 12);
    const r = await pool.query(
        `INSERT INTO users (id, username, password, role, name, active, must_change_password)
         VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM users), $1, $2, 'admin', $3, TRUE, FALSE)
         RETURNING id;`,
        [username, hash, 'Passkey Probe']
    );
    return Number(r.rows[0].id);
}

async function login() {
    const res = mockRes();
    await loginHandler(makeReq({ body: { username, password: PASSWORD } }), res);
    return res;
}

describe('WebAuthn — تسجيل جهاز ودخول بتوقيع حقيقي', () => {
    let ticketUser = null;

    beforeAll(async () => {
        await webauthnStore.ensureWebauthnSchema();
        userId = await createUser();
        authenticator = createSoftAuthenticator({ rpId: 'localhost' });
    });

    afterAll(async () => {
        if (userId) {
            await pool.query('DELETE FROM pos_refresh_tokens WHERE user_id = $1;', [userId]).catch(() => {});
            await pool.query('DELETE FROM webauthn_challenges WHERE user_id = $1;', [userId]).catch(() => {});
            await pool.query('DELETE FROM user_webauthn_credentials WHERE user_id = $1;', [userId]).catch(() => {});
            await pool.query('DELETE FROM users WHERE id = $1;', [userId]).catch(() => {});
        }
        await pool.end().catch(() => {});
    });

    it('قبل التسجيل: كلمة المرور وحدها لا تفتح جلسة', async () => {
        const res = await login();
        expect(res.statusCode).toBe(200);
        expect(res.body.mfa_enrollment_required).toBe(true);
        expect(res.body.access_token).toBeUndefined();
    });

    it('تسجيل الخيارات يرفض كلمة مرور خاطئة', async () => {
        const res = mockRes();
        await webauthnRoutes.registerOptionsHandler(
            makeReq({ user: { id: userId }, body: { password: 'wrong-password' } }), res);
        expect(res.statusCode).toBe(401);
        expect(res.body.error).toBe('INVALID_CREDENTIALS');
    });

    it('تسجيل الخيارات يرفض أصلًا غير معروف', async () => {
        const res = mockRes();
        await webauthnRoutes.registerOptionsHandler(
            makeReq({ user: { id: userId }, headers: { origin: 'https://evil.example' }, body: { password: PASSWORD } }), res);
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('WEBAUTHN_ORIGIN');
    });

    it('يبدأ التسجيل بكلمة المرور ويعيد خيارات صحيحة', async () => {
        const res = mockRes();
        await webauthnRoutes.registerOptionsHandler(
            makeReq({ user: { id: userId }, body: { password: PASSWORD, device_label: 'لابتوب الاختبار' } }), res);
        expect(res.statusCode).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.options.rp.id).toBe('localhost');
        expect(typeof res.body.options.challenge).toBe('string');
        expect(res.headers['Cache-Control']).toBe('no-store');
    });

    it('يثبّت المفتاح العام بعد تحقق التوقيع', async () => {
        const optionsRes = mockRes();
        await webauthnRoutes.registerOptionsHandler(
            makeReq({ user: { id: userId }, body: { password: PASSWORD, device_label: 'لابتوب الاختبار' } }), optionsRes);
        const response = authenticator.registration({
            challenge: optionsRes.body.options.challenge,
            origin: ORIGIN,
        });
        const res = mockRes();
        await webauthnRoutes.registerVerifyHandler(
            makeReq({ user: { id: userId }, body: { response, device_label: 'لابتوب الاختبار' } }), res);
        expect(res.statusCode).toBe(200);
        expect(res.body.ok).toBe(true);
        const rows = await webauthnStore.listCredentials(userId);
        expect(rows.length).toBe(1);
        expect(rows[0].device_label).toBe('لابتوب الاختبار');
    });

    it('حالة الأجهزة لا تكشف المفتاح العام ولا معرّف الاعتماد', async () => {
        const res = mockRes();
        await webauthnRoutes.statusHandler(makeReq({ user: { id: userId }, method: 'GET' }), res);
        expect(res.statusCode).toBe(200);
        expect(res.body.enabled).toBe(true);
        expect(res.body.count).toBe(1);
        const row = res.body.credentials[0];
        expect(Object.keys(row).sort()).toEqual(['backed_up', 'created_at', 'id', 'label', 'last_used_at']);
    });

    it('الدخول بعد التسجيل يطلب توقيع الجهاز لا الرمز', async () => {
        const res = await login();
        expect(res.statusCode).toBe(200);
        expect(res.body.webauthn_required).toBe(true);
        expect(res.body.mfa_required).toBeUndefined();
        expect(res.body.access_token).toBeUndefined();
        const ticket = verifyMfaTicket(res.body.mfa_token, ['mfa']);
        expect(Number(ticket.sub)).toBe(userId);
        ticketUser = { id: userId, role: 'admin', name: 'Passkey Probe' };
    });

    it('خيارات الدخول تقتصر على الأجهزة المسجّلة', async () => {
        const res = mockRes();
        await webauthnRoutes.loginOptionsHandler(makeReq({ user: ticketUser }), res);
        expect(res.statusCode).toBe(200);
        const allowed = res.body.options.allowCredentials || [];
        expect(allowed.length).toBe(1);
        expect(allowed[0].id).toBe(authenticator.credentialIdB64);
    });

    it('التوقيع الصحيح يصدر جلسة كاملة', async () => {
        const optionsRes = mockRes();
        await webauthnRoutes.loginOptionsHandler(makeReq({ user: ticketUser }), optionsRes);
        const response = authenticator.assertion({
            challenge: optionsRes.body.options.challenge,
            origin: ORIGIN,
        });
        const res = mockRes();
        await webauthnRoutes.loginVerifyHandler(makeReq({ user: ticketUser, body: { response } }), res);
        expect(res.statusCode).toBe(200);
        expect(typeof res.body.access_token).toBe('string');
        expect(typeof res.body.refresh_token).toBe('string');
        expect(res.body.webauthn).toBe(true);
        const touched = await pool.query(
            'SELECT last_used_at, counter FROM user_webauthn_credentials WHERE user_id = $1;', [userId]);
        expect(touched.rows[0].last_used_at).not.toBeNull();
        expect(Number(touched.rows[0].counter)).toBeGreaterThan(0);
    });

    it('إعادة استخدام نفس التوقيع تُرفض (التحدّي يُستهلك)', async () => {
        const optionsRes = mockRes();
        await webauthnRoutes.loginOptionsHandler(makeReq({ user: ticketUser }), optionsRes);
        const response = authenticator.assertion({
            challenge: optionsRes.body.options.challenge,
            origin: ORIGIN,
        });
        const first = mockRes();
        await webauthnRoutes.loginVerifyHandler(makeReq({ user: ticketUser, body: { response } }), first);
        expect(first.statusCode).toBe(200);
        const replay = mockRes();
        await webauthnRoutes.loginVerifyHandler(makeReq({ user: ticketUser, body: { response } }), replay);
        expect(replay.statusCode).toBe(409);
        expect(replay.body.error).toBe('WEBAUTHN_CHALLENGE');
    });

    it('توقيع مُعدَّل يُرفض ولا يصدر جلسة', async () => {
        const optionsRes = mockRes();
        await webauthnRoutes.loginOptionsHandler(makeReq({ user: ticketUser }), optionsRes);
        const response = authenticator.assertion({
            challenge: optionsRes.body.options.challenge,
            origin: ORIGIN,
        });
        const signature = Buffer.from(response.response.signature, 'base64url');
        signature[signature.length - 1] ^= 0xff;
        response.response.signature = signature.toString('base64url');
        const res = mockRes();
        await webauthnRoutes.loginVerifyHandler(makeReq({ user: ticketUser, body: { response } }), res);
        expect(res.statusCode).toBe(401);
        expect(res.body.access_token).toBeUndefined();
    });

    it('حذف الجهاز يتطلب كلمة المرور ثم يُزيله فعلًا', async () => {
        const rows = await webauthnStore.listCredentials(userId);
        const credentialRowId = Number(rows[0].id);

        const bad = mockRes();
        await webauthnRoutes.removeCredentialHandler(
            makeReq({ user: { id: userId }, params: { id: String(credentialRowId) }, body: { password: 'nope' } }), bad);
        expect(bad.statusCode).toBe(401);

        const ok = mockRes();
        await webauthnRoutes.removeCredentialHandler(
            makeReq({ user: { id: userId }, params: { id: String(credentialRowId) }, body: { password: PASSWORD } }), ok);
        expect(ok.statusCode).toBe(200);
        expect(await webauthnStore.countCredentials(userId)).toBe(0);

        const after = await login();
        expect(after.body.mfa_enrollment_required).toBe(true);
    });

    it('التحدّي يُستهلك مرة واحدة على مستوى المخزن', async () => {
        await webauthnStore.saveChallenge({
            userId, purpose: 'login', challenge: 'probe-challenge', origin: ORIGIN,
        });
        const first = await webauthnStore.takeChallenge({ userId, purpose: 'login', challenge: 'probe-challenge' });
        const second = await webauthnStore.takeChallenge({ userId, purpose: 'login', challenge: 'probe-challenge' });
        expect(first).not.toBeNull();
        expect(second).toBeNull();
    });

    it('resolveOrigin يقبل نطاق الإنتاج ويرفض ما سواه', () => {
        const previous = process.env.WEBAUTHN_RP_ID;
        process.env.WEBAUTHN_RP_ID = 'karimeg.online';
        try {
            const req = (origin) => ({ headers: origin ? { origin } : {} });
            expect(webauthnRoutes.resolveOrigin(req('https://karimeg.online'))).toBe('https://karimeg.online');
            expect(webauthnRoutes.resolveOrigin(req('https://erp.karimeg.online'))).toBe('https://erp.karimeg.online');
            expect(webauthnRoutes.resolveOrigin(req('http://karimeg.online'))).toBeNull();
            expect(webauthnRoutes.resolveOrigin(req('https://karimeg.online.evil.example'))).toBeNull();
            expect(webauthnRoutes.resolveOrigin(req(''))).toBeNull();
        } finally {
            process.env.WEBAUTHN_RP_ID = previous;
        }
    });
});
