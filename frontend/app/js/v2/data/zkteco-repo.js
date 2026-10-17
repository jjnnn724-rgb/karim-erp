/**
 * V2 — Fingerprint devices repository (الباب الوحيد إلى /api/zkteco/*)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET /zkteco/status → { running, devices[], totals } (routes.js:91-130 ·
 *     read gate admin|hr|manager|accountant, same file :30). Server-cached
 *     20s (:89-90, :93-95) — figures may lag the live engine by seconds.
 *   GET /zkteco/devices → ARRAY of deviceStatusView rows (routes.js:133-143):
 *     full attendance_devices row + live{syncing,lastAttemptAt,
 *     lastResultAt,lastError,consecutiveFailures} (or null).
 *   GET /zkteco/mappings → { employees[], unmapped[] } (:360-381).
 *   GET /zkteco/logs?limit= → raw punch rows (:453-480, max 500).
 *   GET /zkteco/logs/export?from&to → text/csv attachment (:482-520).
 *   GET /zkteco/coverage?days= → { summary, problems[], ok[] } (:592-…).
 *   POST /zkteco/scan → { subnets, port, found[] } (:745-…).
 *   attendance_devices columns (DB verified read-only 2026-10-14):
 *     id, name, ipAddress, port, commKey, enabled, syncIntervalSeconds,
 *     deviceUid, deviceName, firmware, platform, status, lastSyncAt,
 *     lastError, lastErrorAt, totalSynced, createdAt.
 *
 * DISPLAY ALLOWLIST — READ THIS BEFORE ADDING A COLUMN
 *   `commKey` is a device credential and arrives in every row
 *   (SELECT *). It is dropped here and must never be rendered — not
 *   hidden, not title-attr, nowhere. ipAddress is shown (LAN identifier,
 *   same as the legacy badge) but never combined with the key. The edit
 *   form sends a new key only when the operator types one; a blank field
 *   means "leave the stored key alone".
 *
 * WRITE DOORS (owner-approved wave 2, completed in P2-2): ping test, pull
 *   sync, device create/update/delete (enable is a partial update), network
 *   scan, employee mapping (manual/automatic) and device-user import. Every
 *   caller still needs the role gate AND the independent `v2zkwrite` flag;
 *   the server re-checks role and payload on each call.
 *
 * CSV EXPORT
 *   `downloadZkLogsCsv` must read a binary body, so it cannot use the JSON
 *   `apiFetch` client. It stays here — the only place allowed to touch the
 *   network — and returns a Blob; the screen only saves it.
 */

import { apiFetch, API_BASE } from '../../core/api.js?v=4.9.154';

/** @returns {Promise<{running:boolean,devices:any[],totals:object}>} */
export async function fetchZkStatus() {
    const res = await apiFetch('/zkteco/status');
    const o = res && typeof res === 'object' ? res : {};
    return {
        running: !!o.running,
        devices: Array.isArray(o.devices) ? o.devices : [],
        totals: o.totals && typeof o.totals === 'object' ? o.totals : {},
    };
}

/** @returns {Promise<any[]>} deviceStatusView rows (bare array or {data}) */
export async function fetchZkDevices() {
    const res = await apiFetch('/zkteco/devices');
    if (Array.isArray(res)) {return res;}
    if (res && Array.isArray(res.data)) {return res.data;}
    return [];
}

/** @returns {Promise<{employees:any[], unmapped:any[]}>} */
export async function fetchZkMappings() {
    const res = await apiFetch('/zkteco/mappings');
    const o = res && typeof res === 'object' ? res : {};
    return {
        employees: Array.isArray(o.employees) ? o.employees : [],
        unmapped: Array.isArray(o.unmapped) ? o.unmapped : [],
    };
}

/** @returns {Promise<any[]>} newest raw punches (server clamps 1..500) */
export async function fetchZkLogs(limit = 200) {
    const n = Math.min(500, Math.max(1, Math.round(Number(limit) || 100)));
    const res = await apiFetch(`/zkteco/logs?limit=${n}`);
    if (Array.isArray(res)) {return res;}
    if (res && Array.isArray(res.data)) {return res.data;}
    return [];
}

/** @returns {Promise<object>} coverage payload; missing arrays normalized. */
export async function fetchZkCoverage(days = 7) {
    const d = Math.min(90, Math.max(1, Math.round(Number(days) || 7)));
    const res = await apiFetch(`/zkteco/coverage?days=${d}`);
    const o = res && typeof res === 'object' ? res : {};
    return {
        ...o,
        summary: o.summary && typeof o.summary === 'object' ? o.summary : {},
        problems: Array.isArray(o.problems) ? o.problems : [],
        ok: Array.isArray(o.ok) ? o.ok : [],
        unmapped_device_users: Array.isArray(o.unmapped_device_users) ? o.unmapped_device_users : [],
    };
}

/** Stored device users (names + linked employee) — fast, no device round-trip. */
export async function fetchStoredDeviceUsers(deviceId) {
    const res = await apiFetch(`/zkteco/devices/${encodeURIComponent(deviceId)}/stored-users`);
    return res && Array.isArray(res.users) ? res.users : [];
}

