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
                amount: z.number(),
                by_source: z
                    .array(
                        z
                            .object({
                                source: z.string(),
                                count: z.number(),
                                amount: z.number(),
                            })
                            .passthrough(),
                    )
                    .optional(),
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

/* ─── ورقة عمل الإقرار: مطابقة المستندات بخانات النموذج ───────────────────── */

const round2 = (value: number): number => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * حالة الخانة — `unavailable` تعني «لا يوجد حقل في النظام»، لا «صفر».
 * هذا فرق جوهري في الإقرار: الصفر تصريح، وغياب البيانات ليس تصريحًا.
 */
export type VatWorksheetStatus = 'ready' | 'review' | 'missing' | 'unavailable';

export interface VatWorksheetRow {
    key: string;
    /** رقم الخانة في نموذج الإقرار السعودي، أو `null` لبند تحليلي لا خانة له. */
    box: number | null;
    label: string;
    /** `null` تعني غير مسجّلة في النظام — تُعرض «—» لا 0.00. */
    base: number | null;
    vat: number | null;
    documents: number;
    status: VatWorksheetStatus;
    note: string;
}

export interface VatWorksheetTotals {
    base: number;
    vat: number;
    documents: number;
}

export interface VatWorksheet {
    standardRate: number;
    sales: VatWorksheetRow[];
    purchases: VatWorksheetRow[];
    salesTotal: VatWorksheetTotals;
    purchasesTotal: VatWorksheetTotals;
    /** صافي المستندات (مخرجات − مدخلات) قبل أي تسوية. */
    net: number;
    salesComplete: boolean;
    purchasesComplete: boolean;
    reviewDocuments: number;
    hasSalesDetail: boolean;
    hasPurchaseDetail: boolean;
}

function sumRateRows(rows: readonly VatRateRow[]): VatWorksheetTotals {
    return rows.reduce<VatWorksheetTotals>(
        (sum, row) => ({
            base: round2(sum.base + Number(row.taxable_base ?? 0)),
            vat: round2(sum.vat + Number(row.vat ?? 0)),
            documents: sum.documents + Number(row.document_count ?? 0),
        }),
        { base: 0, vat: 0, documents: 0 },
    );
}

/** صافي فئة مبيعات: البيع ناقص الإلغاء لنفس التصنيف — لا تُخلط المعدلات. */
function netSalesRows(rows: readonly VatRateRow[], classes: readonly VatRateClassification[]): VatWorksheetTotals {
    const inClass = (row: VatRateRow) => classes.includes(row.classification);
    const sales = sumRateRows(rows.filter((row) => row.kind === 'sale' && inClass(row)));
    const voids = sumRateRows(rows.filter((row) => row.kind === 'void' && inClass(row)));
    return {
        base: round2(sales.base - voids.base),
        vat: round2(sales.vat - voids.vat),
        documents: sales.documents + voids.documents,
    };
}

function worksheetRow(
    key: string,
    box: number | null,
    label: string,
    totals: VatWorksheetTotals | null,
    status: VatWorksheetStatus,
    note: string,
): VatWorksheetRow {
    return {
        key,
        box,
        label,
        base: totals ? totals.base : null,
        vat: totals ? totals.vat : null,
        documents: totals ? totals.documents : 0,
        status,
        note,
    };
}

/**
 * ورقة عمل الإقرار — تُصنّف المستندات إلى خانات النموذج بقدر ما يسمح به
 * تصنيف النظام، وتُعلن صراحةً ما لا يستطيع النظام إثباته (الإعفاء، التصدير،
 * الاستيراد، الاحتساب العكسي) بدل عرضه صفرًا مضلّلًا.
 */
