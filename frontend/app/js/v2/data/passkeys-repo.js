/**
 * V2 — Passkeys repository (مفاتيح المرور)
 * ═══════════════════════════════════════════════════════════════════════
 * The only door to backend/cashier-module/webauthn-routes.js. Options come
 * from the server, the browser signs them, and the response goes back
 * verbatim — nothing here invents a challenge, a credential id, or a label.
 *
 *   GET  /auth/webauthn/status                      → الأجهزة المسجّلة (بلا مفاتيح)
 *   POST /auth/webauthn/register/options  {password, device_label}
 *   POST /auth/webauthn/register/verify   {response, device_label}
 *   POST /auth/webauthn/credentials/:id/remove {password}
 *
 * WHY RAW POST FOR THE PASSWORD-BEARING CALLS
 *   A wrong password answers 401. apiFetch's 401 path clears the refresh
 *   token and logs the user out (core/api.js:44-49) — a mistyped password
 *   must not end a healthy session. Same reasoning as the login screen.
 *
 * THE PASSWORD IS NEVER STORED
 *   It travels in one request body and lives in the caller's local variable.
 *   Nothing here logs, caches, or echoes it.
 */

import { API_BASE, apiFetch, SERVER_CODE_AR } from '../../core/api.js?v=4.9.156';
import {
    isWebAuthnSupported,
    passkeyUnavailableReason,
    platformAuthenticatorAvailable,
    toCreationOptions,
    serializeRegistration,
    describeWebAuthnError,
} from './webauthn-client.js?v=4.9.156';

const REQUEST_TIMEOUT_MS = 30000;

function messageOf(data, fallback) {
    if (data && typeof data === 'object') {
        if (typeof data.message === 'string' && data.message.trim()) {return data.message.trim();}
        if (typeof data.error === 'string' && SERVER_CODE_AR[data.error]) {return SERVER_CODE_AR[data.error];}
    }
    return fallback;
}

function authHeaders() {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (window._jwt) {headers.Authorization = `Bearer ${window._jwt}`;}
    if (window._appKey) {headers['x-api-key'] = window._appKey;}
    return headers;
}

async function postWithoutLogout(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${API_BASE}${path}`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(body || {}),
            signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(messageOf(data, `فشل الطلب (${res.status})`));
            if (data && typeof data.error === 'string') {err.code = data.error;}
            err.status = res.status;
            throw err;
        }
        return data;
    } catch (err) {
        if (err && err.name === 'AbortError') {
            throw new Error('انتهت مهلة الاتصال بالخادم — حاول مجددًا', { cause: err });
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

export function normalizeCredential(row = {}) {
    return {
        id: Number(row.id),
        label: String(row.label || 'جهاز مسجّل'),
        backed_up: row.backed_up === true,
        created_at: row.created_at || null,
        last_used_at: row.last_used_at || null,
    };
}

export async function fetchPasskeys() {
    const body = await apiFetch('/auth/webauthn/status', { method: 'GET' });
    return {
        enabled: Boolean(body && body.enabled),
        count: Number(body && body.count) || 0,
        max: Number(body && body.max) || 0,
        credentials: Array.isArray(body && body.credentials)
            ? body.credentials.map(normalizeCredential).filter((row) => Number.isInteger(row.id) && row.id > 0)
            : [],
    };
}

export function passkeySupport() {
    const reason = passkeyUnavailableReason();
    return {
        supported: !reason,
        reason,
        webauthn: isWebAuthnSupported(),
    };
}

export function hasPlatformAuthenticator() {
    return platformAuthenticatorAvailable();
}

/** تسمية مقترحة من بصمة المتصفح — لا تُرسل إلا إذا أكّدها المستخدم. */
export function defaultDeviceLabel(userAgent = (typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
    const ua = String(userAgent || '');
    const os = /iPhone/.test(ua) ? 'iPhone'
        : /iPad/.test(ua) ? 'iPad'
            : /Android/.test(ua) ? 'Android'
                : /Windows/.test(ua) ? 'Windows'
                    : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : '';
    const browser = /Edg\//.test(ua) ? 'Edge'
        : /Chrome\//.test(ua) ? 'Chrome'
            : /Firefox\//.test(ua) ? 'Firefox'
                : /Safari\//.test(ua) ? 'Safari' : '';
    return [os, browser].filter(Boolean).join(' · ') || 'جهاز مسجّل';
}

/**
 * @param {{password: string, deviceLabel?: string}} input
 * @returns {Promise<{ok: boolean, message?: string}>}
 */
export async function registerPasskey({ password, deviceLabel } = {}) {
    const reason = passkeyUnavailableReason();
    if (reason) {throw new Error(reason);}
    const label = String(deviceLabel || '').trim();
    const start = await postWithoutLogout('/auth/webauthn/register/options', {
        password: String(password || ''),
        device_label: label,
    });
    if (!start || !start.options) {throw new Error('تعذّر بدء تسجيل الجهاز — حاول مجددًا.');}

    let credential;
    try {
        credential = await navigator.credentials.create({ publicKey: toCreationOptions(start.options) });
    } catch (err) {
        throw new Error(describeWebAuthnError(err), { cause: err });
    }
    if (!credential) {throw new Error('لم يكتمل تسجيل الجهاز — أعد المحاولة.');}

    return postWithoutLogout('/auth/webauthn/register/verify', {
        response: serializeRegistration(credential),
        device_label: String(start.device_label || label),
    });
}

export async function removePasskey(id, password) {
    const safeId = encodeURIComponent(String(id));
    return postWithoutLogout(`/auth/webauthn/credentials/${safeId}/remove`, {
        password: String(password || ''),
    });
}