/** Live device users — a hardware round-trip (import fallback only). */
export async function fetchLiveDeviceUsers(deviceId) {
    const res = await apiFetch(`/zkteco/devices/${encodeURIComponent(deviceId)}/users`);
    return res && Array.isArray(res.users) ? res.users : [];
}

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** Device-operation write gates mirror the server (routes.js:30-31):
 *  reads admin|hr|manager|accountant, every write admin|hr. */
export const ZK_WRITE_ROLES = ['admin', 'hr'];

/**
 * Database row → table row. commKey NEVER leaves this function.
 * Pure and exported so it is testable without a browser.
 */
export function deviceToRow(d = {}) {
    const status = d.status !== undefined && d.status !== null ? String(d.status) : '';
    const enabled = !(d.enabled === false || d.enabled === 'false' || d.enabled === 0);
    const live = d.live && typeof d.live === 'object' ? d.live : null;
    return {
        id: d.id,
        name: d.name ? String(d.name) : `#${d.id ?? '؟'}`,
        nameResolved: !!d.name,
        ip: d.ipAddress ? String(d.ipAddress) : '',
        ipAddress: d.ipAddress ? String(d.ipAddress) : '',
        port: d.port !== undefined && d.port !== null ? String(d.port) : '',
        syncIntervalSeconds: d.syncIntervalSeconds !== undefined && d.syncIntervalSeconds !== null
            ? num(d.syncIntervalSeconds) : 30,
        firmware: d.firmware ? String(d.firmware) : '',
        status,
        enabled,
        lastSyncAt: d.lastSyncAt ? String(d.lastSyncAt) : '',
        lastError: d.lastError ? String(d.lastError) : (live && live.lastError ? String(live.lastError) : ''),
        totalSynced: Math.round(num(d.totalSynced)),
        syncing: !!(live && live.syncing),
        failures: live ? Math.round(num(live.consecutiveFailures)) : 0,
    };
}

/** Derived counts for the summary line — never fetched. */
export function summarizeDevices(rows = []) {
    const counts = { total: rows.length, online: 0, enabled: 0, syncing: 0 };
    for (const r of rows) {
        if (r.status === 'online') {counts.online += 1;}
        if (r.enabled) {counts.enabled += 1;}
        if (r.syncing) {counts.syncing += 1;}
    }
    return counts;
}

/* ── Device operations (wave 2 — explicit owner approval) ─────────────── */

/** Ping a device — no state change. Returns the server's result verbatim. */
export async function testDevice(id) {
    return apiFetch(`/zkteco/devices/${encodeURIComponent(id)}/test`, { method: 'POST' });
}

/** Pull punches now — long hardware round-trips; the caller disables
 *  its button and says so. Returns { ok, message, read, inserted, ... }. */
export async function syncDevice(id) {
    return apiFetch(`/zkteco/devices/${encodeURIComponent(id)}/sync`, { method: 'POST' });
}

/* ── P2-2 — device CRUD + discovery ───────────────────────────────────── */

export async function createDevice(payload) {
    return apiFetch('/zkteco/devices', { method: 'POST', body: JSON.stringify(payload || {}) });
}

