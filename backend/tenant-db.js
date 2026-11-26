'use strict';
/**
 * tenant-db.js — طبقة الوصول الواحدة للمستأجر (Stage 2).
 *
 * أي استعلام على جدول tenant-owned يجب أن يعبر هذه الطبقة:
 *   BEGIN → SET LOCAL app.tenant_id → الاستعلام → COMMIT/ROLLBACK.
 * كذلك يمنع تسرّب السياق بين طلبات البول (SET LOCAL لا SET العادي).
 */
const { pool } = require('./shared-pool');
const { setTenantLocal } = require('./tenant-context');

async function withTenantTx(tenantId, fn) {
    if (!tenantId || !Number.isFinite(Number(tenantId))) {
        throw Object.assign(new Error('TENANT_CONTEXT_REQUIRED'), { statusCode: 403 });
    }
    const client = await pool.connect();
    let committed = false;
    try {
        await client.query('BEGIN');
        await setTenantLocal(client, tenantId);
        const result = await fn(client, tenantId);
        await client.query('COMMIT');
        committed = true;
        return result;
    } catch (error) {
        if (!committed) {await client.query('ROLLBACK').catch(() => {});}
        throw error;
    } finally {
        client.release();
    }
}

/** استعلام واحد داخل سياق مستأجر — للاستخدام في المسارات القصيرة. */
async function tenantQuery(tenantId, sql, params = []) {
    return withTenantTx(tenantId, (client) => client.query(sql, params));
}

module.exports = { withTenantTx, tenantQuery };
