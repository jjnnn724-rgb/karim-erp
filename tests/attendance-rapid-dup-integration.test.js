'use strict';
/**
 * تكامل حارس التكرار العام: السجل الخام يُكتب قبل المحرك (كما في مزامنة
 * الجهاز)، وبصمة مكررة في نفس الاتجاه لا تُقلب أطراف اليوم ولا تفتح وردية.
 */
const { pool } = require('../backend/shared-pool');
const { engine, instantToWall } = require('../backend/attendance-engine');

const ID = 900000077;

async function rawLog(instant, punchState) {
    await pool.query(
        `INSERT INTO attendance_logs
            ("deviceId", "deviceUserId", "employeeId", "attendanceTime", "verifyType", "punchState", source)
         VALUES (1, $1::text, $2::bigint, $3, 1, $4, 'device')
         ON CONFLICT ("deviceId", "deviceUserId", "attendanceTime") DO NOTHING`,
        [String(ID), ID, instant, punchState]
    );
}
async function punch(isoUtc, punchState) {
    const instant = new Date(isoUtc);
    await rawLog(instant, punchState);
    return engine.processPunch({
        employeeId: ID, instant, wall: instantToWall(instant),
        device: { id: 1, name: 'بصمه العمل' }, source: 'device',
    });
}
async function rowOf(date) {
    const { rows } = await pool.query('SELECT * FROM attendance WHERE "employeeId"=$1 AND date=$2', [ID, date]);
    return rows[0] || null;
}
async function rowCount() {
    const { rows } = await pool.query('SELECT count(*)::int n FROM attendance WHERE "employeeId"=$1', [ID]);
    return rows[0].n;
}

beforeAll(async () => {
    await pool.query(
        `INSERT INTO employees (id, name, "employeeId", shift_start, shift_karim, status)
         VALUES ($1, 'Probe — حارس التكرار العام', 'PROBE-RAPID', '13:00', 10, 'active')
         ON CONFLICT (id) DO NOTHING`, [ID]);
    await pool.query('DELETE FROM attendance WHERE "employeeId"=$1', [ID]).catch(() => {});
    await pool.query('DELETE FROM attendance_logs WHERE "employeeId"=$1', [ID]).catch(() => {});

    const inAt = '2026-11-23T10:04:39.000Z'; // 13:04 دخول
    const outAt = '2026-11-23T22:10:53.000Z'; // 01:10 انصراف
    await punch(inAt, 0);
    await punch(outAt, 1);
});

afterAll(async () => {
    await pool.query('DELETE FROM attendance WHERE "employeeId"=$1', [ID]).catch(() => {});
    await pool.query('DELETE FROM attendance_logs WHERE "employeeId"=$1', [ID]).catch(() => {});
});

describe('حارس التكرار العام — تكامل كامل', () => {
    test('يوم 23 مكتمل: دخول 13:04 وانصراف 01:10', async () => {
        const r = await rowOf('2026-11-23');
        expect(r).not.toBeNull();
        expect(r.checkInAt.toISOString()).toBe('2026-11-23T10:04:39.000Z');
        expect(r.checkOutAt.toISOString()).toBe('2026-11-23T22:10:53.000Z');
        expect(await rowCount()).toBe(1);
    });

    test('انصراف مكرر بعد 3.5 دقائق: تكرار لا يفتح وردية يوم جديد', async () => {
        const before = await rowOf('2026-11-23');
        const dup = await punch('2026-11-23T22:14:22.000Z', 1); // +3.5د — ضغطة مكررة
        expect(dup.changed).toBe(false);
        expect(dup.status).toBe('duplicate_punch');
        expect(dup.action).toBe('check_out');
        expect(await rowCount()).toBe(1); // لا صف لـ 24
        const after = await rowOf('2026-11-23');
        expect(after.checkOutAt.toISOString()).toBe(before.checkOutAt.toISOString());
    });

    test('بصمة بالاتجاه المعاكس بعد ثوانٍ تُطبَّق (لا نافذة تبريد)', async () => {
        const next = await punch('2026-11-23T22:15:30.000Z', 0); // 01:15 — غير اتجاه الانصراف
        expect(next.changed).toBe(true);
        expect(next.status).not.toBe('duplicate_punch');
    });
});
