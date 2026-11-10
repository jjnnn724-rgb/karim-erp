import { z } from 'zod';
import { ApiError, fetchFile, fetchJson, type FileResponse } from './api';
import { getAccessToken } from './auth';

/**
 * استعلامات المخزون — الباب نفسه الذي تقرأه v2 (`inventory-inquiry-repo.js`):
 *
 *   /api/inventory-inquiry/items?from&to&dept&q&cat&only&sort&dir&limit&offset
 *   /api/inventory-inquiry/item/:id?from&to
 *   /api/inventory-inquiry/departments?from&to
 *
 * كلها GET وقراءة فقط. الخادم يجمّع من دفتر المخزون، والواجهة تعرض ولا تحسب.
 * `soldPos` (ربط بالمعرّف) و`soldYara` (ربط بالاسم المطبَّع) رقمان مختلفان
 * المصدر — يُعرضان بعمودين ولا يُجمعان أبدًا.
 */

export const INQ_FILTERS = ['all', 'moved', 'active', 'low', 'expired'] as const;
export const INQ_SORTS = [
    'movements',
    'onHand',
    'value',
    'qtyIn',
    'qtyOut',
    'sold',
    'cost',
    'name',
    'expiry',
] as const;

const numLike = z.union([z.string(), z.number()]).nullable().optional();
const text = z.string().nullable().optional();

export const inquiryRowSchema = z
    .object({
        itemId: z.union([z.string(), z.number()]),
        itemName: text,
        category: text,
        unit: text,
        barcode: text,
        minQty: numLike,
        avgCost: numLike,
        onHand: numLike,
        qtyInPurchases: numLike,
        qtyInOther: numLike,
        qtyOutTotal: numLike,
        qtyOutDispatch: numLike,
        qtyOutSale: numLike,
        qtyNet: numLike,
        purchaseCost: numLike,
        outCost: numLike,
        stockValue: numLike,
        movements: numLike,
        soldPos: numLike,
        revenuePos: numLike,
        soldYara: numLike,
        yaraMatched: z.boolean().nullable().optional(),
        nearestExpiry: text,
    })
    .passthrough();

export type InquiryRow = z.infer<typeof inquiryRowSchema>;

