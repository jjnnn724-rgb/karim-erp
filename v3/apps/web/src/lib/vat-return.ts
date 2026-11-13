import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * عقد الإقرار الضريبي للمراجعة — كل الحقول مطلوبة: الشاشة تعرض أرقامًا
 * محاسبية، فحقل ناقص يجب أن يفشل بوضوح لا أن يُقرأ صفرًا صامتًا.
 */
const taxAccountMovementsSchema = z
    .object({
        output_debits: z.number(),
        input_credits: z.number(),
    })
    .passthrough();

/** حكم تصنيف معدل الضريبة — من `classifyVatRate` في `backend/vat-reporting.js`. */
export type VatRateClassification = 'standard_rate' | 'zero_rate_unclassified' | 'other_rate_review' | 'missing_rate' | 'invalid_rate';

const vatRateRowSchema = z.object({
    kind: z.enum(['sale', 'void', 'purchase']),
    rate: z.number().nullable(),
    applicable_standard_rate: z.number().nullable(),
    classification: z.enum(['standard_rate', 'zero_rate_unclassified', 'other_rate_review', 'missing_rate', 'invalid_rate']),
    taxable_base: z.number(),
    vat: z.number(),
    document_count: z.number(),
    unposted_document_count: z.number(),
});

export type VatRateRow = z.infer<typeof vatRateRowSchema>;

const vatBlockerSchema = z
    .object({
        code: z.string(),
        message: z.string(),
    })
    .passthrough();

export const vatReturnSchema = z
    .object({
        from: z.string(),
        to: z.string(),
        output_vat: z.number(),
        output_vat_reversals: z.number(),
        input_vat: z.number(),
        input_vat_adjustments: z.number(),
        net_payable: z.number(),
        carry_forward_credit: z.number(),
        payable_balance: z.number(),
        recoverable_balance: z.number(),
        standard_vat_rate: z.number().optional(),
        unclassified_vat_movements: taxAccountMovementsSchema,
        purchases_crosscheck: z
            .object({
                count: z.number(),
                net: z.number(),
                vat: z.number(),
                by_rate: z.array(vatRateRowSchema).optional(),
                unposted_count: z.number().optional(),
                missing_tax_rate_count: z.number().optional(),
                missing_supplier_vat_count: z.number().optional(),
                missing_supplier_tax_status_count: z.number().optional(),
                missing_tax_rule_count: z.number().optional(),
            })
            .passthrough(),
        sales_breakdown: z.array(vatRateRowSchema).optional(),
        sales_source_counts: z
            .object({
                unposted_sales: z.number(),
                unposted_voids: z.number(),
            })
            .optional(),
        cancelled_without_void_date: z.number().optional(),
        legacy_revenue_crosscheck: z
            .object({
                count: z.number(),
                total: z.number(),
            })
            .passthrough()
            .optional(),
        filing_period_validation: z
            .object({
                frequency: z.string(),
                matches_frequency: z.boolean(),
            })
            .optional(),
        taxpayer_profile: z
            .object({
                seller_name: z.string().nullable(),
                vat_number: z.string().nullable(),
                number_configured: z.boolean(),
                registration_verified: z.boolean(),
            })
            .passthrough()
            .optional(),
        opening_balances: z
            .object({
                as_of: z.string(),
                payable: z.number(),
                recoverable: z.number(),
            })
            .optional(),
        filing_readiness: z
            .object({
                status: z.string(),
                can_file: z.boolean(),
                blockers: z.array(vatBlockerSchema),
            })
            .optional(),
    })
    .passthrough();

export type VatReturn = z.infer<typeof vatReturnSchema>;

