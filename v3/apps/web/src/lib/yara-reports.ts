import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * تقارير YaraSoft — أربعة أبواب قراءة فقط، كلها بسقف 93 يومًا:
 *
 *   /api/yara-reports/item-sales?from&to
 *     {rows:[{item_code,item_name,cashier_no,day,invoices,qty,net,vat}],
 *      totals:{invoices,qty,net,vat}, ...}
 *   /api/yara-reports/orders?from&to&cashier&limit&offset
 *     {ok,from,to,orders:[{doc_no,...,lines,lines_count}],total,limit,offset}
 *   /api/yara-reports/received-items?from&to
 *     {rows:[{name?,item_name?,depts?,qty,approved_qty,variance_qty}],totals,count}
 *   /api/yara-reports/received-dispatches?from&to
 *     {rows:[{id,dept_code,dept_name,date,status,received_at,received_by,
 *             items_count,total_qty}]}
 *   /api/yara-reports/wh-vs-pos?from&to
 *     {rows:[{name,wh_qty,pos_qty,diff,pct,status,dept,pos_invoices,pos_net,pos_gross}],
 *      summary,liveSynced,lastSyncAt}
 *
 * الأدوار: sous_chef | admin | owner. الأرقام كما وردت — التجميع الوحيد هنا
 * للكميات داخل النافذة، ويُعلَن أنه على الصفوف الواصلة.
 */

const text = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();
const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));

export const YARA_MAX_DAYS = 93;

