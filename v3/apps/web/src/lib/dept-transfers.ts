import { addMoney, fromCents, roundHalfUp } from '@karim/shared';
import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * التحويلات الداخلية بين الأقسام — قراءة فقط من
 * `/api/warehouse/dept-transfers` بنفس عقد القديم
 * (`frontend/app/js/v2/data/transfer-repo.js`): قائمة أحدث 200 إذن + لوحة
 * ملخص الفترة. أسماء الأقسام تُحل من `/api/departments` لأن الخادم يعيد
 * الأكواد في `metadata`.
 *
 * قرار المالك (2026-11-02) محفوظ هنا: تحويلات التحقق الحي (`metadata.test`)
 * تُخفى من الجدول والمؤشرات، ولوحة الملخص تستبعدها في SQL.
 *
 * الإنشاء والاعتماد والرفض والإلغاء والبيع الخارجي وتقرير فرق المصنع
 * (الذي يقرأ مبيعات يارا) تبقى في الشاشة القديمة — هذا الملف لا يكتب.
 */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));

const numeric = z.union([z.string(), z.number()]).nullable().optional();

const optionalText = z.string().nullable().optional();

const transferItemSchema = z
    .object({
        inventory_id: z
            .union([z.string(), z.number()])
            .nullable()
            .optional()
            .transform((value) => (value === null || value === undefined ? '' : String(value))),
        unit: optionalText,
        requested_qty: numeric,
        received_qty: numeric,
        variance_qty: numeric,
        unit_cost: numeric,
    })
    .passthrough();

export const inventoryTransferSchema = z
    .object({
        id: idValue,
        transfer_number: optionalText,
        status: optionalText,
        requested_by: numeric,
        approved_by: numeric,
        created_at: optionalText,
        approved_at: optionalText,
        notes: optionalText,
        metadata: z.record(z.string(), z.unknown()).nullable().optional(),
        items: z.array(transferItemSchema).nullable().optional(),
    })
    .passthrough();

export type InventoryTransfer = z.infer<typeof inventoryTransferSchema>;

const transferListSchema = z.array(inventoryTransferSchema);

export const TRANSFER_LIST_LIMIT = 200;

