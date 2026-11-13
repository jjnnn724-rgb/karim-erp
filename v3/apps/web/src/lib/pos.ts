import { z } from 'zod';
import { ApiError, fetchJson } from './api';
import { getAccessToken, getAppKey } from './auth';
import { type DayClose, dayCloseSchema } from './cfo';
import type { PosSaleItem } from './pos-pricing';

/**
 * أبواب الكاشير — عقود `/api/pos/*` و`/api/sales/complete` كما يرسلها
 * `backend/cashier-module`، لا كما يخمّنها العميل.
 *
 * المصدر الحرفي المقابل في V2:
 *   `v2/data/pos-v2-repo.js`، `v2/screens/pos-entry.js`،
 *   `v2/data/pos-buffet-repo.js`، و`v2/data/cfo-repo.js` (إقفال اليوم).
 *
 * الخادم هو الحاكم في المخزون والضريبة والفاتورة والوردية؛ هذه الطبقة تقرأ
 * وترسل فقط، وكل استجابة تُتحقَّق قبل أن تلمسها الشاشة.
 */

const numberish = z.union([z.string(), z.number()]);

const num = numberish.transform((value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
});

const numOrNull = numberish
    .nullable()
    .optional()
    .transform((value) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    });

const idText = numberish.transform((value) => String(value));
const text = z.string().nullable().optional();
const flag = z.boolean().nullable().optional();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* ─── الأقسام والأصناف ─────────────────────────────────────────────────── */

export const posDepartmentSchema = z
    .object({
        id: idText,
        code: z.string(),
        name_ar: text,
        name_en: text,
        is_active: flag,
        vat_number: text,
    })
    .passthrough();

export type PosDepartment = z.infer<typeof posDepartmentSchema>;

export const posProductSchema = z
    .object({
        id: idText,
        name_ar: text,
        name_en: text,
        barcode: text,
        price: num,
        cost_price: numOrNull,
        stock_quantity: numOrNull,
        vat_rate: num,
        category: text,
        unit: text,
        department_id: idText.nullable().optional(),
        is_active: flag,
        min_stock_level: numOrNull,
        image_url: text,
        ingredient_count: numOrNull,
        metadata: z.record(z.string(), z.unknown()).optional(),
        department_ids: z.array(idText).optional(),
    })
    .passthrough();

export type PosProduct = z.infer<typeof posProductSchema>;

/** صفوف كشف أصناف الكاشيريات: التجميع برمز الصنف لا باسمه. */
export const cashierSalesItemSchema = z
    .object({
        code: text,
        name: text,
        qty: num,
    })
    .passthrough();

const cashierSalesItemsSchema = z
    .object({
        rows: z.array(cashierSalesItemSchema),
    })
    .passthrough();

/* ─── الوردية ──────────────────────────────────────────────────────────── */

export const activeShiftSchema = z
    .object({
        id: idText,
        session_id: idText.optional(),
        department_id: idText,
        cashier_id: idText.optional(),
        status: z.string(),
        opening_balance: num,
        opened_at: text,
        dept_name: text,
        dept_code: text,
    })
    .passthrough();

export type ActiveShiftRow = z.infer<typeof activeShiftSchema>;

export interface ActiveShift {
    sessionId: string;
    departmentId: string;
    deptName: string;
    deptCode: string;
    openingBalance: number;
    openedAt: string;
    /** يوم فتح الوردية بتوقيت الرياض (`YYYY-MM-DD`)، أو '' إن كان التاريخ غير صالح. */
    openedOn: string;
    /** وردية يوم سابق: الخادم يرفض البيع عليها بـ409 SHIFT_STALE حتى تُغلق. */
    isStale: boolean;
}

/** يوم تقويمي بتوقيت الرياض — نافذة البيع اليومية يحكمها الخادم بهذا التوقيت. */
export function posDayKey(value: string | null | undefined): string {
    if (!value) {
        return '';
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }
    return parsed.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
}

export function activeShiftOf(row: ActiveShiftRow): ActiveShift {
    const openedOn = posDayKey(row.opened_at);
    return {
        sessionId: String(row.session_id ?? row.id),
        departmentId: String(row.department_id),
        deptName: String(row.dept_name ?? ''),
        deptCode: String(row.dept_code ?? ''),
        openingBalance: row.opening_balance,
        openedAt: String(row.opened_at ?? ''),
        openedOn,
        isStale: Boolean(openedOn) && openedOn !== riyadhToday(),
    };
}

export const shiftSummarySchema = z
    .object({
        id: idText,
        department_id: idText,
        opening_balance: num,
        dept_name: text,
        cash_in: num,
        cash_out: num,
        card_in: num,
        wallet_in: num,
        invoice_count: num,
        sales_total: num,
        discount_total: num,
        tax_total: num,
        voided_count: num,
        voided_amount: num,
    })
    .passthrough();

export type ShiftSummary = z.infer<typeof shiftSummarySchema>;

/** النقد المتوقع = العهدة + داخل نقدي − خارج نقدي (نفس حساب خادم الإغلاق). */
export function expectedCash(summary: ShiftSummary): number {
    return Math.round((summary.opening_balance + summary.cash_in - summary.cash_out) * 100) / 100;
}

