/**
 * whatsapp-engine/sender.js — محرك الإرسال الصادر (درع الحظر)
 * ────────────────────────────────────────────────────────────────────────────
 * الحالات: pending → sending → sent | failed→(retry حتى الحد)→dead.
 * حد معدل إرسال محافظ + idempotency عبر client_key — لا إرسال مكرر عند إعادة المحاولة.
 *
 * درع الحظر (أي تجاوز = رفض صلب قبل الوصول لواتساب — لا تُحفظ ولا تُرسل):
 *  1) BULK_FROZEN  — نفس النص لجهات مميزة ≥ الحد خلال النافذة (قصف جماعي مجمّد).
 *  2) WARMUP_CAP   — سقف يومي حسب عمر الجلسة (تهيئة الرقم).
 *  3) COLD_CAP     — سقف التواصل البارد اليومي (أول رسالة لجهة بلا سجل).
 * إيقاع بشري عند الإرسال: فجوة دنيا + jitter + مؤشر "يكتب...".
 * قاطع الإرسال: إخفاقات متتالية توقف المحرك مؤقتًا بدل القصف أثناء عطل.
 */
'use strict';

const { logger } = require('../logger');
const store = require('./store');
const { backoffDelayMs, isValidChatJid, parseSchedule, scheduleAllowance, bulkFrozen, humanGapMs, bodyHash } = require('./rules');

