/**
 * whatsapp-engine/pipeline.js — خط استقبال الرسائل الواردة v5.0
 * ────────────────────────────────────────────────────────────────────────────
 * Event → تحقق → تطبيع → منع تكرار → حفظ → NLU → قواعد → ERP → AI → رد ذكي → تدقيق
 *
 * Enterprise-grade message processing pipeline:
 *   1. Media detection & download (image/video/audio/document)
 *   2. LID resolution (v7 WhatsApp protocol)
 *   3. Deduplication (wa_processed unique constraint)
 *   4. Rule matching (exact/contains/command)
 *   5. Free-text router (answer.js) — live ERP queries
 *   6. AI Chatbot (NLU + LLM) — intelligent conversational responses
 *   7. Sentiment-aware fallback — never leaves customer unanswered
 *   8. Stale message sweep — crash recovery
 */
'use strict';

const crypto = require('crypto');
const { logger } = require('../logger');
const store = require('./store');
const { normalizeText, firstMatch, isValidChatJid, isGroupJid, isLidJid, phoneDigitsOf, extractText } = require('./rules');
const { processNLU, getContext, updateContext } = require('./ai/nlu');
const { SmartAssistant } = require('./ai/smart-assistant');

function toInboxRecord(upsertMsg) {
    const key = upsertMsg?.key || {};
    const remoteJid = String(key.remoteJid || '');
    if (!isValidChatJid(remoteJid)) {return null;}
    if (key.fromMe) {return null;} // نتجاهل رسائل المحرك نفسه (منع حلقات الرد)
    const msgId = String(key.id || '');
    if (!msgId) {return null;}
    const body = extractText(upsertMsg);
    return {
        remoteJid,
        msgId,
        isGroup: isGroupJid(remoteJid),
        senderJid: String(key.participant || remoteJid),
        pushName: String(upsertMsg?.pushName || '').slice(0, 255),
        msgType: body ? 'text' : 'unsupported',
        body,
        tsMs: Number(upsertMsg?.messageTimestamp) ? Number(upsertMsg.messageTimestamp) * 1000 : Date.now(),
    };
}

// ─── Overflow protection — per-user rate limiting & DoS prevention ───
const _pipelineRate = new Map(); // jid -> { count, resetAt }
const PIPELINE_RATE_LIMIT = 50; // max messages per user per minute
const PIPELINE_RATE_WINDOW = 60 * 1000;

function _checkPipelineRate(jid) {
    const now = Date.now();
    const entry = _pipelineRate.get(jid);
    if (!entry || now > entry.resetAt) {
        _pipelineRate.set(jid, { count: 1, resetAt: now + PIPELINE_RATE_WINDOW });
        return true;
    }
    entry.count++;
    if (entry.count > PIPELINE_RATE_LIMIT) return false;
    return true;
}

// Cleanup pipeline rate limiter periodically
setInterval(() => {
    const now = Date.now();
    for (const [jid, entry] of _pipelineRate) {
        if (now > entry.resetAt) _pipelineRate.delete(jid);
    }
}, 5 * 60 * 1000).unref?.();

// ─── Concurrent processing limiter — prevent event loop saturation ───
let _activeProcessing = 0;
const MAX_CONCURRENT = 20;

/** معالجة رسالة واحدة — idempotent: التكرار يُكتشف قبل أي أثر جانبي */
async function processIncoming(engine, raw) {
    // ─── Overflow guard: limit concurrent processing ───
    if (_activeProcessing >= MAX_CONCURRENT) {
        logger.warn('[WHATSAPP] pipeline overflow — ' + _activeProcessing + ' concurrent, dropping message');
        return { skipped: true, reason: 'overflow_protection' };
    }
    _activeProcessing++;
    try {
        return await _processIncomingInner(engine, raw);
    } finally {
        _activeProcessing--;
    }
}

