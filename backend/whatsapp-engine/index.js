/**
 * whatsapp-engine/index.js — Professional WhatsApp Engine v4.0
 * ═══════════════════════════════════════════════════════════════
 * Modular architecture:
 *   - WhatsappConnection → Baileys socket management
 *   - WhatsappSender → Outbound message queue
 *   - AIChatbot → AI-powered smart replies
 *   - TemplateManager → Professional message templates
 *   - WorkflowEngine → Visual chatbot flow builder
 *   - WebhookManager → External system integration
 *   - CircuitBreaker → ERP protection
 *   - Analytics → Customer engagement metrics
 *   - Automation → Scheduled reports & alerts
 *
 * Usage in server.js:
 *   const { router, engine } = require('./whatsapp-engine');
 *   engine.start(io);
 *   engine.stop();
 */
'use strict';

const { WhatsappConnection } = require('./connection');
const { WhatsappSender } = require('./sender');
const { loadConfig, validateConfig } = require('./config');
const { router, setEngine } = require('./routes');
const { logger } = require('../logger');
const { processIncoming } = require('./pipeline');
const { store } = require('./store');

// Professional modules v4.0
const { AIChatbot } = require('./ai/chatbot');
const { SmartAssistant } = require('./ai/smart-assistant');
const { TemplateManager } = require('./templates');
const { WorkflowEngine } = require('./workflows/engine');
const { WebhookManager } = require('./webhooks');
const { CircuitBreaker } = require('./circuit-breaker');
const { Analytics } = require('./analytics');
// ROOT FIX 2026-10-02: كان `{ automation } = require(...)` والوحدة تصدّر الدوال
// مباشرة → automation=undefined → startAutomation ترمي TypeError داخل catch
// صامت → مجدول التقرير الليلي لم يبدأ يومًا (لا wa_daily_last ولا رسائل 23:55).
const automation = require('./automation');
const { supervisorDecision } = require('./supervisor');
const { MessageScheduler } = require('./scheduler');

class WhatsappEngine {
    getConfig() { return loadConfig(); }

    constructor() {
        const cfg = loadConfig();
        this.config = cfg;
        this.connection = new WhatsappConnection(loadConfig);
        this.sender = new WhatsappSender(this, loadConfig);
        this.ai = new AIChatbot(loadConfig);
        this.aiChatbot = this.ai; // alias for pipeline access
        this.smartAssistant = new SmartAssistant(loadConfig);
        this.templates = new TemplateManager();
        this.workflows = new WorkflowEngine();
        this.webhooks = new WebhookManager();
        this.circuitBreaker = new CircuitBreaker({
            failureThreshold: cfg.cbFailureThreshold,
            timeoutMs: cfg.cbTimeoutMs,
            windowMs: cfg.cbWindowMs,
            name: 'ERP',
        });
        this.analytics = new Analytics();
        this.scheduler = new MessageScheduler(this);

        this.io = null;
        this._started = false;
        this._watchdog = null;
        this._watch = { state: null, same: 0, healedAt: 0 };
        this._metrics = {
            startedAt: null, processed: 0, replied: 0, failed: 0,
            duplicates: 0, aiResponses: 0, templatesSent: 0,
            workflowsTriggered: 0, webhooksSent: 0,
        };
        this._aiEnabled = false;

        // Message handler pipeline
        this._onMessages = async (m) => {
            try {
                const t = String(m?.type || '?');
                this._metrics.upserts = (this._metrics.upserts || 0) + 1;

                if (m?.type !== 'notify') {return;}

                for (const raw of m.messages || []) {
                    try {
                        const result = await processIncoming(this, raw);
                        if (result.duplicate) {this._metrics.duplicates++;}
                        else if (result.failed) {this._metrics.failed++;}
                        else if (result.processed) {
                            this._metrics.processed++;
                            if (result.replied) {this._metrics.replied++;}
                        }

                        // AI smart response (if enabled and no human reply)
                        if (this._aiEnabled && !result.replied && (raw.message?.extendedTextMessage?.text || raw.message?.conversation)) {
                            await this._aiReply(raw);
                        }

                        // Template-based response
                        if (result.template && !result.replied) {
                            await this._templateReply(raw, result.template);
                        }

                        // Webhook notification
                        if (this.config.webhooksEnabled) {
                            await this.webhooks.trigger('message.processed', {
                                jid: raw.remoteJid,
                                type: t,
                                processed: result.processed,
                            });
                        }
                    } catch (e) {
                        logger.error('[WHATSAPP] handler failed: ' + String(e.message).slice(0, 200));
                    }
                }
            } catch (_) {}
        };

        this._onState = (s) => {
            try { if (this.io) {this.io.emit('whatsapp:state', s);} } catch (_) {}
        };
        this._onQr = (q) => {
            try { if (this.io) {this.io.emit('whatsapp:qr', { qr: q.qr || null, at: q.at });} } catch (_) {}
        };
    }

