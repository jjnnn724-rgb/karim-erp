import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { arSearchKey } from './employees';

/**
 * قراءات الميزان — قراءة فقط من `/api/weightReadings`.
 *
 * العقد منسوخ من `frontend/app/js/v2/data/weight-repo.js`:
 *   GET `/weightReadings?page&limit=1000&sort=id&order=desc` → `{ data, pagination }`
 *   (CRUD العام في `backend/server.js:1766`؛ `weightReadings` ليست في
 *   `sensitiveReadEntities`، فالقراءة متاحة لأي حساب مُصادق).
 *
 *   الوحدات المعروفة ثلاث: kg|g|lb. التحويل للكيلوجرام كما في القديم:
 *   kg تبقى، g/1000، lb×0.453592. قراءةٌ بوحدة غير معروفة **لا تُحوَّل**:
 *   `kg` تبقى null وتُعدّ في `unconverted`، ولا تُجمع كأنها كيلوجرام.
 *
 * الشاشة سجلٌ فقط: تسجيل القراءة وإضافتها لوزن الصنف (`POST /weightReadings`
 * و`PUT /inventory/:id`) يبقيان في V2. لا حساب وحدات ولا كتابة هنا.
 */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const optionalText = z.string().nullable().optional();
const optionalId = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined ? null : String(value)));
const numericValue = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
    });
const pageCount = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
    });

export const weightReadingSchema = z
    .object({
        id: idValue,
        weight: numericValue,
        unit: optionalText,
        date: optionalText,
        time: optionalText,
        itemId: optionalId,
        itemName: optionalText,
        notes: optionalText,
        recordedBy: optionalText,
    })
    .passthrough();

export type WeightReading = z.infer<typeof weightReadingSchema>;

const paginationSchema = z
    .object({
        total: pageCount,
        totalPages: pageCount,
    })
    .partial()
    .passthrough();

const pageSchema = z
    .object({
        data: z.array(weightReadingSchema),
        pagination: paginationSchema.nullable().optional(),
    })
    .passthrough();

const listSchema = z.union([pageSchema, z.array(weightReadingSchema)]);

/* ─── الوحدات ───────────────────────────────────────────────────────────── */

export const WEIGHT_UNITS = ['kg', 'g', 'lb'] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const WEIGHT_UNIT_LABELS: Record<WeightUnit, string> = {
    kg: 'كجم',
    g: 'جرام',
    lb: 'رطل',
};

const LB_TO_KG = 0.453592;

/** التحويل القديم حرفيًا — الوحدة المجهولة تبقى كما هي ولا تُدَّعى كيلوجرامًا. */
export function toKg(weight: number, unit: string): number {
    const value = Number.isFinite(weight) ? weight : 0;
    if (unit === 'g') {
        return value / 1000;
    }
    if (unit === 'lb') {
        return value * LB_TO_KG;
    }
    return value;
}

export function unitLabel(unit: string): string {
    const key = String(unit ?? '');
    return WEIGHT_UNIT_LABELS[key as WeightUnit] ?? key;
}

/* ─── الجلب ────────────────────────────────────────────────────────────── */

const PAGE_SIZE = 1000;
const MAX_PAGES = 8;

export function weightListPath(page: number): string {
    return `/api/weightReadings?page=${String(page)}&limit=${String(PAGE_SIZE)}&sort=id&order=desc`;
}

export async function fetchWeightReadings(signal?: AbortSignal): Promise<WeightReading[]> {
    const rows: WeightReading[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await fetchJson(listSchema, weightListPath(page), getAccessToken(), signal ? { signal } : {});
        const batch = Array.isArray(body) ? body : body.data;
        rows.push(...batch);
        const totalPages = Array.isArray(body) ? 0 : (body.pagination?.totalPages ?? 0);
        if (batch.length < PAGE_SIZE || (totalPages > 0 && page >= totalPages)) {
            break;
        }
    }
    return rows;
}

/* ─── الصفّ ─────────────────────────────────────────────────────────────── */

