/**
 * attendance-lone-checkout.test.js — الانصراف اليتيم بعد منتصف الليل
 * ─────────────────────────────────────────────────────────────────────
 * درس 2026-10-14: بصمة 01:03 كُتبت خروجًا لسطر يوم جديد لا دخول له، ف (أ) فقدت
 * وردية الأمس ختامها الحقيقي، و(ب) رُفض دخول النهار 12:56 بحجة «دخول بعد انصراف».
 * المحرك الآن: ينقل الانصراف اليتيم لسطر الأمس ثم يسجّل الدخول.
 */
'use strict';

const { engine } = require('../backend/attendance-engine');

const RIYADH_OFFSET = 3 * 3600000;
const at = (dateStr, time) => {
    const [h, m] = time.split(':').map(Number);
    return new Date(`${dateStr}T00:00:00.000Z`).getTime() + (h * 3600 + m * 60) * 1000 - RIYADH_OFFSET;
};

/** عميل SQL وهمي: يردّ على الاستعلامات بالمحدَّدة له ويسجّل كل كتابة */
function fakeClient(responses) {
    const writes = [];
    const reads = [];
    return {
        writes,
        reads,
        async query(sql, params) {
            const isWrite = /^\s*(INSERT|UPDATE|DELETE)/i.test(sql);
            if (isWrite) {writes.push({ sql: sql.trim().split('\n')[0], params });}
            else {reads.push(sql);}
            for (const [match, rows] of responses) {
                if (sql.includes(match)) {return { rows: typeof rows === 'function' ? rows(params) : rows };}
            }
            return { rows: [] };
        },
    };
}

const wallOf = (dateStr, time) => ({ date: dateStr, time, hour: Number(time.slice(0, 2)), minute: Number(time.slice(3, 5)) });

describe('relocateLoneCheckout — انصراف الفجر يعود لوردية الأمس', () => {
    const row = { id: 100, checkIn: null, checkOut: '01:03', checkOutAt: new Date(at('2026-10-14', '01:03')) };

    it('أمس مفتوح أو منصرف استنتاجًا → الانصراف يُنقل ويُخلى السطر الحالي', async () => {
        const c = fakeClient([
            ['FROM attendance WHERE "employeeId" = $1 AND date = $2 LIMIT 1 FOR UPDATE',
                [{ id: 99, checkIn: '12:50', checkInAt: new Date(at('2026-10-13', '12:50')), checkOut: '00:48', checkout_inferred: true }]],
        ]);
        const moved = await engine.relocateLoneCheckout({
            client: c, employeeId: 7, row, checkOutAt: new Date(row.checkOutAt), shiftDate: '2026-10-14',
        });
        expect(moved).toBe(true);
        expect(c.writes).toHaveLength(2);
        expect(c.writes[0].params).toEqual([99, '01:03', row.checkOutAt, 733]);
        expect(String(c.writes[0].sql)).toContain('SET "checkOut" = $2');
        expect(c.writes[1].params).toEqual([100]);
    });

    it('أمس مقفول ببصمة حقيقية → لا نقل (البصمة تبقى حيث هي)', async () => {
        const c = fakeClient([
            ['FROM attendance WHERE "employeeId" = $1 AND date = $2 LIMIT 1 FOR UPDATE',
                [{ id: 99, checkIn: '12:50', checkInAt: new Date(at('2026-10-13', '12:50')), checkOut: '23:58', checkout_inferred: false }]],
        ]);
        const moved = await engine.relocateLoneCheckout({
            client: c, employeeId: 7, row, checkOutAt: new Date(row.checkOutAt), shiftDate: '2026-10-14',
        });
        expect(moved).toBe(false);
        expect(c.writes).toHaveLength(0);
    });

    it('لا صف أمس → لا نقل', async () => {
        const c = fakeClient([]);
        const moved = await engine.relocateLoneCheckout({
            client: c, employeeId: 7, row, checkOutAt: new Date(row.checkOutAt), shiftDate: '2026-10-14',
        });
        expect(moved).toBe(false);
    });
});

