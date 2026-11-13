/**
 * coa-phase3-vat.test.js — إقرار VAT + سياسة تصفية 1150 (Phase 3)
 * ══════════════════════════════════════════════════════════════════════
 * عقدان:
 *  1) buildVatSettlementPlan نقية: الإطفاء = min(المستحق، القابل للاسترداد)
 *     على الأرصدة المرحّلة حتى نهاية الشهر — لا تُطفئ رصيدًا سالبًا، ولا تُنشئ
 *     أي سطر للصافي أو للترحيل (يبقيان على 2100/1150).
 *  2) المساران يقرآن tax.vat_return من account_mapping: التقرير قراءة فقط،
 *     والتصفية preview افتراضيًا ثم apply:true، شهر منتهٍ فقط، idempotent
 *     بمفتاح (vat_settlement, month)، والإعادة 409، والفترة المقفلة 423.
 *
 * البيانات في karim_erp_test فقط بوسم zz_vat_test وأشهر 2018/2019 الفارغة،
 * وتُحذف في afterAll. لا كتابة على الإنتاج ولا على YaraSoft/Oracle إطلاقًا.
 */
'use strict';

const express = require('express');

const mockUser = { id: 990031, role: 'accountant', name: 'محاسب ZZ' };

jest.mock('../backend/cashier-module/jwt-middleware', () => ({
    jwtAuth: (req, _res, next) => { req.user = mockUser; next(); },
    requireRole: () => (_req, _res, next) => next(),
}));

const { pool } = require('../backend/shared-pool');
const { router, postJournal, buildVatSettlementPlan } = require('../backend/accounting-routes');

jest.setTimeout(60000);