export const closeShiftResultSchema = z
    .object({
        session_id: num,
        status: z.string(),
        opening_balance: num,
        expected_cash: num,
        actual_cash: num,
        cash_variance: num,
        closed_at: text,
    })
    .passthrough();

export type CloseShiftResult = z.infer<typeof closeShiftResultSchema>;

export const openShiftResultSchema = z
    .object({
        session_id: idText,
        status: z.string(),
        opening_balance: num,
        new_session: flag,
    })
    .passthrough();

export type OpenShiftResult = z.infer<typeof openShiftResultSchema>;

/* ─── الطلبات المعلقة ──────────────────────────────────────────────────── */

export const heldItemSchema = z
    .object({
        product_id: idText,
        name: text,
        barcode: text,
        quantity: num,
        unit_price: num,
        discount: num,
        vat_rate: num,
    })
    .passthrough();

export type HeldItem = z.infer<typeof heldItemSchema>;

export const heldCartDiscountSchema = z
    .object({
        type: z.enum(['percent', 'fixed']),
        value: numberish,
    })
    .passthrough();

export const heldOrderSchema = z
    .object({
        id: idText,
        created_at: text,
        total_amount: num,
        items_preview: text,
        items: z.array(heldItemSchema).optional(),
        cart_discount: heldCartDiscountSchema.nullable().optional(),
    })
    .passthrough();

export type HeldOrder = z.infer<typeof heldOrderSchema>;

export const heldOrdersSchema = z.array(heldOrderSchema);

export const heldInsertResultSchema = z
    .object({
        id: idText,
        created_at: text,
        total_amount: num,
    })
    .passthrough();

export const recallResultSchema = z
    .object({
        id: idText,
        items: z.array(heldItemSchema),
        cart_discount: heldCartDiscountSchema.nullable().optional(),
        total_amount: num,
    })
    .passthrough();

export type RecallResult = z.infer<typeof recallResultSchema>;

/* ─── سجل الفواتير ─────────────────────────────────────────────────────── */

export const orderPaymentSchema = z
    .object({
        method: text,
        amount: num,
        reference: text,
    })
    .passthrough();

/** أعمدة `po.*` المشتركة بين القائمة (مع `item_count`) والتفصيل (مع البنود). */
const orderBaseSchema = z
    .object({
        id: idText,
        invoice_counter: numOrNull,
        invoice_uuid: text,
        status: text,
        subtotal: num,
        discount_total: num,
        tax_total: num,
        total_amount: num,
        currency_code: text,
        notes: text,
        void_reason: text,
        created_at: text,
        updated_at: text,
        department_name: text,
        department_name_en: text,
        cashier_name: text,
        cashier_id: idText.nullable().optional(),
        session_id: idText.nullable().optional(),
    })
    .passthrough();

export const orderRowSchema = orderBaseSchema.extend({
    item_count: num,
    payments: z.array(orderPaymentSchema).nullable().optional(),
});

export type PosOrderRow = z.infer<typeof orderRowSchema>;

export const orderItemSchema = z
    .object({
        id: idText,
        order_id: idText.optional(),
        product_id: idText.optional(),
        product_name: text,
        product_barcode: text,
        quantity: num,
        unit_price: num,
        discount: num,
        vat_rate: num,
        line_total: num,
        vat_amount: num,
    })
    .passthrough();

export type PosOrderItem = z.infer<typeof orderItemSchema>;

export const printJobSchema = z
    .object({
        id: idText,
        status: text,
        attempts: numOrNull,
        completed_at: text,
        last_error: text,
    })
    .passthrough();

export const orderDetailSchema = orderBaseSchema.extend({
    items: z.array(orderItemSchema),
    payments: z.array(orderPaymentSchema).optional(),
    print_jobs: z.array(printJobSchema).optional(),
    vat_number: text,
});

export type PosOrderDetail = z.infer<typeof orderDetailSchema>;

export const orderPageSchema = z
    .object({
        data: z.array(orderRowSchema),
        pagination: z
            .object({
                page: num,
                limit: num,
                total: num,
                totalPages: num,
            })
            .passthrough(),
    })
    .passthrough();

export type PosOrderPage = z.infer<typeof orderPageSchema>;

/* ─── إتمام البيع ──────────────────────────────────────────────────────── */

export const saleResultSchema = z
    .object({
        order_id: idText,
        invoice_counter: numOrNull,
        invoice_uuid: text,
        invoice_hash: text,
        qr_payload: text,
        digital_signature: text,
        total_amount: num,
        tax_total: num,
        subtotal: num,
        discount_total: num,
        paid: num,
        change: num,
        non_cash_overpayment: numOrNull,
        print_job_id: idText.nullable().optional(),
        zatca_queued: flag,
        kot_enabled: flag,
        kot_jobs: z.array(z.unknown()).nullable().optional(),
        session_id: idText.nullable().optional(),
        erp_revenue_id: idText.nullable().optional(),
        erp_dept_code: text,
        buffet: z
            .object({
                persons_total: num,
                tiers: z
                    .array(
                        z
                            .object({
                                name: text,
                                persons: num,
                                unit_price: num,
                                amount: num,
                            })
                            .passthrough(),
                    )
                    .optional(),
            })
            .passthrough()
            .nullable()
            .optional(),
        party_name: text,
    })
    .passthrough();

