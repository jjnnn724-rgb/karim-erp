import { addMoney, roundHalfUp } from '@karim/shared';
import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * مرتجعات المطبخ — قراءة من `/api/kitchenReturns` بنفس عقد القديم
 * (`frontend/app/js/v2/data/warehouse-repo.js`): الشهر الحالي أولًا عند
 * الخادم (`v2_period=month`)، ثم ترتيب `id desc`، وسقف 8×1000 معلن.
 *
 * الإنشاء والإبطال يمران عبر مسار العملية المخصص في `wh-returns-write`.
 */

const moneyValue = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined ? '0' : String(value)));

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));

const optionalText = z.string().nullable().optional();

const returnItemSchema = z
    .object({
        itemName: optionalText,
        name: optionalText,
        qty: z.union([z.string(), z.number()]).nullable().optional(),
        unit: optionalText,
    })
    .passthrough();

export const kitchenReturnSchema = z
    .object({
        id: idValue,
        date: z
            .string()
            .nullable()
            .optional()
            .transform((value) => String(value ?? '').slice(0, 10)),
        deptCode: optionalText,
        deptName: optionalText,
        dispatchId: z
            .union([z.string(), z.number()])
            .nullable()
            .optional()
            .transform((value) => (value === null || value === undefined || value === '' ? null : String(value))),
        items: z.array(returnItemSchema).nullable().optional(),
        reason: optionalText,
        notes: optionalText,
        totalValue: moneyValue,
        status: z.string().nullable().optional(),
        voidedAt: z.string().nullable().optional(),
        createdBy: z
            .union([z.string(), z.number()])
            .nullable()
            .optional()
            .transform((value) => (value === null || value === undefined ? '' : String(value))),
    })
    .passthrough();

export type KitchenReturn = z.infer<typeof kitchenReturnSchema>;

const paginationSchema = z
    .object({
        total: z.number().optional(),
        totalPages: z.number().optional(),
    })
    .passthrough();

const returnPageSchema = z
    .union([
        z.array(kitchenReturnSchema),
        z
            .object({
                data: z.array(kitchenReturnSchema),
                pagination: paginationSchema.optional(),
            })
            .passthrough(),
    ])
    .transform((body) => (Array.isArray(body) ? body : body.data));

export const PAGE_SIZE = 1000;
export const MAX_PAGES = 8;

/** سجل الشهر الحالي — الفلتر في SQL عند الخادم كما في القديم حرفًا. */
export async function fetchKitchenReturns(signal?: AbortSignal): Promise<KitchenReturn[]> {
    const rows: KitchenReturn[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await fetchJson(
            returnPageSchema,
            `/api/kitchenReturns?page=${String(page)}&limit=${String(PAGE_SIZE)}&sort=id&order=desc&v2_period=month`,
            getAccessToken(),
            signal ? { signal } : {},
        );
        rows.push(...body);
        if (body.length < PAGE_SIZE) {
            break;
        }
    }
    return rows;
}

/* ─── عرض ─────────────────────────────────────────────────────────────── */

function moneyOf(value: string | undefined): string {
    return roundHalfUp(value ?? '0', 2);
}

function formatQty(value: string | number | null | undefined): string {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return '0';
    }
    return number.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

export type KitchenReturnRow = {
    id: string;
    date: string;
    deptCode: string;
    deptName: string;
    dispatchId: string | null;
    itemsSummary: string;
    itemsCount: number;
    reasonText: string;
    total: string;
    status: string;
    voided: boolean;
    createdBy: string;
};

export function kitchenReturnToRow(entry: KitchenReturn): KitchenReturnRow {
    const items = Array.isArray(entry.items) ? entry.items : [];
    const summary = items
        .map((item) => {
            const name = String(item.itemName || item.name || '').trim();
            return name ? `${name} (${formatQty(item.qty)})` : '';
        })
        .filter(Boolean)
        .join('، ');
    return {
        id: entry.id,
        date: entry.date,
        deptCode: entry.deptCode ? String(entry.deptCode) : '',
        deptName: entry.deptName ? String(entry.deptName) : entry.deptCode ? String(entry.deptCode) : '—',
        dispatchId: entry.dispatchId,
        itemsSummary: summary,
        itemsCount: items.length,
        reasonText: entry.reason || entry.notes || '',
        total: moneyOf(entry.totalValue),
        status: entry.status || 'approved',
        voided: Boolean(entry.voidedAt || entry.status === 'voided'),
        createdBy: entry.createdBy ? String(entry.createdBy) : '',
    };
}

export type ReturnTotals = {
    count: number;
    total: string;
    items: number;
    linked: number;
    depts: number;
};

export function returnTotals(rows: readonly KitchenReturnRow[]): ReturnTotals {
    const active = rows.filter((row) => !row.voided);
    let total = '0.00';
    for (const row of active) {
        total = addMoney(total, row.total);
    }
    return {
        count: rows.length,
        total,
        items: active.reduce((sum, row) => sum + row.itemsCount, 0),
        linked: active.filter((row) => row.dispatchId !== null).length,
        depts: new Set(active.map((row) => row.deptName)).size,
    };
}
