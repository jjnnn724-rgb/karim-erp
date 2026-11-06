/**
 * branch-scope-visibility.test.js — فرع NULL لا يمرّ صامتًا مع تعدد الفروع
 * ────────────────────────────────────────────────────────────────────────
 * القاعدة (مراجعة خارجية 2026-11): مستخدم تشغيلي بلا branch_id كان يُرى كل
 * الفروع بلا أي أثر (fail-open قديم مقصود مؤقتًا). الآن:
 *   • السلوك لم يتغيّر (null = بلا تصفية — fail-closed قرار مالك)،
 *   • لكن كل مستخدم بلا فرع يُسجَّل له تحذير واحد في دورة التشغيل عند وجود
 *     فرعين نشطين على الأقل — تقرير فقط، لا كسر للطلب.
 *
 * regression: الصمت الكامل كان يخفي كشف كل البيانات لكل من حُرِم فرعه.
 */
'use strict';

jest.mock('../backend/shared-pool', () => {
    const state = {
        branches: [],
        failBranches: null,
        reset({ branches = [], failBranches = null } = {}) {
            state.branches = branches;
            state.failBranches = failBranches;
        },
    };
    const dispatch = async (rawSql) => {
        const s = String(rawSql);
        if (/FROM branches/i.test(s)) {
            if (state.failBranches) {throw state.failBranches;}
            return { rows: state.branches };
        }
        return { rows: [] };
    };
    return {
        __esModule: true,
        __api: state,
        pool: { query: dispatch, connect: async () => ({ query: dispatch, release: () => {} }), end: async () => {} },
        safeQuery: dispatch,
        reinitPool: async () => {},
    };
});
jest.mock('../backend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { __api: api } = require('../backend/shared-pool');
const { logger } = require('../backend/logger');
const branchCtx = require('../backend/branch-context');

// فرعان نشطان كحدّ أدنى لتفعيل التحذير
const TWO = [
    { id: 1, code: 'MAIN', currency: 'SAR', timezone: 'Asia/Riyadh', is_active: true },
    { id: 2, code: 'BR2', currency: 'SAR', timezone: 'Asia/Riyadh', is_active: true },
];
const req = (user) => ({ user, headers: {}, query: {} });

const warnCallsFor = (userId) =>
    logger.warn.mock.calls.filter((c) => c[0] && c[0].userId === userId);

beforeEach(() => {
    logger.warn.mockClear();
    branchCtx.invalidateBranchCache();
});

describe('resolveBranch — تحذير النطاق المفتوح', () => {
    it('cashier بلا فرع + فرعان نشطان → null (سلوك قديم) + تحذير واحد', async () => {
        api.reset({ branches: TWO });
        const r = await branchCtx.resolveBranch(req({ id: 8101, role: 'cashier', branch_id: null, username: 'c1' }));
        expect(r).toBeNull();
        expect(warnCallsFor(8101)).toHaveLength(1);
        expect(warnCallsFor(8101)[0][0].where).toBe('resolveBranch');
        expect(warnCallsFor(8101)[0][0].activeBranches).toBe(2);
        expect(warnCallsFor(8101)[0][1]).toContain('branch_id');
    });

    it('نفس المستخدم مرة أخرى → لا تحذير مكرر في الدورة', async () => {
        api.reset({ branches: TWO });
        await branchCtx.resolveBranch(req({ id: 8102, role: 'cashier', branch_id: null }));
        await branchCtx.resolveBranch(req({ id: 8102, role: 'cashier', branch_id: null }));
        expect(warnCallsFor(8102)).toHaveLength(1);
    });

    it('مستخدم آخر → تحذير مستقل', async () => {
        api.reset({ branches: TWO });
        await branchCtx.resolveBranch(req({ id: 8103, role: 'warehouse', branch_id: null }));
        await branchCtx.resolveBranch(req({ id: 8104, role: 'kitchen', branch_id: null }));
        expect(warnCallsFor(8103)).toHaveLength(1);
        expect(warnCallsFor(8104)).toHaveLength(1);
    });

    it('دور global (admin) بلا فرع → null بلا تحذير (ليس محصورًا)', async () => {
        api.reset({ branches: TWO });
        const r = await branchCtx.resolveBranch(req({ id: 8105, role: 'admin', branch_id: null }));
        expect(r).toBeNull();
        expect(warnCallsFor(8105)).toHaveLength(0);
    });

    it('مستخدم له فرع → يُعاد فرعه بلا تحذير', async () => {
        api.reset({ branches: TWO });
        const r = await branchCtx.resolveBranch(req({ id: 8106, role: 'cashier', branch_id: 2 }));
        expect(r).toBe(2);
        expect(warnCallsFor(8106)).toHaveLength(0);
    });

    it('فرع واحد نشط فقط → لا تحذير (لا تسريب عملي)', async () => {
        api.reset({ branches: [TWO[0]] });
        const r = await branchCtx.resolveBranch(req({ id: 8107, role: 'cashier', branch_id: null }));
        expect(r).toBeNull();
        expect(warnCallsFor(8107)).toHaveLength(0);
    });

    it('فشل قراءة الفروع → null بلا كسر للطلب (fail-open للتحذير)', async () => {
        api.reset({ branches: TWO, failBranches: new Error('branches table down') });
        const r = await branchCtx.resolveBranch(req({ id: 8108, role: 'cashier', branch_id: null }));
        expect(r).toBeNull();
        expect(warnCallsFor(8108)).toHaveLength(0);
    });

    it('جدول الفروع غير موجود (migration 102 لم تُطبق) → null بلا تحذير ولا كسر', async () => {
        const e = new Error('relation "branches" does not exist');
        e.code = '42P01';
        api.reset({ branches: TWO, failBranches: e });
        const r = await branchCtx.resolveBranch(req({ id: 8109, role: 'cashier', branch_id: null }));
        expect(r).toBeNull();
        expect(warnCallsFor(8109)).toHaveLength(0);
    });
});
