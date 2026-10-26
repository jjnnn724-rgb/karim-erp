/**
 * session-hardening.test.js — البند ١٠: عمر وصول قصير + هوية جلسة + تدوير
 * ────────────────────────────────────────────────────────────────────────────
 * يثبت ما يقرره الخادم وحده، على قاعدة الاختبار المعزولة:
 *   • الافتراضي 15 دقيقة، و`expires_in` يطابق العمر الحقيقي للرمز.
 *   • `sid` يُكتب في رمز الوصول ويطابق صف التجديد — هوية الجلسة لا تتغيّر
 *     بالتدوير، وبدونها «إبطال جهاز» ينفّذ إبطال «كل الأجهزة».
 *   • التدوير يبقي issued_at، ويُبطل القديم ويربطه بالبديل.
 *   • التدوير المتزامن داخل المهلة يُصدر توكنًا شقيقًا (لا طرد ظلمًا).
 *   • إعادة الاستعمال خارج المهلة تُبطل عائلة الجلسة كلها.
 *   • شاشة الجلسات: العرض والإبطال محصوران في صاحب الجلسة.
 *
 * Run (isolated DB):
 *   NODE_ENV=test DB_NAME=karim_erp_test KARIM_TEST_DB_NAME=karim_erp_test \
 *   KARIM_TEST_DB_ISOLATED=1 npx jest tests/session-hardening.test.js --runInBand
 */

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const bcrypt = require('../backend/pw-crypto');
const { pool } = require('../backend/shared-pool');
const jwt = require('jsonwebtoken');
const {
    jwtAuth, loginHandler, refreshHandler,
    signAccessToken, issueRefreshToken, verifyAccessToken,
    ACCESS_TTL, ACCESS_TTL_SECONDS, REFRESH_GRACE_SECONDS,
} = require('../backend/cashier-module/jwt-middleware');
const sessionRoutes = require('../backend/cashier-module/session-routes');

const PASSWORD = 'SessionPass123456';
const stamp = Date.now();

function makeRes() {
    const res = { statusCode: 200, body: null, headers: {} };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    res.set = (key, value) => { res.headers[key] = value; return res; };
    return res;
}

function makeReq(overrides = {}) {
    return Object.assign({
        headers: {}, body: {}, ip: '127.0.0.1', path: '/api/auth/refresh', method: 'POST', params: {}, id: 'test-req',
    }, overrides);
}

/** users.id بلا DEFAULT في هذا المخطط — التطبيق نفسه يولّده من MAX(id)+1. */
async function createUser(username, role = 'manager') {
    const hash = await bcrypt.hash(PASSWORD, 12);
    const r = await pool.query(
        `INSERT INTO users (id, username, password, role, name, active, must_change_password)
         VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM users), $1, $2, $3, $4, TRUE, FALSE) RETURNING id;`,
        [username, hash, role, 'Session Probe']
    );
    return Number(r.rows[0].id);
}

async function login(username) {
    const res = makeRes();
    await loginHandler(makeReq({ path: '/api/auth/login', body: { username, password: PASSWORD } }), res);
    return res;
}

async function tokenRow(id) {
    const r = await pool.query(
        `SELECT id, user_id, session_id, issued_at, expires_at, revoked_at, replaced_by
           FROM pos_refresh_tokens WHERE id = $1;`, [id]
    );
    return r.rows[0];
}

async function rowIdForRaw(raw) {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const r = await pool.query('SELECT id FROM pos_refresh_tokens WHERE token_hash = $1;', [hash]);
    return r.rows[0] && r.rows[0].id;
}

async function liveCount(userId, sessionId) {
    const r = await pool.query(
        `SELECT COUNT(*)::int AS n FROM pos_refresh_tokens
          WHERE user_id = $1 AND session_id = $2 AND revoked_at IS NULL;`, [userId, sessionId]
    );
    return r.rows[0].n;
}

describe('تقوية الجلسات — العمر والهوية', () => {
    let userId = null;
    let sid = null;
    let rt = null;
    const username = `sess_probe_ttl_${stamp}`;

    beforeAll(async () => {
        userId = await createUser(username);
        const res = await login(username);
        expect(res.statusCode).toBe(200);
        rt = res.body.refresh_token;
        sid = verifyAccessToken(res.body.access_token).sid;
    });

    afterAll(async () => {
        await pool.query('DELETE FROM pos_refresh_tokens WHERE user_id = $1;', [userId]).catch(() => {});
        await pool.query('DELETE FROM users WHERE id = $1;', [userId]).catch(() => {});
    });

    it('الافتراضي 15 دقيقة، والرمز يحمل هذا العمر فعليًا', () => {
        if (!process.env.ACCESS_TOKEN_TTL) {expect(ACCESS_TTL).toBe('15m');}
        if (!process.env.ACCESS_TOKEN_TTL) {expect(ACCESS_TTL_SECONDS).toBe(900);}
        expect(ACCESS_TTL_SECONDS).toBeGreaterThanOrEqual(30);
        if (!process.env.REFRESH_GRACE_SECONDS) {expect(REFRESH_GRACE_SECONDS).toBe(45);}
        const token = signAccessToken({ id: 1, role: 'manager', name: 'x' });
        const claims = jwt.decode(token);
        expect(claims.exp - claims.iat).toBe(ACCESS_TTL_SECONDS);
    });

    it('الدخول يُصدر sid ثابتًا ويعلن expires_in', async () => {
        expect(typeof sid).toBe('string');
        expect(sid).toMatch(/^[0-9a-f-]{36}$/i);
        const res = await login(username);
        expect(res.body.expires_in).toBe(ACCESS_TTL_SECONDS);
        expect(verifyAccessToken(res.body.access_token).sid).toBe(
            (await tokenRow(await rowIdForRaw(res.body.refresh_token))).session_id
        );
        expect(rt).toBeTruthy();
    });
});

