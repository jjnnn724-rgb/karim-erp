/**
 * V2 — Sessions repository (البند ١٠)
 * ═══════════════════════════════════════════════════════════════════════
 * The only door to backend/cashier-module/session-routes.js. The screen asks
 * for rows and gets rows; nothing here invents a field the server did not
 * send.
 *
 * CONTRACT COPIED FROM THE SERVER:
 *   GET    /auth/sessions                → {ok, current_session_id, sessions:[…]}
 *   DELETE /auth/sessions/:id            → {ok, revoked, current, message}
 *   POST   /auth/sessions/revoke-others  → {ok, revoked, message}
 *
 * Every route is self-service: the server scopes all three by `req.user.id`,
 * so there is no user id in any payload here — sending one would suggest the
 * client could choose whose sessions to list.
 */

import { apiFetch } from '../../core/api.js?v=4.9.180';

/**
 * @returns {Promise<{currentSessionId: string|null, sessions: Array}>}
 */
export async function fetchSessions() {
    const body = await apiFetch('/auth/sessions', { method: 'GET' });
    const rows = Array.isArray(body && body.sessions) ? body.sessions : [];
    return {
        currentSessionId: (body && body.current_session_id) || null,
        sessions: rows.map(normalizeSession),
    };
}

/** Server row → what the table consumes. Missing values stay null, never '' 
 *  (an empty string would render as a real "just now" timestamp). */
export function normalizeSession(row = {}) {
    return {
        id: String(row.id || ''),
        current: row.current === true,
        device: String(row.device || 'جهاز غير معروف'),
        ip: row.ip || null,
        started_at: row.started_at || null,
        last_seen_at: row.last_seen_at || null,
        expires_at: row.expires_at || null,
    };
}

export async function revokeSession(sessionId) {
    return apiFetch(`/auth/sessions/${encodeURIComponent(String(sessionId))}`, { method: 'DELETE' });
}

export async function revokeOtherSessions() {
    return apiFetch('/auth/sessions/revoke-others', { method: 'POST' });
}

/** yyyy-mm-dd hh:mm in the browser's zone; '—' when absent. The server sends
 *  ISO-8601 and the column is Arabic, so date-only would hide "since when". */
export function formatMoment(iso) {
    if (!iso) {return '—';}
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {return '—';}
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
