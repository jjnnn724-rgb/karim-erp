import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { arSearchKey } from './employees';

/**
 * طلبات شراء الخضار — قراءة فقط من `/api/veg-requests`
 * (backend/veg-requests-routes.js:141).
 *
 * العقد منسوخ من الخادم كما في `frontend/app/js/v2/data/veg-repo.js`:
 *   GET `?status&limit` → `{ ok, requests[], summary }`، وقراءة
 *   `status` محصورة في pending|received|cancelled (الخادم :150)، والسقف
 *   200 والافتراضي 60. الدلالات المخزّنة أربع: pending|received|priced|
 *   cancelled (CHECK :57)، وتسمياتها من `v2/status.js:172-175`.
 *
 *   row: id, request_no, created_by, created_by_name, priority, status,
 *        items_count, total, notes, received_by_name, priced_by_name,
 *        print_count, created_at — نفس أعمدة SELECT عند الخادم :173-176.
 *
 * الشاشة سجلٌ فقط: الإنشاء والاستلام والتسعير وتعديل الكميات والإلغاء
 * والطباعة تبقى في V2. الخادم هو من يقرّر أدوار القراءة
 * (sous_chef|admin|owner|warehouse) ويُعرض رفضه كما هو.
 */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const optionalText = z.string().nullable().optional();
const optionalId = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined ? null : String(value)));
const countValue = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => {
        const count = Number(value ?? 0);
        return Number.isFinite(count) ? Math.round(count) : 0;
    });
const moneyText = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined || value === '' ? null : String(value)));

export const vegRequestSchema = z
    .object({
        id: idValue,
        request_no: optionalText,
        created_by: optionalId,
        created_by_name: optionalText,
        created_by_role: optionalText,
        priority: optionalText,
        status: optionalText,
        items_count: countValue,
        total: moneyText,
        notes: optionalText,
        received_by_name: optionalText,
        priced_by_name: optionalText,
        print_count: countValue,
        created_at: optionalText,
    })
    .passthrough();

export type VegRequest = z.infer<typeof vegRequestSchema>;

export type VegSummary = { pending: number; pendingToday: number; today: number };

const summarySchema = z
    .object({
        pending: countValue,
        pending_today: countValue,
        today: countValue,
    })
    .partial()
    .passthrough()
    .transform(
        (summary): VegSummary => ({
            pending: summary.pending ?? 0,
            pendingToday: summary.pending_today ?? 0,
            today: summary.today ?? 0,
        }),
    );

const emptySummary: VegSummary = { pending: 0, pendingToday: 0, today: 0 };

export const vegRequestsResponseSchema = z
    .object({
        requests: z
            .array(vegRequestSchema)
            .nullable()
            .optional()
            .transform((rows) => rows ?? []),
        summary: summarySchema
            .nullable()
            .optional()
            .transform((summary) => summary ?? emptySummary),
    })
    .passthrough();

/** مرشّح الحالة كما يقبله الخادم — `priced` مخزّن لكنه غير قابل للترشيح. */
export const VEG_STATUS_FILTERS = ['all', 'pending', 'received', 'cancelled'] as const;
export type VegStatusFilter = (typeof VEG_STATUS_FILTERS)[number];

export const VEG_FILTER_LABELS: Record<VegStatusFilter, string> = {
    all: 'الكل',
    pending: 'معلق',
    received: 'مستلم',
    cancelled: 'ملغي',
};

/** سقف الخادم نفسه (:150) — نطلبه كاملًا ليصفح العميل بلا ذهاب وإياب. */
export const VEG_LIST_LIMIT = 200;

export function vegListPath(status: VegStatusFilter = 'all', limit: number = VEG_LIST_LIMIT): string {
    const params = new URLSearchParams();
    if (status !== 'all') {
        params.set('status', status);
    }
    params.set('limit', String(Math.min(200, Math.max(1, Math.trunc(limit) || 60))));
    return `/api/veg-requests?${params.toString()}`;
}

export async function fetchVegRequests(
    status: VegStatusFilter = 'all',
    signal?: AbortSignal,
): Promise<{ requests: VegRequest[]; summary: VegSummary }> {
    const body = await fetchJson(vegRequestsResponseSchema, vegListPath(status), getAccessToken(), signal ? { signal } : {});
    return { requests: body.requests, summary: body.summary };
}

/* ─── الصفّ ─────────────────────────────────────────────────────────────── */

/** `v2/status.js:172-175` حرفيًا — الحالة تُسمّى ولا يُخترع لها نص. */
const VEG_STATUS_LABELS: Record<string, string> = {
    pending: 'بانتظار المعالجة',
    received: 'تم الاستلام',
    priced: 'تم التسعير',
    cancelled: 'ملغي',
};

