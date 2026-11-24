import { describe, expect, it } from 'vitest';
import type { AttendanceReport } from './employee-card';
import {
    canSwitchPortalEmployee,
    portalLeaveBadge,
    portalMonthRange,
    portalRecordHours,
    portalRecordState,
    portalRegisterHtml,
    portalSourceBadge,
} from './employee-portal';

describe('مبدّل موظف البوابة', () => {
    it('يفتح لـ admin/hr/manager فقط — نفس ADMIN_ROLES في القديم', () => {
        expect(canSwitchPortalEmployee('admin')).toBe(true);
        expect(canSwitchPortalEmployee('hr')).toBe(true);
        expect(canSwitchPortalEmployee('manager')).toBe(true);
        expect(canSwitchPortalEmployee('employee')).toBe(false);
        expect(canSwitchPortalEmployee('cashier')).toBe(false);
        expect(canSwitchPortalEmployee(null)).toBe(false);
    });
});

describe('مدى الشهر', () => {
    it('يعيد أول وآخر يوم في الشهر', () => {
        expect(portalMonthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
        expect(portalMonthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
        expect(portalMonthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    });

    it('يرفض الشهر غير الصالح بلا اختراع مدى', () => {
        expect(portalMonthRange('2026-13')).toBeNull();
        expect(portalMonthRange('2026-00')).toBeNull();
        expect(portalMonthRange('2026-1')).toBeNull();
        expect(portalMonthRange('')).toBeNull();
        expect(portalMonthRange(null)).toBeNull();
    });
});

describe('صفوف الكشف', () => {
    it('الساعات من workMinutes التي حسبها الخادم', () => {
        expect(portalRecordHours({ workMinutes: '480' })).toBe(8);
        expect(portalRecordHours({ workMinutes: 450 })).toBe(7.5);
        expect(portalRecordHours({ workMinutes: 0 })).toBe(0);
        expect(portalRecordHours({ workMinutes: -30 })).toBe(0);
        expect(portalRecordHours({ workMinutes: null })).toBeNull();
        expect(portalRecordHours({})).toBeNull();
        expect(portalRecordHours(null)).toBeNull();
    });

    it('حالة الصف: بلا حضور/بلا انصراف/متأخر/في الوقت', () => {
        expect(portalRecordState({ checkIn: '', checkOut: '' })).toEqual({ label: 'بلا حضور', tone: 'warning' });
        expect(portalRecordState({ checkIn: '08:00', checkOut: '' })).toEqual({
            label: 'بلا انصراف',
            tone: 'warning',
        });
        expect(portalRecordState({ checkIn: '08:00', checkOut: '17:00', lateMinutes: 5 })).toEqual({
            label: 'متأخر',
            tone: 'warning',
        });
        expect(portalRecordState({ checkIn: '08:00', checkOut: '17:00', arrivalLateRawMinutes: 3 })).toEqual({
            label: 'متأخر',
            tone: 'warning',
        });
        expect(portalRecordState({ checkIn: '08:00', checkOut: '17:00', earlyLeaveRawMinutes: 3 })).toEqual({
            label: 'متأخر',
            tone: 'warning',
        });
        expect(portalRecordState({ checkIn: '08:00', checkOut: '17:00' })).toEqual({
            label: 'في الوقت',
            tone: 'success',
        });
    });

    it('مصدر البصمة — نفس تسميات القديم', () => {
        expect(portalSourceBadge('device')).toEqual({ label: 'بصمة', tone: 'info' });
        expect(portalSourceBadge('qr')).toEqual({ label: 'QR', tone: 'success' });
        expect(portalSourceBadge('portal')).toEqual({ label: 'كاميرا التطبيق', tone: 'info' });
        expect(portalSourceBadge('backfill')).toEqual({ label: 'أرشيف', tone: 'neutral' });
        expect(portalSourceBadge(undefined)).toEqual({ label: 'يدوي', tone: 'neutral' });
    });

    it('حالة الإجازة بكل الكلمات المعروفة والمجهولة', () => {
        expect(portalLeaveBadge('approved')).toEqual({ label: 'معتمد', tone: 'success' });
        expect(portalLeaveBadge('rejected')).toEqual({ label: 'مرفوض', tone: 'danger' });
        expect(portalLeaveBadge('pending')).toEqual({ label: 'معلق', tone: 'warning' });
        expect(portalLeaveBadge('returned')).toEqual({ label: 'عاد للموظف للتعديل', tone: 'warning' });
        expect(portalLeaveBadge('archived')).toEqual({ label: 'archived', tone: 'neutral' });
        expect(portalLeaveBadge(null)).toEqual({ label: '—', tone: 'neutral' });
    });
});

describe('ورقة كشف الحضور', () => {
    const report: AttendanceReport = {
        records: [
            { date: '2026-11-10', checkIn: '08:00', checkOut: '16:30', workMinutes: 510, source: 'device' },
            { date: '2026-11-11', checkIn: '08:05', checkOut: '', workMinutes: 0, source: 'portal' },
        ],
        summary: { daysPresent: 2, totalKarim: 8.5 },
    };

    it('تحمل الموظف والفترة وصفوف السجل والملخّص من الخادم', () => {
        const html = portalRegisterHtml({
            title: 'كشف حضور وانصراف يوم 2026-11-11',
            employeeName: 'أحمد صالح',
            employeeId: 'EMP-10',
            from: '2026-11-01',
            to: '2026-11-11',
            report,
            brandName: 'مطاعم الشرفة',
        });
        expect(html).toContain('كشف حضور وانصراف يوم 2026-11-11');
        expect(html).toContain('أحمد صالح');
        expect(html).toContain('EMP-10');
        expect(html).toContain('2026-11-10');
        expect(html).toContain('08:00');
        expect(html).toContain('8.5');
        expect(html).toContain('أيام الحضور: 2');
        expect(html).toContain('في الوقت');
        expect(html).toContain('بلا انصراف');
        expect(html).toContain('مطاعم الشرفة');
        expect(html).toContain('background:#eaf0f5');
        expect(html).toContain('border-bottom:3px solid #0f766e');
    });

    it('تهرّب وسوم HTML من اسم الموظف والعنوان', () => {
        const html = portalRegisterHtml({
            title: '<script>alert(1)</script>',
            employeeName: '<script>alert(2)</script>',
            employeeId: 'X',
            from: '2026-11-01',
            to: '2026-11-01',
            report: { records: [], summary: null },
        });
        expect(html).not.toContain('<script>alert');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
        expect(html).toContain('لا سجلات في هذه الفترة');
    });
});
