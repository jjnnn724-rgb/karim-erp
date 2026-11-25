import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * سجل المخزون — قراءة فقط من `GET /api/warehouse/inventory/search`
 * (backend/warehouse/returns-routes.js:439) بنفس عقد `inventory-repo.js`:
 * `?page&limit&stock&category&q` ثم `{data, pagination, categories, fuzzy}`.
 *
 * الفلاتر **على الخادم** لا على الصفوف هنا: الخادم يطابق الاسم/الباركود/الفئة
 * بعائلات الحروف العربية (بازنجان تجد باذنجان) ويحسب حالات المخزون في SQL
 * على السجل كله. فلترٌ محلي فقط يفقد الاثنين صامتًا.
 *
 * `avgCost` تُمرَّر كما وصلت ليستخدمها مسح البضاعة سعرًا احتياطيًا عند الربط؛
 * سجل المخزون نفسه لا يعرض مبلغًا لأن العملة ليست جزءًا منه (v2 warehouse.js:89-95).
 */

const numeric = z.union([z.string(), z.number()]).nullable().optional();

export const inventoryItemSchema = z
    .object({
        id: z.union([z.string(), z.number()]),
        name: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
        unit: z.string().nullable().optional(),
        qty: numeric,
        avgCost: numeric,
        minQty: numeric,
        mainQty: numeric,
        weight: numeric,
        barcode: z.string().nullable().optional(),
        shelfId: z.union([z.string(), z.number()]).nullable().optional(),
    })
    .passthrough();

export type InventoryItem = z.infer<typeof inventoryItemSchema>;

const inventorySearchSchema = z
    .object({
        data: z.array(inventoryItemSchema),
        pagination: z
            .object({
                page: z.number().optional(),
                limit: z.number().optional(),
                total: z.number().optional(),
                pages: z.number().optional(),
            })
            .passthrough()
            .optional(),
        categories: z.array(z.string()).optional(),
        fuzzy: z.boolean().optional(),
    })
    .passthrough();

const shelfSchema = z
    .object({
        id: z.union([z.string(), z.number()]),
        code: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
    })
    .passthrough();

const shelfPageSchema = z.union([
    z.array(shelfSchema),
    z
        .object({
            data: z.array(shelfSchema),
            pagination: z
                .object({
                    totalPages: z.number().optional(),
                })
                .passthrough()
                .optional(),
        })
        .passthrough(),
]);

export type Shelf = z.infer<typeof shelfSchema>;

/** 200 سقف الخادم (:450)؛ و10 صفحات = 2,000 صنف قبل أن تقول الشاشة ذلك. */
export const PAGE_SIZE = 200;
export const MAX_PAGES = 10;

export const STOCK_FILTERS = ['all', 'low', 'out', 'ok'] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

export const STOCK_LABELS: Record<StockFilter, string> = {
    all: 'الكل',
    low: 'تحت الحد',
    out: 'نفد',
    ok: 'متوفر',
};

export interface InventoryQuery {
    q: string;
    category: string;
    stock: StockFilter;
}

export interface InventoryRegister {
    rows: InventoryItem[];
    total: number;
    categories: string[];
    fuzzy: boolean;
    truncated: boolean;
}

export async function fetchInventoryRegister(
    query: InventoryQuery,
    signal?: AbortSignal,
    maxPages = MAX_PAGES,
): Promise<InventoryRegister> {
    const rows: InventoryItem[] = [];
    let total = 0;
    let categories: string[] = [];
    let fuzzy = false;
    const pageLimit = Math.max(1, Math.min(MAX_PAGES, Math.trunc(maxPages)));

    for (let page = 1; page <= pageLimit; page += 1) {
        const params = new URLSearchParams({
            page: String(page),
            limit: String(PAGE_SIZE),
            stock: query.stock,
            category: query.category || 'all',
            q: query.q,
        });
        const body = await fetchJson(
            inventorySearchSchema,
            `/api/warehouse/inventory/search?${params.toString()}`,
            getAccessToken(),
            signal ? { signal } : {},
        );
        rows.push(...body.data);
        total = body.pagination?.total ?? 0;
        if (body.categories) {
            categories = body.categories;
        }
        fuzzy = body.fuzzy === true;
        if (body.data.length < PAGE_SIZE) {
            break;
        }
        const pages = body.pagination?.pages ?? 0;
        if (pages > 0 && page >= pages) {
            break;
        }
        if (total > 0 && rows.length >= total) {
            break;
        }
    }

    return { rows, total, categories, fuzzy, truncated: total > rows.length };
}