describe('تقوية الجلسات — التدوير والمهلة', () => {
    let userId = null;
    let sid = null;
    let rt1 = null;
    let oldRowId = null;
    const username = `sess_probe_rot_${stamp}`;

    beforeAll(async () => {
        userId = await createUser(username);
        const res = await login(username);
        rt1 = res.body.refresh_token;
        sid = verifyAccessToken(res.body.access_token).sid;
        oldRowId = await rowIdForRaw(rt1);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM pos_refresh_tokens WHERE user_id = $1;', [userId]).catch(() => {});
        await pool.query('DELETE FROM users WHERE id = $1;', [userId]).catch(() => {});
    });

    it('التدوير يحفظ الهوية وتاريخ البداية ويبطل القديم ويربطه بالبديل', async () => {
        const before = await tokenRow(oldRowId);
        const res = makeRes();
        await refreshHandler(makeReq({ body: { refresh_token: rt1 } }), res);

        expect(res.statusCode).toBe(200);
        expect(res.body.refresh_token).not.toBe(rt1);
        expect(res.body.session_id).toBe(sid);
        expect(res.body.expires_in).toBe(ACCESS_TTL_SECONDS);
        expect(verifyAccessToken(res.body.access_token).sid).toBe(sid);

        const after = await tokenRow(oldRowId);
        expect(after.revoked_at).not.toBeNull();
        expect(after.replaced_by).toBe(await rowIdForRaw(res.body.refresh_token));

        const next = await tokenRow(after.replaced_by);
        expect(next.session_id).toBe(sid);
        expect(new Date(next.issued_at).getTime()).toBe(new Date(before.issued_at).getTime());
    });

    it('تبويبان يجدّدان معًا: داخل المهلة يُصدر شقيقًا ولا يُبطل الجلسة', async () => {
        const res = makeRes();
        await refreshHandler(makeReq({ body: { refresh_token: rt1 } }), res);

        expect(res.statusCode).toBe(200);
        expect(res.body.session_id).toBe(sid);
        expect(verifyAccessToken(res.body.access_token).sid).toBe(sid);
        // الرمز الأصلي مُبطَل منذ الدوران الأول — والجلسة ما زالت حيّة.
        expect(await liveCount(userId, sid)).toBeGreaterThan(0);
    });

    it('إعادة الاستعمال خارج المهلة تُبطل عائلة الجلسة كلها', async () => {
        // نُقدّم وقت الإبطال ساعتين: خارج المهلة، الحالة الوحيدة الممكنة = سرقة.
        await pool.query(
            `UPDATE pos_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP - INTERVAL '2 hours' WHERE id = $1;`,
            [oldRowId]
        );
        const res = makeRes();
        await refreshHandler(makeReq({ body: { refresh_token: rt1 } }), res);

        expect(res.statusCode).toBe(401);
        expect(res.body.error).toBe('REFRESH_TOKEN_REUSED');
        expect(await liveCount(userId, sid)).toBe(0);
    });

    it('الرمز المنتهي يُحذف ويُرفض صراحةً', async () => {
        const fresh = await issueRefreshToken({ id: userId }, { deviceInfo: { ua: 'probe' }, ip: '127.0.0.1' });
        const rowId = await rowIdForRaw(fresh.raw);
        await pool.query(
            // chk_pos_token_expiry يفرض expires_at > issued_at — نُقدّم الاثنين معًا.
            `UPDATE pos_refresh_tokens
                SET issued_at = CURRENT_TIMESTAMP - INTERVAL '2 days',
                    expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'
              WHERE id = $1;`,
            [rowId]
        );
        const res = makeRes();
        await refreshHandler(makeReq({ body: { refresh_token: fresh.raw } }), res);
        expect(res.statusCode).toBe(401);
        expect(res.body.error).toBe('REFRESH_TOKEN_EXPIRED');
        expect(await tokenRow(rowId)).toBeUndefined();
    });
});