/** Partial update — the server writes only the keys present. */
export async function updateDevice(id, patch) {
    return apiFetch(`/zkteco/devices/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(patch || {}),
    });
}

export async function deleteDevice(id) {
    return apiFetch(`/zkteco/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** POST /zkteco/scan — scans the server's local subnets; can take seconds. */
export async function scanNetwork(payload = {}) {
    const res = await apiFetch('/zkteco/scan', { method: 'POST', body: JSON.stringify(payload || {}) });
    const o = res && typeof res === 'object' ? res : {};
    return {
        subnets: Array.isArray(o.subnets) ? o.subnets : [],
        port: o.port,
        found: Array.isArray(o.found) ? o.found : [],
        message: o.message ? String(o.message) : '',
    };
}

/* ── P2-2 — employee mapping + device-user import ─────────────────────── */

/** Assign (or clear, with an empty value) an employee's device number. */
export async function saveMapping(employeeId, deviceUserId) {
    const raw = deviceUserId == null ? '' : String(deviceUserId).trim();
    return apiFetch(`/zkteco/mappings/${encodeURIComponent(employeeId)}`, {
        method: 'PUT',
        body: JSON.stringify({ deviceUserId: raw || null }),
    });
}

/** Link every unlinked employee whose employee number is free. */
export async function autoLinkMappings() {
    return apiFetch('/zkteco/mappings/auto', { method: 'POST', body: JSON.stringify({}) });
}

/** Create employees from device users (employee number = device user id). */
export async function importDeviceUsers(deviceId, userIds, department = '') {
    return apiFetch(`/zkteco/devices/${encodeURIComponent(deviceId)}/import-users`, {
        method: 'POST',
        body: JSON.stringify({
            userIds: Array.isArray(userIds) ? userIds : [],
            department: String(department || '').trim(),
        }),
    });
}

/* ── Pure view helpers (testable without a browser) ───────────────────── */

/** Mapping summary derived from one /mappings payload — zero requests. */
export function mappingStats(m = {}) {
    const employees = Array.isArray(m.employees) ? m.employees : [];
    const linked = employees.filter((e) => String(e.deviceUserId ?? '').trim() !== '').length;
    return {
        employees: employees.length,
        linked,
        unlinked: employees.length - linked,
        unmapped: Array.isArray(m.unmapped) ? m.unmapped.length : 0,
    };
}

/** Coverage summary with numeric fields; unknown values stay 0, never NaN. */
export function coverageStats(cov = {}) {
    const s = cov.summary && typeof cov.summary === 'object' ? cov.summary : {};
    return {
        total: num(s.total_employees),
        ok: num(s.ok),
        problems: num(s.problems),
        face: num(s.face_enrolled),
        unmapped: num(s.unmapped_device_users),
    };
}

export const ZK_PUNCH_STATES = ['حضور', 'انصراف', 'خروج استراحة', 'عودة استراحة', 'دخول أوفر تايم', 'خروج أوفر تايم'];

export function punchStateName(state) {
    const n = Number(state);
    return Number.isInteger(n) && ZK_PUNCH_STATES[n] ? ZK_PUNCH_STATES[n] : `حالة ${state}`;
}

const VERIFY_TYPES = { 1: 'بصمة', 2: 'بطاقة', 15: 'وجه' };

export function verifyTypeName(type) {
    return VERIFY_TYPES[Number(type)] || 'أخرى';
}

/**
 * Client mirror of `validateDevicePayload` (routes.js:47-77). Validation is
 * repeated on the server; this copy only stops a pointless round-trip.
 * `partial` skips absent keys (edit form sends only what its mode owns).
 * @returns {{errors:{field:string,message:string}[], value:object}}
 */
export function validateDeviceForm(raw = {}, { partial = false } = {}) {
    const errors = [];
    const value = {};
    const has = (k) => raw[k] !== undefined && raw[k] !== null && String(raw[k]).trim() !== '';
    if (!partial || raw.name !== undefined) {
        const name = String(raw.name ?? '').trim();
        if (!name || name.length > 100) {errors.push({ field: 'name', message: 'اسم الجهاز مطلوب (حتى 100 حرف)' });}
        else {value.name = name;}
    }
    if (!partial || raw.ipAddress !== undefined) {
        const ip = String(raw.ipAddress ?? '').trim();
        const valid = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every((o) => Number(o) <= 255);
        if (!valid) {errors.push({ field: 'ipAddress', message: 'عنوان IP غير صالح (مثال: 192.168.1.201)' });}
        else {value.ipAddress = ip;}
    }
    if (raw.port !== undefined && has('port')) {
        const port = Number(raw.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {errors.push({ field: 'port', message: 'المنفذ غير صالح' });}
        else {value.port = port;}
    } else if (partial && raw.port !== undefined) {
        value.port = 4370;
    }
    if (has('commKey')) {
        const key = Number(raw.commKey);
        if (!Number.isInteger(key) || key < 0 || key > 65535) {
            errors.push({ field: 'commKey', message: 'مفتاح الاتصال بين 0 و 65535' });
        } else {value.commKey = key;}
    }
    if (raw.enabled !== undefined) {value.enabled = Boolean(raw.enabled);}
    if (raw.syncIntervalSeconds !== undefined && has('syncIntervalSeconds')) {
        const s = Number(raw.syncIntervalSeconds);
        if (!Number.isInteger(s) || s < 5 || s > 86400) {
            errors.push({ field: 'syncIntervalSeconds', message: 'فترة المزامنة بين 5 و 86400 ثانية' });
        } else {value.syncIntervalSeconds = s;}
    } else if (partial && raw.syncIntervalSeconds !== undefined) {
        value.syncIntervalSeconds = 30;
    }
    return { errors, value };
}

/**
 * Download the raw-punch CSV. The endpoint answers text/csv, so this is the
 * one repo function that cannot go through apiFetch (which parses JSON).
 * Network stays here; the screen only saves the returned Blob.
 * @returns {Promise<{blob:Blob, filename:string}>}
 */
export async function downloadZkLogsCsv({ from = '', to = '' } = {}) {
    const q = new URLSearchParams();
    if (from) {q.set('from', from);}
    if (to) {q.set('to', to);}
    const headers = {};
    if (typeof window !== 'undefined') {
        if (window._jwt) {headers.Authorization = 'Bearer ' + window._jwt;}
        if (window._appKey) {headers['x-api-key'] = window._appKey;}
    }
    const query = q.toString();
    const res = await fetch(`${API_BASE}/zkteco/logs/export${query ? `?${query}` : ''}`, { headers });
    if (!res.ok) {
        let message = `فشل التصدير (${res.status})`;
        try {
            const body = await res.json();
            if (body && body.message) {message = body.message;}
        } catch (_) { /* not JSON — keep the status message */ }
        throw new Error(message);
    }
    return {
        blob: await res.blob(),
        filename: `fingerprints-${from || 'all'}_${to || 'all'}.csv`,
    };
}
