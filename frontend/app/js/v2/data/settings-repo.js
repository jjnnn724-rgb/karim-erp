/**
 * V2 — Settings repository (الباب الوحيد لأبواب الإعدادات)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM features/settings-users.js (read fully), NOT INVENTED
 *   PUT /settings/main_settings {name,currency,logo,workStartHour,logoB64,
 *     hidden_nav_pages} — saveSettings :177 / saveNavVisibility :168 /
 *     logo :147 / resetLogo :157
 *   ZATCA (ZATCA_WRITE = admin/manager :196): GET+PUT /zatca/settings ·
 *     POST /zatca/toggle {enabled} · POST /zatca/test {api_base?} ·
 *     POST /zatca/csr · POST /zatca/csid {otp} · POST /zatca/csid/manual
 *     {csid,vat_number?|clear} · POST /zatca/apply-vat {vat_number} ·
 *     GET /zatca/queue?limit=20 · POST /zatca/queue/retry {scope}
 *   KOT (admin/manager :443): GET+PUT /pos/kot/settings
 *   Cards: GET+PUT /hr/card-settings {verifyBase,emergencyPhone}
 *   Punch admin: GET /attendance/portal/settings-admin ·
 *     GET /attendance/portal/attempts?limit&decision · PUT
 *     /attendance/portal/settings-admin (كامل الجسم :913-930 + إحداثيات
 *     capture :900) · GET /attendance/portal/face/list · DELETE
 *     /attendance/portal/face/enroll/:userId · GET
 *     /attendance/portal/punch-devices · DELETE .../punch-devices/:userId
 *   Backup (admin): GET /system/backups · POST /system/backup · POST
 *     /system/upload (multipart .sql وحده :546-548) · POST /system/restore
 *     {file,confirm:'RESTORE',restoreEnv}
 *   Danger: DELETE /state (تأكيدان :581) · POST /warehouse/system/reset-all
 *     {confirmation:'CONFIRM PRODUCTION RESET',reason 10+,force,scope:'full'}
 *
 * الاستثناء الوحيد للعميل الموحد: رفع ملف النسخة multipart — apiFetch
 * يفرض Content-Type: json فيبطل الـboundary، فالباب هنا fetch خام بنفس
 * ترويسة القديم (Authorization وحده) ولا شيء غيره.
 */

import { apiFetch } from '../../core/api.js?v=4.9.130';
import { fetchMainSettings } from './portal-repo.js?v=4.9.130';

export const SETTINGS_WRITE_ROLES = ['admin', 'manager'];
export const ZATCA_WRITE_ROLES = ['admin', 'manager'];
export const KOT_WRITE_ROLES = ['admin', 'manager'];

/* ── الرئيسية وظهور القوائم والشعار ───────────────────────────────────── */

export const fetchMainSettingsFull = () => fetchMainSettings();

export async function updateMainSettings(payload) {
    return apiFetch('/settings/main_settings', { method: 'PUT', body: JSON.stringify(payload) });
}

/* ── ZATCA ────────────────────────────────────────────────────────────── */

export async function fetchZatcaSettings() {
    return apiFetch('/zatca/settings');
}

export async function saveZatcaSettings(payload) {
    return apiFetch('/zatca/settings', { method: 'PUT', body: JSON.stringify(payload) });
}

export async function toggleZatca(enabled) {
    return apiFetch('/zatca/toggle', { method: 'POST', body: JSON.stringify({ enabled }) });
}

export async function testZatca(apiBase) {
    return apiFetch('/zatca/test', { method: 'POST', body: JSON.stringify(apiBase ? { api_base: apiBase } : {}) });
}

export async function generateCsr() {
    return apiFetch('/zatca/csr', { method: 'POST', body: JSON.stringify({}) });
}

export async function requestCsid(otp) {
    return apiFetch('/zatca/csid', { method: 'POST', body: JSON.stringify({ otp }) });
}

export async function saveCsidManual({ csid, vat_number, clear }) {
    if (clear) {
        return apiFetch('/zatca/csid/manual', { method: 'POST', body: JSON.stringify({ clear: true }) });
    }
    return apiFetch('/zatca/csid/manual', { method: 'POST', body: JSON.stringify({ csid, vat_number }) });
}

