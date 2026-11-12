'use strict';

/**
 * integration/routes.js — واجهة الامتثال السعودي (GATE 03)
 * ────────────────────────────────────────────────────────────────────────────
 *   GET  /health                             حالة المزوّدين والصادر
 *   GET  /providers                          سجل المزوّدين
 *   PUT  /providers/:code/settings           تفعيل/تعطيل (VERIFIED فقط)
 *   PUT  /credentials/:provider/:key          كتابة اعتماد مشفّر (write-only)
 *   GET  /outbox                              صفوف الصادر بلا حمولة
 *   POST /outbox/:id/retry                    إعادة إرسال (submit)
 *   POST /outbox/:id/review                   اعتماد/إلغاء dead-letter (review)
 *   GET  /events                              سجل المحاولات المنقّى
 *
 * لا إرسال خارجي في هذه المرحلة: الصفوف تُنشأ وتُدار فقط.
 */

const express = require('express');
const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const { jwtAuth } = require('../cashier-module/jwt-middleware');
const { requireRoleOrPerm } = require('../permissions');
const { generalLimiter, crudLimiter } = require('../rate-limiter');
const { encryptForVault } = require('../password-vault');
const {
    OUTBOX_STATUSES, KEY_NAME_RE, staticProviders,
    canEnableProvider, retryIdempotencyKey, isSelfReview, clampLimit,
    publicProvider, publicOutboxRow, publicEventRow,
} = require('./lib');

const router = express.Router();

const VIEW_ROLES = ['admin', 'manager'];
const WRITE_ROLES = ['admin'];

const canView = requireRoleOrPerm(VIEW_ROLES, 'compliance.view');
const canWriteSettings = requireRoleOrPerm(WRITE_ROLES, 'compliance.configure');
const canSubmit = requireRoleOrPerm(WRITE_ROLES, 'compliance.submit');
const canReview = requireRoleOrPerm(WRITE_ROLES, 'compliance.review');

function fail(res, status, error, message) {
    return res.status(status).json({ error, message });
}

function dbFail(res, error, where) {
    if (error && error.code === '42P01') {
        return fail(res, 503, 'INTEGRATION_NOT_READY', 'بنية التكامل غير مطبَّقة بعد — طبّق هجرة 145 أولًا.');
    }
    logger.error(`[integration/${where}]`, error);
    return fail(res, 500, 'INTEGRATION_FAILED', 'تعذر إكمال الطلب.');
}

function actorOf(req) {
    return Number.isInteger(req.user?.id) ? req.user.id : null;
}

async function writeInternalEvent(db, { outboxId = null, providerCode, actorId, metadata }) {
    await db.query(
        `INSERT INTO integration_events (outbox_id, provider_code, direction, outcome, actor_user_id, metadata)
         VALUES ($1, $2, 'internal', 'success', $3, $4::jsonb)`,
        [outboxId, providerCode, actorId, JSON.stringify(metadata || {})]);
}

async function tableExists(name) {
    const { rows } = await pool.query('SELECT to_regclass($1) AS t', [`public.${name}`]);
    return Boolean(rows[0] && rows[0].t);
}

async function readZatcaHealth() {
    if (!(await tableExists('zatca_settings'))) {return null;}
    const settings = (await pool.query(
        'SELECT environment, enabled FROM zatca_settings WHERE id = 1')).rows[0] || null;
    let queued = null;
    if (await tableExists('pos_zatca_invoice_queue')) {
        queued = (await pool.query(
            `SELECT count(*)::int AS n FROM pos_zatca_invoice_queue WHERE status IN ('queued', 'processing')`
        )).rows[0].n;
    }
    return {
        environment: settings?.environment ?? null,
        enabled: Boolean(settings?.enabled),
        queued,
    };
}

async function enqueueRetry(db, row, actorId, requestId) {
    let key = null;
    for (let attempt = 1; attempt <= 100 && key === null; attempt++) {
        const candidate = retryIdempotencyKey(row.idempotency_key, attempt);
        const taken = await db.query(
            'SELECT 1 FROM integration_outbox WHERE idempotency_key = $1', [candidate]);
        if (taken.rowCount === 0) {key = candidate;}
    }
    if (key === null) {throw new Error('RETRY_KEY_EXHAUSTED');}
    const inserted = await db.query(
        `INSERT INTO integration_outbox
            (provider_code, event_type, aggregate_type, aggregate_id, idempotency_key,
             payload, payload_sha256, created_by, request_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
         RETURNING id, idempotency_key`,
        [row.provider_code, row.event_type, row.aggregate_type, row.aggregate_id, key,
            JSON.stringify(row.payload), row.payload_sha256, actorId, requestId]);
    return inserted.rows[0];
}

