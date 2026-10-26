// ────────────────────────────────────────────────────────────────────────────
// password-recovery.test.js — استعادة كلمة المرور الذاتية للموظف
// ────────────────────────────────────────────────────────────────────────────
// يغطي: المنطق النقي (توليد الرمز وتجزئته والحكم على صف الرمز)، مخططات zod،
// بوابات الدور (admin/manager فقط يُصدر الرمز)، ودورة الحياة الكاملة على
// قاعدة بيانات حقيقية بمستخدم اختبار موسوم وتنظيف ذاتي كامل:
//   إصدار الرمز → رمز خاطئ (زيادة المحاولات) → الرمز الصحيح (تغيير فعلي +
//   سحب جلسات التجديد + استهلاك الرمز) → منع إعادة الاستخدام → الرمز
//   المنتهي → قفل الرمز بعد 5 محاولات → بطلان الرمز بإصدار جديد.
// ────────────────────────────────────────────────────────────────────────────
const path = require('path');
const bcrypt = require('bcryptjs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
    RESET_CODE_TTL_MS,
    MAX_VERIFY_ATTEMPTS,
    generateResetCode,
    hashCode,
    requestCodeSchema,
    resetRequestSchema,
    evaluateCodeRow,
} = require('../backend/cashier-module/password-recovery-logic');
const { requestCodeHandler, resetHandler } = require('../backend/cashier-module/password-recovery-routes');
const { requireRole } = require('../backend/cashier-module/jwt-middleware');
const { pool } = require('../backend/cashier-module/db-pool');

const MARK = 'PWRT-TEST';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function mockRes() {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    return res;
}

function makeReq(overrides = {}) {
    return Object.assign(
        { headers: {}, method: 'POST', body: {}, ip: '127.0.0.1', id: 'test-req-id' },
        overrides
    );
}

let adminUserId = null;

async function createTestUser() {
    // بقايا تشغيل سابق فاشل؟ أزلها أولًا حتى تبقى الدورة قابلة لإعادة التشغيل
    await pool.query(`DELETE FROM pos_password_reset_codes WHERE user_id IN (SELECT id FROM users WHERE username = '${MARK}-user');`);
    await pool.query(`DELETE FROM pos_refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE username = '${MARK}-user');`);
    await pool.query(`DELETE FROM users WHERE username = '${MARK}-user';`);
    const hash = await bcrypt.hash('OriginalPass123', 12);
    const r = await pool.query(
        `INSERT INTO users (id, username, password, role, name, active)
         VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM users), $1, $2, 'cashier', $3, true) RETURNING id;`,
        [MARK + '-user', hash, 'موظف اختبار الاستعادة']
    );
    return r.rows[0].id;
}

async function getAdminUser() {
    if (adminUserId) {return adminUserId;}
    const hash = await bcrypt.hash('AdminPass123', 12);
    // ON CONFLICT يقاوم بقايا تشغيل سابق فشل قبل afterAll — يعيد id الموجود
    const r = await pool.query(
        `INSERT INTO users (id, username, password, role, name, active)
         VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM users), $1, $2, 'admin', $3, true)
         ON CONFLICT (username) DO UPDATE SET name = EXCLUDED.name
         RETURNING id;`,
        [MARK + '-admin', hash, 'Admin Test']
    );
    adminUserId = r.rows[0].id;
    return adminUserId;
}

async function insertCodeRow(userId, { code = '123456', expired = false, used = false, attempts = 0 } = {}) {
    const r = await pool.query(
        `INSERT INTO pos_password_reset_codes (user_id, code_hash, expires_at, attempts, used_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id;`,
        [
            userId,
            hashCode(code),
            new Date(Date.now() + (expired ? -1000 : RESET_CODE_TTL_MS)),
            attempts,
            used ? new Date() : null,
        ]
    );
    return r.rows[0].id;
}

