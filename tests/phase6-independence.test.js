/**
 * phase6-independence.test.js — Phase 6: Independence Validation (لا Oracle ولا YaraSoft)
 * ════════════════════════════════════════════════════════════════════════════════════════
 * المطلوب: إثبات أن دورة العمل المحاسبية كاملة تعمل على PostgreSQL المحلي وحده بينما
 * الموصلان الخارجيان (Oracle / YaraSoft) معطلان تمامًا، وأي محاولة اتصال خارج
 * loopback تُرصد وتُقطع.
 *
 * يغطي الاختبار: الإقلاع والفحص الصحي ← بيع محلي ← ميزان مراجعة ← قائمة دخل ←
 * مركز مالي ← تدفق نقدي ← إقفال فترة يمنع الترحيل ثم إعادة الفتح ← ذمم عميل (AR)
 * ← تقرير أعمار الموردين (AP). كل شيء على karim_erp_test، وكل بيانات الوسم zz-phase6.
 *
 * حدود مقصودة (تُذكر في التقرير): لا نشغّل backend/server.js كاملًا لأنه يُطلق
 * بيكل LAN وجدولة تقارير ومحرك ZKTeco عند التحميل؛ الهارنس يركّب نفس الـ routers
 * الحقيقية على loopback. و postSaleToLedger لا يُستدعى لأن pos_shift_sessions فارغة
 * في قاعدة الاختبار — نستخدم نفس دالتي الترحيل الحقيقيتين buildSalePostingLines
 * و postJournal.
 */

'use strict';

process.env.YARASOFT_ORACLE_ENABLED = 'false';
process.env.YARASOFT_ENABLED = 'false';

// ─── حارس الخروج الشبكي: يُثبَّت قبل تحميل أي وحدة قد تتصل ────────────────────
const net = require('net');
const EGRESS = { allowed: [], blocked: [] };
const ORIGINAL_CONNECT = net.Socket.prototype.connect;

function connectTarget(args) {
    if (typeof args[0] === 'object' && args[0] !== null) {
        return { host: args[0].host, port: args[0].port, path: args[0].path };
    }
    if (typeof args[0] === 'number') {
        return { host: typeof args[1] === 'string' ? args[1] : null, port: args[0] };
    }
    if (typeof args[0] === 'string') {return { host: null, port: null, path: args[0] };}
    return { host: null, port: null };
}

function isLoopbackHost(host) {
    if (!host) {return true;} // unix socket / pipe أو مضيف افتراضي محلي
    const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1'
        || h.endsWith('.localhost') || /^127\./.test(h);
}

net.Socket.prototype.connect = function guardedConnect(...args) {
    const t = connectTarget(args);
    if (t.path || isLoopbackHost(t.host)) {
        EGRESS.allowed.push({ host: t.host || (t.path ? 'unix' : 'local'), port: t.port || null });
        return ORIGINAL_CONNECT.apply(this, args);
    }
    EGRESS.blocked.push({ host: String(t.host), port: t.port || null });
    throw Object.assign(new Error(`EGRESS_BLOCKED: ${t.host}:${t.port}`), { code: 'EGRESS_BLOCKED' });
};

const express = require('express');
const { pool } = require('../backend/shared-pool');
const {
    router: accountingRouter, postJournal, buildSalePostingLines,
} = require('../backend/accounting-routes');
const { router: periodsRouter } = require('../backend/accounting-periods');
const { router: growthRouter } = require('../backend/accounting-growth');
const { createHealthRouter, markBootComplete } = require('../backend/middleware/health');
const { resolveAccounts } = require('../backend/coa-mapping');
const { postCustomerInvoice, getSubledgerReconciliation } = require('../backend/subledger-service');
const { loadOracleConfig } = require('../backend/yarasoft/oracle-link');
const { loadConfig: loadYaraConfig } = require('../backend/yarasoft/config');

jest.mock('../backend/cashier-module/jwt-middleware', () => ({
    jwtAuth: (req, _res, next) => { req.user = { id: 1, role: 'admin' }; next(); },
    requireRole: () => (_req, _res, next) => next(),
}));

jest.setTimeout(90000);

const TAG = 'zz-phase6';
const PERIOD = '2019-06';
const FROM = '2019-06-01';
const TO = '2019-06-30';
const CUSTOMER_ID = 8001; // control_account_code = 1310 في قاعدة الاختبار
const AR_NET = 200;
const AR_VAT = 30;

const sql = async (text, params) => (await pool.query(text, params)).rows;

let server;
let baseUrl;
let baselinePeriodRow = null;

