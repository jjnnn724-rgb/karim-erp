import { describe, expect, test } from 'vitest';
import { ERROR_CODES, ERROR_MESSAGES_AR, errorResponseSchema, isErrorCode } from './errors.js';

describe('أكواد الأخطاء القديمة', () => {
    test('الأكواد الملتقطة من مسارات المحاسبة موجودة', () => {
        for (const code of [
            'UNAUTHORIZED',
            'FORBIDDEN',
            'PERIOD_CLOSED',
            'LEDGER_ACCOUNT_INVALID',
            'LEDGER_DUPLICATE',
            'LEDGER_VAT_RETURN_FAILED',
        ]) {
            expect(ERROR_CODES).toContain(code);
        }
    });

    test('isErrorCode يميّز المعروف عن غيره', () => {
        expect(isErrorCode('LEDGER_ENTRY_INVALID')).toBe(true);
        expect(isErrorCode('ledger_entry_invalid')).toBe(false);
        expect(isErrorCode('SOMETHING_ELSE')).toBe(false);
        expect(isErrorCode(422)).toBe(false);
    });

    test('الرسائل العربية لا تشير إلى كود غير مسجَّل', () => {
        for (const code of Object.keys(ERROR_MESSAGES_AR)) {
            expect(isErrorCode(code)).toBe(true);
        }
    });
});

describe('errorResponseSchema', () => {
    test('يقبل الشكل الملتقط 401', () => {
        expect(errorResponseSchema.safeParse({ error: 'UNAUTHORIZED', message: 'Missing Bearer token.' }).success).toBe(
            true,
        );
    });

    test('يقبل الشكل الملتقط 403', () => {
        expect(
            errorResponseSchema.safeParse({
                error: 'FORBIDDEN',
                message: "Role 'employee' not permitted. Required: admin | accountant | manager | auditor.",
            }).success,
        ).toBe(true);
    });

    test('يرفض كودًا بحروف صغيرة أو رسالة فارغة أو حقلًا زائدًا', () => {
        expect(errorResponseSchema.safeParse({ error: 'forbidden', message: 'x' }).success).toBe(false);
        expect(errorResponseSchema.safeParse({ error: 'FORBIDDEN', message: '' }).success).toBe(false);
        expect(errorResponseSchema.safeParse({ error: 'FORBIDDEN', message: 'x', code: 403 }).success).toBe(false);
    });
});
