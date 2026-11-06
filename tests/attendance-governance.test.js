/**
 * attendance-governance.test.js — حوكمة الحضور: قواعد صارمة + سجلّ تدقيق
 * ═══════════════════════════════════════════════════════════════════════
 * طلب المالك: «إجراءات صارمة في الموقع والتدقيق» + «مراجعة البصمات من
 * جهاز البصمات لمقارنته بسستم البصمة».
 *
 * ما يُثبَّت هنا:
 *   1. تصحيحُ الحضور بلا سببٍ مكتوب مرفوض (قاعدة خادم، لا نصيحة واجهة).
 *   2. سببٌ قديم (نفس الملاحظة) لا يصلح سببًا لتصحيحٍ جديد.
 *   3. الحضور في فترةٍ محاسبية مغلقة لا يُعدَّل.
 *   4. كل تغييرٍ يترك سطرَ تدقيق: القيمُ قبل/بعد، ومَن غيّر، ومتى، ولماذا.
 *   5. مطابقةُ الجهاز بالنظام: بصمةٌ بلا صفٍّ تُصنَّف (فجوةٌ حقيقية أم تكرارٌ
 *      مُتجاهَل) بدل أن تُوصف كلها بـ«فقيدة».
 */
'use strict';

jest.mock('../backend/shared-pool', () => {
    const state = {
        writes: [],
        responder: null,
        reset() { state.writes.length = 0; state.responder = null; },
    };
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
    const query = async (sql, params) => {
        const s = norm(sql);
        if (/^\s*(INSERT|UPDATE|DELETE)/i.test(s)) {
            state.writes.push({ sql: s, params });
            return { rows: [] };
        }
        return state.responder ? state.responder(s, params) : { rows: [] };
    };
    const client = { query, release: () => {} };
    return {
        __esModule: true,
        pool: { query, connect: async () => client, end: async () => {} },
        safeQuery: query,
        reinitPool: async () => {},
        __api: state,
    };
});

jest.mock('../backend/accounting-periods', () => ({
    isPeriodClosed: async (period) => period === '2026-01',
}));

const gov = require('../backend/attendance-governance');
const { deviceSystemReconciliation } = require('../backend/attendance-reconciliation');
const { __api: api } = require('../backend/shared-pool');

const ROW = {
    id: 501, employeeId: 9, date: '2026-02-10', checkIn: '09:00', checkOut: '17:00',
    checkInAt: new Date('2026-02-10T06:00:00.000Z'), checkOutAt: new Date('2026-02-10T14:00:00.000Z'),
    workMinutes: 480, late: false, early_leave: false, on_leave: false,
    notes: 'حضور عبر device', source: 'device', checkin_inferred: false, checkout_inferred: false,
};

