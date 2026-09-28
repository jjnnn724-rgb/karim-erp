'use strict';

/**
 * api-cache.js — Shared GET response cache (extracted from server.js, no logic change).
 * ────────────────────────────────────────────────────────────────────────────
 * Key = session (Authorization header) + URL: one user's authorized response
 * is never served to another. TTL 10s, capped size.
 * invalidateAll() is called after permission changes so revokes apply instantly.
 */

const _apiCache = new Map();
const API_CACHE_TTL = 10_000;
const API_CACHE_MAX = 2000;

function apiCacheMiddleware(req, res, next) {
    if (req.method !== 'GET') { return next(); }
    // /api/state is live client state (polls for freshness) AND carries its
    // own rate limiter: serving it from cache would both show stale data and
    // bypass generalLimiter (route middleware never runs on a cache HIT).
    if (req.path === '/api/state' || req.path === '/state') { return next(); }
    const key = `${req.headers.authorization || ''}|${req.originalUrl}`;
    const cached = _apiCache.get(key);
    if (cached && Date.now() - cached.ts < API_CACHE_TTL) {
        res.set('X-Cache', 'HIT');
        return res.json(cached.data);
    }
    const origJson = res.json.bind(res);
    res.json = (data) => {
        // Cache ONLY successful 2xx responses — caching a 503/500 (e.g. a
        // transient health DB blip, which carries no `.error` field) would
        // replay failures for the whole TTL and poison every client.
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        if (ok && data && !data.error) {
            if (_apiCache.size >= API_CACHE_MAX) {_apiCache.clear();}
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
