/**
 * shared-pool.js — Shared PostgreSQL connection pool (no circular deps)
 * ────────────────────────────────────────────────────────────────────────────
 * Single source of truth for the DB pool. Both server.js and cashier-module/db-pool.js
 * import from here instead of from each other.
 *
 * v4.7.0 Resilience:
 *   • TCP keepAlive on sockets (survives NAT/idle drops)
 *   • safeQuery() — automatic retry of transient DB failures
 */
const { logger } = require('./logger');
const { getTenantClient, getTenantId } = require('./middleware/correlation');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ─── DB config resolver ──────────────────────────────────
// Uses process.env first (allows override by injected environment),
// then falls back to reading .env file directly for values that were
// persisted to disk but not yet in process.env (e.g., DB_PORT auto-fixed
// by setup scripts during the same boot cycle).
function dbEnv(/** @type {any} */ key, /** @type {any} */ fallback) {
  if (process.env[key] !== undefined && process.env[key] !== '') {
    return process.env[key];
  }
  const fs = require('fs');
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) {
        continue;
      }
      const idx = t.indexOf('=');
      if (idx === -1) {
        continue;
      }
      const k = t.slice(0, idx).trim();
      if (k === key) {
        return t
          .slice(idx + 1)
          .trim()
          .replace(/^["']|["']$/g, '');
      }
    }
  }
  return fallback;
}

/**
 * حارس قاعدة بيانات الاختبار (fail-closed).
 * 2026-10-26: مجموعة password-recovery كتبت حسابات PWRT-TEST في قاعدة
 * الإنتاج قبل ضبط عزل الاختبار، وبقي حساب اختبار نشط بكلمة مرور معروفة.
 * أي عملية تعمل بـ NODE_ENV=test لا يجوز أن تفتح اتصالًا إلا بـ
 * karim_erp_test — هنا يُمنع الاتصال لا يُسجَّل تحذير.
 */
function resolveDbName() {
  const name = dbEnv('DB_NAME', 'karim_erp');
  if (process.env.NODE_ENV === 'test' && name !== 'karim_erp_test') {
    throw new Error(
      `Refusing to connect to database "${name}" with NODE_ENV=test — test runs must target karim_erp_test.`
    );
  }
  return name;
}

