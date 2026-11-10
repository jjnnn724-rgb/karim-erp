import { z } from 'zod';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابة الأقسام — منقولة من V2 بوابات الصلاحية نفسها (نظام CRUD العام في الخادم):
 *  • إنشاء     POST   /api/departments          (admin|manager)
 *  • تعديل     PATCH  /api/departments/:id      (admin|manager)
 *  • إلغاء     DELETE /api/departments/:id      (admin)
 *
 * حتى تُفعَّل هذه المسارات في الباكendien، تُعدّ الدوال جاهزة للاستدعاء.
 */

export const DEPARTMENT_WRITE_ROLES = ['admin', 'manager'] as const;
export const DEPARTMENT_DELETE_ROLES = ['admin'] as const;

export function departmentWriteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, DEPARTMENT_WRITE_ROLES);
}

export function departmentDeleteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, DEPARTMENT_DELETE_ROLES);
}

/* ── نصوص V2 حرفيًّا ───────────────────────────────────────────────────── */

export const DEPARTMENT_TEXT = {
    codeRequired: 'كود القسم مطلوب',
    nameRequired: 'اسم القسم مطلوب',
    codeTaken: 'كود القسم مستخدم بالفعل — اختر كودًا آخر',
    createFailed: 'فشل إنشاء القسم في قاعدة البيانات',
    updateFailed: 'فشل تحديث بيانات القسم',
    deleteFailed: 'فشل حذف القسم من قاعدة البيانات',
    deleteBlocked: 'لا يمكن حذف هذا القسم: مرتبط بموظفين أو فواتير أو حركات مخزون',
    createSuccess: 'تم إنشاء القسم بنجاح',
    updateSuccess: 'تم تحديث بيانات القسم',
    deactivateSuccess: 'تم إيقاف القسم',
    activateSuccess: 'تم تفعيل القسم',
    deleteSuccess: 'تم حذف القسم',
    confirmCreate: 'إضافة قسم جديد؟',
    confirmUpdate: 'تعديل بيانات القسم «%s»؟',
    confirmDeactivate: 'إيقاف قسم «%s»؟ لن يظهر في سجلات الأقسام.',
    confirmActivate: 'تفعيل قسم «%s»؟ سيعود للقوائم مرة أخرى.',
    confirmDelete: 'حذف القسم «%s» نهائيًا؟ لا يمكن التراجع.',
    cancel: 'إلغاء',
} as const;

/* ── مخططات التحقق ────────────────────────────────────────────────────── */

export const departmentCreateSchema = z.object({
    code: z.string().min(1, DEPARTMENT_TEXT.codeRequired),
    name: z.string().min(1, DEPARTMENT_TEXT.nameRequired),
    parent_code: z.string().optional().nullable(),
    active: z.boolean().default(true),
});

export type DepartmentCreateInput = z.infer<typeof departmentCreateSchema>;

export const departmentUpdateSchema = z.object({
    name: z.string().min(1, DEPARTMENT_TEXT.nameRequired),
    parent_code: z.string().optional().nullable(),
    active: z.boolean().optional(),
});

export type DepartmentUpdateInput = z.infer<typeof departmentUpdateSchema>;

export const departmentActiveSchema = z.object({
    active: z.boolean(),
});

export type DepartmentActiveInput = z.infer<typeof departmentActiveSchema>;

const departmentResultSchema = z.object({ id: z.union([z.string(), z.number()]) }).passthrough();
export type DepartmentResult = z.infer<typeof departmentResultSchema>;

/* ── العمليات ─────────────────────────────────────────────────────────── */

export async function createDepartment(input: DepartmentCreateInput): Promise<DepartmentResult> {
    return writeJson(departmentResultSchema, '/api/departments', 'POST', {
        code: input.code.trim(),
        name: input.name.trim(),
        parent_code: input.parent_code?.trim() || null,
        active: input.active ?? true,
    });
}

export async function updateDepartment(id: string | number, input: DepartmentUpdateInput): Promise<DepartmentResult> {
    return writeJson(
        departmentResultSchema,
        `/api/departments/${encodeURIComponent(String(id))}`,
        'PUT',
        {
            name: input.name.trim(),
            parent_code: input.parent_code?.trim() || null,
            ...(input.active !== undefined ? { active: input.active } : {}),
        },
    );
}

export async function setDepartmentActive(id: string | number, active: boolean): Promise<DepartmentResult> {
    return writeJson(
        departmentResultSchema,
        `/api/departments/${encodeURIComponent(String(id))}`,
        'PUT',
        { active },
    );
}

export async function deleteDepartment(id: string | number): Promise<void> {
    await writeAck(`/api/departments/${encodeURIComponent(String(id))}`, 'DELETE');
}

/* ── دوال تأكيد ───────────────────────────────────────────────────────── */

export function departmentCreateConfirm(): string {
    return DEPARTMENT_TEXT.confirmCreate;
}

export function departmentUpdateConfirm(name: string): string {
    return DEPARTMENT_TEXT.confirmUpdate.replace('%s', String(name ?? ''));
}

export function departmentDeleteConfirm(name: string): string {
    return DEPARTMENT_TEXT.confirmDelete.replace('%s', String(name ?? ''));
}

export function departmentActivateConfirm(name: string): string {
    return DEPARTMENT_TEXT.confirmActivate.replace('%s', String(name ?? ''));
}

export function departmentDeactivateConfirm(name: string): string {
    return DEPARTMENT_TEXT.confirmDeactivate.replace('%s', String(name ?? ''));
}

/* ── نصوص نجاح ───────────────────────────────────────────────────────── */

export function departmentCreateSuccess(name: string): string {
    return `${DEPARTMENT_TEXT.createSuccess} — «${String(name ?? '')}»`;
}

export function departmentUpdateSuccess(name: string): string {
    return `${DEPARTMENT_TEXT.updateSuccess} — «${String(name ?? '')}»`;
}

export function departmentDeactivateSuccess(name: string): string {
    return `${DEPARTMENT_TEXT.deactivateSuccess} — «${String(name ?? '')}»`;
}

export function departmentActivateSuccess(name: string): string {
    return `${DEPARTMENT_TEXT.activateSuccess} — «${String(name ?? '')}»`;
}