const sql = async (text, params) => (await pool.query(text, params)).rows;
const jget = async (pathname) => {
    const res = await fetch(baseUrl + pathname);
    return { status: res.status, body: await res.json() };
};
const jpost = async (pathname, body) => {
    const res = await fetch(baseUrl + pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
};

let server;
let baseUrl;

const SEED_SOURCE = 'zz_vat_test';
const MONTH = '2019-01';
const CLOSED_MONTH = '2019-02';
const EMPTY_MONTH = '2018-07';

async function cleanup() {
    // teardown موسوم عبر بوابة 136 المرخّصة — نمط journal-void: معاملة + SET LOCAL
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL coa.allow_hard_delete = 'on'");
        await client.query(
            `DELETE FROM journal_entries
             WHERE (source_type = $1 AND source_id LIKE 'zz-%')
              OR (source_type = 'vat_settlement' AND source_id IN ($2,$3))`,
            [SEED_SOURCE, MONTH, CLOSED_MONTH]);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
    await sql(`DELETE FROM accounting_periods WHERE period = $1 AND closed = true AND note = 'zz_vat_test'`, [CLOSED_MONTH]);
}

beforeAll(async () => {
    await cleanup();
    // المستخدم الوهمي للـJWT المُموّه — journal_entries.created_by يرجع FK إلى users(id)
    await pool.query(
        `INSERT INTO users (id, username, password, role, name, active) VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (id) DO NOTHING`,
        [990031, 'zz_vat_phase3', 'zz', 'accountant', 'محاسب ZZ']);
    const seed = async (date, sourceId, lines) => {
        const out = await postJournal(pool, { date, memo: 'ZZ VAT seed', source_type: SEED_SOURCE, source_id: sourceId, lines });
        if (out.replay) {throw new Error('seed replay غير متوقع: ' + sourceId);}
    };
    // إقرار يناير 2019: مدخلات 150 (Dr 1150)، مخرجات 30 (Cr 2100)
    await seed('2019-01-15', 'zz-vat-in-2019-01', [
        { account_code: '1150', debit: 150, credit: 0, memo: 'ضريبة مدخلات ZZ' },
        { account_code: '1200', debit: 0, credit: 150, memo: 'مخزون ZZ' },
    ]);
    await seed('2019-01-20', 'zz-vat-out-2019-01', [
        { account_code: '1000', debit: 230, credit: 0, memo: 'نقدية ZZ' },
        { account_code: '4000', debit: 0, credit: 200, memo: 'مبيعات ZZ' },
        { account_code: '2100', debit: 0, credit: 30, memo: 'ضريبة مخرجات ZZ' },
    ]);
    // فبراير 2019 لفترة مقفلة: 50/50 فيصير الإطفاء 50
    await seed('2019-02-10', 'zz-vat-in-2019-02', [
        { account_code: '1150', debit: 50, credit: 0, memo: 'ضريبة مدخلات ZZ' },
        { account_code: '1200', debit: 0, credit: 50, memo: 'مخزون ZZ' },
    ]);
    await seed('2019-02-11', 'zz-vat-out-2019-02', [
        { account_code: '1000', debit: 50, credit: 0, memo: 'نقدية ZZ' },
        { account_code: '2100', debit: 0, credit: 50, memo: 'ضريبة مخرجات ZZ' },
    ]);

    const app = express();
    app.use(express.json());
    app.use('/api/accounting', router);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/accounting`;
});

afterAll(async () => {
    await cleanup();
    await pool.query('DELETE FROM users WHERE id = $1 AND username = $2', [990031, 'zz_vat_phase3']);
    await new Promise((resolve) => server.close(resolve));
    await pool.end().catch(() => {});
});

describe('buildVatSettlementPlan — دالة نقية', () => {
    test('المستحق أكبر: يُطفأ القابل للاسترداد كاملًا ويبقى الفرق على 2100', () => {
        const plan = buildVatSettlementPlan({ payableBalance: 300, recoverableBalance: 120 });
        expect(plan).toEqual({
            clearing: 120,
            net_payable_after: 180,
            carry_forward_after: 0,
            lines: [
                { account_code: '2100', debit: 120, credit: 0, memo: 'تصفية ضريبة مخرجات مقابل مدخلات' },
                { account_code: '1150', debit: 0, credit: 120, memo: 'تصفية ضريبة مدخلات' },
            ],
        });
    });

    test('القابل للاسترداد أكبر: يُطفأ المستحق كاملًا ويبقى الترحيل على 1150', () => {
        const plan = buildVatSettlementPlan({ payableBalance: 30, recoverableBalance: 150 });
        expect(plan.clearing).toBe(30);
        expect(plan.net_payable_after).toBe(0);
        expect(plan.carry_forward_after).toBe(120);
        expect(plan.lines.map((l) => [l.account_code, l.debit, l.credit])).toEqual([['2100', 30, 0], ['1150', 0, 30]]);
    });

    test('رصيد سالب أو صفري لا يُنتج سطورًا إطلاقًا', () => {
        expect(buildVatSettlementPlan({ payableBalance: -10, recoverableBalance: 80 }).lines).toEqual([]);
        expect(buildVatSettlementPlan({ payableBalance: 0, recoverableBalance: 0 })).toEqual({
            clearing: 0, net_payable_after: 0, carry_forward_after: 0, lines: [],
        });
    });

    test('الحسابان يتبعان الخريطة، والتقريب منزلتان', () => {
        const plan = buildVatSettlementPlan({
            payableBalance: 10.005, recoverableBalance: 7.007,
            accounts: { payable_account: '2110', recoverable_account: '1160' },
        });
        expect(plan.clearing).toBe(7.01);
        expect(plan.lines.map((l) => l.account_code)).toEqual(['2110', '1160']);
        const dr = plan.lines.reduce((s, l) => s + l.debit, 0);
        const cr = plan.lines.reduce((s, l) => s + l.credit, 0);
        expect(dr).toBe(cr);
    });
});

describe('GET /vat-return — قراءة فقط من المرحّل', () => {
    test('فترة 2019-01 قبل التصفية: مخرجات 30، مدخلات 150، ترحيل 120، ورصيدان مرحّلان', async () => {
        const { status, body } = await jget(`/vat-return?from=2019-01-01&to=2019-01-31`);
        expect(status).toBe(200);
        expect(body.output_vat).toBe(30);
        expect(body.input_vat).toBe(150);
        expect(body.net_payable).toBe(0);
        expect(body.carry_forward_credit).toBe(120);
        expect(body.payable_balance).toBe(30);
        expect(body.recoverable_balance).toBe(150);
        expect(body).not.toHaveProperty('purchase_crosscheck');
        expect(body.purchases_crosscheck).toMatchObject({ count: 0, net: 0, vat: 0 });
    });

    test('بداية بعد النهاية 422، ولا قيد جديد يُنشأ من التقرير', async () => {
        const { status, body } = await jget(`/vat-return?from=2019-02-01&to=2019-01-01`);
        expect(status).toBe(422);
        expect(body.error).toBe('LEDGER_PERIOD_INVALID');
        const n = await sql(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE source_type = 'vat_settlement'`);
        expect(n[0].n).toBe(0);
    });
});

