/**
 * backend/realtime/recovery-routes.js — استعادة الأحداث الفائتة + ACK العملاء
 * ────────────────────────────────────────────────────────────────────────────
 * التوجيه v7.1 §13 + §5: الاستعادة تطبّق نفس فلتر التخويل الخاص بالبث الحي
 * (غياب تسلسل عند عميل ليس دليل فقد — فلتر الصلاحيات). ترقيم، حد أقصى،
 * rate limit، وتقرير كامل: deliveredUpTo/currentSequence/replayComplete/resyncRequired.
 */
'use strict';

const express = require('express');
const { pool } = require('../shared-pool');
const { jwtAuth } = require('../cashier-module/jwt-middleware');
const { logger } = require('../logger');
const { authorizeEventForUser } = require('./router');

const router = express.Router();

// عتبات RESYNC (§13) — قابلة للضبط من البيئة
const MAX_GAP_EVENTS = Math.max(100, Number(process.env.RT_MAX_GAP_EVENTS || 5000));
const MAX_GAP_HOURS = Math.max(1, Number(process.env.RT_MAX_GAP_HOURS || 24));
const MAX_LIMIT = 200;

// rate limit بسيط داخل العملية: (userId) → طوابع زمنية لطلبات الاستعادة
const recoveryHits = new Map();
const RECOVERY_WINDOW_MS = 60_000;
const RECOVERY_MAX_PER_MIN = Number(process.env.RT_RECOVERY_MAX_PER_MIN || 30);
function recoveryRateLimited(userId) {
    const now = Date.now();
    const arr = (recoveryHits.get(userId) || []).filter(t => now - t < RECOVERY_WINDOW_MS);
    arr.push(now);
    recoveryHits.set(userId, arr);
    if (recoveryHits.size > 5000) {recoveryHits.clear();} // حماية ذاكرة
    return arr.length > RECOVERY_MAX_PER_MIN;
}

function envelope(event) {
    return {
        eventId: event.event_id,
        sequence: Number(event.sequence),
        eventType: event.event_type,
        eventVersion: event.event_version,
        occurredAt: new Date(event.created_at).toISOString(),
        aggregateType: event.aggregate_type,
        aggregateId: event.aggregate_id,
        branchId: event.branch_id,
        target: (event.routing_metadata || {}).target || null,
        payload: event.payload || {},
    };
}

/** GET /api/rt/events?since=<seq>&limit=<n> — استعادة موثقة مخوّلة مرتبة */
router.get('/events', jwtAuth, async (req, res) => {
    try {
        const since = Math.max(0, Number(req.query.since) || 0);
        const limit = Math.max(1, Math.min(MAX_LIMIT, Number(req.query.limit) || 100));
        if (recoveryRateLimited(req.user.id)) {
            return res.status(429).json({ error: 'RECOVERY_RATE_LIMITED', message: 'طلبات استعادة كثيرة — أعد المحاولة بعد قليل' });
        }

        const seqRow = (await pool.query(`SELECT COALESCE(MAX(sequence),0)::bigint AS s FROM event_outbox`)).rows[0];
        const currentSequence = Number(seqRow?.s || 0);

        // الفجوة الزمنية للحدث غير المنشر الأقدم — مؤخر صندوق الصادر (قابلية ملاحظة §20)
        const lagRow = (await pool.query(
            `SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))),0)::float AS lag
              FROM event_outbox WHERE published_at IS NULL`)).rows[0];
        const outboxLagSeconds = Number(lagRow?.lag || 0);

        const { rows } = await pool.query(
            `SELECT * FROM event_outbox WHERE sequence > $1 ORDER BY sequence ASC LIMIT $2`,
            [since, limit * 3]); // سحب أوسع ثم فلترة التخويل — الغياب ليس فقدًا (§4)

        const authorized = [];
        for (const row of rows) {
            if (await authorizeEventForUser(row, req.user)) {authorized.push(envelope(row));}
            if (authorized.length >= limit) {break;}
        }

        const lastDelivered = authorized.length ? authorized[authorized.length - 1].sequence : since;
        const replayComplete = lastDelivered >= currentSequence;
        const gapEvents = Math.max(0, currentSequence - since);
        const oldestPending = (await pool.query(
            `SELECT COALESCE(MIN(EXTRACT(EPOCH FROM (NOW() - created_at))),0)::float AS age
              FROM event_outbox WHERE sequence > $1`, [since])).rows[0]?.age || 0;
        const resyncRequired = gapEvents > MAX_GAP_EVENTS || oldestPending > MAX_GAP_HOURS * 3600;

        res.json({
            events: authorized,
            deliveredUpTo: lastDelivered,
            currentSequence,
            replayComplete,
            resyncRequired,
            thresholds: { maxGapEvents: MAX_GAP_EVENTS, maxGapHours: MAX_GAP_HOURS, maxLimit: MAX_LIMIT },
            observability: { outboxLagSeconds },
        });
    } catch (e) {
        logger.error('[rt-recovery]', e);
        res.status(500).json({ error: 'RECOVERY_FAILED', message: 'تعذر جلب الأحداث الفائتة' });
    }
});

