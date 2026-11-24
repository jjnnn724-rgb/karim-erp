import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * تبويبات النمو السبعة للمدير المالي — نفس أبواب v2 (`cfo-repo.js`):
 *
 *   /api/accounting/profit-by-cost-center?from&to  ربحية المراكز
 *   /api/accounting/ap-aging                       أعمار ذمم الموردين
 *   /api/accounting/bank-rec?account&from&to       التسوية البنكية
 *   /api/accounting/fixed-assets                   الأصول والإهلاك
 *   /api/accounting/cash-custody                   عهد الكاشير
 *   /api/accounting/budget-vs-actual?period        الموازنات مقابل الفعلي
 *   /api/accounting/alerts/log                     سجل التنبيهات
 *
 * قراءة فقط بقرار v3 (الكتابة: قيد/استبعاد أصل/تسليم عهدة/موازنة جديدة تُنفَّذ
 * في v2). الخادم هو من يحسب الانحراف والتجاوز والنسبة؛ الواجهة تعرضها كما وردت.
 */

const numLike = z.union([z.string(), z.number()]).nullable().optional();
const text = z.string().nullable().optional();
const flag = z.boolean().nullable().optional();
const idLike = z.union([z.string(), z.number()]);

export const profitByCcSchema = z
    .object({
        ok: flag,
        from: text,
        to: text,
        centers: z
            .array(
                z
                    .object({
                        cc: text,
                        cc_name: text,
                        revenue: numLike,
                        cogs: numLike,
                        expense: numLike,
                        net: numLike,
                    })
                    .passthrough(),
            )
            .optional(),
    })
    .passthrough();
export type ProfitByCc = z.infer<typeof profitByCcSchema>;

export const apAgingSchema = z
    .object({
        ok: flag,
        count: numLike,
        total: numLike,
        aging: z
            .array(
                z
                    .object({
                        supplier: text,
                        total: numLike,
                        current: numLike,
                        d30: numLike,
                        d60: numLike,
                        d90: numLike,
                        over90: numLike,
                    })
                    .passthrough(),
            )
            .optional(),
    })
    .passthrough();
export type ApAging = z.infer<typeof apAgingSchema>;

export const bankRecSchema = z
    .object({
        ok: flag,
        account: text,
        from: text,
        to: text,
        book: numLike,
        statement: numLike,
        diff: numLike,
        unmatched: z
            .array(
                z
                    .object({
                        id: idLike.optional(),
                        stmt_date: text,
                        description: text,
                        amount: numLike,
                        matched: flag,
                    })
                    .passthrough(),
            )
            .optional(),
    })
    .passthrough();
export type BankRec = z.infer<typeof bankRecSchema>;

export const fixedAssetsSchema = z
    .object({
        ok: flag,
        assets: z
            .array(
                z
                    .object({
                        id: idLike,
                        name: text,
                        category: text,
                        purchase_date: text,
                        cost: numLike,
                        salvage: numLike,
                        accumulated: numLike,
                        life_months: numLike,
                        status: text,
                        last_month: text,
                        /** مشتقة في الخادم: (cost − salvage) / life_months */
                        monthly: numLike,
                        /** مشتقة في الخادم: cost − salvage − accumulated */
                        remaining: numLike,
                    })
                    .passthrough(),
            )
            .optional(),
    })
    .passthrough();
export type FixedAssets = z.infer<typeof fixedAssetsSchema>;
export type FixedAsset = NonNullable<FixedAssets['assets']>[number];

export const custodySchema = z
    .object({
        ok: flag,
        date: text,
        myPending: numLike,
        rows: z
            .array(
                z
                    .object({
                        id: idLike,
                        custody_date: text,
                        from_cashier: numLike,
                        to_cashier: numLike,
                        from_name: text,
                        to_name: text,
                        amount: numLike,
                        note: text,
                        ack_at: text,
                        created_at: text,
                    })
                    .passthrough(),
            )
            .optional(),
    })
    .passthrough();
export type Custody = z.infer<typeof custodySchema>;

export const budgetVsActualSchema = z
    .object({
        ok: flag,
        period: text,
        rows: z
            .array(
                z
                    .object({
                        id: idLike,
                        label: text,
                        account_code: text,
                        account_name: text,
                        acc_type: text,
                        budget: numLike,
                        actual: numLike,
                        variance: numLike,
                        over: flag,
                        under: flag,
                        alert: flag,
                        pct: numLike,
                    })
                    .passthrough(),
            )
            .optional(),
    })
    .passthrough();
export type BudgetVsActual = z.infer<typeof budgetVsActualSchema>;

export const alertsLogSchema = z
    .object({
        ok: flag,
        log: z
            .array(
                z
                    .object({
                        key: text,
                        last_sent_at: text,
                        last_title: text,
                        times_sent: numLike,
                    })
                    .passthrough(),
            )
            .optional(),
    })
    .passthrough();
export type AlertsLog = z.infer<typeof alertsLogSchema>;

function options(signal?: AbortSignal): { signal?: AbortSignal } {
    return signal ? { signal } : {};
}

export function fetchProfitByCc(from: string, to: string, signal?: AbortSignal) {
    return fetchJson(
        profitByCcSchema,
        `/api/accounting/profit-by-cost-center?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        getAccessToken(),
        options(signal),
    );
}

export function fetchApAging(signal?: AbortSignal) {
    return fetchJson(apAgingSchema, '/api/accounting/ap-aging', getAccessToken(), options(signal));
}

export function fetchBankRec(account: string, from: string, to: string, signal?: AbortSignal) {
    return fetchJson(
        bankRecSchema,
        `/api/accounting/bank-rec?account=${encodeURIComponent(account)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        getAccessToken(),
        options(signal),
    );
}

export function fetchFixedAssets(signal?: AbortSignal) {
    return fetchJson(fixedAssetsSchema, '/api/accounting/fixed-assets', getAccessToken(), options(signal));
}

export function fetchCustody(signal?: AbortSignal) {
    return fetchJson(custodySchema, '/api/accounting/cash-custody', getAccessToken(), options(signal));
}

export function fetchBudgetVsActual(period: string, signal?: AbortSignal) {
    return fetchJson(
        budgetVsActualSchema,
        `/api/accounting/budget-vs-actual?period=${encodeURIComponent(period)}`,
        getAccessToken(),
        options(signal),
    );
}

export function fetchAlertsLog(signal?: AbortSignal) {
    return fetchJson(alertsLogSchema, '/api/accounting/alerts/log', getAccessToken(), options(signal));
}
