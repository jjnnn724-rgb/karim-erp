import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { arSearchKey } from './employees';

/**
 * الوصفات — قراءة فقط من `/api/recipes` + `/api/pos/recipes/catalog`.
 *
 * العقد منسوخ من `frontend/app/js/v2/data/recipes-repo.js`:
 *   GET `/recipes?page&limit=1000&sort=id&order=asc` → `{ data, pagination }`
 *   (CRUD العام `backend/server.js:1766`؛ القراءة بلا حرس دور — recipes ليست
 *   في `sensitiveReadEntities`).
 *   GET `/pos/recipes/catalog` (`backend/cashier-module/shift-routes.js:422`)
 *   → مصفوفة خام فيها `recipe_id, product_id, image_url, ingredient_count`.
 *   فشل الكتالوج لا يُسقط السجل: يُقرأ بلا صورة/عدد مكوّنات كما في القديم.
 *
 *   `recipeToRow` يطابق `recipes-repo.js:51-65`: السعر والتكلفة والنسبة من
 *   صفّ الوصفة، وبها فراغًا من الكتالوج؛ و`productLinked` من كتالوج الكاشير
 *   وحده لأن جدول `recipes` لا يحمل `product_id`.
 *
 *   `costRatio` يُخزَّن **نقاطًا مئوية** (30 = 30٪) كما يكتبه الخادم — لا
 *   ضرب في 100 عند العرض (انحراف القديم المُعلَن في `recipes.js:20-22`).
 *
 * الشاشة سجلٌ فقط: الإنشاء والتعديل والحذف والمكوّنات والصورة والمزامنة مع
 * الكاشير تبقى في V2. لا كتابة هنا.
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
const moneyValue = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => {
        if (value === null || value === undefined) {
            return null;
        }
        const text = String(value).trim();
        if (!text) {
            return null;
        }
        return Number.isFinite(Number(text)) ? text : null;
    });
const pageCount = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
    });

export const recipeSchema = z
    .object({
        id: idValue,
        name: optionalText,
        deptId: optionalId,
        sellingPrice: moneyValue,
        totalCost: moneyValue,
        costRatio: numericValue,
        image_url: optionalText,
        imageUrl: optionalText,
        product_id: optionalId,
    })
    .passthrough();

export type Recipe = z.infer<typeof recipeSchema>;

export const recipeCatalogSchema = z
    .object({
        recipe_id: idValue,
        name: optionalText,
        sellingPrice: moneyValue,
        totalCost: moneyValue,
        costRatio: numericValue,
        product_id: optionalId,
        image_url: optionalText,
        ingredient_count: numericValue,
    })
    .passthrough();

export type RecipeCatalogRow = z.infer<typeof recipeCatalogSchema>;

const paginationSchema = z
    .object({
        total: pageCount,
        totalPages: pageCount,
    })
    .partial()
    .passthrough();

const pageSchema = z
    .object({
        data: z.array(recipeSchema),
        pagination: paginationSchema.nullable().optional(),
    })
    .passthrough();

const listSchema = z.union([pageSchema, z.array(recipeSchema)]);
const catalogSchema = z.union([z.array(recipeCatalogSchema), z.object({ data: z.array(recipeCatalogSchema) }).passthrough()]);

/* ─── الجلب ────────────────────────────────────────────────────────────── */

const PAGE_SIZE = 1000;
const MAX_PAGES = 8;

export function recipeListPath(page: number): string {
    return `/api/recipes?page=${String(page)}&limit=${String(PAGE_SIZE)}&sort=id&order=asc`;
}

export async function fetchRecipes(signal?: AbortSignal): Promise<Recipe[]> {
    const rows: Recipe[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await fetchJson(listSchema, recipeListPath(page), getAccessToken(), signal ? { signal } : {});
        const batch = Array.isArray(body) ? body : body.data;
        rows.push(...batch);
        const totalPages = Array.isArray(body) ? 0 : (body.pagination?.totalPages ?? 0);
        if (batch.length < PAGE_SIZE || (totalPages > 0 && page >= totalPages)) {
            break;
        }
    }
    return rows;
}

/**
 * كتالوج الكاشير اختياري: دوره أضيق (manager|admin|auditor|kitchen|sous_chef)،
 * وفشله لا يُسقط الوصفات — نفس `recipes-repo.js:37-44` (catch → []).
 */
