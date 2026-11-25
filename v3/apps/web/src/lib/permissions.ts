import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { arSearchKey } from './employees';
import { fetchUsers, roleLabel, type User } from './users';

/**
 * الصلاحيات — قراءة فقط من `/api/permissions` (backend/permission-routes.js).
 *
 *   GET /permissions/catalog   → [{ key, ar, group, menus,
 *                                  entitiesRead, entitiesWrite }]  (admin فقط)
 *   GET /permissions/users/:id → { user, grants[], denies[], menus[],
 *                                  audit[{ perm_key, action, acted_by,
 *                                          reason, created_at }] }  (admin فقط)
 *
 * المنح الفردية تُضاف فوق الدور، والسحب يغلب المنح والوراثة
 * (`permMode` مرآة `permissions-repo.js:85-89`). دور admin يملك كل شيء
 * ضمنيًا — لا منح له ولا حفظ. التعيين نفسه يبقى في V2 (admin فقط هناك)،
 * والقراءة هنا تعرض رفض الخادم كما هو بلا سبق.
 */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const optionalText = z.string().nullable().optional();
const activeValue = z
    .union([z.boolean(), z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => value === undefined || value === null || value === true || value === 1 || value === '1');

const stringList = z
    .array(z.union([z.string(), z.number(), z.null()]))
    .nullable()
    .optional()
    .transform((value) => (value ?? []).map((item) => String(item)).filter(Boolean));

export const permissionSchema = z
    .object({
        key: z.string(),
        ar: optionalText,
        group: optionalText,
        menus: stringList,
        entitiesRead: stringList,
        entitiesWrite: stringList,
    })
    .passthrough();

export type PermissionItem = z.infer<typeof permissionSchema>;

const catalogSchema = z
    .union([z.array(permissionSchema), z.object({ data: z.array(permissionSchema) }).passthrough()])
    .transform((body) => (Array.isArray(body) ? body : body.data));

export const auditSchema = z
    .object({
        perm_key: optionalText,
        action: optionalText,
        acted_by: optionalText,
        reason: optionalText,
        created_at: optionalText,
    })
    .passthrough();

export type AuditEntry = z.infer<typeof auditSchema>;

const targetSchema = z
    .object({
        id: idValue,
        username: optionalText,
        name: optionalText,
        role: optionalText,
        active: activeValue,
    })
    .passthrough();

const userPermissionsSchema = z
    .object({
        user: targetSchema.nullable().optional(),
        grants: stringList,
        denies: stringList,
        menus: stringList,
        audit: z.array(auditSchema).nullable().optional(),
    })
    .passthrough()
    .transform((body) => ({ ...body, audit: body.audit ?? [] }));

export type UserPermissions = z.infer<typeof userPermissionsSchema>;

export async function fetchPermissionCatalog(signal?: AbortSignal): Promise<PermissionItem[]> {
    return fetchJson(catalogSchema, '/api/permissions/catalog', getAccessToken(), signal ? { signal } : {});
}

export async function fetchUserPermissions(id: string, signal?: AbortSignal): Promise<UserPermissions> {
    return fetchJson(
        userPermissionsSchema,
        `/api/permissions/users/${encodeURIComponent(id)}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export type PermissionBootstrap = {
    catalog: PermissionItem[];
    users: User[];
};

/** الكتالوج وقائمة المستخدمين معًا — باب الشاشة الوحيد إلى الشبكة. */
export async function fetchPermissionBootstrap(signal?: AbortSignal): Promise<PermissionBootstrap> {
    const [catalog, users] = await Promise.all([fetchPermissionCatalog(signal), fetchUsers(signal)]);
    return { catalog, users };
}

/* ─── التجميع والوضع ───────────────────────────────────────────────────── */

export function groupCatalog(catalog: readonly PermissionItem[]): { name: string; items: PermissionItem[] }[] {
    const groups: { name: string; items: PermissionItem[] }[] = [];
    for (const item of catalog) {
        const name = item.group ? String(item.group) : 'بلا مجموعة';
        let group = groups.find((entry) => entry.name === name);
        if (!group) {
            group = { name, items: [] };
            groups.push(group);
        }
        group.items.push(item);
    }
    return groups;
}

export type PermissionMode = 'inherit' | 'grant' | 'deny';

/** مرآة `permissions-repo.js:85-89`: السحب يغلب المنح يغلب وراثة الدور. */
export function permMode(key: string, grants: ReadonlySet<string>, denies: ReadonlySet<string>): PermissionMode {
    if (denies.has(key)) {
        return 'deny';
    }
    if (grants.has(key)) {
        return 'grant';
    }
    return 'inherit';
}

export type AuditTone = 'success' | 'danger' | 'info' | 'muted';

/** مرآة `permissions-repo.js:92-97` بنغمات v3. */
export function auditActionLabel(action: string): { label: string; tone: AuditTone } {
    if (action === 'grant') {
        return { label: 'منح', tone: 'success' };
    }
    if (action === 'deny') {
        return { label: 'سحب', tone: 'danger' };
    }
    if (action === 'undeny') {
        return { label: 'إلغاء سحب', tone: 'info' };
    }
    return { label: 'سحب منح', tone: 'danger' };
}

export function permissionModeLabel(mode: PermissionMode): string {
    if (mode === 'grant') {
        return 'منح';
    }
    if (mode === 'deny') {
        return 'سحب';
    }
    return 'وراثة الدور';
}

export type CatalogTotals = {
    permissions: number;
    groups: number;
    menus: number;
    entities: number;
};

export function catalogTotals(catalog: readonly PermissionItem[]): CatalogTotals {
    const menus = new Set<string>();
    const entities = new Set<string>();
    for (const item of catalog) {
        for (const menu of item.menus) {
            menus.add(menu);
        }
        for (const entity of [...item.entitiesRead, ...item.entitiesWrite]) {
            entities.add(entity);
        }
    }
    return {
        permissions: catalog.length,
        groups: groupCatalog(catalog).length,
        menus: menus.size,
        entities: entities.size,
    };
}

export type ModeCounts = { grant: number; deny: number; inherit: number };

export function modeCounts(
    catalog: readonly PermissionItem[],
    grants: ReadonlySet<string>,
    denies: ReadonlySet<string>,
): ModeCounts {
    const counts: ModeCounts = { grant: 0, deny: 0, inherit: 0 };
    for (const item of catalog) {
        counts[permMode(item.key, grants, denies)] += 1;
    }
    return counts;
}

/* ─── البحث واختيار المستخدم ───────────────────────────────────────────── */

export function searchPermissions(
    items: readonly PermissionItem[],
    query: string,
): { rows: PermissionItem[]; folded: boolean } {
    const raw = String(query ?? '').trim();
    if (!raw) {
        return { rows: [...items], folded: false };
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    let folded = false;
    const rows = items.filter((item) => {
        const fields = [item.ar ?? '', item.key, item.group ?? ''];
        return tokens.every((token) => {
            const plain = token.toLowerCase();
            if (fields.some((field) => field.toLowerCase().includes(plain))) {
                return true;
            }
            const key = arSearchKey(token);
            if (key && fields.some((field) => arSearchKey(field).includes(key))) {
                folded = true;
                return true;
            }
            return false;
        });
    });
    return { rows, folded };
}

export type UserOption = {
    id: string;
    username: string;
    name: string;
    role: string;
    roleLabel: string;
    admin: boolean;
    label: string;
};

/** النشطون أولًا كما في القديم، وترتيب عربي بالاسم ثم اسم المستخدم. */
export function activeUserOptions(users: readonly User[]): UserOption[] {
    return users
        .filter((user) => user.active)
        .map((user) => {
            const username = user.username ? String(user.username) : '';
            const name = user.name ? String(user.name) : '';
            const role = user.role ? String(user.role) : '';
            const presentation = roleLabel(role);
            return {
                id: user.id,
                username,
                name,
                role,
                roleLabel: presentation.label,
                admin: role === 'admin',
                label: `${name || username || `#${user.id}`} (${presentation.label})`,
            };
        })
        .sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username, 'ar'));
}

export function auditTimestamp(value: string): string {
    return value ? String(value).slice(0, 19).replace('T', ' ') : '—';
}
