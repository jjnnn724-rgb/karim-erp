import { addMoney, roundHalfUp } from '@karim/shared';
import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * حركات المخزون — قراءة من `/api/inventoryTx` بنفس عقد القديم
 * (`warehouse-repo.js`): `?page=&limit=&sort=id&order=desc&v2_period=month`
 * ثم `{data, pagination}`. القديم يحدّ المشي بـ 8 صفحات (8,000 صف) ويقول ذلك
 * في الشاشة؛ نطبّق نفس السقف ونعلنه بدل ادّعاء اكتمال غير مضمون.
 *
 * الكميات والمبالغ تصل NUMERIC كسلاسل؛ لا Float هنا — الجمع عبر addMoney.
 */

export const inventoryMovementSchema = z
    .object({
        id: z.union([z.string(), z.number()]).transform((value) => String(value)),
        itemId: z.union([z.string(), z.number()]).nullable().optional(),
        itemName: z.string().nullable().optional(),
        qty: z.union([z.string(), z.number()]).nullable().optional(),
        type: z.string().nullable().optional(),
        date: z.string(),
        cost: z.union([z.string(), z.number()]).nullable().optional(),
        totalValue: z.union([z.string(), z.number()]).nullable().optional(),
        notes: z.string().nullable().optional(),
        invoiceNumber: z.string().nullable().optional(),
        dispatchId: z.union([z.string(), z.number()]).nullable().optional(),
    })
    .passthrough();

export type InventoryMovement = z.infer<typeof inventoryMovementSchema>;

const pageSchema = z
    .object({
        data: z.array(inventoryMovementSchema),
        pagination: z
            .object({
                totalPages: z.number().optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

const PAGE_SIZE = 1000;
export const MAX_PAGES = 8;

export async function fetchInventoryMovements(signal?: AbortSignal): Promise<InventoryMovement[]> {
    const rows: InventoryMovement[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await fetchJson(
            pageSchema,
            `/api/inventoryTx?page=${String(page)}&limit=${String(PAGE_SIZE)}&sort=id&order=desc&v2_period=month`,
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

export const MOVEMENT_TYPE_LABEL = {
    in: 'وارد',
    out: 'صادر',
    return: 'مرتجع',
    adjustment: 'تسوية',
} as const;

export type MovementType = keyof typeof MOVEMENT_TYPE_LABEL;

export interface MovementRow {
    id: string;
    date: string;
    itemName: string;
    type: string;
    typeKnown: boolean;
    typeLabel: string;
    qty: string;
    cost: string;
    totalValue: string;
    ref: string;
}

const QTY_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

export function formatQty(value: string): string {
    const number = Number(value);
    return Number.isFinite(number) ? QTY_FORMAT.format(number) : value;
}

export function movementToRow(movement: InventoryMovement): MovementRow {
    const type = String(movement.type ?? '');
    const known = Object.hasOwn(MOVEMENT_TYPE_LABEL, type);
    const ref = movement.invoiceNumber ?? movement.dispatchId ?? movement.notes ?? '';
    return {
        id: movement.id,
        date: String(movement.date).slice(0, 10),
        itemName: movement.itemName ? String(movement.itemName) : movement.itemId ? `#${String(movement.itemId)}` : '—',
        type,
        typeKnown: known,
        typeLabel: known ? MOVEMENT_TYPE_LABEL[type as MovementType] : 'افتتاحي',
        qty: roundHalfUp(String(movement.qty ?? '0'), 3),
        cost: roundHalfUp(String(movement.cost ?? '0'), 2),
        totalValue: roundHalfUp(String(movement.totalValue ?? '0'), 2),
        ref: String(ref),
    };
}

export function sumMovementValues(rows: readonly MovementRow[]): string {
    return rows.reduce((sum, row) => addMoney(sum, row.totalValue), '0.00');
}

export function sumValuesOfType(rows: readonly MovementRow[], type: string): string {
    return sumMovementValues(rows.filter((row) => row.type === type));
}

export function typeTone(type: string): 'success' | 'danger' | 'neutral' {
    if (type === 'in') {
        return 'success';
    }
    if (type === 'out') {
        return 'danger';
    }
    return 'neutral';
}