export function vatWorksheet(report: VatReturn): VatWorksheet {
    const standardRate = Number(report.standard_vat_rate ?? 15) || 15;
    const salesDetail = report.sales_breakdown;
    const purchaseDetail = report.purchases_crosscheck?.by_rate;
    const hasSalesDetail = Array.isArray(salesDetail);
    const hasPurchaseDetail = Array.isArray(purchaseDetail);
    const sales = salesDetail ?? [];
    const purchases = purchaseDetail ?? [];

    const standard = netSalesRows(sales, ['standard_rate']);
    const zero = netSalesRows(sales, ['zero_rate_unclassified']);
    const other = netSalesRows(sales, ['other_rate_review', 'invalid_rate']);
    const missing = netSalesRows(sales, ['missing_rate']);

    const pStandard = sumRateRows(purchases.filter((row) => row.classification === 'standard_rate'));
    const pZero = sumRateRows(purchases.filter((row) => row.classification === 'zero_rate_unclassified'));
    const pOther = sumRateRows(
        purchases.filter((row) => row.classification === 'other_rate_review' || row.classification === 'invalid_rate'),
    );
    const pMissing = sumRateRows(purchases.filter((row) => row.classification === 'missing_rate'));

    const builtSalesRows: VatWorksheetRow[] = [
        worksheetRow(
            'standard',
            1,
            `مبيعات بالمعدل القياسي (${String(standardRate)}%)`,
            standard,
            'ready',
            'الوعاء والضريبة من فواتير البيع ناقص الإلغاء.',
        ),
        worksheetRow(
            'zero',
            2,
            'مبيعات بمعدل 0%',
            zero,
            'review',
            'غير مصنّفة نظاميًا: يجب تحديد «صفري» أم «معفى» قبل إسنادها لخانة 2 أو 3.',
        ),
        worksheetRow('exempt', 3, 'مبيعات معفاة', null, 'unavailable', 'لا يحفظ النظام تصنيف الإعفاء — غير مسجّلة، وليست صفرًا.'),
        worksheetRow('other', 4, 'مبيعات بمعدلات أخرى / تصدير', other, 'review', 'معدل غير قياسي؛ تُراجع طبيعة التوريد قبل إسناد الخانة.'),
        worksheetRow(
            'missing',
            null,
            'مستندات بلا معدل ضريبة',
            missing,
            'missing',
            'لا تُسند لخانة، وأرقامها غير موثوقة حتى استكمال المعدل.',
        ),
    ];

    const builtPurchaseRows: VatWorksheetRow[] = [
        worksheetRow(
            'standard',
            7,
            `مشتريات بالمعدل القياسي (${String(standardRate)}%)`,
            pStandard,
            'ready',
            'مدخلات من فواتير الشراء المرحّلة.',
        ),
        worksheetRow('zero', 8, 'مشتريات بمعدل 0%', pZero, 'review', 'غير مصنّفة نظاميًا؛ راجع طبيعة التوريد قبل الخانة.'),
        worksheetRow('exempt', 9, 'مشتريات معفاة', null, 'unavailable', 'لا يحفظ النظام تصنيف الإعفاء — غير مسجّلة، وليست صفرًا.'),
        worksheetRow('other', null, 'مشتريات بمعدلات أخرى', pOther, 'review', 'معدل غير قياسي يحتاج مراجعة المستند.'),
        worksheetRow('imports', 10, 'استيراد خاضع للضريبة', null, 'unavailable', 'لا يوجد حقل استيراد في فواتير الشراء — غير مسجّل.'),
        worksheetRow('reverse', 11, 'الاحتساب العكسي', null, 'unavailable', 'لا يوجد حقل احتساب عكسي — غير مسجّل.'),
        worksheetRow(
            'missing',
            null,
            'فواتير بلا معدل ضريبة',
            pMissing,
            'missing',
            'لا تُسند لخانة، والمدخلات غير قابلة للخصم قبل استكمالها.',
        ),
    ];

    const salesTotal: VatWorksheetTotals = {
        base: round2(standard.base + zero.base + other.base + missing.base),
        vat: round2(standard.vat + zero.vat + other.vat + missing.vat),
        documents: standard.documents + zero.documents + other.documents + missing.documents,
    };
    const purchasesTotal: VatWorksheetTotals = {
        base: round2(pStandard.base + pZero.base + pOther.base + pMissing.base),
        vat: round2(pStandard.vat + pZero.vat + pOther.vat + pMissing.vat),
        documents: pStandard.documents + pZero.documents + pOther.documents + pMissing.documents,
    };

    /**
     * غياب الكشف ليس صفرًا: لو لم تُرجع الاستجابة تفصيل المبيعات أو المشتريات
     * فكل خانة تصير «غير مسجّلة» بدل صفوف أصفار تُقرأ كإقرار.
     */
    const hideMissingDetail = (rows: VatWorksheetRow[], available: boolean, note: string): VatWorksheetRow[] =>
        available
            ? rows
            : rows.map((row) => ({
                  ...row,
                  base: null,
                  vat: null,
                  documents: 0,
                  status: 'unavailable' as const,
                  note,
              }));

    const salesRows = hideMissingDetail(
        builtSalesRows,
        hasSalesDetail,
        'لا كشف مبيعات مرحّل في الاستجابة لهذه الفترة — غير مسجّلة، وليست صفرًا.',
    );
    const purchaseRows = hideMissingDetail(
        builtPurchaseRows,
        hasPurchaseDetail,
        'لا كشف مشتريات مرحّل في الاستجابة لهذه الفترة — غير مسجّلة، وليست صفرًا.',
    );

    const reviewDocuments = zero.documents + other.documents + missing.documents + pZero.documents + pOther.documents + pMissing.documents;

    return {
        standardRate,
        sales: salesRows,
        purchases: purchaseRows,
        salesTotal,
        purchasesTotal,
        net: round2(salesTotal.vat - purchasesTotal.vat),
        salesComplete: hasSalesDetail && zero.documents === 0 && other.documents === 0 && missing.documents === 0,
        purchasesComplete: hasPurchaseDetail && pZero.documents === 0 && pOther.documents === 0 && pMissing.documents === 0,
        reviewDocuments,
        hasSalesDetail,
        hasPurchaseDetail,
    };
}