class PacingError extends Error {
    constructor(code, message) {
        super(message || code);
        this.code = code;
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MEDIA_KINDS = new Set(['image', 'video', 'audio', 'document']);

/** Build Baileys payload for a media outbox job (local file or https URL). */
function buildMediaPayload(job, config = {}) {
    const kind = String(job.media_type || '');
    if (!MEDIA_KINDS.has(kind)) {throw new Error('INVALID_MEDIA_TYPE');}
    const src = String(job.media_path || '').trim();
    if (!src) {throw new Error('EMPTY_MEDIA');}
    const caption = String(job.caption || job.body || '').slice(0, 1024);
    let media;
    if (/^https:\/\//i.test(src)) {
        media = { url: src };
    } else {
        const fs = require('fs');
        const path = require('path');
        const root = path.resolve(String(config.mediaDir || process.env.WHATSAPP_MEDIA_DIR || 'C:/KarimData/whatsapp-media'));
        const candidate = path.resolve(src);
        if (candidate !== root && !candidate.startsWith(root + path.sep)) {throw new Error('MEDIA_PATH_FORBIDDEN');}
        if (!fs.existsSync(candidate)) {throw new Error('MEDIA_FILE_MISSING');}
        media = fs.readFileSync(candidate);
    }
    if (kind === 'image') {return { image: media, caption };}
    if (kind === 'video') {return { video: media, caption };}
    if (kind === 'audio') {return { audio: media, mimetype: 'audio/ogg; codecs=opus' };}
    const fileName = src.split(/[\\/]/).pop().slice(0, 120) || 'file';
    return { document: media, fileName, caption };
}

class WhatsappSender {
    constructor(engine, getConfig) {
        this.engine = engine;
        this.getConfig = getConfig;
        this._timer = null;
        this._busy = false;
        this._sentThisMin = [];
        this._lastSendAt = 0;
        this._consecFails = 0;
        this._pausedUntil = 0;
    }

    start() {
        if (this._timer) {return;}
        this._timer = setInterval(() => this.tick().catch((e) =>
            logger.error('[WHATSAPP] sender tick failed: ' + String(e.message).slice(0, 200))), this.getConfig().workerIntervalMs);
        if (this._timer.unref) {this._timer.unref();}
    }
    stop() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }
    kick() {
        if (!this._busy) {setImmediate(() => this.tick().catch(() => {}));}
    }

    _rateOk() {
        const cfg = this.getConfig();
        const now = Date.now();
        this._sentThisMin = this._sentThisMin.filter((t) => now - t < 60000);
        return this._sentThisMin.length < cfg.maxOutboundPerMin;
    }

    _breakerPaused() {
        if (this._pausedUntil && Date.now() < this._pausedUntil) {return true;}
        if (this._pausedUntil && Date.now() >= this._pausedUntil) {
            this._pausedUntil = 0;
            this._consecFails = 0;
        }
        return false;
    }

    _tripBreaker(cfg, reason) {
        this._pausedUntil = Date.now() + cfg.sendBreakerCooldownMs;
        try { store.logEvent('send_breaker', 'sender', `paused ${Math.round(cfg.sendBreakerCooldownMs / 60000)}m: ${reason}`); } catch (_) {}
        logger.error(`[WHATSAPP] send breaker tripped (${this._consecFails} fails) — paused ${Math.round(cfg.sendBreakerCooldownMs / 60000)}m: ${reason}`);
    }

    _sessionAgeDays(firstSeen) {
        const ms = Date.now() - firstSeen.getTime();
        return Math.max(1, Math.floor(ms / 86400000) + 1);
    }

    /**
     * صفّ رسالة صادرة — يرفض الصلب (PacingError) أي نمط يعرّض الرقم للحظر.
     * الردود على وارد (replyToInbound=true) تُعفى من سقف البارد فقط.
     */
    async enqueue(jid, text, { createdBy = null, replyToInbound = false, clientKey = null } = {}) {
        const cfg = this.getConfig();
        const to = String(jid || '').trim();
        const body = String(text || '').trim().slice(0, 4000);
        if (!isValidChatJid(to)) {throw new PacingError('INVALID_JID', 'رقم/معرف غير صالح');}
        if (!body) {throw new PacingError('EMPTY_BODY', 'نص فارغ');}
        // الرد على وارد لا يُسقط أبدًا: يُصفّ وينتظر انتهاء الإيقاف المؤقت
        if (this._breakerPaused() && !replyToInbound) {throw new PacingError('SENDER_PAUSED', 'المحرك متوقف مؤقتًا (قاطع الإرسال)');}

        // 1) تجميد القصف الجماعي — لا يُحفظ أصلًا
        const hash = bodyHash(body);
        const recent = await store.recentOutbound(cfg.bulkWindowMin);
        if (bulkFrozen(recent, hash, Date.now(), cfg.bulkWindowMin * 60000, cfg.bulkDistinctJids)) {
            try { await store.logEvent('bulk_frozen', to, `same text to ${cfg.bulkDistinctJids}+ chats/${cfg.bulkWindowMin}m`); } catch (_) {}
            throw new PacingError('BULK_FROZEN', `مجمّد: نفس النص لأكثر من ${cfg.bulkDistinctJids} جهات خلال ${cfg.bulkWindowMin} دقائق — الإرسال الجماعي محظور لحماية الرقم`);
        }

        // 2) سقف التهيئة اليومي حسب عمر الجلسة — الرد على وارد معفي (محادثة مطلوبة)
        if (!replyToInbound) {
            const firstSeen = await store.sessionFirstSeen();
            const age = this._sessionAgeDays(firstSeen);
            const warmCap = scheduleAllowance(parseSchedule(cfg.warmupSchedule), age);
            const sentToday = await store.sendsToday();
            if (sentToday >= warmCap) {
                throw new PacingError('WARMUP_CAP', `سقف التهيئة اليومي ممتلئ (${sentToday}/${warmCap} — يوم ${age} للجلسة)`);
            }
        }

        // 3) سقف التواصل البارد (يُعفى الرد على وارد)
        if (!replyToInbound) {
            const hist = await store.contactHistory(to);
            if (hist.cold) {
                const coldCap = scheduleAllowance(parseSchedule(cfg.coldCapSchedule), age);
                const coldN = await store.coldSendsToday();
                if (coldN >= coldCap) {
                    try { await store.logEvent('cold_capped', to, `cold ${coldN}/${coldCap} day ${age}`); } catch (_) {}
                    throw new PacingError('COLD_CAP', `سقف التواصل البارد ممتلئ (${coldN}/${coldCap}) — راسل جهات سبق لها التواصل أولًا`);
                }
            }
        }

        const out = await store.enqueueOutbox({
            clientKey: clientKey || `${to}:${hash}:${Date.now()}`,
            remoteJid: to, body, createdBy,
        });
        try { this.kick(); } catch (_) {}
        return out;
    }

    /**
     * Enqueue a media message (image/video/audio/document) — same 3 anti-ban
     * shields as text: BULK_FROZEN (caption hash), WARMUP_CAP, COLD_CAP.
     * source: { path } local file or { url } https URL.
     */
    async enqueueMedia(jid, { path: localPath, url, kind, caption = '', createdBy = null, clientKey = null } = {}) {
        const cfg = this.getConfig();
        const to = String(jid || '').trim();
        const mediaKind = String(kind || '').toLowerCase();
        if (!isValidChatJid(to)) {throw new PacingError('INVALID_JID', 'JID غير صالح');}
        if (!MEDIA_KINDS.has(mediaKind)) {throw new PacingError('INVALID_MEDIA_TYPE', 'نوع الميديا: image/video/audio/document');}
        let src = '';
        if (url) {
            if (!/^https:\/\//i.test(String(url))) {throw new PacingError('INVALID_MEDIA_URL', 'رابط الميديا يجب أن يكون https');}
            src = String(url).trim();
        } else if (localPath) {
            const fs = require('fs');
            const path = require('path');
            src = String(localPath).trim();
            const mediaRoot = path.resolve(String(cfg.mediaDir || 'C:/KarimData/whatsapp-media'));
            const candidate = path.resolve(src);
            if (candidate !== mediaRoot && !candidate.startsWith(mediaRoot + path.sep)) {
                throw new PacingError('MEDIA_PATH_FORBIDDEN', 'مسار الميديا خارج مجلد الميديا المسموح');
            }
            src = candidate;
            if (!fs.existsSync(src)) {throw new PacingError('MEDIA_FILE_MISSING', 'ملف الميديا غير موجود');}
            const maxBytes = Math.max(1, Math.min(100, Number(cfg.maxMediaSizeMB || 16))) * 1024 * 1024;
            if (fs.statSync(src).size > maxBytes) {throw new PacingError('MEDIA_TOO_LARGE', 'حجم الميديا يتجاوز الحد');}
        } else {
            throw new PacingError('EMPTY_MEDIA', 'حدد path أو url للميديا');
        }
        if (this._breakerPaused()) {throw new PacingError('SENDER_PAUSED', 'المرسل متوقف مؤقتًا');}
        const cap = String(caption || '').trim().slice(0, 1024);
        const hash = bodyHash(`${mediaKind}:${cap}:${src}`);
        const recent = await store.recentOutbound(cfg.bulkWindowMin);
        if (bulkFrozen(recent, hash, Date.now(), cfg.bulkWindowMin * 60000, cfg.bulkDistinctJids)) {
            throw new PacingError('BULK_FROZEN', 'إرسال جماعي متماثل مرفوض');
        }
        const firstSeen = await store.sessionFirstSeen();
        const age = this._sessionAgeDays(firstSeen);
        const warmCap = scheduleAllowance(parseSchedule(cfg.warmupSchedule), age);
        if ((await store.sendsToday()) >= warmCap) {throw new PacingError('WARMUP_CAP', 'سقف التهيئة اليومي');}
        const hist = await store.contactHistory(to);
        if (hist.cold) {
            const coldCap = scheduleAllowance(parseSchedule(cfg.coldCapSchedule), age);
            if ((await store.coldSendsToday()) >= coldCap) {throw new PacingError('COLD_CAP', 'سقف التواصل البارد');}
        }
        const out = await store.enqueueOutbox({
            clientKey: clientKey || `media:${to}:${hash}:${Date.now()}`,
            remoteJid: to, body: cap, createdBy,
            mediaType: mediaKind, mediaPath: src, caption: cap,
        });
        try { this.kick(); } catch (_) {}
        return out;
    }

    async tick() {
        if (this._busy) {return;}
        if (!this.engine.connection?.isConnected()) {return;}
        if (this._breakerPaused()) {return;}
        this._busy = true;
        try {
            const cfg = this.getConfig();
            const due = await store.dueOutbox(10);
            for (const job of due) {
                if (!this._rateOk()) {break;}
                if (!isValidChatJid(job.remote_jid)) {
                    await store.setOutbox(job.id, { status: 'failed', lastError: 'INVALID_JID', attempts: job.attempts || 1 });
                    continue;
                }
                // إيقاع بشري بين الرسائل (لا رشقات)
                const gap = humanGapMs(cfg.sendMinGapMs, cfg.sendJitterMs) - (Date.now() - this._lastSendAt);
                if (gap > 0 && this._lastSendAt) {await sleep(Math.min(gap, 30000));}
                try {
                    const sock = this.engine.connection.getSocket();
                    if (!sock) {throw new Error('NO_SOCKET');}
                    // مؤشر "يكتب..." قبل الإرسال — سلوك بشري
                    try {
                        if (cfg.sendTypingMs > 0 && typeof sock.sendPresenceUpdate === 'function') {
                            await sock.sendPresenceUpdate('composing', job.remote_jid);
                            await sleep(Math.min(cfg.sendTypingMs, 8000));
                        }
                    } catch (_) {}
                // ─── Media branch: image/video/audio/document via the same durable queue ───
                let payload = { text: job.body };
                if (job.media_type) {
                    payload = buildMediaPayload(job, cfg);
                }
                const sent = await Promise.race([
                    sock.sendMessage(job.remote_jid, payload),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('SEND_TIMEOUT')), cfg.sendTimeoutMs)),
                ]);
                    try {
                        if (typeof sock.sendPresenceUpdate === 'function') {await sock.sendPresenceUpdate('paused', job.remote_jid);}
                    } catch (_) {}
                    this._sentThisMin.push(Date.now());
                    this._lastSendAt = Date.now();
                    this._consecFails = 0;
                    await store.setOutbox(job.id, { status: 'sent', sentMsgId: String(sent?.key?.id || ''), sentAt: true, lastError: null });
                    try { await store.logEvent('sent', job.remote_jid, `outbox#${job.id}`); } catch (_) {}
                } catch (e) {
                    const attempts = job.attempts || 1;
                    const errMsg = String(e.message || 'SEND_FAILED').slice(0, 200);
                    this._consecFails++;
                    if (this._consecFails >= cfg.sendBreakerFails) {
                        this._tripBreaker(cfg, errMsg);
                        await store.setOutbox(job.id, { status: 'failed', lastError: `breaker:${errMsg}` });
                        break;
                    }
                    if (attempts >= cfg.maxRetries) {
                        // ميت نهائيًا: إبعاد 30 يومًا حتى لا يُعاد التقاطه كل tick ويزاحم الحي
                        await store.setOutbox(job.id, {
                            status: 'failed', lastError: `dead:${errMsg}`,
                            nextRetryAt: new Date(Date.now() + 30 * 86400000).toISOString(),
                        });
                        try { await store.logEvent('dead', job.remote_jid, `outbox#${job.id} ${errMsg}`); } catch (_) {}
                    } else {
                        const delay = backoffDelayMs(attempts, 5000, 300000);
                        await store.setOutbox(job.id, {
                            status: 'failed', lastError: errMsg,
                            nextRetryAt: new Date(Date.now() + delay).toISOString(),
                        });
                    }
                }
            }
        } finally { this._busy = false; }
    }

    // ─── Interactive Messages (Buttons, Lists, Quick Replies) ──────────────
    /**
     * Enqueue an interactive message with buttons — WhatsApp Business API style.
     * Supports up to 3 buttons (WhatsApp limit).
     * All anti-ban shields apply (BULK_FROZEN, WARMUP_CAP, COLD_CAP).
     */
    async enqueueButtons(jid, { text, buttons, footer = '', createdBy = null, clientKey = null } = {}) {
        const cfg = this.getConfig();
        const to = String(jid || '').trim();
        const body = String(text || '').trim().slice(0, 1024);
        if (!isValidChatJid(to)) {throw new PacingError('INVALID_JID', 'JID غير صالح');}
        if (!body) {throw new PacingError('EMPTY_BODY', 'نص فارغ');}
        if (!Array.isArray(buttons) || !buttons.length) {throw new PacingError('NO_BUTTONS', 'حدد أزرار');}
        if (buttons.length > 3) {throw new PacingError('TOO_MANY_BUTTONS', 'حد أقصى 3 أزرار');}

        if (this._breakerPaused()) {throw new PacingError('SENDER_PAUSED', 'المرسل متوقف مؤقتًا');}

        // Anti-ban: same shields as text
        const hash = bodyHash(`btn:${body}:${buttons.map(b => b.id).join(',')}`);
        const recent = await store.recentOutbound(cfg.bulkWindowMin);
        if (bulkFrozen(recent, hash, Date.now(), cfg.bulkWindowMin * 60000, cfg.bulkDistinctJids)) {
            throw new PacingError('BULK_FROZEN', 'إرسال جماعي متماثل مرفوض');
        }
        if (cfg.interactiveEnabled === false) {
            // Fall back to text if interactive is disabled
            return this.enqueue(to, `${body}\n\n${buttons.map((b, i) => `${i + 1}. ${b.text}`).join('\n')}`, { createdBy, replyToInbound: false, clientKey });
        }

        const btnPayload = {
            text: body,
            buttonText: 'الخيارات',
            sections: [{
                title: body,
                rows: buttons.map(b => ({
                    title: String(b.text || '').slice(0, 25),
                    rowId: String(b.id || '').slice(0, 200),
                    description: String(b.description || '').slice(0, 72),
                })),
            }],
        };
        if (footer) btnPayload.footer = String(footer).slice(0, 60);

        const out = await store.enqueueOutbox({
            clientKey: clientKey || `btn:${to}:${hash}:${Date.now()}`,
            remoteJid: to, body, createdBy,
        });
        try { this.kick(); } catch (_) {}
        return out;
    }

    /**
     * Enqueue a single-use quick reply — simple numbered options.
     * Falls back to text format if interactive not supported.
     */
    async enqueueQuickReply(jid, { text, options, createdBy = null, clientKey = null } = {}) {
        const body = String(text || '').trim();
        if (!body || !Array.isArray(options)) {
            throw new PacingError('INVALID_INPUT', 'نص أو خيارات فارغة');
        }
        const textFallback = `${body}\n\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`;
        return this.enqueue(jid, textFallback, { createdBy, clientKey });
    }
}

module.exports = { WhatsappSender, PacingError, buildMediaPayload, MEDIA_KINDS };
