/**
 * whatsapp-engine/config.js — All settings (env + validated)
 * ═══════════════════════════════════════════════════════════
 * Extended for v4.0 professional features:
 *   AI chatbot, webhooks, workflows, analytics, circuit breaker, media
 */
'use strict';

function boolEnv(name, def) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') {return def;}
    return ['1', 'true', 'yes', 'on', 'y'].includes(String(raw).trim().toLowerCase());
}
function intEnv(name, def, min, max) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') {return def;}
    const n = Number(raw);
    if (!Number.isFinite(n)) {return def;}
    return Math.min(max, Math.max(min, Math.round(n)));
}

function loadConfig() {
    return Object.freeze({
        // Core
        enabled: boolEnv('WHATSAPP_ENABLED', false),
        sessionDir: (process.env.WHATSAPP_SESSION_DIR || 'C:/KarimData/whatsapp-sessions').trim(),
        sessionBackupDir: (process.env.WHATSAPP_BACKUP_DIR || 'C:/KarimData/whatsapp-backups').trim(),
        logDir: (process.env.WHATSAPP_LOG_DIR || 'C:/KarimData/whatsapp-logs').trim(),
        logLevel: (process.env.WHATSAPP_LOG_LEVEL || 'info').trim(),

        // Reconnection
        reconnectMaxDelayMs: intEnv('WHATSAPP_RECONNECT_MAX_DELAY', 60000, 5000, 300000),
        reconnectBaseDelayMs: intEnv('WHATSAPP_RECONNECT_BASE_DELAY', 2000, 500, 30000),
        maxRetries: intEnv('WHATSAPP_MAX_RETRIES', 5, 0, 20),
        sendTimeoutMs: intEnv('WHATSAPP_SEND_TIMEOUT', 30000, 5000, 120000),
        erpTimeoutMs: intEnv('ERP_API_TIMEOUT', 8000, 1000, 60000),
        workerIntervalMs: intEnv('WHATSAPP_WORKER_INTERVAL', 5000, 1000, 60000),
        maxOutboundPerMin: intEnv('WHATSAPP_MAX_OUTBOUND_PER_MIN', 20, 1, 60),
        historyDays: intEnv('WHATSAPP_HISTORY_DAYS', 90, 7, 365),

        // ─── درع الحظر (Anti-Ban Pacing) ──────────────────────────────
        // أي تجاوز لهذه الحدود → رفض صلب قبل الوصول لواتساب (لا إرسال إطلاقًا).
        // إيقاع بشري: فجوة دنيا بين الرسائل + jitter عشوائي + مؤشر كتابة.
        sendMinGapMs: intEnv('WA_SEND_MIN_GAP_MS', 3000, 1000, 30000),
        sendJitterMs: intEnv('WA_SEND_JITTER_MS', 2500, 0, 15000),
        sendTypingMs: intEnv('WA_SEND_TYPING_MS', 1500, 0, 8000),
        // تهيئة الرقم حسب عمر الجلسة (يوم1، يوم2، ... — الأخير سقف دائم).
        warmupSchedule: String(process.env.WA_WARMUP_SCHEDULE || '20,40,80,160,320,640,1000'),
        // سقف التواصل البارد اليومي حسب العمر (أول رسالة لجهة بلا سجل).
        coldCapSchedule: String(process.env.WA_COLD_CAP_SCHEDULE || '5,10,20,40,60,80,100'),
        // التجميد الجماعي: نفس النص لأكثر من N جهات خلال النافذة = حظر إرسال.
        bulkDistinctJids: intEnv('WA_BULK_DISTINCT_JIDS', 8, 2, 100),
        bulkWindowMin: intEnv('WA_BULK_WINDOW_MIN', 10, 1, 120),
        // قاطع الإرسال: إخفاقات متتالية توقف المحرك مؤقتًا (لا قصف أثناء عطل).
        sendBreakerFails: intEnv('WA_SEND_BREAKER_FAILS', 5, 2, 30),
        sendBreakerCooldownMs: intEnv('WA_SEND_BREAKER_COOLDOWN_MS', 900000, 60000, 3600000),

        // AI Chatbot — 100% FREE & Open Source (Ollama/LM Studio/TextGen)
        aiEnabled: boolEnv('AI_ENABLED', false),
        aiProvider: (process.env.AI_PROVIDER || 'ollama').toLowerCase(), // ollama | lmstudio | textgen
        aiApiKey: process.env.AI_API_KEY || null,
        aiModel: process.env.AI_MODEL || 'llama3.1:8b',
        aiTimeoutMs: intEnv('AI_TIMEOUT_MS', 15000, 5000, 60000),
        aiMaxTokens: intEnv('AI_MAX_TOKENS', 200, 50, 1000),
        aiTemperature: parseFloat(process.env.AI_TEMPERATURE || '0.3'),
        aiRateLimitPerHour: intEnv('AI_RATE_LIMIT', 30, 5, 200),

        // Interactive Messages (Buttons, Lists, Quick Replies)
        interactiveEnabled: boolEnv('INTERACTIVE_ENABLED', true),
        interactiveButtonsMax: 3,   // WhatsApp limit
        interactiveListRowsMax: 10, // WhatsApp limit

        // Scheduled Messages
        schedulingEnabled: boolEnv('SCHEDULING_ENABLED', true),
        schedulerIntervalMs: intEnv('SCHEDULER_INTERVAL', 30000, 5000, 300000),

        // Webhooks
        webhooksEnabled: boolEnv('WEBHOOKS_ENABLED', false),

        // Workflows
        workflowsEnabled: boolEnv('WORKFLOWS_ENABLED', false),
        defaultFlow: process.env.DEFAULT_FLOW || 'welcome_flow',

        // Circuit Breaker
        cbFailureThreshold: intEnv('CB_FAILURE_THRESHOLD', 5, 1, 20),
        cbTimeoutMs: intEnv('CB_TIMEOUT_MS', 30000, 5000, 120000),
        cbWindowMs: intEnv('CB_WINDOW_MS', 60000, 10000, 300000),

        // Media
        mediaEnabled: boolEnv('MEDIA_ENABLED', true),
        maxMediaSizeMB: intEnv('MEDIA_MAX_SIZE_MB', 16, 1, 100),
        mediaDir: (process.env.WHATSAPP_MEDIA_DIR || 'C:/KarimData/whatsapp-media').trim(),
        allowedMediaTypes: ['image', 'document', 'audio', 'video'],

        // Analytics
        analyticsEnabled: boolEnv('ANALYTICS_ENABLED', true),
        analyticsWindowDays: intEnv('ANALYTICS_DAYS', 30, 7, 365),
    });
}