    async start(io) {
        const cfg = loadConfig();
        if (!cfg.enabled) {
            logger.info('[WHATSAPP] معطّل (WHATSAPP_ENABLED=false) — تخطي البدء');
            return;
        }
        if (this._started) {
            logger.warn('[WHATSAPP] start مكرر — تم التجاهل (منع مستمعين مزدوجين)');
            return;
        }
        this._started = true;
        validateConfig(cfg);
        this.io = io || null;

        // Initialize professional modules
        if (cfg.aiEnabled) {
            this._aiEnabled = await this.ai.init();
            logger.info(`[AI] Chatbot ${this._aiEnabled ? 'ready ✅' : 'disabled'}`);
        }

        // Initialize Smart Assistant (works even without LLM - uses NLU fallback)
        if (cfg.aiEnabled) {
            await this.smartAssistant.init();
            logger.info(`[SmartAssistant] ${this.smartAssistant.enabled ? 'ready ✅' : 'disabled'}`);
        }

        // Load default workflow
        if (cfg.workflowsEnabled) {
            await this.workflows.loadFlow(cfg.defaultFlow);
            logger.info(`[Workflow] Loaded: ${cfg.defaultFlow}`);
        }

        // Wire circuit breaker
        this.connection._setCircuitBreaker(this.circuitBreaker);

        // Register event listeners (off-first: restart-safe, no double replies)
        for (const [ev, fn] of [['messages', this._onMessages], ['state', this._onState], ['qr', this._onQr]]) {
            try { this.connection.off(ev, fn); } catch (_) {}
            this.connection.on(ev, fn);
        }

        this._metrics.startedAt = new Date().toISOString();
        this.sender.start();

        // Start scheduler (scheduled messages)
        if (cfg.schedulingEnabled !== false) {
            this.scheduler.start(cfg.schedulerIntervalMs);
        }

        // Genius daily briefing at the appointed time (fresh data at send time)
        try { require('./genius').startDailyBriefing(this); } catch (e) {
            logger.warn('[GENIUS] briefing scheduler failed: ' + String(e.message).slice(0, 150));
        }
        // Genius monthly briefing on 1st of month
        try { require('./genius').startMonthlyBriefing(this); } catch (e) {
            logger.warn('[GENIUS] monthly scheduler failed: ' + String(e.message).slice(0, 150));
        }

        try { automation.startAutomation(this); } catch (e) {
            // لا صمت هنا مجددًا — فشل بدء المجدول يعني تقريرًا ليليًا لا يُرسل يوميًا
            logger.error('[WHATSAPP] automation scheduler failed to start: ' + String(e.message).slice(0, 150));
        }
        this._startWatchdog();
        // Sweep stale 'received' inbox (crash between insert and reply) — durable queue resends.
        try { require('./pipeline').sweepStale(this).catch(() => {}); } catch (_) {}
        // Sweep stuck outbox 'sending' (crash mid-send) back to pending.
        try {
            const { pool } = require('../shared-pool');
            pool.query(`UPDATE wa_outbox SET status='pending', next_retry_at=NOW() WHERE status='sending'`)
                .then((r) => { if (r.rowCount) {logger.warn(`[WHATSAPP] re-queued ${r.rowCount} stuck outbox rows`);} })
                .catch(() => {});
        } catch (_) {}
        await this.connection.start();

        logger.info('[WHATSAPP v4.0] Engine started ✅');
        logger.info(`[WHATSAPP] AI: ${this._aiEnabled ? 'ON' : 'OFF'} | Workflows: ${cfg.workflowsEnabled ? 'ON' : 'OFF'} | Webhooks: ${cfg.webhooksEnabled ? 'ON' : 'OFF'}`);
    }

