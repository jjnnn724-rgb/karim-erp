import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * المطبخ — نظرة التشغيل من `GET /api/kitchen/overview`:
 * `{locations, batches, exceptions, policies, distributions}`.
 *
 * النافذة هي العقد: أحدث 100 أمر إنتاج، وأحدث 100 استثناء مفتوح، وأحدث 300
 * توزيع. كل رقم يُحسب على ما وصل، و`capped` يقول إن النافذة امتلأت فعليًا
 * (100 صف ⇒ هناك أقدم خارجها) — لا يُقدَّم عددٌ مقصوص كأنه الكل.
 *
 * الشاشة قراءة فقط: إنشاء أمر الإنتاج والاستلام والجرد والاعتماد تبقى في
 * القديم.
 */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const text = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();

const batchSchema = z
    .object({
        id: idValue,
        product_name: text,
        product_unit: text,
        location_name: text,
        planned_qty: numLike,
        produced_qty: numLike,
        remaining_qty: numLike,
        distributed_qty: numLike,
        status: text,
        created_at: text,
    })
    .passthrough();

const exceptionSchema = z
    .object({
        id: idValue,
        order_id: z.union([z.string(), z.number()]).nullable().optional(),
        product_name: text,
        quantity: numLike,
        operation_mode: text,
        reason: text,
        department_name: text,
        created_at: text,
    })
    .passthrough();

const policySchema = z
    .object({
        department_id: z.union([z.string(), z.number()]).nullable().optional(),
        operation_mode: text,
    })
    .passthrough();

const distributionSchema = z
    .object({
        id: idValue,
        product_name: text,
        department_name: text,
        quantity: numLike,
        created_at: text,
    })
    .passthrough();

const locationSchema = z.object({}).passthrough();

export const kitchenOverviewSchema = z
    .object({
        locations: z.array(locationSchema).optional(),
        batches: z.array(batchSchema).optional(),
        exceptions: z.array(exceptionSchema).optional(),
        policies: z.array(policySchema).optional(),
        distributions: z.array(distributionSchema).optional(),
    })
    .passthrough();

export type KitchenOverview = z.infer<typeof kitchenOverviewSchema>;

export const KITCHEN_WINDOW = { batches: 100, exceptions: 100, distributions: 300 } as const;

export async function fetchKitchenOverview(signal?: AbortSignal): Promise<KitchenOverview> {
    return fetchJson(
        kitchenOverviewSchema,
        '/api/kitchen/overview',
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export const POLICY_MODE_AR: Record<string, string> = {
    flexible: 'مرن',
    monitor: 'مراقب',
    strict: 'صارم',
};

export const BATCH_STATUS_AR: Record<string, string> = {
    draft: 'مسوّدة',
    open: 'مفتوح',
    closed: 'مغلق — موزع',
    cancelled: 'ملغى',
};

export interface KitchenSummary {
    open: number;
    closed: number;
    planned: number;
    produced: number;
    remaining: number;
    exceptions: number;
    batches: number;
    distributions: number;
    policies: number;
    capped: { batches: boolean; exceptions: boolean; distributions: boolean };
}

/** عدّ ومجاميع على النافذة الواصلة — لا ادعاء اكتمال خارجها. */
export function summarizeKitchen(overview: KitchenOverview): KitchenSummary {
    const batches = overview.batches ?? [];
    const exceptions = overview.exceptions ?? [];
    const distributions = overview.distributions ?? [];
    const numOf = (value: unknown): number => {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    return {
        open: batches.filter((batch) => ['draft', 'open'].includes(String(batch.status ?? ''))).length,
        closed: batches.filter((batch) => String(batch.status ?? '') === 'closed').length,
        planned: batches.reduce((sum, batch) => sum + numOf(batch.planned_qty), 0),
        produced: batches.reduce((sum, batch) => sum + numOf(batch.produced_qty), 0),
        remaining: batches.reduce((sum, batch) => sum + numOf(batch.remaining_qty), 0),
        exceptions: exceptions.length,
        batches: batches.length,
        distributions: distributions.length,
        policies: (overview.policies ?? []).length,
        capped: {
            batches: batches.length >= KITCHEN_WINDOW.batches,
            exceptions: exceptions.length >= KITCHEN_WINDOW.exceptions,
            distributions: distributions.length >= KITCHEN_WINDOW.distributions,
        },
    };
}

/** ملاحظة النافذة — تُقال حين تمتلئ، فلا يُقرأ العدّ كأنه الكل. */
export function capNote(summary: KitchenSummary): string {
    const parts: string[] = [];
    if (summary.capped.batches) {
        parts.push(`الأوامر: أحدث ${String(KITCHEN_WINDOW.batches)} فقط`);
    }
    if (summary.capped.exceptions) {
        parts.push(`الاستثناءات: أحدث ${String(KITCHEN_WINDOW.exceptions)} فقط`);
    }
    if (summary.capped.distributions) {
        parts.push(`التوزيعات: أحدث ${String(KITCHEN_WINDOW.distributions)} فقط`);
    }
    return parts.join(' · ');
}

/** أعلى التوزيعات كميةً — الترتيب عرضي على النافذة وحدها. */
export function topDistributions(overview: KitchenOverview, limit = 6): { label: string; qty: number }[] {
    const totals = new Map<string, number>();
    for (const row of overview.distributions ?? []) {
        const label = String(row.product_name ?? '') || '—';
        const qty = Number(row.quantity ?? 0);
        totals.set(label, (totals.get(label) ?? 0) + (Number.isFinite(qty) ? qty : 0));
    }
    return [...totals.entries()]
        .map(([label, qty]) => ({ label, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, limit);
}
