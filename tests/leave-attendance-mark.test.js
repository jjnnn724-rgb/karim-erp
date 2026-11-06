'use strict';
/**
 * leave-attendance-mark.test.js — حارس «الإجازة تُصلح الدفتر» (قرار المالك 2026-11-02)
 * ═══════════════════════════════════════════════════════════════════════
 * واقعة الاستحضار: ريان عادل (emp 17) يوم 2026-11-01 — بصمة دخول حقيقية 04:30
 * وانصرافٌ مختلق 16:19 (pattern:709m) فقفلت الشاشة يوم راحته الأسبوعية على
 * «مداوم» بتأخير 30 دقيقة. السببان الجذريان مثبّتان هنا:
 *   1) اعتماد الإجازة لم يكن يلمس جدول attendance خالصًا.
 *   2) الكشف الشهري كان يعدّ أي صف له دخول «حاضرًا» حتى لو on_leave=true.
 * لا قاعدة بيانات معلقة هنا — استنتاج منطقي + عقد مصدر.
 */
const fs = require('fs');
const path = require('path');
const { syncLeaveMarks, computeLate } = require('../backend/leave-attendance-mark');
const { buildMonthlyAttendanceSummaryQuery } = require('../backend/monthly-attendance-query');

const BACKEND = path.join(__dirname, '..', 'backend');

function fakeClient({ rows, approvedByDate }) {
    const calls = [];
    return {
        calls,
        async query(sql, params) {
            calls.push({ sql: String(sql), params });
            const s = String(sql);
            if (s.includes('FROM attendance a JOIN employees e')) {return { rows };}
            if (s.includes(`FROM "leaveRequests"`) && s.includes(`status = 'approved'`)) {
                return { rows: approvedByDate.includes(params[1]) ? [1] : [] };
            }
            if (s.includes('SELECT "checkInAt", "checkOutAt" FROM attendance WHERE id')) {return { rows: [] };}
            if (s.startsWith('UPDATE attendance')) {return { rowCount: 1, rows: [] };}
            return { rows: [] };
        },
    };
}

describe('syncLeaveMarks — الاعتماد الراجع يعدّل صفوف الحضور', () => {
    const DAY = '2026-11-01';
    const leaveRow = {
        id: 1793496638873779, date: DAY, checkInAt: new Date('2026-11-01T01:30:13Z'),
        was_on_leave: false, shift_start: '04:00',
    };

    test('يوم معتمد داخل المدى: on_leave=true والساعات والتأخير والانصراف المبكر تُصفَّر', async () => {
        const c = fakeClient({ rows: [leaveRow], approvedByDate: [DAY] });
        const out = await syncLeaveMarks({ employeeId: 17, startDate: DAY, endDate: DAY, client: c });
        expect(out.updated).toBe(1);
        const upd = c.calls.find(x => x.sql.startsWith('UPDATE attendance'));
        expect(upd.params).toEqual([1793496638873779, true, null, false, false]);
    });

    test('مُعمّى مسبقًا ⇒ لا كتابة (idempotent — إعادة الاعتماد لا تُكرّر الأثر)', async () => {
        const c = fakeClient({ rows: [{ ...leaveRow, was_on_leave: true }], approvedByDate: [DAY] });
        const out = await syncLeaveMarks({ employeeId: 17, startDate: DAY, endDate: DAY, client: c });
        expect(out.updated).toBe(0);
        expect(c.calls.some(x => x.sql.startsWith('UPDATE attendance'))).toBe(false);
    });

    test('بلا غطاء معتمد ⇒ يُردّ اليوم لحالته ولا يُختلق له انصراف', async () => {
        const c = fakeClient({ rows: [{ ...leaveRow, was_on_leave: true }], approvedByDate: [] });
        const out = await syncLeaveMarks({ employeeId: 17, startDate: DAY, endDate: DAY, client: c });
        expect(out.updated).toBe(1);
        const upd = c.calls.find(x => x.sql.startsWith('UPDATE attendance'));
        expect(upd.params[1]).toBe(false);      // on_leave
        expect(upd.params[2]).toBeNull();       // لا دقائق بلا بصمتين حقيقيتين
        expect(upd.sql).not.toMatch(/checkout_inferred\s*=\s*true/);
    });

    test('args غير صالحة ⇒ صفر كتابة بلا استثناء (بوابة تعتمد عليها في المعاملة)', async () => {
        const c = fakeClient({ rows: [], approvedByDate: [] });
        for (const bad of [
            { employeeId: 'x', startDate: DAY, endDate: DAY },
            { employeeId: 17, startDate: '2026-11-1', endDate: DAY },
            { employeeId: 17, startDate: DAY, endDate: 'garbage' },
        ]) {
            expect(await syncLeaveMarks({ ...bad, client: c })).toEqual({ updated: 0, rows: [], skipped: 'invalid-args' });
        }
        expect(c.calls.length).toBe(0);
    });

    test('المدى المتعدد: كل يوم يُحاكم بغطائه المستقل', async () => {
        const rows = [
            { id: 1, date: '2026-11-01', checkInAt: null, was_on_leave: false, shift_start: '04:00' },
            { id: 2, date: '2026-11-02', checkInAt: null, was_on_leave: false, shift_start: '04:00' },
        ];
        const c = fakeClient({ rows, approvedByDate: ['2026-11-01'] });
        const out = await syncLeaveMarks({ employeeId: 17, startDate: '2026-11-01', endDate: '2026-11-02', client: c });
        expect(out.updated).toBe(1);
        expect(out.rows[0].date).toBe('2026-11-01');
    });
});