export async function fetchRecipesCatalog(signal?: AbortSignal): Promise<RecipeCatalogRow[]> {
    try {
        const body = await fetchJson(catalogSchema, '/api/pos/recipes/catalog', getAccessToken(), signal ? { signal } : {});
        return Array.isArray(body) ? body : body.data;
    } catch {
        return [];
    }
}

const EMPTY_CATALOG: ReadonlyMap<string, RecipeCatalogRow> = new Map();

/** `{ recipe_id: catalogRow }` كما في `recipes-repo.js:73-79`. */
export function indexCatalog(list: readonly RecipeCatalogRow[]): Map<string, RecipeCatalogRow> {
    const map = new Map<string, RecipeCatalogRow>();
    for (const row of list) {
        map.set(row.recipe_id, row);
    }
    return map;
}

/* ─── الصفّ ─────────────────────────────────────────────────────────────── */

export type RecipeRow = {
    id: string;
    name: string;
    deptCode: string;
    deptName: string;
    sellingPrice: string | null;
    totalCost: string | null;
    costRatio: number;
    imageUrl: string;
    productLinked: boolean;
    ingredients: number;
};

/**
 * `recipes-repo.js:51-65` حرفيًا + اسم القسم من دليل الأقسام كما في
 * `recipes.js:97`. `deptNames` خريطة code→name يجلبها الشاشة.
 */
export function recipeToRow(
    raw: Recipe,
    catalog: ReadonlyMap<string, RecipeCatalogRow> = EMPTY_CATALOG,
    deptNames: ReadonlyMap<string, string> = new Map(),
): RecipeRow {
    const cat = catalog.get(raw.id) ?? null;
    const deptCode = raw.deptId ?? '';
    return {
        id: raw.id,
        name: raw.name ? String(raw.name) : cat?.name ? String(cat.name) : '—',
        deptCode,
        deptName: deptCode ? (deptNames.get(deptCode) ?? deptCode) : '',
        sellingPrice: raw.sellingPrice ?? cat?.sellingPrice ?? null,
        totalCost: raw.totalCost ?? cat?.totalCost ?? null,
        costRatio: raw.costRatio ?? cat?.costRatio ?? 0,
        imageUrl: raw.image_url || raw.imageUrl || cat?.image_url || '',
        productLinked: Boolean(raw.product_id || cat?.product_id),
        ingredients: cat ? cat.ingredient_count : 0,
    };
}

/** `recipes.js:49` — الخانة نقاط مئوية، والضرب في 100 خطأ القديم المُصحَّح. */
export function costRatioText(value: number): string {
    return `${(Number.isFinite(value) ? value : 0).toFixed(1)}%`;
}

export type RecipeTotals = {
    total: number;
    linked: number;
    unlinked: number;
    departmentCodes: string[];
    ingredients: number;
};

export function recipeTotals(rows: readonly RecipeRow[]): RecipeTotals {
    const departments = new Set<string>();
    for (const row of rows) {
        if (row.deptCode) {
            departments.add(row.deptCode);
        }
    }
    const linked = rows.filter((row) => row.productLinked).length;
    return {
        total: rows.length,
        linked,
        unlinked: rows.length - linked,
        departmentCodes: [...departments].sort((a, b) => a.localeCompare(b, 'ar')),
        ingredients: rows.reduce((sum, row) => sum + row.ingredients, 0),
    };
}

/* ─── البحث ────────────────────────────────────────────────────────────── */

function tokenScore(token: string, row: RecipeRow): { score: number; folded: boolean } {
    const raw = token.toLowerCase();
    const key = arSearchKey(token);
    if (raw && row.name.toLowerCase() === raw) {
        return { score: 3, folded: false };
    }
    if (
        raw &&
        (row.name.toLowerCase().includes(raw) || row.deptName.toLowerCase().includes(raw) || row.deptCode.toLowerCase().includes(raw))
    ) {
        return { score: 2, folded: false };
    }
    if (key && (arSearchKey(row.name).includes(key) || arSearchKey(row.deptName).includes(key))) {
        return { score: 1, folded: true };
    }
    return { score: 0, folded: false };
}

export type RecipeSearch = {
    rows: RecipeRow[];
    matched: boolean;
    exact: number;
    folded: boolean;
    hits: number;
};

export function searchRecipes(rows: readonly RecipeRow[], query: string): RecipeSearch {
    const raw = String(query ?? '').trim();
    if (!raw) {
        return { rows: [...rows], matched: false, exact: 0, folded: false, hits: rows.length };
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    const scored: { row: RecipeRow; score: number; folded: boolean }[] = [];
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
