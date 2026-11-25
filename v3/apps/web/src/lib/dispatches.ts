import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * أذون الصرف — قراءة فقط من `/api/dispatches` بنفس عقد القديم
 * (`dispatch-repo.js`): `?page=&limit=&sort=id&order=desc[&v2_period=month]`
 * ثم `{data, pagination}`. الشهر الحالي 5 صفحات (5,000 إذن) وكل السجل 40
 * صفحة (40,000) — نفس سقفي القديم المعلنين على الشاشة.
 *
 * التواقيع وبصماتها مادة إثبات لا أعمدة سجل: لا تُعرض في القائمة، وتُجلب
 * صور التوقيع فقط عند فتح ورقة إذن مفردة. الأصناف jsonb لا تُعرض كـ JSON خام.
 */

const dispatchItemSchema = z
    .object({
        itemName: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        qty: z.union([z.string(), z.number()]).nullable().optional(),
        approvedQty: z.union([z.string(), z.number()]).nullable().optional(),
        receivedQty: z.union([z.string(), z.number()]).nullable().optional(),
        receivedPackagingQty: z.union([z.string(), z.number()]).nullable().optional(),
        actualWeight: z.union([z.string(), z.number()]).nullable().optional(),
        packagingQty: z.union([z.string(), z.number()]).nullable().optional(),
        packagingUom: z.string().nullable().optional(),
        catchWeightEnabled: z
            .union([z.boolean(), z.string(), z.number()])
            .nullable()
            .optional()
            .transform((value) => value === true || value === 1 || value === '1' || value === 'true'),
        catchWeightUom: z.string().nullable().optional(),
        requestedQty: z.union([z.string(), z.number()]).nullable().optional(),
        unit: z.string().nullable().optional(),
    })
    .passthrough();

export const dispatchSchema = z
    .object({
        id: z.union([z.string(), z.number()]).transform((value) => String(value)),
        deptCode: z.string().nullable().optional(),
        deptName: z.string().nullable().optional(),
        items: z.array(dispatchItemSchema).nullable().optional(),
        approvedItems: z.array(dispatchItemSchema).nullable().optional(),
        status: z.string().nullable().optional(),
        date: z.string().nullable().optional(),
        requestedAt: z.string().nullable().optional(),
        createdBy: z.string().nullable().optional(),
        creatorUserId: z.union([z.string(), z.number()]).nullable().optional(),
        notes: z.string().nullable().optional(),
        approveNotes: z.string().nullable().optional(),
        receiptNotes: z.string().nullable().optional(),
        rejectionReason: z.string().nullable().optional(),
        cancellationReason: z.string().nullable().optional(),
        reopenReason: z.string().nullable().optional(),
        voidReason: z.string().nullable().optional(),
        chefApprovedBy: z.string().nullable().optional(),
        chefApprovedAt: z.string().nullable().optional(),
        warehouseApprovedBy: z.string().nullable().optional(),
        warehouseApprovedAt: z.string().nullable().optional(),
        approvedBy: z.string().nullable().optional(),
        approvedDate: z.string().nullable().optional(),
        warehouseRejectedBy: z.string().nullable().optional(),
        warehouseRejectedAt: z.string().nullable().optional(),
        chefRejectedBy: z.string().nullable().optional(),
        chefRejectedAt: z.string().nullable().optional(),
        kitchenReceiptSignatureData: z.string().nullable().optional(),
        kitchenReceivedBy: z.string().nullable().optional(),
        requestSignatureData: z.string().nullable().optional(),
        chefApprovalSignatureData: z.string().nullable().optional(),
        chefRejectionSignatureData: z.string().nullable().optional(),
        warehouseApprovalSignatureData: z.string().nullable().optional(),
        warehouseRejectionSignatureData: z.string().nullable().optional(),
        cancelledBy: z.string().nullable().optional(),
        cancelledAt: z.string().nullable().optional(),
        reopenedBy: z.string().nullable().optional(),
        reopenedAt: z.string().nullable().optional(),
        voidedBy: z.string().nullable().optional(),
        voidedAt: z.string().nullable().optional(),
        kitchenReceivedAt: z.string().nullable().optional(),
        receivedItems: z.array(dispatchItemSchema).nullable().optional(),
        needsChefApproval: z.boolean().nullable().optional(),
    })
    .passthrough();

export type Dispatch = z.infer<typeof dispatchSchema>;

const dispatchCostBucketSchema = z.object({
    date: z.string().optional(),
    month: z.string().optional(),
    dispatchCount: z.number(),
    totalCost: z.number(),
});