export async function fetchDeptTransfers(signal?: AbortSignal): Promise<InventoryTransfer[]> {
    return fetchJson(
        transferListSchema,
        `/api/warehouse/dept-transfers?limit=${String(TRANSFER_LIST_LIMIT)}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

/* ─── لوحة الملخص ─────────────────────────────────────────────────────── */

const summaryDeptSchema = z
    .object({
        dept_code: optionalText,
        dept_name: optionalText,
        transfers: numeric,
        qty: numeric,
        value: numeric,
    })
    .passthrough();

const topItemSchema = z
    .object({
        inventory_id: z.union([z.string(), z.number()]).nullable().optional(),
        item_name: optionalText,
        unit: optionalText,
        qty: numeric,
        value: numeric,
    })
    .passthrough();

const dailySchema = z
    .object({
        day: optionalText,
        transfers: numeric,
        value: numeric,
    })
    .passthrough();

const totalsSchema = z
    .object({
        transfers: numeric,
        lines: numeric,
        qty: numeric,
        value: numeric,
        sources: numeric,
        destinations: numeric,
    })
    .passthrough();

export const transferSummarySchema = z
    .object({
        from: optionalText,
        to: optionalText,
        mode: optionalText,
        totals: totalsSchema.nullable().optional(),
        bySource: z.array(summaryDeptSchema).nullable().optional(),
        byDest: z.array(summaryDeptSchema).nullable().optional(),
        topItems: z.array(topItemSchema).nullable().optional(),
        daily: z.array(dailySchema).nullable().optional(),
    })
    .passthrough();

export type TransferSummary = z.infer<typeof transferSummarySchema>;
export type TransferSummaryDept = z.infer<typeof summaryDeptSchema>;
export type TransferTopItem = z.infer<typeof topItemSchema>;
export type TransferDaily = z.infer<typeof dailySchema>;

/** لوحة الفترة — الافتراضي في الخادم هو شهر الرياض الحالي إن غاب النطاق. */
export async function fetchTransferSummary(from: string, to: string, signal?: AbortSignal): Promise<TransferSummary> {
    const query = new URLSearchParams();
    if (from) {
        query.set('from', from);
    }
    if (to) {
        query.set('to', to);
    }
    return fetchJson(
        transferSummarySchema,
        `/api/warehouse/dept-transfers/summary?${query.toString()}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

/* ─── الدلالات المنقولة حرفًا من القديم ───────────────────────────────── */

export const TRANSFER_STATUS_LABELS: Record<string, string> = {
    requested: 'بانتظار اعتماد الشيف',
    received: 'منفَّذ ومكتمل',
    rejected: 'مرفوض',
    cancelled: 'ملغى',
};

/** ترتيب شرائح الحالة كما في تبويبات القديم (`dept-transfers.js:68-74`). */
export const TRANSFER_STATUS_ORDER = ['requested', 'received', 'rejected', 'cancelled'] as const;

function metadataText(metadata: Record<string, unknown> | null | undefined, key: string): string {
    const value = metadata?.[key];
    return value === null || value === undefined ? '' : String(value);
}

function metadataFlag(metadata: Record<string, unknown> | null | undefined, key: string): boolean {
    return metadataText(metadata, key) === 'true';
}

/** كمية البند للعرض والحساب: المستلَمة أولًا ثم المطلوبة — `??` كما في القديم. */
function itemQtyRaw(item: z.infer<typeof transferItemSchema>): string {
    const value = item.received_qty ?? item.requested_qty;
    return value === null || value === undefined ? '0' : String(value);
}

function itemCostRaw(item: z.infer<typeof transferItemSchema>): string {
    const value = item.unit_cost;
    return value === null || value === undefined ? '0' : String(value);
}

type Decimal = { scaled: bigint; scale: number };

function decimalParts(raw: string): Decimal | null {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw.trim());
    if (!match) {
        return null;
    }
    const fraction = match[3] ?? '';
    const scaled = BigInt(`${match[2] ?? '0'}${fraction}`);
    return { scaled: match[1] === '-' ? -scaled : scaled, scale: fraction.length };
}

/** عددٌ مضروب في 10^scale مقرَّب HALF_UP إلى المليم. */
function scaledToCents(value: bigint, scale: number): bigint {
    if (scale <= 2) {
        return value * 10n ** BigInt(2 - scale);
    }
    const denominator = 10n ** BigInt(scale - 2);
    let cents = value / denominator;
    const remainder = value % denominator;
    const magnitude = remainder < 0n ? -remainder : remainder;
    if (magnitude * 2n >= denominator) {
        cents += value < 0n ? -1n : 1n;
    }
    return cents;
}

/**
 * قيمة بند التحويل = Σ(كمية × تكلفة) ثم تقريبٌ واحد إلى المليم.
 *
 * لا تقريب لكل بند قبل الجمع: القديم (`transferValue`) يجمع الحواصل ثم
 * يعرضها، والخادم في `/summary` يجمع `NUMERIC` ثم يقرّب الإجمالي — فتقريب
 * البنود أولًا يزيح الإجمالي سنتاتٍ عن لوحة الملخص (قيس حيًّا: 33,072.07
 * مقابل 33,072.05). الضرب والجمع هنا على أعداد صحيحة (ADR-04، بلا Float).
 */
function itemsValueCents(items: readonly z.infer<typeof transferItemSchema>[]): bigint {
    const parts: { product: bigint; scale: number }[] = [];
    let maxScale = 0;
    for (const item of items) {
        const qty = decimalParts(itemQtyRaw(item));
        const cost = decimalParts(itemCostRaw(item));
        if (!qty || !cost) {
            continue;
        }
        const scale = qty.scale + cost.scale;
        parts.push({ product: qty.scaled * cost.scaled, scale });
        if (scale > maxScale) {
            maxScale = scale;
        }
    }
    let total = 0n;
    for (const part of parts) {
        total += part.product * 10n ** BigInt(maxScale - part.scale);
    }
    return scaledToCents(total, maxScale);
}

function formatQty(value: number): string {
    return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function itemsText(transfer: InventoryTransfer, max = 3): string {
    const items = Array.isArray(transfer.items) ? transfer.items : [];
    const names = items.map((item) => `صنف #${item.inventory_id}`);
    if (names.length === 0) {
        return '—';
    }
    const head = names.slice(0, max).join('، ');
    return names.length > max ? `${head} +${names.length - max}` : head;
}

export type TransferRow = {
    id: string;
    number: string;
    status: string;
    statusLabel: string;
    statusKnown: boolean;
    fromCode: string;
    fromName: string;
    toCode: string;
    toName: string;
    mode: string;
    external: boolean;
    test: boolean;
    factory: boolean;
    factoryValue: string;
    itemsText: string;
    itemsCount: number;
    qty: number;
    qtyText: string;
    value: string;
    requestedBy: string;
    approvedBy: string;
    createdAt: string;
    notes: string;
    rejectionReason: string;
};

/** صف سجل جاهز للعرض — الأسماء تُحل من خريطة `/api/departments`. */
export function transferToRow(transfer: InventoryTransfer, deptNames: ReadonlyMap<string, string>): TransferRow {
    const metadata = transfer.metadata ?? {};
    const fromCode = metadataText(metadata, 'sourceDeptCode');
    const toCode = metadataText(metadata, 'destDeptCode');
    const items = Array.isArray(transfer.items) ? transfer.items : [];
    const qty = items.reduce((sum, item) => sum + Number(itemQtyRaw(item)), 0);
    const cents = itemsValueCents(items);
    const status = String(transfer.status ?? '');
    return {
        id: transfer.id,
        number: String(transfer.transfer_number ?? transfer.id),
        status,
        statusLabel: TRANSFER_STATUS_LABELS[status] ?? (status || 'غير محدد'),
        statusKnown: Object.hasOwn(TRANSFER_STATUS_LABELS, status),
        fromCode,
        fromName: deptNames.get(fromCode.toLowerCase()) ?? (fromCode || '—'),
        toCode,
        toName: deptNames.get(toCode.toLowerCase()) ?? (toCode || '—'),
        mode: metadataText(metadata, 'mode'),
        external: metadataText(metadata, 'mode') === 'external_sale',
        test: metadataFlag(metadata, 'test'),
        factory: metadataFlag(metadata, 'factory'),
        factoryValue: roundHalfUp(metadataText(metadata, 'factory_total_value') || '0', 2),
        itemsText: itemsText(transfer),
        itemsCount: items.length,
        qty,
        qtyText: formatQty(qty),
        value: fromCents(cents),
        requestedBy: String(transfer.requested_by ?? ''),
        approvedBy: String(transfer.approved_by ?? ''),
        createdAt: String(transfer.created_at ?? '').slice(0, 10),
        notes: String(transfer.notes ?? ''),
        rejectionReason: metadataText(metadata, 'rejection_reason'),
    };
}

export type TransferTotals = {
    total: number;
    pending: number;
    done: number;
    rejected: number;
    cancelled: number;
    value: string;
};

export function summarizeTransfers(rows: readonly TransferRow[]): TransferTotals {
    const totals: TransferTotals = {
        total: rows.length,
        pending: 0,
        done: 0,
        rejected: 0,
        cancelled: 0,
        value: '0.00',
    };
    for (const row of rows) {
        if (row.status === 'requested') {
            totals.pending += 1;
        } else if (row.status === 'received') {
            totals.done += 1;
            totals.value = addMoney(totals.value, row.value);
        } else if (row.status === 'rejected') {
            totals.rejected += 1;
        } else if (row.status === 'cancelled') {
            totals.cancelled += 1;
        }
    }
    return totals;
}

/* ─── عرض لوحة الملخص ─────────────────────────────────────────────────── */

export function summaryValue(value: unknown): string {
    return roundHalfUp(String(value ?? '0'), 2);
}

export function summaryQty(value: unknown): string {
    return formatQty(Number(value ?? 0));
}

export function summaryInt(value: unknown): number {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
}
