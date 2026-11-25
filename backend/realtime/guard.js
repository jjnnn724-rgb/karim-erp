'use strict';

/**
 * realtime/guard.js — socket handshake auth + per-socket rate limits (TASK 4).
 * ────────────────────────────────────────────────────────────────────────────
 * Coexistence design: anonymous sockets still connect (pre-login screens),
 * but an `erp:authed` room marks sockets whose JWT verified. Sensitive
 * broadcasts are auth-gated BY DEFAULT (RT_REQUIRE_AUTH defaults true).
 * Legacy/local-dev global broadcasts require an explicit RT_REQUIRE_AUTH=false.
 */

function isRtAuthRequired() {
    const raw = process.env.RT_REQUIRE_AUTH;
    // Secure default: omitted/empty means auth is required. Opt-out is explicit.
    if (raw === undefined || raw === null || String(raw).trim() === '') {return true;}
    return String(raw).trim().toLowerCase() === 'true';
}

/**
 * Resolve handshake identity WITHOUT trusting client claims.
 * Returns { id, role, name, dept_code } or null (anonymous).
 * verifyFn = verifyAccessToken from jwt-middleware (injected for testability).
 */
function resolveHandshakeUser(verifyFn, handshake = {}) {
    try {
        const token = handshake.auth?.token || handshake.query?.token || null;
        if (!token || typeof verifyFn !== 'function') {return null;}
        const p = verifyFn(token);
        const id = parseInt(p?.sub, 10);
        if (!Number.isInteger(id) || id <= 0 || !p?.role) {return null;}
        return { id, role: p.role, name: p.name || null, dept_code: p.dept_code || null };
    } catch (_) {
        return null;
    }
}

/** Sliding-window per-socket per-event limiter. Returns true if allowed. */
function createSocketLimiter({ now = Date.now } = {}) {
    const hits = new Map(); // `${socketId}:${event}` -> { count, resetAt }
    function check(socketId, event, maxPerMin) {
        const t = now();
        const k = `${socketId}:${event}`;
        let e = hits.get(k);
        if (!e || t >= e.resetAt) {
            e = { count: 0, resetAt: t + 60000 };
            hits.set(k, e);
        }
        e.count += 1;
        if (hits.size > 20000) {
            for (const [key, v] of hits) {
                if (v.resetAt <= t) {hits.delete(key);}
                if (hits.size <= 15000) {break;}
            }
        }
        return e.count <= maxPerMin;
    }
    function reset(socketId) {
        for (const k of [...hits.keys()]) {
            if (k.startsWith(`${socketId}:`)) {hits.delete(k);}
        }
    }
    return { check, reset };
}

// Default budgets (events/min/socket)
const SOCKET_EVENT_BUDGETS = {
    register_user: 10,
    broadcast_notification: 5,
    ping_check: 30,
    request_sync: 10,
};

module.exports = { isRtAuthRequired, resolveHandshakeUser, createSocketLimiter, SOCKET_EVENT_BUDGETS };
