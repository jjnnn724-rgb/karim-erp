'use strict';

/**
 * api-cache.js — Shared GET response cache (extracted from server.js, no logic change).
 * ────────────────────────────────────────────────────────────────────────────
 * Key = session (Authorization header) + URL: one user's authorized response
 * is never served to another. TTL 10s, capped size.
 * invalidateAll() is called after permission changes so revokes apply instantly.
 */

const _apiCache = new Map();
// PERF-4: TTL bumped 10s → 30s (expensive reports recompute ~6×/min at 10s)
const API_CACHE_TTL = 30_000;
const API_CACHE_MAX = 2000;

function apiCacheMiddleware(req, res, next) {
    if (req.method !== 'GET') { return next(); }
    if (req.path === '/api/state' || req.path === '/state') { return next(); }
    if (req.path.startsWith('/api/users/') && req.path.endsWith('/password')) { return next(); }
    const key = `${req.headers.authorization || ''}|${req.originalUrl}`;
    const cached = _apiCache.get(key);
    if (cached && Date.now() - cached.ts < API_CACHE_TTL) {
        // LRU touch: re-insert so Map iteration order tracks recency
        _apiCache.delete(key);
        _apiCache.set(key, cached);
        res.set('X-Cache', 'HIT');
        return res.json(cached.data);
    }
    const origJson = res.json.bind(res);
    res.json = (data) => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        if (ok && data && !data.error) {
            // LRU eviction: delete oldest entry instead of full clear
            // (full clear causes cache stampede — all clients re-hit DB at once)
            if (_apiCache.size >= API_CACHE_MAX) {
                const firstKey = _apiCache.keys().next().value;
                if (firstKey !== undefined) { _apiCache.delete(firstKey); }
            }
            _apiCache.set(key, { data, ts: Date.now() });
        }
        else { _apiCache.delete(key); }
        res.set('X-Cache', 'MISS');
        return origJson(data);
    };
    next();
}

function invalidateAll() {
    _apiCache.clear();
}

module.exports = { apiCacheMiddleware, invalidateAll, API_CACHE_TTL };
