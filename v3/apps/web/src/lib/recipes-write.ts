import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken, getAppKey } from './auth';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابة الوصفات — CRUD العام في الخادم على جدول `recipes`:
 *  • إنشاء     POST   /api/recipes          (admin|manager|kitchen|sous_chef)
 *  • تعديل     PUT    /api/recipes/:id      (admin|manager|kitchen|sous_chef)
 *  • حذف نهائي DELETE /api/recipes/:id      (admin|manager|kitchen|sous_chef)
 *
 * أسماء الحقول **كما في الخادم لا كما في V2**: السجل محميّ بقائمة كتابة
 * (`backend/schema-registry.js:436`):
 *
 *     writeable: ['name', 'deptId', 'sellingPrice', 'totalCost', 'costRatio']
 *     required : ['name']
 *
 * والجدول `database/migrations/001_schema.sql:169` لا يحمل إلا:
 * `id, name, "deptId", "sellingPrice", "totalCost", "costRatio"`.
 *
 * `filterBody` (`schema-registry.js:630`) يُسقط أي حقل خارج القائمة ويُرجع
 * 400 INVALID_PAYLOAD — فحقلٌ مثل `selling_price` أو `active` يُرفض رفضًا
 * قاطعًا ولا يُحفظ بصمت.
 *
 * `costRatio` لا يُرسل من هنا: الخادم يشتقّه عند حفظ مكونات الوصفة
 * (`backend/cashier-module/shift-routes.js:568`):
 * `ROUND(totalCost / sellingPrice * 100, 2)` — وهي القاعدة الوحيدة للنسبة.
 *
 * الأدوار هنا **أضيق** من قائمة الخادم: بوابة الكتابة `admin|manager`
 * والحذف `admin` فقط، فلا يظهر زرٌّ لغير من يملك الصلاحية فعلًا.
 */

export const RECIPE_WRITE_ROLES = ['admin', 'manager'] as const;
export const RECIPE_DELETE_ROLES = ['admin'] as const;

export function recipeWriteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, RECIPE_WRITE_ROLES);
}

export function recipeDeleteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, RECIPE_DELETE_ROLES);
}

/* ── نصوص V2 حرفيًّا ───────────────────────────────────────────────────── */

export const RECIPE_TEXT = {
    nameRequired: 'اسم الوصفة مطلوب',
    priceRequired: 'سعر البيع مطلوب',
    priceInvalid: 'سعر البيع يجب أن يكون رقمًا ≥ صفر',
    costRequired: 'التكلفة مطلوبة',
    costInvalid: 'التكلفة يجب أن تكون رقمًا ≥ صفر',
    createFailed: 'فشل إنشاء الوصفة في قاعدة البيانات',
    updateFailed: 'فشل تحديث بيانات الوصفة',
    deleteFailed: 'فشل حذف الوصفة من قاعدة البيانات',
    deleteBlocked: 'لا يمكن حذف هذه الوصفة: مرتبطة بعناصر قائمة أو فواتير',
    createSuccess: 'تم إنشاء الوصفة بنجاح',
    updateSuccess: 'تم تحديث بيانات الوصفة',
    deleteSuccess: 'تم حذف الوصفة',
    confirmCreate: 'إضافة وصفة جديدة؟',
    confirmUpdate: 'تعديل بيانات الوصفة «%s»؟',
    confirmDelete: 'حذف الوصفة «%s» نهائيًا؟ لا يمكن التراجع.',
    cancel: 'إلغاء',
} as const;

/* ── مخططات التحقق ────────────────────────────────────────────────────── */

export const recipeCreateSchema = z.object({
    name: z.string().min(1, RECIPE_TEXT.nameRequired),
    deptId: z.string().optional().nullable(),
    sellingPrice: z.coerce.number().min(0, RECIPE_TEXT.priceInvalid),
    totalCost: z.coerce.number().min(0, RECIPE_TEXT.costInvalid),
});

export type RecipeCreateInput = z.infer<typeof recipeCreateSchema>;

export const recipeUpdateSchema = z.object({
    name: z.string().min(1, RECIPE_TEXT.nameRequired).optional(),
    deptId: z.string().optional().nullable(),
    sellingPrice: z.coerce.number().min(0, RECIPE_TEXT.priceInvalid).optional(),
    totalCost: z.coerce.number().min(0, RECIPE_TEXT.costInvalid).optional(),
});

export type RecipeUpdateInput = z.infer<typeof recipeUpdateSchema>;

const recipeResultSchema = z.object({ id: z.union([z.string(), z.number()]) }).passthrough();
export type RecipeResult = z.infer<typeof recipeResultSchema>;

/* ── العمليات ─────────────────────────────────────────────────────────── */

/** `deptId` فارغ → `null` (وعموده nullable في الجدول) لا نصًا فارغًا. */
function deptValue(value: string | null | undefined): string | null {
    const text = String(value ?? '').trim();
    return text ? text : null;
}

