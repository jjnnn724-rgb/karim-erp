import { addMoney } from '@karim/shared';
import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

export const FISCAL_READ_ROLES = ['admin', 'manager', 'accountant'] as const;
export const FISCAL_CREATE_ROLES = ['admin', 'manager', 'accountant'] as const;
export const FISCAL_CLOSE_ROLES = ['admin'] as const;
export const OPENING_READ_ROLES = ['admin', 'manager', 'warehouse'] as const;
export const HEALTH_READ_ROLES = ['admin'] as const;

const numeric = z.union([z.string(), z.number()]).nullable().optional();
const objectValue = z.record(z.string(), z.unknown()).nullable().optional();

const fiscalYearSchema = z
    .object({
        id: z.union([z.string(), z.number()]),
        year_code: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        start_date: z.string().nullable().optional(),
        end_date: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        closed_at: z.string().nullable().optional(),
        closed_by: z.union([z.string(), z.number()]).nullable().optional(),
        closing_snapshot: z.union([objectValue, z.string()]).optional(),
        opening_balances: z.union([objectValue, z.string()]).optional(),
    })
    .passthrough();

const fiscalYearsSchema = z.array(fiscalYearSchema);

const openingItemSchema = z
    .object({
        itemId: z.union([z.string(), z.number()]).nullable().optional(),
        itemName: z.string().nullable().optional(),
        qty: numeric,
        unit: z.string().nullable().optional(),
        price: numeric,
        category: z.string().nullable().optional(),
        packagingQty: numeric,
        currentQty: numeric,
        issuedSince: numeric,
        itemExists: z.boolean().optional(),
    })
    .passthrough();

const openingInvoiceSchema = z
    .object({
        id: z.union([z.string(), z.number()]).nullable().optional(),
        invoiceNumber: z.string().nullable().optional(),
        date: z.string().nullable().optional(),
        totalAmount: numeric,
        notes: z.string().nullable().optional(),
        items: z.array(openingItemSchema).optional(),
    })
    .passthrough();

const openingReportSchema = z.object({ invoices: z.array(openingInvoiceSchema) }).passthrough();

const healthSchema = z
    .object({
        ok: z.boolean().optional(),
        itemsTotal: numeric,
        consistent: numeric,
        anomaliesCount: numeric,
        zeroStock: numeric,
        lowStock: numeric,
        anomalies: z
            .array(z.object({ name: z.string().nullable().optional(), issue: z.string().nullable().optional() }).passthrough())
            .optional(),
    })
    .passthrough();

export type FiscalYear = {
    id: string;
    yearCode: string;
    name: string;
    startDate: string;
    endDate: string;
    status: string;
    closedAt: string;
    closedBy: string;
    openingCount: number;
    snapshot: {
        revenueCount: number;
        revenueTotal: string;
        expenseCount: number;
        expenseTotal: string;
        purchaseCount: number;
        purchaseTotal: string;
        netResult: string;
        inventoryValue: string;
        inventoryCount: number;
    };
    hasSnapshot: boolean;
};

export type OpeningItem = {
    itemId: string | null;
    name: string;
    qty: number;
    unit: string;
    price: string;
    category: string;
    packagingQty: number | null;
    currentQty: number | null;
    issuedSince: number;
    itemExists: boolean;
};

export type OpeningInvoice = {
    id: string;
    number: string;
    date: string;
    totalAmount: string;
    notes: string;
    items: OpeningItem[];
};

export type HealthSummary = {
    ok: boolean;
    itemsTotal: number;
    consistent: number;
    anomaliesCount: number;
    zeroStock: number;
    lowStock: number;
    anomalies: { name: string; issue: string }[];
};

function num(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNum(value: unknown): number | null {
    return value === null || value === undefined ? null : num(value);
}

function moneyText(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '0';
}

function day(value: unknown): string {
    return String(value ?? '').slice(0, 10);
}

function recordValue(value: unknown): Record<string, unknown> {
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed: unknown = JSON.parse(value);
            return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        } catch {
            return {};
        }
    }
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function fiscalYearToRow(raw: z.infer<typeof fiscalYearSchema>): FiscalYear {
    const snapshot = recordValue(raw.closing_snapshot);
    const opening = recordValue(raw.opening_balances);
    const inventory = Array.isArray(opening.inventory) ? opening.inventory : [];
    return {
        id: String(raw.id),
        yearCode: String(raw.year_code ?? ''),
        name: String(raw.name ?? ''),
        startDate: day(raw.start_date),
        endDate: day(raw.end_date),
        status: String(raw.status ?? ''),
        closedAt: String(raw.closed_at ?? ''),
        closedBy: raw.closed_by == null ? '' : String(raw.closed_by),
        openingCount: inventory.length,
        snapshot: {
            revenueCount: num(snapshot.revenue_count),
            revenueTotal: moneyText(snapshot.revenue_total),
            expenseCount: num(snapshot.expense_count),
            expenseTotal: moneyText(snapshot.expense_total),
            purchaseCount: num(snapshot.purchase_count),
            purchaseTotal: moneyText(snapshot.purchase_total),
            netResult: moneyText(snapshot.net_result),
            inventoryValue: moneyText(snapshot.inventory_value),
            inventoryCount: num(snapshot.inventory_count),
        },
        hasSnapshot: Object.keys(snapshot).length > 0,
    };
}

export function fiscalSummary(rows: readonly FiscalYear[]) {
    const open = rows.filter((row) => row.status === 'open');
    return {
        total: rows.length,
        open: open.length,
        closed: rows.length - open.length,
        current: open[0] ?? rows[0] ?? null,
    };
}

