import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * البيع الخارجي — المسحوبات من المخزن مقابل المبيعات (مرآة Oracle).
 * المصدر الحقيقي للأرقام: خادم `/api/external-sales/summary` — لا حساب هنا.
 */

const issueRowSchema = z
    .object({
        date: z.string(),
        doc: z.string(),
        item: z.string(),
        qty: z.number(),
        unit: z.string().optional(),
        cost: z.number(),
        value: z.number(),
        status: z.string().optional(),
    })
    .passthrough();

const byItemSchema = z
    .object({
        item: z.string(),
        lines: z.number().optional(),
        qty: z.number(),
        value: z.number().optional(),
    })
    .passthrough();

const invoiceRowSchema = z
    .object({
        id: z.string(),
        date: z.string(),
        ref: z.string(),
        customer: z.string().nullable().optional(),
        amount: z.number(),
        items: z.number(),
        qty: z.number(),
    })
    .passthrough();

export const externalSalesSummarySchema = z
    .object({
        ok: z.boolean().optional(),
        from: z.string(),
        to: z.string(),
        issued: z
            .object({
                totals: z
                    .object({
                        lines: z.number(),
                        docs: z.number(),
                        qty: z.number(),
                        value: z.number(),
                    })
                    .passthrough(),
                rows: z.array(issueRowSchema),
                capped: z.boolean().optional(),
                byItem: z.array(byItemSchema),
            })
            .passthrough(),
        sold: z
            .object({
                totals: z
                    .object({
                        invoices: z.number(),
                        amount: z.number(),
                        qty: z.number(),
                        lines: z.number(),
                        unparsedLines: z.number().optional(),
                    })
                    .passthrough(),
                rows: z.array(invoiceRowSchema),
                byItem: z.array(byItemSchema),
            })
            .passthrough(),
    })
    .passthrough();

export type ExternalSalesSummary = z.infer<typeof externalSalesSummarySchema>;

