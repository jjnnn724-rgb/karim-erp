/**
 * backend/realtime/publisher.js — ناشر صندوق الصادر (Outbox Publisher)
 * ────────────────────────────────────────────────────────────────────────────
 * التوجيه v7.1 §7: ممنوع حبس قفل صف أثناء عمل الشبكة. النمط الإلزامي:
 *   1) اختيار الأحداث المؤهلة  2) معاملة قصيرة  3) FOR UPDATE SKIP LOCKED
 *   4) claim_id = worker  5) claimed_at = NOW()  6) COMMIT (تحرير الأقفال)
 *   7) البث خارج المعاملة ثم published_at — وعند الفشل attempts++/last_error/تحرير المطالبة.
 * استعادة المطالبات اليتيمة مدمجة عبر شرط الـ lease في نفس الاستعلام.
 */
'use strict';

const crypto = require('crypto');
const { roomsForEvent } = require('./router');

const WORKER_ID = crypto.randomUUID();
const LEASE_SECONDS = Number(process.env.RT_OUTBOX_LEASE_SECONDS || 30);
const BATCH_SIZE = Math.max(1, Math.min(200, Number(process.env.RT_OUTBOX_BATCH || 50)));
const INTERVAL_MS = Math.max(100, Number(process.env.RT_OUTBOX_INTERVAL_MS || 500));
const MAX_ATTEMPTS = Math.max(3, Number(process.env.RT_OUTBOX_MAX_ATTEMPTS || 20));

let running = false;
let timer = null;
let stats = { cycles: 0, published: 0, failed: 0, lastCycleAt: null, lastError: null };

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

async function publishCycle({ io, pool, logger }) {
    const client = await pool.connect();
    let claimed = [];
    try {
        // ── المعاملة القصيرة: المطالبة فقط ثم COMMIT فورًا (تحرير الأقفال) ──
        await client.query('BEGIN');
        const r = await client.query(
            `SELECT * FROM event_outbox
              WHERE published_at IS NULL
                AND attempts < $1
                AND (claim_id IS NULL OR claimed_at < NOW() - ($2 || ' seconds')::interval)
              ORDER BY sequence ASC
              LIMIT $3
              FOR UPDATE SKIP LOCKED`,
            [MAX_ATTEMPTS, String(LEASE_SECONDS), BATCH_SIZE]);
        claimed = r.rows;
        if (claimed.length) {
            await client.query(
                `UPDATE event_outbox SET claim_id = $1, claimed_at = NOW() WHERE id = ANY($2::bigint[])`,
                [WORKER_ID, claimed.map(e => e.id)]);
        }
        await client.query('COMMIT');
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        logger.error('[outbox-publisher] claim failed:', e.message);
        stats.lastError = e.message;
        return;
    } finally {
        client.release();
    }

    if (!claimed.length) {return;}

    // ── البث خارج أي معاملة قاعدة بيانات (LAW §7 خطوة 7) ──
    for (const event of claimed) {
        try {
            const env = envelope(event);
            const rooms = roomsForEvent(event);
            for (const room of rooms) {
                io.to(room).emit('domain_event', env);
            }
            // published_at = "سلّم الناشر حدثه لطبقة التوصيل" — لا يعني استلام العملاء (§5)
            await pool.query(
                `UPDATE event_outbox SET published_at = NOW(), claim_id = NULL WHERE id = $1 AND claim_id = $2`,
                [event.id, WORKER_ID]);
            stats.published += 1;
        } catch (e) {
            stats.failed += 1;
            stats.lastError = e.message;
            try {
                await pool.query(
                    `UPDATE event_outbox
                        SET attempts = attempts + 1, last_error = $2, claim_id = NULL, claimed_at = NULL
                      WHERE id = $1 AND claim_id = $3`,
                    [event.id, String(e.message || e).slice(0, 500), WORKER_ID]);
            } catch (e2) {
                logger.error('[outbox-publisher] failure-record failed:', e2.message);
            }
        }
    }
}

async function cycle({ io, pool, logger }) {
    if (running) {return;} // منع تداخل الدورات
    running = true;
    try {
        stats.cycles += 1;
        stats.lastCycleAt = new Date().toISOString();
        await publishCycle({ io, pool, logger });
    } catch (e) {
        logger.error('[outbox-publisher] cycle error:', e.message);
        stats.lastError = e.message;
    } finally {
        running = false;
    }
}

/**
 * تشغيل الناشر — يُستدعى مرة من server.js بعد جاهزية io.
 * الفحص المسبق لوجود الجدول: لم يُطبَّق الترحيل بعد ⇒ الناشر خامل بلا أخطاء.
 */
async function startOutboxPublisher({ io, pool, logger }) {
    try {
        const t = await pool.query(`SELECT to_regclass('public.event_outbox') AS t`);
        if (!t.rows[0] || !t.rows[0].t) {
            logger.warn('[outbox-publisher] event_outbox غير موجود — الترحيل 067 لم يُطبَّق؛ الناشر خامل');
            return { active: false };
        }
    } catch (e) {
        logger.warn('[outbox-publisher] تعذر فحص event_outbox — الناشر خامل:', e.message);
        return { active: false };
    }
    timer = setInterval(() => cycle({ io, pool, logger }).catch(() => {}), INTERVAL_MS);
    if (timer.unref) {timer.unref();}
    logger.info(`[outbox-publisher] نشط — worker=${WORKER_ID} batch=${BATCH_SIZE} interval=${INTERVAL_MS}ms`);
    return { active: true, workerId: WORKER_ID };
}

function stopOutboxPublisher() {
    if (timer) {clearInterval(timer); timer = null;}
}

function outboxStats() {
    return { ...stats, workerId: WORKER_ID, batchSize: BATCH_SIZE, intervalMs: INTERVAL_MS };
}

module.exports = { startOutboxPublisher, stopOutboxPublisher, outboxStats };
