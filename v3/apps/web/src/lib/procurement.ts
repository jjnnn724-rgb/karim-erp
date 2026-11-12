import { addMoney, roundHalfUp } from '@karim/shared';
import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { riyadhToday } from './finance';

/**
 * المشتريات — دليل الموردين ومدفوعاتهم من المسارات القديمة نفسها
 * (`/api/procurement/*`، انظر `frontend/app/js/v2/data/procurement-repo.js`).
 *
 * `summary` يُحسب في الخادم (مجاميع الفواتير والدفعات والمستحق) فلا نعيد
 * حسابه: القراءة فقط، والمبالغ نصوص NUMERIC أو أرقام من pg — كلاهما يمرّ
 * على `roundHalfUp` (ADR-04).
 */

const moneyValue = z.union([z.string(), z.number()]).transform((value) => String(value));

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));

const optionalText = z.string().nullable().optional();

export const supplierSchema = z
    .object({
        id: idValue,
        name: z.string(),
        phone: optionalText,
        category: optionalText,
        name_en: optionalText,
        vat_number: optionalText,
        tax_registration_status: optionalText,
        openingBalance: moneyValue.optional(),
        purchasesTotal: moneyValue.optional(),
        paymentsTotal: moneyValue.optional(),
        dueTotal: moneyValue.optional(),
        invoiceCount: z.union([z.number(), z.string()]).nullable().optional(),
        lastPurchaseDate: optionalText,
        is_active: z.union([z.boolean(), z.number(), z.string()]).nullable().optional(),
    })
    .passthrough();

export type Supplier = z.infer<typeof supplierSchema>;

const supplierListSchema = z
    .union([z.array(supplierSchema), z.object({ data: z.array(supplierSchema) }).passthrough()])
    .transform((body) => (Array.isArray(body) ? body : body.data));

export const procurementSummarySchema = z
    .object({
        activeSuppliers: z.coerce.number(),
        totalSuppliers: z.coerce.number(),
        purchasesTotal: moneyValue,
        paymentsTotal: moneyValue,
        dueTotal: moneyValue,
        unpaidInvoices: z.coerce.number(),
        invoicesRemaining: moneyValue,
    })
    .passthrough();

export type ProcurementSummary = z.infer<typeof procurementSummarySchema>;

export const paymentSchema = z
    .object({
        id: idValue,
        supplierId: idValue.nullable().optional(),
        supplierName: optionalText,
        amount: moneyValue,
        method: optionalText,
        date: z.string().transform((value) => value.slice(0, 10)),
        invoiceId: idValue.nullable().optional(),
        notes: optionalText,
        createdBy: optionalText,
    })
    .passthrough();

export type Payment = z.infer<typeof paymentSchema>;

const paymentListSchema = z
    .union([z.array(paymentSchema), z.object({ data: z.array(paymentSchema) }).passthrough()])
    .transform((body) => (Array.isArray(body) ? body : body.data));

/** الحالة الضريبية كما يسمّيها الخادم — بلا إعادة تسمية. */
export const TAX_STATUS_LABEL = {
    REGISTERED: 'مسجل ضريبيًا',
    NOT_REGISTERED: 'غير مسجل',
} as const;

/** كلمات طرق الدفع من قاموس التطبيق نفسه (`PCMT_PAY_LABELS`). */
export const PAYMENT_METHOD_AR: Record<string, string> = {
    cash: 'نقدي',
    bank: 'تحويل بنكي',
    card: 'بطاقة',
    cheque: 'شيك',
    credit: 'آجل',
};

export function isSupplierActive(supplier: Supplier): boolean {
    const value = supplier.is_active;
    return !(value === false || value === 'false' || value === 0 || value === '0');
}

export function supplierStatusLabel(supplier: Supplier): string {
    return isSupplierActive(supplier) ? 'نشط' : 'موقوف';
}

export function paymentMethodLabel(method: string | null | undefined): string {
    const key = String(method ?? '');
    return PAYMENT_METHOD_AR[key] ?? key;
}

/* ─── جلب ─────────────────────────────────────────────────────────────── */

export async function fetchProcurementSummary(signal?: AbortSignal): Promise<ProcurementSummary> {
    return fetchJson(procurementSummarySchema, '/api/procurement/summary', getAccessToken(), signal ? { signal } : {});
}

export async function fetchSuppliers(signal?: AbortSignal): Promise<Supplier[]> {
    return fetchJson(supplierListSchema, '/api/procurement/suppliers', getAccessToken(), signal ? { signal } : {});
}

/**
 * `from`/`to`/`supplierId` تصفيةٌ في SQL عند الخادم (نفس مسار القديم)،
 * وسقف 500 صفّ من الخادم نفسه — الشاشة تصرّح به عند بلوغه.
 */
export async function fetchSupplierPayments(
    filters: { supplierId?: string; from?: string; to?: string } = {},
    signal?: AbortSignal,
): Promise<Payment[]> {
    const params = new URLSearchParams();
    if (filters.supplierId) {
        params.set('supplierId', filters.supplierId);
    }
    if (filters.from) {
        params.set('from', filters.from);
    }
    if (filters.to) {
        params.set('to', filters.to);
    }
    const query = params.toString();
    return fetchJson(paymentListSchema, `/api/procurement/payments${query ? `?${query}` : ''}`, getAccessToken(), signal ? { signal } : {});
}

/* ─── عرض ─────────────────────────────────────────────────────────────── */

export function moneyOf(value: string | undefined): string {
    return roundHalfUp(value ?? '0', 2);
}

export function sumMoney(values: readonly (string | undefined)[]): string {
    return values.reduce<string>((sum, value) => addMoney(sum, moneyOf(value)), '0.00');
}

/** اليوم قبل `days` يومًا في الرياض — نافذة المدفوعات 30 يومًا كما في القديم. */
export function riyadhDaysAgo(days: number, today = riyadhToday()): string {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
}

export const PAYMENTS_WINDOW_DAYS = 29;
