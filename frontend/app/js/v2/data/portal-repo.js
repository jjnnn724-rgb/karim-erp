/**
 * V2 - Portal/mixed registers repository
 * ═══════════════════════════════════════════════════════════════════════
 * القراءة عامة (status/my-punches/settings). أبواب البوابة الذاتية (P2-3)
 * هنا وحدها — لا fetch في الشاشة: البصمة، تسجيل الرفض الأصلي، وقوالب الوجه
 * (v1 متجهات / v2 لقطات). الأدوار مرآة الخادم، والخادم يبقى الحاكم.
 */

import { apiFetch } from '../../core/api.js?v=4.9.151';

export const WALK_PAGES = 8;

/** أدوار البصمة الذاتية — مرآة requireRole في attendance-portal-routes.js:151 */
export const PUNCH_ROLES = ['admin', 'hr', 'dept_head', 'cashier', 'kitchen', 'sous_chef', 'warehouse', 'employee'];

/** قوالب الوجه — مرآة requireRole في :661 و:703 (admin/hr فقط) */
export const FACE_ENROLL_ROLES = ['admin', 'hr'];

/** رموز الرفض الأصلية المسموحة — مرآة CLIENT_REJECT_CODES في :471 */
export const CLIENT_REJECT_CODES = ['PUNCH_LOCATION_MOCKED_CLIENT', 'PUNCH_LOCATION_UNAVAILABLE_CLIENT'];

/** مفتاح جهاز البصمة المشترك مع القديم — الربط لا ينكسر بين الواجهتين */
export const DEVICE_ID_KEY = 'punch_device_id';

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
export async function fetchPortalStatus() {
    return apiFetch('/attendance/portal/status');
}

export async function fetchMyPunches() {
    try { return await apiFetch('/zkteco/my-punches'); }
    catch (e) { return { linked: false, punchCount: 0, error: e && e.message }; }
}

/**
 * تفصيل الرفض المحلي — نفس قائمة الخادم الصارمة (أحرف/أرقام/نقطتان فقط)
 * حتى لا يتحوّل نص جهاز إلى HTML مخزَّن في سجل المحاولات.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function sanitizeClientDetail(raw) {
    return String(raw || '')
        .replace(/[^A-Za-z0-9:_.\- ]/g, '')
        .trim()
        .slice(0, 120) || null;
}

/**
 * رفض حدث على الجهاز قبل وصول البصمة للسيرفر — لا رفض صامت خارج punch_attempts.
 * @param {string} reason رمز من CLIENT_REJECT_CODES
 * @param {string|null} [detail]
 */
export async function reportClientReject(reason, detail) {
    const raw = String(reason || '');
    const code = CLIENT_REJECT_CODES.includes(raw) ? raw : 'PUNCH_CLIENT_REJECTED';
    return apiFetch('/attendance/portal/punch/client-reject', {
        method: 'POST',
        body: JSON.stringify({ reason: code, detail: sanitizeClientDetail(detail) }),
    });
}

/** البصمة الذاتية — الحكم كله على الخادم (شبكة/موقع/وجه/ربط جهاز). */
export async function punchPortal(payload = {}) {
    return apiFetch('/attendance/portal/punch', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

/** محرك v1: متجهات 128 — التسجيل لـ admin/hr فقط. */
export async function enrollFaceV1(targetUserId, descriptors) {
    return apiFetch('/attendance/portal/face/enroll', {
        method: 'POST',
        body: JSON.stringify({ targetUserId, descriptors }),
    });
}

/** محرك v2: 1-8 لقطات مقصوصة — السيرفر يستخرج المتجهات ولا يخزّن الصور. */
export async function enrollFaceV2(targetUserId, images) {
    return apiFetch('/attendance/portal/face/enroll-v2', {
        method: 'POST',
        body: JSON.stringify({ targetUserId, images }),
    });
}

/** إزالة القالبين معًا (v1 + v2) — admin/hr فقط. */
export async function removeFaceEnrollment(targetUserId) {
    return apiFetch(`/attendance/portal/face/enroll/${encodeURIComponent(String(targetUserId))}`, {
        method: 'DELETE',
    });
}

/**
 * معرّف جهاز مستقر (L4) — نفس مفتاح القديم فلا يُفكّ الربط عند تبديل الواجهة.
 * @param {{getItem: Function, setItem: Function}|null} [storage]
 * @returns {string}
 */
export function portalDeviceId(storage) {
    const store = storage !== undefined
        ? storage
        : (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
    let id = null;
    try { id = store ? store.getItem(DEVICE_ID_KEY) : null; } catch (_) { /* متجاهَل عمدًا */ }
    if (id) { return String(id); }
    const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    id = cryptoObj && typeof cryptoObj.randomUUID === 'function'
        ? cryptoObj.randomUUID()
        : `dev-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    try { if (store) { store.setItem(DEVICE_ID_KEY, id); } } catch (_) { /* متجاهَل عمدًا */ }
    return String(id);
}

/**
 * هل لقطة الوجه وحدها لا تكفي؟ (v1 فقط أو قالب v2 غائب)
 * مرآة مسار الخادم :320-383: v2 يعمل فقط لمن لديه قالب v2 نشط.
 * @param {{faceEnabled?: boolean, faceV2?: {enabled?: boolean, enrolled?: boolean}}|null} status
 */
export function faceV1Required(status) {
    const s = status || {};
    const v2 = s.faceV2 || {};
    const v2Handles = v2.enabled === true && v2.enrolled === true;
    return Boolean(s.faceEnabled) && !v2Handles;
}

/** نص نتيجة البصمة من قرار المحرك — نفس رسائل القديم. */
export function punchActionLabel(action) {
    if (action === 'check_in') { return '✅ تم تسجيل الحضور'; }
    if (action === 'check_out') { return '✅ تم تسجيل الانصراف'; }
    return '✅ تم تسجيل البصمة';
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
