/**
 * whatsapp-engine/store.js — طبقة الحفظ في PostgreSQL (لا SQLite)
 * ────────────────────────────────────────────────────────────────────────────
 * كل الكتابات عبر pool المشترك. منع الازدواج بقيود UNIQUE + ON CONFLICT.
 */
'use strict';

const { pool } = require('../shared-pool');

/** تسجيل رسالة واردة — يعيد {id, duplicate} (التكرار يُكتشف بـ wa_processed) */
async function insertInbox(msg) {
    const claimed = await pool.query(
        `INSERT INTO wa_processed (remote_jid, msg_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *`,
        [msg.remoteJid, msg.msgId]
    );
    if (!claimed.rows.length) {return { id: null, duplicate: true };}
    const r = await pool.query(
        `INSERT INTO wa_inbox (remote_jid, msg_id, is_group, sender_jid, sender_pushname, msg_type, body, ts_ms, status, media_type, media_path, media_mime)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'received',$9,$10,$11) RETURNING id`,
        [msg.remoteJid, msg.msgId, !!msg.isGroup, msg.senderJid || null, msg.pushName || null,
         msg.msgType || 'text', msg.body || null, msg.tsMs || null,
         msg.mediaType || null, msg.mediaPath || null, msg.mediaMime || null]
    );
    return { id: r.rows[0].id, duplicate: false };
}

async function markInbox(id, status, extra = {}) {
    await pool.query(
        `UPDATE wa_inbox SET status = $2::varchar, rule_id = COALESCE($3::bigint, rule_id),
            reply_outbox_id = COALESCE($4::bigint, reply_outbox_id), error = COALESCE($5::text, error),
            processed_at = CASE WHEN $2::varchar IN ('processed','failed','replied') THEN NOW() ELSE processed_at END
         WHERE id = $1`,
        [id, status, extra.ruleId || null, extra.replyOutboxId || null, extra.error || null]
    );
}

/** إدراج رسالة صادرة — idempotent عبر client_key (يدعم نص أو ميديا) */
async function enqueueOutbox({ clientKey, remoteJid, body, createdBy, mediaType, mediaPath, caption }) {
    const r = await pool.query(
        `INSERT INTO wa_outbox (client_key, remote_jid, body, status, created_by, media_type, media_path, caption)
         VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7)
         ON CONFLICT (client_key) DO UPDATE SET body = EXCLUDED.body RETURNING id, status`,
        [clientKey, remoteJid, body || '', createdBy || null, mediaType || null, mediaPath || null, caption || null]
    );
    return r.rows[0];
}

async function dueOutbox(limit = 20) {
    const r = await pool.query(
                `WITH recovered AS (
                        UPDATE wa_outbox
                             SET status = 'failed', last_error = 'WORKER_LEASE_EXPIRED', next_retry_at = NOW()
                         WHERE status = 'sending'
                             AND COALESCE(next_retry_at, created_at + INTERVAL '15 minutes') <= NOW()
                        RETURNING id
                 ), candidates AS (
                        SELECT id FROM wa_outbox
                        WHERE status IN ('pending','failed')
                            AND (next_retry_at IS NULL OR next_retry_at <= NOW())
                        ORDER BY created_at
                        LIMIT $1
                        FOR UPDATE SKIP LOCKED
                 )
                 UPDATE wa_outbox AS o
                        SET status = 'sending', attempts = COALESCE(o.attempts, 0) + 1,
                            next_retry_at = NOW() + INTERVAL '15 minutes'
                     FROM candidates
                    WHERE o.id = candidates.id
                RETURNING o.*`, [Math.max(1, Math.min(100, Number(limit) || 20))]
    );
    return r.rows;
}

async function setOutbox(id, patch) {
    const keys = [];
    const vals = [id];
    const set = (col, v) => { vals.push(v); keys.push(`${col} = $${vals.length}`); };
    if (patch.status) {set('status', patch.status);}
    if (patch.attempts !== undefined) {set('attempts', patch.attempts);}
    if (patch.nextRetryAt !== undefined) {set('next_retry_at', patch.nextRetryAt);}
    if (patch.lastError !== undefined) {set('last_error', patch.lastError);}
    if (patch.sentMsgId !== undefined) {set('sent_msg_id', patch.sentMsgId);}
    if (patch.sentAt) {keys.push(`sent_at = NOW()`);}
    if (!keys.length) {return;}
    await pool.query(`UPDATE wa_outbox SET ${keys.join(', ')} WHERE id = $1`, vals);
}