function openingItemToRow(raw: z.infer<typeof openingItemSchema>): OpeningItem {
    return {
        itemId: raw.itemId == null ? null : String(raw.itemId),
        name: String(raw.itemName ?? ''),
        qty: num(raw.qty),
        unit: String(raw.unit ?? ''),
        price: moneyText(raw.price),
        category: String(raw.category ?? ''),
        packagingQty: optionalNum(raw.packagingQty),
        currentQty: optionalNum(raw.currentQty),
        issuedSince: num(raw.issuedSince),
        itemExists: raw.itemExists === true,
    };
}

export function openingToInvoice(raw: z.infer<typeof openingInvoiceSchema>): OpeningInvoice {
    return {
        id: String(raw.id ?? ''),
        number: String(raw.invoiceNumber ?? ''),
        date: day(raw.date),
        totalAmount: moneyText(raw.totalAmount),
        notes: String(raw.notes ?? ''),
        items: (raw.items ?? []).map(openingItemToRow),
    };
}

export function openingTotals(invoices: readonly OpeningInvoice[]) {
    const items = invoices.flatMap((invoice) => invoice.items);
    return {
        invoices: invoices.length,
        lines: items.length,
        qty: items.reduce((sum, item) => sum + item.qty, 0),
        issuedSince: items.reduce((sum, item) => sum + item.issuedSince, 0),
        totalAmount: invoices.reduce((sum, invoice) => addMoney(sum, invoice.totalAmount), '0.00'),
        missing: items.filter((item) => !item.itemExists).length,
    };
}

export function healthSummary(raw: z.infer<typeof healthSchema>): HealthSummary {
    return {
        ok: raw.ok === true,
        itemsTotal: num(raw.itemsTotal),
        consistent: num(raw.consistent),
        anomaliesCount: num(raw.anomaliesCount),
        zeroStock: num(raw.zeroStock),
        lowStock: num(raw.lowStock),
        anomalies: (raw.anomalies ?? []).map((item) => ({
            name: String(item.name ?? ''),
            issue: String(item.issue ?? ''),
        })),
    };
}

const fiscalDate = /^\d{4}-\d{2}-\d{2}$/;

export function validateFiscalYearForm(form: {
    startDate: string;
    endDate: string;
}): { field: 'startDate' | 'endDate'; message: string }[] {
    const startDate = form.startDate.trim().slice(0, 10);
    const endDate = form.endDate.trim().slice(0, 10);
    if (!fiscalDate.test(startDate)) {
        return [{ field: 'startDate', message: 'تاريخ البداية مطلوب بصيغة YYYY-MM-DD.' }];
    }
    if (!fiscalDate.test(endDate)) {
        return [{ field: 'endDate', message: 'تاريخ النهاية مطلوب بصيغة YYYY-MM-DD.' }];
    }
    if (endDate < startDate) {
        return [{ field: 'endDate', message: 'نهاية السنة تسبق بدايتها — تحقق من التاريخين.' }];
    }
    return [];
}

export function normalizeFiscalYearForm(form: { startDate: string; endDate: string; yearCode: string; name: string; notes: string }) {
    const startDate = form.startDate.trim().slice(0, 10);
    const endDate = form.endDate.trim().slice(0, 10);
    const yearCode = form.yearCode.trim() || startDate.slice(0, 4);
    return {
        startDate,
        endDate,
        yearCode,
        name: (form.name.trim() || `السنة المالية ${yearCode}`).slice(0, 120),
        notes: form.notes.trim() || null,
    };
}

export function fiscalWriteEnabled(search?: string, stored?: string | null): boolean {
    const query = search ?? (typeof window === 'undefined' ? '' : window.location.search);
    const match = /(?:^|[?&])v2fiscalwrite=([^&]*)/.exec(query);
    if (match) {
        return match[1] !== '0';
    }
    let persisted = stored;
    if (persisted === undefined && typeof window !== 'undefined') {
        try {
            persisted = window.localStorage.getItem('karim_v2_fiscal_write');
        } catch {
            persisted = null;
        }
    }
    return persisted === '1';
}

export async function fetchFiscalYears(signal?: AbortSignal): Promise<FiscalYear[]> {
    return (await fetchJson(fiscalYearsSchema, '/api/warehouse/fiscal-years', getAccessToken(), signal ? { signal } : {})).map(
        fiscalYearToRow,
    );
}

export async function createFiscalYear(form: ReturnType<typeof normalizeFiscalYearForm>): Promise<void> {
    await fetchJson(z.unknown(), '/api/warehouse/fiscal-years', getAccessToken(), {
        method: 'POST',
        body: form,
    });
}

export async function closeFiscalYear(id: string): Promise<void> {
    await fetchJson(z.unknown(), `/api/warehouse/fiscal-years/${encodeURIComponent(id)}/close`, getAccessToken(), {
        method: 'POST',
    });
}

export async function createNextFiscalYear(id: string): Promise<void> {
    await fetchJson(z.unknown(), `/api/warehouse/fiscal-years/${encodeURIComponent(id)}/create-next`, getAccessToken(), { method: 'POST' });
}

export async function fetchOpeningBalanceReport(signal?: AbortSignal): Promise<OpeningInvoice[]> {
    const report = await fetchJson(
        openingReportSchema,
        '/api/warehouse/opening-balance/report',
        getAccessToken(),
        signal ? { signal } : {},
    );
    return report.invoices.map(openingToInvoice);
}

export async function fetchSystemHealth(signal?: AbortSignal): Promise<HealthSummary> {
    return healthSummary(await fetchJson(healthSchema, '/api/warehouse/system-health', getAccessToken(), signal ? { signal } : {}));
}