export async function createRecipe(input: RecipeCreateInput): Promise<RecipeResult> {
    return writeJson(recipeResultSchema, '/api/recipes', 'POST', {
        name: input.name.trim(),
        deptId: deptValue(input.deptId),
        sellingPrice: Number(input.sellingPrice),
        totalCost: Number(input.totalCost),
    });
}

export async function updateRecipe(id: string | number, input: RecipeUpdateInput): Promise<RecipeResult> {
    return writeJson(recipeResultSchema, `/api/recipes/${encodeURIComponent(String(id))}`, 'PUT', {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.deptId !== undefined ? { deptId: deptValue(input.deptId) } : {}),
        ...(input.sellingPrice !== undefined ? { sellingPrice: Number(input.sellingPrice) } : {}),
        ...(input.totalCost !== undefined ? { totalCost: Number(input.totalCost) } : {}),
    });
}

export async function deleteRecipe(id: string | number): Promise<void> {
    await writeAck(`/api/recipes/${encodeURIComponent(String(id))}`, 'DELETE');
}

/* ── دورة الكاشير (BOM / المكوّنات والصورة) ────────────────────────────── */

export const RECIPE_BOM_ROLES = ['manager', 'admin'] as const;

export function recipeBomVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, RECIPE_BOM_ROLES);
}

export interface SyncLegacyResult {
    recipe_id: number | string;
    product: { id: number; image_url?: string | null } | null;
    synced: boolean;
}

export async function syncRecipeToCashier(recipeId: string | number): Promise<SyncLegacyResult> {
    return writeJson(
        z.object({
            recipe_id: z.union([z.string(), z.number()]),
            product: z.object({ id: z.number(), image_url: z.string().nullable().optional() }).passthrough().nullable(),
            synced: z.boolean().optional(),
        }).passthrough(),
        '/api/pos/recipes/sync-legacy',
        'POST',
        { recipe_id: Number(recipeId) },
    ) as Promise<SyncLegacyResult>;
}

export interface ProductIngredientRow {
    id: number | string;
    inventory_id: number;
    inventory_name: string;
    inventory_unit: string;
    inventory_weight: number | string | null;
    available_qty: number | string | null;
    avg_cost: number | string | null;
    quantity_per_unit: number | string;
    unit: string;
    waste_percent: number | string | null;
    notes: string | null;
    extended_cost: number | null;
    inventory_unit_normalized?: string | null;
    quantity_in_inventory_units?: number | null;
    unit_error?: string | null;
}

export async function fetchProductIngredients(productId: string | number): Promise<ProductIngredientRow[]> {
    return fetchJson(
        z.array(z.object({
            id: z.union([z.string(), z.number()]),
            inventory_id: z.number(),
            inventory_name: z.string(),
            inventory_unit: z.string(),
            inventory_weight: z.union([z.string(), z.number()]).nullable().optional(),
            available_qty: z.union([z.string(), z.number()]).nullable().optional(),
            avg_cost: z.union([z.string(), z.number()]).nullable().optional(),
            quantity_per_unit: z.union([z.string(), z.number()]),
            unit: z.string(),
            waste_percent: z.union([z.string(), z.number()]).nullable().optional(),
            notes: z.string().nullable().optional(),
            extended_cost: z.union([z.string(), z.number()]).nullable().optional(),
            inventory_unit_normalized: z.string().nullable().optional(),
            quantity_in_inventory_units: z.union([z.string(), z.number()]).nullable().optional(),
            unit_error: z.string().nullable().optional(),
        }).passthrough()),
        `/api/pos/products/${encodeURIComponent(String(productId))}/ingredients`,
        getAccessToken(),
    ) as unknown as Promise<ProductIngredientRow[]>;
}

export interface InventoryEntry {
    id: number;
    name: string;
    category: string | null;
    unit: string | null;
    weight: number | null;
    qty: number;
    avgCost: number;
    minQty: number;
}

export async function fetchBomInventory(): Promise<InventoryEntry[]> {
    return fetchJson(
        z.array(z.object({
            id: z.number(),
            name: z.string(),
            category: z.string().nullable().optional(),
            unit: z.string().nullable().optional(),
            weight: z.union([z.string(), z.number()]).nullable().optional().transform((v) => v == null ? 0 : Number(v)),
            qty: z.union([z.string(), z.number()]).nullable().optional().transform((v) => v == null ? 0 : Number(v)),
            avgCost: z.union([z.string(), z.number()]).nullable().optional().transform((v) => v == null ? 0 : Number(v)),
            minQty: z.union([z.string(), z.number()]).nullable().optional().transform((v) => v == null ? 0 : Number(v)),
        }).passthrough()),
        '/api/pos/ingredients',
        getAccessToken(),
    ) as Promise<InventoryEntry[]>;
}

export interface UnitOption {
    value: string;
    label: string;
    family: string;
}

export async function fetchRecipeUnits(): Promise<UnitOption[]> {
    return fetchJson(
        z.array(z.object({ value: z.string(), label: z.string(), family: z.string() }).passthrough()),
        '/api/pos/recipe-units',
        getAccessToken(),
    ) as Promise<UnitOption[]>;
}