async function listRules() {
    const r = await pool.query(`SELECT * FROM wa_rules WHERE enabled = true ORDER BY priority, id`);
    return r.rows;
}
async function upsertRule(rule) {
    // تقبل matchType (camel) و match_type (snake — ما ترسله الواجهة فعلًا)
    const matchType = rule.matchType ?? rule.match_type;
    if (rule.id) {
        const r = await pool.query(
            `UPDATE wa_rules SET name=$2, match_type=$3, pattern=$4, response=$5, enabled=COALESCE($6,enabled), priority=COALESCE($7,priority), updated_at=NOW()
             WHERE id=$1 RETURNING *`,
            [rule.id, rule.name, matchType, rule.pattern, rule.response || '', rule.enabled, rule.priority]
        );
        return r.rows[0] || null;
    }
    const r = await pool.query(
        `INSERT INTO wa_rules (name, match_type, pattern, response, enabled, priority)
         VALUES ($1,$2,$3,$4,COALESCE($5,true),COALESCE($6,100)) RETURNING *`,
        [rule.name, matchType, rule.pattern, rule.response || '', rule.enabled, rule.priority]
    );
    return r.rows[0];
}
async function deleteRule(id) {
    await pool.query(`UPDATE wa_rules SET enabled = false, updated_at = NOW() WHERE id = $1`, [id]);
}

async function chatAutoReply(remoteJid) {
    const r = await pool.query(`SELECT auto_reply FROM wa_chat_settings WHERE remote_jid = $1`, [remoteJid]);
    if (!r.rows.length) {return true;}
    return !!r.rows[0].auto_reply;
}
async function setChatAutoReply(remoteJid, enabled) {
    await pool.query(
        `INSERT INTO wa_chat_settings (remote_jid, auto_reply, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (remote_jid) DO UPDATE SET auto_reply = EXCLUDED.auto_reply, updated_at = NOW()`,
        [remoteJid, !!enabled]
    );
}

/** إعدادات المحرك (key/value) — أرقام الإدارة: key='manager_jids' JSON */
async function getSetting(key) {
    const r = await pool.query(`SELECT value FROM wa_settings WHERE key = $1`, [key]);
    return r.rows[0]?.value ?? null;
}
async function setSetting(key, value) {
    await pool.query(
        `INSERT INTO wa_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, String(value ?? '')]
    );
}
/** أرقام الإدارة (مصفوفة أرقام نظيفة) — من القاعدة أولًا ثم البيئة كاحتياطي */
async function managerJids() {
    const out = [];
    try {
        const raw = await getSetting('manager_jids');
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {for (const x of arr) {
                const d = String(x || '').replace(/\D/g, '');
                if (d.length >= 7 && !out.includes(d)) {out.push(d);}
            }}
        }
    } catch (_) {}
    if (!out.length) {
        for (const s of String(process.env.WHATSAPP_MANAGER_JIDS || '').split(',')) {
            const d = s.replace(/\D/g, '');
            if (d.length >= 7 && !out.includes(d)) {out.push(d);}
        }
    }
    return out;
}

async function logEvent(kind, ref, detail) {
    try {
        await pool.query(`INSERT INTO wa_events (kind, ref, detail) VALUES ($1, $2, $3)`,
            [kind, ref ? String(ref).slice(0, 200) : null, detail ? String(detail).slice(0, 2000) : null]);
    } catch (_) { /* التشخيص لا يكسر التشغيل */ }
}

async function inboxList({ status, q, page = 1, limit = 20 }) {
    const conds = [];
    const params = [];
    if (status) { params.push(status); conds.push(`i.status = $${params.length}`); }
    if (q) { params.push(`%${q}%`); conds.push(`(i.remote_jid ILIKE $${params.length} OR i.body ILIKE $${params.length} OR i.msg_id ILIKE $${params.length})`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = (await pool.query(`SELECT COUNT(*)::int AS c FROM wa_inbox ${where}`, params)).rows[0].c;
    const rows = (await pool.query(
        `SELECT i.*, m.assigned_to, m.status AS chat_status, m.priority AS chat_priority,
                m.tags AS chat_tags, m.internal_note
           FROM wa_inbox i
           LEFT JOIN wa_chat_meta m ON m.remote_jid = i.remote_jid
           ${where} ORDER BY i.created_at DESC LIMIT ${Math.min(100, Math.max(5, limit))} OFFSET ${(Math.max(1, page) - 1) * limit}`,
        params)).rows;
    return { total, rows };
}

async function updateChatMeta(remoteJid, patch, updatedBy) {
    const tags = Array.isArray(patch.tags) ? [...new Set(patch.tags.map((x) => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 20) : null;
    const r = await pool.query(
        `INSERT INTO wa_chat_meta (remote_jid, assigned_to, status, priority, tags, internal_note, updated_by)
         VALUES ($1,$2,COALESCE($3,'open'),COALESCE($4,'normal'),COALESCE($5::jsonb,'[]'::jsonb),$6,$7)
         ON CONFLICT (remote_jid) DO UPDATE SET
           assigned_to = COALESCE($2, wa_chat_meta.assigned_to),
           status = COALESCE($3, wa_chat_meta.status),
           priority = COALESCE($4, wa_chat_meta.priority),
           tags = COALESCE($5::jsonb, wa_chat_meta.tags),
           internal_note = COALESCE($6, wa_chat_meta.internal_note),
           updated_by = $7, updated_at = NOW()
         RETURNING *`,
        [String(remoteJid), patch.assignedTo ?? null, patch.status || null, patch.priority || null,
            tags ? JSON.stringify(tags) : null, patch.internalNote ?? null, updatedBy || null]
    );
    return r.rows[0];
}

async function metrics() {
    const r = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM wa_inbox WHERE status = 'received') AS inbox_pending,
          (SELECT COUNT(*)::int FROM wa_inbox WHERE status = 'failed') AS inbox_failed,
          (SELECT COUNT(*)::int FROM wa_inbox WHERE status = 'replied') AS inbox_replied,
          (SELECT COUNT(*)::int FROM wa_inbox) AS inbox_total,
          (SELECT COUNT(*)::int FROM wa_outbox WHERE status IN ('pending','failed') AND (next_retry_at IS NULL OR next_retry_at <= NOW())) AS outbox_due,
          (SELECT COUNT(*)::int FROM wa_outbox WHERE status = 'sent') AS outbox_sent,
          (SELECT COUNT(*)::int FROM wa_outbox WHERE status = 'failed' AND attempts >= 5) AS outbox_dead,
          (SELECT MAX(created_at) FROM wa_inbox WHERE status IN ('processed','replied')) AS last_processed_at`);
    return r.rows[0];
}

