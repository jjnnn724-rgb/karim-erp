import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { isWriteRole, writeJson } from './write';

/**
 * كتابة طلبات الخضار — منقولة من V2 بوابات الصلاحية نفسها
 * (backend/veg-requests-routes.js):
 *  • إنشاء     POST /api/veg-requests          (sous_chef|admin|owner)
 *  • استلام    POST /api/veg-requests/:id/receive  (sous_chef|admin|owner)
 *  • تسعير     POST /api/veg-requests/:id/price    (warehouse|admin|owner|manager)
 *  • تعديل     PUT  /api/veg-requests/:id/items    (sous_chef|admin|owner)
 *  • إضافة أصناف (أدمن فقط) POST /api/veg-requests/:id/admin/items
 *                                                  (admin — قبل التسعير)
 *  • إلغاء     POST /api/veg-requests/:id/cancel   (READ_ROLES — gate server-side)
 *  • إخفاء آمن DELETE /api/veg-requests/:id         (admin|owner — لا يحذف ماليًا)
 *  • واتساب    /contacts + /:id/notify             (إعداد إداري وطابور إرسال)
 *  • طباعة     POST /api/veg-requests/:id/printed  (READ_ROLES — عدّاد فقط)
 *
 * أجسام الطلبات ومخططات الاستجابة مطابقة للمسارات العاملة في الخادم.
 */

export const VEG_CREATE_ROLES = ['sous_chef', 'admin', 'owner'] as const;
export const VEG_RECEIVE_ROLES = ['sous_chef', 'admin', 'owner'] as const;
export const VEG_PRICE_ROLES = ['warehouse', 'admin', 'owner', 'manager'] as const;
export const VEG_ADMIN_ROLES = ['admin'] as const;

export function vegAdminVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, VEG_ADMIN_ROLES);
}

export function vegCreateVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, VEG_CREATE_ROLES);
}

export function vegReceiveVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, VEG_RECEIVE_ROLES);
}

export function vegPriceVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, VEG_PRICE_ROLES);
}

/* ── نصوص V2 حرفيًّا ───────────────────────────────────────────────────── */

export const VEG_TEXT = {
    itemsRequired: 'أضف صنفًا واحدًا على الأقل',
    nameRequired: 'اسم الصنف غير موجود في الكتالوج',
    qtyRequired: 'أدخل كمية صحيحة للصنف',
    createFailed: 'فشل إنشاء طلب الخضار',
    receiveFailed: 'فشل استلام الطلب',
    priceFailed: 'فشل تسعير الطلب',
    editFailed: 'فشل تعديل الكميات',
    adminEditFailed: 'فشل إضافة/تعديل الأصناف',
    cancelFailed: 'فشل إلغاء الطلب',
    createSuccess: 'تم إنشاء طلب الخضار بنجاح',
    receiveSuccess: 'تم استلام الطلب',
    priceSuccess: 'تم تسعير الطلب',
    editSuccess: 'تم تعديل الكميات',
    adminEditSuccess: 'تمت إضافة/تعديل الأصناف',
    cancelSuccess: 'تم إلغاء الطلب',
    deleteSuccess: 'تم إخفاء الطلب من السجل مع الاحتفاظ به للتدقيق',
    cancel: 'إلغاء',
    confirmCancel: 'إلغاء طلب الخضار «%s»؟',
    confirmDelete: 'إخفاء طلب الخضار «%s» من السجل؟ سيبقى محفوظًا للتدقيق ولن يُحذف أي سجل مالي.',
    confirmReceive: 'استلام طلب الخضار «%s»؟',
    confirmPrice: 'تسعير طلب الخضار «%s»؟ سيُحمَّل المصروف على قسم المطبخ.',
} as const;

/* ── مخططات التحقق ────────────────────────────────────────────────────── */

export interface VegItemInput {
    name: string;
    qty: number;
    unit?: string | undefined;
    note?: string | null | undefined;
}

export const vegItemSchema = z.object({
    name: z.string().min(1),
    qty: z.coerce.number().positive(),
    unit: z.string().optional().nullable(),
    note: z.string().max(120).optional().nullable(),
});

export type VegCreateInput = {
    items: VegItemInput[];
    priority: 'normal' | 'urgent';
    notes?: string | null;
};

export type VegEditItemsInput = {
    items: VegItemInput[];
};

const vegResultSchema = z.object({ id: z.union([z.string(), z.number()]).optional() }).passthrough();
export type VegResult = z.infer<typeof vegResultSchema>;

/* ── العمليات ─────────────────────────────────────────────────────────── */

export async function createVegRequest(input: VegCreateInput): Promise<VegResult> {
    return writeJson(vegResultSchema, '/api/veg-requests', 'POST', {
        items: input.items.map((item) => ({
            name: item.name,
            qty: Number(item.qty),
            unit: item.unit ?? '',
            note: item.note ?? '',
        })),
        priority: input.priority,
        notes: input.notes?.trim() || null,
    });
}

export type VegReceiveInput = {
    quantities: Array<{ name: string; receivedQty: number }>;
    rejections: string[];
};

export async function receiveVegRequest(id: string | number, input: VegReceiveInput): Promise<VegResult> {
    return writeJson(vegResultSchema, `/api/veg-requests/${encodeURIComponent(String(id))}/receive`, 'POST', input);
}

export async function priceVegRequest(
    id: string | number,
    prices: { name: string; price: number; qty?: number | undefined }[],
): Promise<VegResult> {
    return writeJson(vegResultSchema, `/api/veg-requests/${encodeURIComponent(String(id))}/price`, 'POST', { prices });
}