export type PosSaleResult = z.infer<typeof saleResultSchema>;

/** بيانات إضافية للدفع بالكريدت — تُرسل كما هي في `payer_info` للخادم. */
export interface PosPaymentMeta {
    brand?: string;
    last4?: string;
}

export interface PosPaymentInput {
    method: 'cash' | 'card' | 'wallet' | 'bank_transfer';
    amount: number;
    reference: string | null;
    /** يُسجَّل في عمود `payer_info` jsonb — العميل لا يعبئه يدويًا. */
    payer_info?: PosPaymentMeta | null;
}

export interface CompleteSaleInput {
    departmentId: string;
    sessionId: string;
    items: PosSaleItem[];
    payments: PosPaymentInput[];
    idempotencyKey: string;
}

/* ─── البوفيه ──────────────────────────────────────────────────────────── */

const BUFFET_CODES = ['erp_open_buffet', 'open_buffet'];

export function isBuffetDepartment(department: {
    code?: string | null;
    deptCode?: string | null;
    deptName?: string | null;
    name_ar?: string | null;
    name_en?: string | null;
}): boolean {
    const code = String(department.code ?? department.deptCode ?? '')
        .trim()
        .toLowerCase();
    if (BUFFET_CODES.includes(code)) {
        return true;
    }
    const name = `${department.name_ar ?? department.deptName ?? ''} ${department.name_en ?? ''}`.toLowerCase();
    return name.includes('بوفيه') || name.includes('buffet');
}

export const buffetTierSchema = z
    .object({
        id: idText,
        tier: text,
        name_ar: text,
        price: num,
        vat_rate: num,
        unit: text,
        is_core: flag,
        is_active: flag,
    })
    .passthrough();

export type BuffetTier = z.infer<typeof buffetTierSchema>;

export const buffetConfigSchema = z
    .object({
        tiers: z.array(buffetTierSchema),
    })
    .passthrough();

export type BuffetConfig = z.infer<typeof buffetConfigSchema>;

export const buffetLiveSchema = z
    .object({
        daily: z
            .object({
                covers_total: numOrNull,
                revenue: numOrNull,
                invoices_count: numOrNull,
                voided: z.object({ count: numOrNull, amount: numOrNull }).passthrough().nullable().optional(),
            })
            .passthrough(),
        shift: z
            .object({
                session_id: idText.optional(),
                covers_total: numOrNull,
                held_orders: numOrNull,
                // الخادم لا يرسل إيراد الوردية في `/buffet/live` — الإيراد في `daily`
                revenue: numOrNull,
            })
            .passthrough()
            .nullable()
            .optional(),
    })
    .passthrough();

export type BuffetLive = z.infer<typeof buffetLiveSchema>;

const buffetBucketSchema = z
    .object({
        count: numOrNull,
        amount: numOrNull,
    })
    .passthrough();

export const buffetReportSchema = z
    .object({
        date: z.string(),
        generated_at: text,
        totals: z
            .object({
                covers_total: numOrNull,
                revenue: numOrNull,
                vat_total: numOrNull,
                net_revenue: numOrNull,
                invoices: numOrNull,
                revenue_per_cover: numOrNull,
                voided: buffetBucketSchema.nullable().optional(),
                still_held: buffetBucketSchema.nullable().optional(),
            })
            .passthrough(),
        tiers: z.array(
            z
                .object({
                    name: text,
                    covers: numOrNull,
                    revenue: numOrNull,
                    avg_price: numOrNull,
                    invoices: numOrNull,
                })
                .passthrough(),
        ),
        hourly: z.array(
            z
                .object({
                    hour: numOrNull,
                    invoices: numOrNull,
                    covers: numOrNull,
                    revenue: numOrNull,
                })
                .passthrough(),
        ),
        payments: z.array(
            z
                .object({
                    method: text,
                    count: numOrNull,
                    total: numOrNull,
                })
                .passthrough(),
        ),
        cashiers: z.array(
            z
                .object({
                    cashier: text,
                    invoices: numOrNull,
                    revenue: numOrNull,
                })
                .passthrough(),
        ),
    })
    .passthrough();

export type BuffetReport = z.infer<typeof buffetReportSchema>;

/** صف فاتورة البوفيه أخف من صف السجل: بلا `subtotal`/`item_count`، ومع `covers`. */
export const buffetInvoiceRowSchema = z
    .object({
        id: idText,
        invoice_counter: numOrNull,
        status: text,
        total_amount: num,
        tax_total: num,
        discount_total: num,
        party_name: text,
        created_at: text,
        voided_at: text,
        cashier_name: text,
        session_id: idText.nullable().optional(),
        covers: z
            .object({
                covers_total: numOrNull,
                tiers: z.record(z.string(), z.object({ name: text, covers: numOrNull, amount: numOrNull }).passthrough()).optional(),
            })
            .passthrough()
            .nullable()
            .optional(),
    })
    .passthrough();

export type BuffetInvoiceRow = z.infer<typeof buffetInvoiceRowSchema>;

export const buffetInvoicesSchema = z.object({ data: z.array(buffetInvoiceRowSchema) }).passthrough();

export type BuffetInvoices = z.infer<typeof buffetInvoicesSchema>;

/* ─── النقل ────────────────────────────────────────────────────────────── */