afterAll(async () => {
    // تنظيف ذاتي — صفر بقايا داخل مساحة MARK-%:
    // حذف مستخدم له أثر تدقيق ممنوع (pos_audit_logs append-only بـ ON DELETE CASCADE)،
    // لذلك عند المنع نُقاعد الحساب (إعادة تسمية خارج نطاق MARK + تعطيل) بدل الفشل.
    await pool.query(`DELETE FROM pos_password_reset_codes WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${MARK}-%');`);
    await pool.query(`DELETE FROM pos_refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${MARK}-%');`);
    try {
        await pool.query(`DELETE FROM users WHERE username LIKE '${MARK}-%';`);
    } catch (e) {
        if (/append-only|pos_audit_logs/i.test(e.message || '')) {
            await pool.query(
                `UPDATE users SET username = username || '-retired-' || id, active = false, name = name || ' [retired]' WHERE username LIKE '${MARK}-%';`
            ).catch(() => {});
        } else {
            throw e;
        }
    }
    await pool.end().catch(() => {});
});

// ─── 1) المنطق النقي ────────────────────────────────────────────────────────
describe('generateResetCode — رمز من 6 أرقام بأصفار بادئة', () => {
    test('الصيغة: 6 خانات رقمية دائمًا', () => {
        for (let i = 0; i < 60; i++) {
            const code = generateResetCode();
            expect(code).toMatch(/^\d{6}$/);
        }
    });
    test('التنوع: لا يتكرر الرمز في 60 توليدة (احتمال التكرار النظري ضئيل جدًا)', () => {
        const codes = new Set(Array.from({ length: 60 }, generateResetCode));
        expect(codes.size).toBeGreaterThan(50);
    });
});

describe('hashCode — تجزئة SHA-256 سداسية عشرية', () => {
    test('64 خانة سداسية عشرية ومتكررة الحتمية', () => {
        const h1 = hashCode('123456');
        expect(h1).toMatch(/^[a-f0-9]{64}$/);
        expect(hashCode('123456')).toBe(h1);
        expect(hashCode('654321')).not.toBe(h1);
    });
    test('الرمز الخام لا يظهر في التجزئة', () => {
        expect(hashCode('123456')).not.toContain('123456');
    });
});

describe('evaluateCodeRow — حكم صف الرمز', () => {
    const baseRow = (over = {}) => ({
        id: 1, code_hash: hashCode('123456'),
        expires_at: new Date(Date.now() + RESET_CODE_TTL_MS),
        attempts: 0, used_at: null, ...over,
    });
    test('رمز صحيح غير مستخدم غير منتهي → ok', () => {
        expect(evaluateCodeRow(baseRow(), '123456')).toEqual({ ok: true });
    });
    test('لا صف → NO_ACTIVE_CODE', () => {
        expect(evaluateCodeRow(null, '123456').reason).toBe('NO_ACTIVE_CODE');
    });
    test('مستخدم مسبقًا → CODE_USED (حتى لو صح الرمز)', () => {
        expect(evaluateCodeRow(baseRow({ used_at: new Date() }), '123456').reason).toBe('CODE_USED');
    });
    test('منتهي → CODE_EXPIRED', () => {
        expect(evaluateCodeRow(baseRow({ expires_at: new Date(Date.now() - 1000) }), '123456').reason).toBe('CODE_EXPIRED');
    });
    test('قفل بعد MAX_VERIFY_ATTEMPTS محاولة (يُقيَّم قبل المطابقة)', () => {
        expect(evaluateCodeRow(baseRow({ attempts: MAX_VERIFY_ATTEMPTS }), '123456').reason).toBe('CODE_LOCKED');
    });
    test('رمز خاطئ → CODE_MISMATCH', () => {
        expect(evaluateCodeRow(baseRow(), '000000').reason).toBe('CODE_MISMATCH');
        expect(evaluateCodeRow(baseRow(), '123457').reason).toBe('CODE_MISMATCH');
    });
    test('المحاولة الحدية: MAX-1 محاولة سابقة مع رمز صحيح → ما زال ok', () => {
        expect(evaluateCodeRow(baseRow({ attempts: MAX_VERIFY_ATTEMPTS - 1 }), '123456')).toEqual({ ok: true });
    });
});

