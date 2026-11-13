import { z } from 'zod';
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
