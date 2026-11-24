import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { isWriteRole, writeErrorMessage } from './write';

/**
 * قواعد طبقة الكتابة المشتركة — تُحرس هنا لأن كل شاشات الكتابة تعتمد عليها:
 *  • `isWriteRole` مطابقة حرفية كما `roleIn` في V2 (لا `admin` ضمنيًّا).
 *  • رسالة الخطأ تأخذ رسالة الخادم أولًا كما كان القديم يعرض `{error,message}`.
 */

describe('طبقة الكتابة — الأدوار', () => {
    it('مطابقة حرفية كقوائم V2 (admin ليس ضمنيًّا)', () => {
        expect(isWriteRole('admin', ['admin', 'warehouse'])).toBe(true);
        expect(isWriteRole('warehouse', ['admin', 'warehouse'])).toBe(true);
        expect(isWriteRole('manager', ['admin', 'warehouse'])).toBe(false);
        expect(isWriteRole('admin', ['warehouse'])).toBe(false);
        expect(isWriteRole(null, ['admin'])).toBe(false);
        expect(isWriteRole(undefined, ['admin'])).toBe(false);
        expect(isWriteRole(' admin ', ['admin'])).toBe(true);
    });
});

describe('طبقة الكتابة — رسالة الخطأ', () => {
    it('يعرض رسالة الخادم العربية من ApiError', () => {
        expect(writeErrorMessage(new ApiError(409, 'DUPLICATE', 'الكود موجود بالفعل'))).toBe('الكود موجود بالفعل');
    });

    it('يسقط للرسالة البديلة عند غياب رسالة', () => {
        expect(writeErrorMessage(new ApiError(500, 'X', ''), 'تعذّر حفظ الرف')).toBe('تعذّر حفظ الرف');
        expect(writeErrorMessage(null, 'تعذّر حفظ الرف')).toBe('تعذّر حفظ الرف');
        expect(writeErrorMessage(new Error('boom'), 'تعذّر حفظ الرف')).toBe('boom');
    });
});