export type WeightReadingRow = {
    id: string;
    date: string;
    time: string;
    weight: number;
    unit: string;
    unitAr: string;
    kg: number | null;
    itemId: string | null;
    itemName: string;
    notes: string;
    recordedBy: string;
};

/** `weight-repo.js:75-91` حرفيًا: الوحدة الغائبة kg، والمجهولة `kg = null`. */
export function readingToRow(raw: WeightReading): WeightReadingRow {
    const unit = raw.unit ? String(raw.unit) : 'kg';
    const convertible = (WEIGHT_UNITS as readonly string[]).includes(unit);
    const itemId = raw.itemId;
    return {
        id: raw.id,
        date: raw.date ? String(raw.date) : '',
        time: raw.time ? String(raw.time) : '',
        weight: raw.weight,
        unit,
        unitAr: unitLabel(unit),
        kg: convertible ? Number(toKg(raw.weight, unit).toFixed(3)) : null,
        itemId,
        itemName: raw.itemName ? String(raw.itemName) : itemId ? `#${itemId}` : '',
        notes: raw.notes ? String(raw.notes) : '',
        recordedBy: raw.recordedBy ? String(raw.recordedBy) : '',
    };
}

export type WeightSummary = {
    count: number;
    todayCount: number;
    totalKg: number;
    unconverted: number;
    last: WeightReadingRow | null;
};

/**
 * `weight-repo.js:98-108` حرفيًا: المجاميع بالكيلوجرام بعد تحويل الجرام
 * والرطل، والقراءة المجهولة الوحدة تُستبعد وتُعدّ ولا تُخمَّن.
 */
export function readingsSummary(rows: readonly WeightReading[], today = ''): WeightSummary {
    const list = rows.map(readingToRow);
    const convertible = list.filter((row) => row.kg !== null);
    return {
        count: list.length,
        todayCount: today ? list.filter((row) => row.date === today).length : 0,
        totalKg: Number(convertible.reduce((sum, row) => sum + (row.kg ?? 0), 0).toFixed(3)),
        unconverted: list.length - convertible.length,
        last: list[0] ?? null,
    };
}

/** `reports-repo.js:66-70` — تاريخ اليوم المحلي كما كان القديم يعدّ «قراءات اليوم». */
export function localToday(now: Date = new Date()): string {
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/* ─── البحث ────────────────────────────────────────────────────────────── */

function tokenScore(token: string, row: WeightReadingRow): { score: number; folded: boolean } {
    const raw = token.toLowerCase();
    const key = arSearchKey(token);
    if (
        raw &&
        (row.itemName.toLowerCase().includes(raw) ||
            row.notes.toLowerCase().includes(raw) ||
            row.recordedBy.toLowerCase().includes(raw) ||
            row.unitAr.includes(raw) ||
            row.date.includes(raw) ||
            row.time.includes(raw) ||
            String(row.weight).includes(raw))
    ) {
        return { score: 2, folded: false };
    }
    if (
        key &&
        (arSearchKey(row.itemName).includes(key) ||
            arSearchKey(row.notes).includes(key) ||
            arSearchKey(row.recordedBy).includes(key))
    ) {
        return { score: 1, folded: true };
    }
    return { score: 0, folded: false };
}

export type WeightSearch = {
    rows: WeightReadingRow[];
    matched: boolean;
    folded: boolean;
    hits: number;
};

export function searchWeightReadings(rows: readonly WeightReadingRow[], query: string): WeightSearch {
    const raw = String(query ?? '').trim();
    if (!raw) {
        return { rows: [...rows], matched: false, folded: false, hits: rows.length };
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    const kept: { row: WeightReadingRow; folded: boolean }[] = [];
    for (const row of rows) {
        let folded = false;
        let matchedAll = true;
        for (const token of tokens) {
            const hit = tokenScore(token, row);
            if (hit.score === 0) {
                matchedAll = false;
                break;
            }
            if (hit.folded) {
                folded = true;
            }
        }
        if (matchedAll) {
            kept.push({ row, folded });
        }
    }
    return {
        rows: kept.map((item) => item.row),
        matched: true,
        folded: kept.some((item) => item.folded),
        hits: kept.length,
    };
}
