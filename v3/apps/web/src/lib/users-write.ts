import { z } from 'zod';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابة المستخدمين — منقولة من V2 بوابات الصلاحية نفسها:
 *  • إنشاء     POST   /api/users          (admin|manager|hr)
 *  • تعديل     PATCH  /api/users/:id      (admin|manager|hr)
 *  • تعطيل     PATCH  /api/users/:id/active (admin|manager|hr)
 *  • حذف نهائي DELETE /api/users/:id      (admin)
 *
 * حتى تُفعَّل هذه المسارات في الباكendien، تُعدّ الدوال جاهزة للاستدعاء
 * عبر writeJson/writeAck stesse العقود المستخدمة في المخزون وأذون الصرف.
 */

export const USER_WRITE_ROLES = ['admin', 'manager', 'hr'] as const;
export const USER_DELETE_ROLES = ['admin'] as const;

export function userWriteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, USER_WRITE_ROLES);
}

export function userDeleteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, USER_DELETE_ROLES);
}

/* ── نصوص V2 حرفيًّا ───────────────────────────────────────────────────── */

export const USER_TEXT = {
    usernameRequired: 'اسم المستخدم مطلوب',
    usernameTaken: 'اسم المستخدم مستخدم بالفعل — اختر اسمًا آخر',
    nameRequired: 'الاسم الكامل مطلوب',
    roleRequired: 'اختر الدور',
    passwordRequired: 'كلمة المرور مطلوبة',
    passwordWeak: 'يجب أن تتكون كلمة المرور من 12 حرفًا على الأقل وتحتوي حروفًا وأرقامًا',
    createFailed: 'فشل إنشاء المستخدم في قاعدة البيانات',
    updateFailed: 'فشل تحديث بيانات المستخدم',
    deactivateFailed: 'فشل إيقاف حساب المستخدم',
    activateFailed: 'فشل تفعيل حساب المستخدم',
    deleteFailed: 'فشل حذف المستخدم من قاعدة البيانات',
    deleteBlocked: 'لا يمكن حذف هذا المستخدم: مرتبط بحركات أو سجلات في النظام',
    createSuccess: 'تم إنشاء المستخدم بنجاح',
    updateSuccess: 'تم تحديث بيانات المستخدم',
    deactivateSuccess: 'تم إيقاف الحساب',
    activateSuccess: 'تم تفعيل الحساب',
    deleteSuccess: 'تم حذف المستخدم',
    confirmCreate: 'إنشاء حساب مستخدم جديد؟',
    confirmUpdate: 'تعديل بيانات المستخدم «%s»؟',
    confirmDeactivate: 'إيقاف حساب «%s»؟ لن يتمكن من تسجيل الدخول.',
    confirmActivate: 'تفعيل حساب «%s»؟ سيمكنه تسجيل الدخول مرة أخرى.',
    confirmDelete: 'حذف المستخدم «%s» نهائيًا؟ لا يمكن التراجع.',
    cancel: 'إلغاء',
} as const;

/* ── مخططات التحقق ────────────────────────────────────────────────────── */

