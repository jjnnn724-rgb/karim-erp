import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * طلبات شراء النواقص — قراءة فقط من `/api/warehouse/purchase-requests`
 * بنفس عقد القديم (وحدة بيانات طلبات الشراء في v2): مصفوفة خام،
 * أحدث 200 طلبًا (`ORDER BY created_at DESC LIMIT 200`)، بلا صفحات.
 * والنواقص الاستشارية من `/api/warehouse/purchase-requests/shortages`
 * (حدها 200 عند الخادم أيضًا) — فشلها لا يعطّل الشاشة كما في القديم.
 *
 * الإنشاء والتوقيعات والاعتماد والإلغاء والحذف والطباعة تبقى في V2 حتى
 * تُنقل دورتها وتواقيعها كاملة. هذا الملف لا يكتب.
 */

const optionalText = z.string().nullable().optional();

const nullableNumber = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => {
        if (value === null || value === undefined) {
            return null;
        }
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    });

const zeroNumber = nullableNumber.transform((value) => value ?? 0);

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));

const prItemSchema = z
    .object({
        itemName: optionalText,
        name: optionalText,
        unit: optionalText,
        qty: nullableNumber,
        requestedQty: nullableNumber,
        currentQty: nullableNumber,
    })
    .passthrough();

export const purchaseRequestSchema = z
    .object({
        id: idValue,
        request_number: optionalText,
        status: optionalText,
        items: z.array(prItemSchema).nullable().optional(),
        creator_name: optionalText,
        chef_approved_name: optionalText,
        gm_approved_name: optionalText,
        wh_received_name: optionalText,
        created_at: z
            .string()
            .nullable()
            .optional()
            .transform((value) => String(value ?? '').slice(0, 10)),
    })
    .passthrough();

export type PurchaseRequest = z.infer<typeof purchaseRequestSchema>;

export const shortageSchema = z
    .object({
        itemId: idValue,
        itemName: optionalText,
        unit: optionalText,
        currentQty: zeroNumber,
        minQty: zeroNumber,
        suggestedQty: zeroNumber,
    })
    .passthrough();

export type Shortage = z.infer<typeof shortageSchema>;

const listSchema = <T extends z.ZodTypeAny>(item: T) =>
    z.union([z.array(item), z.object({ data: z.array(item) }).passthrough()]).transform((body) => {
        return Array.isArray(body) ? body : body.data;
    });

/** سقف الخادم المعلن — النافذة تُعلن حين تمتلئ. */
export const PR_LIST_CAP = 200;

export async function fetchPurchaseRequests(signal?: AbortSignal): Promise<PurchaseRequest[]> {
    return fetchJson(
        listSchema(purchaseRequestSchema),
        '/api/warehouse/purchase-requests',
        getAccessToken(),
        signal ? { signal } : {},
    );
}

/** النواقص استشارية — فشلها يعيد [] ولا يعطّل الشاشة (عين القديم :82-88). */
export async function fetchShortages(signal?: AbortSignal): Promise<Shortage[]> {
    try {
        return await fetchJson(
            listSchema(shortageSchema),
            '/api/warehouse/purchase-requests/shortages',
            getAccessToken(),
            signal ? { signal } : {},
        );
    } catch {
        return [];
    }
}

/* ─── عرض ─────────────────────────────────────────────────────────────── */

/** تسميات سجل الحالة — `v2/status.js` purchase_request:* حرفًا. */
export const PR_STATUS_LABELS: Record<string, string> = {
    pending: 'بانتظار الشيف',
    chef_approved: 'موقّع من الشيف',
    approved: 'معتمد نهائيًا',
    partially_fulfilled: 'مستلم جزئياً',
    fulfilled: 'مستلم ومغلق',
    rejected: 'مرفوض',
    cancelled: 'ملغى',
};

export const PR_STATUS_ORDER = [
    'pending',
    'chef_approved',
    'approved',
    'partially_fulfilled',
    'fulfilled',
    'rejected',
    'cancelled',
] as const;

function formatQty(value: number): string {
    return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function itemName(item: { itemName?: string | null | undefined; name?: string | null | undefined }): string {
    return String(item.itemName || item.name || '—');
}

/** ملخص الأصناف كما في سجل V2: أول اسمين + عدّاد الباقي. */
export function itemsSummary(items: PurchaseRequest['items']): string {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
        return '—';
    }
    const names = list.map((item) => `${itemName(item)} (${formatQty(item.requestedQty ?? item.qty ?? 0)})`);
    return names.length > 2 ? `${names.slice(0, 2).join('، ')} +${String(names.length - 2)}` : names.join('، ');
}

export type PurchaseRequestRow = {
    id: string;
    number: string;
    itemsText: string;
    itemsCount: number;
    status: string;
    statusLabel: string;
    statusKnown: boolean;
    by: string;
    created: string;
    chefSigned: string;
    gmSigned: string;
    whReceived: string;
};

export function purchaseRequestToRow(entry: PurchaseRequest): PurchaseRequestRow {
    const status = entry.status ? String(entry.status) : '';
    return {
        id: entry.id,
        number: entry.request_number ? String(entry.request_number) : `#${entry.id}`,
        itemsText: itemsSummary(entry.items),
        itemsCount: Array.isArray(entry.items) ? entry.items.length : 0,
        status,
        statusLabel: PR_STATUS_LABELS[status] ?? (status || '—'),
        statusKnown: Object.hasOwn(PR_STATUS_LABELS, status),
        by: entry.creator_name ? String(entry.creator_name) : '—',
        created: entry.created_at,
        chefSigned: entry.chef_approved_name ? String(entry.chef_approved_name) : '',
        gmSigned: entry.gm_approved_name ? String(entry.gm_approved_name) : '',
        whReceived: entry.wh_received_name ? String(entry.wh_received_name) : '',
    };
}

export type PurchaseRequestCounts = {
    total: number;
    pending: number;
    chefApproved: number;
    approved: number;
    rejected: number;
    cancelled: number;
};

/** عدّاد شريط الملخص — نقية على الصفوف الخام (عين `summarizePR`). */
export function summarizePR(rows: readonly { status: string }[]): PurchaseRequestCounts {
    const of = (status: string) => rows.filter((row) => row.status === status).length;
    return {
        total: rows.length,
        pending: of('pending'),
        chefApproved: of('chef_approved'),
        approved: of('approved'),
        rejected: of('rejected'),
        cancelled: of('cancelled'),
    };
}

export type ShortageRow = {
    itemId: string;
    itemName: string;
    unit: string;
    currentQty: number;
    minQty: number;
    suggestedQty: number;
};

export function shortageToRow(entry: Shortage): ShortageRow {
    return {
        itemId: entry.itemId,
        itemName: entry.itemName ? String(entry.itemName) : '—',
        unit: entry.unit ? String(entry.unit) : 'وحدة',
        currentQty: entry.currentQty,
        minQty: entry.minQty,
        suggestedQty: entry.suggestedQty,
    };
}