async function _processIncomingInner(engine, raw) {
    const rec = toInboxRecord(raw);
    if (!rec) {return { skipped: true };}

    // ─── Input sanitization — strip control characters ───
    if (rec.body) {
        rec.body = String(rec.body)
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // control chars
            .slice(0, 4000); // max message length
    }

    // ─── Rate limit per user (DoS protection) ───
    if (!_checkPipelineRate(rec.remoteJid)) {
        logger.warn('[WHATSAPP] rate limited: ' + rec.remoteJid);
        try {
            const out = await engine.sender.enqueue(rec.remoteJid,
                'عذرًا — تستقبل رسائل كثيرة في وقت قصير 🙏 حاول بعد دقيقة.',
                { clientKey: `rate:${rec.remoteJid}:${rec.msgId}`, replyToInbound: true });
            await store.markInbox(rec.remoteJid, 'replied', { replyOutboxId: out.id });
            try { engine.sender?.kick(); } catch (_) {}
        } catch (_) {}
        return { skipped: true, reason: 'rate_limited' };
    }

    if (!rec.body) {
        // ─── Media receive: image/video/audio/document/ptt → download + ack ───
        try {
            const media = require('./media');
            const found = media.detectMedia(raw?.message);
            if (found && found.kind && found.kind !== 'sticker') {
                const cfg = engine.getConfig ? engine.getConfig() : {};
                if (cfg.mediaEnabled !== false) {
                    const sock = engine.connection?.getSocket ? engine.connection.getSocket() : null;
                    const saved = await media.saveIncoming(sock, raw, found, {
                        maxMediaSizeMB: cfg.maxMediaSizeMB || 16,
                        mediaDir: cfg.mediaDir || process.env.WHATSAPP_MEDIA_DIR || 'C:/KarimData/whatsapp-media',
                    });
                    const inboxRec = {
                        ...rec, msgType: saved.kind === 'ptt' ? 'ptt' : saved.kind,
                        body: found.caption || '',
                        mediaType: saved.kind, mediaPath: saved.path, mediaMime: saved.mime,
                    };
                    const r = await store.insertInbox(inboxRec);
                    if (r.duplicate) {return { duplicate: true };}
                    if (await store.chatAutoReply(rec.remoteJid)) {
                        const ack = media.buildMediaAck(saved.kind, found.caption);
                        const out = await engine.sender.enqueue(rec.remoteJid, ack, {
                            clientKey: `media-ack:${rec.remoteJid}:${rec.msgId}`, replyToInbound: true,
                        });
                        await store.markInbox(r.id, 'replied', { replyOutboxId: out.id });
                        try { engine.sender?.kick(); } catch (_) {}
                        try { await store.logEvent('media_received', rec.remoteJid, `${saved.kind} ${(saved.size / 1024).toFixed(0)}KB`); } catch (_) {}
                        return { processed: true, matched: true, replied: true, outboxId: out.id, via: 'media-ack' };
                    }
                    await store.markInbox(r.id, 'processed');
                    return { processed: true, autoReply: false, media: true };
                }
            }
        } catch (e) {
            try { logger.warn('[WHATSAPP] media receive failed, marking unsupported: ' + String(e.message).slice(0, 120)); } catch (_) {}
        }
        // غير نصية بلا ميديا مدعومة (ملصق/موقع/...) — تُسجل بلا رد
        const r = await store.insertInbox({ ...rec, msgType: 'unsupported', body: '' });
        if (!r.duplicate) {await store.markInbox(r.id, 'processed');}
        return { skipped: true, unsupported: true };
    }
    // v7: حل LID إلى رقم الهاتف قبل الحفظ (للعرض والتحقق) — لا يوقف المعالجة عند الفشل
    try {
        if (isLidJid(rec.remoteJid) && engine.connection?.resolvePN) {
            rec.senderPn = await engine.connection.resolvePN(rec.remoteJid);
        }
        if (!rec.isGroup && !isLidJid(rec.senderJid) && !rec.senderPn) {rec.senderPn = phoneDigitsOf(rec.senderJid);}
        if (!rec.isGroup && rec.senderPn) {rec.senderJid = `${rec.senderPn}@s.whatsapp.net`;}
    } catch (_) {}
    const saved = await store.insertInbox(rec);
    if (saved.duplicate) {return { duplicate: true };}
    const inboxId = saved.id;
    try {
        if (!(await store.chatAutoReply(rec.remoteJid))) {
            await store.markInbox(inboxId, 'processed');
            return { processed: true, autoReply: false };
        }
        const rules = await store.listRules();
        const hit = firstMatch(rules, rec.body);
        if (!hit) {
            // ─── Step 1: NLU analysis for intent detection ───
            let nluResult = null;
            try {
                nluResult = await processNLU(rec.body, rec.remoteJid);
            } catch (e) {
                logger.debug('[WHATSAPP] NLU analysis failed: ' + String(e.message).slice(0, 100));
            }

            // ─── Step 2: Disambiguation — if NLU is ambiguous, ask clarifying question ───
            if (nluResult?.clarification) {
                try {
                    const out = await engine.sender.enqueue(rec.remoteJid, nluResult.clarification, {
                        clientKey: `nlu-clarify:${rec.remoteJid}:${rec.msgId}`, replyToInbound: true,
                    });
                    await store.markInbox(inboxId, 'replied', { replyOutboxId: out.id });
                    try { engine.sender?.kick(); } catch (_) {}
                    try { await store.logEvent('nlu_clarify', rec.remoteJid, nluResult.intent); } catch (_) {}
                    return { processed: true, matched: true, replied: true, outboxId: out.id, via: 'nlu-clarify' };
                } catch (e) {
                    logger.warn('[WHATSAPP] NLU clarify failed: ' + String(e.message).slice(0, 120));
                }
            }

            // ─── Step 2: Smart Assistant — Unified intelligent response ───
            try {
                const smartAssistant = engine.smartAssistant;
                if (smartAssistant?.enabled) {
                    const saResponse = await smartAssistant.respond(rec.remoteJid, rec.body, {
                        customerName: rec.pushName || undefined,
                        isManager: false, // SmartAssistant handles permissions internally
                    });
                    if (saResponse?.text) {
                        try { await store.logEvent('smart_assistant_reply', rec.remoteJid, `intent:${nluResult?.intent || 'UNKNOWN'} source:${saResponse.source}`); } catch (_) {}
                        const out = await engine.sender.enqueue(rec.remoteJid, String(saResponse.text).slice(0, 4000), {
                            clientKey: `smart:${rec.remoteJid}:${rec.msgId}`, replyToInbound: true,
                        });
                        await store.markInbox(inboxId, 'replied', { replyOutboxId: out.id });
                        try { engine.sender?.kick(); } catch (_) {}
                        return { processed: true, matched: true, replied: true, outboxId: out.id, via: 'smart', nlu: nluResult, source: saResponse.source };
                    }
                }
            } catch (e) { logger.warn('[WHATSAPP] SmartAssistant failed: ' + String(e.message).slice(0, 150)); }

            // ─── Step 3 (fallback): Free-text router — live ERP queries ───
            try {
                const router = require('./answer');
                const free = await router.answerFreeText(engine, rec.body, rec);
                if (free) {
                    try { await store.logEvent('router_match', `${rec.remoteJid}`, String(rec.body).slice(0, 80)); } catch (_) {}
                    // Update conversation context with the router reply
                    if (nluResult) { updateContext(rec.remoteJid, nluResult, free); }
                    const out = await engine.sender.enqueue(rec.remoteJid, String(free).slice(0, 4000), {
                        clientKey: `router:${rec.remoteJid}:${rec.msgId}`, replyToInbound: true,
                    });
                    await store.markInbox(inboxId, 'replied', { replyOutboxId: out.id });
                    try { engine.sender?.kick(); } catch (_) {}
                    return { processed: true, matched: true, replied: true, outboxId: out.id, via: 'router' };
                }
            } catch (e) { logger.warn('[WHATSAPP] router fallback failed: ' + String(e.message).slice(0, 150)); }

            // ─── Step 4 (fallback): AI Chatbot — NLU + LLM for intelligent conversation ───
            try {
                const aiChatbot = engine.aiChatbot;
                if (aiChatbot?.enabled) {
                    const aiResponse = await aiChatbot.respond(rec.remoteJid, rec.body, {
                        customerName: rec.pushName || undefined,
                    });
                    if (aiResponse?.text) {
                        try { await store.logEvent('ai_reply', rec.remoteJid, `intent:${nluResult?.intent || 'UNKNOWN'}`); } catch (_) {}
                        const out = await engine.sender.enqueue(rec.remoteJid, String(aiResponse.text).slice(0, 4000), {
                            clientKey: `ai:${rec.remoteJid}:${rec.msgId}`, replyToInbound: true,
                        });
                        await store.markInbox(inboxId, 'replied', { replyOutboxId: out.id });
                        try { engine.sender?.kick(); } catch (_) {}
                        return { processed: true, matched: true, replied: true, outboxId: out.id, via: 'ai', nlu: nluResult };
                    }
                }
            } catch (e) { logger.warn('[WHATSAPP] AI chatbot failed: ' + String(e.message).slice(0, 150)); }

            // ─── Step 5: Sentiment-aware fallback — never leaves customer unanswered ───
            try {
                let fallbackMsg = 'عذرًا، لم أفهم رسالتك تماماً 🤖\nأرسل «مساعدة» لعرض كل ما أقدر أجاوب عليه (تقرير، مخزون، حضور، موظفين، كاشيرية...).';
                // If sentiment is negative, use a more empathetic message
                if (nluResult?.sentiment?.label === 'negative' || nluResult?.sentiment?.label === 'angry') {
                    fallbackMsg = 'أعتذر جداً 🙏 — لم أفهم رسالتك تماماً، لكنني هنا لمساعدتك.\nأرسل «مساعدة» لعرض الأوامر المتاحة.';
                }
                const out = await engine.sender.enqueue(rec.remoteJid, fallbackMsg,
                    { clientKey: `fallback:${rec.remoteJid}:${rec.msgId}`, replyToInbound: true });
                await store.markInbox(inboxId, 'replied', { replyOutboxId: out.id });
                try { engine.sender?.kick(); } catch (_) {}
                return { processed: true, matched: false, replied: true, outboxId: out.id, via: 'fallback' };
            } catch (e2) {
                logger.warn('[WHATSAPP] fallback reply failed: ' + String(e2.message).slice(0, 150));
            }
            await store.markInbox(inboxId, 'processed');
            return { processed: true, matched: false };
        }
        const erp = require('./erp');
        const replyText = await erp.buildReply(engine, hit, rec);
        try { await store.logEvent('rule_match', `${rec.remoteJid}`, `${hit.rule.name}`); } catch (_) {}
        if (!replyText) {
            try {
                const out = await engine.sender.enqueue(rec.remoteJid,
                    'عذرًا، تعذر تنفيذ هذا الأمر حاليًا. أرسل «مساعدة» لعرض الأوامر المتاحة.',
                    { clientKey: `fallback-cmd:${rec.remoteJid}:${rec.msgId}`, replyToInbound: true });
                await store.markInbox(inboxId, 'replied', { ruleId: hit.rule.id, replyOutboxId: out.id });
                try { engine.sender?.kick(); } catch (_) {}
                return { processed: true, matched: true, replied: true, outboxId: out.id, via: 'fallback-cmd' };
            } catch (_) {}
            await store.markInbox(inboxId, 'processed', { ruleId: hit.rule.id });
            return { processed: true, matched: true, replied: false };
        }
        const clientKey = `reply:${rec.remoteJid}:${rec.msgId}`;
        const out = await engine.sender.enqueue(rec.remoteJid, replyText.slice(0, 4000), {
            clientKey, replyToInbound: true,
        });
        await store.markInbox(inboxId, 'replied', { ruleId: hit.rule.id, replyOutboxId: out.id });
        try { engine.sender?.kick(); } catch (_) {}
        return { processed: true, matched: true, replied: true, outboxId: out.id };
    } catch (e) {
        await store.markInbox(inboxId, 'failed', { error: String(e.message).slice(0, 300) });
        logger.error('[WHATSAPP] pipeline failed: ' + String(e.message).slice(0, 200));
        return { failed: true };
    }
}

