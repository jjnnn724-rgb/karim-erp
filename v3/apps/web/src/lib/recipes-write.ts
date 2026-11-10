import { z } from 'zod';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابة الوصفات — منقولة من V2 بوابات الصلاحية نفسها (نظام CRUD العام في الخادم):
 *  • إنشاء     POST   /api/recipes          (admin|manager)
 *  • تعديل     PATCH  /api/recipes/:id      (admin|manager)
 *  • حذف نهائي DELETE /api/recipes/:id      (admin)
 *
 * حتى تُفعَّل هذه المسارات في الباكendien، تُعدّ الدوال جاهزة للاستدعاء.
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
    deactivateFailed: 'فشل إيقاف الوصفة',
    activateFailed: 'فشل تفعيل الوصفة',
    deleteFailed: 'فشل حذف الوصفة من قاعدة البيانات',
    deleteBlocked: 'لا يمكن حذف هذه الوصفة: مرتبطة بعناصر قائمة أو فواتير',
    createSuccess: 'تم إنشاء الوصفة بنجاح',
    updateSuccess: 'تم تحديث بيانات الوصفة',
    deactivateSuccess: 'تم إيقاف الوصفة',
    activateSuccess: 'تم تفعيل الوصفة',
    deleteSuccess: 'تم حذف الوصفة',
    confirmCreate: 'إضافة وصفة جديدة؟',
    confirmUpdate: 'تعديل بيانات الوصفة «%s»؟',
    confirmDelete: 'حذف الوصفة «%s» نهائيًا؟ لا يمكن التراجع.',
    cancel: 'إلغاء',
} as const;

/* ── مخططات التحقق ────────────────────────────────────────────────────── */

export const recipeCreateSchema = z.object({
    name: z.string().min(1, RECIPE_TEXT.nameRequired),
    selling_price: z.coerce.number().min(0, RECIPE_TEXT.priceInvalid),
    total_cost: z.coerce.number().min(0, RECIPE_TEXT.costInvalid),
    department_code: z.string().optional().nullable(),
    active: z.boolean().default(true),
});

export type RecipeCreateInput = z.infer<typeof recipeCreateSchema>;

export const recipeUpdateSchema = z.object({
    name: z.string().min(1, RECIPE_TEXT.nameRequired).optional(),
    selling_price: z.coerce.number().min(0, RECIPE_TEXT.priceInvalid).optional(),
    total_cost: z.coerce.number().min(0, RECIPE_TEXT.costInvalid).optional(),
    department_code: z.string().optional().nullable(),
    active: z.boolean().optional(),
});

export type RecipeUpdateInput = z.infer<typeof recipeUpdateSchema>;

export const recipeActiveSchema = z.object({
    active: z.boolean(),
});

export type RecipeActiveInput = z.infer<typeof recipeActiveSchema>;

const recipeResultSchema = z.object({ id: z.union([z.string(), z.number()]) }).passthrough();
export type RecipeResult = z.infer<typeof recipeResultSchema>;

/* ── العمليات ─────────────────────────────────────────────────────────── */

export async function createRecipe(input: RecipeCreateInput): Promise<RecipeResult> {
    return writeJson(recipeResultSchema, '/api/recipes', 'POST', {
        name: input.name.trim(),
        selling_price: Number(input.selling_price),
        total_cost: Number(input.total_cost),
        department_code: input.department_code?.trim() || null,
        active: input.active ?? true,
    });
}

export async function updateRecipe(id: string | number, input: RecipeUpdateInput): Promise<RecipeResult> {
    return writeJson(
        recipeResultSchema,
        `/api/recipes/${encodeURIComponent(String(id))}`,
        'PUT',
        {
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.selling_price !== undefined ? { selling_price: Number(input.selling_price) } : {}),
            ...(input.total_cost !== undefined ? { total_cost: Number(input.total_cost) } : {}),
            ...(input.department_code !== undefined ? { department_code: input.department_code?.trim() || null } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
        },
    );
}

export async function setRecipeActive(id: string | number, active: boolean): Promise<RecipeResult> {
    return writeJson(
        recipeResultSchema,
        `/api/recipes/${encodeURIComponent(String(id))}`,
        'PUT',
        { active },
    );
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

export function recipeActivateConfirm(name: string): string {
    return `تفعيل الوصفة «${String(name ?? '')}»؟`;
}

export function recipeDeactivateConfirm(name: string): string {
    return `إيقاف الوصفة «${String(name ?? '')}»؟`;
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

export function recipeDeactivateSuccess(name: string): string {
    return `${RECIPE_TEXT.deactivateSuccess} — «${String(name ?? '')}»`;
}

export function recipeActivateSuccess(name: string): string {
    return `${RECIPE_TEXT.activateSuccess} — «${String(name ?? '')}»`;
}

export function recipeDeleteSuccess(name: string): string {
    return `${RECIPE_TEXT.deleteSuccess} — «${String(name ?? '')}»`;
}
