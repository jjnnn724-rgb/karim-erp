/**
 * payroll-period-guard.test.js — /deductions/apply يرفض الكتابة في فترة مقفلة
 * ────────────────────────────────────────────────────────────────────────
 * القاعدة (fail-closed، موحّدة مع /payroll-runs/generate):
 *   • فترة مقفلة محاسبيًا → 423 PERIOD_LOCKED — ولا يُكتب أي بند، ولا DELETE.
 *   • تعذّر التحقق من حالة الفترة → 503 PERIOD_CHECK_UNAVAILABLE — ولا يُكتب أي بند.
 *   • الفترة مفتوحة → يمضي التطبيق (DELETE للبنود الآلية السابقة ثم COMMIT).
 *
 * regression: كان المسار يبتلع خطأ التحقق ويستمر (fail-open: «controls down → تطبيق»).
 */
'use strict';

const mockIsPeriodClosed = jest.fn();

jest.mock('../backend/accounting-periods', () => ({
    isPeriodClosed: (...args) => mockIsPeriodClosed(...args),
}));

jest.mock('../backend/cashier-module/jwt-middleware', () => ({
    jwtAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../backend/shared-pool', () => {
    const state = {
        queries: [],
        writes: [],
        reset() { state.queries = []; state.writes = []; },
    };
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
    const WRITE = /^(INSERT|UPDATE|DELETE)\b/i;
    const dispatch = async (rawSql, params = []) => {
        const s = norm(rawSql);
        state.queries.push({ sql: s, params });
        if (WRITE.test(s) && !/^(UPDATE attendance_push_queue)/i.test(s)) {
            state.writes.push({ sql: s, params });
        }
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

function applyHandler() {
    const layer = router.stack.find((l) => l.route && l.route.path === '/deductions/apply');
    expect(layer).toBeTruthy();
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
const mkRes = () => ({
    code: 200, body: null,
    status(code) {this.code = code; return this;},
    json(payload) {this.body = payload; return this;},
});
const callApply = async (month = '2026-09') => {
    const res = mkRes();
    await applyHandler()({ body: { month, skipFridays: false }, user: { id: 7, role: 'admin' }, headers: {} }, res);
    return res;
};
const wrotePayroll = () => api.writes.filter((w) => /payroll_adjustments/i.test(w.sql));
const didRollback = () => api.queries.some((q) => /^\s*ROLLBACK\b/i.test(q.sql));
const didCommit = () => api.queries.some((q) => /^\s*COMMIT\b/i.test(q.sql));

beforeEach(() => {
    api.reset();
    mockIsPeriodClosed.mockReset();
});

describe('/deductions/apply — fail-closed للفترة المحاسبية', () => {
    it('فترة مقفلة → 423 PERIOD_LOCKED، لا DELETE ولا INSERT، ROLLBACK فقط', async () => {
        mockIsPeriodClosed.mockResolvedValue(true);
        const res = await callApply();
        expect(res.code).toBe(423);
        expect(res.body.error).toBe('PERIOD_LOCKED');
        expect(wrotePayroll()).toHaveLength(0);
        expect(didRollback()).toBe(true);
        expect(didCommit()).toBe(false);
    });

    it('تعذّر التحقق (القاعدة سقطت مثلًا) → 503 PERIOD_CHECK_UNAVAILABLE، لا DELETE ولا INSERT', async () => {
        mockIsPeriodClosed.mockRejectedValue(new Error('connection refused'));
        const res = await callApply();
        expect(res.code).toBe(503);
        expect(res.body.error).toBe('PERIOD_CHECK_UNAVAILABLE');
        expect(wrotePayroll()).toHaveLength(0);
        expect(didRollback()).toBe(true);
        expect(didCommit()).toBe(false);
    });

    it('فترة مفتوحة → التطبيق يمضي: DELETE للبنود الآلية ثم COMMIT (لا ROLLBACK)', async () => {
        mockIsPeriodClosed.mockResolvedValue(false);
        const res = await callApply();
        expect(res.code).toBe(200);
        expect(res.body.ok).toBe(true);
        const dels = api.writes.filter((w) => /DELETE FROM payroll_adjustments/i.test(w.sql));
        expect(dels).toHaveLength(1);
        expect(dels[0].params[0]).toBe('2026-09');
        expect(didCommit()).toBe(true);
        expect(didRollback()).toBe(false);
    });
});
