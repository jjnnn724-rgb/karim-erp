import { describe, expect, it } from 'vitest';
import {
    attendanceMonthError,
    auditNote,
    buildAttendanceCreate,
    buildExcusePayload,
    buildMonthlySheet,
    buildPunchPayload,
    calcPunchTimes,
    canWriteAttendance,
    joinNotes,
    minutesToHM,
    monthlyRow,
    shiftStartFor,
    validatePunchForm,
    validateReason,
} from './attendance-write';

describe('attendance-write', () => {
    it('يقصر الكتابة على أدوار الخادم admin/hr/manager', () => {
        expect(canWriteAttendance('admin')).toBe(true);
        expect(canWriteAttendance('hr')).toBe(true);
        expect(canWriteAttendance('manager')).toBe(true);
        expect(canWriteAttendance('dept_head')).toBe(false);
        expect(canWriteAttendance(null)).toBe(false);
    });

    it('يرفض نموذج البصمة برسائل V2 نفسها', () => {
        expect(validatePunchForm({})).toEqual({ ok: false, message: 'أدخل بصمة واحدة على الأقل' });
        expect(validatePunchForm({ checkIn: '25:00', reason: 'x' })).toEqual({
            ok: false,
            message: 'صيغة الوقت HH:MM',
        });
        expect(validatePunchForm({ checkIn: '09:00', reason: '  ' })).toEqual({
            ok: false,
            message: 'اكتب السبب',
        });
        expect(validatePunchForm({ checkIn: '09:00', reason: 'نسي البصمة' })).toEqual({
            ok: true,
            checkIn: '09:00',
            checkOut: '',
            reason: 'نسي البصمة',
        });
    });

    it('validateReason يتطلب نصًا غير فارغ', () => {
        expect(validateReason('')).toEqual({ ok: false, message: 'اكتب السبب' });
        expect(validateReason('  ')).toEqual({ ok: false, message: 'اكتب السبب' });
        expect(validateReason(' سبب ', 'رسالة')).toEqual({ ok: true, reason: 'سبب' });
    });

    it('يبني جسم البصمة بمفاتيح whitelist الخادم فقط', () => {
        expect(buildPunchPayload({ checkIn: '08:00', checkOut: '', late: 1 as unknown as boolean, notes: 'x' })).toEqual({
            checkIn: '08:00',
            checkOut: null,
            workMinutes: null,
            late: true,
            notes: 'x',
        });
        expect(buildPunchPayload({ workMinutes: Number.NaN })).toEqual({
            checkIn: null,
            checkOut: null,
            workMinutes: null,
            late: false,
            notes: '',
        });
        expect(buildPunchPayload({ workMinutes: 450 })).toMatchObject({ workMinutes: 450 });
    });

    it('buildAttendanceCreate يفرض الموظف والتاريخ', () => {
        expect(() => buildAttendanceCreate({ employeeId: '', date: '2026-11-11' })).toThrow('حدّد الموظف');
        expect(() => buildAttendanceCreate({ employeeId: 5, date: '11-11-2026' })).toThrow('التاريخ بصيغة YYYY-MM-DD');
        expect(buildAttendanceCreate({ employeeId: 5, date: '2026-11-11', checkIn: '09:00' })).toMatchObject({
            employeeId: '5',
            date: '2026-11-11',
            checkIn: '09:00',
        });
    });

    it('buildExcusePayload يبني طلب إجازة معتمدًا ليوم واحد ببادئة النوع', () => {
        expect(
            buildExcusePayload({
                employeeId: 7,
                date: '2026-11-01',
                reason: 'ظرف عائلي',
                kind: 'admin',
                userId: '1',
                todayStr: '2026-11-11',
            }),
        ).toEqual({
            employeeId: '7',
            startDate: '2026-11-01',
            endDate: '2026-11-01',
            status: 'approved',
            reason: 'عذر إداري: ظرف عائلي',
            requestDate: '2026-11-11',
            approvedDate: '2026-11-11',
            requestedBy: '1',
            approvedBy: '1',
        });
        expect(buildExcusePayload({ employeeId: 7, date: '2026-11-01', reason: 'تبديل', kind: 'swap', withName: 'سامي' }).reason).toBe(
            'تبديل وردية مع سامي: تبديل',
        );
        expect(() => buildExcusePayload({ employeeId: 7, date: '2026-11-01', reason: ' ' })).toThrow('اكتب السبب');
    });

    it('يحسب دقائق العمل والتأخير بلا سماحية', () => {
        expect(calcPunchTimes({ checkIn: '09:00', checkOut: '18:00', shiftStart: '09:00' })).toEqual({
            workMinutes: 540,
            late: false,
        });
        expect(calcPunchTimes({ checkIn: '09:01', checkOut: '18:00', shiftStart: '09:00' }).late).toBe(true);
        expect(calcPunchTimes({ checkIn: '22:00', checkOut: '06:00', shiftStart: '22:00' }).workMinutes).toBe(480);
        expect(calcPunchTimes({ checkIn: '', checkOut: '06:00', keepLate: true })).toEqual({
            workMinutes: null,
            late: true,
        });
        expect(calcPunchTimes({ checkIn: '', checkOut: '06:00', keepLate: false })).toEqual({
            workMinutes: null,
            late: false,
        });
    });

    it('shiftStartFor يفضّل وردية البطاقة ثم ساعة الإعدادات ثم 09:00', () => {
        expect(shiftStartFor({ shift_start: '07:30' }, 10)).toBe('07:30');
        expect(shiftStartFor({ shift_start: '' }, 10)).toBe('10:00');
        expect(shiftStartFor(null, 0)).toBe('09:00');
    });

    it('سطر التدقيق والصق الملاحظات كما في V2', () => {
        expect(auditNote('correct', { who: 'منى', reason: 'نسي', date: '2026-11-11' })).toBe('[تصحيح يدوي 2026-11-11 بواسطة منى: نسي]');
        expect(auditNote('fill', { who: 'منى', reason: 'نسي', date: '2026-11-11' })).toBe('[تعبئة 2026-11-11 بواسطة منى: نسي]');
        expect(auditNote('swap', { who: 'منى', reason: 'اتفاق', date: '2026-11-11', withName: 'سامي' })).toBe(
            '[تبديل وردية 2026-11-11 مع سامي بواسطة منى: اتفاق]',
        );
        expect(joinNotes(null, 'سطر')).toBe('سطر');
        expect(joinNotes('قديم', 'جديد')).toBe('قديم | جديد');
    });

    it('يبني الكشف الشهري بإجماليات صفوف الخادم نفسها', () => {
        const sheet = buildMonthlySheet({
            month: '2026-11',
            workDayMinutes: 600,
            employees: [
                {
                    id: 1,
                    name: 'أ',
                    days: 5,
                    present: 5,
                    completeWorkDays: 3,
                    shortDays: 2,
                    deficitMinutes: 90,
                    karimHours: 40.5,
                    reviewDays: 1,
                },
                { id: 2, name: 'ب', days: 4, present: 3, completeWorkDays: 2, shortDays: 1, deficitMinutes: 30, karimHours: 20.25 },
            ],
        });
        expect(sheet.employees).toBe(2);
        expect(sheet.totals).toMatchObject({
            records: 9,
            present: 8,
            completeWorkDays: 5,
            shortDays: 3,
            deficitMinutes: 120,
            karimHours: 60.8,
            reviewDays: 1,
        });
        expect(monthlyRow({ id: 1, shift_start: '08:00', days: '5' })).toMatchObject({
            records: 5,
            shiftStart: '08:00',
        });
        expect(minutesToHM(90)).toBe('1:30');
        expect(minutesToHM(0)).toBe('—');
        expect(minutesToHM(null)).toBe('—');
    });

    it('attendanceMonthError يطابق رسائل الخادم', () => {
        expect(attendanceMonthError('2026-11')).toBe('');
        expect(attendanceMonthError('2026-1')).toBe('الشهر بصيغة YYYY-MM');
        expect(attendanceMonthError('2026-13')).toBe('شهر غير صالح');
    });
});
