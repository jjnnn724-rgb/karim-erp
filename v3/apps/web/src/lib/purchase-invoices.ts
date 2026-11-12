import { addMoney, fromCents, roundHalfUp, toCents } from '@karim/shared';
import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * فواتير الشراء — قراءة فقط من المسار القديم نفسه
 * (`/api/purchaseInvoices`، انظر `frontend/app/js/v2/data/purchase-invoices-repo.js`).
 *
 * السجل يجلب كل الصفحات (5 × 1000) **بلا `v2_period=month`**: القديم حرّر
 * الشاشة من حبس الشهر الحالي في 2026-11-01، والفلترة الدقيقة عند العميل
 * بحقلَي from/to — كل حساب المال نصّي على المليم (ADR-04) بلا Float.
 *
 * الملف لا يكتب: لا POST/PUT/DELETE هنا بالتصميم.
 */

const moneyValue = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined ? '0' : String(value)));

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));

const optionalText = z.string().nullable().optional();

export const purchaseInvoiceSchema = z
    .object({
        id: idValue,
        invoiceNumber: optionalText,
        date: z
            .string()
            .nullable()
            .optional()
            .transform((value) => String(value ?? '').slice(0, 10)),
        supplierId: z
            .union([z.string(), z.number()])
            .nullable()
            .optional()
            .transform((value) => (value === null || value === undefined || value === '' ? null : String(value))),
        supplierName: optionalText,
        supplier_name_snapshot: optionalText,
        totalAmount: moneyValue,
        paidAmount: moneyValue,
        paymentStatus: optionalText,
        paymentMethod: optionalText,
    })
    .passthrough();

export type PurchaseInvoice = z.infer<typeof purchaseInvoiceSchema>;

const paginationSchema = z
    .object({
        total: z.number().optional(),
        totalPages: z.number().optional(),
    })
    .passthrough();

const invoicePageSchema = z
    .union([
        z.array(purchaseInvoiceSchema),
        z
            .object({
                data: z.array(purchaseInvoiceSchema),
                pagination: paginationSchema.optional(),
            })
            .passthrough(),
    ])
    .transform((body) => (Array.isArray(body) ? body : body.data));

export const PAGE_SIZE = 1000;
export const MAX_PAGES = 5;

/** كلمات حالة الدفع كما في تقرير القديم — الحالة المجهولة تُعرض بمفتاحها. */
export const PAYMENT_STATUS_AR: Record<string, string> = {
    paid: 'مسددة',
    partial: 'جزئية',
    unpaid: 'غير مسددة',
};

/** كلمات طرق الدفع الخاصة بهذه الصفحة (بنكي ≠ تحويل بنكي في صفحة الموردين). */
export const INVOICE_METHOD_AR: Record<string, string> = {
    cash: 'نقدي',
    bank: 'بنكي',
    card: 'بطاقة',
    cheque: 'شيك',
    credit: 'آجل',
};

/**
 * سجل الفواتير كامل الصفحات — الترتيب `id desc` كما يقرأ القديم، والفلترة
 * الزمنية عند العميل حتى لا يعتمد المجموع على شهرٍ بعينه.
 */
export async function fetchPurchaseInvoices(signal?: AbortSignal): Promise<PurchaseInvoice[]> {
    const rows: PurchaseInvoice[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await fetchJson(
            invoicePageSchema,
            `/api/purchaseInvoices?page=${String(page)}&limit=${String(PAGE_SIZE)}&sort=id&order=desc`,
            getAccessToken(),
            signal ? { signal } : {},
        );
        rows.push(...body);
        if (body.length < PAGE_SIZE) {
            break;
        }
    }
    return rows;
}

/* ─── عرض ─────────────────────────────────────────────────────────────── */

function moneyOf(value: string | undefined): string {
    return roundHalfUp(value ?? '0', 2);
}

/** المتبقي — قاعدة القديم حرفيًا (`max(0, total - paid)`)، بحساب المليم. */
export function invoiceRemaining(invoice: PurchaseInvoice): string {
    const total = toCents(moneyOf(invoice.totalAmount));
    const paid = toCents(moneyOf(invoice.paidAmount));
    const remaining = total - paid;
    return fromCents(remaining > 0n ? remaining : 0n);
}

export type PurchaseInvoiceRow = {
    id: string;
    number: string;
    date: string;
    supplierId: string | null;
    supplier: string;
    supplierResolved: boolean;
    total: string;
    paid: string;
    remaining: string;
    status: string;
    statusLabel: string;
    statusKnown: boolean;
    method: string;
    methodLabel: string;
};

/**
 * صفّ السجل. اسم المورد بالأفضلية نفسها: الدليل الحيّ ← لقطة الفاتورة ←
 * الاسم المكتوب ← المعرّف. الصفّ يعرض ما قرأه، لا يخمّن.
 */
export function invoiceToRow(invoice: PurchaseInvoice, supplierById: ReadonlyMap<string, string> = new Map()): PurchaseInvoiceRow {
    const live = invoice.supplierId ? supplierById.get(invoice.supplierId) : undefined;
    const supplier =
        live || invoice.supplier_name_snapshot || invoice.supplierName || (invoice.supplierId ? `#${invoice.supplierId}` : '—');
    const status = invoice.paymentStatus ? String(invoice.paymentStatus) : 'unpaid';
    const method = invoice.paymentMethod ? String(invoice.paymentMethod) : '';
    return {
        id: invoice.id,
        number: invoice.invoiceNumber ? String(invoice.invoiceNumber) : `#${invoice.id}`,
        date: invoice.date,
        supplierId: invoice.supplierId,
        supplier,
        supplierResolved: Boolean(live),
        total: moneyOf(invoice.totalAmount),
        paid: moneyOf(invoice.paidAmount),
        remaining: invoiceRemaining(invoice),
        status,
        statusLabel: PAYMENT_STATUS_AR[status] ?? status,
        statusKnown: Object.hasOwn(PAYMENT_STATUS_AR, status),
        method,
        methodLabel: method ? (INVOICE_METHOD_AR[method] ?? method) : '—',
    };
}

export function supplierNameMap(suppliers: readonly { id: string; name: string }[]): Map<string, string> {
    return new Map(suppliers.map((supplier) => [String(supplier.id), supplier.name]));
}

export type InvoiceTotals = {
    count: number;
    suppliers: number;
    total: string;
    paid: string;
    remaining: string;
};

export function invoiceTotals(rows: readonly PurchaseInvoiceRow[]): InvoiceTotals {
    let total = '0.00';
    let paid = '0.00';
    let remaining = '0.00';
    for (const row of rows) {
        total = addMoney(total, row.total);
        paid = addMoney(paid, row.paid);
        remaining = addMoney(remaining, row.remaining);
    }
    return {
        count: rows.length,
        suppliers: new Set(rows.map((row) => row.supplier)).size,
        total,
        paid,
        remaining,
    };
}
