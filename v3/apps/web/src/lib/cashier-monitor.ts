import { z } from 'zod';
import { fetchJson, fetchText } from './api';
import { getAccessToken } from './auth';

/**
 * متابعة الكاشير — مرآة YaraSoft الحيّة:
 *   GET /api/cashier-monitor/summary?date&live=1  → {date, cashiers:[...]}
 *   GET /api/cashier-monitor/orders?date&cashier&limit&offset
 *        → {ok,date,cashier,total,limit,offset,orders:[...]}
 *
 * حقول الكاشير كما يبنيها الخادم: invoices, revenue, revenue_ex_vat,
 * pay_cash, pay_network, pay_mobile, pay_credit, open, avg, last_time.
 * الشاشة تعرضها؛ لا تجمع أموالًا ولا تستنتج حالة.
 */

const text = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();
const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));

const cashierSchema = z
    .object({
        cashier_no: text,
        cashier_name: text,
        name: text,
        invoices: numLike,
        revenue: numLike,
        revenue_ex_vat: numLike,
        pay_cash: numLike,
        pay_network: numLike,
        pay_mobile: numLike,
        pay_credit: numLike,
        open: numLike,
        avg: numLike,
        last_time: text,
    })
    .passthrough();

export type MonitorCashier = z.infer<typeof cashierSchema>;

export const monitorSummarySchema = z
    .object({
        ok: z.unknown().optional(),
        date: text,
        from: text,
        to: text,
        cashiers: z.array(cashierSchema).optional(),
    })
    .passthrough();

export type MonitorSummary = z.infer<typeof monitorSummarySchema>;

const orderSchema = z
    .object({
        doc_no: idValue,
        doc_time: text,
        time: text,
        cashier_no: text,
        cashier_name: text,
        net: numLike,
        total: numLike,
        vat: numLike,
        discount: numLike,
        pay_cash: numLike,
        pay_network: numLike,
        pay_mobile: numLike,
        pay_credit: numLike,
        table_name: text,
        zone_name: text,
        items: numLike,
        status: text,
    })
    .passthrough();

export type MonitorOrder = z.infer<typeof orderSchema>;

export const monitorOrdersSchema = z
    .object({
        ok: z.unknown().optional(),
        date: text,
        cashier: text,
        total: numLike,
        limit: numLike,
        offset: numLike,
        orders: z.array(orderSchema).optional(),
    })
    .passthrough();

export type MonitorOrders = z.infer<typeof monitorOrdersSchema>;

export async function fetchMonitorSummary(date: string, signal?: AbortSignal): Promise<MonitorSummary> {
    return fetchJson(
        monitorSummarySchema,
        `/api/cashier-monitor/summary?date=${encodeURIComponent(date)}&live=1`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export interface MonitorOrdersQuery {
    date: string;
    cashier?: string;
    limit?: number;
    offset?: number;
}

export async function fetchMonitorOrders(query: MonitorOrdersQuery, signal?: AbortSignal): Promise<MonitorOrders> {
    const params = new URLSearchParams({ date: query.date });
    if (query.cashier) {
        params.set('cashier', query.cashier);
    }
    params.set('limit', String(query.limit ?? 50));
    params.set('offset', String(query.offset ?? 0));
    return fetchJson(monitorOrdersSchema, `/api/cashier-monitor/orders?${params.toString()}`, getAccessToken(), signal ? { signal } : {});
}

export function monitorCashierLabel(row: MonitorCashier): string {
    return String(row.cashier_name ?? row.name ?? '') || String(row.cashier_no ?? '') || 'كاشير';
}

/** وقت الطلب كما ورد (HH:MM أو طابع كامل) — قصّ عرضٍ لا تحويل منطقة. */
export function orderTimeText(order: MonitorOrder): string {
    const raw = String(order.time ?? order.doc_time ?? '');
    return raw.length > 5 ? raw.slice(0, 5) : raw || '—';
}

/** إيصال الفاتورة 80مم من الخادم — نفس مستند V2، تُطبع في نافذة المتصفح. */
export async function fetchMonitorInvoiceHtml(docNo: string): Promise<string> {
    return fetchText(`/api/cashier-sales/invoice/${encodeURIComponent(docNo)}/html`, getAccessToken());
}