describe('handleCheckOut — بصمة الفجر تُصلح انصراف الأمس المستنتَج', () => {
    const base = {
        employeeId: 7, shiftStart: '04:00', shiftKarim: 12, source: 'device',
        device: { name: 'بصمه العمل' }, onLeave: false, verdict: { action: 'out' }, punchState: 1,
    };

    it('لا صف مفتوح، أمس منصرف استنتاجًا → الختام الحقيقي يُكتب له ولا صفحة يتيمة', async () => {
        const instant = new Date(at('2026-10-14', '01:03'));
        const prev = { id: 99, checkIn: '12:50', checkInAt: new Date(at('2026-10-13', '12:50')),
            checkOut: '00:48', checkOutAt: new Date(at('2026-10-14', '00:48')), checkout_inferred: true };
        const c = fakeClient([
            ['"checkOut" IS NULL AND date IN ($2, $3)', []],
            ['date = $2 AND checkout_inferred = true', (params) => (params[1] === '2026-10-13' ? [prev] : [])],
            ['UPDATE attendance SET "checkOut" = $2, "checkOutAt" = $3, "workMinutes" = $4, checkout_inferred = false', [{ id: 99, checkOut: '01:03' }]],
        ]);
        const r = await engine.handleCheckOut({ ...base, client: c, shiftDate: '2026-10-14', wall: wallOf('2026-10-14', '01:03'), instant });
        expect(r.action).toBe('check_out');
        expect(c.writes).toHaveLength(1);
        expect(c.writes[0].params[0]).toBe(99);
        expect(c.writes[0].params[3]).toBe(733);
    });

    it('انصراف بعيد عن نافذة انصراف الأمس ±6 ساعات → لا يُنسب له', async () => {
        const c = fakeClient([
            ['"checkOut" IS NULL AND date IN ($2, $3)', []],
            ['date = $2 AND checkout_inferred = true', (params) => (params[1] === '2026-10-13'
                ? [{ id: 99, checkIn: '12:50', checkInAt: new Date(at('2026-10-13', '12:50')),
                    checkOut: '13:00', checkOutAt: new Date(at('2026-10-13', '13:00')), checkout_inferred: true }] : [])],
            ['INSERT INTO attendance', [{ id: 1 }]],
        ]);
        const r = await engine.handleCheckOut({ ...base, client: c, shiftDate: '2026-10-14',
            wall: wallOf('2026-10-14', '01:03'), instant: new Date(at('2026-10-14', '01:03')) });
        expect(r.action).toBe('check_out');
        expect(String(c.writes[0].sql)).toContain('INSERT INTO attendance');
    });
});

describe('handleCheckIn — الانصراف اليتيم لم يعد يسدّ باب دخول النهار', () => {
    const base = {
        employeeId: 7, shiftStart: '04:00', shiftKarim: 12, autoLock: false, source: 'device',
        device: { name: 'بصمه العمل' }, onLeave: false, verdict: { action: 'in' },
    };

    it('سطر بلا دخول وانصرافه أسبق البصمة → يُنقل للأمس ويسجّل الدخول', async () => {
        const instant = new Date(at('2026-10-14', '12:56'));
        const c = fakeClient([
            ['SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2 FOR UPDATE',
                [{ id: 100, checkIn: null, checkin_inferred: false, checkOut: '01:03',
                    checkOutAt: new Date(at('2026-10-14', '01:03')), workMinutes: null }]],
            ['AND date = $2 AND checkout_inferred = true', []],
            ['FROM attendance WHERE "employeeId" = $1 AND date = $2 LIMIT 1 FOR UPDATE',
                [{ id: 99, checkIn: '12:50', checkInAt: new Date(at('2026-10-13', '12:50')),
                    checkOut: '00:48', checkout_inferred: true }]],
            ['UPDATE attendance SET "checkIn" = $2', [{ id: 100, checkIn: '12:56' }]],
        ]);
        const r = await engine.handleCheckIn({ ...base, client: c, shiftDate: '2026-10-14', wall: wallOf('2026-10-14', '12:56'), instant });
        expect(r.action).toBe('check_in');
        const closed = c.writes.find((w) => w.params[0] === 99);
        expect(closed.params[1]).toBe('01:03');
        expect(String(closed.sql)).toContain('SET "checkOut" = $2');
    });

    it('سطر بلا دخول وانصراف لا يجد صفًا يُغلقه → الانصراف يُمسح والدخول يسجّل', async () => {
        const instant = new Date(at('2026-10-14', '12:30'));
        const c = fakeClient([
            ['SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2 FOR UPDATE',
                [{ id: 100, checkIn: null, checkin_inferred: false, checkOut: '00:03',
                    checkOutAt: new Date(at('2026-10-14', '00:03')), workMinutes: null }]],
            ['FROM attendance WHERE "employeeId" = $1 AND date = $2 LIMIT 1 FOR UPDATE', []],
            ['UPDATE attendance SET "checkOut" = NULL', [{ id: 100, checkOut: null }]],
            ['UPDATE attendance SET "checkIn" = $2', [{ id: 100, checkIn: '12:30' }]],
        ]);
        const r = await engine.handleCheckIn({ ...base, client: c, shiftDate: '2026-10-14', wall: wallOf('2026-10-14', '12:30'), instant });
        expect(r.action).toBe('check_in');
    });

    it('دخول بعد انصراف حقيقي لسطر له دخول → ما زال مرفوضًا (السلوك القديم)', async () => {
        const c = fakeClient([
            ['SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2 FOR UPDATE',
                [{ id: 100, checkIn: '09:00', checkin_inferred: false, checkOut: '17:00',
                    checkOutAt: new Date(at('2026-10-14', '17:00')) }]],
        ]);
        const r = await engine.handleCheckIn({ ...base, client: c, shiftDate: '2026-10-14',
            wall: wallOf('2026-10-14', '18:00'), instant: new Date(at('2026-10-14', '18:00')) });
        expect(r.action).toBeNull();
        expect(c.writes).toHaveLength(0);
    });
});

