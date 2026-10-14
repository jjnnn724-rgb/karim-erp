/**
 * attendance-reconcile-double-use.test.js — المطابقة لا تسرق بصمة مستعملة
 * ────────────────────────────────────────────────────────────────────────
 * درس 2026-10-14: بعد ترميم سطر مازن (12/10) أُخلي دخوله المسروق، ثم أعادت
 * «المطابقة» حالة (أ) تعبئته من جديد: بصمة 06:14 هي انصراف سطر 11/10 المسجّل،
 * واختيارها «دخولًا» لسطر 12/10 يصنع استخدامًا مزدوجًا ووردية 23 ساعة.
 * القاعدة: الدخول لا يُستَرد من بصمة يستعملها سطر آخر (≤ 60 ثانية).
 * مسار الانصراف يبقى كما هو (الترميم هناك يكون في جهة النقل لا المنع).
 */
'use strict';

jest.mock('../backend/shared-pool', () => {
    const writes = [];
    const api = {
        writes,
        responder: null,
        reset() { writes.length = 0; api.responder = null; },
    };
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
    const query = async (sql, params) => {
        if (/^\s*(UPDATE|INSERT|DELETE)/i.test(String(sql))) {
            writes.push({ sql: norm(sql), params });
            return { rows: [] };
        }
        return api.responder ? api.responder(norm(sql)) : { rows: [] };
    };
    const client = { query, release: () => {} };
    return {
        __esModule: true,
        pool: { query, connect: async () => client, end: async () => {} },
        safeQuery: query,
        reinitPool: async () => {},
        __api: api,
    };
});

const { engine } = require('../backend/attendance-engine');
const { __api: api } = require('../backend/shared-pool');

