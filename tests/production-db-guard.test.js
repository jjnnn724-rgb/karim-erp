/**
 * production-db-guard.test.js — حارس منع الاختبارات من لمس قاعدة الإنتاج
 * ────────────────────────────────────────────────────────────────────────────
 * الدافع (2026-10-26): تسرّبت حسابات الاختبار PWRT-TEST إلى قاعدة الإنتاج
 * (karim_erp) — تسعة صفوف قديمة (٣٠ سبتمبر) وحساب كاشير نشط (٢٤ أكتوبر) بكلمة
 * مرور معلنة في المستودع. الجذور:
 *   1) أي عملية تعمل بـ NODE_ENV=test كانت تستطيع فتح اتصال بـ karim_erp.
 *   2) مسار استعادة كلمة المرور كان يقبل أي اسم مستخدم — حتى حسابات الاختبار.
 * الاختباران أدناه يُقفلان المسارين: الأول عند مستوى الاتصال، والثاني عند
 * مستوى المسار (قبل أي وصول لقاعدة البيانات).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const POOL_SRC = fs.readFileSync(path.join(ROOT, 'backend', 'shared-pool.js'), 'utf8');
const ROUTES_SRC = fs.readFileSync(path.join(ROOT, 'backend', 'cashier-module', 'password-recovery-routes.js'), 'utf8');

function mockRes() {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    return res;
}

function bodyOf(src, fromMarker, toMarker) {
    const from = src.indexOf(fromMarker);
    const to = src.indexOf(toMarker, from + fromMarker.length);
    return src.slice(from, to === -1 ? src.length : to);
}

describe('حارس الاتصال: NODE_ENV=test لا يفتح إلا karim_erp_test', () => {
    test('shared-pool يحرس اسم القاعدة قبل بناء الـpool', () => {
        expect(POOL_SRC).toContain('karim_erp_test');
        expect(POOL_SRC).toMatch(/NODE_ENV\s*===\s*'test'/);
        expect(POOL_SRC).toContain('database: resolveDbName()');
    });

    test('سلوكيًا: NODE_ENV=test مع DB_NAME=karim_erp تفشل عند تحميل الوحدة', () => {
        const r = spawnSync(process.execPath, ['-e', "require('./backend/shared-pool');"], {
            cwd: ROOT,
            env: { ...process.env, NODE_ENV: 'test', DB_NAME: 'karim_erp', KARIM_TEST_DB_NAME: 'karim_erp' },
            encoding: 'utf8',
            timeout: 60000,
        });
        expect(r.status).not.toBe(0);
        expect(`${r.stdout}${r.stderr}`).toContain('karim_erp_test');
    });

    test('سلوكيًا: NODE_ENV=test مع DB_NAME=karim_erp_test يمرّ', () => {
        const r = spawnSync(process.execPath, [
            '-e',
            "require('./backend/shared-pool').pool.query('SELECT 1').then(()=>require('./backend/shared-pool').pool.end()).catch(e=>{console.error(e.message);process.exit(1);});",
        ], {
            cwd: ROOT,
            env: { ...process.env, NODE_ENV: 'test', DB_NAME: 'karim_erp_test', KARIM_TEST_DB_NAME: 'karim_erp_test' },
            encoding: 'utf8',
            timeout: 60000,
        });
        expect(r.status).toBe(0);
    });
});

describe('مسار الاستعادة: حسابات الاختبار غير مستهدَفة في الإنتاج', () => {
    const { pool } = require('../backend/cashier-module/db-pool');
    const { isTestAccount, refusesTestAccount } = require('../backend/cashier-module/password-recovery-logic');
    const { requestCodeHandler, resetHandler } = require('../backend/cashier-module/password-recovery-routes');

    test('isTestAccount يميّز بادئة الاختبار فقط', () => {
        expect(isTestAccount('PWRT-TEST-user')).toBe(true);
        expect(isTestAccount('pwrt-test-admin')).toBe(true);
        expect(isTestAccount('emp-059')).toBe(false);
        expect(isTestAccount('admin')).toBe(false);
        expect(isTestAccount('')).toBe(false);
        expect(isTestAccount(null)).toBe(false);
    });

    test('الرفض في الإنتاج فقط — داخل قاعدة الاختبار المعزولة تُترك المادة كما هي', () => {
        expect(refusesTestAccount('PWRT-TEST-user', 'karim_erp')).toBe(true);
        expect(refusesTestAccount('PWRT-TEST-user', 'karim_erp_test')).toBe(false);
        expect(refusesTestAccount('emp-059', 'karim_erp')).toBe(false);
    });

    test('الرفض يسبق أي وصول لقاعدة البيانات في المسارين', () => {
        const issue = bodyOf(ROUTES_SRC, 'async function requestCodeHandler', 'async function resetHandler');
        const reset = bodyOf(ROUTES_SRC, 'async function resetHandler', "router.post('/reset'");
        expect(issue.indexOf('refusesTestAccount(')).toBeGreaterThan(-1);
        expect(issue.indexOf('refusesTestAccount(')).toBeLessThan(issue.indexOf('pool.connect()'));
        expect(reset.indexOf('refusesTestAccount(')).toBeGreaterThan(-1);
        expect(reset.indexOf('refusesTestAccount(')).toBeLessThan(reset.indexOf('pool.connect()'));
    });

    test('في سياق الإنتاج: 404 بلا فتح أي اتصال بقاعدة البيانات', async () => {
        const before = pool.totalCount;
        const res = mockRes();
        await requestCodeHandler({
            body: { username: 'PWRT-TEST-user' },
            user: { id: 1, role: 'admin', name: 'admin' },
            ip: '127.0.0.1',
            id: 'guard-req-1',
        }, res, { dbName: 'karim_erp' });
        expect(res.statusCode).toBe(404);
        expect(res.body.error).toBe('USER_NOT_FOUND');
        expect(pool.totalCount).toBe(before); // لا اتصال: الرفض قبل القاعدة
    });

    test('في سياق الإنتاج: استعادة حساب اختبار → 401 موحّد بلا اتصال', async () => {
        const before = pool.totalCount;
        const res = mockRes();
        await resetHandler({
            body: { username: 'PWRT-TEST-user', code: '123456', new_password: 'StrongPass12345' },
            ip: '127.0.0.1',
            id: 'guard-req-2',
        }, res, { dbName: 'karim_erp' });
        expect(res.statusCode).toBe(401);
        expect(res.body.error).toBe('RESET_FAILED');
        expect(pool.totalCount).toBe(before);
    });

    test('داخل القاعدة المعزولة: الطلب يمرّ إلى القاعدة (لا يرفضه الحارس)', async () => {
        const before = pool.totalCount;
        const res = mockRes();
        await requestCodeHandler({
            body: { username: 'PWRT-TEST-user' },
            user: { id: 1, role: 'admin', name: 'admin' },
            ip: '127.0.0.1',
            id: 'guard-req-3',
        }, res, { dbName: 'karim_erp_test' });
        expect(pool.totalCount).toBeGreaterThan(before); // القاعدة استُعلمت فعلًا
    });
});