describe('POST /vat-settlement — تصفية 1150', () => {
    test('شهر بصيغة خاطئة 422', async () => {
        const { status, body } = await jpost('/vat-settlement', { month: 'يناير' });
        expect(status).toBe(422);
        expect(body.error).toBe('LEDGER_MONTH_INVALID');
    });

    test('الشهر الجاري غير مقبول — لا تصفية لفترة لم تنتهِ', async () => {
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
        const { status, body } = await jpost('/vat-settlement', { month: today.slice(0, 7), apply: true });
        expect(status).toBe(422);
        expect(body.error).toBe('LEDGER_VAT_PERIOD_OPEN');
    });

    test('بلا apply: معاينة فقط ولا قيد', async () => {
        const { status, body } = await jpost('/vat-settlement', { month: MONTH });
        expect(status).toBe(200);
        expect(body.applied).toBe(false);
        expect(body.preview).toBe(true);
        expect(body.clearing).toBe(30);
        expect(body.net_payable_after).toBe(0);
        expect(body.carry_forward_after).toBe(120);
        expect(body.lines).toHaveLength(2);
        expect(body.settled).toBeNull();
        const n = await sql(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE source_type = 'vat_settlement'`);
        expect(n[0].n).toBe(0);
    });

    test('apply:true يقيّد Dr 2100 / Cr 1150 بتاريخ نهاية الشهر بمفتاح (vat_settlement, month)', async () => {
        const { status, body } = await jpost('/vat-settlement', { month: MONTH, apply: true });
        expect(status).toBe(201);
        expect(body.applied).toBe(true);
        expect(body.entry.source_type).toBe('vat_settlement');
        expect(body.entry.source_id).toBe(MONTH);
        expect(body.settled).toEqual({ entry_no: body.entry.entry_no, date: '2019-01-31', status: 'posted' });

        // التاريخ الحقيقي في القاعدة هو آخر يوم بالشهر (JSON يُسلسِل Date بمنطقة
        // الخادم، فنقرأ النص من القاعدة نفسها لا من التمثيل)
        const stored = await sql(
            `SELECT date::text AS date, source_type, source_id FROM journal_entries WHERE id = $1`,
            [body.entry.id]);
        expect(stored[0]).toEqual({ date: '2019-01-31', source_type: 'vat_settlement', source_id: MONTH });

        const lines = await sql(
            `SELECT l.account_code, l.debit::float AS debit, l.credit::float AS credit
               FROM journal_lines l WHERE l.entry_id = $1 ORDER BY l.account_code DESC`,
            [body.entry.id]);
        expect(lines).toEqual([
            { account_code: '2100', debit: 30, credit: 0 },
            { account_code: '1150', debit: 0, credit: 30 },
        ]);

        // الأرصدة بعد التصفية: المستحق صفر، الترحيل 120
        const after = (await jget(`/vat-return?from=2019-01-01&to=2019-01-31`)).body;
        expect(after.payable_balance).toBe(0);
        expect(after.recoverable_balance).toBe(120);
    });

    test('إعادة الترحيل لنفس الشهر 409 LEDGER_DUPLICATE ولا قيد ثانٍ', async () => {
        const { status, body } = await jpost('/vat-settlement', { month: MONTH, apply: true });
        expect(status).toBe(409);
        expect(body.error).toBe('LEDGER_DUPLICATE');
        expect(body.entry).toBeTruthy();
        expect(body.settled).toEqual({ entry_no: body.entry.entry_no, date: '2019-01-31', status: 'posted' });
        const n = await sql(
            `SELECT COUNT(*)::int AS n FROM journal_entries WHERE source_type = 'vat_settlement' AND source_id = $1`,
            [MONTH]);
        expect(n[0].n).toBe(1);
    });

    test('شهر بلا أرصدة: skipped nothing_to_clear ولا قيد', async () => {
        const { status, body } = await jpost('/vat-settlement', { month: EMPTY_MONTH, apply: true });
        expect(status).toBe(200);
        expect(body.applied).toBe(false);
        expect(body.skipped).toBe('nothing_to_clear');
        const n = await sql(
            `SELECT COUNT(*)::int AS n FROM journal_entries WHERE source_type = 'vat_settlement' AND source_id = $1`,
            [EMPTY_MONTH]);
        expect(n[0].n).toBe(0);
    });

    test('شهر مقفل 423 PERIOD_CLOSED ولا ترحيل', async () => {
        // لا نلمس صفًا موجودًا: الإدراج فقط إن لم تكن الفترة معرّفة، والحذف لما أنشأناه
        const ins = await sql(
            `INSERT INTO accounting_periods (period, closed, note) VALUES ($1, true, 'zz_vat_test')
             ON CONFLICT (period) DO NOTHING RETURNING period`,
            [CLOSED_MONTH]);
        try {
            const { status, body } = await jpost('/vat-settlement', { month: CLOSED_MONTH, apply: true });
            expect(status).toBe(423);
            expect(body.error).toBe('PERIOD_CLOSED');
            const n = await sql(
                `SELECT COUNT(*)::int AS n FROM journal_entries WHERE source_type = 'vat_settlement' AND source_id = $1`,
                [CLOSED_MONTH]);
            expect(n[0].n).toBe(0);
        } finally {
            if (ins.length) {
                await sql(`DELETE FROM accounting_periods WHERE period = $1 AND note = 'zz_vat_test'`, [CLOSED_MONTH]);
            }
        }
    });
});

describe('الربط الفعلي في الملف (Phase 3)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'backend/accounting-routes.js'), 'utf8');

    test('التقرير والتصفية يقرآن tax.vat_return من الجدول ولا ثوابت IN inline', () => {
        const hits = src.match(/resolveAccounts\(pool, 'tax', 'vat_return'/g) || [];
        expect(hits.length).toBe(2);
        expect(src).not.toMatch(/l\.account_code IN \('1150','2100'\)/);
        expect(src).not.toMatch(/l\.account_code IN \('2100','1150'\)/);
    });

    test('الترحيل محمي بدور الكتابة ومفتاح ثابت ويُمرَّر created_by', () => {
        expect(src).toMatch(/router\.post\('\/vat-settlement', jwtAuth, requireRole\(\.\.\.WRITE_ROLES\)/);
        expect(src).toMatch(/source_type: 'vat_settlement'/);
        expect(src).toMatch(/source_id: month/);
        expect(src).toMatch(/created_by: req\.user\?\.id \|\| null/);
    });

    test('هجرة 134 تبذر دورَي tax.vat_return على 2100/1150', () => {
        const up = fs.readFileSync(path.join(__dirname, '..', 'database/migrations/134_coa_foundation.sql'), 'utf8');
        expect(up).toMatch(/'tax','vat_return','payable_account','2100'/);
        expect(up).toMatch(/'tax','vat_return','recoverable_account','1150'/);
    });
});
