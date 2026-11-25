import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken, useAuthState } from './auth';
import { allowedMenus } from './role-menus';

/**
 * قوائم المستخدم الفعالة — مرآة `allowedMenus()` في `nav-model.js` (V2):
 *   base = role.menus (frontend/app/js/core/config.js ROLES)
 *   extra = STATE.permissions.menus (المنح من /api/permissions/me)
 *   denied = deniedMenus (السحب) — admin معفى من السحب
 *   النتيجة = unique(base + extra) − denied
 *
 * فشل الجلب أو غياب الجلسة = القوائم الأساسية للدور فقط (الخادم هو الحكم
 * النهائي؛ اللوحة الجانبية توجيه لا بوابة).
 */

const myPermissionsSchema = z
    .object({
        grants: z.array(z.string()).nullable().optional(),
        denies: z.array(z.string()).nullable().optional(),
        menus: z.array(z.string()).nullable().optional(),
        deniedMenus: z.array(z.string()).nullable().optional(),
    })
    .passthrough();

export type MyPermissions = z.infer<typeof myPermissionsSchema>;

export async function fetchMyPermissions(signal?: AbortSignal): Promise<MyPermissions> {
    return fetchJson(myPermissionsSchema, '/api/permissions/me', getAccessToken(), signal ? { signal } : {});
}

/** القوائم الفعالة للدور الحالي: أساس الدور + المنح − الممنوعات. */
export function useAllowedMenus(): readonly string[] | null {
    const auth = useAuthState();
    const role = auth.user?.role ?? null;
    const userId = auth.user?.id ?? null;

    const meQuery = useQuery({
        queryKey: ['permissions', 'me', userId],
        queryFn: ({ signal }) => fetchMyPermissions(signal),
        enabled: Boolean(userId),
        staleTime: 5 * 60 * 1000,
    });

    const me = meQuery.data;
    if (!role) {
        return null;
    }
    return allowedMenus(role, me?.menus ?? [], me?.deniedMenus ?? []);
}
