/**
 * rate-limiter-failclosed.test.js — تأمين 2026-11 (M3): لا fail-open.
 * اختبارات نقية (بلا DB/Redis): مخزن يفشل ⇒ ميزانية محلية صارمة ثم 429/503.
 */
const { createRateLimiter } = require('../backend/rate-limiter');

const mkReqRes = () => {
    const req = { connection: { remoteAddress: '10.0.0.9' }, headers: {}, ip: '10.0.0.9' };
    const res = {
        statusCode: 200,
        set: jest.fn(),
        once: jest.fn(),
        status: jest.fn(function (c) { this.statusCode = c; return this; }),
        json: jest.fn(function (b) { this.body = b; return this; }),
    };
    return { req, res };
};

describe('rate-limiter — fail-closed عند خطأ المخزن', () => {
    test('مولد مفاتيح يرمي ⇒ تدهور لميزانية صارمة: نصف السقف يمر ثم 429 (لا fail-open)', async () => {
        const limiter = createRateLimiter({
            windowMs: 60000, maxRequests: 10,
            keyGenerator: () => { throw new Error('keygen down'); },
        });
        const results = [];
        for (let i = 0; i < 8; i++) {
            const { req, res } = mkReqRes();
            const next = jest.fn();
            await limiter(req, res, next);
            results.push({ passed: next.mock.calls.length > 0, status: res.statusCode });
        }
        // نصف السقف = 5 → أول 5 تمر (عدّاد التدهور 1..5)، السادس وما بعده 429
        expect(results.slice(0, 5).every(r => r.passed)).toBe(true);
        expect(results.slice(5).every(r => !r.passed && r.status === 429)).toBe(true);
    });

    test('الوضع الطبيعي لم يتغير: ضمن السقف يمر وفوقه 429', async () => {
        const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 3 });
        const seen = [];
        for (let i = 0; i < 5; i++) {
            const { req, res } = mkReqRes();
            const next = jest.fn();
            await limiter(req, res, next);
            seen.push(next.mock.calls.length > 0 ? 'pass' : res.statusCode);
        }
        expect(seen).toEqual(['pass', 'pass', 'pass', 429, 429]);
    });
});