function clientKeyFor(remoteJid, body) {
    return `send:${remoteJid}:` + crypto.createHash('sha256').update(String(body)).digest('hex').slice(0, 32);
}

/**
 * sweepStale — كنْس الرسائل العالقة: واردة بحالة received منذ +2 دقيقة
 * (تحطم بين الحفظ والرد). نصية فقط، بحد 20، عبر نفس القواعد والطابور.
 * آمنة: wa_processed يمنع الازدواج، والرد idempotent عبر clientKey ثابت.
 */
async function sweepStale(engine, { olderThanMin = 2, limit = 20 } = {}) {
    const { pool } = require('../shared-pool');
    const r = await pool.query(
        `SELECT id, remote_jid, body FROM wa_inbox
          WHERE status = 'received' AND msg_type = 'text'
            AND created_at < NOW() - ($1 || ' minutes')::interval
          ORDER BY created_at LIMIT $2`,
        [Math.max(1, olderThanMin), Math.max(1, Math.min(50, limit))]
    );
    let swept = 0;
    for (const row of r.rows) {
        try {
            if (!(await store.chatAutoReply(row.remote_jid))) {
                await store.markInbox(row.id, 'processed');
                swept++;
                continue;
            }
            const rules = await store.listRules();
            const { firstMatch } = require('./rules');
            const hit = firstMatch(rules, row.body || '');
            if (!hit) {
                await store.markInbox(row.id, 'processed');
                swept++;
                continue;
            }
            const erp = require('./erp');
            const replyText = await erp.buildReply(engine, hit, { remoteJid: row.remote_jid, body: row.body });
            const out = await engine.sender.enqueue(row.remote_jid, replyText, {
                clientKey: `sweep:${row.remote_jid}:${row.id}`, replyToInbound: true,
            });
            await store.markInbox(row.id, 'replied', { ruleId: hit.id || hit.rule?.id, replyOutboxId: out.id });
            swept++;
        } catch (e) {
            try { await store.markInbox(row.id, 'failed', { error: 'sweep:' + String(e.message).slice(0, 200) }); } catch (_) {}
        }
    }
    if (swept) {try { await store.logEvent('sweep', 'stale', `reprocessed ${swept}`); } catch (_) {}}
    return swept;
}

module.exports = { toInboxRecord, processIncoming, clientKeyFor, sweepStale };
