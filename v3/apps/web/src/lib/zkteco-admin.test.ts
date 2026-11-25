import { describe, expect, it } from 'vitest';
import { isIsoDay, zkDaySpan, zkIgnoreReasonError, zkPunchStateName, zkRebuildErrors, zkScanDeviceName } from './zkteco-admin';

describe('zkteco-admin', () => {
    it('isIsoDay يقبل التواريخ الحقيقية ويرفض المدحرجة', () => {
        expect(isIsoDay('2026-11-11')).toBe(true);
        expect(isIsoDay('2024-02-29')).toBe(true);
        expect(isIsoDay('2026-02-31')).toBe(false);
        expect(isIsoDay('11-11-2026')).toBe(false);
        expect(isIsoDay('')).toBe(false);
        expect(isIsoDay(null)).toBe(false);
    });

    it('zkDaySpan يحسب الطرفين ويُبطل غير الصالح', () => {
        expect(zkDaySpan('2026-11-01', '2026-11-01')).toBe(1);
        expect(zkDaySpan('2026-11-01', '2026-11-30')).toBe(30);
        expect(zkDaySpan('2026-02-01', '2026-03-01')).toBe(29);
        expect(zkDaySpan('2026-11-11', '2026-11-01')).toBe(-9);
        expect(zkDaySpan('bad', '2026-11-01')).toBeNull();
    });

    it('zkRebuildErrors يطابق قيود الخادم', () => {
        const valid = { employeeId: '18', from: '2026-11-01', to: '2026-11-09', reason: 'تصحيح بصمة متجاهلة' };
        expect(zkRebuildErrors(valid)).toEqual([]);
        expect(zkRebuildErrors({ ...valid, employeeId: '' })).toContain('اختر الموظف أولًا');
        expect(zkRebuildErrors({ ...valid, from: '2026-02-31' })).toContain('التاريخ بصيغة YYYY-MM-DD');
        expect(zkRebuildErrors({ ...valid, from: '2026-11-10', to: '2026-11-01' })).toContain('تاريخ البداية بعد النهاية');
        expect(zkRebuildErrors({ ...valid, to: '2026-12-31' })[0]).toContain('31');
        expect(zkRebuildErrors({ ...valid, reason: 'قصير' })).toContain('سبب إعادة البناء مطلوب (5 أحرف على الأقل)');
        expect(zkRebuildErrors(valid, 7)[0]).toContain('7');
    });

    it('zkIgnoreReasonError يشترط 3 أحرف لغير المتجاهل', () => {
        expect(zkIgnoreReasonError('سبب')).toBe('');
        expect(zkIgnoreReasonError('  سب  ')).toBe('سبب التصحيح مطلوب (3 أحرف على الأقل)');
        expect(zkIgnoreReasonError(null)).toContain('3 أحرف');
    });

    it('zkPunchStateName يترجم حالات الحركة', () => {
        expect(zkPunchStateName(0)).toBe('دخول');
        expect(zkPunchStateName(1)).toBe('خروج');
        expect(zkPunchStateName(2)).toBe('حالة 2');
        expect(zkPunchStateName(null)).toBe('—');
        expect(zkPunchStateName('x')).toBe('—');
    });

    it('zkScanDeviceName يستخدم اسم الجهاز وإلا العنوان', () => {
        expect(zkScanDeviceName({ ip: '192.168.1.201', deviceName: 'مدخل المصنع' })).toBe('مدخل المصنع');
        expect(zkScanDeviceName({ ip: '192.168.1.202', deviceName: '   ' })).toBe('ZKTeco 192.168.1.202');
        expect(zkScanDeviceName({ ip: '192.168.1.203' })).toBe('ZKTeco 192.168.1.203');
    });
});
