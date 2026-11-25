import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * إيرادات الكاشير — طبقة القراءة.
 *
 * المصدر: جدول `revenues` في **PostgreSQL عندنا** عبر `GET /api/cashier-revenues`.
 * لا شيء هنا يعتمد على مزامنة Yarasoft: إيقافها (أو فصلها لاحقًا) لا يغيّر
 * هذه الشاشة — لأن الخادم يقرأ صفوفنا لا مصدر YarasoSoft الخارجي.
 *
 * الأرقام نصّ (ADR-04): `NUMERIC` يُسلَّم نصًّا ولا يُمرّ على `Number()` أبدًا.
 */

const moneyValue = z.union([z.string(), z.number()]).transform((value) => String(value));

export const cashierRevenueRowSchema = z
    .object({
        deptCode: z.string(),
        displayAr: z.string(),
        displayEn: z.string().nullable().optional(),
        source: z.string().nullable().optional(),
        total: moneyValue,
        entries: z.number(),
        invoices: z.number(),
    })
    .passthrough();

export const cashierRevenueDaySchema = z
    .object({
        date: z.string(),
        total: moneyValue,
        entries: z.number(),
    })
    .passthrough();

export const cashierRevenueSnapshotSchema = z
    .object({
        from: z.string(),
        to: z.string(),
        dept: z.string().nullable().optional(),
        total: moneyValue,
        entries: z.number(),
        invoices: z.number(),
        cashiers: z.array(cashierRevenueRowSchema),
        byDay: z.array(cashierRevenueDaySchema),
    })
    .passthrough();

export type CashierRevenueRow = z.infer<typeof cashierRevenueRowSchema>;
export type CashierRevenueDay = z.infer<typeof cashierRevenueDaySchema>;
export type CashierRevenueSnapshot = z.infer<typeof cashierRevenueSnapshotSchema>;

export interface CashierRevenueQuery {
    from: string;
    to: string;
    dept?: string;
}

/** يجلب لقطة إيرادات الكاشير للفترة المطلوبة. */
export async function fetchCashierRevenues(
    query: CashierRevenueQuery,
    signal?: AbortSignal,
): Promise<CashierRevenueSnapshot> {
    const params = new URLSearchParams({ from: query.from, to: query.to });
    if (query.dept) {
        params.set('dept', query.dept);
    }
    return fetchJson(
        cashierRevenueSnapshotSchema,
        `/api/cashier-revenues?${params.toString()}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

/** تسمية القسم: الاسم العربي أولًا ثم الخام (كاشير 1) ثم رمز القسم. */
export function cashierLabel(row: CashierRevenueRow): string {
    return row.displayAr || row.source || row.deptCode || 'غير محدد';
}

/** نصّ بحثٍ يطابق الاسم أو الرمز أو الاسم الإنجليزي. */
export function cashierMatches(row: CashierRevenueRow, needle: string): boolean {
    const text = needle.trim();
    if (!text) {
        return true;
    }
    return (
        cashierLabel(row).includes(text) ||
        (row.source ?? '').includes(text) ||
        (row.displayEn ?? '').toLowerCase().includes(text.toLowerCase()) ||
        row.deptCode.includes(text)
    );
}