describe('handleCheckOut 4 — الدخول المسترد لا يستهلك ختام الأمس', () => {
    // درس 12/10 لمازن (17:00+12h): انصراف 06:14 قُفل به سطر 11/10 ثم التقطته
    // «استعادة الدخول» كدخولٍ لسطر 12/10 → سطر يبدأ بانصراف أمه بدقائق 24 ساعة.
    const base = {
        employeeId: 8, shiftStart: '17:00', shiftKarim: 12, autoLock: false, source: 'device',
        device: { name: 'بصمه العمل' }, onLeave: false, verdict: { action: 'out' }, punchState: 0,
    };

    it('البحث عن الدخول يستبعد كل بصمة مرسةً لدخول أو انصراف في أي سطر', async () => {
        const c = fakeClient([['FROM attendance_logs', []], ['"checkIn" IS NULL AND "checkOut" IS NULL', [{ id: 5 }]]]);
        await engine.handleCheckOut({ ...base, client: c, shiftDate: '2026-10-12',
            wall: wallOf('2026-10-12', '05:09'), instant: new Date(at('2026-10-12', '05:09')) });
        const logsSql = c.reads.find((s) => s.includes('FROM attendance_logs'));
        expect(logsSql).toContain('NOT EXISTS');
        expect(logsSql).toContain('a."checkOutAt" - l."attendanceTime"');
    });

    it('لا بصمة غير مستهلكة → السطر يُكتب بانصراف فقط وبملاحظة «دخول مفقود»', async () => {
        const c = fakeClient([
            ['FROM attendance_logs', []],
            ['"checkIn" IS NULL AND "checkOut" IS NULL', [{ id: 5 }]],
            ['UPDATE attendance SET "checkIn" = COALESCE', [{ id: 5 }]],
        ]);
        const r = await engine.handleCheckOut({ ...base, client: c, shiftDate: '2026-10-12',
            wall: wallOf('2026-10-12', '05:09'), instant: new Date(at('2026-10-12', '05:09')) });
        expect(r.action).toBe('check_out');
        expect(c.writes[0].params[1]).toBeNull();      // recoveredCheckIn
        expect(c.writes[0].params[8]).toBeNull();      // recoveredMinutes
        expect(c.writes[0].params[10]).toContain('دخول مفقود');
    });

    it('بصمة دخول غير مستهلكة موجودة → تُسترد وتُحسب الدقائق منها', async () => {
        const c = fakeClient([
            ['FROM attendance_logs', [{ attendanceTime: new Date(at('2026-10-12', '04:55')), punchState: 1 }]],
            ['"checkIn" IS NULL AND "checkOut" IS NULL', [{ id: 5 }]],
            ['UPDATE attendance SET "checkIn" = COALESCE', [{ id: 5 }]],
        ]);
        await engine.handleCheckOut({ ...base, client: c, shiftDate: '2026-10-12',
            wall: wallOf('2026-10-12', '05:09'), instant: new Date(at('2026-10-12', '05:09')) });
        expect(c.writes[0].params[1]).toBe('04:55');
        expect(c.writes[0].params[8]).toBe(14);
        expect(c.writes[0].params[10]).toContain('دخول مسترد');
    });
});
