/**
 * V2 — Shell extras repository (أبواب القشرة: إشعارات/صحة/كلمة مرور)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM legacy counterparts, NOT INVENTED
 *   GET  /notifications            → { notifications[50], unread_count }
 *   POST /notifications/read {ids} · POST /notifications/read-all ·
 *     DELETE /notifications (app.js:278-331 — الجرس للأدمن وحده :255)
 *   GET  /api/health[/ready]        → { status, checks } بلا مصادقة
 *     (middleware/health.js — انظر التعليق :7-17)
 *   POST /api/auth/change-password {current_password, new_password}
 *     (auth-navigation.js:13/:45 — نفس أسماء الحقول)
 */

import { apiFetch } from '../../core/api.js?v=4.9.130';

export const NOTIF_ADMIN_ROLES = ['admin'];

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
