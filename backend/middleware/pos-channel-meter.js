'use strict';
/**
 * pos-channel-meter.js — قياس قناة واجهة POS الفعلية (Phase 4.1)
 * ══════════════════════════════════════════════════════════════════════════
 * الغرض: قبل ت��ييد مسار POS رسمي، نحتاج أرقاماً عن المسار الذي يُستخدم فعلاً
 * (لا تخمين). الوحدة ترصد الطلبات وتُرجعها لقناة:
 *
 *   pos         → /app/pos.html      (الشاشة القديمة)
 *   cashier     → /app/cashier/      (PWA مستقل)
 *   v2-embedded → /app/v2.html       (الواجهة الجديدة — POS مدمج)
 *   unknown     → لا مرجع معروف
 *
 * قواعد صريحة:
 *   · لا يُوثق بـX-POS-Channel القادم من العميل — يُسجَّل كـ"ادّعاء" للمقارنة
 *     فقط، والقرار من المرجع (Referer/Origin) الذي يحدده المتصفح.
 *   · لا يفتح اتصالاً بقاعدة البيانات ولا يستورد server.js.
 *   · لا يُسقط الطلب أبداً: أي خطأ في الكتابة يُسجَّل كتحذير فقط.
 *   · لا تُخزَّن رموز الوصول ولا معرّفات شخصية — بصمة SHA-256 مقطوعة فقط.
 *
 * المخرج: logs/pos-channel-usage-YYYY-MM-DD.json (تجميع يومي، لا سطر لكل طلب).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logger } = require('../logger');

const LOG_DIR = path.resolve(__dirname, '..', '..', 'logs');
const MAX_SESSIONS_PER_CHANNEL = 5000;

// المسارات المقيسة — منيحة على حركة البيع نفسها (لا كل /api).
const METERED = [
    { method: 'POST', pattern: /^\/api\/sales\/complete$/, event: 'sale' },
    { method: 'POST', pattern: /^\/api\/pos\/shifts\/open$/, event: 'shift_open' },
    { method: 'POST', pattern: /^\/api\/pos\/shifts\/\d+\/close$/, event: 'shift_close' },
    { method: 'GET', pattern: /^\/api\/pos\/products$/, event: 'products' },
    { method: 'GET', pattern: /^\/api\/pos\/orders$/, event: 'orders_history' },
    { method: 'GET', pattern: /^\/api\/pos\/orders\/item-summary$/, event: 'orders_summary' },
];

const CHANNELS = ['pos', 'cashier', 'v2-embedded', 'unknown'];

/**
 * استنتاج القناة من مرجع المتصفح — لا من ترويسة يرسلها العميل.
 * @param {import('express').Request} req
 * @returns {'pos'|'cashier'|'v2-embedded'|'unknown'}
 */
function inferChannel(req) {
    const referer = String((req.headers && req.headers.referer) || '');
    const origin = String((req.headers && req.headers.origin) || '');
    const hay = `${referer} ${origin}`.toLowerCase();
    // الترتيب مهم: /app/cashier/ لا يحتوي /app/pos.html، لكن نُبقي الطول
    // أولاً احتياطاً إن استُعمل مسار مشترك مستقبلاً.
    if (hay.includes('/app/cashier/')) {return 'cashier';}
    if (hay.includes('/app/v2.html')) {return 'v2-embedded';}
    if (hay.includes('/app/pos.html')) {return 'pos';}
    // مسارات بلا /app (نشر على جذر مختلف)
    if (hay.includes('/cashier/')) {return 'cashier';}
    if (hay.includes('/v2.html')) {return 'v2-embedded';}
    if (hay.includes('/pos.html')) {return 'pos';}
    return 'unknown';
}

/** بصمة جلسة — بصمة الرمز لا الرمز نفسه. */
function sessionKey(req) {
    const auth = String((req.headers && req.headers.authorization) || '');
    if (!auth) {return null;}
    return crypto.createHash('sha256').update(auth).digest('hex').slice(0, 16);
}

function emptyBucket() {
    return {
        requests: 0, sales: 0, errors: 0,
        events: {},
        claimed: {},
        sessions: new Set(),
    };
}

function dayStamp(d = new Date()) {
    // يوم الرياض — القياس يجب أن يتبع يوم العمل لا UTC
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
}