describe('مخططات zod', () => {
    test('طلب الإصدار: اسم مستخدم صالح، ويرفض القصير جدًا/الفارغ/الطويل', () => {
        expect(requestCodeSchema.safeParse({ username: 'chef' }).success).toBe(true);
        expect(requestCodeSchema.safeParse({ username: 'x' }).success).toBe(false);
        expect(requestCodeSchema.safeParse({}).success).toBe(false);
        expect(requestCodeSchema.safeParse({ username: 'x'.repeat(51) }).success).toBe(false);
    });
    test('طلب الاستعادة: يقبل الصالح ويرفض الرمز غير الرقمي/القصير والكلمة الضعيفة', () => {
        const good = { username: 'chef', code: '123456', new_password: 'NewStrong1234' };
        expect(resetRequestSchema.safeParse(good).success).toBe(true);
        expect(resetRequestSchema.safeParse({ ...good, code: '12345' }).success).toBe(false);
        expect(resetRequestSchema.safeParse({ ...good, code: 'abcdef' }).success).toBe(false);
        expect(resetRequestSchema.safeParse({ ...good, new_password: 'weak123' }).success).toBe(false);
        expect(resetRequestSchema.safeParse({ ...good, new_password: 'passwordonlyy' }).success).toBe(false); // بلا أرقام
        expect(resetRequestSchema.safeParse({ ...good, new_password: '123456789012' }).success).toBe(false);    // بلا حروف
    });
});

// ─── 2) بوابة الدور على إصدار الرمز ─────────────────────────────────────────
describe('بوابة الدور — إصدار الرمز لـ admin/manager فقط', () => {
    test('requireRole يرفض chef/keeper/غير الموجود بـ 403 ويمرر admin', () => {
        for (const role of ['kitchen', 'warehouse', 'dept_head']) {
            const res = mockRes();
            const next = jest.fn();
            requireRole('admin', 'manager')(makeReq({ user: { id: 9, role } }), res, next);
            expect(res.statusCode).toBe(403);
            expect(next).not.toHaveBeenCalled();
        }
        const resOk = mockRes();
        const nextOk = jest.fn();
        requireRole('admin', 'manager')(makeReq({ user: { id: 1, role: 'admin' } }), resOk, nextOk);
        expect(nextOk).toHaveBeenCalled();
    });
});