function token(): string | null {
    return getAccessToken();
}

/** `exactOptionalPropertyTypes` يرفض `{signal: undefined}`؛ نمرّر الحقل عند وجوده فقط. */
function opts(signal?: AbortSignal): { signal?: AbortSignal } {
    return signal ? { signal } : {};
}

function deviceName(departmentId?: string): string {
    let device = 'POS terminal';
    try {
        const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
        device = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows PC' : device;
    } catch {
        // webview بلا navigator
    }
    const dept = Number(departmentId);
    return `POS (${device}${Number.isInteger(dept) && dept > 0 ? ` dept-${dept}` : ''})`;
}

function deviceHeaders(departmentId?: string): Record<string, string> {
    return { 'x-device-name': deviceName(departmentId) };
}

export async function fetchPosDepartments(signal?: AbortSignal): Promise<PosDepartment[]> {
    return fetchJson(z.array(posDepartmentSchema), '/api/pos/departments', token(), opts(signal));
}

export async function fetchPosProducts(departmentId: string, signal?: AbortSignal): Promise<PosProduct[]> {
    const id = Number(departmentId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('القسم المحدد غير صالح');
    }
    return fetchJson(z.array(posProductSchema), `/api/pos/products?department_id=${String(id)}`, token(), opts(signal));
}

/** كميات الأصناف المباعة برمز Yara خلال نافذة أيام — أساس الترتيب الذكي للكتالوج. */
export async function fetchSalesQuantities(days: number, signal?: AbortSignal): Promise<Record<string, number>> {
    const span = Math.max(1, Math.min(31, Math.trunc(days)));
    const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const to = day(new Date());
    const from = day(new Date(Date.now() - (span - 1) * 86_400_000));
    const result = await fetchJson(
        cashierSalesItemsSchema,
        `/api/cashier-sales/items?from=${from}&to=${to}&sort=qty&dir=desc&limit=1000`,
        token(),
        opts(signal),
    );
    const index: Record<string, number> = {};
    for (const row of result.rows) {
        const code = String(row.code ?? '').trim();
        const qty = Number(row.qty);
        if (code && Number.isFinite(qty) && qty > 0) index[code] = qty;
    }
    return index;
}

/** الوردية المفتوحة للحساب؛ غيابها حالة طبيعية (null) لا خطأ. */
export async function fetchActiveShift(signal?: AbortSignal): Promise<ActiveShift | null> {
    try {
        const row = await fetchJson(activeShiftSchema, '/api/pos/shifts/active', token(), opts(signal));
        return activeShiftOf(row);
    } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
            return null;
        }
        throw error;
    }
}

export async function openPosShift(departmentId: string, openingBalance: number): Promise<ActiveShift> {
    const dept = Number(departmentId);
    if (!Number.isInteger(dept) || dept <= 0) {
        throw new Error('اختر قسمًا صالحًا لفتح الوردية');
    }
    if (!Number.isFinite(openingBalance) || openingBalance < 0) {
        throw new Error('العهدة الافتتاحية غير صالحة');
    }
    const row = await fetchJson(openShiftResultSchema, '/api/pos/shifts/open', token(), {
        method: 'POST',
        headers: deviceHeaders(departmentId),
        body: { department_id: dept, opening_balance: openingBalance },
    });
    return {
        sessionId: String(row.session_id),
        departmentId: String(dept),
        deptName: '',
        deptCode: '',
        openingBalance: row.opening_balance,
        openedAt: '',
        openedOn: riyadhToday(),
        isStale: false,
    };
}

export async function fetchShiftSummary(sessionId: string, signal?: AbortSignal): Promise<ShiftSummary> {
    const id = Number(sessionId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('رقم الوردية غير صالح');
    }
    return fetchJson(shiftSummarySchema, `/api/pos/shifts/${String(id)}/summary`, token(), opts(signal));
}

export async function closePosShift(sessionId: string, actualCash: number, notes: string): Promise<CloseShiftResult> {
    const id = Number(sessionId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('رقم الوردية غير صالح');
    }
    if (!Number.isFinite(actualCash) || actualCash < 0) {
        throw new Error('النقد الفعلي غير صالح');
    }
    return fetchJson(closeShiftResultSchema, `/api/pos/shifts/${String(id)}/close`, token(), {
        method: 'POST',
        headers: deviceHeaders(),
        body: { actual_cash: actualCash, notes: notes.trim() || null },
    });
}

export async function fetchHeldOrders(sessionId: string, signal?: AbortSignal): Promise<HeldOrder[]> {
    const id = Number(sessionId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('رقم الوردية غير صالح');
    }
    return fetchJson(heldOrdersSchema, `/api/pos/held-orders?session_id=${String(id)}`, token(), opts(signal));
}

export async function holdPosOrder(input: {
    sessionId: string;
    departmentId: string;
    items: Array<{ product_id: number; quantity: number; unit_price: number; discount: number }>;
    cartDiscount: { type: 'percent' | 'fixed'; value: number } | null;
}): Promise<z.infer<typeof heldInsertResultSchema>> {
    const shift = Number(input.sessionId);
    const dept = Number(input.departmentId);
    if (!Number.isInteger(shift) || shift <= 0 || !Number.isInteger(dept) || dept <= 0) {
        throw new Error('القسم أو الوردية غير صالح');
    }
    if (!input.items.length) {
        throw new Error('أضف صنفًا قبل تعليق الطلب');
    }
    return fetchJson(heldInsertResultSchema, '/api/pos/held-orders', token(), {
        method: 'POST',
        headers: deviceHeaders(input.departmentId),
        body: { session_id: shift, department_id: dept, items: input.items, cart_discount: input.cartDiscount },
    });
}