/** POST /api/rt/ack — اعتراف العميل بعد المعالجة الناجحة (§12: لا ACK قبل النجاح) */
router.post('/ack', jwtAuth, async (req, res) => {
    try {
        const installationId = String(req.body?.installationId || '').trim().slice(0, 128);
        const lastSequence = Math.max(0, Number(req.body?.lastSequence) || 0);
        if (!installationId) {
            return res.status(422).json({ error: 'INSTALLATION_ID_REQUIRED', message: 'معرف التثبيت مطلوب' });
        }
        // ربط الهوية: installation_id → جلسة موثقة → مستخدم (§17) — لا انتحال هوية
        await pool.query(
            `INSERT INTO client_event_ack (installation_id, user_id, last_sequence, updated_at)
             VALUES ($1,$2,$3,NOW())
             ON CONFLICT (installation_id) DO UPDATE
                SET last_sequence = GREATEST(client_event_ack.last_sequence, EXCLUDED.last_sequence),
                    user_id = EXCLUDED.user_id, updated_at = NOW()`,
            [installationId, req.user.id, lastSequence]);
        res.json({ ok: true });
    } catch (e) {
        logger.error('[rt-ack]', e);
        res.status(500).json({ error: 'ACK_FAILED', message: 'تعذر تسجيل الاعتراف' });
    }
});

/** GET /api/rt/health — صحة طبقة الأحداث (liveness لكل مكون §19) */
router.get('/health', jwtAuth, async (req, res) => {
    try {
        const pub = require('./publisher').outboxStats();
        const lag = (await pool.query(
            `SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))),0)::float AS lag
              FROM event_outbox WHERE published_at IS NULL`)).rows[0]?.lag || 0;
        res.json({ ok: true, publisher: pub, outboxLagSeconds: Number(lag) });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

/**
 * GET /api/rt/version — EXE compatibility handshake (TASK 10, public probe).
 * Client sends ?clientContract=N (default 1). Server answers compatible unless
 * the contract is older than supported. No auth (version probe, no data).
 */
const RT_API_CONTRACT = 1;
const RT_MIN_CLIENT = '4.7.0';
router.get('/version', async (req, res) => {
    try {
        const pkg = require('../../package.json');
        const clientContract = Number(req.query.clientContract || 1);
        const serverContract = RT_API_CONTRACT;
        const compatible = Number.isFinite(clientContract) && clientContract >= serverContract;
        res.json({
            compatible,
            minClientVersion: RT_MIN_CLIENT,
            apiContractVersion: serverContract,
            serverVersion: pkg.version || null,
        });
    } catch (e) {
        res.status(500).json({ compatible: false, error: e.message });
    }
});

module.exports = { router, RT_API_CONTRACT, RT_MIN_CLIENT };