/* ─── مطابقة الأرصدة: افتتاحي ← حركة الفترة ← ختامي ─────────────────────── */

export interface VatBalanceReconciliation {
    asOf: string;
    openingPayable: number;
    closingPayable: number;
    payableMovement: number;
    expectedPayableMovement: number;
    payableGap: number;
    openingRecoverable: number;
    closingRecoverable: number;
    recoverableMovement: number;
    expectedRecoverableMovement: number;
    recoverableGap: number;
    balanced: boolean;
}

/**
 * حركة حساب الضريبة في الفترة = ختامي − افتتاحي، وتُقارن بحركة الأستاذ
 * المتوقعة من القيود. أي فرق يعني رصيدًا افتتاحيًا غير مطابق أو حركة خارج الفترة.
 */
export function vatBalanceReconciliation(report: VatReturn): VatBalanceReconciliation | null {
    const opening = report.opening_balances;
    if (!opening) {
        return null;
    }
    const outputDebits = Number(report.output_vat_reversals ?? 0) + Number(report.unclassified_vat_movements?.output_debits ?? 0);
    const inputCredits = Number(report.input_vat_adjustments ?? 0) + Number(report.unclassified_vat_movements?.input_credits ?? 0);
    const expectedPayableMovement = round2(Number(report.output_vat ?? 0) - outputDebits);
    const expectedRecoverableMovement = round2(Number(report.input_vat ?? 0) - inputCredits);
    const payableMovement = round2(Number(report.payable_balance ?? 0) - Number(opening.payable ?? 0));
    const recoverableMovement = round2(Number(report.recoverable_balance ?? 0) - Number(opening.recoverable ?? 0));
    const payableGap = round2(payableMovement - expectedPayableMovement);
    const recoverableGap = round2(recoverableMovement - expectedRecoverableMovement);
    return {
        asOf: opening.as_of,
        openingPayable: round2(Number(opening.payable ?? 0)),
        closingPayable: round2(Number(report.payable_balance ?? 0)),
        payableMovement,
        expectedPayableMovement,
        payableGap,
        openingRecoverable: round2(Number(opening.recoverable ?? 0)),
        closingRecoverable: round2(Number(report.recoverable_balance ?? 0)),
        recoverableMovement,
        expectedRecoverableMovement,
        recoverableGap,
        balanced: Math.abs(payableGap) <= 0.01 && Math.abs(recoverableGap) <= 0.01,
    };
}

/* ─── استحقاق التقديم الإرشادي ───────────────────────────────────────────── */

/**
 * آخر يوم لتقديم الإقرار حسب الدورية — إرشادي فقط (زاتكا: الشهري 15 من الشهر
 * التالي، والربع سنوي آخر يوم من الشهر التالي لنهاية الربع). `null` لدورية غير مضبوطة.
 */
export function vatFilingDeadline(frequency: string, periodTo: string): string | null {
    const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(periodTo ?? '').trim());
    if (!match) {
        return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isFinite(year) || month < 1 || month > 12) {
        return null;
    }
    if (frequency === 'monthly') {
        return new Date(Date.UTC(year, month, 15)).toISOString().slice(0, 10);
    }
    if (frequency === 'quarterly') {
        return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
    }
    return null;
}