export async function recallHeldOrder(orderId: string, sessionId: string): Promise<RecallResult> {
    const id = String(orderId).trim();
    const shift = Number(sessionId);
    if (!id || !Number.isInteger(shift) || shift <= 0) {
        throw new Error('الطلب أو الوردية غير صالح');
    }
    return fetchJson(recallResultSchema, `/api/pos/held-orders/${encodeURIComponent(id)}/recall`, token(), {
        method: 'POST',
        headers: deviceHeaders(),
        body: { session_id: shift },
    });
}

export async function deleteHeldOrder(orderId: string, sessionId: string): Promise<void> {
    const id = String(orderId).trim();
    const shift = Number(sessionId);
    if (!id || !Number.isInteger(shift) || shift <= 0) {
        throw new Error('الطلب أو الوردية غير صالح');
    }
    await fetchJson(z.object({}).passthrough(), `/api/pos/held-orders/${encodeURIComponent(id)}?session_id=${String(shift)}`, token(), {
        method: 'DELETE',
        headers: deviceHeaders(),
    });
}

export interface PosOrderFilters {
    page?: number;
    limit?: number;
    dateFrom?: string;
    dateTo?: string;
    status?: '' | 'issued' | 'reported' | 'cancelled';
    search?: string;
}

export async function fetchPosOrders(filters: PosOrderFilters, signal?: AbortSignal): Promise<PosOrderPage> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    if (!Number.isInteger(page) || page < 1) {
        throw new Error('رقم صفحة سجل الفواتير غير صالح');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('حجم صفحة سجل الفواتير غير صالح');
    }
    if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
        throw new Error('تاريخ البداية يجب ألا يتجاوز تاريخ النهاية');
    }
    const query = new URLSearchParams({ page: String(page), limit: String(limit), sort: 'created_at', order: 'DESC' });
    if (filters.dateFrom) {
        query.set('date_from', filters.dateFrom);
    }
    if (filters.dateTo) {
        query.set('date_to', filters.dateTo);
    }
    if (filters.status) {
        query.set('status', filters.status);
    }
    const term = String(filters.search ?? '')
        .trim()
        .slice(0, 100);
    if (term) {
        query.set('search', term);
    }
    return fetchJson(orderPageSchema, `/api/pos/orders?${query.toString()}`, token(), opts(signal));
}

/**
 * إيصال البيع HTML من الخادم — المصدر الوحيد لقالب الإيصال في كل المسارات
 * (الشراء، إعادة الطباعة من السجل، الطباعة من شاشة الإتمام). يعود الخادم
 * بوثيقة كاملة؛ لا تُغلف بمستند آخر.
 */
export async function fetchPosOrderReceiptHtml(orderId: string): Promise<string> {
    const id = String(orderId).trim();
    if (!UUID_PATTERN.test(id)) {
        throw new Error('معرّف الفاتورة غير صالح');
    }
    const body = await fetchJson(
        z.object({ html: z.string().min(1) }).passthrough(),
        `/api/pos/orders/${encodeURIComponent(id)}/receipt-html`,
        token(),
        opts(),
    );
    return body.html;
}

export async function fetchPosOrder(orderId: string, signal?: AbortSignal): Promise<PosOrderDetail> {
    const id = String(orderId).trim();
    if (!UUID_PATTERN.test(id)) {
        throw new Error('معرّف الفاتورة غير صالح');
    }
    return fetchJson(orderDetailSchema, `/api/pos/orders/${encodeURIComponent(id)}`, token(), opts(signal));
}

const reprintAckSchema = z.object({ message: z.string().optional() }).passthrough();
export type ReprintAck = z.infer<typeof reprintAckSchema>;

const voidAckSchema = z.object({ message: z.string().optional(), status: z.string().optional(), refund_total: numOrNull }).passthrough();
export type VoidAck = z.infer<typeof voidAckSchema>;

export async function reprintPosOrder(orderId: string): Promise<ReprintAck> {
    const id = String(orderId).trim();
    if (!UUID_PATTERN.test(id)) {
        throw new Error('معرّف الفاتورة غير صالح');
    }
    return fetchJson(reprintAckSchema, `/api/pos/orders/${encodeURIComponent(id)}/reprint`, token(), {
        method: 'POST',
        headers: deviceHeaders(),
    });
}

export async function voidPosOrder(orderId: string, reason: string): Promise<VoidAck> {
    const id = String(orderId).trim();
    const note = String(reason).trim();
    if (!UUID_PATTERN.test(id)) {
        throw new Error('معرّف الفاتورة غير صالح');
    }
    if (!note || note.length > 500) {
        throw new Error('سبب الإلغاء مطلوب (حتى 500 حرف)');
    }
    return fetchJson(voidAckSchema, `/api/pos/orders/${encodeURIComponent(id)}/void`, token(), {
        method: 'POST',
        headers: deviceHeaders(),
        body: { reason: note },
    });
}