    async stop() {
        this._started = false;
        try { this._stopWatchdog(); } catch (_) {}
        try { this.connection.off('messages', this._onMessages); } catch (_) {}
        try { this.connection.off('state', this._onState); } catch (_) {}
        try { this.connection.off('qr', this._onQr); } catch (_) {}
        try { this.sender.stop(); } catch (_) {}
        try { this.scheduler.stop(); } catch (_) {}
        try { require('./genius').stopDailyBriefing(); } catch (_) {}
        try { require('./genius').stopMonthlyBriefing(); } catch (_) {}
        try { automation.stopAutomation(); } catch (_) {}
        try { this.workflows._activeSessions.clear(); } catch (_) {}
        // إغلاق المقبس فعليًا — بدونه تبقى جلسة شبح تُسقط الجلسة الجديدة (428)
        try { await this.connection.stop(); } catch (_) {}
        this._aiEnabled = false;
        logger.info('[WHATSAPP] Engine stopped');
    }

    /** المراقب الفولاذي: فحص كل 30 ثانية — شفاء تلقائي متدرج */
    _startWatchdog() {
        this._stopWatchdog();
        this._watch = { state: null, same: 0, healedAt: 0 };
        this._watchdog = setInterval(() => {
            try { this._supervise(); } catch (e) {
                try { logger.error('[WHATSAPP] watchdog failed: ' + String(e.message).slice(0, 150)); } catch (_) {}
            }
        }, 30000);
        if (this._watchdog && this._watchdog.unref) {this._watchdog.unref();}
    }
    _stopWatchdog() {
        if (this._watchdog) {clearInterval(this._watchdog); this._watchdog = null;}
    }
    _supervise() {
        if (!this._started) {return 'idle';}
        const conn = this.connection;
        const st = conn?.state || 'UNKNOWN';
        if (st === this._watch.state) {this._watch.same++;}
        else {this._watch = { state: st, same: 0, healedAt: this._watch.healedAt };}
        const ticks = this._watch.same; // كل tick = 30 ثانية
        // 1) موت صامت: حالة CONNECTED بلا مقبس (خلل إعادة الوصل القديم) — شفاء فوري
        if (st === 'CONNECTED' && !conn.sock) {
            if (ticks >= 2) {return this._heal('ghost-connected (مقبس ميت)');}
            return 'ghost-wait';
        }
        // 2) علوق الإقلاع: INITIALIZING/AUTHENTICATING أكثر من 5 دقائق
        if ((st === 'INITIALIZING' || st === 'AUTHENTICATING') && ticks >= 10) {
            return this._heal(`stuck-${st.toLowerCase()} (علوق إقلاع)`);
        }
        // 3) حلقة 440/428: RECONNECTING كثير بدون تقدم — شفاء بعد دقيقتين.
        // ملاحظة: مسار إعادة الوصل العام يكتب الخطأ بصيغة "code 440" بدون كلمة conflict،
        // فكان الشرط القديم (includes('conflict')) أعمى عنها ولا يتصرف أبدًا — تم التوسيع.
        if (st === 'RECONNECTING' && ticks >= 4 && /conflict|code 44\d|code 428/i.test(conn.lastError || '')) {
            try { store.logEvent('watchdog_conflict_loop', st, 'حلقة 440 — تنظيف كامل وإعادة وصل'); } catch (_) {}
            logger.warn('[WHATSAPP] watchdog: conflict loop detected — full session wipe + restart');
            // تنظيف كامل: مسح الجلسة + بدء جديد
            conn._clearSessionForRelink();
            return this._heal('conflict-loop-440 (تنظيف كامل)');
        }
        // 4) QR منتهي: QR_REQUIRED/LOGGED_OUT بلا QR صالح — تحديث تلقائي كل دقيقتين
        if (st === 'QR_REQUIRED' || st === 'LOGGED_OUT') {
            const age = (typeof conn.qrAgeMs === 'function') ? conn.qrAgeMs() : null;
            if ((age === null || age > 120000) && ticks >= 4 && ticks % 4 === 0) {
                try { store.logEvent('watchdog_qr_refresh', st, 'QR منتهي — تحديث تلقائي'); } catch (_) {}
                logger.warn('[WHATSAPP] watchdog: refreshing stale QR');
                try {
                    const p = conn.refreshQR ? conn.refreshQR() : conn.start();
                    if (p && p.catch) {p.catch(() => {});}
                } catch (_) {}
                return 'qr-refresh';
            }
            return 'wait_qr';
        }
        const action = supervisorDecision(st, ticks, Date.now() - (this._watch.healedAt || 0));
        if (action === 'heal') {return this._heal(`${st} (انقطاع طويل)`);}
        return action;
    }
    _heal(reason) {
        this._watch.healedAt = Date.now();
        this._watch.same = 0;
        try { store.logEvent('watchdog_heal', this.connection?.state || '?', reason); } catch (_) {}
        logger.warn(`[WHATSAPP] watchdog: healing — ${reason}`);
        // ─── تنظيف عدادات التعارض قبل الإعادة — يمنع تكرار 440 ───
        if (this.connection?._conflicts) {this.connection._conflicts = [];}
        this.connection.stop()
            .then(() => new Promise((r) => setTimeout(r, 2000))) // فاصل 2s لضمان إغلاق كامل
            .then(() => this.connection.start())
            .catch((e) => logger.error('[WHATSAPP] watchdog heal failed: ' + String(e.message).slice(0, 150)));
        return 'heal';
    }

