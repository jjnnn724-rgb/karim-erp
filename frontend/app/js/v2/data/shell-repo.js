/**
 * V2 — Shell extras repository (أبواب القشرة: إشعارات/صحة/كلمة مرور)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM legacy counterparts, NOT INVENTED
 *   GET  /notifications            → { notifications[50], unread_count }
 *     الخادم يُصوّر الاستعلام على مالك الجلسة وحده
 *     (notification-routes.js:52 `WHERE (n.user_id = $1 OR user_id IS NULL)`)
 *     فلا رؤية لغير إشعاراتك. ولأن أبواب الاعتماد الموجّهة تصلك على دورك
 *     (dispatch-notifier.js:34-48 ينادي kitchen/sous_chef/warehouse)،
 *     فجرس v2 يظهر لكل دور مصادق في الوضع الحيّ — لا قيد الأدمن القديم
 *     (app.js:255 سياسةُ البثّ العام القديمة وقد سبقها التوجيه الموجّه).
 *   POST /notifications/read {ids} · POST /notifications/read-all ·
 *     DELETE /notifications (notification-routes.js:102/129/154)
 *   GET  /api/health[/ready]        → { status, checks } بلا مصادقة
 *     (middleware/health.js — انظر التعليق :7-17)
 *   POST /api/auth/change-password {current_password, new_password}
 *     (auth-navigation.js:13/:45 — نفس أسماء الحقول)
 *   GET  /permissions/me → { grants, denies, menus, deniedMenus }
 *     (permission-routes.js:133 — jwtAuth وحدها، بلا requireRole؛ أي جلسة
 *     تقرأ صلاحياتها. legacy يستدعيها بعد الدخول مباشرة auth-navigation.js:198)
 */

import { apiFetch } from '../../core/api.js?v=4.9.186';

export async function fetchNotifications() {
    const data = await apiFetch('/notifications');
    return {
        list: Array.isArray(data.notifications) ? data.notifications.slice(0, 50) : [],
        unread: Number(data.unread_count) || 0,
    };
}

export async function markNotificationsRead(ids) {
    return apiFetch('/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) });
}

export async function markAllNotificationsRead() {
    return apiFetch('/notifications/read-all', { method: 'POST' });
}

export async function clearNotifications() {
    return apiFetch('/notifications', { method: 'DELETE' });
}

/**
 * الصلاحيات الفعلية للجلسة الحالية.
 *
 * لا ترمي أبدًا: مثل legacy (auth-navigation.js:200) الفشل يعني قوائم الدور
 * فقط بلا منح إضافية — وهو الوضع الآمن (خصم، لا إضافة).
 *
 * @returns {Promise<{grants:string[],denies:string[],menus:string[],deniedMenus:string[]}>}
 */
export async function fetchMyPermissions() {
    const arr = (v) => Array.isArray(v) ? v : [];
    try {
        const me = await apiFetch('/permissions/me');
        return {
            grants: arr(me && me.grants),
            denies: arr(me && me.denies),
            menus: arr(me && me.menus),
            deniedMenus: arr(me && me.deniedMenus),
        };
    } catch {
        return { grants: [], denies: [], menus: [], deniedMenus: [] };
    }
}

export async function fetchHealth() {
    try {
        const r = await apiFetch('/health/ready');
        return normalizeHealth(r);
    } catch {
        try {
            const r = await apiFetch('/health');
            return normalizeHealth(r);
        } catch (_) {
            return { ok: false, server: false, db: null, status: 'down' };
        }
    }
}

export async function fetchServerInfo() {
    const info = await apiFetch('/system/server-info');
    if (!info || typeof info !== 'object' || typeof info.upToDate !== 'boolean') {
        throw new Error('صيغة حالة إصدار الخادم غير صالحة');
    }
    return {
        upToDate: info.upToDate,
        startedAt: info.startedAt || null,
        codeMtime: info.codeMtime || null,
    };
}

function normalizeHealth(r = {}) {
    const status = String(r.status || '').toLowerCase();
    const checks = (r && r.checks) || {};
    const dbRaw = checks.db ?? checks.database ?? checks.postgres ?? null;
    const db = dbRaw === null || dbRaw === undefined
        ? (status === 'ok' ? true : null)
        : (dbRaw === true || String(dbRaw).toLowerCase() === 'ok' || String(dbRaw).toLowerCase() === 'up');
    return {
        ok: status === 'ok',
        server: true,
        db,
        status: status || 'unknown',
        uptime: r.uptime ?? null,
    };
}

export async function changePassword({ current_password, new_password }) {
    if (!current_password || !new_password) {throw new Error('أكمل الحقلين');}
    return apiFetch('/auth/change-password', {
        method: 'POST', body: JSON.stringify({ current_password, new_password }),
    });
}

/**
 * استعادة كلمة المرور — POST /auth/forgot-password/reset بلا مصادقة
 * (auth-navigation.js:78 — raw fetch مثل الدخول: apiFetch على 401 يمسح
 * التوكن المخزّن، وهنا لا جلسة أصلًا).
 */
export async function resetPassword({ username, code, new_password }) {
    if (!username || !/^\d{6}$/.test(String(code || '')) || !new_password) {
        throw new Error('أكمل اسم المستخدم والرمز وكلمة المرور الجديدة');
    }
    const res = await fetch(`${window.location.origin}/api/auth/forgot-password/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username, code, new_password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {throw new Error((data && (data.message || data.error)) || 'تعذر تغيير كلمة المرور — تحقق من الرمز');}
    return data;
}