const state = {
    config: null,
    entry: null,
    tb: null,
    isBefore: null,
    isAfter: null,
    bsBefore: null,
    bsAfter: null,
    cfBefore: null,
    cfAfter: null,
    reconBefore: null,
    reconAfter: null,
    close: null,
    locked: null,
    reopen: null,
    ap: null,
    residue: null,
};

const getJson = async (p) => {
    const r = await fetch(baseUrl + p);
    return { status: r.status, body: await r.json() };
};
const postJson = async (p, body) => {
    const r = await fetch(baseUrl + p, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
    });
    return { status: r.status, body: await r.json() };
};

async function cleanup() {
    await sql(`DELETE FROM customer_transactions WHERE reference_no LIKE $1`, [`${TAG}%`]);
    await sql(`DELETE FROM journal_entries WHERE source_id LIKE $1`, [`${TAG}%`]);
}

async function restorePeriod() {
    if (baselinePeriodRow) {
        await sql(
            `UPDATE accounting_periods
                SET closed = $2, closed_by = $3, closed_at = $4, note = $5
              WHERE period = $1`,
            [PERIOD, baselinePeriodRow.closed, baselinePeriodRow.closed_by,
                baselinePeriodRow.closed_at, baselinePeriodRow.note]);
    } else {
        await sql(`DELETE FROM accounting_periods WHERE period = $1`, [PERIOD]);
    }
}

