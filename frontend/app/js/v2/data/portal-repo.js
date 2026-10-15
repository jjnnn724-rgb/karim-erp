/**
 * V2 - Portal/mixed registers repository (read-only facades)
 */

import { apiFetch } from '../../core/api.js?v=4.9.130';

export const WALK_PAGES = 8;

async function walk(entity) {
    const rows = [];
    for (let page = 1; page <= WALK_PAGES; page += 1) {
        const res = await apiFetch(`/${entity}?page=${page}&limit=1000&sort=id&order=desc`);
        const batch = res && Array.isArray(res.data) ? res.data
            : (Array.isArray(res) ? res : []);
        rows.push(...batch);
        const totalPages = Number(res && res.pagination && res.pagination.totalPages) || 0;
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < 1000) {break;}
    }
    return rows;
}

// ---------- Employee portal ----------
export async function fetchMyPunches() {
    try { return await apiFetch('/zkteco/my-punches'); }
    catch (e) { return { linked: false, punchCount: 0, error: e && e.message }; }
}

// ---------- Settings (public + safe) ----------
export async function fetchMainSettings() {
    try { return await apiFetch('/settings/main_settings'); }
    catch (_) { return null; }
}
export async function fetchCardSettings() {
    try { return await apiFetch('/hr/card-settings'); }
    catch (_) { return null; }
}
export async function fetchZatcaPublic() {
    try { return await apiFetch('/zatca/settings'); }
    catch (_) { return null; }
}

// ---------- Users ----------
export const fetchUsers = () => walk('users');
export function userToRow(u = {}) {
    // publicEntityRow already strips password/password_vault server-side.
    return {
        id: u.id,
        username: u.username ? String(u.username) : '',
        name: u.name ? String(u.name) : (u.username ? String(u.username) : ''),
        role: u.role ? String(u.role) : '',
        dept_code: u.dept_code ? String(u.dept_code) : '',
        active: u.active === undefined || u.active === true || u.active === 1 || u.active === '1',
        employeeName: u.employeeName || u.employee_name || '',
    };
}

// ---------- Yarasoft ----------
export async function fetchYarasoftStatus() {
    try { return await apiFetch('/yarasoft/status'); }
    catch (e) { return { error: e && e.message, degraded: true }; }
}
export async function fetchYarasoftLog(limit = 100) {
    try { const res = await apiFetch(`/yarasoft/log?limit=${limit}`); return Array.isArray(res) ? res : (res && res.data) || []; }
    catch (_) { return []; }
}

// ---------- Whatsapp ----------
export async function fetchWhatsappStatus() {
    try { return await apiFetch('/whatsapp/status'); }
    catch (e) { return { error: e && e.message, degraded: true }; }
}
export async function fetchWhatsappMessages(limit = 50) {
    try {
        const res = await apiFetch(`/whatsapp/messages?limit=${limit}`);
        return (res && res.messages) || (Array.isArray(res) ? res : (res && res.data) || []);
    } catch (_) { return []; }
}
