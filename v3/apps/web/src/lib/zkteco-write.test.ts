import { describe, expect, it } from 'vitest';
import { canControlZk, canWriteZk, emptyZkDeviceForm, validateZkDeviceForm, zkDevicePayload, zkEngineReasonError } from './zkteco-write';

describe('zkteco-write', () => {
    it('يقبل النموذج الافتراضي (منفذ 4370 وفترة 30)', () => {
        const form = { ...emptyZkDeviceForm(), name: 'باب المخزن', ipAddress: '192.168.1.201' };
        expect(validateZkDeviceForm(form)).toEqual([]);
    });

    it('يرفض اسمًا فارغًا أو IP أو منفذًا غير صالح', () => {
        const form = { ...emptyZkDeviceForm(), name: ' ', ipAddress: '999.1.1.1', port: '70000' };
        expect(validateZkDeviceForm(form).map((error) => error.field)).toEqual(['name', 'ipAddress', 'port']);
    });

    it('يرفض مفتاح اتصال أو فترة مزامنة خارج الحدود', () => {
        const form = {
            ...emptyZkDeviceForm(),
            name: 'جهاز',
            ipAddress: '10.0.0.5',
            commKey: '70000',
            syncIntervalSeconds: '2',
        };
        expect(validateZkDeviceForm(form).map((error) => error.field)).toEqual(['commKey', 'syncIntervalSeconds']);
    });

    it('يبني الحمولة بالأرقام ويحذف المفتاح الفارغ', () => {
        const form = { ...emptyZkDeviceForm(), name: ' جهاز ', ipAddress: '10.0.0.5', commKey: '' };
        const payload = zkDevicePayload(form);
        expect(payload).toMatchObject({ name: 'جهاز', ipAddress: '10.0.0.5', port: 4370 });
        expect('commKey' in payload).toBe(false);
    });

    it('يشترط سببًا من 3 أحرف لإجراء المحرك', () => {
        expect(zkEngineReasonError('')).toBe('سبب الإجراء مطلوب (3 أحرف على الأقل)');
        expect(zkEngineReasonError('ab')).toBe('سبب الإجراء مطلوب (3 أحرف على الأقل)');
        expect(zkEngineReasonError('شبكة')).toBe('');
    });

    it('يفصل أدوار الكتابة عن أدوار التحكم', () => {
        expect(canWriteZk('hr')).toBe(true);
        expect(canWriteZk('manager')).toBe(false);
        expect(canControlZk('owner')).toBe(true);
        expect(canControlZk('hr')).toBe(false);
    });
});