function rangeQuery(from: string, to: string): string {
    return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

/* ── مبيعات الأصناف ─────────────────────────────────────────────────────── */

const itemSalesRowSchema = z
    .object({
        item_code: text,
        item_name: text,
        cashier_no: text,
        day: text,
        invoices: numLike,
        qty: numLike,
        net: numLike,
        vat: numLike,
    })
    .passthrough();

export const itemSalesSchema = z
    .object({
        rows: z.array(itemSalesRowSchema).optional(),
        totals: z
            .object({ invoices: numLike, qty: numLike, net: numLike, vat: numLike })
            .passthrough()
            .optional(),
    })
    .passthrough();

export type ItemSales = z.infer<typeof itemSalesSchema>;
export type ItemSalesRow = z.infer<typeof itemSalesRowSchema>;

export async function fetchItemSales(from: string, to: string, signal?: AbortSignal): Promise<ItemSales> {
    return fetchJson(
        itemSalesSchema,
        `/api/yara-reports/item-sales?${rangeQuery(from, to)}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

/** تجميع الأصناف عبر الكاشير والأيام — كمية وصافي على الصفوف الواصلة. */
export function groupItemSales(rows: ItemSalesRow[]): { label: string; code: string; qty: number; invoices: number; net: number }[] {
    const map = new Map<string, { label: string; code: string; qty: number; invoices: number; net: number }>();
    for (const row of rows) {
        const code = String(row.item_code ?? '') || String(row.item_name ?? '');
        const current = map.get(code) ?? {
            label: String(row.item_name ?? row.item_code ?? '—'),
            code,
            qty: 0,
            invoices: 0,
            net: 0,
        };
        current.qty += Number(row.qty ?? 0);
        current.invoices += Number(row.invoices ?? 0);
        current.net += Number(row.net ?? 0);
        map.set(code, current);
    }
    return [...map.values()].sort((a, b) => b.net - a.net);
}

/* ── الأوردرات ──────────────────────────────────────────────────────────── */

const orderSchema = z
    .object({
        doc_no: idValue,
        cashier_no: text,
        cashier_name: text,
        doc_date: text,
        doc_time: text,
        shift_no: numLike,
        net: numLike,
        total: numLike,
        discount: numLike,
        vat: numLike,
        payed: numLike,
        pay_cash: numLike,
        pay_network: numLike,
        pay_credit: numLike,
        pay_mobile: numLike,
        table_name: text,
        zone_name: text,
        printed: z.unknown().optional(),
        lines: z.array(z.unknown()).optional(),
        lines_count: numLike,
    })
    .passthrough();

export type YaraOrder = z.infer<typeof orderSchema>;

export const ordersSchema = z
    .object({
        ok: z.unknown().optional(),
        from: text,
        to: text,
        orders: z.array(orderSchema).optional(),
        total: numLike,
        limit: numLike,
        offset: numLike,
    })
    .passthrough();

export type OrdersPage = z.infer<typeof ordersSchema>;

export interface OrdersQuery {
    from: string;
    to: string;
    cashier?: string;
    limit?: number;
    offset?: number;
}

export async function fetchOrders(query: OrdersQuery, signal?: AbortSignal): Promise<OrdersPage> {
    const params = new URLSearchParams({ from: query.from, to: query.to });
    if (query.cashier) {
        params.set('cashier', query.cashier);
    }
    params.set('limit', String(query.limit ?? 50));
    params.set('offset', String(query.offset ?? 0));
    return fetchJson(ordersSchema, `/api/yara-reports/orders?${params.toString()}`, getAccessToken(), signal ? { signal } : {});
}

/* ── المستلَم ───────────────────────────────────────────────────────────── */

const receivedItemRowSchema = z
    .object({
        name: text,
        item_name: text,
        depts: text,
        dept_name: text,
        qty: numLike,
        approved_qty: numLike,
        variance_qty: numLike,
    })
    .passthrough();

export const receivedItemsSchema = z
    .object({
        ok: z.unknown().optional(),
        rows: z.array(receivedItemRowSchema).optional(),
        totals: z.unknown().optional(),
        count: numLike,
    })
    .passthrough();

export type ReceivedItems = z.infer<typeof receivedItemsSchema>;
export type ReceivedItemRow = z.infer<typeof receivedItemRowSchema>;

export async function fetchReceivedItems(from: string, to: string, signal?: AbortSignal): Promise<ReceivedItems> {
    return fetchJson(
        receivedItemsSchema,
        `/api/yara-reports/received-items?${rangeQuery(from, to)}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export function receivedLabel(row: ReceivedItemRow): string {
    return String(row.name ?? row.item_name ?? '') || '—';
}

const dispatchRowSchema = z
    .object({
        id: idValue,
        dept_code: text,
        dept_name: text,
        date: text,
        status: text,
        received_at: text,
        received_by: text,
        items_count: numLike,
        total_qty: numLike,
    })
    .passthrough();

export type ReceivedDispatch = z.infer<typeof dispatchRowSchema>;

export const receivedDispatchesSchema = z
    .object({
        ok: z.unknown().optional(),
        rows: z.array(dispatchRowSchema).optional(),
        count: numLike,
    })
    .passthrough();

export async function fetchReceivedDispatches(
    from: string,
    to: string,
    signal?: AbortSignal,
): Promise<z.infer<typeof receivedDispatchesSchema>> {
    return fetchJson(
        receivedDispatchesSchema,
        `/api/yara-reports/received-dispatches?${rangeQuery(from, to)}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export const DISPATCH_STATUS_AR: Record<string, string> = {
    pending: 'معلّق',
    chef_approved: 'اعتماد الشيف',
    approved: 'معتمد',
    partially_received: 'استلام جزئي',
    received: 'مستلم',
    rejected: 'مرفوض',
};

/* ── المخزن مقابل نقطة البيع ───────────────────────────────────────────── */

const whVsPosRowSchema = z
    .object({
        name: text,
        wh_qty: numLike,
        pos_qty: numLike,
        diff: numLike,
        pct: numLike,
        status: text,
        dept: text,
        pos_invoices: numLike,
        pos_net: numLike,
        pos_gross: numLike,
    })
    .passthrough();

export type WhVsPosRow = z.infer<typeof whVsPosRowSchema>;

export const whVsPosSchema = z
    .object({
        ok: z.unknown().optional(),
        rows: z.array(whVsPosRowSchema).optional(),
        summary: z.unknown().optional(),
        liveSynced: z.unknown().optional(),
        lastSyncAt: text,
        from: text,
        to: text,
    })
    .passthrough();

export type WhVsPos = z.infer<typeof whVsPosSchema>;

export async function fetchWhVsPos(from: string, to: string, signal?: AbortSignal): Promise<WhVsPos> {
    return fetchJson(
        whVsPosSchema,
        `/api/yara-reports/wh-vs-pos?${rangeQuery(from, to)}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export const WH_VS_POS_STATUS_AR: Record<string, string> = {
    match: 'مطابق',
    mismatch: 'فرق',
    short: 'ناقص',
    over: 'زائد',
    missing: 'غائب',
    ok: 'سليم',
};

export function isTruthyFlag(value: unknown): boolean {
    return value === true || value === 1 || value === '1' || value === 'true';
}
