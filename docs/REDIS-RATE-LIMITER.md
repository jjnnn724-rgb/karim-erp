# دليل تفعيل محدد المعدل القائم على Redis
> **Phase 2.3 | karim ERP Pro**

---

## نظرة عامة

يدعم النظام نوعين من تخزين محدد المعدل:

| النوع | الاستخدام | المميزات |
|-------|-----------|----------|
| **MemoryStore** (افتراضي) | خادم واحد | سريع، لا يتطلب إعداد إضافي |
| **RedisStore** (اختياري) | متعدد الخوادم | موزع، متسق عبر جميع الحالات |

---

## التفعيل السريع لـ Redis

### 1. تثبيت Redis

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install redis-server -y

# CentOS/RHEL
sudo yum install redis -y

# Docker (موصى به للاختبار)
docker run -d --name gvp-redis -p 6379:6379 redis:7-alpine
```

### 2. تشغيل Redis

```bash
sudo systemctl start redis-server    # Linux
# أو
redis-server /etc/redis/redis.conf   # يدوي
```

### 3. تعديل `backend/server.js`

ابحث عن هذا الجزء في بداية الملف:

```javascript
// ─── Rate Limiting ──────────────────────────────
const { generalLimiter, authLimiter, stateLimiter, crudLimiter } = require('./rate-limiter');
```

**استبدله بـ:**

```javascript
// ─── Rate Limiting (with optional Redis) ─────────
const redis = require('redis');
const { createRateLimiter, DEFAULT_CONFIGS } = require('./rate-limiter');

// Redis client initialization (optional)
let redisClient = null;
if (process.env.REDIS_URL) {
    try {
        redisClient = redis.createClient({
            url: process.env.REDIS_URL,
        });
        redisClient.on('error', (err) => {
            console.error('[Redis] Connection error:', err.message);
        });
        redisClient.connect().then(() => {
            console.log('[Redis] Connected successfully');
        });
    } catch (err) {
        console.warn('[Redis] Failed to initialize, using in-memory rate limiting');
    }
}

// Create limiters with Redis if available
const generalLimiter = createRateLimiter({ ...DEFAULT_CONFIGS.general, redisClient });
const authLimiter = createRateLimiter({ ...DEFAULT_CONFIGS.auth, keyGenerator: ipKeyGenerator, redisClient });
const stateLimiter = createRateLimiter({ ...DEFAULT_CONFIGS.state, redisClient });
const crudLimiter = createRateLimiter({ ...DEFAULT_CONFIGS.crud, redisClient });
```

### 4. إضافة متغير البيئة

```bash
# .env file
REDIS_URL=redis://localhost:6379

# أو للإنتاج مع كلمة مرور:
REDIS_URL=redis://:password@redis.example.com:6379/0
```

---

## مقارنة الأداء

| المقياس | MemoryStore | RedisStore |
|---------|-------------|------------|
| **زمن الاستجابة** | ~0.01ms | ~0.5-2ms |
| **الذاكرة** | محلية بالعملية | خارجية |
| **التوزيع** | ❌ غير مدعوم | ✅ مدعوم بالكامل |
| **الثبات** | يفقد عند إعادة التشغيل | TTL تلقائي |
| **التعقيد** | بسيط | يتطلب Redis |

---

## التكوين المتقدم

### تعديل حدود المعدل

```javascript
// في rate-limiter.js أو server.js
const customLimiter = createRateLimiter({
    windowMs: 30 * 1000,      // 30 ثانية
    maxRequests: 50,           // 50 طلب
    message: 'Custom limit message',
    keyGenerator: (req) => {
        // مفتاح مخصص بناءً على API Key
        return req.headers['x-api-key'] || req.ip;
    },
    redisClient,               // اختياري
});
```

### حدود مختلفة حسب الدور

```javascript
function roleBasedLimiter(req, res, next) {
    const limits = {
        admin: { windowMs: 60000, maxRequests: 500 },
        manager: { windowMs: 60000, maxRequests: 200 },
        cashier: { windowMs: 60000, maxRequests: 100 },
        viewer: { windowMs: 60000, maxRequests: 50 },
    };
    
    const config = limits[req.user?.role] || limits.viewer;
    const limiter = createRateLimiter({ ...config, redisClient });
    
    return limiter(req, res, next);
}
```

---

## المراقبة والتصحيح

### فحص حالة Redis

```bash
redis-cli INFO stats
redis-cli KEYS "ratelimit:*"     # عرض مفاتيح محدد المعدل
redis-cli MONITOR                 # مراقبة الأوامر الحية
```

### سجلات محدد المعدل

```javascript
// يتم تسجيل الأخطاء تلقائياً
// [rate-limiter] Redis error, falling back to in-memory: ...

// لإضافة تسجيل مخصص، عدّل rate-limiter.js:
console.log(JSON.stringify({
    level: 'info',
    action: 'rate_limit_check',
    key: generatedKey,
    count: currentCount,
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - currentCount),
}));
```

---

## Fallback التلقائي

عند تفعيل Redis، النظام يستخدم **استراتيجية الفشل الآمن**:

```
طلب جديد
    │
    ▼
┌─────────────────┐
│ Redis متاح؟     │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
   نعم       لا
    │         │
    ▼         ▼
┌────────┐ ┌────────────┐
│ Redis  │ │ In-Memory  │
│ Store  │ │ Fallback   │
└────────┘ └────────────┘
```

هذا يضمن أن النظام يعمل حتى لو كان Redis متوقفاً.

---

## الأمان

### حماية من الهجمات

| الهجوم | الحماية |
|---------|---------|
| **Brute Force** | `authLimiter`: 10 محاولات/15 دقيقة |
| **DDoS** | `generalLimiter`: 100 طلب/دقيقة |
| **State Flooding** | `stateLimiter`: 30 حفظ/دقيقة |
| **CRUD Abuse** | `crudLimiter`: 200 عملية/دقيقة |

### رؤوس HTTP القياسية

كل استجابة تتضمن:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1701234567
Retry-After: 30           # فقط عند تجاوز الحد
```

---

## الاختبار

```bash
# اختبار بدون Redis (افتراضي)
npm test

# اختبار مع Redis
REDIS_URL=redis://localhost:6379 npm test

# اختبار تحميل محدد المعدل
npx jest tests/phase2-rate-limiter.test.js --verbose
```
