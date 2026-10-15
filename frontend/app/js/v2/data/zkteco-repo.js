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
 *   attendance_devices columns (DB verified read-only 2026-10-14):
 *     id, name, ipAddress, port, commKey, enabled, syncIntervalSeconds,
 *     deviceUid, deviceName, firmware, platform, status, lastSyncAt,
 *     lastError, lastErrorAt, totalSynced, createdAt.
 *
 * DISPLAY ALLOWLIST — READ THIS BEFORE ADDING A COLUMN
 *   `commKey` is a device credential and arrives in every row
 *   (SELECT *). It is dropped here and must never be rendered — not
 *   hidden, not title-attr, nowhere. ipAddress is shown (LAN identifier,
 *   same as the legacy badge) but never combined with the key.
 *
 * WRITE DOORS (owner-approved wave 2): testDevice/syncDevice only —
 * harmless ping + routine pull. Device CRUD, import and mappings stay
 * legacy/other screens; this repo never adds another POST door.
 */

import { apiFetch } from '../../core/api.js?v=4.9.131';

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

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** Device-operation write gates mirror the server (routes.js:30-31):
 *  reads admin|hr|manager|accountant, device ops admin|hr. */
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
        port: d.port !== undefined && d.port !== null ? String(d.port) : '',
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

/* ── Device operations (wave 2 — explicit owner approval) ───────────────
 * Ping test (harmless) and pull sync (routine ops, blessed by the
 * attendance root-cause work). Saving guards + confirms live in the
 * screen; the server re-checks role and device state on each call. */

/** Ping a device — no state change. Returns the server's result verbatim. */
export async function testDevice(id) {
    return apiFetch(`/zkteco/devices/${encodeURIComponent(id)}/test`, { method: 'POST' });
}

/** Pull punches now — long hardware round-trips; the caller disables
 *  its button and says so. Returns { ok, message, read, inserted, ... }. */
export async function syncDevice(id) {
    return apiFetch(`/zkteco/devices/${encodeURIComponent(id)}/sync`, { method: 'POST' });
}