export async function editVegItems(id: string | number, input: VegEditItemsInput): Promise<VegResult> {
    return writeJson(vegResultSchema, `/api/veg-requests/${encodeURIComponent(String(id))}/items`, 'PUT', {
        items: input.items.map((item) => ({ name: item.name, qty: Number(item.qty), unit: item.unit ?? '' })),
    });
}

/** إضافة أصناف نسيها الشيف + تعديل الكميات — الأدمن فقط، قبل التسعير. */
export async function adminEditVegItems(id: string | number, input: VegEditItemsInput): Promise<VegResult> {
    return writeJson(vegResultSchema, `/api/veg-requests/${encodeURIComponent(String(id))}/admin/items`, 'POST', {
        items: input.items.map((item) => ({ name: item.name, qty: Number(item.qty), unit: item.unit ?? '' })),
    });
}

export async function cancelVegRequest(id: string | number, reason?: string): Promise<VegResult> {
    return writeJson(vegResultSchema, `/api/veg-requests/${encodeURIComponent(String(id))}/cancel`, 'POST', {
        reason: reason?.trim() || null,
    });
}

export async function deleteVegRequest(id: string | number): Promise<VegResult> {
    return writeJson(vegResultSchema, `/api/veg-requests/${encodeURIComponent(String(id))}`, 'DELETE');
}

export type VegContacts = {
    supplier_jid: string;
    warehouse_jid: string;
};

const vegContactsSchema = z
    .object({
        contacts: z.object({
            supplier_jid: z.string(),
            warehouse_jid: z.string(),
        }),
    })
    .passthrough();

export async function fetchVegContacts(signal?: AbortSignal): Promise<VegContacts> {
    const body = await fetchJson(
        vegContactsSchema,
        '/api/veg-requests/contacts',
        getAccessToken(),
        signal ? { signal } : {},
    );
    return body.contacts;
}

export async function saveVegContacts(contacts: VegContacts): Promise<VegContacts> {
    const body = await writeJson(vegContactsSchema, '/api/veg-requests/contacts', 'PUT', contacts);
    return body.contacts;
}

const vegNotificationSchema = z
    .object({
        id: z.union([z.string(), z.number()]),
        status: z.string(),
        queued: z.literal(true),
    })
    .passthrough();

export async function notifyVegRequest(
    id: string | number,
    target: 'supplier' | 'warehouse',
): Promise<z.infer<typeof vegNotificationSchema>> {
    return writeJson(vegNotificationSchema, `/api/veg-requests/${encodeURIComponent(String(id))}/notify`, 'POST', {
        target,
    });
}

/** عدّاد الطباعة — POST /:id/printed (:463) لكل أدوار القراءة؛ V2 يطلقه ولا ينتظره. */
const vegPrintedSchema = z
    .object({ ok: z.boolean().optional(), print_count: z.coerce.number().optional() })
    .passthrough();

export async function markVegPrinted(id: string | number): Promise<z.infer<typeof vegPrintedSchema>> {
    return writeJson(vegPrintedSchema, `/api/veg-requests/${encodeURIComponent(String(id))}/printed`, 'POST');
}

/* ── الكتالوج ─────────────────────────────────────────────────────────── */

export type VegCatalogItem = {
    name: string;
    unit: string;
};

export type VegCatalogCategory = {
    key: string;
    label: string;
    items: VegCatalogItem[];
};

export type VegCatalog = {
    categories: VegCatalogCategory[];
    units: string[];
};

const vegCatalogSchema = z
    .object({
        categories: z
            .array(
                z
                    .object({
                        key: z.string(),
                        label: z.string(),
                        items: z.array(z.object({ name: z.string(), unit: z.string() }).passthrough()),
                    })
                    .passthrough(),
            )
            .nullable()
            .optional(),
        units: z.array(z.string()).nullable().optional(),
    })
    .passthrough();

export async function fetchVegCatalog(signal?: AbortSignal): Promise<VegCatalog> {
    const body = await fetchJson(
        vegCatalogSchema,
        '/api/veg-requests/catalog',
        getAccessToken(),
        signal ? { signal } : {},
    );
    return {
        categories: (body.categories ?? []).filter((category) => category.key !== 'extras'),
        units: body.units ?? [],
    };
}

/* ── دوال تأكيد ───────────────────────────────────────────────────────── */

export function vegCancelConfirm(ref: string): string {
    return VEG_TEXT.confirmCancel.replace('%s', String(ref ?? ''));
}

export function vegDeleteConfirm(ref: string): string {
    return VEG_TEXT.confirmDelete.replace('%s', String(ref ?? ''));
}

export function vegReceiveConfirm(ref: string): string {
    return VEG_TEXT.confirmReceive.replace('%s', String(ref ?? ''));
}

export function vegPriceConfirm(ref: string): string {
    return VEG_TEXT.confirmPrice.replace('%s', String(ref ?? ''));
}

/* ── نصوص نجاح ───────────────────────────────────────────────────────── */

export function vegCreateSuccess(no: string): string {
    return `${VEG_TEXT.createSuccess} — «${String(no ?? '')}»`;
}

export function vegReceiveSuccess(no: string): string {
    return `${VEG_TEXT.receiveSuccess} — «${String(no ?? '')}»`;
}

export function vegPriceSuccess(no: string): string {
    return `${VEG_TEXT.priceSuccess} — «${String(no ?? '')}»`;
}

export function vegEditSuccess(no: string): string {
    return `${VEG_TEXT.editSuccess} — «${String(no ?? '')}»`;
}

export function vegAdminEditSuccess(no: string): string {
    return `${VEG_TEXT.adminEditSuccess} — «${String(no ?? '')}»`;
}

export function vegCancelSuccess(no: string): string {
    return `${VEG_TEXT.cancelSuccess} — «${String(no ?? '')}»`;
}