describe('حوكمة الحضور — سببٌ إجباري لكل تصحيح', () => {
    test('تعديلُ وقت الحضور بلا سببٍ مرفوض', () => {
        const v = gov.attendanceCorrectionViolation({
            action: 'update', before: ROW, after: { checkIn: '10:00' }, filtered: { checkIn: '10:00' },
        });
        expect(v).not.toBeNull();
        expect(v.status).toBe(422);
        expect(v.error).toBe('ATTENDANCE_REASON_REQUIRED');
    });

    test('التعديلُ بسببٍ مكتوب مقبول', () => {
        const v = gov.attendanceCorrectionViolation({
            action: 'update', before: ROW,
            after: { checkIn: '10:00', notes: '[تصحيح يدوي 2026-02-10 بواسطة س: خطأ في الإدخال]' },
            filtered: { checkIn: '10:00', notes: '[تصحيح يدوي 2026-02-10 بواسطة س: خطأ في الإدخال]' },
        });
        expect(v).toBeNull();
    });

    test('الملاحظةُ القديمة لا تصلح سببًا — السببُ جديدٌ كل مرة', () => {
        const v = gov.attendanceCorrectionViolation({
            action: 'update', before: ROW,
            after: { checkIn: '10:00', notes: ROW.notes },
            filtered: { checkIn: '10:00', notes: ROW.notes },
        });
        expect(v).not.toBeNull();
        expect(v.error).toBe('ATTENDANCE_REASON_REQUIRED');
    });

    test('تغييرُ الملاحظة وحده (تبديل وردية) لا يحتاج سببًا جديدًا', () => {
        const v = gov.attendanceCorrectionViolation({
            action: 'update', before: ROW,
            after: { notes: `${ROW.notes} | [تبديل وردية 2026-02-10 بواسطة س: غِياب]` },
            filtered: { notes: `${ROW.notes} | [تبديل وردية 2026-02-10 بواسطة س: غِياب]` },
        });
        expect(v).toBeNull();
    });

    test('حقلٌ لم يُرسل في الطلب ليس تغييرًا (حمولة جزئية)', () => {
        const v = gov.attendanceCorrectionViolation({
            action: 'update', before: ROW, after: { notes: 'ملاحظة جديدة' }, filtered: { notes: 'ملاحظة جديدة' },
        });
        expect(v).toBeNull();
    });

    test('الفترة المحاسبية المغلقة تُجمِّد الحضور', async () => {
        const closed = await gov.attendancePeriodViolation({ date: '2026-01-15' });
        expect(closed).not.toBeNull();
        expect(closed.status).toBe(423);
        expect(closed.error).toBe('PERIOD_LOCKED');
        const open = await gov.attendancePeriodViolation({ date: '2026-02-15' });
        expect(open).toBeNull();
    });
});

describe('حوكمة الحضور — سجلّ التدقيق', () => {
    test('كل تعديلٍ يترك سطرَ تدقيق: القيمُ قبل/بعد ومَن غيّر ولماذا', async () => {
        api.reset();
        api.responder = () => ({ rows: [] });
        await gov.recordAttendanceEdit({
            action: 'update',
            before: ROW,
            after: { ...ROW, checkIn: '10:00', notes: `${ROW.notes} | [تصحيح يدوي 2026-02-10 بواسطة س: خطأ]` },
            actor: { id: 42, name: 'سيف', role: 'manager' },
            source: 'api',
        });
        const write = api.writes.find((w) => /INSERT INTO attendance_edit_log/.test(w.sql));
        expect(write).toBeTruthy();
        const [attendanceId, employeeId, action, changes, reason, actorId, actorName, actorRole, source] = write.params;
        expect(Number(attendanceId)).toBe(501);
        expect(Number(employeeId)).toBe(9);
        expect(action).toBe('update');
        expect(JSON.parse(changes).checkIn).toEqual({ before: '09:00', after: '10:00' });
        expect(reason).toContain('تصحيح يدوي');
        expect(Number(actorId)).toBe(42);
        expect(actorName).toBe('سيف');
        expect(actorRole).toBe('manager');
        expect(source).toBe('api');
    });

    test('الحذفُ يُسجَّل بكامل محتوى الصفّ', async () => {
        api.reset();
        api.responder = () => ({ rows: [] });
        await gov.recordAttendanceEdit({
            action: 'delete', before: ROW, after: null,
            actor: { id: 7, name: 'مدير', role: 'admin' }, source: 'api', reason: 'صفٌ مكرر',
        });
        const write = api.writes.find((w) => /INSERT INTO attendance_edit_log/.test(w.sql));
        const changes = JSON.parse(write.params[3]);
        expect(changes.checkIn).toEqual({ before: '09:00', after: null });
        expect(write.params[4]).toBe('صفٌ مكرر');
        expect(write.params[2]).toBe('delete');
    });
});