export function fetchVatReturn(from: string, to: string, signal?: AbortSignal): Promise<VatReturn> {
    const params = new URLSearchParams({ from, to });
    return fetchJson<VatReturn>(
        vatReturnSchema,
        `/api/accounting/vat-return?${params.toString()}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

/* ─── تصفية ضريبة القيمة المضافة ───────────────────────────────────────────
 * `POST /api/accounting/vat-settlement` (backend/accounting-routes.js:672):
 *   • `apply:false` ← معاينة الخطة بلا أي أثر.
 *   • `apply:true`  ← ترحيل قيد تصفية (Dr 2100 / Cr 1150) بمفتاح
 *     `(vat_settlement, month)` — إعادة الشهر نفسه ترجع 409 بلا تكرار،
 *     والفترة المقفولة ترجع 423، والشهر الجاري/المستقبلي 422.
 */

/** أدوار الترحيل — `WRITE_ROLES` في `accounting-routes.js:27` (أدمن ومحاسب). */
export const VAT_SETTLEMENT_WRITE_ROLES = ['admin', 'accountant'] as const;

export const vatSettlementLineSchema = z
    .object({
        account_code: z.string(),
        debit: z.number(),
        credit: z.number(),
        memo: z.string(),
    })
    .passthrough();

export type VatSettlementLine = z.infer<typeof vatSettlementLineSchema>;

export const vatSettlementSchema = z
    .object({
        month: z.string(),
        from: z.string(),
        to: z.string(),
        output_vat: z.number(),
        input_vat: z.number(),
        net_payable: z.number(),
        payable_balance: z.number(),
        recoverable_balance: z.number(),
        clearing: z.number(),
        net_payable_after: z.number(),
        carry_forward_after: z.number(),
        lines: z.array(vatSettlementLineSchema),
        settled: z
            .object({
                entry_no: z.string(),
                date: z.string(),
                status: z.string(),
            })
            .nullable()
            .optional(),
        applied: z.boolean().optional(),
        preview: z.boolean().optional(),
        skipped: z.string().nullable().optional(),
    })
    .passthrough();

export type VatSettlement = z.infer<typeof vatSettlementSchema>;

export const VAT_SETTLEMENT_PATH = '/api/accounting/vat-settlement';

/** معاينة الخطة — بلا أثر على الدفاتر (الخادم يرد `preview:true`). */
export async function fetchVatSettlementPreview(month: string, signal?: AbortSignal): Promise<VatSettlement> {
    return fetchJson<VatSettlement>(vatSettlementSchema, VAT_SETTLEMENT_PATH, getAccessToken(), {
        method: 'POST',
        body: { month },
        ...(signal ? { signal } : {}),
    });
}

/** ترحيل تصفية الشهر — الخادم هو الحارس (409 تكرار · 423 مقفل · 422 شهر مفتوح). */
export async function applyVatSettlement(month: string): Promise<VatSettlement> {
    return fetchJson<VatSettlement>(vatSettlementSchema, VAT_SETTLEMENT_PATH, getAccessToken(), {
        method: 'POST',
        body: { month, apply: true },
    });
}

/* ─── اشتقاقات المراجعة ─────────────────────────────────────────────────── */

/** شهر المراجعة من فترة العرض — `YYYY-MM` من أول تاريخ. */
export function vatPeriodMonth(from: string): string {
    const match = /^(\d{4}-\d{2})/.exec(String(from ?? '').trim());
    return match ? (match[1] ?? '') : '';
}

/** حدود شهر كامل — `YYYY-MM` إلى أول الشهر وآخر يوم فيه. */
export function vatMonthRange(month: string): { from: string; to: string } | null {
    const match = /^(\d{4})-(\d{2})$/.exec(String(month ?? '').trim());
    if (!match) {
        return null;
    }
    const year = Number(match[1]);
    const mon = Number(match[2]);
    if (!Number.isFinite(year) || mon < 1 || mon > 12) {
        return null;
    }
    const last = new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
    return { from: `${month}-01`, to: last };
}

/** فترة شهر كامل تقابل `month`؟ (لمنع تصفية فترة مقطوعة بلا قصد) */
export function isFullMonth(month: string, from: string, to: string): boolean {
    const bounds = vatMonthRange(month);
    if (!bounds) {
        return false;
    }
    return from === bounds.from && to === bounds.to;
}

/** بنود المراجعة الثلاثة التي يمنع أي منها اعتماد الأرقام بلا معالجة. */
export type VatReviewFlags = {
    unclassified: number;
    invoiceDifference: number;
    blocked: boolean;
};

export function vatReviewFlags(report: VatReturn): VatReviewFlags {
    const unclassified =
        Number(report.unclassified_vat_movements?.output_debits ?? 0) + Number(report.unclassified_vat_movements?.input_credits ?? 0);
    const invoiceDifference = Number(report.purchases_crosscheck?.vat ?? 0) - Number(report.input_vat ?? 0);
    return {
        unclassified,
        invoiceDifference,
        blocked: unclassified > 0 || Math.abs(invoiceDifference) > 0.01,
    };
}

/* ─── تصنيف المعدلات وجاهزية الإقرار ─────────────────────────────────────── */

/** تسميات تصنيف المعدل كما يقرأها المحاسب — لا رموز إنجليزية على الشاشة. */
export const VAT_RATE_LABELS: Record<VatRateClassification, string> = {
    standard_rate: 'معدل قياسي',
    zero_rate_unclassified: 'صفر% بلا تصنيف نظامي',
    other_rate_review: 'معدل يحتاج مراجعة',
    missing_rate: 'معدل مفقود',
    invalid_rate: 'معدل غير صالح',
};

/** معدل غير قياسي ⇒ يحتاج إسنادًا يدويًا إلى خانة إقرار. */
export function vatRateNeedsReview(row: VatRateRow): boolean {
    return row.classification !== 'standard_rate';
}

/** صفوف التصنيف: مبيعات (بيع/إلغاء) ثم مشتريات. */
export function vatRateRows(report: VatReturn): VatRateRow[] {
    return [...(report.sales_breakdown ?? []), ...(report.purchases_crosscheck?.by_rate ?? [])];
}

export type VatRateSummary = { taxableBase: number; vat: number; documents: number; reviewDocuments: number };

export function vatRateSummary(rows: VatRateRow[]): VatRateSummary {
    return rows.reduce<VatRateSummary>(
        (sum, row) => ({
            taxableBase: sum.taxableBase + Number(row.taxable_base ?? 0),
            vat: sum.vat + Number(row.vat ?? 0),
            documents: sum.documents + Number(row.document_count ?? 0),
            reviewDocuments: sum.reviewDocuments + (vatRateNeedsReview(row) ? Number(row.document_count ?? 0) : 0),
        }),
        { taxableBase: 0, vat: 0, documents: 0, reviewDocuments: 0 },
    );
}