// FIX 2026-10-11 (M22): pool is now mutable — after DB restore, pg_terminate_backend
// kills all connections but the Pool object still holds dead sockets. reinitPool()
// creates a fresh Pool so the server doesn't need a full restart.
let _pool = new Pool({
  user: dbEnv('DB_USER', 'postgres'),
  host: dbEnv('DB_HOST', 'localhost'),
  database: resolveDbName(),
  password: dbEnv('DB_PASSWORD', ''),
  port: parseInt(dbEnv('DB_PORT', '5432'), 10),
  // PERF-7: max reduced 60→20 — Postgres default max_connections=100;
  // 60/process exhausts it under any concurrent load. 20 queues politely.
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  query_timeout: 30000,
  idle_in_transaction_session_timeout: parseInt(dbEnv('DB_IDLE_TX_TIMEOUT_MS', '15000'), 10),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

function _attachPoolHandlers(/** @type {any} */ p) {
  // @ts-ignore — legacy callback: pg's event typings don't expose these params
  p.on('connect', client => {
    logger.info('[shared-pool] new DB connection established', { pid: client.processID });
    // FIX 2026-10-19: عميلٌ مأخوذ من الـpool قد يبثّ 'error' بعد قطع الاتصال
    // (Connection terminated unexpectedly)؛ وبلا مستمع يتحوّل الحدث إلى
    // uncaughtException يُسقط الخادم كله. مستمعٌ دائم لكل عميل يجعل القطع
    // حدثًا مُعالَجًا يتعافى منه الـpool بدل أن يقتل العملية.
    // @ts-ignore —的错误对象只用于日志
    client.on('error', err => {
      logger.warn('[shared-pool] client socket error (absorbed):', err && err.message);
    });
  });
  p.on('remove', () => {
    // إغلاق اتصالٍ خامل بعد idleTimeout حدثٌ طبيعي — لا يُرفع إلى warn
    // وإلا غطّى على الأعطال الحقيقية في السجل.
    logger.debug('[shared-pool] idle connection closed');
  });
  // @ts-ignore —的错误对象只用于日志
  p.on('error', err => {
    logger.error('[shared-pool] Unexpected error on idle client:', err.message);
  });
}
_attachPoolHandlers(_pool);

/** Re-initialize the pool (after DB restore). Returns when new pool is ready. */
async function reinitPool() {
  const old = _pool;
  _pool = new Pool({
    user: dbEnv('DB_USER', 'postgres'),
    host: dbEnv('DB_HOST', 'localhost'),
    database: resolveDbName(),
    password: dbEnv('DB_PASSWORD', ''),
    port: parseInt(dbEnv('DB_PORT', '5432'), 10),
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
    query_timeout: 30000,
    idle_in_transaction_session_timeout: parseInt(dbEnv('DB_IDLE_TX_TIMEOUT_MS', '15000'), 10),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });
  _attachPoolHandlers(_pool);
  // Test the new pool
  await _pool.query('SELECT 1');
  // Drain old pool (best-effort)
  try {
    await old.end();
  } catch (_) {
    /* best-effort: الخطأ لا يوقف المسار */
  }
  logger.info('[shared-pool] pool re-initialized after restore');
  return _pool;
}

const TENANT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * استعلام داخل سياق مستأجر بلا معاملة صريحة: نفتح معاملة قصيرة، نضبط GUC
 * المعرّف (set_config المعاملاتي — لا حقن نصي)، ننفّذ الاستعلام ثم نُغلق.
 * دي طبقة أمان إضافية لكل `pool.query` في وضع SaaS؛ الكود القديم خارج السياق
 * ما زال يمرّ عبر المسار الأصلي حرفياً.
 * @param {string} tenantId
 * @param {any[]} args
 */
async function tenantScopedQuery(tenantId, args) {
  const client = await _pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1,$2,true)', ['app.tenant_id', tenantId]);
    const result = await /** @type {any} */ (client.query)(...args);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* الخطأ الأصلي هو المهم */ }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * اتصال مباشر (`pool.connect()`) داخل سياق مستأجر: نضبط GUC على مستوى الجلسة
 * قبل أول استعلام، ونعيد ضبطه قبل إعادة الاتصال للـpool. كده كل مسار قديم
 * يفتح اتصالًا بنفسه يرى معرّف المستأجر دون تعديل ١٣٨ موقع نداء.
 * @param {string} tenantId
 * @param {any[]} args
 */
async function tenantScopedConnect(tenantId, args) {
  const client = await _pool.connect(...args);
  const rawQuery = client.query.bind(client);
  const rawRelease = client.release.bind(client);
  try {
    await rawQuery('SELECT set_config($1,$2,false)', ['app.tenant_id', tenantId]);
  } catch (error) {
    rawRelease();
    throw error;
  }
  let released = false;
  client.release = (/** @type {any[]} */ ...releaseArgs) => {
    if (released) {return;}
    released = true;
    // إعادة الضبط قبل إرجاع الاتصال: لا يتسرّب معرّف مستأجر لطلب تالٍ.
    rawQuery("SELECT set_config('app.tenant_id','',false)")
      .catch(() => { /* الاتصال يُعاد للـpool على أي حال */ })
      .finally(() => rawRelease(...releaseArgs));
  };
  return client;
}

// Proxy so all existing `pool.query(...)` calls transparently use the current pool.
// SaaS: داخل معاملة مستأجر، الاستعلامات تُوجَّه للعميل المحجوز (نفس الاتصال الذي
// حمل `SET LOCAL app.tenant_id`) — وإلا سترى سياسات RLS صفر صفوف. وإن وُجد
// معرّف مستأجر في سياق الطلب بلا عميل محجوز، يُنشأ نطاق معاملة قصير لكل استعلام.
// خارج السياق لا يتغيّر أي شيء: السلوك القديم حرفياً.
const pool = new Proxy(/** @type {import('pg').Pool} */ (/** @type {unknown} */ ({})), {
  get(_, prop) {
    if (prop === 'query') {
      return (/** @type {any[]} */ ...args) => {
        const scoped = getTenantClient();
        if (scoped) {return scoped.query(...args);}
        const tenantId = getTenantId();
        if (tenantId && TENANT_UUID_RE.test(String(tenantId))) {
          return tenantScopedQuery(String(tenantId), args);
        }
        return _pool.query(...args);
      };
    }
    if (prop === 'connect') {
      return (/** @type {any[]} */ ...args) => {
        const tenantId = getTenantId();
        if (tenantId && TENANT_UUID_RE.test(String(tenantId))) {
          return tenantScopedConnect(String(tenantId), args);
        }
        return _pool.connect(...args);
      };
    }
    if (prop === 'end' || prop === 'on') {
      return _pool[prop].bind(_pool);
    }
    if (prop === 'totalCount' || prop === 'idleCount' || prop === 'waitingCount') {
      return _pool[prop];
    }
    return _pool[prop];
  },
});

// ─── Transient error codes (safe to retry) ─────────────────────────────────
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  '08000',
  '08003',
  '08006', // connection_exception / does_not_exist / failure
  '57P01',
  '57P02',
  '57P03', // admin_shutdown / crash_shutdown / cannot_connect_now
  '40001',
  '40P01', // serialization_failure / deadlock_detected
]);

/**
 * safeQuery — runs a query with automatic retry on transient failures.
 * Retries up to `retries` times with exponential backoff (300ms, 600ms...).
 * Non-transient errors (syntax, constraints, etc.) throw immediately.
 */
async function safeQuery(text, params = [], retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await _pool.query(text, params);
    } catch (err) {
      lastErr = err;
      const transient =
        TRANSIENT_CODES.has(err.code) ||
        /connection terminated|socket hang up|server closed the connection/i.test(err.message || '');
      if (!transient || attempt === retries) {
        throw err;
      }
      const waitMs = 300 * Math.pow(2, attempt);
      logger.warn(
        `[shared-pool] transient DB error (${err.code || err.message}) — retry ${attempt + 1}/${retries} in ${waitMs}ms`
      );
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

module.exports = { pool, safeQuery, reinitPool, dbName: resolveDbName };