describe('مطابقة بصمات الجهاز بالنظام', () => {
    /* الشكلُ الذي يعيده Postgres فعلًا: أسماءٌ مُسنَنة صراحةً (snake_case)،
       لا الأسماءُ الأصلية بأقواسها. هذا هو الفرقُ الذي أخطأ أول مرة. */
    const ROW_DB = {
        attendance_id: 501, employee_id: 9, date: '2026-02-10',
        check_in: '09:00', check_out: '17:00',
        check_in_at: new Date('2026-02-10T06:00:00.000Z'),
        check_out_at: new Date('2026-02-10T14:00:00.000Z'),
        work_minutes: 480, late: false, source: 'device', notes: 'حضور عبر device',
    };
    const punch = (id, at, employeeId, deviceUserId = '77') => ({
        log_id: id, device_id: 1, device_name: 'جهاز المدخل', device_user_id: deviceUserId,
        employee_id: employeeId, employee_name: employeeId ? 'مازن' : null,
        attendance_time: at, punch_state: 0,
    });

    /* مُجيبُ قاعدةٍ واحدٌ يخدم استعلاماتِ التقرير كلَّها — كلُّ استعلامٍ
       يُعرَّف بنمطِه لا بترتيبه (ترتيبُ النداء يتفرّع بتغيّر التقرير). */
    const reconResponder = ({
        punches = [], rows = [], coverage = '2026-01-01',
        total = null, matched = null, unmappedTotal = null,
        systemRows = null, rowsWithout = null,
    } = {}) => (sql) => {
        if (/MIN\("date"::date\)/.test(sql)) {return { rows: [{ first_row: coverage }] };}
        if (/COUNT\(\*\) FILTER/.test(sql) && /FROM attendance_logs l\b/.test(sql)) {
            return { rows: [{
                device_punches: total != null ? total : punches.length,
                matched_punches: matched != null ? matched : punches.filter((p) => p.attendance_id).length,
                unmapped_punches: unmappedTotal != null ? unmappedTotal : punches.filter((p) => p.employee_id == null).length,
            }] };
        }
        if (/COUNT\(\*\) FILTER/.test(sql) && /FROM attendance a\b/.test(sql)) {
            return { rows: [{
                system_rows: systemRows != null ? systemRows : rows.length,
                rows_without_device_punch: rowsWithout != null
                    ? rowsWithout
                    : rows.filter((r) => Number(r.device_punches || 0) === 0).length,
            }] };
        }
        if (/NOT EXISTS/.test(sql) && /FROM attendance_logs l\b/.test(sql)) {
            return { rows: punches.filter((p) => !p.attendance_id && p.employee_id != null) };
        }
        if (/GROUP BY/.test(sql) && /FROM attendance_logs l\b/.test(sql)) {return { rows: [] };}
        if (/FROM attendance_logs l\b/.test(sql) && /LEFT JOIN attendance\b/.test(sql)) {return { rows: punches };}
        if (/FROM attendance a\b/.test(sql) && /device_punches/.test(sql)) {return { rows: rows };}
        if (/FROM attendance WHERE "employeeId" = ANY/.test(sql)) {return { rows: rows };}
        if (/FROM employees WHERE id = ANY/.test(sql)) {return { rows: [] };}
        if (/FROM employee_shift_history/.test(sql)) {return { rows: [] };}
        return { rows: [] };
    };

    beforeEach(() => {
        api.reset();
    });

    test('بصمةٌ لها صفُّ حضور = مطابقة، وبصمةٌ زائدة = تكرارٌ لا فجوة', async () => {
        const matched = new Date('2026-02-10T06:00:00.000Z');
        const extra = new Date('2026-02-10T07:30:00.000Z');
        api.responder = reconResponder({
            punches: [
                {...punch(1, matched, 9), attendance_id: 501, attendance_date: '2026-02-10'},
                punch(2, extra, 9),
            ],
            rows: [{ ...ROW_DB, employee_name: 'مازن', employee_no: 'EMP-077', device_punches: 2 }],
        });
        const report = await deviceSystemReconciliation({ from: '2026-02-01', to: '2026-02-28' });
        expect(report.summary.device_punches).toBe(2);
        expect(report.summary.matched).toBe(1);
        expect(report.summary.orphan_punches).toBe(1);
        /* البصمةُ الثانية: الصفُّ الأول محفوظ — تكرارٌ مُتجاهَل لا فقدٌ. */
        expect(report.summary.real_gaps).toBe(0);
        expect(report.summary.benign_duplicates).toBe(1);
        expect(report.orphans.length).toBe(1);
        expect(report.orphans[0].log_id).toBe(2);
        expect(report.orphans[0].kind).toBe('duplicate_check_in');
        expect(report.orphans[0].gap).toBe(false);
    });

    test('بصمةٌ بلا صفٍّ ليومها = فجوةٌ حقيقية تستحقّ التدقيق', async () => {
        api.responder = reconResponder({
            punches: [punch(9, new Date('2026-03-02T08:00:00.000Z'), 9)],
            rows: [{ ...ROW_DB, device_punches: 0 }],
        });
        const report = await deviceSystemReconciliation({ from: '2026-03-01', to: '2026-03-31' });
        expect(report.summary.real_gaps).toBe(1);
        expect(report.summary.benign_duplicates).toBe(0);
        const bucket = report.classification.buckets.find((b) => b.kind === 'no_row_for_shift_day');
        expect(bucket).toBeTruthy();
        expect(bucket.gap).toBe(true);
        expect(bucket.count).toBe(1);
        expect(bucket.samples[0].log_id).toBe(9);
    });

    test('بصمةٌ بلا موظف = غير مربوطة، لا فقيدة', async () => {
        api.responder = reconResponder({
            punches: [punch(3, new Date('2026-02-10T08:00:00.000Z'), null)],
            rows: [],
        });
        const report = await deviceSystemReconciliation({ from: '2026-02-01', to: '2026-02-28' });
        expect(report.summary.unmapped_punches).toBe(1);
        expect(report.summary.orphan_punches).toBe(0);
        expect(report.summary.real_gaps).toBe(0);
        expect(report.unmapped.length).toBe(1);
    });

    test('صفُّ حضورٍ بلا بصمةِ جهاز = مصدرُه مُوضَّح', async () => {
        api.responder = reconResponder({
            punches: [],
            rows: [{ ...ROW_DB, source: 'portal', device_punches: 0, employee_name: 'مازن', employee_no: 'EMP-077' }],
        });
        const report = await deviceSystemReconciliation({ from: '2026-02-01', to: '2026-02-28' });
        expect(report.summary.rows_without_device_punch).toBe(1);
        expect(report.rows_without_device_punch[0].reason).toBe('بوابة التطبيق');
        expect(report.rows_without_device_punch[0].employee_id).toBe(9);
        expect(report.rows_without_device_punch[0].check_in).toBe('09:00');
    });

    test('الملخّصُ يعدّ كلَّ البصمات لا عيّنةَها: القوائمُ وحدها مقتطعة', async () => {
        api.responder = reconResponder({
            punches: [{ ...punch(1, new Date('2026-02-10T06:00:00.000Z'), 9), attendance_id: 501, attendance_date: '2026-02-10' }],
            rows: [{ ...ROW_DB, employee_name: 'مازن', employee_no: 'EMP-077', device_punches: 2 }],
            total: 55910, matched: 55910, unmappedTotal: 19,
            systemRows: 5104, rowsWithout: 49,
        });
        const report = await deviceSystemReconciliation({ from: '2026-02-01', to: '2026-02-28', limit: 1 });
        expect(report.summary.device_punches).toBe(55910);
        expect(report.summary.matched).toBe(55910);
        expect(report.summary.unmapped_punches).toBe(19);
        expect(report.summary.system_rows).toBe(5104);
        expect(report.summary.rows_without_device_punch).toBe(49);
        expect(report.summary.rows_with_device_punch).toBe(5055);
        /* القائمةُ عيّنةٌ واحدة، والعدُّ كاملٌ — والفصلُ بينهما معلَن. */
        expect(report.sample_limits.punches_listed).toBe(1);
        expect(report.sample_limits.lists_are_samples).toBe(true);
    });
});