export async function fetchExternalSales(from: string, to: string, signal?: AbortSignal): Promise<ExternalSalesSummary> {
    const params = new URLSearchParams({ from, to });
    return fetchJson(
        externalSalesSummarySchema,
        `/api/external-sales/summary?${params.toString()}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

/* ─── مساعدو العرض ─────────────────────────────────────────────────── */

export type ExternalSort = 'qty' | 'value' | 'name';

export function sortByItem<T extends { item: string }>(rows: T[], key: ExternalSort, dir: 'asc' | 'desc' = 'desc'): T[] {
    const sign = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        if (key === 'name') {
            return sign * String(a.item).localeCompare(String(b.item), 'ar');
        }
        const va = Number((a as { qty?: number; value?: number }).qty ?? 0);
        const vb = Number((b as { qty?: number; value?: number }).qty ?? 0);
        const waa = Number((a as { value?: number }).value ?? 0);
        const wbb = Number((b as { value?: number }).value ?? 0);
        if (key === 'value') {
            return sign * (waa - wbb);
        }
        return sign * (va - vb);
    });
}

export function sumQty<T extends { qty: number }>(rows: readonly T[]): number {
    return rows.reduce((sum, row) => sum + Number(row.qty ?? 0), 0);
}

export function share(part: number, total: number): number {
    return total > 0 ? (part / total) * 100 : 0;
}

/* ─── مطابقة الأصناف: مباع مقابل مسحوب (تشخيص الخسارة) ─────────────────── */

export type CoverageStatus = 'unissued' | 'no-sales' | 'partial' | 'covered';

export interface CoverageRow {
    /** اسم الصنف كما في مرآة Oracle/المخزن. */
    item: string;
    soldQty: number;
    issuedQty: number;
    issuedValue: number;
    /** مباع ÷ مسحوب — null عند بلا مسحوبات. */
    coverage: number | null;
    status: CoverageStatus;
}

export const COVERAGE_STATUS_LABEL: Record<CoverageStatus, string> = {
    'no-sales': 'بلا مبيعات',
    partial: 'تغطية جزئية',
    covered: 'مغطاة',
    unissued: 'مبيعات بدون صرف',
};

export function buildCoverageRows(summary: ExternalSalesSummary): CoverageRow[] {
    const sold = new Map<string, number>(summary.sold.byItem.map((row) => [String(row.item), Number(row.qty) || 0]));
    const issued = new Map<string, (typeof summary.issued.byItem)[number]>(summary.issued.byItem.map((row) => [String(row.item), row]));
    const names = new Set<string>([...sold.keys(), ...issued.keys()]);
    const rows: CoverageRow[] = [];
    for (const item of names) {
        const soldQty = sold.get(item) ?? 0;
        const issue = issued.get(item);
        const issuedQty = Number(issue?.qty ?? 0) || 0;
        const issuedValue = Number(issue?.value ?? 0) || 0;
        let status: CoverageStatus;
        if (issuedQty === 0) {
            status = 'unissued';
        } else if (soldQty === 0) {
            status = 'no-sales';
        } else if (soldQty >= issuedQty) {
            status = 'covered';
        } else {
            status = 'partial';
        }
        rows.push({
            item,
            soldQty,
            issuedQty,
            issuedValue,
            coverage: issuedQty > 0 ? soldQty / issuedQty : null,
            status,
        });
    }
    rows.sort((a, b) => b.issuedValue - a.issuedValue || b.soldQty - a.soldQty || a.item.localeCompare(b.item, 'ar'));
    return rows;
}

export interface CoverageSummary {
    noSalesCount: number;
    noSalesValue: number;
    partialCount: number;
    coveredCount: number;
    unissuedCount: number;
}

export function coverageSummary(rows: readonly CoverageRow[]): CoverageSummary {
    let noSalesCount = 0;
    let noSalesValue = 0;
    let partialCount = 0;
    let coveredCount = 0;
    let unissuedCount = 0;
    for (const row of rows) {
        if (row.status === 'no-sales') {
            noSalesCount += 1;
            noSalesValue += row.issuedValue;
        } else if (row.status === 'partial') {
            partialCount += 1;
        } else if (row.status === 'covered') {
            coveredCount += 1;
        } else {
            unissuedCount += 1;
        }
    }
    return {
        noSalesCount,
        noSalesValue: Math.round(noSalesValue * 100) / 100,
        partialCount,
        coveredCount,
        unissuedCount,
    };
}

/* ─── الفترة السابقة (نفس طول الفترة الحالية) ───────────────────────────── */

function isoOf(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function previousPeriod(from: string, to: string): { prevFrom: string; prevTo: string } {
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        return { prevFrom: from, prevTo: from };
    }
    const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
    const prevTo = new Date(start - 86400000);
    const prevFrom = new Date(start - days * 86400000);
    return { prevFrom: isoOf(prevFrom), prevTo: isoOf(prevTo) };
}

/** نسبة التغيّر % — null عند فترة سابقة صفرية (لا ندّعي نسبة بلا أساس). */
export function deltaPct(current: number, previous: number): number | null {
    if (!Number.isFinite(previous) || previous === 0) {
        return null;
    }
    return ((current - previous) / Math.abs(previous)) * 100;
}

/* ─── تصدير CSV (BOM للعربية، فاصلة منقوطة لـ Excel) ────────────────────── */

const CSV_BOM = '﻿';

export function toCsv(headers: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
    const esc = (value: string | number): string => {
        const s = String(value ?? '');
        if (/^[=+\-@]/.test(s.trim()) && Number.isNaN(Number(s))) {
            return `'${s}`; // حقن الصيغ في جداول البيانات
        }
        if (/[";\r\n]/.test(s)) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    };
    const lines = [headers.map(esc).join(';')];
    for (const row of rows) {
        lines.push(row.map(esc).join(';'));
    }
    return `${CSV_BOM}${lines.join('\r\n')}`;
}