const SHELF_PAGE_SIZE = 1000;
const SHELF_MAX_PAGES = 3;

export async function fetchShelves(signal?: AbortSignal): Promise<Shelf[]> {
    const rows: Shelf[] = [];
    for (let page = 1; page <= SHELF_MAX_PAGES; page += 1) {
        const body = await fetchJson(
            shelfPageSchema,
            `/api/shelves?page=${String(page)}&limit=${String(SHELF_PAGE_SIZE)}&sort=id&order=asc`,
            getAccessToken(),
            signal ? { signal } : {},
        );
        const batch = Array.isArray(body) ? body : body.data;
        rows.push(...batch);
        const totalPages = Array.isArray(body) ? 0 : (body.pagination?.totalPages ?? 0);
        if (batch.length < SHELF_PAGE_SIZE || (totalPages > 0 && page >= totalPages)) {
            break;
        }
    }
    return rows;
}

/** مفتاح الرف كما يُخزَّن: `shelfId` تصل رقمًا أو نصًا أو null. */
export function shelfMap(shelves: readonly Shelf[]): Map<string, Shelf> {
    const map = new Map<string, Shelf>();
    for (const shelf of shelves) {
        if (shelf.id !== undefined && shelf.id !== null) {
            map.set(String(shelf.id), shelf);
        }
    }
    return map;
}

/* ── Numbers ───────────────────────────────────────────────────────────── */

const INT_FORMAT = new Intl.NumberFormat('en-US');
const QTY_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

export function formatInt(value: number): string {
    return INT_FORMAT.format(Math.round(Number(value) || 0));
}

export function formatQty(value: number): string {
    return QTY_FORMAT.format(Number.isFinite(value) ? value : 0);
}