beforeAll(async () => {
    await cleanup();
    baselinePeriodRow = (await sql(
        `SELECT * FROM accounting_periods WHERE period = $1`, [PERIOD]))[0] || null;

    const app = express();
    app.use(express.json());
    app.use('/api/health', createHealthRouter({ pool }));
    app.use('/api/accounting', accountingRouter);
    app.use('/api/accounting', periodsRouter);
    app.use('/api/accounting', growthRouter);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    markBootComplete();
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    await cleanup();
    await restorePeriod();

    state.residue = {
        entries: (await sql(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE source_id LIKE $1`, [`${TAG}%`]))[0].n,
        subledger: (await sql(`SELECT COUNT(*)::int AS n FROM customer_transactions WHERE reference_no LIKE $1`, [`${TAG}%`]))[0].n,
        periodRestored: ((await sql(`SELECT COUNT(*)::int AS n FROM accounting_periods WHERE period = $1`, [PERIOD]))[0].n
            === (baselinePeriodRow ? 1 : 0)),
    };

    const evidence = {
        env: {
            YARASOFT_ORACLE_ENABLED: process.env.YARASOFT_ORACLE_ENABLED,
            YARASOFT_ENABLED: process.env.YARASOFT_ENABLED,
            DB: process.env.DB_NAME || process.env.KARIM_TEST_DB_NAME || null,
            PGHOST: process.env.PGHOST || null,
        },
        config: state.config,
        egress: {
            total: EGRESS.allowed.length,
            hosts: [...new Set(EGRESS.allowed.map((c) => c.host))],
            blocked: EGRESS.blocked,
        },
        sale: state.entry,
        trialBalance: state.tb,
        incomeStatementDelta: state.isAfter && state.isBefore
            ? Math.round((state.isAfter.revenues.total - state.isBefore.revenues.total) * 100) / 100 : null,
        balanceSheet: {
            beforeVariance: state.bsBefore?.reconciliation?.variance,
            afterVariance: state.bsAfter?.reconciliation?.variance,
            balanced: state.bsAfter?.reconciliation?.balanced,
        },
        cashFlowInflowDelta: state.cfAfter && state.cfBefore
            ? Math.round((state.cfAfter.inflow - state.cfBefore.inflow) * 100) / 100 : null,
        period: state.close,
        lockedPosting: state.locked,
        reopen: state.reopen,
        ar: state.reconBefore && state.reconAfter ? {
            subledgerDelta: Math.round((state.reconAfter.ar.subledgerBalance - state.reconBefore.ar.subledgerBalance) * 100) / 100,
            glDelta: Math.round((state.reconAfter.ar.glBalance - state.reconBefore.ar.glBalance) * 100) / 100,
            varianceBefore: state.reconBefore.ar.variance,
            varianceAfter: state.reconAfter.ar.variance,
            status: state.reconAfter.ar.status,
        } : null,
        ap: state.ap,
        residue: state.residue,
    };
    console.log('PHASE6_EVIDENCE ' + JSON.stringify(evidence));

    net.Socket.prototype.connect = ORIGINAL_CONNECT;
    await new Promise((resolve) => server.close(resolve));
    await pool.end().catch(() => {});
});

describe('Phase 6 — استقلالية كاملة عن Oracle/YaraSoft', () => {
    test('1) البوت على loopback والفحص الصحي أخضر', async () => {
        const live = await getJson('/api/health/live');
        expect(live.status).toBe(200);
        expect(live.body.status).toBe('ok');

        const startup = await getJson('/api/health/startup');
        expect(startup.status).toBe(200);

        const ready = await getJson('/api/health/ready');
        expect(ready.status).toBe(200);
        expect(ready.body.status).toBe('ok');
    });

    test('2) الموصلان معطلان و oracledb لم يُحمَّل إطلاقًا', () => {
        const oraCfg = loadOracleConfig();
        const yaraCfg = loadYaraConfig();
        state.config = { oracleEnabled: oraCfg.enabled, yaraEnabled: yaraCfg.enabled };
        expect(oraCfg.enabled).toBe(false);
        expect(yaraCfg.enabled).toBe(false);

        const loadedOracledb = Object.keys(require.cache)
            .filter((k) => /[\\/]node_modules[\\/]oracledb[\\/]/.test(k));
        expect(loadedOracledb).toEqual([]);

        // الوحدات المحاسبية الحقيقية محمّلة — فالإثبات يخص مسارًا فعليًا لا وهميًا.
        expect(Object.keys(require.cache).some((k) => /backend[\\/]accounting-routes\.js$/.test(k))).toBe(true);
    });

    test('3) قياس الأساس قبل أي ترحيل', async () => {
        state.isBefore = (await getJson(`/api/accounting/income-statement?from=${FROM}&to=${TO}`)).body;
        state.bsBefore = (await getJson(`/api/accounting/balance-sheet?as_of=${TO}`)).body;
        state.cfBefore = (await getJson(`/api/accounting/cash-flow?from=${FROM}&to=${TO}`)).body;
        state.reconBefore = await getSubledgerReconciliation(pool);

        expect(state.isBefore.statement).toBe('INCOME_STATEMENT');
        expect(state.bsBefore.statement).toBe('BALANCE_SHEET');
        expect(Number.isFinite(state.cfBefore.inflow)).toBe(true);
        expect(Number.isFinite(state.reconBefore.ar.subledgerBalance)).toBe(true);
    });

    test('4) بيع محلي يُرحَّل من الخريطة المحلية إلى الأستاذ', async () => {
        const accounts = await resolveAccounts(pool, 'sales_pos', 'pos_sale', {
            cash_account: '1000', bank_account: '1010', revenue_account: '4000',
            vat_output_account: '2100', cogs_account: '5000', inventory_account: '1200',
        });
        const lines = buildSalePostingLines({
            orderId: `${TAG}-order`,
            total: 115,
            tax: 15,
            cogs: 0,
            pays: [{ method: 'cash', amount: 115, direction: 'in' }],
            accounts,
        });
        expect(lines).toEqual([
            { account_code: accounts.cash_account, debit: 115, credit: 0, memo: 'تحصيل نقدي' },
            { account_code: accounts.revenue_account, debit: 0, credit: 100, memo: `مبيعات فاتورة #${TAG}-order` },
            { account_code: accounts.vat_output_account, debit: 0, credit: 15, memo: `ضريبة فاتورة #${TAG}-order` },
        ]);

        const out = await postJournal(pool, {
            date: `${PERIOD}-10`,
            memo: 'ZZ Phase6 بيع محلي',
            source_type: 'pos_sale',
            source_id: `${TAG}-sale`,
            lines,
        });
        expect(out.replay).toBe(false);
        state.entry = {
            entryNo: out.entry.entry_no,
            total: out.entry.total_debit,
            balanced: out.entry.total_debit === out.entry.total_credit,
            source: out.entry.source_type,
        };
        expect(state.entry.balanced).toBe(true);

        const stored = await sql(
            `SELECT COUNT(*)::int AS n FROM journal_lines l
               JOIN journal_entries e ON e.id = l.entry_id
              WHERE e.source_type = 'pos_sale' AND e.source_id = $1`, [`${TAG}-sale`]);
        expect(stored[0].n).toBe(3);
    });

    test('5) ميزان المراجعة متوازن ويحتوي أطراف القيد', async () => {
        const tb = await getJson(`/api/accounting/trial-balance?from=${FROM}&to=${TO}`);
        expect(tb.status).toBe(200);
        expect(tb.body.balanced).toBe(true);
        expect(tb.body.total_debit).toBe(tb.body.total_credit);

        const byCode = Object.fromEntries(tb.body.accounts.map((a) => [a.code, a]));
        expect(Number(byCode['1000'].debit)).toBeGreaterThanOrEqual(115);
        expect(Number(byCode['4000'].credit)).toBeGreaterThanOrEqual(100);
        expect(Number(byCode['2100'].credit)).toBeGreaterThanOrEqual(15);
        state.tb = {
            totalDebit: tb.body.total_debit, totalCredit: tb.body.total_credit, balanced: tb.body.balanced,
        };
    });

    test('6) قائمة الدخل والمركز المالي والتدفق النقدي تعكس البيع', async () => {
        state.isAfter = (await getJson(`/api/accounting/income-statement?from=${FROM}&to=${TO}`)).body;
        state.bsAfter = (await getJson(`/api/accounting/balance-sheet?as_of=${TO}`)).body;
        state.cfAfter = (await getJson(`/api/accounting/cash-flow?from=${FROM}&to=${TO}`)).body;

        const revenueDelta = Math.round((state.isAfter.revenues.total - state.isBefore.revenues.total) * 100) / 100;
        expect(revenueDelta).toBe(100);

        // القيد لا يغيّر معادلة المركز المالي: أصل +115، التزام +15، حقوق ملكية +100.
        expect(state.bsAfter.reconciliation.variance).toBe(state.bsBefore.reconciliation.variance);
        expect(state.bsAfter.reconciliation.balanced).toBe(true);

        const inflowDelta = Math.round((state.cfAfter.inflow - state.cfBefore.inflow) * 100) / 100;
        expect(inflowDelta).toBe(115);
    });

    test('7) إقفال الفترة يمنع الترحيل ثم يُعاد فتحها', async () => {
        const closed = await postJson(`/api/accounting/periods/${PERIOD}/close`, { note: 'zz-phase6 close' });
        expect(closed.status).toBe(200);
        expect(closed.body.closed).toBe(true);
        state.close = { status: closed.status, closed: closed.body.closed };

        let lockedStatus = null;
        try {
            await postJournal(pool, {
                date: `${PERIOD}-20`,
                memo: 'ZZ Phase6 يجب أن يُرفض',
                source_type: 'manual',
                source_id: `${TAG}-should-fail`,
                lines: [
                    { account_code: '1000', debit: 10, credit: 0 },
                    { account_code: '4000', debit: 0, credit: 10 },
                ],
            });
        } catch (e) {
            lockedStatus = e.statusCode || null;
        }
        expect(lockedStatus).toBe(423);
        state.locked = { rejected: true, statusCode: lockedStatus };

        const reopened = await postJson(`/api/accounting/periods/${PERIOD}/open`, { note: 'zz-phase6 reopen' });
        expect(reopened.status).toBe(200);
        expect(reopened.body.closed).toBe(false);
        state.reopen = { status: reopened.status, closed: reopened.body.closed };
    });

    test('8) ذمم العميل (AR) تُرحَّل وتتطابق مع الأستاذ، وتقرير AP يعمل', async () => {
        const res = await postCustomerInvoice(pool, {
            customerId: CUSTOMER_ID,
            date: `${PERIOD}-12`,
            netAmount: AR_NET,
            vatAmount: AR_VAT,
            referenceNo: `${TAG}-ar`,
            memo: 'ZZ Phase6 فاتورة عميل',
            createdBy: null,
        });
        expect(res.gross).toBe(230);

        state.reconAfter = await getSubledgerReconciliation(pool);
        expect(Math.round((state.reconAfter.ar.subledgerBalance - state.reconBefore.ar.subledgerBalance) * 100) / 100).toBe(230);
        expect(Math.round((state.reconAfter.ar.glBalance - state.reconBefore.ar.glBalance) * 100) / 100).toBe(230);
        // الفرق العام قبل الاختبار قد يكون غير صفري (بيانات اختبار سابقة)؛
        // المطلوب أن ترحيلنا لا يغيّر الفرق ولا التصنيف — لا أن ينظف قاعدة مشتركة.
        expect(state.reconAfter.ar.variance).toBe(state.reconBefore.ar.variance);
        expect(state.reconAfter.ar.status).toBe(state.reconBefore.ar.status);

        const ap = await getJson('/api/accounting/ap-aging');
        expect(ap.status).toBe(200);
        expect(ap.body.ok).toBe(true);
        expect(Number.isFinite(ap.body.total)).toBe(true);
        state.ap = { status: ap.status, ok: ap.body.ok, suppliers: ap.body.count, total: ap.body.total };
    });

    test('9) صفر محاولة اتصال خارج loopback خلال الدورة كاملة', () => {
        expect(EGRESS.blocked).toEqual([]);
        // الحارس اعترض حركة حقيقية (PostgreSQL المحلي) — ليس كودًا ميتًا.
        expect(EGRESS.allowed.length).toBeGreaterThan(0);
        const foreign = EGRESS.allowed.filter(
            (c) => c.host !== 'local' && c.host !== 'unix' && !isLoopbackHost(c.host));
        expect(foreign).toEqual([]);
    });
});