router.use(jwtAuth);
router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

/** قبل تطبيق 145 تعرض الشاشة تصنيف المزوّدين الحقيقي بدل 503 فارغ. */
async function loadProviderRows() {
    try {
        const rows = (await pool.query(
            `SELECT code, name_ar, name_en, verification, is_enabled, evidence_note, last_verified_at
               FROM integration_providers ORDER BY code`)).rows;
        return rows.length ? rows.map(publicProvider) : staticProviders();
    } catch (error) {
        if (error && error.code === '42P01') {return staticProviders();}
        throw error;
    }
}

router.get('/health', canView, generalLimiter, async (req, res) => {
    try {
        const providers = await loadProviderRows();
        let outbox = null;
        let infra = { migration_145: true };
        try {
            const counts = (await pool.query(
                `SELECT status, count(*)::int AS n,
                        min(created_at) FILTER (WHERE status IN ('pending', 'failed')) AS oldest_waiting
                   FROM integration_outbox GROUP BY status`)).rows;
            const by = Object.fromEntries(OUTBOX_STATUSES.map((s) => [s, 0]));
            let oldestWaiting = null;
            for (const r of counts) {
                by[r.status] = r.n;
                if (r.oldest_waiting && (!oldestWaiting || r.oldest_waiting < oldestWaiting)) {oldestWaiting = r.oldest_waiting;}
            }
            const ageSeconds = oldestWaiting
                ? Math.max(0, Math.floor((Date.now() - new Date(oldestWaiting).getTime()) / 1000))
                : 0;
            outbox = {
                by_status: by,
                pending: by.pending,
                failed: by.failed,
                dead_letter: by.dead_letter,
                oldest_pending_age_seconds: ageSeconds,
            };
        } catch (error) {
            if (!error || error.code !== '42P01') {throw error;}
            infra = { migration_145: false };
        }
        res.json({
            providers,
            outbox,
            infra,
            zatca: await readZatcaHealth(),
            generated_at: new Date().toISOString(),
        });
    } catch (error) {
        return dbFail(res, error, 'health');
    }
});

router.get('/providers', canView, generalLimiter, async (req, res) => {
    try {
        res.json({ providers: await loadProviderRows() });
    } catch (error) {
        return dbFail(res, error, 'providers');
    }
});

router.put('/providers/:code/settings', canWriteSettings, crudLimiter, async (req, res) => {
    const code = String(req.params.code || '');
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
        return fail(res, 422, 'INVALID_ENABLED', 'enabled يجب أن تكون true أو false.');
    }
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const provider = (await client.query(
            `SELECT code, name_ar, name_en, verification, is_enabled, evidence_note, last_verified_at
               FROM integration_providers WHERE code = $1 FOR UPDATE`, [code])).rows[0];
        if (!provider) {
            await client.query('ROLLBACK');
            return fail(res, 404, 'PROVIDER_NOT_FOUND', 'المزوّد غير مسجّل.');
        }
        if (enabled && !canEnableProvider(provider)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'PROVIDER_NOT_VERIFIED', 'لا يمكن تفعيل مزوّد قبل التحقق الموثّق من قبوله.');
        }
        if (provider.is_enabled !== enabled) {
            await client.query('UPDATE integration_providers SET is_enabled = $2 WHERE code = $1', [code, enabled]);
            await writeInternalEvent(client, {
                providerCode: code,
                actorId: actorOf(req),
                metadata: { action: 'provider.enabled', field: 'is_enabled', from: provider.is_enabled, to: enabled },
            });
        }
        await client.query('COMMIT');
        res.json({ ok: true, provider: publicProvider({ ...provider, is_enabled: enabled }) });
    } catch (error) {
        if (client) {await client.query('ROLLBACK').catch(() => {});}
        return dbFail(res, error, 'provider-settings');
    } finally {
        if (client) {client.release();}
    }
});

