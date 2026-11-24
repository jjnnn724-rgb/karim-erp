'use strict';
/**
 * backend/saas/tenant-db.js — معاملة بمعرّف مستأجر (RLS-safe)
 * ─────────────────────────────────────────────────────────────────────────────
 * يحجز عميلاً واحداً من الـpool، يبدأ معاملة، يضبط app.tenant_id بـset_config
 * المعاملاتي (لا إلصاق نصي ⇒ لا حقن)، ثم يمرّر العميل للدالة.
 * أثناء المعاملة، كل pool.query يُوجَّه لنفس العميل عبر Proxy shared-pool،
 * فترى سياسات RLS معرّف المستأجر الصحيح.
 *
 * القيود المعروفة (موثّقة):
 *   • pool.connect() داخل المعاملة يعطي اتصالاً منفصلاً بلا سياق — يُجنَّب
 *     في الكود الجديد؛ الكود القديم يعمل لأن السياسة متساهلة عند غياب السياق.
 *   • لا تداخل: runWithTenant داخل runWithTenant مرفوض صراحةً.
 */

const { pool } = require('../shared-pool');
const { getTenantClient, setTenantClient } = require('../middleware/correlation');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @template T
 * @param {string} tenantId
 * @param {(client: any) => Promise<T>} fn
 * @param {{pool?: any}} [options]
 * @returns {Promise<T>}
 */
async function runWithTenant(tenantId, fn, options = {}) {
    const id = String(tenantId || '');
    if (!UUID_RE.test(id)) {
        throw Object.assign(new Error('INVALID_TENANT_ID'), { code: 'INVALID_TENANT_ID' });
    }
    if (typeof fn !== 'function') {
        throw Object.assign(new Error('TENANT_FN_REQUIRED'), { code: 'TENANT_FN_REQUIRED' });
    }
    if (getTenantClient()) {
        throw Object.assign(new Error('NESTED_TENANT_TRANSACTION'), { code: 'NESTED_TENANT_TRANSACTION' });
    }

    const pgPool = options.pool || pool;
    const client = await pgPool.connect();
    const previous = getTenantClient();
    try {
        await client.query('BEGIN');
        // معاملاتي (true = local): ينتهي أثره بانتهاء المعاملة، ولا يتسرّب
        // لاتصالٍ آخر عند إعادته للـpool.
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', id]);
        setTenantClient(client);
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* الأصل هو الخطأ الأول */ }
        throw err;
    } finally {
        setTenantClient(previous);
        client.release();
    }
}

/**
 * تثبيت سياق المستأجر على اتصال معاملة قائم (مثل معاملة البيع).
 * لا يبدأ معاملة ولا يغيّر دورة الحياة — يضبط GUC محلياً داخل المعاملة الحالية.
 * @param {any} client
 * @param {string} tenantId
 */
async function applyTenantToClient(client, tenantId) {
    const id = String(tenantId || '');
    if (!UUID_RE.test(id)) {
        throw Object.assign(new Error('INVALID_TENANT_ID'), { code: 'INVALID_TENANT_ID' });
    }
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', id]);
}

module.exports = { runWithTenant, applyTenantToClient, UUID_RE };