describe('computeLate — بلا سماح على توقيت البصمة المحلي (قرار المالك 2026-11-02)', () => {
    test('04:30 المحلي مقابل وردية 04:00 ⇒ 30 دقيقة ⇒ متأخر', () => {
        expect(computeLate(new Date('2026-11-01T01:30:13Z'), '04:00')).toBe(true);
    });
    test('04:10 المحلي مقابل وردية 04:00 ⇒ 10 دقائق تُحسب كاملة ⇒ متأخر', () => {
        expect(computeLate(new Date('2026-11-01T01:10:00Z'), '04:00')).toBe(true);
    });
    test('بلا وردية صالحة أو بلا بصمة ⇒ null لا false كاذبة', () => {
        expect(computeLate(null, '04:00')).toBeNull();
        expect(computeLate(new Date('2026-11-01T01:30:13Z'), '')).toBeNull();
    });
});

describe('عقد المصدر: لا اختلاق ولا حضور مجّاني', () => {
    const engine = fs.readFileSync(path.join(BACKEND, 'attendance-engine.js'), 'utf8');
    const workflow = fs.readFileSync(path.join(BACKEND, 'leave-workflow-routes.js'), 'utf8');

    test('مسار البصمة (processPunch) لا يختلق انصرافًا ولا دخولًا', () => {
        const start = engine.indexOf('async processPunch(');
        const end = engine.indexOf('const engine = new AttendanceEngine();');
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const body = engine.slice(start, end);
        expect(body).not.toMatch(/checkout_inferred\s*=\s*true/);
        expect(body).not.toMatch(/checkin_inferred\s*=\s*true/);
        // كل لحظة مكتوبة تأتي من بصمة: لا ساعة سيرفر تُدرج في الصف
        expect(body).not.toMatch(/NOW\(\)|CURRENT_TIMESTAMP/);
        expect(body).toMatch(/filter\(Boolean\)/); // أطراف من البصمات المحفوظة + هذه البصمة
    });
    test('الاختلاق محذوف من الجذور: لا inventionAllowed ولا بوابة استثناء (قرار 2026-11-05)', () => {
        expect(engine).not.toMatch(/inventionAllowed/);
        expect(engine).not.toMatch(/checkout_inferred\s*=\s*true/);
        expect(engine).not.toMatch(/ATTENDANCE_INVENT_MISSING_EXIT/);
        expect(engine).toContain('لا يُخترع انصراف ولا حضور من فراغ');
    });
    test('مسار الاعتماد يزامن attendance ولا يكتفي بتغيير حالة الطلب', () => {
        expect(workflow).toMatch(/syncLeaveMarks\(/);
        expect(workflow).toMatch(/startDate:\s*leave\.startDate/);
    });
    test('الكشف الشهري يستثني أيام الإجازة من الحضور والانصراف والتأخير', () => {
        const q = buildMonthlyAttendanceSummaryQuery();
        expect(q).toMatch(/COUNT\(a\."checkIn"\) FILTER \(WHERE NOT COALESCE\(a\.on_leave, false\)\)::int AS present/);
        expect(q).toMatch(/COUNT\(a\."checkOut"\) FILTER \(WHERE NOT COALESCE\(a\.on_leave, false\)\)::int AS complete/);
        expect(q).toMatch(/COUNT\(\*\) FILTER \(WHERE a\.late AND NOT COALESCE\(a\.on_leave, false\)\)::int AS late/);
        // «أيام» تبقى أثرًا تقويميًا (الشاشة تعرض leave_days بجانبها) — ما تتحولش غيابًا
        expect(q).toMatch(/COUNT\(a\.id\)::int AS days/);
    });
});
