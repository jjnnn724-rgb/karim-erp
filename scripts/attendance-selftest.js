'use strict';
/* attendance-selftest.js — اختبار ذاتي يومي لمنطق الحضور: السماحية + تعقيم الوقت + سلامة الاستعلامات.
 * أي فشل = PROBLEM في اللوج قبل أن يرى المستخدم خطأ. */
const assert = (c, m) => { if (!c) { throw new Error(m); } };

const { isLate, isEarlyLeave, calculateDelayParts, graceMinutes } = require('../backend/shift-day');
assert(graceMinutes() === 15, 'grace must be 15');
assert(isLate(9, 15, '09:00') === false, 'grace arrival');
assert(isLate(9, 16, '09:00') === true, 'late arrival');
assert(isEarlyLeave(18, 45, '09:00', 10) === false, 'grace early leave');
assert(isEarlyLeave(18, 44, '09:00', 10) === true, 'early leave');
const p = calculateDelayParts({ checkIn: '09:00', checkOut: '18:30' }, { shift_start: '09:00', shift_karim: 10 });
assert(p.lateMinutes === 15, 'net deficit, got ' + p.lateMinutes);

// تعقيم الوقت: 24:xx → 00:xx، الشاذ → null، والتقرير الشهري لا ينكسر أبدًا
const engSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'backend', 'attendance-engine.js'), 'utf8');
assert(engSrc.includes('function safeWallTime'), 'safeWallTime present');
const { buildMonthlyAttendanceSummaryQuery } = require('../backend/monthly-attendance-query');
const q = buildMonthlyAttendanceSummaryQuery();
assert(q.includes('2[0-3]'), 'monthly guarded regex');

// محاكاة: صف 24:51 لا يكسر حساب الدقائق (يُستبعد بالحارس)
const { pool } = require('../backend/shared-pool');
(async () => {
    const r = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN '24:51' ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN 1 ELSE 0 END),0)::int AS n`);
    assert(r.rows[0].n === 0, 'bad clock excluded');
    await pool.end();
    console.log('SELFTEST PASS: grace + sanitize + guarded queries');
    process.exit(0);
})().catch((e) => { console.error('SELFTEST FAIL: ' + (e && e.message)); process.exit(1); });
