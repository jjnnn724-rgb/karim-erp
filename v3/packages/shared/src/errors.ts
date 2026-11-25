import { z } from 'zod';

/**
 * أكواد الأخطاء — مأخوذة من `backend/accounting-routes.js` ومن مصادقة القديم،
 * لا من الورق. الرسائل نفسها تُترك للـadapter في مسار الترحيل (التكافؤ حرفي)؛
 * الرسائل العربية هنا لمخزون v3 وحده.
 */
export const ERROR_CODES = [
    'UNAUTHORIZED',
    'FORBIDDEN',
    'PERIOD_CLOSED',
    'PERIOD_LOCKED',
    'LEDGER_ACCOUNT_INVALID',
    'LEDGER_TYPE_INVALID',
    'LEDGER_PARENT_NOT_FOUND',
    'LEDGER_PARENT_TYPE',
    'LEDGER_CODE_EXISTS',
    'LEDGER_ACCOUNT_CREATE_FAILED',
    'LEDGER_CHART_FAILED',
    'LEDGER_TB_FAILED',
    'LEDGER_BS_FAILED',
    'LEDGER_IS_FAILED',
    'LEDGER_JOURNAL_FAILED',
    'LEDGER_ENTRY_INVALID',
    'LEDGER_ENTRY_FAILED',
    'LEDGER_ENTRY_NOT_FOUND',
    'LEDGER_DUPLICATE',
    'LEDGER_ID_INVALID',
    'LEDGER_VOID_FAILED',
    'LEDGER_PERIOD_INVALID',
    'LEDGER_MONTH_INVALID',
    'LEDGER_VAT_PERIOD_OPEN',
    'LEDGER_VAT_RETURN_FAILED',
    'LEDGER_VAT_SETTLEMENT_FAILED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
    return typeof value === 'string' && ERROR_CODE_SET.has(value);
}

/** الشكل الموحّد لخطأ API في القديم: `{ error, message }` بلا استثناء. */
export const errorResponseSchema = z.strictObject({
    error: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'كود الخطأ يجب أن يكون SCREAMING_SNAKE_CASE'),
    message: z.string().min(1),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** رسائل v3 العربية لأكواد يملكها الجديد؛ لا تُستخدم لتصحيح رسائل القديم. */
export const ERROR_MESSAGES_AR: Partial<Record<ErrorCode, string>> = {
    UNAUTHORIZED: 'يلزم تسجيل الدخول',
    FORBIDDEN: 'لا تملك صلاحية هذا الإجراء',
    PERIOD_CLOSED: 'الفترة المحاسبية مقفلة',
    PERIOD_LOCKED: 'الفترة المحاسبية مقفلة',
    LEDGER_ENTRY_INVALID: 'القيد غير صالح',
    LEDGER_ID_INVALID: 'معرّف القيد غير صالح',
    LEDGER_MONTH_INVALID: 'الشهر بصيغة YYYY-MM',
    LEDGER_PERIOD_INVALID: 'بداية الفترة بعد نهايتها',
};
