/**
 * payroll-generate-period-a3.test.js — A3 (2026-11-06): فحص الفترة في توليد المسير
 * ──────────────────────────────────────────────────────────────────────────────
 * العطل المُصلَح: كان `/payroll-runs/generate` يسأل
 *   `SELECT 1 FROM accounting_periods WHERE month=$1 AND status='closed'`
 * والجدول أعمدته `period` و`closed` — لا `month` ولا `status` — فالاستعلام يسقط
 * بـ 42703 داخل المعاملة، والمعاملة مجهَضة أصلًا: توليد أي مسير يفشل 500 مهما كانت
 * حالة الفترة. fail-closed صحيح المبدأ، لكنه هنا يعني تعطّل العملية كلها بلا فترة
 * مقفلة واحدة. المسار صار نفس أداة القفل الذرّية `assertPeriodOpenInTx`.
 *
 * ما يثبته هذا الملف:
 *   1. الاستدعاء بصيغة الأداة الصحيحة وبأول الشهر (`2026-09-01`)، لا استعلام أعمدة وهمي.
 *   2. فترة مقفلة ⇒ 423 PERIOD_LOCKED + ROLLBACK + صفر كتابة على payroll/payroll_runs.
 *   3. تعذّر الفحص (خطأ قاعدة) ⇒ رفض لا نجاح (fail-closed) وصفر كتابة.
 *   4. فترة مفتوحة ⇒ التوليد يمضي حتى COMMIT.
 */
'use strict';

const mockAssertPeriodOpenInTx = jest.fn();

jest.mock('../backend/accounting-periods', () => ({
    assertPeriodOpenInTx: (...args) => mockAssertPeriodOpenInTx(...args),
    isPeriodClosed: async () => false,
}));

jest.mock('../backend/cashier-module/jwt-middleware', () => ({
    jwtAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../backend/shared-pool', () => {
    const state = { queries: [], writes: [] , reset() { state.queries = []; state.writes = []; } };
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
    const WRITE = /^(INSERT|UPDATE|DELETE)\b/i;
    const dispatch = async (rawSql, params = []) => {
        const s = norm(rawSql);
        state.queries.push({ sql: s, params });
        if (WRITE.test(s)) { state.writes.push({ sql: s, params }); }
        if (/FROM employees/i.test(s)) { return { rows: [] }; }
        return { rows: [] };
    };
    const client = { query: dispatch, release: () => {} };
    return {
        __esModule: true,
        __api: state,
        pool: { query: dispatch, connect: async () => client, end: async () => {} },
        safeQuery: dispatch,
        reinitPool: async () => {},
    };
});

const api = require('../backend/shared-pool').__api;
const { router } = require('../backend/hr-routes');

const mkRes = () => ({
    code: 200, body: null,
    status(code) {this.code = code; return this;},
    json(payload) {this.body = payload; return this;},
});

function handlerFor(pathName) {
    const layer = router.stack.find((l) => l.route && l.route.path === pathName);
    if (!layer) {throw new Error(`المسار ${pathName} غير موجود في hr-routes — حدِّث الاختبار`);}
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
const callGenerate = async (month = '2026-09') => {
    const res = mkRes();
    await handlerFor('/payroll-runs/generate')(
        { body: { month }, user: { id: 7, role: 'admin' }, headers: {} }, res);
    return res;
};

const wrotePayroll = () => api.writes.filter((w) => /\bpayroll(_runs)?\b/i.test(w.sql));
const didRollback = () => api.queries.some((q) => /^ROLLBACK\b/i.test(q.sql));
const didCommit = () => api.queries.some((q) => /^COMMIT\b/i.test(q.sql));

beforeEach(() => {
    api.reset();
    mockAssertPeriodOpenInTx.mockReset();
});

describe('A3 — /payroll-runs/generate يفحص الفترة بالأداة الصحيحة', () => {
    it('يستدعي assertPeriodOpenInTx بأول الشهر (لا استعلام أعمدة وهمي)', async () => {
        mockAssertPeriodOpenInTx.mockResolvedValue(undefined);
        await callGenerate('2026-09');
        expect(mockAssertPeriodOpenInTx).toHaveBeenCalledTimes(1);
        const [clientArg, periodArg] = mockAssertPeriodOpenInTx.mock.calls[0];
        expect(clientArg && typeof clientArg.query).toBe('function');
        expect(periodArg).toBe('2026-09-01');
        // لا رجوع للصيغة القديمة: لا أحد يسأل accounting_periods بـ month/status
        const bogus = api.queries.filter((q) => /accounting_periods/i.test(q.sql)
            && /\bmonth\s*=|\bstatus\s*=\s*'closed'/i.test(q.sql));
        expect(bogus).toEqual([]);
    });

    it('فترة مقفلة ⇒ 423 PERIOD_LOCKED وROLLBACK وصفر كتابة', async () => {
        const locked = new Error('PERIOD_LOCKED');
        locked.statusCode = 423;
        mockAssertPeriodOpenInTx.mockRejectedValue(locked);
        const res = await callGenerate('2026-09');
        expect(res.code).toBe(423);
        expect(res.body.error).toBe('PERIOD_LOCKED');
        expect(didRollback()).toBe(true);
        expect(didCommit()).toBe(false);
        expect(wrotePayroll()).toHaveLength(0);
    });

    it('تعذّر الفحص (خطأ قاعدة) ⇒ رفض لا نجاح، وصفر كتابة', async () => {
        mockAssertPeriodOpenInTx.mockRejectedValue(new Error('connection refused'));
        const res = await callGenerate('2026-09');
        expect(res.code).toBe(500);
        expect(res.body.error).toBe('PAYROLL_RUN_FAILED');
        expect(didRollback()).toBe(true);
        expect(didCommit()).toBe(false);
        expect(wrotePayroll()).toHaveLength(0);
    });

    it('فترة مفتوحة ⇒ التوليد يمضي حتى COMMIT', async () => {
        mockAssertPeriodOpenInTx.mockResolvedValue(undefined);
        const res = await callGenerate('2026-09');
        expect(res.code).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(didCommit()).toBe(true);
        expect(wrotePayroll()).toHaveLength(1); // payroll_runs واحد لصفر موظفين
    });

    it('لا استعلام محظوظ: الصيغة القديمة كانت 42703 وليست فارغة', () => {
        // يقرأ المصدر مباشرة: أي عودة إلى `WHERE month=$1 AND status='closed'`
        // على accounting_periods تُجهض كل توليد مسير — هذا العقد نصّي لأن الخطأ
        // لا يظهر في الاختبارات الوهمية (الموك يجهل الأعمدة أصلًا).
        const src = require('fs').readFileSync(require.resolve('../backend/hr-routes'), 'utf8');
        expect(src).not.toMatch(/accounting_periods[\s\S]{0,120}status\s*=\s*'closed'/);
        expect(src).toMatch(/assertPeriodOpenInTx\(client, `\$\{month\}-01`\)/);
    });
});