const RIYADH = 3 * 3600000;
const at = (dateStr, time) => {
    const [h, m] = time.split(':').map(Number);
    return new Date(`${dateStr}T00:00:00.000Z`).getTime() + (h * 3600 + m * 60) * 1000 - RIYADH;
};
const dPlus = (days) => {
    const d = new Date(Date.now() + RIYADH + days * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
const rowWritesTo = (id) => api.writes.filter((w) => w.params && Number(w.params[0]) === id);
const entryWrite = (id) => api.writes.find((w) => /SET "checkIn" = \$2/.test(w.sql) && Number(w.params[0]) === id);

const SHIFT = {
    id: 7, name: 'مازن', deviceUserId: '77', deviceUserIdAlt: null,
    employeeId: 'EMP-077', shift_start: '17:00', shift_karim: 12, auto_checkout: false, auto_lock: false,
};
const PREV = dPlus(-2);
const CUR = dPlus(-1);
const TODAY = dPlus(0);
const STOLEN = new Date(at(CUR, '06:14'));

const baseRows = () => ([
    {
        id: 101, employeeId: 7, date: PREV, checkIn: '17:00', checkInAt: new Date(at(PREV, '17:00')),
        checkOut: '06:14', checkOutAt: STOLEN, workMinutes: 794,
        checkin_inferred: false, checkout_inferred: false, late: false, early_leave: false, notes: '',
    },
    {
        id: 102, employeeId: 7, date: CUR, checkIn: null, checkInAt: null,
        checkOut: '05:09', checkOutAt: new Date(at(TODAY, '05:09')), workMinutes: null,
        checkin_inferred: false, checkout_inferred: false, late: false, early_leave: false,
        notes: 'دخول مفقود — تسجيل انصراف عبر device',
    },
]);
const baseLogs = () => ([
    { deviceUserId: '77', attendanceTime: new Date(at(PREV, '17:00')), punchState: 0 },
    { deviceUserId: '77', attendanceTime: STOLEN, punchState: 1 },
    { deviceUserId: '77', attendanceTime: new Date(at(TODAY, '05:09')), punchState: 1 },
]);

function wire({ rows, logs }) {
    api.reset();
    api.responder = (sql) => {
        if (sql.includes('FROM attendance WHERE date >= $1')) return { rows: rows() };
        if (sql.includes('attendance_logs WHERE "employeeId" IS NULL')) return { rows: [] };
        if (sql.includes('FROM attendance_logs')) return { rows: logs() };
        if (sql.includes('FROM employees')) return { rows: [SHIFT] };
        return { rows: [] };
    };
}

describe('reconcileAttendance — حالة (أ): الدخول لا يُستَرد من بصمة يستعملها سطر آخر', () => {
    it('بصمة 06:14 مستعملة كانصراف لسطر الأمس ⇒ لا تُكتب دخولًا لسطر اليوم', async () => {
        wire({ rows: baseRows, logs: baseLogs });
        const res = await engine.reconcileAttendance({ sinceDays: 30 });
        expect(entryWrite(102)).toBeUndefined();
        expect(rowWritesTo(102)).toHaveLength(0);
        expect(res.fixedRows).toBe(0);
    });

    it('صفر بصمة ⇒ لا كتابة ولا تأليف', async () => {
        wire({ rows: baseRows, logs: () => [] });
        const res = await engine.reconcileAttendance({ sinceDays: 30 });
        expect(res.fixedRows).toBe(0);
        expect(api.writes).toHaveLength(0);
    });

    it('بصمة دخول غير مستعملة في نفس اليوم ⇒ تُستَرد كالمعتاد (الحرس لا يعطّل الترميم)', async () => {
        const free = new Date(at(CUR, '17:05'));
        wire({
            rows: baseRows,
            // 06:14 مضغوطة بزر «دخول» (حالة 0) — هي مع ذلك انصراف سطر الأمس المسجّل
            logs: () => ([
                { deviceUserId: '77', attendanceTime: new Date(at(PREV, '17:00')), punchState: 0 },
                { deviceUserId: '77', attendanceTime: STOLEN, punchState: 0 },
                { deviceUserId: '77', attendanceTime: free, punchState: 0 },
                { deviceUserId: '77', attendanceTime: new Date(at(TODAY, '05:09')), punchState: 1 },
            ]),
        });
        await engine.reconcileAttendance({ sinceDays: 30 });
        const w = entryWrite(102);
        expect(w).toBeDefined();
        expect(w.params[1]).toBe('17:05');
        expect(new Date(w.params[2]).getTime()).toBe(free.getTime());
    });

    it('سطر بدخول مستنتَج: الترقية تستخدم البصمة الحرة لا المستعملة', async () => {
        const free = new Date(at(CUR, '17:05'));
        wire({
            rows: () => { const r = baseRows(); r[1].checkIn = '06:14'; r[1].checkInAt = STOLEN; r[1].checkin_inferred = true; return r; },
            logs: () => ([
                { deviceUserId: '77', attendanceTime: new Date(at(PREV, '17:00')), punchState: 0 },
                { deviceUserId: '77', attendanceTime: STOLEN, punchState: 0 },
                { deviceUserId: '77', attendanceTime: free, punchState: 0 },
                { deviceUserId: '77', attendanceTime: new Date(at(TODAY, '05:09')), punchState: 1 },
            ]),
        });
        await engine.reconcileAttendance({ sinceDays: 30 });
        const w = api.writes.find((x) => /ترقية لحقيقي/.test(x.sql) && Number(x.params[0]) === 102);
        expect(w).toBeDefined();
        expect(w.params[1]).toBe('17:05');
    });

    it('بصمة خروج السطر نفسه بحالة «دخول» على الجهاز ⇒ لا تُقرَن بدخوله (يوم بصفر دقيقة)', async () => {
        wire({
            rows: baseRows,
            // 05:09 هي انصراف سطر 12/10 المسجّل، لكن الجهاز وسَمَها بحالة دخول (0):
            // بلا حرس الاقتران الذاتي تصبح «دخولًا» للسطر نفسه ⇒ 05:09→05:09 و 0 دقيقة.
            logs: () => ([
                { deviceUserId: '77', attendanceTime: new Date(at(PREV, '17:00')), punchState: 0 },
                { deviceUserId: '77', attendanceTime: STOLEN, punchState: 1 },
                { deviceUserId: '77', attendanceTime: new Date(at(TODAY, '05:09')), punchState: 0 },
            ]),
        });
        const res = await engine.reconcileAttendance({ sinceDays: 30 });
        expect(entryWrite(102)).toBeUndefined();
        expect(api.writes.some((w) => /SET "checkIn" = \$2.*WHERE id = \$1/.test(w.sql) && Number(w.params[0]) === 102)).toBe(false);
        expect(res.fixedRows).toBe(0);
    });

    it('مسار الانصراف: ترقية مستنتَج ببصمة هي دخول سطر تالٍ تبقى ممكنة (لا منع هنا)', async () => {
        const realOut = new Date(at(CUR, '04:30'));
        wire({
            rows: () => ([
                {
                    id: 201, employeeId: 7, date: PREV, checkIn: '17:00', checkInAt: new Date(at(PREV, '17:00')),
                    checkOut: '23:00', checkOutAt: new Date(at(PREV, '23:00')), workMinutes: 360,
                    checkin_inferred: false, checkout_inferred: true, late: false, early_leave: false, notes: '',
                },
                {
                    id: 202, employeeId: 7, date: CUR, checkIn: '04:30', checkInAt: realOut,
                    checkOut: '17:00', checkOutAt: new Date(at(CUR, '17:00')), workMinutes: 750,
                    checkin_inferred: false, checkout_inferred: false, late: false, early_leave: false, notes: '',
                },
            ]),
            logs: () => ([
                { deviceUserId: '77', attendanceTime: new Date(at(PREV, '17:00')), punchState: 0 },
                { deviceUserId: '77', attendanceTime: realOut, punchState: 1 },
                { deviceUserId: '77', attendanceTime: new Date(at(CUR, '17:00')), punchState: 0 },
            ]),
        });
        await engine.reconcileAttendance({ sinceDays: 30 });
        const w = rowWritesTo(201).find((x) => /checkout_inferred = \$9/.test(x.sql));
        expect(w).toBeDefined();
        expect(w.params[4]).toBe('04:30');
    });
});