export const departmentDispatchReportSchema = z.object({
    ok: z.literal(true),
    departmentCodes: z.array(z.string()),
    from: z.string(),
    to: z.string(),
    dispatchCount: z.number(),
    totalCost: z.number(),
    daily: z.array(dispatchCostBucketSchema),
    monthly: z.array(dispatchCostBucketSchema),
});

export type DepartmentDispatchReport = z.infer<typeof departmentDispatchReportSchema>;

export async function fetchDepartmentDispatchReport(
    from: string,
    to: string,
    signal?: AbortSignal,
): Promise<DepartmentDispatchReport> {
    const params = new URLSearchParams({ from, to });
    return fetchJson(
        departmentDispatchReportSchema,
        `/api/warehouse/dispatches/department-report?${params.toString()}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

const pageSchema = z
    .object({
        data: z.array(dispatchSchema),
        pagination: z
            .object({
                totalPages: z.number().optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

const PAGE_SIZE = 1000;
export const MAX_PAGES_MONTH = 5;
export const MAX_PAGES_ALL = 40;

export type DispatchScope = 'month' | 'all';

export async function fetchDispatches(scope: DispatchScope, signal?: AbortSignal): Promise<Dispatch[]> {
    const rows: Dispatch[] = [];
    const maxPages = scope === 'all' ? MAX_PAGES_ALL : MAX_PAGES_MONTH;
    for (let page = 1; page <= maxPages; page += 1) {
        const params = new URLSearchParams({
            page: String(page),
            limit: String(PAGE_SIZE),
            sort: 'id',
            order: 'desc',
        });
        if (scope !== 'all') {
            params.set('v2_period', 'month');
        }
        const body = await fetchJson(
            pageSchema,
            `/api/dispatches?${params.toString()}`,
            getAccessToken(),
            signal ? { signal } : {},
        );
        rows.push(...body.data);
        const totalPages = body.pagination?.totalPages ?? 0;
        if (body.data.length < PAGE_SIZE || (totalPages > 0 && page >= totalPages)) {
            break;
        }
    }
    return rows;
}

/** تفاصيل الإذن المفردة، بما فيها التواقيع، لورقة الطباعة التشغيلية. */
export async function fetchDispatchDetails(id: string): Promise<Dispatch> {
    return fetchJson(dispatchSchema, `/api/dispatches/${encodeURIComponent(id)}`, getAccessToken());
}

export const DISPATCH_STATUS = {
    pending: { label: 'بانتظار اعتماد المخزن', tone: 'warning' },
    chef_approved: { label: 'معتمد من الشيف — بانتظار المخازن', tone: 'info' },
    approved: { label: 'معتمد — بانتظار استلام المطبخ', tone: 'success' },
    partially_received: { label: 'مستلم جزئيًا', tone: 'warning' },
    received: { label: 'مستلم ومغلق', tone: 'success' },
    rejected: { label: 'مرفوض من الإدارة', tone: 'danger' },
    cancelled: { label: 'ملغي قبل الصرف', tone: 'neutral' },
    voided: { label: 'مبطل — محفوظ بالسجل', tone: 'danger' },
} as const;

export type DispatchStatusTone = (typeof DISPATCH_STATUS)[keyof typeof DISPATCH_STATUS]['tone'] | 'neutral';

export const CHAIN_STAGE = {
    chefWait: 'بانتظار اعتماد الشيف العمومي',
    whWait: 'بانتظار اعتماد المخازن',
    chefDone: 'اعتمد الشيف — بانتظار صرف المخازن',
    dispensed: 'صُرف من المخازن — بانتظار الاستلام',
    partial: 'استُلم جزئيًا',
    received: 'مستلم ومغلق',
    rejected: 'مرفوض',
} as const;

const QTY_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

function num(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

/** ملخص الأصناف كما في القديم (kitchen.js:143): أول صنفين + عدّ الباقي. */
export function itemsSummary(items: readonly z.infer<typeof dispatchItemSchema>[] | null | undefined): string {
    if (!Array.isArray(items) || items.length === 0) {
        return '';
    }
    const names = items.map((item) => {
        const name = item.itemName || item.name ? String(item.itemName || item.name) : '—';
        const qty = num(item.approvedQty ?? item.qty);
        return `${name} (${QTY_FORMAT.format(qty)})`;
    });
    return names.length > 2 ? `${names.slice(0, 2).join('، ')}، +${String(names.length - 2)}` : names.join('، ');
}

export interface DispatchRow {
    id: string;
    dept: string;
    deptCode: string;
    itemsText: string;
    items: { name: string; qty: number }[];
    itemsCount: number;
    date: string;
    status: string;
    statusLabel: string;
    statusTone: DispatchStatusTone;
    statusKnown: boolean;
    stage: string;
    by: string;
    receivedBy: string;
    needsChefApproval: boolean;
}

export function statusOf(status: string): { label: string; tone: DispatchStatusTone; known: boolean } {
    if (Object.hasOwn(DISPATCH_STATUS, status) && status !== '') {
        const entry = DISPATCH_STATUS[status as keyof typeof DISPATCH_STATUS];
        return { label: entry.label, tone: entry.tone, known: true };
    }
    return { label: status || 'بلا حالة', tone: 'neutral', known: status === '' };
}

/** مرحلة السلسلة الحالية — مرآة dispatchChainStage في القديم. */
export function chainStage(status: string, needsChefApproval: boolean): string {
    if (status === 'pending') {
        return needsChefApproval ? CHAIN_STAGE.chefWait : CHAIN_STAGE.whWait;
    }
    if (status === 'chef_approved') {
        return CHAIN_STAGE.chefDone;
    }
    if (status === 'approved') {
        return CHAIN_STAGE.dispensed;
    }
    if (status === 'partially_received') {
        return CHAIN_STAGE.partial;
    }
    if (status === 'received') {
        return CHAIN_STAGE.received;
    }
    if (status === 'rejected') {
        return CHAIN_STAGE.rejected;
    }
    return '';
}

export function dispatchToRow(dispatch: Dispatch): DispatchRow {
    const status = String(dispatch.status ?? '');
    const state = statusOf(status);
    const needsChefApproval = dispatch.needsChefApproval === true;
    const items = dispatch.items ?? [];
    return {
        id: dispatch.id,
        dept: dispatch.deptName ? String(dispatch.deptName) : dispatch.deptCode ? String(dispatch.deptCode) : '—',
        deptCode: dispatch.deptCode ? String(dispatch.deptCode) : '',
        itemsText: itemsSummary(items),
        items: items
            .map((item) => ({
                name: String(item.itemName || item.name || ''),
                qty: num(item.approvedQty ?? item.qty),
            }))
            .filter((item) => item.name),
        itemsCount: items.length,
        date: dispatch.date ? String(dispatch.date).slice(0, 10) : '',
        status,
        statusLabel: state.label,
        statusTone: state.tone,
        statusKnown: state.known,
        stage: chainStage(status, needsChefApproval),
        by: dispatch.createdBy ? String(dispatch.createdBy) : '—',
        receivedBy: dispatch.kitchenReceivedBy ? String(dispatch.kitchenReceivedBy) : '',
        needsChefApproval,
    };
}

/** تطبيع بحث عربي — نفس جدول الحروف في القديم (`dispatch-repo.arSearchKey`). */
export function arSearchKey(value: string): string {
    return String(value || '')
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/[ىئی]/g, 'ي')
        .replace(/ؤ/g, 'و')
        .replace(/ک/g, 'ك')
        .replace(/[ذز]/g, 'ز')
        .replace(/[ضص]/g, 'ص')
        .replace(/[ظط]/g, 'ط')
        .replace(/[شس]/g, 'س')
        .replace(/[ثت]/g, 'ت')
        .replace(/[خج]/g, 'ح')
        .replace(/[قف]/g, 'ف')
        .replace(/[غع]/g, 'ع')
        .replace(/\s+/g, ' ')
        .trim();
}

/** بحث الصنف الخام لا الملخص — «دجاج» تجد «الدجاج» و«بدجاجه». */
export function matchDispatchProduct(row: DispatchRow, query: string): boolean {
    const key = arSearchKey(query);
    if (!key) {
        return true;
    }
    return row.items.some((item) => arSearchKey(item.name).includes(key));
}

/** تجميع المسحوب لصنف البحث: عدد الأذون وكميات الأصناف المطابقة. */
export function summarizeProductWithdrawal(
    rows: readonly DispatchRow[],
    query: string,
): { vouchers: number; byName: Map<string, number> } {
    const key = arSearchKey(query);
    const byName = new Map<string, number>();
    let vouchers = 0;
    for (const row of rows) {
        let hit = false;
        for (const item of row.items) {
            if (key && arSearchKey(item.name).includes(key)) {
                hit = true;
                byName.set(item.name, (byName.get(item.name) ?? 0) + item.qty);
            }
        }
        if (hit) {
            vouchers += 1;
        }
    }
    return { vouchers, byName };
}

/** عدّ لكل حالة على الصفوف المعروضة — مشتق لا مجلوب. */
export function summarizeDispatches(rows: readonly DispatchRow[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const row of rows) {
        const key = row.status || '';
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
}
