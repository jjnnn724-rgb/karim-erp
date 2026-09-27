/**
 * backend/realtime/outbox.js — إدراج أحداث الدومين في صندوق الصادر المعاملاتي
 * ────────────────────────────────────────────────────────────────────────────
 * التوجيه v7.1 §6-A + §8 (LAW 08): طفرة العمل + إدراج الحدث = نفس معاملة
 * قاعدة البيانات. لا يُنشر أي شيء هنا — النشر مسؤولية publisher.js بعد الالتزام.
 *
 * الاستخدام:
 *   const { insertDomainEvent, tryInsertDomainEvent } = require('./realtime/outbox');
 *   // داخل معاملة مفتوحة (client من pool.connect() بعد BEGIN):
 *   await insertDomainEvent(client, {
 *       eventType: 'SALE_POSTED', aggregateType: 'sale', aggregateId: String(orderId),
 *       payload: { total, department_id }, routingMetadata: { rooms: [`dept:${deptId}`] },
 *   });
 */
'use strict';

const crypto = require('crypto');

/** تحقق مرة واحدة من وجود الجدول (يُخزَّن) — يتيح تشغيل الكود قبل تطبيق الترحيل دون كسر */
let tablePresence = null; // true | false | null (لم يُفحص)
async function ensureTableKnown(pool) {
    if (tablePresence !== null) {return tablePresence;}
    try {
        const r = await pool.query(`SELECT to_regclass('public.event_outbox') AS t`);
        tablePresence = Boolean(r.rows[0] && r.rows[0].t);
    } catch (_) { tablePresence = false; }
    return tablePresence;
}
/** يُستدعى بعد تطبيق الترحيل 067 لإعادة الكشف دون إعادة تشغيل (اختياري) */
function resetTablePresence() { tablePresence = null; }

/**
 * إدراج حدث دومين داخل معاملة مفتوحة — يرمي عند الفشل (فشل-مغلق).
 * @param {import('pg').PoolClient} client اتصال داخل معاملة مفتوحة
 */
async function insertDomainEvent(client, spec) {
    const eventType = String(spec.eventType || '').trim();
    if (!eventType) {throw new Error('OUTBOX_EVENT_TYPE_REQUIRED');}
    const eventVersion = Number.isInteger(spec.eventVersion) && spec.eventVersion > 0 ? spec.eventVersion : 1;
    const eventId = crypto.randomUUID();
    const r = await client.query(
        `INSERT INTO event_outbox
            (event_id, event_type, event_version, aggregate_type, aggregate_id,
             branch_id, payload, routing_metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
         RETURNING event_id, sequence`,
        [eventId, eventType, eventVersion, spec.aggregateType || null,
            spec.aggregateId != null ? String(spec.aggregateId) : null,
            spec.branchId != null ? Number(spec.branchId) : null,
            JSON.stringify(spec.payload || {}),
            JSON.stringify(spec.routingMetadata || {})]);
    return { eventId, sequence: Number(r.rows[0].sequence) };
}

/**
 * إدراج محمي — فشل-مفتوح لمرحلة الإثبات G1 (العقد C5/G1):
 * إذا لم يُطبَّق الترحيل 067 أو فشل الإدراج يُسجَّل تحذير وتكمل العملية
 * التجارية بلا تأثر — صفر انحدار. تُقلب إلى فشل-مغلق في بوابة G2.
 */
async function tryInsertDomainEvent(pool, client, spec) {
    try {
        if (!(await ensureTableKnown(pool))) {return null;}
        return await insertDomainEvent(client, spec);
    } catch (e) {
        try {
            require('../logger').logger.warn('[outbox] tryInsertDomainEvent skipped:',
                e.message, spec.eventType);
        } catch (_) {}
        // إعادة كشف إيجابي كاذب محتمل (جدول أُنشئ حديثًا) — امنح فرصة إعادة فحص
        if (e && (e.code === '42P01' || /does not exist/i.test(String(e.message)))) {tablePresence = false;}
        return null;
    }
}

module.exports = { insertDomainEvent, tryInsertDomainEvent, ensureTableKnown, resetTablePresence };
