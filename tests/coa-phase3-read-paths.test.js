/**
 * coa-phase3-read-paths.test.js — مسارات القراءة من account_mapping (143)
 * ══════════════════════════════════════════════════════════════════════════════
 * ثلاثة مسارات كانت تقرأ الحسابات كثوابت، والآن تقرؤها من الخريطة:
 *   GET /cash-flow      (accounting-periods.js)
 *   GET /cfo-summary    (accounting-routes.js)
 *   /bank-statements و /bank-rec و /bank-rec/auto-match (accounting-growth.js)
 *
 * الإثبات:
 *   1) بأرقام حيّة على karim_erp_test: كل رقم يطابق رصيد الحساب المربوط فعلًا.
 *   2) تغيير صف الخريطة يغيّر مخرجات المسار (فالقراءة من الجدول لا من ثابت).
 *   3) الحساب الصريح في الطلب يغلب الخريطة (لا تغيير سلوك).
 *   4) 143_down يزيل الصفوف الستة، والمسارات ترجع للافتراضي 1000/1010.
 *
 * كل بيانات الاختبار موسومة zz_ وتُحذف في afterAll. لا إنتاج ولا Oracle/YaraSoft.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { pool } = require('../backend/shared-pool');
const { router: accountingRouter, postJournal } = require('../backend/accounting-routes');
const { router: periodsRouter } = require('../backend/accounting-periods');
const { router: growthRouter } = require('../backend/accounting-growth');
const { SOURCE_TYPE: YARA_REVENUE_SOURCE } = require('../backend/yarasoft/gl-bridge');

jest.mock('../backend/cashier-module/jwt-middleware', () => ({
    jwtAuth: (req, _res, next) => { req.user = { id: 1, role: 'accountant' }; next(); },
    requireRole: () => (_req, _res, next) => next(),
}));

jest.setTimeout(60000);

const UP = fs.readFileSync(
    path.join(__dirname, '..', 'database/migrations/143_coa_mapping_read_paths.sql'), 'utf8');
const DOWN = fs.readFileSync(
    path.join(__dirname, '..', 'database/migrations/143_coa_mapping_read_paths_down.sql'), 'utf8');

const TAG = 'zz_readpath_test';
const SEED_SOURCE = TAG;
const FROM = '2019-03-01';
const TO = '2019-03-31';

const sql = async (text, params) => (await pool.query(text, params)).rows;
const jget = async (p) => {
    const r = await fetch(baseUrl + p);
    return { status: r.status, body: await r.json() };
};
const jpost = async (p, body) => {
    const r = await fetch(baseUrl + p, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    return { status: r.status, body: await r.json() };
};

let server;
let baseUrl;

async function dbNet(account, from, to) {
    const params = from && to ? [account, from, to] : [account];
    const dateFilter = from && to ? 'AND e.date BETWEEN $2::date AND $3::date' : '';
    const r = await sql(
        `SELECT (COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0))::numeric(14,2) AS b
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
          WHERE l.account_code = $1 AND e.status = 'posted' ${dateFilter}`, params);
    return Number(r[0].b);
}

async function cleanup() {
    // teardown موسوم عبر بوابة 136 المرخّصة — نمط journal-void: معاملة + SET LOCAL
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL coa.allow_hard_delete = 'on'");
        await client.query("SET LOCAL coa.allow_mapping_change = 'on'");
        await client.query(
            `DELETE FROM journal_entries
             WHERE source_id LIKE 'zz-%' AND source_type IN ($1,$2)`,
            [SEED_SOURCE, YARA_REVENUE_SOURCE]);
        await client.query(`DELETE FROM account_mapping WHERE module = 'reports'`);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
    await sql(`DELETE FROM bank_statements WHERE description LIKE $1`, [`${TAG}%`]);
}

async function setMapping(operation, role, accountCode) {
    await sql(
        `UPDATE account_mapping SET account_code = $3, updated_at = now()
          WHERE module = 'reports' AND operation = $1 AND role = $2`,
        [operation, role, accountCode]);
}

beforeAll(async () => {
    await cleanup();
    await pool.query(UP); // الهجرة مكتوبة بـBEGIN/COMMIT — تطبيق حقيقي على قاعدة الاختبار

    const seed = async (date, sourceType, sourceId, lines) => {
        const out = await postJournal(pool, {
            date, memo: 'ZZ read-path seed', source_type: sourceType, source_id: sourceId, lines,
        });
        if (out.replay) {throw new Error('seed replay غير متوقع: ' + sourceId);}
    };
    await seed('2019-02-28', SEED_SOURCE, 'zz-open-2019-02', [
        { account_code: '1000', debit: 30, credit: 0, memo: 'ZZ رصيد افتتاحي' },
        { account_code: '4000', debit: 0, credit: 30, memo: 'ZZ افتتاحي' },
    ]);
    await seed('2019-03-05', SEED_SOURCE, 'zz-cash-sale', [
        { account_code: '1000', debit: 100, credit: 0, memo: 'ZZ بيع نقدي' },
        { account_code: '4000', debit: 0, credit: 100, memo: 'ZZ إيراد' },
    ]);
    await seed('2019-03-06', SEED_SOURCE, 'zz-bank-sale', [
        { account_code: '1010', debit: 50, credit: 0, memo: 'ZZ بيع بنكي' },
        { account_code: '4000', debit: 0, credit: 50, memo: 'ZZ إيراد' },
    ]);
    await seed('2019-03-07', SEED_SOURCE, 'zz-cash-expense', [
        { account_code: '5000', debit: 20, credit: 0, memo: 'ZZ مصروف' },
        { account_code: '1000', debit: 0, credit: 20, memo: 'ZZ دفع نقدي' },
    ]);
    await seed('2019-03-08', YARA_REVENUE_SOURCE, 'zz-readpath-yara', [
        { account_code: '1000', debit: 70, credit: 0, memo: 'ZZ جسر' },
        { account_code: '4000', debit: 0, credit: 70, memo: 'ZZ إيراد جسر' },
    ]);

    const app = express();
    app.use(express.json());
    app.use('/api/accounting', accountingRouter);
    app.use('/api/accounting', periodsRouter);
    app.use('/api/accounting', growthRouter);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/accounting`;
});

afterAll(async () => {
    await cleanup();
    await new Promise((resolve) => server.close(resolve));
    await pool.end().catch(() => {});
});

describe('هجرة 143 — البذر', () => {
    test('ستة أدوار reports.* بأرقام الثوابت القديمة نفسها', async () => {
        const rows = await sql(
            `SELECT operation, role, account_code, active FROM account_mapping
              WHERE module = 'reports' ORDER BY operation, role`);
        expect(rows).toEqual([
            { operation: 'bank_reconciliation', role: 'bank_account', account_code: '1010', active: true },
            { operation: 'cash_flow', role: 'bank_account', account_code: '1010', active: true },
            { operation: 'cash_flow', role: 'cash_account', account_code: '1000', active: true },
            { operation: 'cfo_summary', role: 'bank_account', account_code: '1010', active: true },
            { operation: 'cfo_summary', role: 'cash_account', account_code: '1000', active: true },
            { operation: 'cfo_summary', role: 'revenue_account', account_code: '4000', active: true },
        ]);
    });
});

describe('GET /cash-flow', () => {
    test('الافتتاحي والحركة والإقفال تطابق أرصدة 1000/1010 المرحّلة', async () => {
        const { status, body } = await jget(`/cash-flow?from=${FROM}&to=${TO}`);
        expect(status).toBe(200);
        expect(body.opening).toBe(30);
        expect(body.inflow).toBe(220);
        expect(body.outflow).toBe(20);
        expect(body.net).toBe(200);
        expect(body.closing).toBe(230);
        expect(body.opening_available).toBe(true);
    });

    test('تغيير خريطة cash_flow إلى 1150 يفرّغ التدفق (قراءة من الجدول لا ثابت)', async () => {
        await setMapping('cash_flow', 'cash_account', '1150');
        await setMapping('cash_flow', 'bank_account', '1150');
        const { body } = await jget(`/cash-flow?from=${FROM}&to=${TO}`);
        const net1150 = await dbNet('1150');
        expect(body.opening).toBe(net1150);
        expect(body.inflow).toBe(0);
        expect(body.outflow).toBe(0);
        await setMapping('cash_flow', 'cash_account', '1000');
        await setMapping('cash_flow', 'bank_account', '1010');
    });
});

describe('GET /cfo-summary', () => {
    test('نقدية/بنك = رصيد الحسابين المربوطين، وإيراد الجسر المرحّل = 70', async () => {
        const { status, body } = await jget(`/cfo-summary?from=${FROM}&to=${TO}`);
        expect(status).toBe(200);
        expect(body.cash_ledger.petty_cash).toBe(await dbNet('1000'));
        expect(body.cash_ledger.bank).toBe(await dbNet('1010'));
        expect(body.reconciliation.ledger_revenue).toBe(70);
        expect(body.reconciliation.ledger_entries).toBe(1);
    });

    test('خريطة cfo_summary تحكم النقدية والبنك والإيراد المرحّل معًا', async () => {
        await setMapping('cfo_summary', 'cash_account', '1150');
        await setMapping('cfo_summary', 'bank_account', '1150');
        await setMapping('cfo_summary', 'revenue_account', '4030');
        const { body } = await jget(`/cfo-summary?from=${FROM}&to=${TO}`);
        const net1150 = await dbNet('1150');
        expect(body.cash_ledger.petty_cash).toBe(net1150);
        expect(body.cash_ledger.bank).toBe(net1150);
        // لا يوجد قيد جسر مرحّل على 4030 في مارس 2019 → الصفر
        expect(body.reconciliation.ledger_revenue).toBe(0);
        expect(body.reconciliation.ledger_entries).toBe(0);

        await setMapping('cfo_summary', 'cash_account', '1000');
        await setMapping('cfo_summary', 'bank_account', '1010');
        await setMapping('cfo_summary', 'revenue_account', '4000');
    });
});

describe('التسوية البنكية', () => {
    test('GET /bank-rec الافتراضي من الخريطة: دفتر 1010 = 50 قبل رفع الكشف', async () => {
        const { status, body } = await jget(`/bank-rec?from=${FROM}&to=${TO}`);
        expect(status).toBe(200);
        expect(body.account).toBe('1010');
        expect(body.book).toBe(await dbNet('1010', FROM, TO));
        expect(body.book).toBe(50);
        expect(body.statement).toBe(0);
        expect(body.unmatched).toEqual([]);
    });

    test('POST /bank-statements بلا account يستخدم 1010 من الخريطة', async () => {
        const { status, body } = await jpost('/bank-statements', {
            stmt_date: '2019-03-06', amount: 50, description: `${TAG} كشف`,
        });
        expect(status).toBe(201);
        expect(body.inserted).toBe(1);
        const rows = await sql(
            `SELECT account_code, amount::float AS amount FROM bank_statements WHERE description = $1`,
            [`${TAG} كشف`]);
        expect(rows).toEqual([{ account_code: '1010', amount: 50 }]);
        const listed = await jget('/bank-statements');
        expect(listed.body.statements).toHaveLength(1);
        expect(listed.body.statements[0].account_code).toBe('1010');
    });

    test('GET /bank-rec بعد الكشف: فرق صفر وسطر غير مطابق', async () => {
        const { body } = await jget(`/bank-rec?from=${FROM}&to=${TO}`);
        expect(body.statement).toBe(50);
        expect(body.diff).toBe(0);
        expect(body.unmatched).toHaveLength(1);
    });

    test('auto-match افتراضيًا على حساب الخريطة يطابق سطر الكشف', async () => {
        const { status, body } = await jpost('/bank-rec/auto-match', {});
        expect(status).toBe(200);
        expect(body).toEqual({ ok: true, matched: 1, scanned: 1 });
        const after = await jget(`/bank-rec?from=${FROM}&to=${TO}`);
        expect(after.body.unmatched).toEqual([]);
    });

    test('account الصريح يغلب الخريطة (سلوك قديم محفوظ)', async () => {
        const { body } = await jget(`/bank-rec?account=1000&from=${FROM}&to=${TO}`);
        expect(body.account).toBe('1000');
        expect(body.book).toBe(await dbNet('1000', FROM, TO));
        expect(body.book).toBe(150);
    });

    test('تغيير خريطة bank_reconciliation إلى 1150 يحوّل الافتراضي ويخفي كشوف 1010', async () => {
        await setMapping('bank_reconciliation', 'bank_account', '1150');
        const rec = await jget(`/bank-rec?from=${FROM}&to=${TO}`);
        expect(rec.body.account).toBe('1150');
        expect(rec.body.book).toBe(await dbNet('1150', FROM, TO));
        expect(rec.body.statement).toBe(0);
        const listed = await jget('/bank-statements');
        expect(listed.body.statements).toEqual([]);
        await setMapping('bank_reconciliation', 'bank_account', '1010');
    });
});

describe('143_down والرجوع للافتراضي', () => {
    test('down يسقط الصفوف الستة فقط، والمسارات ترجع لـ1000/1010', async () => {
        await pool.query(DOWN);
        const left = await sql(`SELECT COUNT(*)::int AS n FROM account_mapping WHERE module = 'reports'`);
        expect(left[0].n).toBe(0);

        const rec = await jget(`/bank-rec?from=${FROM}&to=${TO}`);
        expect(rec.body.account).toBe('1010');
        expect(rec.body.statement).toBe(50);

        const cf = await jget(`/cash-flow?from=${FROM}&to=${TO}`);
        expect(cf.body.closing).toBe(230);
    });
});

describe('الربط الفعلي في الملفات', () => {
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

    test('cash-flow يقرأ reports.cash_flow ولا ثابت IN (1000,1010)', () => {
        const src = read('backend/accounting-periods.js');
        expect(src).toMatch(/resolveAccounts\(pool, 'reports', 'cash_flow'/);
        expect(src).not.toMatch(/l\.account_code IN \('1000',\s*'1010'\)/);
        expect(src).not.toMatch(/l\.account_code IN \('1000','1010'\)/);
    });

    test('cfo-summary يقرأ reports.cfo_summary ويستخدم معاملات للحسابات', () => {
        const src = read('backend/accounting-routes.js');
        expect(src).toMatch(/resolveAccounts\(pool, 'reports', 'cfo_summary'/);
        expect(src).toMatch(/l\.account_code = \$1 THEN/);
        expect(src).toMatch(/l\.account_code = \$4/);
        expect(src).not.toMatch(/l\.account_code = '4000' AND e\.date/);
    });

    test('كل مسارات البنك تمر عبر defaultBankAccount من الخريطة', () => {
        const src = read('backend/accounting-growth.js');
        expect(src).toMatch(/resolveAccounts\(pool, 'reports', 'bank_reconciliation'/);
        const uses = src.match(/await defaultBankAccount\(\)/g) || [];
        expect(uses.length).toBe(4);
        expect(src).not.toMatch(/req\.query\.account \|\| '1010'/);
        expect(src).not.toMatch(/req\.body\?\.account \|\| '1010'/);
    });

    test('الهجرة تبذر 6 أدوار وdown يحذف بشرط القيمة المبذورة', () => {
        expect((UP.match(/^\('reports',/gm) || []).length).toBe(6);
        expect(DOWN).toMatch(/DELETE FROM account_mapping/);
        expect(DOWN.match(/^\s*\('reports',/gm).length).toBe(6);
    });
});
