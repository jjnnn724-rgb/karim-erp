import { describe, expect, it } from 'vitest';
import { employeeAttendancePrintHtml, type RangeModel } from './employee-card';

const report: RangeModel = {
    rows: [
        {
            date: '2026-11-10',
            state: 'in-time',
            weeklyOff: false,
            checkIn: '08:00',
            checkOut: '16:30',
            minutes: 510,
            lateMinutes: 0,
            arrivalLateRaw: 0,
            earlyLeaveRaw: 0,
            withinGrace: false,
        },
        {
            date: '2026-11-11',
            state: 'absent',
            weeklyOff: false,
            checkIn: '',
            checkOut: '',
            minutes: 0,
            lateMinutes: 0,
            arrivalLateRaw: 0,
            earlyLeaveRaw: 0,
            withinGrace: false,
        },
    ],
    truncated: false,
    summary: {
        from: '2026-11-10',
        to: '2026-11-11',
        daysPresent: 1,
        completeDays: 1,
        rawLateDays: 0,
        lateDays: 0,
        reviewDays: 0,
        reviewMinutes: 0,
        totalRawLateMinutes: 0,
        totalLateMinutes: 0,
        totalKarim: 8.5,
    },
};

describe('employee attendance print sheet', () => {
    it('prints the selected attendance range, server summary, weekdays, and absence rows', () => {
        const html = employeeAttendancePrintHtml({
            employeeName: 'أحمد صالح',
            employeeCode: 'EMP-10',
            department: 'المطبخ',
            position: 'شيف',
            report,
            generatedAt: new Date('2026-11-12T10:20:00'),
        });

        expect(html).toContain('كشف حضور وانصراف — أحمد صالح');
        expect(html).toContain('EMP-10');
        expect(html).toContain('2026-11-10');
        expect(html).toContain('2026-11-11');
        expect(html).toContain('أيام الحضور');
        expect(html).toContain('لم يحضر');
        expect(html).toContain('08:00');
        expect(html).toContain('16:30');
        expect(html).toContain('إجمالي الساعات');
        expect(html).toContain('8.5');
    });

    it('escapes employee-controlled text and discloses a truncated range', () => {
        const html = employeeAttendancePrintHtml({
            employeeName: '<script>alert(1)</script>',
            employeeCode: 'EMP-<10>',
            department: 'قسم & قسم',
            position: 'عامل',
            report: { ...report, truncated: true },
            generatedAt: new Date('2026-11-12T10:20:00'),
        });

        expect(html).not.toContain('<script>alert');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('EMP-&lt;10&gt;');
        expect(html).toContain('قسم &amp; قسم');
        expect(html).toContain('الكشف محدود بـ 62 يومًا');
    });
});