    // AI-powered reply for customer messages
    async _aiReply(raw) {
        try {
            const response = await this.ai.respond(
                raw.remoteJid,
                raw.message?.extendedTextMessage?.text || raw.message?.conversation || '',
                { customerName: raw.pushName || 'عميل' }
            );
            if (response && response.text) {
                await this.sender.enqueue(raw.remoteJid, response.text, { replyToInbound: true });
                this._metrics.aiResponses++;
                logger.debug(`[AI] Auto-reply sent to ${raw.remoteJid.slice(-5)}`);
            }
        } catch (e) {
            logger.warn(`[AI] reply failed: ${e.message.slice(0, 100)}`);
        }
    }

    // Template-based reply
    async _templateReply(raw, templateName) {
        try {
            const text = await this.templates.fill(templateName, raw.remoteJid);
            if (text) {
                await this.sender.enqueue(raw.remoteJid, text, { replyToInbound: true });
                this._metrics.templatesSent++;
            }
        } catch (e) {
            logger.warn(`[Template] reply failed: ${e.message.slice(0, 100)}`);
        }
    }

    // Health report (for admin dashboard)
    async health() {
        const connStatus = this.connection.status();
        const cbStatus = this.circuitBreaker.getStatus();
        const analytics = await this.analytics.healthMetrics();

        return {
            connection: connStatus,
            circuitBreaker: cbStatus,
            ai: {
                enabled: this._aiEnabled,
                provider: this.config.aiProvider || 'ollama',
                model: this.config.aiModel,
                llmAvailable: this.ai?._llmAvailable || false,
            },
            scheduler: {
                enabled: this.config.schedulingEnabled !== false,
            },
            interactive: {
                enabled: this.config.interactiveEnabled !== false,
            },
            workflows: { active: this.workflows.activeCount, enabled: this.config.workflowsEnabled },
            webhooks: this.config.webhooksEnabled,
            metrics: this._metrics,
            analytics,
            uptime: this._metrics.startedAt
                ? Date.now() - new Date(this._metrics.startedAt).getTime()
                : 0,
        };
    }
}

// Singleton
let _engine = null;
function getEngine() { return _engine; }
function setEngineInstance(e) { _engine = e; }

const engine = new WhatsappEngine();
setEngineInstance(engine);
// ربط مسارات API بالمحرك الوحيد — غيابها كان يعطّل كل /api/whatsapp/* (engineRef=null → 500)
setEngine(engine);

// ─── Schema migration (called by server.js on startup) ──
const { ensureWhatsappSchema } = require('./schema');

module.exports = {
    router, engine, WhatsappEngine, getEngine, setEngineInstance,
    whatsappEngine: engine,
    ensureWhatsappSchema, supervisorDecision, systemQuery: require('./system-query'),
};