export async function applyVat(vat_number) {
    return apiFetch('/zatca/apply-vat', { method: 'POST', body: JSON.stringify({ vat_number }) });
}

export async function fetchZatcaQueue(limit = 20) {
    return apiFetch(`/zatca/queue?limit=${limit}`);
}

export async function retryZatcaQueue(scope) {
    return apiFetch('/zatca/queue/retry', { method: 'POST', body: JSON.stringify({ scope }) });
}

/* ── KOT ──────────────────────────────────────────────────────────────── */

export async function fetchKotSettings() {
    return apiFetch('/pos/kot/settings');
}

export async function saveKotSettings(payload) {
    return apiFetch('/pos/kot/settings', { method: 'PUT', body: JSON.stringify(payload) });
}

/* ── البطاقات ─────────────────────────────────────────────────────────── */

export async function fetchCardSettings() {
    return apiFetch('/hr/card-settings');
}

export async function saveCardSettings(payload) {
    return apiFetch('/hr/card-settings', { method: 'PUT', body: JSON.stringify(payload) });
}

/* ── البصمة الذاتية ───────────────────────────────────────────────────── */

export async function fetchPunchAdmin() {
    const [sRes, aRes] = await Promise.all([
        apiFetch('/attendance/portal/settings-admin'),
        apiFetch('/attendance/portal/attempts?limit=50'),
    ]);
    const settings = {};
    for (const r of (sRes.settings || [])) {settings[r.key] = r.value;}
    return { settings, attempts: aRes.attempts || [], summary: aRes.summary || null };
}

export async function fetchPunchAttempts(decision = '') {
    const res = await apiFetch(`/attendance/portal/attempts?limit=50${decision ? `&decision=${decision}` : ''}`);
    return { attempts: res.attempts || [], summary: res.summary || null };
}

export async function savePunchSettings(body) {
    return apiFetch('/attendance/portal/settings-admin', { method: 'PUT', body: JSON.stringify(body) });
}

export async function fetchPunchFaces() {
    const r = await apiFetch('/attendance/portal/face/list');
    return Array.isArray(r.faces) ? r.faces : [];
}

export async function removePunchFace(userId) {
    return apiFetch(`/attendance/portal/face/enroll/${userId}`, { method: 'DELETE' });
}

export async function fetchPunchDevices() {
    const r = await apiFetch('/attendance/portal/punch-devices');
    return Array.isArray(r.devices) ? r.devices : [];
}

export async function unbindPunchDevice(userId) {
    return apiFetch(`/attendance/portal/punch-devices/${userId}`, { method: 'DELETE' });
}

/* ── النسخ والاستعادة ─────────────────────────────────────────────────── */

export async function fetchBackups() {
    return apiFetch('/system/backups');
}

export async function doBackup() {
    return apiFetch('/system/backup', { method: 'POST' });
}

export async function uploadBackup(file) {
    const form = new FormData();
    form.append('file', file, file.name);
    const headers = {};
    if (typeof window !== 'undefined' && window._jwt) {headers['Authorization'] = `Bearer ${window._jwt}`;}
    const res = await fetch(`${window.location.origin}/api/system/upload`, { method: 'POST', headers, body: form });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {throw new Error(d.message || d.error || 'فشل الرفع');}
    return d;
}

export async function restoreBackup({ file, restoreEnv }) {
    return apiFetch('/system/restore', {
        method: 'POST', body: JSON.stringify({ file, confirm: 'RESTORE', restoreEnv: !!restoreEnv }),
    });
}

/* ── التصدير والتصفير ─────────────────────────────────────────────────── */

export async function resetAllData() {
    return apiFetch('/state', { method: 'DELETE' });
}

export async function operationalReset({ confirmation, reason, force }) {
    return apiFetch('/warehouse/system/reset-all', {
        method: 'POST', body: JSON.stringify({ confirmation, reason, force, scope: 'full' }),
    });
}

/* ── التحكم بالسيرفر (مدير فقط — بروكسي محروس إلى الخدمة المرافقة) ────── */

export async function fetchServerControl() {
    return apiFetch('/server-control/status');
}

export async function serverControlAction(action, confirm = '') {
    return apiFetch('/server-control/actions', {
        method: 'POST', body: JSON.stringify({ action, confirm }),
    });
}
