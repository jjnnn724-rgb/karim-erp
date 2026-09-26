/** rate-limit.js — In-memory token-bucket rate limiter (per-Node-replica). */
const MAP = new Map();

function rateLimit({ windowMs, max, keyFn }) {
    return (req, res, next) => {
        const key = keyFn ? keyFn(req) : (req.ip || 'unknown');
        const now = Date.now();
        let bucket = MAP.get(key);
        if (!bucket) { bucket = { tokens: max, lastRefill: now }; MAP.set(key, bucket); }
        const refillRate = windowMs / max;
        const elapsed = now - bucket.lastRefill;
        const refilled = Math.floor(elapsed / refillRate);
        if (refilled > 0) { bucket.tokens = Math.min(max, bucket.tokens + refilled); bucket.lastRefill = now; }
        if (bucket.tokens <= 0) {
            const retryAfter = Math.ceil((windowMs - elapsed) / 1000);
            res.setHeader('Retry-After', retryAfter);
            return res.status(429).json({ error: 'RATE_LIMITED', message: `Retry in ${retryAfter}s.`, retry_after_seconds: retryAfter });
        }
        bucket.tokens -= 1;
        next();
    };
}

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of MAP.entries()) {if (now - v.lastRefill > 10 * 60 * 1000) {MAP.delete(k);}}
}, 60_000).unref();

module.exports = { rateLimit };
