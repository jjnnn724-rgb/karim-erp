/**
 * V2 — Permissions repository (الباب الوحيد إلى /api/permissions)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM THE SERVER (backend/permission-routes.js), NOT INVENTED
 *   GET /permissions/catalog    → [{ key, ar, group, menus, entitiesRead,
 *     entitiesWrite }] — admin فقط (:28)
 *   GET /permissions/users/:id  → { user{ id, username, name, role, active },
 *     grants[], denies[], menus[], audit[{ perm_key, action, acted_by,
 *     reason, created_at }] } — admin فقط (:40)
 *   PUT /permissions/users/:id  → { ok, user, grants[], denies[], menus[] }
 *     body { grants[], denies[]|null, reason } — admin فقط (:58)
 *     denies=null = لا تغيير على السحب (:67-69)؛ الدور admin مرفوض 422
 *     ADMIN_HAS_ALL (:64)؛ المفاتيح المجهولة تُسقط بصمت (:66-68)
 *
 * Grants are additive over roles. Admin role implies everything — لا زر
 * حفظ لهدف admin (مرآة features/permissions.js:26 و:53).
 */

import { apiFetch } from '../../core/api.js?v=4.9.185';
import { fetchUsers, userToRow } from './portal-repo.js?v=4.9.185';

/** بوابة الكتابة مرآة للخادم: requireRole('admin') في الأبواب الثلاثة. */
export const PERM_WRITE_ROLES = ['admin'];

/** الكتالوج الخام كما يرد — بلا إعادة تسمية. */
export async function fetchPermCatalog() {
    const res = await apiFetch('/permissions/catalog');
    return Array.isArray(res) ? res : [];
}

/** منح مستخدم واحد + سجل تدقيقه (آخر 50 من الخادم). */
export async function fetchUserPerms(id) {
    const res = await apiFetch(`/permissions/users/${encodeURIComponent(id)}`);
    const o = res && typeof res === 'object' ? res : {};
    return {
        user: o.user && typeof o.user === 'object' ? o.user : null,
        grants: Array.isArray(o.grants) ? o.grants.map(String) : [],
        denies: Array.isArray(o.denies) ? o.denies.map(String) : [],
        audit: Array.isArray(o.audit) ? o.audit : [],
    };
}

/**
 * حفظ المنح والسحب — denies=null تعني لا تغيير على السحب (عقد الخادم :67).
 * @returns {{ ok: boolean, grants: string[], denies: string[] }}
 */
export async function saveUserPerms(id, { grants, denies, reason }) {
    const body = { grants: [...new Set((grants || []).map(String))] };
    if (denies !== undefined && denies !== null) {
        body.denies = [...new Set(denies.map(String))];
    }
    if (reason !== undefined) {body.reason = String(reason || '').slice(0, 300);}
    const res = await apiFetch(`/permissions/users/${encodeURIComponent(id)}`, {
        method: 'PUT', body: JSON.stringify(body),
    });
    const o = res && typeof res === 'object' ? res : {};
    return {
        ok: o.ok !== false,
        grants: Array.isArray(o.grants) ? o.grants.map(String) : [],
        denies: Array.isArray(o.denies) ? o.denies.map(String) : [],
    };
}

/** قائمة المستخدمين للاختيار — النشطون أولًا بترتيب عربي (مرآة القديم :12-13). */
export async function fetchPermissionUsers() {
    const rows = await fetchUsers();
    return rows.map(userToRow)
        .filter((u) => u.active !== false)
        .sort((a, b) => String(a.name || a.username)
            .localeCompare(String(b.name || b.username), 'ar'));
}

/** الكتالوج → مجموعات بنفس ترتيب الورود (مرآة القديم :16-20). */
export function groupCatalog(catalog) {
    const groups = [];
    for (const p of catalog || []) {
        let g = groups.find((x) => x.name === p.group);
        if (!g) {g = { name: p.group, items: []}; groups.push(g);}
        g.items.push(p);
    }
    return groups;
}

/** وضع الصلاحية لهدف: deny يغلب grant يغلب وراثة الدور (مرآة القديم :42). */
export function permMode(key, grants, denies) {
    if (denies && denies.has(key)) {return 'deny';}
    if (grants && grants.has(key)) {return 'grant';}
    return 'inherit';
}

/** تسمية إجراء التدقيق — نغمات erp-badge في V2. */
export function auditActionLabel(action) {
    if (action === 'grant') {return { label: 'منح', tone: 'success' };}
    if (action === 'deny') {return { label: 'سحب', tone: 'danger' };}
    if (action === 'undeny') {return { label: 'إلغاء سحب', tone: 'info' };}
    return { label: 'سحب منح', tone: 'danger' };
}