router.put('/credentials/:provider/:key', canWriteSettings, crudLimiter, async (req, res) => {
    const providerCode = String(req.params.provider || '');
    const keyName = String(req.params.key || '');
    const value = req.body?.value;
    if (!KEY_NAME_RE.test(keyName)) {
        return fail(res, 422, 'INVALID_KEY_NAME', 'اسم المفتاح يجب أن يبدأ بحرف لاتيني صغير.');
    }
    if (typeof value !== 'string' || value.length < 8 || value.length > 8192) {
        return fail(res, 422, 'INVALID_SECRET', 'قيمة الاعتماد مطلوبة بطول 8 إلى 8192 حرفًا.');
    }
    if (String(process.env.VAULT_KEY || '').length < 32) {
        return fail(res, 503, 'CREDENTIAL_VAULT_UNAVAILABLE', 'خزنة الاعتمادات غير مهيّأة — يجب ضبط VAULT_KEY.');
    }
    let client;
    try {
        const provider = (await pool.query(
            'SELECT code FROM integration_providers WHERE code = $1', [providerCode])).rows[0];
        if (!provider) {return fail(res, 404, 'PROVIDER_NOT_FOUND', 'المزوّد غير مسجّل.');}

        const ciphertext = encryptForVault(value);
        if (!ciphertext) {
            return fail(res, 503, 'CREDENTIAL_VAULT_UNAVAILABLE', 'خزنة الاعتمادات غير مهيّأة — يجب ضبط VAULT_KEY.');
        }
        client = await pool.connect();
        await client.query('BEGIN');
        const revoked = await client.query(
            `UPDATE integration_credentials SET revoked_at = now()
              WHERE provider_code = $1 AND key_name = $2 AND revoked_at IS NULL`,
            [providerCode, keyName]);
        const inserted = await client.query(
            `INSERT INTO integration_credentials (provider_code, key_name, ciphertext, created_by)
             VALUES ($1, $2, $3, $4) RETURNING id, rotated_at`,
            [providerCode, keyName, ciphertext, actorOf(req)]);
        await writeInternalEvent(client, {
            providerCode,
            actorId: actorOf(req),
            metadata: { action: 'credential.rotated', key_name: keyName, rotated: revoked.rowCount > 0 },
        });
        await client.query('COMMIT');
        res.status(201).json({
            ok: true,
            key_name: keyName,
            rotated_at: inserted.rows[0].rotated_at,
            rotated: revoked.rowCount > 0,
        });
    } catch (error) {
        if (client) {await client.query('ROLLBACK').catch(() => {});}
        return dbFail(res, error, 'credential-write');
    } finally {
        if (client) {client.release();}
    }
});

router.get('/outbox', canView, generalLimiter, async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const provider = req.query.provider ? String(req.query.provider) : null;
    if (status && !OUTBOX_STATUSES.includes(status)) {
        return fail(res, 422, 'INVALID_STATUS', 'حالة الصادر غير معروفة.');
    }
    const limit = clampLimit(req.query.limit, 50, 200);
    const where = [];
    const params = [];
    if (status) {params.push(status); where.push(`status = $${params.length}::integration_outbox_status`);}
    if (provider) {params.push(provider); where.push(`provider_code = $${params.length}`);}
    params.push(limit);
    const sql = `SELECT id, provider_code, event_type, aggregate_type, aggregate_id, status,
                        attempts, max_attempts, next_attempt_at, created_at, delivered_at,
                        last_error_code, payload_sha256
                   FROM integration_outbox
                  ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                  ORDER BY created_at DESC, id DESC
                  LIMIT $${params.length}`;
    try {
        const rows = (await pool.query(sql, params)).rows.map(publicOutboxRow);
        res.json({ rows, limit });
    } catch (error) {
        return dbFail(res, error, 'outbox-list');
    }
});

