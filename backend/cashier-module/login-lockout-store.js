/**
 * login-lockout-store — قفل الدخول الدائم (R18++، ترحيل 153).
 * ════════════════════════════════════════════════════════════════════════════
 * كان القفل in-memory في jwt-middleware (يتصفّر بإعادة التشغيل — المهاجم يعيد
 * المحاولة بعد أي restart). الآن يُحفَظ في login_lockouts بنفس دلالات R18:
 *   5 فشلات خلال 15د على (IP+username) → قفل 15د؛ النجاح يصفّر.
 *
 * نشر آمن بلا انقطاع: إن لم يكن الترحيل مطبقًا (أو تعطلت القاعدة) يتراجع تلقائيًا
 * إلى الذاكرة بنفس السلوك السابق، ويعيد الفحص كل 5 دقائق ليلتقط الترحيل حيًا.
 * لا رمي أخطاء أبدًا نحو مسار الدخول — القفل طبقة دفاع، تعطلها لا يسقط الدخول.
 */
'use strict';

const { pool } = require('../shared-pool');
const { logger } = require('../logger');

const LOGIN_LOCKOUT = { MAX_FAILS: 5, WINDOW_MS: 15 * 60 * 1000, LOCK_MS: 15 * 60 * 1000 };
const RECHECK_MS = 5 * 60 * 1000;

/** @type {boolean|null} null = غير مفحوص، true/false */
let tableReady = null;
let lastCheck = 0;
let warnedFallback = false;
let failCounter = 0;

// تراجع الذاكرة — نفس دلالات R18 حرفيًا.
const _mem = new Map();
/** @param {string} k */
function memState(k) {
    const e = _mem.get(k);
    if (!e) {return { locked: false };}
    if (e.lockUntil && Date.now() < e.lockUntil) {
        return { locked: true, retryAfter: Math.ceil((e.lockUntil - Date.now()) / 1000) };
    }
    if (e.firstAt && Date.now() - e.firstAt > LOGIN_LOCKOUT.WINDOW_MS) {_mem.delete(k);}
    return { locked: false };
}
/** @param {string} k */
function memFail(k) {
    const now = Date.now();
    const e = _mem.get(k) || { count: 0, firstAt: now, lockUntil: 0 };
    if (now - e.firstAt > LOGIN_LOCKOUT.WINDOW_MS) {e.count = 0; e.firstAt = now;}
    e.count++;
    if (e.count >= LOGIN_LOCKOUT.MAX_FAILS) {e.lockUntil = now + LOGIN_LOCKOUT.LOCK_MS;}
    _mem.set(k, e);
    if (_mem.size > 10000) {
        for (const [kk, v] of _mem) {
            if (v.firstAt < now - LOGIN_LOCKOUT.WINDOW_MS && !(v.lockUntil > now)) {_mem.delete(kk);}
        }
    }
}

async function dbReady() {
    const now = Date.now();
    if (tableReady !== null && now - lastCheck < RECHECK_MS) {return tableReady;}
    lastCheck = now;
    try {
        await pool.query('SELECT 1 FROM login_lockouts LIMIT 0');
        tableReady = true;
    } catch (_) {
        tableReady = false;
        if (!warnedFallback) {
            warnedFallback = true;
            logger.warn('[auth] login_lockouts غير متاح — قفل الدخول في الذاكرة مؤقتًا (طبق الترحيل 153)');
        }
    }
    return tableReady;
}

/** حالة القفل المفتاح. لا يرمي أبدًا. @param {string} k */
async function state(k) {
    try {
        if (!(await dbReady())) {return memState(k);}
        const r = await pool.query('SELECT fails, first_at, lock_until FROM login_lockouts WHERE key = $1', [k]);
        if (!r.rowCount) {return { locked: false };}
        const row = r.rows[0];
        const now = Date.now();
        if (row.lock_until && new Date(row.lock_until).getTime() > now) {
            return { locked: true, retryAfter: Math.ceil((new Date(row.lock_until).getTime() - now) / 1000) };
        }
        if (new Date(row.first_at).getTime() < now - LOGIN_LOCKOUT.WINDOW_MS) {
            await pool.query('DELETE FROM login_lockouts WHERE key = $1', [k]).catch(() => {});
        }
        return { locked: false };
    } catch (e) {
        logger.warn({ err: /** @type {Error} */ (e).message }, '[auth] lockout state degraded to memory');
        return memState(k);
    }
}

/** تسجيل فشلة (نافذة 15د، قفل عند الخامسة). لا يرمي أبدًا. @param {string} k */
async function fail(k) {
    try {
        if (!(await dbReady())) {memFail(k); return;}
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const r = await client.query('SELECT fails, first_at FROM login_lockouts WHERE key = $1 FOR UPDATE', [k]);
            const now = Date.now();
            let count = 1, firstAt = now, lockUntil = null;
            if (r.rowCount) {
                const row = r.rows[0];
                const oldFirst = new Date(row.first_at).getTime();
                if (now - oldFirst <= LOGIN_LOCKOUT.WINDOW_MS) {
                    count = Number(row.fails) + 1;
                    firstAt = oldFirst;
                }
                if (count >= LOGIN_LOCKOUT.MAX_FAILS) {lockUntil = new Date(now + LOGIN_LOCKOUT.LOCK_MS);}
            }
            await client.query(
                `INSERT INTO login_lockouts (key, fails, first_at, lock_until, updated_at)
                 VALUES ($1, $2, to_timestamp($3 / 1000.0), $4, now())
                 ON CONFLICT (key) DO UPDATE SET fails = $2, first_at = to_timestamp($3 / 1000.0),
                   lock_until = $4, updated_at = now()`,
                [k, count, firstAt, lockUntil]);
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            throw e;
        } finally {
            client.release();
        }
        // تنظيف دوري خفيف للمنتهية (كل 100 فشلة) — لا حاجة لcron إضافي.
        if (++failCounter % 100 === 0) {
            await pool.query(
                `DELETE FROM login_lockouts
                  WHERE first_at < now() - interval '15 minutes'
                    AND (lock_until IS NULL OR lock_until < now())`).catch(() => {});
        }
    } catch (e) {
        logger.warn({ err: /** @type {Error} */ (e).message }, '[auth] lockout fail degraded to memory');
        memFail(k);
    }
}

/** نجاح الدخول = تصفير العداد. لا يرمي أبدًا. @param {string} k */
async function clear(k) {
    _mem.delete(k);
    try {
        if (await dbReady()) {await pool.query('DELETE FROM login_lockouts WHERE key = $1', [k]);}
    } catch (_) { /* الذاكرة صُفّرت أعلاه */ }
}

module.exports = { LOGIN_LOCKOUT, state, fail, clear, _mem };
