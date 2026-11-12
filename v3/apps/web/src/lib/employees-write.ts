import { z } from 'zod';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابة الموظفين — منقولة من V2 بوابات الصلاحية نفسها:
 *  • إنشاء     POST   /api/employees          (admin|manager|hr)
 *  • تعديل     PATCH  /api/employees/:id      (admin|manager|hr)
 *  • إيقاف/تفعيل PATCH /api/employees/:id/active (admin|manager|hr)
 *  • حذف نهائي DELETE /api/employees/:id      (admin)
 *
 * حتى تُفعَّل هذه المسارات في الباكendien، تُعدّ الدوال جاهزة للاستدعاء
 * عبر writeJson/writeAck stesse العقود المستخدمة في المخزون والفروع.
 */

export const EMPLOYEE_WRITE_ROLES = ['admin', 'manager', 'hr'] as const;
export const EMPLOYEE_DELETE_ROLES = ['admin'] as const;

export function employeeWriteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, EMPLOYEE_WRITE_ROLES);
}

export function employeeDeleteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, EMPLOYEE_DELETE_ROLES);
}

/* ── نصوص V2 حرفيًّا ───────────────────────────────────────────────────── */

export const EMPLOYEE_TEXT = {
    employeeIdRequired: 'كود الموظف مطلوب',
    employeeIdTaken: 'كود الموظف مستخدم بالفعل — اختر كودًا آخر',
    nameRequired: 'الاسم الكامل مطلوب',
    positionRequired: 'اختر الوظيفة',
    phoneRequired: 'رقم الهاتف مطلوب',
    createFailed: 'فشل إنشاء الموظف في قاعدة البيانات',
    updateFailed: 'فشل تحديث بيانات الموظف',
    deactivateFailed: 'فشل إيقاف الموظف',
    activateFailed: 'فشل تفعيل الموظف',
    deleteFailed: 'فشل حذف الموظف من قاعدة البيانات',
    deleteBlocked: 'لا يمكن حذف هذا الموظف: مرتبط بحضور أو رواتب أو سجلات في النظام',
    createSuccess: 'تم إنشاء الموظف بنجاح',
    updateSuccess: 'تم تحديث بيانات الموظف',
    deactivateSuccess: 'تم إيقاف الموظف',
    activateSuccess: 'تم تفعيل الموظف',
    deleteSuccess: 'تم حذف الموظف',
    confirmCreate: 'إضافة موظف جديد؟',
    confirmUpdate: 'تعديل بيانات الموظف «%s»؟',
    confirmDeactivate: 'إيقاف موظف «%s»؟ لن يظهر في قوائم الحضور والرواتب.',
    confirmActivate: 'تفعيل موظف «%s»؟ سيعود للقوائم مرة أخرى.',
    confirmDelete: 'حذف الموظف «%s» نهائيًا؟ لا يمكن التراجع.',
    cancel: 'إلغاء',
} as const;

/* ── مخططات التحقق ────────────────────────────────────────────────────── */

export const employeeCreateSchema = z.object({
    employeeId: z.string().min(1, EMPLOYEE_TEXT.employeeIdRequired),
    name: z.string().min(1, EMPLOYEE_TEXT.nameRequired),
    department: z.string().optional().nullable(),
    position: z.string().min(1, EMPLOYEE_TEXT.positionRequired),
    phone: z.string().min(1, EMPLOYEE_TEXT.phoneRequired),
    status: z.enum(['active', 'inactive']).default('active'),
});

export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;

export const employeeUpdateSchema = z.object({
    name: z.string().min(1, EMPLOYEE_TEXT.nameRequired),
    department: z.string().optional().nullable(),
    position: z.string().min(1, EMPLOYEE_TEXT.positionRequired),
    phone: z.string().min(1, EMPLOYEE_TEXT.phoneRequired),
    status: z.enum(['active', 'inactive']).optional(),
});

export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;

export const employeeActiveSchema = z.object({
    active: z.boolean(),
});

export type EmployeeActiveInput = z.infer<typeof employeeActiveSchema>;

const employeeResultSchema = z.object({ id: z.union([z.string(), z.number()]) }).passthrough();
export type EmployeeResult = z.infer<typeof employeeResultSchema>;

/* ── العمليات ─────────────────────────────────────────────────────────── */

export async function createEmployee(input: EmployeeCreateInput): Promise<EmployeeResult> {
    return writeJson(employeeResultSchema, '/api/employees', 'POST', {
        employeeId: input.employeeId.trim(),
        name: input.name.trim(),
        department: input.department?.trim() || null,
        position: input.position.trim(),
        phone: input.phone.trim(),
        status: input.status,
    });
}

export async function updateEmployee(id: string | number, input: EmployeeUpdateInput): Promise<EmployeeResult> {
    return writeJson(employeeResultSchema, `/api/employees/${encodeURIComponent(String(id))}`, 'PUT', {
        name: input.name.trim(),
        department: input.department?.trim() || null,
        position: input.position.trim(),
        phone: input.phone.trim(),
        ...(input.status !== undefined ? { status: input.status } : {}),
    });
}

export async function setEmployeeActive(id: string | number, active: boolean): Promise<EmployeeResult> {
    return writeJson(employeeResultSchema, `/api/employees/${encodeURIComponent(String(id))}`, 'PUT', { active });
}

export async function deleteEmployee(id: string | number): Promise<void> {
    await writeAck(`/api/employees/${encodeURIComponent(String(id))}`, 'DELETE');
}

/* ── دوال تأكيد ───────────────────────────────────────────────────────── */

export function employeeCreateConfirm(): string {
    return EMPLOYEE_TEXT.confirmCreate;
}

export function employeeUpdateConfirm(name: string): string {
    return EMPLOYEE_TEXT.confirmUpdate.replace('%s', String(name ?? ''));
}

export function employeeDeactivateConfirm(name: string): string {
    return EMPLOYEE_TEXT.confirmDeactivate.replace('%s', String(name ?? ''));
}

export function employeeActivateConfirm(name: string): string {
    return EMPLOYEE_TEXT.confirmActivate.replace('%s', String(name ?? ''));
}

export function employeeDeleteConfirm(name: string): string {
    return EMPLOYEE_TEXT.confirmDelete.replace('%s', String(name ?? ''));
}

/* ── نصوص نجاح ───────────────────────────────────────────────────────── */

export function employeeCreateSuccess(name: string): string {
    return `${EMPLOYEE_TEXT.createSuccess} — «${String(name ?? '')}»`;
}

export function employeeUpdateSuccess(name: string): string {
    return `${EMPLOYEE_TEXT.updateSuccess} — «${String(name ?? '')}»`;
}

export function employeeDeactivateSuccess(name: string): string {
    return `${EMPLOYEE_TEXT.deactivateSuccess} — «${String(name ?? '')}»`;
}

export function employeeActivateSuccess(name: string): string {
    return `${EMPLOYEE_TEXT.activateSuccess} — «${String(name ?? '')}»`;
}

export function employeeDeleteSuccess(name: string): string {
    return `${EMPLOYEE_TEXT.deleteSuccess} — «${String(name ?? '')}»`;
}