function validateConfig(cfg) {
    const errors = [];
    if (!cfg.sessionDir) {errors.push('WHATSAPP_SESSION_DIR فارغ');}
    if (!/^[a-z]+$/i.test(String(cfg.logLevel)) || !['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(String(cfg.logLevel).toLowerCase())) {
        errors.push('WHATSAPP_LOG_LEVEL غير صالح');
    }
    if (cfg.reconnectBaseDelayMs >= cfg.reconnectMaxDelayMs) {errors.push('RECONNECT_BASE_DELAY يجب أن يكون أصغر من MAX_DELAY');}
    if (cfg.aiEnabled && cfg.aiProvider !== 'ollama' && cfg.aiProvider !== 'lmstudio' && cfg.aiProvider !== 'textgen' && !cfg.aiApiKey) {
        errors.push('AI_ENABLED=true مع مزود خارجي لكن AI_API_KEY فارغ (للمزودات المجانية المحلية استخدم AI_PROVIDER=ollama)');
    }
    if (cfg.aiTemperature < 0 || cfg.aiTemperature > 1) {errors.push('AI_TEMPERATURE يجب أن يكون بين 0 و 1');}
    if (errors.length) {
        const err = new Error('WHATSAPP_CONFIG_INVALID: ' + errors.join('؛ '));
        err.code = 'WHATSAPP_CONFIG_INVALID';
        throw err;
    }
    return true;
}

module.exports = { loadConfig, validateConfig, boolEnv, intEnv };