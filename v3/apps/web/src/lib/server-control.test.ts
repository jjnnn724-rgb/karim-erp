import { describe, expect, it } from 'vitest';
import {
    controlActionName,
    controlConfirmError,
    controlMaintenanceName,
    controlServiceStateName,
    controlUptimeText,
} from './server-control';

describe('server-control', () => {
    it('controlConfirmError يطابق عبارات الخادم', () => {
        expect(controlConfirmError('start', '')).toBe('');
        expect(controlConfirmError('stop', 'stop')).toBe('');
        expect(controlConfirmError('stop', '  STOP  ')).toBe('');
        expect(controlConfirmError('stop', 'STO')).toBe('اكتب STOP للتأكيد.');
        expect(controlConfirmError('restart', 'restart')).toBe('');
        expect(controlConfirmError('restart', 'STOP')).toBe('اكتب RESTART للتأكيد.');
        expect(controlConfirmError('restart', null)).toBe('اكتب RESTART للتأكيد.');
    });

    it('controlUptimeText ينسّق الثواني عربيًا', () => {
        expect(controlUptimeText(0)).toBe('0د');
        expect(controlUptimeText(59)).toBe('0د');
        expect(controlUptimeText(60)).toBe('1د');
        expect(controlUptimeText(3725)).toBe('1س 2د');
        expect(controlUptimeText(90_061)).toBe('1ي 1س 1د');
        expect(controlUptimeText(null)).toBe('—');
        expect(controlUptimeText(-5)).toBe('—');
        expect(controlUptimeText('x')).toBe('—');
    });

    it('controlServiceStateName يترجم حالات خدمة Windows', () => {
        expect(controlServiceStateName('RUNNING')).toBe('يعمل');
        expect(controlServiceStateName('STOPPED')).toBe('متوقف');
        expect(controlServiceStateName('WEIRD')).toBe('WEIRD');
        expect(controlServiceStateName(null)).toBe('غير معروف');
    });

    it('controlMaintenanceName يترجم راية الصيانة', () => {
        expect(controlMaintenanceName('stopped')).toBe('متوقف يدويًا');
        expect(controlMaintenanceName('restarting')).toBe('قيد إعادة التشغيل');
        expect(controlMaintenanceName('other')).toBe('other');
        expect(controlMaintenanceName('')).toBe('—');
    });

    it('controlActionName يعرّب الأوامر', () => {
        expect(controlActionName('start')).toBe('تشغيل ERP');
        expect(controlActionName('stop')).toBe('إيقاف ERP');
        expect(controlActionName('restart')).toBe('إعادة تشغيل ERP');
    });
});
