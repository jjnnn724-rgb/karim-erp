/**
 * rate-limiter.js — Flexible Rate Limiting Middleware
 * ────────────────────────────────────────────────────────────────────────────
 * Provides in-memory and Redis-backed rate limiting for Express routes.
 * 
 * Features:
 * - In-memory store (default, works for single-instance)
 * - Redis store (optional, for multi-instance deployment)
 * - Per-IP and per-user rate limiting
 * - Configurable windows and limits per route
 * - Standard rate limit headers (X-RateLimit-*)
 * - JSON error responses with retry-after
 */
const { logger } = require('./logger');

// ─── In-Memory Store (Default) ──────────────────────────
class MemoryStore {
    constructor() {
        this.requests = new Map();
        // Cleanup old entries every 5 minutes to prevent memory leaks.
        // `unref()` keeps this maintenance timer from holding Jest or a
        // short-lived CLI process open during graceful shutdown.
        this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
        if (typeof this.cleanupTimer.unref === 'function') {this.cleanupTimer.unref();}
    }

    increment(key, windowMs) {
        const now = Date.now();
        
        let entry = this.requests.get(key);
        
        // Create or reset if window expired
        if (!entry || entry.resetTime < now) {
            entry = {
                count: 1,
                resetTime: now + windowMs,
            };
            this.requests.set(key, entry);
            return { count: 1, resetTime: entry.resetTime };
        }
        
        // Increment existing
        entry.count++;
        return { count: entry.count, resetTime: entry.resetTime };
    }

    decrement(key, windowMs) {
        const now = Date.now();
        const entry = this.requests.get(key);
        if (!entry) {
            return { count: 0, resetTime: now + windowMs };
        }
        if (entry.count <= 1) {
            this.requests.delete(key);
            return { count: 0, resetTime: now + windowMs };
        }
        entry.count = Math.max(0, entry.count - 1);
        return { count: entry.count, resetTime: entry.resetTime };
    }

    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.requests.entries()) {
            if (entry.resetTime < now) {
                this.requests.delete(key);
            }
        }
    }

    // For testing: get current state
    getState(key) {
        return this.requests.get(key) || null;
    }

    reset(key) {
        this.requests.delete(key);
    }
}

// ─── Redis Store (Optional) ──────────────────────────────
class RedisStore {
    constructor(redisClient) {
        if (!redisClient) {
            throw new Error('Redis client is required for RedisStore');
        }
        this.redis = redisClient;
        this.prefix = 'ratelimit:';
    }

    async increment(key, windowMs) {
        const redisKey = this.prefix + key;
        const windowSec = Math.ceil(windowMs / 1000);
        
        try {
            // Use Redis INCR with expiry for atomic operations
            const multi = this.redis.multi();
            multi.incr(redisKey);
            multi.expire(redisKey, windowSec);
            
            const results = await multi.exec();
            const count = results[0][1]; // INCR result
            
            // Get TTL for reset time
            const ttl = await this.redis.ttl(redisKey);
            const resetTime = Date.now() + (ttl * 1000);
            
            return { count, resetTime };
        } catch (err) {
            logger.error('[rate-limiter] Redis error, falling back to in-memory:', err.message);
            // Fallback to in-memory on Redis failure
            return memoryStore.increment(key, windowMs);
        }
    }

    async decrement(key, windowMs) {
        const redisKey = this.prefix + key;
        try {
            const value = await this.redis.decr(redisKey);
            if (value <= 0) {
                await this.redis.del(redisKey);
            }
            return { count: Math.max(0, value), resetTime: Date.now() + windowMs };
        } catch (err) {
            logger.error('[rate-limiter] Redis decrement failed:', err.message);
            return memoryStore.decrement(key, windowMs);
        }
    }
}

// ─── Global In-Memory Instance ────────────────────────────
const memoryStore = new MemoryStore();

/**
 * Env-overridable limits — الضبط دون إعادة بناء:
 * في ساعات الذروة قد يرفع المالك الحدود من ملف البيئة فقط
 * (RATE_LIMIT_GENERAL_MAX / RATE_LIMIT_AUTH_MAX / RATE_LIMIT_STATE_MAX / RATE_LIMIT_CRUD_MAX)
 */
const envMax = (name, fallback) => {
    const v = parseInt(process.env[name], 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
};

// ─── Rate Limiter Configuration ──────────────────────────
const DEFAULT_CONFIGS = {
    // General API limits
    general: {
        windowMs: 60 * 1000,      // 1 minute
        maxRequests: envMax('RATE_LIMIT_GENERAL_MAX', 100), // 100 requests per minute
        message: 'Too many requests, please slow down',
    },

    // Strict limits for auth endpoints
    auth: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: envMax('RATE_LIMIT_AUTH_MAX', 10),     // 10 login attempts per 15 min
        message: 'Too many login attempts, please try again later',
    },

    // State sync limits (prevent abuse)
    state: {
        windowMs: 60 * 1000,      // 1 minute
        maxRequests: envMax('RATE_LIMIT_STATE_MAX', 30),    // 30 state saves per minute
        message: 'State sync rate limit exceeded',
    },

    // CRUD operation limits
    crud: {
        windowMs: 60 * 1000,      // 1 minute
        maxRequests: envMax('RATE_LIMIT_CRUD_MAX', 200),    // 200 CRUD ops per minute
        message: 'API rate limit exceeded',
    },
};