// ─── 3) دورة الحياة الكاملة على قاعدة حقيقية ────────────────────────────────
describe('request-code + reset — دورة الحياة على قاعدة البيانات الحقيقية', () => {
    let userId;

    beforeAll(async () => {
        userId = await createTestUser();
    });

    test('إصدار رمز: 200 + رمز 6 خانات + يُخزَّن مجزأً + يبطل الرموز السابقة', async () => {
        await insertCodeRow(userId, { code: '999999' }); // رمز سابق قائم
        const adminId = await getAdminUser();
        const res = mockRes();
        await requestCodeHandler(
            makeReq({ body: { username: MARK + '-user' }, user: { id: adminId, role: 'admin', name: 'admin' } }),
            res
        );
        expect(res.statusCode).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.code).toMatch(/^\d{6}$/);
        const rows = await pool.query(
            `SELECT * FROM pos_password_reset_codes WHERE user_id = $1 ORDER BY id DESC;`,
            [userId]
        );
        expect(rows.rows).toHaveLength(1); // القديم حُذف
        expect(rows.rows[0].code_hash).toBe(hashCode(res.body.code)); // مخزن مجزأً لا خامًا
    });

    test('إصدار لحساب غير موجود/موقوف → 404 بدون رمز', async () => {
        const adminId = await getAdminUser();
        const res = mockRes();
        await requestCodeHandler(
            makeReq({ body: { username: MARK + '-ghost' }, user: { id: adminId, role: 'admin', name: 'admin' } }),
            res
        );
        expect(res.statusCode).toBe(404);
        const res2 = mockRes();
        await pool.query(`UPDATE users SET active = false WHERE id = $1;`, [userId]);
        await requestCodeHandler(
            makeReq({ body: { username: MARK + '-user' }, user: { id: adminId, role: 'admin', name: 'admin' } }),
            res2
        );
        expect(res2.statusCode).toBe(404);
        await pool.query(`UPDATE users SET active = true WHERE id = $1;`, [userId]);
    });

    test('رمز خاطئ → 401 موحد + زيادة عداد المحاولات', async () => {
        const codeId = await insertCodeRow(userId, { code: '555555' });
        const res = mockRes();
        await resetHandler(makeReq({ body: { username: MARK + '-user', code: '111111', new_password: 'BrandNewPass123' } }), res);
        expect(res.statusCode).toBe(401);
        expect(res.body.error).toBe('RESET_FAILED');
        const row = await pool.query(`SELECT attempts FROM pos_password_reset_codes WHERE id = $1;`, [codeId]);
        expect(Number(row.rows[0].attempts)).toBe(1);
    });

    test('الرمز الصحيح → 200 + كلمة مرور جديدة فعليًا + استهلاك الرمز + سحب الجلسات', async () => {
        await insertCodeRow(userId, { code: '424242' });
        // جلسة تجديد قائمة يجب سحبها عند نجاح الاستعادة
        await pool.query(
            `INSERT INTO pos_refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days');`,
            [userId, hashCode('victim-refresh-token')]
        );
        const res = mockRes();
        await resetHandler(makeReq({ body: { username: MARK + '-user', code: '424242', new_password: 'BrandNewPass123' } }), res);
        expect(res.statusCode).toBe(200);
        expect(res.body.ok).toBe(true);

        const user = await pool.query(`SELECT password, must_change_password FROM users WHERE id = $1;`, [userId]);
        expect(await bcrypt.compare('BrandNewPass123', user.rows[0].password)).toBe(true);
        expect(await bcrypt.compare('OriginalPass123', user.rows[0].password)).toBe(false);
        expect(user.rows[0].must_change_password).toBe(false);

        const codeRow = await pool.query(
            `SELECT used_at FROM pos_password_reset_codes WHERE user_id = $1 ORDER BY id DESC LIMIT 1;`,
            [userId]
        );
        expect(codeRow.rows[0].used_at).not.toBeNull();

        const tokens = await pool.query(`SELECT COUNT(*)::int AS c FROM pos_refresh_tokens WHERE user_id = $1;`, [userId]);
        expect(tokens.rows[0].c).toBe(0); // كل الجلسات سُحبت
    });

    test('إعادة استخدام الرمز المستهلك → 401', async () => {
        const res = mockRes();
        await resetHandler(makeReq({ body: { username: MARK + '-user', code: '424242', new_password: 'AnotherPass1234' } }), res);
        expect(res.statusCode).toBe(401);
    });

    test('الرمز المنتهي → 401 (ولو الرمز صحيح)', async () => {
        await insertCodeRow(userId, { code: '777777', expired: true });
        const res = mockRes();
        await resetHandler(makeReq({ body: { username: MARK + '-user', code: '777777', new_password: 'AnotherPass1234' } }), res);
        expect(res.statusCode).toBe(401);
    });

    test('حساب غير موجود → نفس الرد الموحد (لا كشف لوجود الحساب)', async () => {
        const resKnown = mockRes();
        await resetHandler(makeReq({ body: { username: MARK + '-user', code: '000000', new_password: 'AnotherPass1234' } }), resKnown);
        const resGhost = mockRes();
        await resetHandler(makeReq({ body: { username: MARK + '-ghost', code: '000000', new_password: 'AnotherPass1234' } }), resGhost);
        expect(resKnown.statusCode).toBe(401);
        expect(resGhost.statusCode).toBe(401);
        expect(resGhost.body).toEqual(resKnown.body);
    });

    test('قفل الرمز: 5 محاولات خاطئة → 429 حتى لو جاء الرمز الصحيح لاحقًا', async () => {
        await insertCodeRow(userId, { code: '888888' });
        let lastRes;
        for (let i = 0; i < MAX_VERIFY_ATTEMPTS; i++) {
            lastRes = mockRes();
            await resetHandler(makeReq({ body: { username: MARK + '-user', code: '00000' + i, new_password: 'TryAgainPass123' } }), lastRes);
            if (i < MAX_VERIFY_ATTEMPTS - 1) {expect(lastRes.statusCode).toBe(401);}
        }
        expect(lastRes.statusCode).toBe(429);
        // حتى الرمز الصحيح مرفوض بعد القفل
        const resCorrect = mockRes();
        await resetHandler(makeReq({ body: { username: MARK + '-user', code: '888888', new_password: 'TryAgainPass123' } }), resCorrect);
        expect(resCorrect.statusCode).toBe(429);
    });

    test('الاستعادة لا تعمل بكلمة مرور ضعيفة (422) ولا باسم مستخدم فاسد (422)', async () => {
        const resWeak = mockRes();
        await resetHandler(makeReq({ body: { username: MARK + '-user', code: '123456', new_password: 'short1' } }), resWeak);
        expect(resWeak.statusCode).toBe(422);
        const resBadCode = mockRes();
        await resetHandler(makeReq({ body: { username: MARK + '-user', code: '12a456', new_password: 'ValidPass12345' } }), resBadCode);
        expect(resBadCode.statusCode).toBe(422);
    });
});