/** أول ظهور للجلسة (أساس جدول التهيئة) — يُثبَّت مرة واحدة ويبقى */
async function sessionFirstSeen() {
    const raw = await getSetting('wa_session_first_seen');
    if (raw) {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) {return d;}
    }
    const now = new Date().toISOString();
    await setSetting('wa_session_first_seen', now);
    return new Date(now);
}

/** سجل التواصل مع جهة: بارد = صفر وارد وصفر صادر (أخطر إشارة حظر) */
async function contactHistory(jid) {
    const r = await pool.query(
        `SELECT (SELECT COUNT(*)::int FROM wa_inbox WHERE remote_jid = $1) AS inbound,
                (SELECT COUNT(*)::int FROM wa_outbox WHERE remote_jid = $1 AND status IN ('sent','sending','pending','failed')) AS outbound`,
        [jid]
    );
    const row = r.rows[0] || { inbound: 0, outbound: 0 };
    return { inbound: row.inbound, outbound: row.outbound, cold: (row.inbound + row.outbound) === 0 };
}

/** عدد المرسل اليوم (بتوقيت قاعدة البيانات) */
async function sendsToday() {
    const r = await pool.query(
        `SELECT COUNT(*)::int AS c FROM wa_outbox WHERE status = 'sent' AND sent_at >= CURRENT_DATE`
    );
    return r.rows[0].c;
}

/** مرسل اليوم لجهات بلا أي وارد تاريخيًا (تقريب آمن للتواصل البارد) */
async function coldSendsToday() {
    const r = await pool.query(
        `SELECT COUNT(*)::int AS c FROM wa_outbox o
          WHERE o.status = 'sent' AND o.sent_at >= CURRENT_DATE
            AND NOT EXISTS (SELECT 1 FROM wa_inbox i WHERE i.remote_jid = o.remote_jid)`
    );
    return r.rows[0].c;
}

/** صادر حديث لفحص القصف الجماعي: [{jid, body, at}] */
async function recentOutbound(windowMin) {
    const r = await pool.query(
        `SELECT remote_jid AS jid, body, EXTRACT(EPOCH FROM created_at) * 1000 AS at
           FROM wa_outbox WHERE created_at >= NOW() - ($1 || ' minutes')::interval
          ORDER BY created_at DESC LIMIT 500`,
        [Math.max(1, Math.min(180, Number(windowMin) || 10))]
    );
    return r.rows.map((x) => ({ jid: x.jid, body: x.body || '', at: Number(x.at) }));
}

module.exports = {
    pool, insertInbox, markInbox, enqueueOutbox, dueOutbox, setOutbox,
    listRules, upsertRule, deleteRule, chatAutoReply, setChatAutoReply,
    getSetting, setSetting, managerJids,
    logEvent, inboxList, updateChatMeta, metrics,
    sessionFirstSeen, contactHistory, sendsToday, coldSendsToday, recentOutbound,
};