/** سياسة الخادم نفسها (`isStrongPassword` في jwt-middleware.js): 12 حرفًا + حرف ورقم. */
export function isStrongPassword(value: string): boolean {
    return value.length >= 12 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

export const userCreateSchema = z.object({
    username: z.string().min(1, USER_TEXT.usernameRequired),
    name: z.string().min(1, USER_TEXT.nameRequired),
    role: z.string().min(1, USER_TEXT.roleRequired),
    dept_code: z.string().optional().nullable(),
    password: z.string().min(1, USER_TEXT.passwordRequired).refine(isStrongPassword, USER_TEXT.passwordWeak),
    active: z.boolean().default(true),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z.object({
    name: z.string().min(1, USER_TEXT.nameRequired),
    role: z.string().min(1, USER_TEXT.roleRequired),
    dept_code: z.string().optional().nullable(),
    active: z.boolean().optional(),
    password: z
        .string()
        .optional()
        .refine((value) => !value || isStrongPassword(value), USER_TEXT.passwordWeak),
});

export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const userActiveSchema = z.object({
    active: z.boolean(),
});

export type UserActiveInput = z.infer<typeof userActiveSchema>;

const userResultSchema = z.object({ id: z.union([z.string(), z.number()]) }).passthrough();
export type UserResult = z.infer<typeof userResultSchema>;

/* ── العمليات ─────────────────────────────────────────────────────────── */

export async function createUser(input: UserCreateInput): Promise<UserResult> {
    return writeJson(userResultSchema, '/api/users', 'POST', {
        username: input.username.trim(),
        name: input.name.trim(),
        role: input.role.trim(),
        dept_code: input.dept_code?.trim() || null,
        password: input.password,
        active: input.active ?? true,
    });
}

export async function updateUser(id: string | number, input: UserUpdateInput): Promise<UserResult> {
    return writeJson(userResultSchema, `/api/users/${encodeURIComponent(String(id))}`, 'PUT', {
        name: input.name.trim(),
        role: input.role.trim(),
        dept_code: input.dept_code?.trim() || null,
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.password ? { password: input.password } : {}),
    });
}

export async function setUserActive(id: string | number, active: boolean): Promise<UserResult> {
    return writeJson(userResultSchema, `/api/users/${encodeURIComponent(String(id))}`, 'PUT', { active });
}

export async function deleteUser(id: string | number): Promise<void> {
    await writeAck(`/api/users/${encodeURIComponent(String(id))}`, 'DELETE');
}

/* ── رمز استعادة كلمة المرور (2026-11-11) ────────────────────────────────
 * POST /api/auth/forgot-password/request-code (admin|manager) — الخادم
 * يفرض الهرم: لا رمز لحساب ندٍّ أو أعلى، ولا لنفسك. الرمز يعود مرة واحدة
 * ليقرأه المدير على الموظف، وصلاحيته 10 دقائق واستخدام واحد.
 */

export const USER_RESET_ROLES = ['admin', 'manager'] as const;

export function userResetVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, USER_RESET_ROLES);
}

export const resetCodeSchema = z
    .object({
        ok: z.boolean().optional(),
        username: z.string().optional(),
        user_name: z.string().nullable().optional(),
        code: z.string(),
        expires_in_seconds: z.number().optional(),
        message: z.string().optional(),
    })
    .passthrough();

export type ResetCode = z.infer<typeof resetCodeSchema>;

export async function issueResetCode(username: string): Promise<ResetCode> {
    return writeJson(resetCodeSchema, '/api/auth/forgot-password/request-code', 'POST', {
        username: username.trim(),
    });
}

/* ── دوال تأكيد ───────────────────────────────────────────────────────── */

export function userCreateConfirm(): string {
    return USER_TEXT.confirmCreate;
}

export function userUpdateConfirm(name: string): string {
    return USER_TEXT.confirmUpdate.replace('%s', String(name ?? ''));
}

export function userDeactivateConfirm(name: string): string {
    return USER_TEXT.confirmDeactivate.replace('%s', String(name ?? ''));
}

export function userActivateConfirm(name: string): string {
    return USER_TEXT.confirmActivate.replace('%s', String(name ?? ''));
}

export function userDeleteConfirm(name: string): string {
    return USER_TEXT.confirmDelete.replace('%s', String(name ?? ''));
}

/* ── نصوص نجاح ───────────────────────────────────────────────────────── */

export function userCreateSuccess(name: string): string {
    return `${USER_TEXT.createSuccess} — «${String(name ?? '')}»`;
}

export function userUpdateSuccess(name: string): string {
    return `${USER_TEXT.updateSuccess} — «${String(name ?? '')}»`;
}

export function userDeactivateSuccess(name: string): string {
    return `${USER_TEXT.deactivateSuccess} — «${String(name ?? '')}»`;
}

export function userActivateSuccess(name: string): string {
    return `${USER_TEXT.activateSuccess} — «${String(name ?? '')}»`;
}

export function userDeleteSuccess(name: string): string {
    return `${USER_TEXT.deleteSuccess} — «${String(name ?? '')}»`;
}