const drawerAckSchema = z.object({ ok: z.literal(true), printer_id: idText, at: text }).passthrough();

export interface DrawerAck {
    printerId: string;
    at: string;
}

/** فتح درج النقدية بلا بيع — الخادم يرسل نبضة ESC/POS ويكتب أثر تدقيق. */
export async function openPosDrawer(sessionId: string): Promise<DrawerAck> {
    const id = Number(sessionId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('معرّف الوردية غير صالح');
    }
    const row = await fetchJson(drawerAckSchema, '/api/pos/drawer/open', token(), {
        method: 'POST',
        headers: { ...deviceHeaders(), 'X-Shift-Session-Id': String(id) },
        body: {},
    });
    return { printerId: String(row.printer_id), at: String(row.at ?? '') };
}

/**
 * معاينة الفاتورة من الخادم — نفس محرّك `/api/sales/complete` ونفس حرّاسه
 * (السعر، الخصم، التوازن) لكن بلا أي كتابة. الشاشة تعرض التقدير المحلي فورًا
 * ثم تُطابقه بهذا الرد فلا يرى الكاشير رقمًا ثم يُسجَّل رقم آخر.
 */
export const posQuoteSchema = z.object({
    quote: z.literal(true),
    subtotal: z.number(),
    discount_total: z.number(),
    tax_total: z.number(),
    total_amount: z.number(),
    line_items: z.array(
        z.object({
            product_id: numberish,
            quantity: z.number(),
            unit_price: z.number(),
            discount: z.number(),
            vat_rate: z.number(),
            line_total: z.number(),
            vat_amount: z.number(),
            line_total_incl: z.number(),
        }),
    ),
});

export type PosQuote = z.infer<typeof posQuoteSchema>;

export async function fetchPosQuote(departmentId: string | number, items: PosSaleItem[], signal?: AbortSignal): Promise<PosQuote> {
    const dept = Number(departmentId);
    return fetchJson(posQuoteSchema, '/api/sales/quote', token(), {
        method: 'POST',
        body: {
            ...(Number.isInteger(dept) && dept > 0 ? { department_id: dept } : {}),
            items,
        },
        ...(signal ? { signal } : {}),
    });
}

export async function completePosSale(input: CompleteSaleInput): Promise<PosSaleResult> {
    const dept = Number(input.departmentId);
    const shift = Number(input.sessionId);
    if (!Number.isInteger(dept) || dept <= 0 || !Number.isInteger(shift) || shift <= 0) {
        throw new Error('القسم أو الوردية غير صالح');
    }
    if (!input.items.length) {
        throw new Error('أضف صنفًا واحدًا على الأقل');
    }
    if (!input.idempotencyKey.trim()) {
        throw new Error('مفتاح منع تكرار الفاتورة مفقود');
    }
    return fetchJson(saleResultSchema, '/api/sales/complete', token(), {
        method: 'POST',
        headers: {
            ...deviceHeaders(input.departmentId),
            'Idempotency-Key': input.idempotencyKey,
            'X-Shift-Session-Id': String(shift),
        },
        body: {
            department_id: dept,
            items: input.items,
            payments: input.payments,
            printer_id: `pos-${String(dept)}`,
        },
    });
}

export interface PosOrderExportFilters {
    dateFrom?: string;
    dateTo?: string;
    status?: '' | 'issued' | 'reported' | 'cancelled';
    search?: string;
}

export async function fetchPosOrdersExport(filters: PosOrderExportFilters, signal?: AbortSignal): Promise<{ data: PosOrderRow[] }> {
    const query = new URLSearchParams();
    if (filters.dateFrom) {
        query.set('date_from', filters.dateFrom);
    }
    if (filters.dateTo) {
        query.set('date_to', filters.dateTo);
    }
    if (filters.status) {
        query.set('status', filters.status);
    }
    const term = String(filters.search ?? '')
        .trim()
        .slice(0, 100);
    if (term) {
        query.set('search', term);
    }
    return fetchJson(
        z.object({ data: z.array(orderRowSchema) }).passthrough(),
        `/api/pos/orders/export?${query.toString()}`,
        token(),
        opts(signal),
    );
}

/** صفحة تذاكر المطبخ HTML — تُفتح أو تُطبع كما يرسلها الخادم. */
export async function fetchKotHtml(orderId: string): Promise<string> {
    const id = String(orderId).trim();
    if (!UUID_PATTERN.test(id)) {
        throw new Error('معرّف الفاتورة غير صالح');
    }
    const headers: Record<string, string> = { Accept: 'text/html' };
    const accessToken = getAccessToken();
    if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
    }
    const appKey = getAppKey();
    if (appKey) {
        headers['x-api-key'] = appKey;
    }
    const response = await fetch(`/api/pos/kot/orders/${encodeURIComponent(id)}/html`, { headers });
    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('انتهت الجلسة — سجّل الدخول مجددًا');
        }
        throw new Error(`تعذّر تحميل تذاكر المطبخ (${String(response.status)})`);
    }
    const html = await response.text();
    if (!html.trim()) {
        throw new Error('صفحة تذاكر المطبخ فارغة');
    }
    return html;
}

/* ─── إقفال اليوم Z ورفع صورة الصنف ───────────────────────────────────── */