export const inquiryItemsSchema = z
    .object({
        from: text,
        to: text,
        rows: z.array(inquiryRowSchema).optional(),
        totals: z
            .object({
                items: numLike,
                stockValue: numLike,
                qtyInPurchases: numLike,
                qtyOutTotal: numLike,
                purchaseCost: numLike,
                outCost: numLike,
                qtySoldPos: numLike,
                revenuePos: numLike,
            })
            .passthrough()
            .optional(),
        meta: z
            .object({
                yara: z
                    .object({ unmatchedItems: numLike, qtyTotal: numLike })
                    .passthrough()
                    .optional(),
                soldRule: text,
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

export type InquiryItems = z.infer<typeof inquiryItemsSchema>;

const cardexRowSchema = z
    .object({
        date: text,
        type: text,
        referenceType: text,
        // `inventory_ledger.reference_id` عمود نصي، لكن بعض المسارات تكتب أرقامًا
        // وبعض محوّلات JSON تُعيدها أرقامًا — الشاشتان تعرضانه ولا تحسبانه.
        referenceId: z.union([z.string(), z.number()]).nullable().optional(),
        delta: numLike,
        runningQty: numLike,
        unitCost: numLike,
        totalCost: numLike,
        expiryDate: text,
        lot: text,
        location: text,
        deptCode: text,
        reason: text,
    })
    .passthrough();

export const inquiryItemSchema = z
    .object({
        from: text,
        to: text,
        item: z
            .object({
                id: z.union([z.string(), z.number()]),
                name: text,
                category: text,
                unit: text,
                barcode: text,
                shelf: text,
                qty: numLike,
                balanceSum: numLike,
                minQty: numLike,
                avgCost: numLike,
                stockValue: numLike,
                lowStock: z.boolean().nullable().optional(),
            })
            .passthrough()
            .optional(),
        cardex: z.array(cardexRowSchema).optional(),
        purchases: z
            .object({
                qty: numLike,
                cost: numLike,
                invoices: z
                    .array(
                        z
                            .object({
                                invoiceNumber: text,
                                day: text,
                                supplier: text,
                                invoiceTotal: numLike,
                                qty: numLike,
                                unitCost: numLike,
                                lineTotal: numLike,
                                paymentMethod: text,
                            })
                            .passthrough(),
                    )
                    .optional(),
            })
            .passthrough()
            .optional(),
        departments: z
            .array(
                z
                    .object({
                        deptCode: text,
                        deptName: text,
                        qty: numLike,
                        cost: numLike,
                        docs: numLike,
                    })
                    .passthrough(),
            )
            .optional(),
        batches: z
            .array(
                z
                    .object({
                        expiryDate: text,
                        lot: text,
                        qty: numLike,
                        postings: numLike,
                        expired: z.boolean().nullable().optional(),
                    })
                    .passthrough(),
            )
            .optional(),
        sales: z
            .object({
                pos: numLike,
                net: numLike,
                orders: numLike,
                lines: z
                    .array(
                        z
                            .object({
                                orderId: text,
                                day: text,
                                dept: text,
                                cashier: text,
                                qty: numLike,
                                lineTotal: numLike,
                            })
                            .passthrough(),
                    )
                    .optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

export type InquiryItem = z.infer<typeof inquiryItemSchema>;
export type CardexRow = z.infer<typeof cardexRowSchema>;

export const departmentCostSchema = z
    .object({
        from: text,
        to: text,
        rows: z
            .array(
                z
                    .object({
                        code: text,
                        name: text,
                        parentCode: text,
                        issuedQty: numLike,
                        issuedCost: numLike,
                        expenseOperating: numLike,
                        expenseStock: numLike,
                        costTotal: numLike,
                        revenueManual: numLike,
                        revenuePos: numLike,
                    })
                    .passthrough(),
            )
            .optional(),
        totals: z
            .object({
                departments: numLike,
                issuedCost: numLike,
                expenseOperating: numLike,
                costTotal: numLike,
                stockValue: numLike,
                stockItems: numLike,
                zeroStockItems: numLike,
            })
            .passthrough()
            .optional(),
        unattributed: z
            .object({ issuedCost: numLike, expenseOperating: numLike })
            .passthrough()
            .optional(),
        meta: z.object({ basis: text }).passthrough().optional(),
    })
    .passthrough();

export type DepartmentCost = z.infer<typeof departmentCostSchema>;

export interface InquiryQuery {
    from: string;
    to: string;
    dept?: string;
    q?: string;
    cat?: string;
    only?: (typeof INQ_FILTERS)[number];
    sort?: (typeof INQ_SORTS)[number];
    dir?: 'asc' | 'desc';
    limit?: number;
}

function queryString(params: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && String(value) !== '') {
            search.set(key, String(value));
        }
    }
    const text = search.toString();
    return text ? `?${text}` : '';
}

export async function fetchInquiryItems(query: InquiryQuery, signal?: AbortSignal): Promise<InquiryItems> {
    return fetchJson(
        inquiryItemsSchema,
        `/api/inventory-inquiry/items${queryString({
            from: query.from,
            to: query.to,
            dept: query.dept,
            q: query.q,
            cat: query.cat,
            only: query.only,
            sort: query.sort,
            dir: query.dir,
            limit: query.limit,
        })}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export async function fetchInquiryItem(
    itemId: string,
    from: string,
    to: string,
    signal?: AbortSignal,
): Promise<InquiryItem> {
    return fetchJson(
        inquiryItemSchema,
        `/api/inventory-inquiry/item/${encodeURIComponent(itemId)}${queryString({ from, to })}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export async function fetchInquiryDepartments(
    from: string,
    to: string,
    signal?: AbortSignal,
): Promise<DepartmentCost> {
    return fetchJson(
        departmentCostSchema,
        `/api/inventory-inquiry/departments${queryString({ from, to })}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

/**
 * رابط التصدير — نفس مرشّحات الشاشة ونفس سقف الصفوف المعروض (200).
 * البناء هنا لا في الشاشة حتى يبقى الطلب واحدًا ومقروءًا في الاختبار.
 */
export function inquiryExportUrl(query: InquiryQuery): string {
    return `/api/inventory-inquiry/export${queryString({
        from: query.from,
        to: query.to,
        dept: query.dept,
        q: query.q,
        cat: query.cat,
        only: query.only,
        sort: query.sort,
        dir: query.dir,
        limit: query.limit,
    })}`;
}

/** ملف Excel من الخادم — الأرقام تأتي من نفس استعلام الجدول، لا تُحسب هنا. */
export async function fetchInquiryExport(
    query: InquiryQuery,
    signal?: AbortSignal,
): Promise<FileResponse> {
    const file = await fetchFile(
        inquiryExportUrl(query),
        getAccessToken(),
        `inventory-inquiry_${query.from}_${query.to}.xlsx`,
        signal ? { signal } : {},
    );
    // 200 من وسيط (صفحة HTML أو JSON خطأ) ليس ملفًا: لا نُسلّم المستخدم امتدادًا كاذبًا.
    if (file.blob.type && !file.blob.type.includes('spreadsheet') && !file.blob.type.includes('octet-stream')) {
        throw new ApiError(200, 'EXPORT_NOT_SPREADSHEET', 'الخادم أعاد محتوى ليس ملف Excel');
    }
    return file;
}

/** تنزيل المتصفح — نقطة واحدة، والجلب فوقها نقي وقابل للاختبار. */
export function saveDownload(file: FileResponse): void {
    const url = URL.createObjectURL(file.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

/** حالة الصلاحية من أقرب تاريخ — تُعرض شارة، لا تُحسب كرقم مخزون. */
export function expiryState(
    nearestExpiry: string,
    today: string,
): { label: string; tone: 'danger' | 'warning' | 'success' | 'neutral' } {
    if (!nearestExpiry) {
        return { label: '—', tone: 'neutral' };
    }
    const date = nearestExpiry.slice(0, 10);
    if (date < today) {
        return { label: 'منتهية', tone: 'danger' };
    }
    const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
    if (days <= 7) {
        return { label: `خلال ${String(days)} يومًا`, tone: 'warning' };
    }
    return { label: 'سليمة', tone: 'success' };
}