function num(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export type StockStateKey = 'out' | 'low' | 'ok';
export type StockTone = 'danger' | 'warning' | 'success';

export interface StockState {
    key: StockStateKey;
    label: string;
    tone: StockTone;
    icon: string;
    raw: string;
    untracked: boolean;
}

/** الحالات الثلاث بقاعدة الخادم نفسها (`:461-463`)، و`untracked` ليست رابعة:
 *  هي `ok` بلا حد أدنى، تُعدّ منفصلة بدل أن تُخفى داخل «متوفر». */
export function stockState(qty: unknown, minQty: unknown): StockState {
    const q = num(qty);
    const m = num(minQty);
    if (q <= 0) {
        return {
            key: 'out',
            label: 'نفد',
            tone: 'danger',
            icon: 'circle-x',
            raw: `qty=${formatQty(q)}`,
            untracked: false,
        };
    }
    if (q <= m) {
        return {
            key: 'low',
            label: 'تحت الحد',
            tone: 'warning',
            icon: 'alert-triangle',
            raw: `qty=${formatQty(q)} ≤ min=${formatQty(m)}`,
            untracked: false,
        };
    }
    return {
        key: 'ok',
        label: 'متوفر',
        tone: 'success',
        icon: 'circle-check',
        raw: `qty=${formatQty(q)} > min=${formatQty(m)}`,
        untracked: !(m > 0),
    };
}

export interface InventoryRow {
    id: string;
    name: string;
    nameResolved: boolean;
    category: string;
    unit: string;
    qty: number;
    mainQty: number;
    mainFromJoin: boolean;
    deptQty: number;
    mainOverTotal: boolean;
    minQty: number | null;
    weight: number | null;
    barcode: string;
    shelfId: string;
    shelf: string;
    shelfName: string;
    shelfResolved: boolean;
    state: StockState;
    stateKey: StockStateKey;
    untracked: boolean;
}

/**
 * صف قاعدة البيانات → صف الشاشة — قائمة سماح صريحة فقط.
 *
 * `mainQty` رصيد المخزن الرئيسي (LEFT JOIN :510)، و`qty` إجمالي السجل؛
 * الفرق هو ما ذهب لمخازن الأقسام، مقصوصًا عند صفر كما في القديم
 * (inventory-repo.js:139-151) — ورصيد رئيسي أعلى من الإجمالي حقيقة
 * تُعلَن لا تُخفى.
 */
export function inventoryToRow(item: InventoryItem, shelfById: Map<string, Shelf> = new Map()): InventoryRow {
    const qty = num(item.qty);
    const minQty = item.minQty === undefined || item.minQty === null ? null : num(item.minQty);
    const hasMain = item.mainQty !== undefined && item.mainQty !== null;
    const mainQty = hasMain ? num(item.mainQty) : qty;
    const deptQty = Math.max(0, Math.round((qty - mainQty) * 1000) / 1000);
    const shelfId = item.shelfId === undefined || item.shelfId === null ? '' : String(item.shelfId);
    const shelf = shelfById.get(shelfId);
    const state = stockState(qty, minQty);

    return {
        id: String(item.id),
        name: item.name ? String(item.name) : `#${String(item.id)}`,
        nameResolved: Boolean(item.name),
        category: item.category ? String(item.category) : '',
        unit: item.unit ? String(item.unit) : '',
        qty,
        mainQty,
        mainFromJoin: hasMain,
        deptQty,
        mainOverTotal: hasMain && mainQty > qty,
        minQty,
        weight: item.weight === undefined || item.weight === null ? null : num(item.weight),
        barcode: item.barcode ? String(item.barcode) : '',
        shelfId,
        shelf: shelf ? String(shelf.code || shelf.name || '') : shelfId,
        shelfName: shelf?.name ? String(shelf.name) : '',
        shelfResolved: Boolean(shelf),
        state,
        stateKey: state.key,
        untracked: state.untracked,
    };
}

/* ── Derived layer ─────────────────────────────────────────────────────── */

export interface StateCounts {
    low: number;
    out: number;
    ok: number;
    untracked: number;
}

export function stateCounts(rows: readonly InventoryRow[]): StateCounts {
    const counts: StateCounts = { low: 0, out: 0, ok: 0, untracked: 0 };
    for (const row of rows) {
        counts[row.stateKey] += 1;
        if (row.untracked) {
            counts.untracked += 1;
        }
    }
    return counts;
}

export interface CategoryCount {
    value: string;
    count: number;
}

/** الفئة بمفتاحها المخزَّن — تهجئتان لفئة واحدة تبقى صفين، كما في السجل. */
export function categoryCounts(rows: readonly InventoryRow[]): CategoryCount[] {
    const map = new Map<string, number>();
    for (const row of rows) {
        const key = row.category;
        map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ar'));
}

export interface ShortageRow extends InventoryRow {
    short: number;
}

/** قائمة النقص: أكبر فجوة أولًا — صنف بلا حد أدنى ليس نقصًا. */
export function shortageRows(rows: readonly InventoryRow[], limit = 6): ShortageRow[] {
    return rows
        .filter((row) => row.stateKey === 'low' || row.stateKey === 'out')
        .map((row) => ({ ...row, short: Math.max(0, num(row.minQty) - num(row.qty)) }))
        .sort((a, b) => b.short - a.short || a.name.localeCompare(b.name, 'ar'))
        .slice(0, limit);
}

export interface ShelfIssues {
    noShelf: number;
    unresolved: number;
}

export function shelfIssues(rows: readonly InventoryRow[]): ShelfIssues {
    let noShelf = 0;
    let unresolved = 0;
    for (const row of rows) {
        if (!row.shelfId) {
            noShelf += 1;
        } else if (!row.shelfResolved) {
            unresolved += 1;
        }
    }
    return { noShelf, unresolved };
}