describe('تقوية الجلسات — شاشة الجلسات على الخادم', () => {
    let userA = null;
    let userB = null;
    let sessionA1 = null;
    let sessionA2 = null;
    let sessionB = null;
    const userAName = `sess_probe_a_${stamp}`;
    const userBName = `sess_probe_b_${stamp}`;

    const reqAs = (userId, sid, extra = {}) => makeReq(Object.assign({
        user: { id: userId, sid, role: 'manager', username: 'probe' },
    }, extra));

    beforeAll(async () => {
        userA = await createUser(userAName);
        userB = await createUser(userBName);
        sessionA1 = (await issueRefreshToken({ id: userA }, { deviceInfo: { ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0' }, ip: '10.0.0.1' })).sessionId;
        sessionA2 = (await issueRefreshToken({ id: userA }, { deviceInfo: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }, ip: '10.0.0.2' })).sessionId;
        sessionB = (await issueRefreshToken({ id: userB }, { deviceInfo: { ua: 'Mozilla/5.0 (X11; Linux) Firefox/130.0' }, ip: '10.0.0.3' })).sessionId;
    });

    afterAll(async () => {
        for (const id of [userA, userB].filter(Boolean)) {
            await pool.query('DELETE FROM pos_refresh_tokens WHERE user_id = $1;', [id]).catch(() => {});
            await pool.query('DELETE FROM pos_audit_logs WHERE actor_user_id = $1;', [id]).catch(() => {});
            await pool.query('DELETE FROM users WHERE id = $1;', [id]).catch(() => {});
        }
    });

    it('العرض يقتصر على جلسات صاحب الرمز ويعلّم الحالية', async () => {
        const res = makeRes();
        await sessionRoutes.listHandler(reqAs(userA, sessionA1), res);

        expect(res.statusCode).toBe(200);
        expect(res.body.current_session_id).toBe(sessionA1);
        expect(res.body.sessions).toHaveLength(2);
        expect(res.body.sessions.filter((s) => s.current).map((s) => s.id)).toEqual([sessionA1]);
        expect(res.body.sessions.map((s) => s.id).sort()).toEqual([sessionA1, sessionA2].sort());
        expect(res.body.sessions.find((s) => s.id === sessionA2).device).toContain('Safari');
        // لا شيء من الأسرار يعود إلى الواجهة
        for (const s of res.body.sessions) {
            expect(s.token_hash).toBeUndefined();
            expect(s.refresh_token).toBeUndefined();
            expect(s.user_id).toBeUndefined();
        }
    });

    it('لا يجوز إبطال جلسة مستخدم آخر — ولو عرف معرّفها', async () => {
        const res = makeRes();
        await sessionRoutes.revokeOneHandler(reqAs(userA, sessionA1, { params: { id: sessionB } }), res);
        expect(res.statusCode).toBe(404);
        const stillLive = await pool.query(
            `SELECT revoked_at FROM pos_refresh_tokens WHERE user_id = $1 AND session_id = $2;`, [userB, sessionB]
        );
        expect(stillLive.rows.every((r) => r.revoked_at === null)).toBe(true);
    });

    it('معرّف غير UUID يُرفض قبل لمس القاعدة', async () => {
        const res = makeRes();
        await sessionRoutes.revokeOneHandler(reqAs(userA, sessionA1, { params: { id: 'not-a-uuid' } }), res);
        expect(res.statusCode).toBe(422);
        expect(res.body.error).toBe('SESSION_ID_INVALID');
    });

    it('إبطال جهاز واحد لا يمسّ الجلسة الحالية', async () => {
        const res = makeRes();
        await sessionRoutes.revokeOneHandler(reqAs(userA, sessionA1, { params: { id: sessionA2 } }), res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ ok: true, revoked: 1, current: false });
        expect(await liveCount(userA, sessionA1)).toBe(1);
        expect(await liveCount(userA, sessionA2)).toBe(0);
    });

    it('«إبطال الجلسات الأخرى» يُبقي الحالية ويحترم جلسات الآخرين', async () => {
        // جلسة ثالثة لـ A حتى يكون هناك ما يُبطَل غير الحالية.
        const extra = (await issueRefreshToken({ id: userA }, { deviceInfo: { ua: 'Mozilla/5.0 (iPad) Safari/604.1' }, ip: '10.0.0.4' })).sessionId;
        const res = makeRes();
        await sessionRoutes.revokeOthersHandler(reqAs(userA, sessionA1), res);

        expect(res.statusCode).toBe(200);
        expect(res.body.revoked).toBeGreaterThanOrEqual(1);
        expect(await liveCount(userA, sessionA1)).toBe(1);
        expect(await liveCount(userA, extra)).toBe(0);
        expect(await liveCount(userB, sessionB)).toBe(1);
    });

    it('jwtAuth يمرر sid إلى req.user (وإلا فشل تمييز الجلسة الحالية)', (done) => {
        const token = signAccessToken({ id: userA, role: 'manager', name: 'Probe', session_id: sessionA1 });
        const req = makeReq({ headers: { authorization: `Bearer ${token}` }, path: '/api/auth/sessions', method: 'GET' });
        jwtAuth(req, makeRes(), () => {
            try {
                expect(req.user.sid).toBe(sessionA1);
                done();
            } catch (err) {done(err);}
        });
    });
});

afterAll(async () => {
    await pool.end().catch(() => {});
});