/**
 * Create a rate limiter middleware factory.
 * 
 * @param {Object} options - Configuration options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.maxRequests - Max requests allowed in window
 * @param {string} options.message - Error message when limited
 * @param {string} options.keyGenerator - Function(req) to generate unique key
 * @param {Object} options.redisClient - Optional Redis client for distributed limiting
 * @returns {Function} Express middleware function
 */
function createRateLimiter(options = {}) {
    const {
        windowMs = DEFAULT_CONFIGS.general.windowMs,
        maxRequests = DEFAULT_CONFIGS.general.maxRequests,
        message = DEFAULT_CONFIGS.general.message,
        keyGenerator = defaultKeyGenerator,
        redisClient = null,
        skipFailedRequests = false, // Count ALL requests including failed (brute-force protection)
        skipSuccessfulRequests = false,
    } = options;

    // Choose store implementation
    const store = redisClient ? new RedisStore(redisClient) : memoryStore;

    return async function rateLimiterMiddleware(req, res, next) {
        try {
            // Generate unique key for this request
            const key = keyGenerator(req);
            
            // Increment counter
            const result = await store.increment(key, windowMs);
            const { count, resetTime } = result;

            res.once('finish', () => {
                try {
                    if ((skipFailedRequests && res.statusCode >= 400) || (skipSuccessfulRequests && res.statusCode < 400)) {
                        Promise.resolve(store.decrement(key, windowMs)).catch(() => {});
                    }
                } catch (_) {}
            });
            
            // Set rate limit headers on every response
            res.set({
                'X-RateLimit-Limit': maxRequests,
                'X-RateLimit-Remaining': Math.max(0, maxRequests - count),
                'X-RateLimit-Reset': Math.ceil(resetTime / 1000),
            });
            
            // Check if limit exceeded
            if (count > maxRequests) {
                // Set retry-after header
                const retryAfterSeconds = Math.ceil((resetTime - Date.now()) / 1000);
                res.set('Retry-After', retryAfterSeconds);
                
                return res.status(429).json({
                    error: 'RATE_LIMIT_EXCEEDED',
                    message,
                    retryAfter: retryAfterSeconds,
                    limit: maxRequests,
                    windowMs,
                });
            }
            
            next();
        } catch (err) {
            logger.error('[rate-limiter] Error:', err.message);
            // On error, allow request through (fail-open)
            next();
        }
    };
}

/**
 * Default key generator: uses IP address + user ID if authenticated.
 */
function defaultKeyGenerator(req) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const userId = req.user?.id || 'anonymous';
    return `${ip}:${userId}`;
}

/**
 * IP-only key generator (for unauthenticated routes).
 */
function ipKeyGenerator(req) {
    return req.ip || req.connection?.remoteAddress || 'unknown';
}
/**
 * User-only key generator (ignores IP, useful for per-user limits).
 */
function userKeyGenerator(req) {
    if (!req.user?.id) {
        throw new Error('User not authenticated');
    }
    return `user:${req.user.id}`;
}

/**
 * Account-aware generator (IP + username) — لحماية الدخول في شبكة المطعم:
 * كل الأجهزة خلف راوتر واحد (IP موحّد)، فلو حصرنا المحاولات بالـ IP فقط
 * لمنع بعضها بعضًا صباحًا عند دخول الطاقم معًا. الحصر هنا لكل حساب على حدة،
 * فيبقى هجوم التخمين مقيدًا بالحساب المستهدف دون إجهاض بقية الموظفين.
 */
function accountKeyGenerator(req) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const username = String(req.body?.username || '').trim().toLowerCase().slice(0, 64) || 'anonymous';
    return `${ip}:${username}`;
}

// ─── Pre-configured Limiters ─────────────────────────────

/**
 * General API rate limiter (100 req/min).
 */
const generalLimiter = createRateLimiter(DEFAULT_CONFIGS.general);

/**
 * Authentication rate limiter (20 attempts/15min per account+IP).
 * Stricter to prevent brute force attacks — but keyed per ACCOUNT so a
 * shared-IP LAN (one router for all terminals) never blocks co-workers
 * logging in at opening time. Each account keeps its own strict counter.
 */
const authLimiter = createRateLimiter({
    ...DEFAULT_CONFIGS.auth,
    maxRequests: 20,
    keyGenerator: accountKeyGenerator, // per (IP + username) — not per router IP
    // Brute-force protection MUST count FAILED logins: wrong-password 401s
    // are precisely the attack signal. The factory default
    // (skipFailedRequests: true) is for data APIs, not for auth.
    skipFailedRequests: false,
});

/**
 * State sync rate limiter (30 saves/min).
 * Prevents excessive database writes.
 */
const stateLimiter = createRateLimiter(DEFAULT_CONFIGS.state);

/**
 * CRUD operations rate limiter (200 ops/min).
 */
const crudLimiter = createRateLimiter(DEFAULT_CONFIGS.crud);

// ─── Export Everything ──────────────────────────────────
module.exports = {
    // Main factory function
    createRateLimiter,
    
    // Pre-configured limiters
    generalLimiter,
    authLimiter,
    stateLimiter,
    crudLimiter,
    
    // Key generators
    defaultKeyGenerator,
    ipKeyGenerator,
    userKeyGenerator,
    accountKeyGenerator,
    
    // Store classes (for advanced usage/testing)
    MemoryStore,
    RedisStore,
    
    // Default configurations
    DEFAULT_CONFIGS,
    
    // Global instance (for testing/reset)
    _memoryStore: memoryStore,
};