router.post('/outbox/:id/retry', canSubmit, crudLimiter, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {return fail(res, 422, 'INVALID_ID', 'معرف الصادر غير صحيح.');}
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const row = (await client.query(
            'SELECT * FROM integration_outbox WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!row) {
            await client.query('ROLLBACK');
            return fail(res, 404, 'OUTBOX_NOT_FOUND', 'صف الصادر غير موجود.');
        }
        if (!['failed', 'dead_letter'].includes(row.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'OUTBOX_NOT_RETRYABLE', 'هذا الصف ليس في حالة تسمح بإعادة المحاولة.');
        }
        const created = await enqueueRetry(client, row, actorOf(req), req.requestId ?? null);
        await writeInternalEvent(client, {
            outboxId: created.id,
            providerCode: row.provider_code,
            actorId: actorOf(req),
            metadata: { action: 'outbox.retry', source_id: id, idempotency_key: created.idempotency_key },
        });
        await client.query('COMMIT');
        res.status(201).json({ ok: true, id: created.id, idempotency_key: created.idempotency_key });
    } catch (error) {
        if (client) {await client.query('ROLLBACK').catch(() => {});}
        return dbFail(res, error, 'outbox-retry');
    } finally {
        if (client) {client.release();}
    }
});

router.post('/outbox/:id/review', canReview, crudLimiter, async (req, res) => {
    const id = Number(req.params.id);
    const decision = req.body?.decision;
    const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
    if (!Number.isInteger(id) || id <= 0) {return fail(res, 422, 'INVALID_ID', 'معرف الصادر غير صحيح.');}
    if (!['retry', 'abandon'].includes(decision)) {
        return fail(res, 422, 'INVALID_DECISION', 'القرار يجب أن يكون retry أو abandon.');
    }
    if (reason.length < 3) {return fail(res, 422, 'REASON_REQUIRED', 'سبب المراجعة مطلوب.');}
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const row = (await client.query(
            'SELECT * FROM integration_outbox WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!row) {
            await client.query('ROLLBACK');
            return fail(res, 404, 'OUTBOX_NOT_FOUND', 'صف الصادر غير موجود.');
        }
        if (row.status !== 'dead_letter') {
            await client.query('ROLLBACK');
            return fail(res, 409, 'OUTBOX_NOT_REVIEWABLE', 'المراجعة تخص صفوف dead_letter فقط.');
        }
        if (isSelfReview(req.user, row)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'SELF_REVIEW_FORBIDDEN', 'لا يعتمد المراجع نتيجة صفًا أنشأه هو.');
        }
        if (decision === 'abandon') {
            await client.query(
                `UPDATE integration_outbox SET status = 'cancelled' WHERE id = $1`, [id]);
            await writeInternalEvent(client, {
                outboxId: id,
                providerCode: row.provider_code,
                actorId: actorOf(req),
                metadata: { action: 'outbox.review', decision, reason },
            });
            await client.query('COMMIT');
            return res.json({ ok: true, id, status: 'cancelled' });
        }
        const created = await enqueueRetry(client, row, actorOf(req), req.requestId ?? null);
        await writeInternalEvent(client, {
            outboxId: created.id,
            providerCode: row.provider_code,
            actorId: actorOf(req),
            metadata: { action: 'outbox.review', decision, reason, source_id: id },
        });
        await client.query('COMMIT');
        res.status(201).json({ ok: true, id: created.id, idempotency_key: created.idempotency_key });
    } catch (error) {
        if (client) {await client.query('ROLLBACK').catch(() => {});}
        return dbFail(res, error, 'outbox-review');
    } finally {
        if (client) {client.release();}
    }
});

router.get('/events', canView, generalLimiter, async (req, res) => {
    const outboxId = req.query.outbox_id ? Number(req.query.outbox_id) : null;
    if (outboxId !== null && (!Number.isInteger(outboxId) || outboxId <= 0)) {
        return fail(res, 422, 'INVALID_ID', 'معرف الصادر غير صحيح.');
    }
    const limit = clampLimit(req.query.limit, 20, 100);
    try {
        const query = outboxId === null
            ? `SELECT id, outbox_id, provider_code, direction, outcome, attempt, http_status,
                      duration_ms, error_code, occurred_at, actor_user_id, metadata
                 FROM integration_events
                ORDER BY occurred_at DESC, id DESC
                LIMIT $1`
            : `SELECT id, outbox_id, provider_code, direction, outcome, attempt, http_status,
                      duration_ms, error_code, occurred_at, actor_user_id, metadata
                 FROM integration_events
                WHERE outbox_id = $1
                ORDER BY occurred_at DESC, id DESC
                LIMIT $2`;
        const params = outboxId === null ? [limit] : [outboxId, limit];
        const rows = (await pool.query(query, params)).rows.map(publicEventRow);
        res.json({ rows, limit });
    } catch (error) {
        return dbFail(res, error, 'events-list');
    }
});

module.exports = router;