export async function fetchDayCloseStatus(signal?: AbortSignal): Promise<DayClose> {
    return fetchJson(dayCloseSchema, '/api/pos/day-close/status', token(), opts(signal));
}

const dayCloseResultSchema = z
    .object({
        z: z.object({ z_number: z.string().optional(), total_variance: numOrNull }).passthrough().optional(),
    })
    .passthrough();
export type DayCloseResult = z.infer<typeof dayCloseResultSchema>;

export async function execDayClose(date: string): Promise<DayCloseResult> {
    return fetchJson(dayCloseResultSchema, '/api/pos/day-close', token(), {
        method: 'POST',
        body: { date, counts: {}, manager_approve: true },
    });
}

export async function removePosProductImage(productId: string): Promise<{ id: string; image_url: null }> {
    const id = Number(productId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('معرّف الصنف غير صالح');
    }
    return fetchJson(z.object({ id: idText, image_url: z.null() }), `/api/pos/products/${String(id)}/image`, token(), {
        method: 'DELETE',
    });
}

export async function uploadPosProductImage(productId: string, file: File): Promise<{ id: string; image_url: string }> {
    const id = Number(productId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('معرّف الصنف غير صالح');
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        throw new Error('الصيغ المدعومة: JPG وPNG وWEBP');
    }
    if (file.size > 5 * 1024 * 1024) {
        throw new Error('حجم الصورة يجب ألا يتجاوز 5 ميجابايت');
    }
    const body = new FormData();
    body.append('image', file);
    const headers: Record<string, string> = { Accept: 'application/json' };
    const accessToken = getAccessToken();
    if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
    }
    const appKey = getAppKey();
    if (appKey) {
        headers['x-api-key'] = appKey;
    }
    const response = await fetch(`/api/pos/products/${String(id)}/image`, {
        method: 'POST',
        headers,
        body,
    });
    if (!response.ok) {
        let message = `تعذّر رفع الصورة (${String(response.status)})`;
        try {
            const parsed = z
                .object({ message: z.string().optional(), error: z.string().optional() })
                .passthrough()
                .safeParse(await response.json());
            if (parsed.success) {
                message = parsed.data.message ?? parsed.data.error ?? message;
            }
        } catch {
            // جسم غير JSON
        }
        throw new Error(message);
    }
    const parsed = z
        .object({ id: idText, image_url: z.string() })
        .passthrough()
        .safeParse(await response.json());
    if (!parsed.success) {
        throw new Error('لم يرجع الخادم رابط الصورة بعد الحفظ');
    }
    return { id: parsed.data.id, image_url: parsed.data.image_url };
}

/* ─── البوفيه: قراءة وكتابة ────────────────────────────────────────────── */

export async function fetchBuffetConfig(signal?: AbortSignal): Promise<BuffetConfig> {
    return fetchJson(buffetConfigSchema, '/api/pos/buffet/config', token(), opts(signal));
}

export async function saveBuffetPrices(prices: Record<string, number>): Promise<BuffetConfig> {
    if (!Object.keys(prices).length) {
        throw new Error('لا توجد أسعار لحفظها');
    }
    return fetchJson(buffetConfigSchema, '/api/pos/buffet/config/prices', token(), {
        method: 'PUT',
        body: { prices },
    });
}

export async function addBuffetTier(nameAr: string, price: number, vatRate = 15): Promise<BuffetConfig> {
    const name = String(nameAr).trim();
    if (!name || name.length > 100) {
        throw new Error('اسم الفئة مطلوب (حتى 100 حرف)');
    }
    if (!Number.isFinite(price) || price < 0) {
        throw new Error('السعر يجب أن يكون رقمًا موجبًا أو صفرًا');
    }
    return fetchJson(buffetConfigSchema, '/api/pos/buffet/config/tiers', token(), {
        method: 'POST',
        body: { name_ar: name, price, vat_rate: vatRate },
    });
}

export async function renameBuffetTier(tierId: string, nameAr: string): Promise<BuffetConfig> {
    const name = String(nameAr).trim();
    if (!name || name.length > 100) {
        throw new Error('اسم الفئة مطلوب (حتى 100 حرف)');
    }
    return fetchJson(buffetConfigSchema, `/api/pos/buffet/config/tiers/${encodeURIComponent(tierId)}`, token(), {
        method: 'PUT',
        body: { name_ar: name },
    });
}

export async function setBuffetTierActive(tierId: string, active: boolean): Promise<BuffetConfig> {
    return fetchJson(buffetConfigSchema, `/api/pos/buffet/config/tiers/${encodeURIComponent(tierId)}`, token(), {
        method: 'PUT',
        body: { is_active: active },
    });
}

export async function disableBuffetTier(tierId: string): Promise<BuffetConfig> {
    return fetchJson(buffetConfigSchema, `/api/pos/buffet/config/tiers/${encodeURIComponent(tierId)}`, token(), {
        method: 'DELETE',
    });
}

export async function fetchBuffetLive(date: string, sessionId: string | null, signal?: AbortSignal): Promise<BuffetLive> {
    const query = new URLSearchParams();
    if (date) {
        query.set('date', date);
    }
    if (sessionId) {
        query.set('session_id', sessionId);
    }
    const suffix = query.toString();
    return fetchJson(buffetLiveSchema, `/api/pos/buffet/live${suffix ? `?${suffix}` : ''}`, token(), opts(signal));
}

