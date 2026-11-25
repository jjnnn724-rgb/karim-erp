import { z } from 'zod';
import { DATE_ONLY_PATTERN } from './date-only.js';
import { NUMERIC_ID_PATTERN } from './ids.js';
import { MONEY_PATTERN } from './money.js';

/**
 * عقد القراءة في **v3** — الشكل الذي يُصدره `/api/v3/accounting/*` فعليًا.
 *
 * لماذا لا يُعاد استخدام `accounting.ts`؟ لأن ذلك العقد **القديم** (G2): مالتُه
 * من الالتقاط الفعلي للقديم، فمبلغُه رقمٌ JSON وتاريخُه `T21:00:00.000Z`.
 * وv3 يخرج بالنص (ADR-04) وبـ`YYYY-MM-DD` (ADR-05) — انحرافان معلنان
 * قرّرتهما بوابة G4. خلط العقدين في مخطط واحد يجعل «أيّهما؟» سؤالًا يوميًا،
 * فالعقدان منفصلان: `accounting.ts` للقديم، وهذا لـv3.
 *
 * `strictObject` عن قصد: أي حقلٍ جديد في استجابة v3 يجب أن يظهر هنا كقرار.
 */

const moneyTextSchema = z.string().regex(MONEY_PATTERN, 'مبلغ نصي بصيغة NUMERIC(14,2)');
const numericIdTextSchema = z.string().regex(NUMERIC_ID_PATTERN, 'معرّف bigint كنص');
const dateOnlyTextSchema = z.string().regex(DATE_ONLY_PATTERN, 'تاريخ بصيغة YYYY-MM-DD');
const instantIsoSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'توقيت ISO');

export const v3AccountTypeSchema = z.enum(['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense']);
export type V3AccountType = z.infer<typeof v3AccountTypeSchema>;

/** صف `/api/v3/accounting/chart`. */
export const v3ChartAccountSchema = z.strictObject({
    code: z.string().min(1).max(20),
    name_ar: z.string().min(1).max(255),
    name_en: z.string().max(255).nullable(),
    type: v3AccountTypeSchema,
    parent_code: z.string().min(1).max(20).nullable(),
    is_postable: z.boolean(),
    is_active: z.boolean(),
});
export type V3ChartAccount = z.infer<typeof v3ChartAccountSchema>;

export const v3ChartResponseSchema = z.array(v3ChartAccountSchema);

/** سطر قيد — المبلغ نصٌّ (ADR-04) بخلاف القديم الذي يُخرجه رقمًا. */
export const v3JournalLineSchema = z.strictObject({
    account_code: z.string().min(1).max(20),
    debit: moneyTextSchema,
    credit: moneyTextSchema,
    memo: z.string().nullable(),
});
export type V3JournalLine = z.infer<typeof v3JournalLineSchema>;

export const v3JournalStatusSchema = z.enum(['draft', 'posted', 'void']);
export type V3JournalStatus = z.infer<typeof v3JournalStatusSchema>;

/** صف `/api/v3/accounting/journal` — التاريخ `YYYY-MM-DD` (ADR-05). */
export const v3JournalEntrySchema = z.strictObject({
    id: numericIdTextSchema,
    entry_no: z.string().regex(/^JE-\d{8}-\d{4,}$/, 'رقم القيد JE-YYYYMMDD-NNNN'),
    date: dateOnlyTextSchema,
    memo: z.string().nullable(),
    source_type: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/, 'نوع مصدر لاتيني صغير'),
    source_id: z.string().nullable(),
    status: v3JournalStatusSchema,
    created_by: numericIdTextSchema.nullable(),
    created_at: instantIsoSchema,
    approved_by: numericIdTextSchema.nullable(),
    approved_at: instantIsoSchema.nullable(),
    branch_id: z.number().int().positive().nullable(),
    created_by_name: z.string().nullable(),
    // الإلغاء عقدٌ قائم في القديم (أعمدة `voided_*`)؛ v3 يعرضه بدل إسقاطه
    // كي لا تظهر قيود ملغاة كأنها سارية.
    voided_at: instantIsoSchema.nullable(),
    voided_by: numericIdTextSchema.nullable(),
    voided_by_name: z.string().nullable(),
    void_reason: z.string().nullable(),
    lines: z.array(v3JournalLineSchema),
});
export type V3JournalEntry = z.infer<typeof v3JournalEntrySchema>;

export const v3JournalResponseSchema = z.array(v3JournalEntrySchema);

/**
 * أخطاء الـAPI — `{error, message}` كما في القديم، مع احتمال حقول إضافية
 * مثل `code` في ردود 503: تُقبل وتُهمَل بدل إسقاط رسالة الخادم كاملة.
 */
export const v3ErrorSchema = z.looseObject({
    error: z.string(),
    message: z.string(),
});
export type V3Error = z.infer<typeof v3ErrorSchema>;
