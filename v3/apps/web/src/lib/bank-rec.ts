import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * مطابقة البنك — سطح V3 على `GET /api/accounting/bank-rec` و
 * `POST /api/accounting/bank-rec/auto-match` (backend/accounting-growth.js).
 *
 * الأرقام كلها من الخادم: رصيد الدفتر (book)، مجموع كشف البنك (statement)،
 * الفرق، والحركات غير المطابقة. لا يُخمَّن أي مبلغ هنا.
 *
 * المطابقة الآلية تربط كشفًا بقيدٍ له نفس المبلغ على نفس الحساب بتاريخ
 * ±3 أيام، وتُطالب بالقيد ذرّيًّا كي لا يربط تشغيلان نفس القيد بكشفيين.
 */

const bankStatementSchema = z
    .object({
        id: z.number(),
        account_code: z.string(),
        stmt_date: z.string(),
        description: z.string(),
        amount: z.number(),
        matched: z.boolean(),
        matched_entry: z.number().nullable().optional(),
        created_by: z.number().nullable().optional(),
    })
    .passthrough();

export type BankStatement = z.infer<typeof bankStatementSchema>;

export const bankRecSchema = z
    .object({
        ok: z.boolean().optional(),
        account: z.string(),
        from: z.string(),
        to: z.string(),
        /** صافي قيود الحساب المرحّلة في الفترة (مدين − دائن). */
        book: z.number(),
        /** مجموع كشف البنك في الفترة. */
        statement: z.number(),
        /** الفرق: كشف البنك − الدفتر. */
        diff: z.number(),
        /** الكشوف غير المطابقة في الفترة. */
        unmatched: z.array(bankStatementSchema),
    })
    .passthrough();

export type BankRec = z.infer<typeof bankRecSchema>;

export const bankRecMatchSchema = z
    .object({
        ok: z.boolean().optional(),
        matched: z.number(),
        scanned: z.number(),
    })
    .passthrough();

export type BankRecMatch = z.infer<typeof bankRecMatchSchema>;

/** مسار كشف المطابقة — الفترة الكاملة افتراضيًا (أول الشهر إلى اليوم). */
export function bankRecPath(from: string, to: string, account = ''): string {
    const params = new URLSearchParams({ from, to });
    if (account.trim()) {
        params.set('account', account.trim());
    }
    return `/api/accounting/bank-rec?${params.toString()}`;
}

/** جلب كشف المطابقة — قراءة فقط، ولا تُنشئ ولا تربط شيئًا. */
export async function fetchBankRec(from: string, to: string, account = '', signal?: AbortSignal): Promise<BankRec> {
    return fetchJson(bankRecSchema, bankRecPath(from, to, account), getAccessToken(), signal ? { signal } : {});
}

/** مسار المطابقة الآلية — يكتب فعليًا (أدمن/محاسب فقط حسب الخادم). */
export const BANK_REC_MATCH_PATH = '/api/accounting/bank-rec/auto-match';

/**
 * مطابقة آلية — الخادم يمرّ على الكشوف غير المطابقة ويربط أول قيدٍ مطابق
 * للمبلغ على نفس الحساب بتاريخ ±3 أيام. يعيد عدد ما أُنجز فعليًّا.
 */
export async function matchBankRec(account = ''): Promise<BankRecMatch> {
    return fetchJson(bankRecMatchSchema, BANK_REC_MATCH_PATH, getAccessToken(), {
        method: 'POST',
        body: account.trim() ? { account: account.trim() } : {},
    });
}