export async function fetchBuffetInvoices(date: string, limit = 200, signal?: AbortSignal): Promise<BuffetInvoices> {
    const query = new URLSearchParams({ date, limit: String(limit) });
    return fetchJson(buffetInvoicesSchema, `/api/pos/buffet/invoices?${query.toString()}`, token(), opts(signal));
}

export async function fetchBuffetReport(date: string, signal?: AbortSignal): Promise<BuffetReport> {
    return fetchJson(buffetReportSchema, `/api/pos/buffet/report?date=${encodeURIComponent(date)}`, token(), opts(signal));
}

/** أرقام الشاشة: لاتينية دائمًا، بلا وحدة عملة إن لم يرسلها الخادم. */
export function riyadhToday(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
}

export const posPrinterSchema = z
    .object({
        id: idText,
        name: text,
        kind: text,
        department_id: idText.nullable().optional(),
        connection_type: z.string(),
        address: text,
        paper_width_mm: numOrNull,
        charset: text,
        is_online: flag,
        last_seen_at: text,
    })
    .passthrough();

export type PosPrinter = z.infer<typeof posPrinterSchema>;

const printerListSchema = z.object({ printers: z.array(posPrinterSchema) }).passthrough();

const localQueueSchema = z
    .object({
        name: z.string(),
        driver: text,
        port: text,
        shared: flag,
        share_name: text,
        status: text,
        is_default: flag,
        thermal: flag,
    })
    .passthrough();

export type PosLocalPrintQueue = z.infer<typeof localQueueSchema>;

const networkCandidateSchema = z
    .object({
        ip: idText.optional(),
        port: numOrNull,
        latency_ms: numOrNull,
        address: text,
        connection_type: text,
    })
    .passthrough();

export type PosNetworkPrinter = z.infer<typeof networkCandidateSchema>;

const printerDiscoverySchema = z
    .object({
        platform: text,
        local_queue_supported: flag,
        local_error: text,
        local: z.array(localQueueSchema).optional().default([]),
        network: z.array(networkCandidateSchema).optional().default([]),
        subnet: text,
        registered: z.array(posPrinterSchema).optional().default([]),
        scanned_at: text,
    })
    .passthrough();

export type PosPrinterDiscovery = z.infer<typeof printerDiscoverySchema>;

const printerProbeSchema = z
    .object({
        printer_id: text,
        reachable: z.boolean(),
        latency_ms: numOrNull,
        error: text,
        host: text,
        port: numOrNull,
        connection_type: text,
    })
    .passthrough();

export type PosPrinterProbe = z.infer<typeof printerProbeSchema>;

const printerAutoSchema = z
    .object({
        printer: posPrinterSchema,
        probe: printerProbeSchema.partial().passthrough().optional(),
        source: text,
        note: text,
    })
    .passthrough();

export type PosPrinterAutoResult = z.infer<typeof printerAutoSchema>;

/** الطابعات المسجلة — كل الأدوار الداخلية تقرأ، والتعديل للمدير/المسؤول. */
export async function fetchPosPrinters(signal?: AbortSignal): Promise<PosPrinter[]> {
    const row = await fetchJson(printerListSchema, '/api/pos/printers', token(), opts(signal));
    return row.printers;
}

/** الاكتشاف التلقائي: طوابير ويندوز المثبتة + طابعات الشبكة على 9100. */
export async function discoverPosPrinters(scan = true, signal?: AbortSignal): Promise<PosPrinterDiscovery> {
    return fetchJson(printerDiscoverySchema, `/api/pos/printers/discover${scan ? '' : '?scan=0'}`, token(), opts(signal));
}

export async function probePosPrinter(printerId: string): Promise<PosPrinterProbe> {
    const id = String(printerId).trim();
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) {
        throw new Error('معرّف الطابعة غير صالح');
    }
    return fetchJson(printerProbeSchema, '/api/pos/printers/probe', token(), {
        method: 'POST',
        body: { id },
    });
}

export interface AutoLinkPrinterInput {
    departmentId?: string | null;
    kind?: 'receipt' | 'kot';
    address?: string;
    connectionType?: 'network' | 'windows_share' | 'windows_local';
    name?: string;
}

/** ربط الطابعة بضغطة واحدة — بلا عنوان يختار الخادم أفضل طابعة متاحة. */
export async function autoLinkPosPrinter(input: AutoLinkPrinterInput = {}): Promise<PosPrinterAutoResult> {
    const dept = input.departmentId ? Number(input.departmentId) : null;
    if (dept !== null && (!Number.isInteger(dept) || dept <= 0)) {
        throw new Error('رقم القسم غير صالح');
    }
    return fetchJson(printerAutoSchema, '/api/pos/printers/auto', token(), {
        method: 'POST',
        body: {
            kind: input.kind ?? 'receipt',
            ...(dept !== null ? { department_id: dept } : {}),
            ...(input.address ? { address: input.address } : {}),
            ...(input.connectionType ? { connection_type: input.connectionType } : {}),
            ...(input.name ? { name: input.name } : {}),
        },
    });
}

/* ─── البوفيه: قراءة وكتابة ────────────────────────────────────────────── */
