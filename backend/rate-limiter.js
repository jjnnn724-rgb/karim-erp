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

    /** @param {any} key @param {any} windowMs */
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

    /** @param {any} key @param {any} windowMs */
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
    /** @param {any} key */
    getState(key) {
        return this.requests.get(key) || null;
    }

    /** @param {any} key */
    reset(key) {
        this.requests.delete(key);
    }
}

// ─── Redis Store (Optional) ──────────────────────────────
class RedisStore {
    /** @param {any} redisClient */
    constructor(redisClient) {
        if (!redisClient) {
            throw new Error('Redis client is required for RedisStore');
        }
        this.redis = redisClient;
        this.prefix = 'ratelimit:';
    }

    /** @param {any} key @param {any} windowMs */
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
        } catch (/** @type {any} */ err) {
            logger.error('[rate-limiter] Redis error, falling back to in-memory:', err.message);
            // Fallback to in-memory on Redis failure
            return memoryStore.increment(key, windowMs);
        }
    }

    /** @param {any} key @param {any} windowMs */
    async decrement(key, windowMs) {
        const redisKey = this.prefix + key;
        try {
            const value = await this.redis.decr(redisKey);
            if (value <= 0) {
                await this.redis.del(redisKey);
            }
            return { count: Math.max(0, value), resetTime: Date.now() + windowMs };
        } catch (/** @type {any} */ err) {
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
/** @param {any} name @param {any} fallback */
const envMax = (name, fallback) => {
    const v = parseInt(/** @type {string} */ (process.env[name]), 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
};

// ─── Rate Limiter Configuration ──────────────────────────
const DEFAULT_CONFIGS = {
    // General API limits
    general: {
        windowMs: 60 * 1000,      // 1 minute
        // 2026-10-13: كانت 100/دقيقة فأصبح إقلاع التطبيق موجة 429 (1606 رفضًا في
        // يوم): ~24 كيانًا × صفحات + إشعارات + حالة من نفس الـ IP، والعميل ينتظر حتى
        // 15 ثانية عند كل رفض — هذا كان «التهنّج» الذي شكا منه المالك. الميزانية
        // للمستخدم المصادَق مرفوعة إلى 600/دقيقة (قابلة للضبط من .env).
        maxRequests: envMax('RATE_LIMIT_GENERAL_MAX', 600),
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
 * @param {Object} [options] - Configuration options
 * @param {number} [options.windowMs] - Time window in milliseconds
 * @param {number} [options.maxRequests] - Max requests allowed in window
 * @param {string} [options.message] - Error message when limited
 * @param {any} [options.keyGenerator] - Function(req) to generate unique key
 * @param {Object} [options.redisClient] - Optional Redis client for distributed limiting
 * @param {boolean} [options.skipFailedRequests] - Skip counting failed requests
 * @param {boolean} [options.skipSuccessfulRequests] - Skip counting successful requests
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

    return async function rateLimiterMiddleware(/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) {
        let key = 'unknown';
        try {
            // Generate unique key for this request
            key = keyGenerator(req);
            
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
        } catch (/** @type {any} */ err) {
            logger.error('[rate-limiter] Error:', err.message);
            // تأمين 2026-11 (M3): لا fail-open. عند خطأ المخزن نتدهور إلى ميزانية
            // محلية صارمة (نصف السقف) عبر مخزن الذاكرة داخل العملية؛ ولو فشل ذلك
            // أيضًا نرفض بـ503 (fail-closed) بدل ترك الباب مفتوحًا للمهاجم.
            try {
                const fallbackMax = Math.max(1, Math.floor(maxRequests / 2));
                const degraded = memoryStore.increment(`degraded:${key}`, windowMs);
                if (degraded.count > fallbackMax) {
                    const retryAfter = Math.ceil(windowMs / 1000);
                    res.set('Retry-After', retryAfter);
                    return res.status(429).json({
                        error: 'RATE_LIMIT_EXCEEDED', message, retryAfter,
                        limit: fallbackMax, windowMs,
                    });
                }
                return next();
            } catch (_) {
                return res.status(503).json({
                    error: 'RATE_LIMIT_UNAVAILABLE',
                    message: 'خدمة تحديد المعدل غير متاحة مؤقتًا — حاول مجددًا بعد لحظات.',
                });
            }
        }
    };
}

/**
 * Default key generator: uses IP address + user ID if authenticated.
 * FIX 2026-10-11 (M2): use req.connection.remoteAddress (actual TCP peer)
 * not req.ip (spoofable via X-Forwarded-For when trust proxy=1).
 * @param {any} req
 */
function defaultKeyGenerator(req) {
    const ip = req.connection?.remoteAddress || req.ip || 'unknown';
    const userId = req.user?.id || 'anonymous';
    return `${ip}:${userId}`;
}

/**
 * IP-only key generator (for unauthenticated routes).
 * @param {any} req
 */
function ipKeyGenerator(req) {
    return req.connection?.remoteAddress || req.ip || 'unknown';
}
/**
 * User-only key generator (ignores IP, useful for per-user limits).
 * @param {any} req
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
 * @param {any} req
 */
function accountKeyGenerator(req) {
    // FIX 2026-10-11 (M2): use req.connection.remoteAddress not req.ip
    const ip = req.connection?.remoteAddress || req.ip || 'unknown';
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
 * FIX 2026-10-03: كان الحد ثابتًا 20 يتجاهل RATE_LIMIT_AUTH_MAX رغم أن
 * التعليق أعلاه يوثّق قابليته للضبط بالبيئة — الآن يُحترم المتغير (الافتراضي 20).
 */
const authLimiter = createRateLimiter({
    ...DEFAULT_CONFIGS.auth,
    maxRequests: envMax('RATE_LIMIT_AUTH_MAX', 20),
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

/**
 * Session-refresh rate limiter (120/min per IP) — FIX 2026-10-31.
 * /auth/refresh كانت على سقف الدخول الصارم، ومفتاحه بلا username في
 * الطلب فانهار إلى IP واحد — وكل أجهزة المطعم خلف نفق Cloudflare تظهر
 * بـ remoteAddress واحد، فتجديدات الجلسة المشروعة استنزفت السقف وأعطت
 * 429 → فشل التجديد الصامت → خروج دوري للحسابات (شكوى المالك الأصلية).
 * التجديد نداء نظامي متكرر لا محاولة تخمين: سقف سخي بنافذة قصيرة يمنع
 * الطوفان دون طرد موظف، وفشل التجديد لا يحتسب (الرمز الميت يُحذف أصلًا).
 */
const refreshLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: envMax('RATE_LIMIT_REFRESH_MAX', 120),
    message: 'Too many session refreshes, please try again shortly',
    keyGenerator: ipKeyGenerator,
    skipFailedRequests: true,
});

// ─── Export Everything ──────────────────────────────────
module.exports = {
    // Main factory function
    createRateLimiter,

    // Pre-configured limiters
    generalLimiter,
    authLimiter,
    refreshLimiter,
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