export interface SaveIngredientsResult {
    product_id?: number | string;
    ingredient_count?: number;
    total_cost?: number | null;
}

export async function saveProductIngredients(productId: string | number, lines: ReadonlyArray<{
    inventory_id: number;
    quantity_per_unit: number;
    unit: string;
    waste_percent: number;
}>): Promise<SaveIngredientsResult> {
    return writeJson(
        z.object({
            product_id: z.union([z.string(), z.number()]).optional(),
            ingredient_count: z.number().optional(),
            total_cost: z.union([z.string(), z.number()]).nullable().optional().transform((v) => v == null ? null : Number(v)),
        }).passthrough(),
        `/api/pos/products/${encodeURIComponent(String(productId))}/ingredients`,
        'PUT',
        { ingredients: lines.map((line) => ({
            inventory_id: Number(line.inventory_id),
            quantity_per_unit: Number(line.quantity_per_unit),
            unit: String(line.unit || 'piece'),
            waste_percent: Number(line.waste_percent) || 0,
        })) },
    ) as Promise<SaveIngredientsResult>;
}

export async function uploadProductImage(productId: string | number, file: File): Promise<{ id: number; image_url: string | null }> {
    const form = new FormData();
    form.append('image', file, file.name);
    const headers: Record<string, string> = {
        Accept: 'application/json',
    };
    const token = getAccessToken();
    if (token) {headers.Authorization = `Bearer ${token}`;}
    const appKey = getAppKey();
    if (appKey) {headers['x-api-key'] = appKey;}
    const response = await fetch(`/api/pos/products/${encodeURIComponent(String(productId))}/image`, {
        method: 'POST',
        headers,
        body: form,
    });
    const body = await response.json().catch(() => ({} as { message?: string; error?: string }));
    if (!response.ok) {
        throw new Error((body as { message?: string }).message || (body as { error?: string }).error || 'تعذر رفع الصورة');
    }
    return body as unknown as { id: number; image_url: string | null };
}

export async function removeProductImage(productId: string | number): Promise<void> {
    await writeAck(`/api/pos/products/${encodeURIComponent(String(productId))}/image`, 'DELETE');
}

export interface BomLineDraft {
    inventory_id: number;
    inventory_name: string;
    inventory_unit: string;
    quantity_per_unit: string;
    unit: string;
    waste_percent: string;
    extended_cost: number | null;
    unit_error: string | null;
}

export function ingredientLine(row: Partial<ProductIngredientRow>): BomLineDraft {
    return {
        inventory_id: Number(row.inventory_id),
        inventory_name: String(row.inventory_name ?? ''),
        inventory_unit: String(row.inventory_unit ?? ''),
        quantity_per_unit: String(row.quantity_per_unit ?? '1'),
        unit: String(row.unit ?? 'piece'),
        waste_percent: row.waste_percent == null ? '0' : String(row.waste_percent),
        extended_cost: row.extended_cost == null ? null : Number(row.extended_cost),
        unit_error: row.unit_error ?? null,
    };
}

export function newBomLine(inventory: Pick<InventoryEntry, 'id' | 'name' | 'unit'>, units: UnitOption[]): BomLineDraft {
    const known = units.map((option) => option.value);
    const rawUnit = String(inventory.unit ?? '').trim().toLowerCase();
    const aliases: Record<string, string> = { g: 'g', جرام: 'g', غرام: 'g', k: 'kg', kilogram: 'kg', كيلو: 'kg', l: 'l', litre: 'l', liter: 'l', لتر: 'l', ml: 'ml', مل: 'ml', مليلتر: 'ml', piece: 'piece', pieces: 'piece', وحدة: 'piece', حبة: 'piece' };
    const normalized = aliases[rawUnit] || rawUnit || 'piece';
    const unit = known.includes(normalized) ? normalized : (known[0] ?? 'piece');
    return {
        inventory_id: Number(inventory.id),
        inventory_name: String(inventory.name ?? ''),
        inventory_unit: String(inventory.unit ?? ''),
        quantity_per_unit: '1',
        unit,
        waste_percent: '0',
        extended_cost: null,
        unit_error: null,
    };
}

/* ── دوال تأكيد ───────────────────────────────────────────────────────── */

export function recipeCreateConfirm(): string {
    return RECIPE_TEXT.confirmCreate;
}

export function recipeUpdateConfirm(name: string): string {
    return RECIPE_TEXT.confirmUpdate.replace('%s', String(name ?? ''));
}

export function recipeDeleteConfirm(name: string): string {
    return RECIPE_TEXT.confirmDelete.replace('%s', String(name ?? ''));
}

/* ── نصوص نجاح ───────────────────────────────────────────────────────── */

export function recipeCreateSuccess(name: string): string {
    return `${RECIPE_TEXT.createSuccess} — «${String(name ?? '')}»`;
}

export function recipeUpdateSuccess(name: string): string {
    return `${RECIPE_TEXT.updateSuccess} — «${String(name ?? '')}»`;
}

export function recipeDeleteSuccess(name: string): string {
    return `${RECIPE_TEXT.deleteSuccess} — «${String(name ?? '')}»`;
}