class PosChannelMeter {
    constructor({ logDir = LOG_DIR } = {}) {
        this.logDir = logDir;
        this.day = dayStamp();
        this.buckets = Object.fromEntries(CHANNELS.map((c) => [c, emptyBucket()]));
        this.writeChain = Promise.resolve();
        this.flushTimer = null;
    }

    _rollDay() {
        const today = dayStamp();
        if (today !== this.day) {
            this.day = today;
            this.buckets = Object.fromEntries(CHANNELS.map((c) => [c, emptyBucket()]));
        }
    }

    _match(req) {
        const path = String((req.originalUrl || req.url || '').split('?')[0]);
        for (const rule of METERED) {
            if (rule.method === req.method && rule.pattern.test(path)) {return rule.event;}
        }
        return null;
    }

    /** تسجيل طلب — يُستدعى قبل معالجة المسار. */
    record(req) {
        try {
            this._rollDay();
            const event = this._match(req);
            if (!event) {return;}
            const channel = inferChannel(req);
            const bucket = this.buckets[channel];
            bucket.requests += 1;
            bucket.events[event] = (bucket.events[event] || 0) + 1;
            if (event === 'sale') {bucket.sales += 1;}
            // ادّعاء العميل — للمقارنة فقط، لا يُستخدم في القرار
            const claimed = String((req.headers && req.headers['x-pos-channel']) || '').trim();
            if (claimed) {bucket.claimed[claimed] = (bucket.claimed[claimed] || 0) + 1;}
            const key = sessionKey(req);
            if (key && bucket.sessions.size < MAX_SESSIONS_PER_CHANNEL) {bucket.sessions.add(key);}
        } catch (err) {
            logger.warn('[pos-channel-meter] record failed (non-fatal):', err.message);
        }
    }

    /** تسجيل خطأ في طلب مقيس. */
    recordError(req) {
        try {
            this._rollDay();
            const event = this._match(req);
            if (!event) {return;}
            this.buckets[inferChannel(req)].errors += 1;
        } catch (_) { /* لا يُسقط الطلب */ }
    }

    /** لقطة حالية (للاختبارات والتقارير). */
    snapshot() {
        const out = { day: this.day, channels: {} };
        for (const c of CHANNELS) {
            const b = this.buckets[c];
            out.channels[c] = {
                requests: b.requests, sales: b.sales, errors: b.errors,
                events: { ...b.events }, claimed: { ...b.claimed },
                sessions: b.sessions.size,
            };
        }
        return out;
    }

    /** كتابة يومية — تسلسل�，保证 عدم تداخل الكتابات. */
    flush() {
        this._rollDay();
        const payload = this.snapshot();
        this.writeChain = this.writeChain.then(async () => {
            try {
                await fs.promises.mkdir(this.logDir, { recursive: true });
                const file = path.join(this.logDir, `pos-channel-usage-${payload.day}.json`);
                const tmp = `${file}.tmp`;
                await fs.promises.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
                await fs.promises.rename(tmp, file);
            } catch (err) {
                logger.warn('[pos-channel-meter] flush failed (non-fatal):', err.message);
            }
        }).catch(() => {});
        return this.writeChain;
    }

    /** بدء الكتابة الدورية (كل 5 ثوانٍ) + الإيقاف. */
    start() {
        if (this.flushTimer) {return;}
        this.flushTimer = setInterval(() => {this.flush();}, 5_000);
        if (typeof this.flushTimer.unref === 'function') {this.flushTimer.unref();}
    }

    stop() {
        if (this.flushTimer) {clearInterval(this.flushTimer); this.flushTimer = null;}
    }
}

let shared = null;
function getMeter() {
    if (!shared) {shared = new PosChannelMeter();}
    return shared;
}

/** Middleware جاهز للتركيب في server.js. */
function posChannelMeter(req, res, next) {
    const meter = getMeter();
    meter.record(req);
    res.on('finish', () => {
        if (res.statusCode >= 400) {meter.recordError(req);}
    });
    next();
}

module.exports = {
    posChannelMeter, getMeter, PosChannelMeter,
    inferChannel, sessionKey, dayStamp, METERED, CHANNELS,
};
