import { z } from 'zod';
import { isWriteRole, writeJson } from './write';

/**
 * كتابة الصلاحيات — منقولة من V2 (`permission-routes.js`):
 *  • PUT /api/permissions/users/:id  (admin فقط) — `grants[]`, `denies[]`, `reason`
 *
 * دور admin يملك كل الصلاحيات ضمنيًا والخادم يرفض تعيينه (`ADMIN_HAS_ALL`).
 */

export const PERMISSIONS_WRITE_ROLES = ['admin'] as const;

export function permissionsWriteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, PERMISSIONS_WRITE_ROLES);
}

/* ── نصوص ─────────────────────────────────────────────────────────────── */

export const PERMISSIONS_TEXT = {
    saveSuccess: 'تم حفظ الصلاحيات',
    saveFailed: 'فشل حفظ الصلاحيات: تعذّر الحفظ',
    cancel: 'إلغاء',
} as const;

/* ── العمليات ─────────────────────────────────────────────────────────── */

const permissionsResultSchema = z.object({ ok: z.boolean().optional() }).passthrough();

export async function saveUserPermissions(
    userId: string | number,
    input: { grants: string[]; denies: string[]; reason?: string },
): Promise<void> {
    await writeJson(
        permissionsResultSchema,
        `/api/permissions/users/${encodeURIComponent(String(userId))}`,
        'PUT',
        {
            grants: input.grants,
            denies: input.denies,
            reason: input.reason?.trim() || null,
        },
    );
}
