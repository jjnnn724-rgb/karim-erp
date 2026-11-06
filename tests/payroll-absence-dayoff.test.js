/**
 * payroll-absence-dayoff.test.js — يوم الراحة الأسبوعية للموظف لا يُخصم غيابًا
 * ────────────────────────────────────────────────────────────────────────
 * القاعدة (FIX 2026-11-05، مراجعة خارجية P1): حلقة احتساب الغياب كانت تقرأ
 * الجمعة فقط (skipFridays) ولا تقرأ `day_off`، فموظف راحته الأربعاء كان يُخصم
 * غيابًا كاملًا في كل أربعاء. الآن: day_off يُحل بتاريخ السريان (087) أولًا
 * ويليه عمود البطاقة، ويوم الراحة لا يُحسب غيابًا.
 *
 * regression: قبل الإصلاح كانت الخصومات تُحتسب 30 يوم غياب لموظف بلا بصمات
 * (أو 25 مع skipFridays) بغضّ النظر عن day_off — الاختبار التالي يميز.
 */
'use strict';

jest.mock('../backend/cashier-module/jwt-middleware', () => ({
    jwtAuth: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../backend/shared-pool', () => {
    const state = {
        queries: [],
        employees: [],
        historyRows: [],
        reset({ employees = [], historyRows = [] } = {}) {
            state.queries = [];
            state.employees = employees;
            state.historyRows = historyRows;
        },
    };
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
    const dispatch = async (rawSql) => {
        const s = norm(rawSql);
        state.queries.push({ sql: s });
        if (/FROM employees WHERE status = 'active'/i.test(s)) {return { rows: state.employees };}
        if (/employee_shift_history/i.test(s)) {return { rows: state.historyRows };}
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

const api = require('../backend/shared-pool').__api;
const { computeMonthDeductions } = require('../backend/hr-routes');

const MONTH = '2026-09';
const START = new Date('2026-09-01T00:00:00.000Z');
const END = new Date('2026-09-30T00:00:00.000Z');
const TODAY = new Date().toISOString().slice(0, 10);

/** العدّ المرجعي المستقل: أيام الشهر المكتملة (≤ اليوم) بعد استبعاد الجمعة (إن طُلبت) والراحة. */
function countAbsent({ skipFridays = false, dayOff = null, joinDate = null } = {}) {
    let n = 0;
    for (let d = new Date(START); d <= END; d = new Date(d.getTime() + 86400000)) {
        const iso = d.toISOString().slice(0, 10);
        if (iso > TODAY) {break;}
        if (joinDate && iso < joinDate) {continue;}
        const wd = d.getUTCDay();
        if (skipFridays && wd === 5) {continue;}
        if (dayOff != null && wd === Number(dayOff)) {continue;}
        n += 1;
    }
    return n;
}

const EMPS = [
    { id: 11, name: 'موظف أ', employeeId: 'EMP-A', salary: '3000.00', shift_karim: 8, day_off: 3, joinDate: '2026-09-01' },
    { id: 12, name: 'موظف ب', employeeId: 'EMP-B', salary: '6000.00', shift_karim: 10, day_off: 5, joinDate: '2026-09-01' },
    { id: 13, name: 'موظف ج', employeeId: 'EMP-C', salary: '3000.00', shift_karim: 8, day_off: null, joinDate: '2026-09-20' },
];

beforeEach(() => api.reset({ employees: EMPS }));

describe('الغياب — day_off يُستبعد من الاحتساب', () => {
    it('الشهر كله محسوب مرجعيًا: 30 يومًا بلا استبعادات (مرساة لصحة العدّ)', () => {
        expect(countAbsent({})).toBe(30);
    });

    it('بلا بصمات: موظف راحته الأربعاء تُخصم له أيام غياب بلا أربعاء', async () => {
        const { detail } = await computeMonthDeductions(MONTH, { skipFridays: false });
        const a = detail.find((d) => d.employeeId === 11);
        expect(a.absentDays).toBe(countAbsent({ dayOff: 3 }));
        expect(a.absentDays).toBeLessThan(30);
        expect(a.absentDates.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 3)).toBe(true);
        expect(a.absentDeduction).toBe(Math.round(a.absentDays * (3000 / 30) * 100) / 100);
    });

    it('موظف راحته الجمعة يتساوى مع skipFridays لكن يُستبعد حتى بلا الخيار', async () => {
        const { detail } = await computeMonthDeductions(MONTH, { skipFridays: false });
        const b = detail.find((d) => d.employeeId === 12);
        expect(b.absentDays).toBe(countAbsent({ dayOff: 5 }));
        expect(b.absentDates.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 5)).toBe(true);
    });

    it('skipFridays + day_off يجتمعان بلا ازدواجية ولا تسريب', async () => {
        const { detail } = await computeMonthDeductions(MONTH, { skipFridays: true });
        expect(detail.find((d) => d.employeeId === 11).absentDays).toBe(countAbsent({ skipFridays: true, dayOff: 3 }));
        expect(detail.find((d) => d.employeeId === 12).absentDays).toBe(countAbsent({ skipFridays: true, dayOff: 5 }));
    });

    it('الالتحاق في منتصف الشهر: أيام قبل joinDate لا تُحسب غيابًا', async () => {
        const { detail } = await computeMonthDeductions(MONTH, { skipFridays: false });
        const c = detail.find((d) => d.employeeId === 13);
        expect(c.absentDays).toBe(countAbsent({ joinDate: '2026-09-20' }));
        expect(c.absentDates.every((d) => d >= '2026-09-20')).toBe(true);
    });

    it('day_off من تاريخ السريان (087) يتقدّم على عمود البطاقة', async () => {
        api.reset({
            employees: EMPS,
            historyRows: [
                { employee_id: 11, shift_start: '08:00', shift_karim: 8, day_off: 4, effective_from: '2026-09-01' },
            ],
        });
        const { detail } = await computeMonthDeductions(MONTH, { skipFridays: false });
        const a = detail.find((d) => d.employeeId === 11);
        // التاريخ الساري يقول: الراحة الخميس — الأربعاء تُحسب غيابًا ولا تُعفى
        expect(a.absentDays).toBe(countAbsent({ dayOff: 4 }));
        expect(a.absentDates.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 4)).toBe(true);
        expect(a.absentDates.some((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 3)).toBe(true);
    });

    it('تاريخ سريان لاحق للشهر لا يُطبَّق على أيامه (الماضي محفوظ)', async () => {
        api.reset({
            employees: EMPS,
            historyRows: [
                { employee_id: 11, shift_start: '08:00', shift_karim: 8, day_off: 4, effective_from: '2026-10-01' },
            ],
        });
        const { detail } = await computeMonthDeductions(MONTH, { skipFridays: false });
        const a = detail.find((d) => d.employeeId === 11);
        // سريان أكتوبر لا يسري في سبتمبر — تعود البطاقة (الأربعاء)
        expect(a.absentDays).toBe(countAbsent({ dayOff: 3 }));
    });
});
