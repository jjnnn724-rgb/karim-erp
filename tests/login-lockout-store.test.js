/**
 * login-lockout-store.test.js — قفل الدخول الدائم (R18++ / ترحيل 153)
 * ════════════════════════════════════════════════════════════════════════════
 * على karim_erp_test المعزولة:
 *   1) 5 فشلات → قفل 15د، والنجاح يصفّر.
 *   2) الدوام عبر «إعادة تشغيل»: نسخة وحدة جديدة (ذاكرة فارغة) تقرأ نفس القفل من القاعدة.
 *   3) انتهاء النافذة/القفل يفكّ القفل ويمسح الصف.
 *   4) التراجع الآمن: قاعدة معطلة ⇒ نفس دلالات R18 في الذاكرة (لا يسقط الدخول).
 * مفاتيح zz-lock-* تُنظف في afterAll.
 */
'use strict';

const path = require('path');
const { pool } = require('../backend/shared-pool');

jest.setTimeout(30000);
const STORE_PATH = path.join(__dirname, '..', 'backend', 'cashier-module', 'login-lockout-store.js');
const KEY = 'zz-lock-' + Math.random().toString(36).slice(2, 10);

function freshStore() {
    // نسخة وحدة جديدة = ذاكرة فارغة (محاكاة إعادة تشغيل) مع بقاء الـpool.
    delete require.cache[require.resolve(STORE_PATH)];
    return require(STORE_PATH);
}

afterAll(async () => {
    await pool.query("DELETE FROM login_lockouts WHERE key LIKE 'zz-lock-%'").catch(() => {});
    await pool.end().catch(() => {});
});

describe('قفل الدخول الدائم — قاعدة حقيقية', () => {
    test('خمس فشلات تقفل، والرابعة لا تقفل، والنجاح يصفّر', async () => {
        const store = freshStore();
        expect((await store.state(KEY)).locked).toBe(false);
        for (let i = 0; i < 4; i++) { await store.fail(KEY); }
        expect((await store.state(KEY)).locked).toBe(false);
        await store.fail(KEY);
        const s = await store.state(KEY);
        expect(s.locked).toBe(true);
        expect(s.retryAfter).toBeGreaterThan(800);
        expect(s.retryAfter).toBeLessThanOrEqual(900);
        await store.clear(KEY);
        expect((await store.state(KEY)).locked).toBe(false);
        const r = await pool.query('SELECT 1 FROM login_lockouts WHERE key=$1', [KEY]);
        expect(r.rowCount).toBe(0);
    });

    test('القفل يعيش عبر إعادة التشغيل (نسخة وحدة جديدة تقرأ من القاعدة)', async () => {
        const store = freshStore();
        for (let i = 0; i < 5; i++) { await store.fail(KEY); }
        expect((await store.state(KEY)).locked).toBe(true);
        const restarted = freshStore(); // ذاكرة فارغة — الدليل من القاعدة وحدها
        const s = await restarted.state(KEY);
        expect(s.locked).toBe(true);
        expect(s.retryAfter).toBeGreaterThan(800);
        await restarted.clear(KEY);
    });

    test('انتهاء القفل يفكّه ويمسح الصف', async () => {
        const store = freshStore();
        for (let i = 0; i < 5; i++) { await store.fail(KEY); }
        await pool.query(
            "UPDATE login_lockouts SET lock_until = now() - interval '1 minute', first_at = now() - interval '20 minutes' WHERE key=$1",
            [KEY]);
        expect((await store.state(KEY)).locked).toBe(false);
        const r = await pool.query('SELECT 1 FROM login_lockouts WHERE key=$1', [KEY]);
        expect(r.rowCount).toBe(0);
    });
});

describe('التراجع الآمن إلى الذاكرة (قاعدة معطلة)', () => {
    test('نفس دلالات R18 بلا قاعدة — لا رمي أخطاء نحو الدخول', async () => {
        jest.resetModules();
        jest.doMock('../backend/shared-pool', () => ({
            pool: { query: jest.fn(async () => { throw new Error('db down'); }), connect: jest.fn(async () => { throw new Error('db down'); }), end: jest.fn() },
        }));
        const store = require(STORE_PATH);
        const K = KEY + '-mem';
        expect((await store.state(K)).locked).toBe(false);
        for (let i = 0; i < 5; i++) { await store.fail(K); }
        const s = await store.state(K);
        expect(s.locked).toBe(true);
        expect(s.retryAfter).toBeGreaterThan(800);
        await store.clear(K);
        expect((await store.state(K)).locked).toBe(false);
        jest.dontMock('../backend/shared-pool');
        jest.resetModules();
    });
});