export function vegStatusLabel(status: string): string {
    if (!status) {
        return '—';
    }
    return VEG_STATUS_LABELS[status] ?? status;
}

export type VegRequestRow = {
    id: string;
    number: string;
    numberResolved: boolean;
    itemsCount: number;
    priority: string;
    urgent: boolean;
    status: string;
    statusLabel: string;
    total: string | null;
    by: string;
    created: string;
    receivedBy: string;
    pricedBy: string;
    notes: string;
    printCount: number;
};

/** `veg-repo.js:166-182` حرفيًا، مع تسمية الحالة من `status.js`. */
export function vegRequestToRow(request: VegRequest): VegRequestRow {
    const status = request.status ? String(request.status) : '';
    return {
        id: request.id,
        number: request.request_no ? String(request.request_no) : `#${request.id}`,
        numberResolved: Boolean(request.request_no),
        itemsCount: request.items_count,
        priority: request.priority ? String(request.priority) : '',
        urgent: String(request.priority ?? '').toLowerCase() === 'urgent',
        status,
        statusLabel: vegStatusLabel(status),
        total: request.total,
        by: request.created_by_name ? String(request.created_by_name) : request.created_by ? `#${request.created_by}` : '—',
        created: request.created_at ? String(request.created_at).slice(0, 10) : '',
        receivedBy: request.received_by_name ? String(request.received_by_name) : '',
        pricedBy: request.priced_by_name ? String(request.priced_by_name) : '',
        notes: request.notes ? String(request.notes) : '',
        printCount: request.print_count,
    };
}

export function priorityLabel(row: VegRequestRow): string {
    return row.urgent ? 'عاجل' : 'عادي';
}

/* ─── البحث ────────────────────────────────────────────────────────────── */

function tokenScore(token: string, row: VegRequestRow): { score: number; folded: boolean } {
    const raw = token.toLowerCase();
    const key = arSearchKey(token);
    if (raw && row.number.toLowerCase() === raw) {
        return { score: 3, folded: false };
    }
    if (
        raw &&
        (row.number.toLowerCase().includes(raw) ||
            row.by.toLowerCase().includes(raw) ||
            row.statusLabel.includes(raw) ||
            priorityLabel(row).includes(raw))
    ) {
        return { score: 2, folded: false };
    }
    if (key && (arSearchKey(row.by).includes(key) || arSearchKey(row.notes).includes(key))) {
        return { score: 1, folded: true };
    }
    return { score: 0, folded: false };
}

export type VegRequestSearch = {
    rows: VegRequestRow[];
    matched: boolean;
    exact: number;
    folded: boolean;
    hits: number;
};

export function searchVegRequests(rows: readonly VegRequestRow[], query: string): VegRequestSearch {
    const raw = String(query ?? '').trim();
    if (!raw) {
        return { rows: [...rows], matched: false, exact: 0, folded: false, hits: rows.length };
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    const scored: { row: VegRequestRow; score: number; folded: boolean }[] = [];
    for (const row of rows) {
        let score = 3;
        let folded = false;
        for (const token of tokens) {
            const hit = tokenScore(token, row);
            if (hit.score === 0) {
                score = 0;
                break;
            }
            if (hit.score < score) {
                score = hit.score;
            }
            if (hit.folded) {
                folded = true;
            }
        }
        if (score > 0) {
            scored.push({ row, score, folded });
        }
    }
    scored.sort((a, b) => b.score - a.score);
    return {
        rows: scored.map((item) => item.row),
        matched: true,
        exact: scored.filter((item) => item.score === 3).length,
        folded: scored.some((item) => item.folded),
        hits: scored.length,
    };
}

/* ─── العدّ ────────────────────────────────────────────────────────────── */

export type VegStatusCounts = {
    total: number;
    pending: number;
    received: number;
    priced: number;
    cancelled: number;
    urgent: number;
};

/** عدّاد الحالات في النافذة المحمّلة — الملخص العلوي يبقى ملخّص الخادم. */
export function vegStatusCounts(rows: readonly VegRequestRow[]): VegStatusCounts {
    return {
        total: rows.length,
        pending: rows.filter((row) => row.status === 'pending').length,
        received: rows.filter((row) => row.status === 'received').length,
        priced: rows.filter((row) => row.status === 'priced').length,
        cancelled: rows.filter((row) => row.status === 'cancelled').length,
        urgent: rows.filter((row) => row.urgent).length,
    };
}
