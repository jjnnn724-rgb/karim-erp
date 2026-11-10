import { z } from 'zod';
import { DATE_ONLY_PATTERN } from './date-only.js';
import { NUMERIC_ID_PATTERN } from './ids.js';
import { MONEY_PATTERN } from './money.js';

/**
 * عقود مسارات المحاسبة كما تُصدرها **الالتقاطات** لا كما يبدو الكود (ADR-06).
 *
 * ثلاث حقائق يفترضها كل مخطط هنا، وكلٌّ منها مُثبت من `artifacts/fixtures`:
 *  1. `/chart`  — 7 حقول فقط، بلا id/created_at (قائمة عمود صريحة في الاستعلام).
 *  2. `/journal` — `debit`/`credit` **أرقام** لا نصوص: `json_build_object` يبني
 *     JSON داخل PostgreSQL فيخرج numeric كرقم JSON. معرّفات bigint نصوص.
 *  3. `/trial-balance` — `debit`/`credit` **نصوص** «0.00» (numeric مباشر من pg)
 *     بينما `total_debit` رقم (round2 في JS). التباين عقدٌ قائم لا سهو؛
 *     توحيده يكسر تكافؤ G4.
 *
 * المخططات `.strictObject` عن قصد: أي حقل جديد في القديم يجب أن يظهر هنا
 * كقرار، لا أن يمرّ صامتًا.
 */

const moneyStringSchema = z.string().regex(MONEY_PATTERN, 'مبلغ نصي بصيغة NUMERIC(14,2)');
const numericIdSchema = z.string().regex(NUMERIC_ID_PATTERN, 'معرّف bigint كنص');
const dateOnlySchema = z.string().regex(DATE_ONLY_PATTERN, 'تاريخ بصيغة YYYY-MM-DD');
/** شكل تسلسل عمود DATE عند الرياض: منتصف الليل المحلي = 21:00Z من اليوم السابق. */
const legacyDateIsoSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T21:00:00\.000Z$/, 'تسلسل DATE بتوقيت الرياض');
const instantIsoSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'توقيت ISO');

export const accountTypeSchema = z.enum(['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense']);
export type AccountType = z.infer<typeof accountTypeSchema>;

export const accountSchema = z.strictObject({
    code: z.string().min(1).max(20),
    name_ar: z.string().min(1).max(255),
    name_en: z.string().max(255).nullable(),
    type: accountTypeSchema,
    parent_code: z.string().min(1).max(20).nullable(),
    is_postable: z.boolean(),
    is_active: z.boolean(),
});
export type Account = z.infer<typeof accountSchema>;

/** استجابة `/chart` كاملة. */
export const chartResponseSchema = z.array(accountSchema);

export const journalLineReadSchema = z.strictObject({
    account_code: z.string().min(1).max(20),
    debit: z.number().finite(),
    credit: z.number().finite(),
    memo: z.string().nullable(),
});
export type JournalLineRead = z.infer<typeof journalLineReadSchema>;

export const journalStatusSchema = z.enum(['draft', 'posted', 'void']);
export type JournalStatus = z.infer<typeof journalStatusSchema>;

export const journalEntryReadSchema = z.strictObject({
    id: numericIdSchema,
    entry_no: z.string().regex(/^JE-\d{8}-\d{4,}$/, 'رقم القيد JE-YYYYMMDD-NNNN'),
    date: legacyDateIsoSchema,
    memo: z.string().nullable(),
    source_type: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/, 'نوع مصدر لاتيني صغير'),
    source_id: z.string().nullable(),
    status: journalStatusSchema,
    created_by: numericIdSchema.nullable(),
    created_at: instantIsoSchema,
    approved_by: numericIdSchema.nullable(),
    approved_at: instantIsoSchema.nullable(),
    branch_id: z.number().int().positive().nullable(),
    created_by_name: z.string().nullable(),
    // أعمدة الإلغاء أُضيفت لجدول `journal_entries` بعد التقاط G2 الأول؛
    // المسار يقرأ `e.*` فتُصدرها الاستجابة. إغفالها هنا يجعل كل استجابة
    // حقيقية تفشل المخطط الصارم — أي كل شاشة دفتر تُظهر خطأ عقد.
    voided_at: instantIsoSchema.nullable(),
    voided_by: numericIdSchema.nullable(),
    voided_by_name: z.string().nullable(),
    void_reason: z.string().nullable(),
    lines: z.array(journalLineReadSchema),
});
export type JournalEntryRead = z.infer<typeof journalEntryReadSchema>;

export const journalResponseSchema = z.array(journalEntryReadSchema);

export const trialBalanceAccountSchema = z.strictObject({
    code: z.string().min(1).max(20),
    name_ar: z.string().min(1).max(255),
    name_en: z.string().max(255).nullable(),
    type: accountTypeSchema,
    debit: moneyStringSchema,
    credit: moneyStringSchema,
});
export type TrialBalanceAccount = z.infer<typeof trialBalanceAccountSchema>;

export const trialBalanceResponseSchema = z.strictObject({
    from: dateOnlySchema,
    to: dateOnlySchema,
    accounts: z.array(trialBalanceAccountSchema),
    total_debit: z.number().finite(),
    total_credit: z.number().finite(),
    balanced: z.boolean(),
});
export type TrialBalanceResponse = z.infer<typeof trialBalanceResponseSchema>;

export const vatReturnResponseSchema = z.strictObject({
    from: dateOnlySchema,
    to: dateOnlySchema,
    output_vat: z.number().finite(),
    input_vat: z.number().finite(),
    net_payable: z.number().finite(),
    carry_forward_credit: z.number().finite(),
    payable_balance: z.number().finite(),
    recoverable_balance: z.number().finite(),
    purchases_crosscheck: z.strictObject({
        count: z.number().int().nonnegative(),
        net: z.number().finite(),
        vat: z.number().finite(),
    }),
});
export type VatReturnResponse = z.infer<typeof vatReturnResponseSchema>;

/**
 * طلب تصفية الضريبة — `/vat-settlement` لم يُلتقط (POST كتابة)، فالعقد مأخوذ
 * من فحوص المسار نفسها: `month` بصيغة YYYY-MM، و`apply` منطقي اختياري
 * (غيابه = معاينة).
 */
export const vatSettlementRequestSchema = z.strictObject({
    month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'الشهر بصيغة YYYY-MM'),
    apply: z.boolean().optional(),
});
export type VatSettlementRequest = z.infer<typeof vatSettlementRequestSchema>;
