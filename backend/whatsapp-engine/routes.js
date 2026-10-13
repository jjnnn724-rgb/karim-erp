/**
 * whatsapp-engine/routes.js — واجهة الإدارة المحلية (admin/manager)
 * ────────────────────────────────────────────────────────────────────────────
 * v4.0 Professional Features:
 * Core: status, health, qr, pairing, start, stop, logout, send, messages, outbox, rules, auto-reply, logs, managers, automation
 * AI:    ai/config (GET/POST), ai/chat
 * Tmpl:  templates (GET/POST)
 * Wf:    workflows, workflows/:key/run, workflows/active
 * WH:    webhooks (GET/POST/DELETE)
 * CB:    circuit-breaker/status
 * Ana:   analytics/dashboard, analytics/engagement
 * Media: media/upload
 *
 * Usage in server.js:
 *   const { router } = require('./whatsapp-engine');
 *   app.use('/api/whatsapp', router);
 *
 * لا تُعرض ملفات الجلسة عبر HTTP إطلاقًا.
 */
'use strict';

const crypto = require('crypto');
const express = require('express');
const { logger } = require('../logger');
const { jwtAuth, requireRole } = require('../cashier-module/jwt-middleware');
const { rateLimit } = require('../cashier-module/rate-limit');
const { loadConfig } = require('./config');
const store = require('./store');
const { isValidChatJid } = require('./rules');
const { clientKeyFor } = require('./pipeline');

const router = express.Router();
const READ_ROLES = ['admin', 'manager', 'auditor'];
const WRITE_ROLES = ['admin', 'manager'];

let engineRef = null;

router.get('/status', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const h = await engineRef.health();
        res.json({ ok: true, ...h });
    } catch (e) { logger.error('[wa/status]', e.message); res.status(500).json({ error: 'WA_STATUS_FAILED', message: 'تعذر جلب الحالة' }); }
});

router.get('/health', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const h = await engineRef.health();
        res.json({
            ok: h.ok, state: h.connection.state, queueDue: h.queue?.outbox_due ?? null,
            inboxPending: h.queue?.inbox_pending ?? null, lastOkAt: h.connection.lastOkAt,
        });
    } catch (e) { res.status(500).json({ ok: false, error: 'WA_HEALTH_FAILED' }); }
});

router.get('/qr', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        if (!engineRef || !engineRef.connection) {
            return res.status(503).json({ ok: false, error: 'ENGINE_NOT_READY', message: 'محرك واتساب غير مهيأ بعد — أعد تحميل الصفحة' });
        }
        const c = engineRef.connection;
        if (c.state === 'CONNECTED') {return res.json({ ok: true, connected: true, state: c.state });}
        // ملاحظة: engine.start() يتجاهل النداء إذا كان _started=true حتى لو الاتصال STOPPED،
        // لذا نبدأ الاتصال نفسه مباشرة في هذه الحالة وإلا لن يظهر أي QR أبدًا.
        if (c.state === 'STOPPED' || c.state === 'FAILED') {
            try {
                if (!engineRef._started) { await engineRef.start(req.io || null); }
                else { await c.start(); }
            } catch (e) {
                return res.status(409).json({ ok: false, error: 'ENGINE_START_FAILED', message: 'تعذر بدء محرك واتساب — تحقق من الخدمة ومجلد الجلسة', state: c.state });
            }
        } else if (c.state === 'LOGGED_OUT') {
            // جلسة مرفوضة (401): المحرك ما زال started، فأعد إقلاع الاتصال نفسه ليُولَّد QR جديد
            try { await c.start(); } catch (_) {}
        } else if (!engineRef._started) {
            try { await engineRef.start(req.io || null); } catch (_) {}
        }
        // Baileys قد يحتاج 10-20 ثانية (جلب النسخة + إنشاء المقبس) — 8 ثوانٍ كانت قصيرة وتُرجع 404 كاذبًا
        const deadline = Date.now() + 25000;
        while (!c.qr && c.state !== 'CONNECTED' && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        if (c.state === 'CONNECTED') {return res.json({ ok: true, connected: true, state: c.state });}
        if (!c.qr) {return res.status(404).json({ ok: false, error: 'QR_NOT_READY', state: c.state, qrAvailable: false, lastError: (c.lastError || '').slice(0, 200), message: c.state === 'STOPPED' ? 'المحرك متوقف — دوس بدء أولًا ثم جلب الرمز' : c.state === 'AUTHENTICATING' ? 'جارٍ التحقق من الجلسة القديمة… إن طال الانتظار دوس «رمز جديد» لمسحها وتوليد QR' : 'لا يوجد رمز حاليًا — انتظر قليلًا ثم أعد المحاولة' });}
        res.json({ ok: true, qr: c.qr, at: c.qrAt, state: c.state });
    } catch (e) { res.status(500).json({ ok: false, error: 'WA_QR_FAILED' }); }
});

router.post('/qr/refresh', jwtAuth, requireRole(...WRITE_ROLES), rateLimit({ windowMs: 60000, max: 3, keyFn: (r) => `wa_qr_refresh:${r.user.id}` }), async (req, res) => {
    try {
        const ok = await engineRef.connection.requestQR();
        if (ok) { res.json({ ok: true, message: 'QR جديد تم إنشاؤه — امسحه الآن من واتساب' }); }
        else { res.json({ ok: true, message: 'تم إنشاء QR جديد — اجلبه من زر جلب الرمز' }); }
    } catch (e) { res.status(500).json({ ok: false, error: 'QR_REFRESH_FAILED', message: e.message.slice(0, 200) }); }
});

router.post('/pairing', jwtAuth, requireRole(...WRITE_ROLES), rateLimit({ windowMs: 60000, max: 3, keyFn: (r) => `wa_pair:${r.user.id}` }), async (req, res) => {
    try {
        // الربط يحتاج مقبسًا مهيأً: ابدأ المحرك تلقائيًا إن كان متوقفًا
        if (!engineRef.connection.getSocket()) {
            try { await engineRef.start(req.io || null); } catch (e) {
                return res.status(409).json({ ok: false, error: 'ENGINE_START_FAILED', message: 'تعذر بدء المحرك — تحقق من WHATSAPP_ENABLED وإعدادات الجلسة' });
            }
            await new Promise((r) => setTimeout(r, 4000));
        }
        const code = await engineRef.connection.pairingCode(req.body?.phone);
        res.json({ ok: true, code });
    } catch (e) { res.status(422).json({ ok: false, error: e.code || 'PAIRING_FAILED', message: e.message }); }
});

router.post('/start', jwtAuth, requireRole(...WRITE_ROLES), rateLimit({ windowMs: 60000, max: 5, keyFn: (r) => `wa_start:${r.user.id}` }), async (req, res) => {
    try { await engineRef.start(req.io || null); res.json({ ok: true, state: engineRef.connection.state }); }
    catch (e) { res.status(500).json({ ok: false, error: e.code || 'WA_START_FAILED', message: String(e.message).slice(0, 200) }); }
});

router.post('/stop', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try { await engineRef.stop(); res.json({ ok: true, state: engineRef.connection.state }); }
    catch (e) { res.status(500).json({ ok: false, error: 'WA_STOP_FAILED' }); }
});

router.post('/logout', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        if (req.body?.confirm !== 'LOGOUT') {return res.status(422).json({ ok: false, error: 'CONFIRM_REQUIRED', message: 'أكّد بكلمة LOGOUT' });}
        await engineRef.connection.logout();
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: 'WA_LOGOUT_FAILED' }); }
});

router.post('/session/restore', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        if (req.body?.confirm !== 'RESTORE') {return res.status(422).json({ ok: false, error: 'CONFIRM_REQUIRED', message: 'أكّد بكلمة RESTORE' });}
        const { restoreLatest } = require('./session-backup');
        const cfg = engineRef.getConfig ? engineRef.getConfig() : {};
        const used = restoreLatest(
            cfg.sessionBackupDir || process.env.WHATSAPP_BACKUP_DIR || 'C:/KarimData/whatsapp-backups',
            cfg.sessionDir
        );
        try { await engineRef.connection.stop(); } catch (_) {}
        try { await engineRef.connection.start(); } catch (e) {
            return res.status(500).json({ ok: false, error: 'WA_RESTART_FAILED', message: String(e.message).slice(0, 200) });
        }
        try { await store.logEvent('session_restore', 'creds.json', String(used).slice(-60)); } catch (_) {}
        res.json({ ok: true, backup: String(used).split(/[\\/]/).pop() });
    } catch (e) {
        if (e && e.code === 'NO_BACKUP') {return res.status(422).json({ ok: false, error: 'NO_BACKUP', message: e.message });}
        logger.error('[wa/session/restore]', e.message); res.status(500).json({ ok: false, error: 'WA_RESTORE_FAILED' });
    }
});

router.post('/send', jwtAuth, requireRole(...WRITE_ROLES), rateLimit({ windowMs: 60000, max: 30, keyFn: (r) => `wa_send:${r.user.id}` }), async (req, res) => {
    try {
        const to = String(req.body?.to || '').trim();
        const body = String(req.body?.body || '').trim().slice(0, 4000);
        if (!isValidChatJid(to)) {return res.status(422).json({ ok: false, error: 'INVALID_JID', message: 'رقم/معرف غير صالح (مثال: 9665XXXXXXXX@s.whatsapp.net)' });}
        if (!body) {return res.status(422).json({ ok: false, error: 'EMPTY_BODY' });}
        // درع الحظر: أي نمط خطر يُرفض هنا قبل الوصول لواتساب (429 — وليس في الطابور)
        const out = await engineRef.sender.enqueue(to, body, { createdBy: req.user?.id });
        res.status(201).json({ ok: true, id: out.id, status: out.status });
    } catch (e) {
        if (e && (e.code === 'BULK_FROZEN' || e.code === 'WARMUP_CAP' || e.code === 'COLD_CAP' || e.code === 'SENDER_PAUSED')) {
            try { await store.logEvent('send_refused', String(req.body?.to || ''), e.code); } catch (_) {}
            return res.status(429).json({ ok: false, error: e.code, message: e.message });
        }
        if (e && (e.code === 'INVALID_JID' || e.code === 'EMPTY_BODY')) {
            return res.status(422).json({ ok: false, error: e.code, message: e.message });
        }
        logger.error('[wa/send]', e.message); res.status(500).json({ ok: false, error: 'WA_SEND_FAILED' });
    }
});

router.post('/send-media', jwtAuth, requireRole(...WRITE_ROLES), rateLimit({ windowMs: 60000, max: 15, keyFn: (r) => `wa_send_media:${r.user.id}` }), async (req, res) => {
    try {
        const to = String(req.body?.to || '').trim();
        const kind = String(req.body?.kind || '').toLowerCase();
        const caption = String(req.body?.caption || '').slice(0, 1024);
        const filePath = String(req.body?.path || '').trim();
        const url = String(req.body?.url || '').trim();
        if (!isValidChatJid(to)) {return res.status(422).json({ ok: false, error: 'INVALID_JID', message: 'رقم/معرف غير صالح (مثال: 9665XXXXXXXX@s.whatsapp.net)' });}
        const out = await engineRef.sender.enqueueMedia(to, { path: filePath || undefined, url: url || undefined, kind, caption, createdBy: req.user?.id });
        res.status(201).json({ ok: true, id: out.id, status: out.status });
    } catch (e) {
        if (e && (e.code === 'BULK_FROZEN' || e.code === 'WARMUP_CAP' || e.code === 'COLD_CAP' || e.code === 'SENDER_PAUSED')) {
            try { await store.logEvent('send_media_refused', String(req.body?.to || ''), e.code); } catch (_) {}
            return res.status(429).json({ ok: false, error: e.code, message: e.message });
        }
        if (e && (e.code === 'INVALID_JID' || e.code === 'INVALID_MEDIA_TYPE' || e.code === 'INVALID_MEDIA_URL' || e.code === 'EMPTY_MEDIA' || e.code === 'MEDIA_FILE_MISSING' || e.code === 'MEDIA_TOO_LARGE' || e.code === 'MEDIA_PATH_FORBIDDEN')) {
            return res.status(422).json({ ok: false, error: e.code, message: e.message });
        }
        logger.error('[wa/send-media]', e.message); res.status(500).json({ ok: false, error: 'WA_SEND_MEDIA_FAILED' });
    }
});

router.get('/messages', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        res.json({ ok: true, ...(await store.inboxList({ status: req.query.status, q: req.query.q, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20 })) });
    } catch (e) { res.status(500).json({ ok: false, error: 'WA_MESSAGES_FAILED' }); }
});

router.get('/chats/:jid/meta', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const jid = decodeURIComponent(req.params.jid);
        if (!isValidChatJid(jid)) {return res.status(422).json({ ok: false, error: 'INVALID_JID' });}
        const r = await store.pool.query('SELECT * FROM wa_chat_meta WHERE remote_jid = $1', [jid]);
        res.json({ ok: true, meta: r.rows[0] || null });
    } catch (e) { res.status(500).json({ ok: false, error: 'WA_CHAT_META_FAILED' }); }
});

router.post('/chats/:jid/meta', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const jid = decodeURIComponent(req.params.jid);
        const body = req.body || {};
        if (!isValidChatJid(jid)) {return res.status(422).json({ ok: false, error: 'INVALID_JID' });}
        const allowedStatus = new Set(['open', 'pending', 'resolved', 'snoozed']);
        const allowedPriority = new Set(['low', 'normal', 'high', 'urgent']);
        if (body.status && !allowedStatus.has(body.status)) {return res.status(422).json({ ok: false, error: 'INVALID_CHAT_STATUS' });}
        if (body.priority && !allowedPriority.has(body.priority)) {return res.status(422).json({ ok: false, error: 'INVALID_CHAT_PRIORITY' });}
        const assignedTo = body.assigned_to === undefined ? null : (Number(body.assigned_to) || null);
        const meta = await store.updateChatMeta(jid, {
            assignedTo,
            status: body.status,
            priority: body.priority,
            tags: Array.isArray(body.tags) ? body.tags : undefined,
            internalNote: body.internal_note === undefined ? undefined : String(body.internal_note).slice(0, 4000),
        }, req.user?.id);
        await store.logEvent('chat_meta_updated', jid, `by user ${req.user?.id || 'system'}`);
        res.json({ ok: true, meta });
    } catch (e) { logger.error('[wa/chat-meta]', e.message); res.status(500).json({ ok: false, error: 'WA_CHAT_META_SAVE_FAILED' }); }
});

router.get('/outbox', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const r = await store.pool.query(`SELECT id, remote_jid, LEFT(body, 120) AS preview, status, attempts, created_at, sent_at, last_error FROM wa_outbox ORDER BY created_at DESC LIMIT 100`);
        res.json({ ok: true, rows: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: 'WA_OUTBOX_FAILED' }); }
});

router.get('/rules', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const r = await store.pool.query(`SELECT * FROM wa_rules ORDER BY priority, id`);
        res.json({ ok: true, rows: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: 'WA_RULES_FAILED' }); }
});

router.post('/rules', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.name || !b.pattern || !['exact', 'contains', 'command'].includes(b.match_type)) {
            return res.status(422).json({ ok: false, error: 'INVALID_RULE', message: 'name/pattern/match_type مطلوبة' });
        }
        res.status(201).json({ ok: true, row: await store.upsertRule(b) });
    } catch (e) { res.status(500).json({ ok: false, error: 'WA_RULE_SAVE_FAILED' }); }
});

router.delete('/rules/:id', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try { await store.deleteRule(Number(req.params.id)); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: 'WA_RULE_DELETE_FAILED' }); }
});

router.post('/chats/auto-reply', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const jid = String(req.body?.jid || '').trim();
        if (!isValidChatJid(jid)) {return res.status(422).json({ ok: false, error: 'INVALID_JID' });}
        await store.setChatAutoReply(jid, req.body?.enabled !== false);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: 'WA_CHAT_FAILED' }); }
});

router.get('/logs', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const r = await store.pool.query(`SELECT * FROM wa_events ORDER BY created_at DESC LIMIT 200`);
        res.json({ ok: true, rows: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: 'WA_LOGS_FAILED' }); }
});

// ─── قايمة أرقام الإدارة (تقرير واتساب للمدير فقط) — admin ───
router.get('/managers', jwtAuth, requireRole('admin'), async (req, res) => {
    try { res.json({ ok: true, numbers: await store.managerJids() }); }
    catch (e) { res.status(500).json({ ok: false, error: 'WA_MANAGERS_FAILED' }); }
});
router.post('/managers', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const digits = String(req.body?.number || '').replace(/\D/g, '');
        if (!/^\d{7,16}$/.test(digits)) {return res.status(422).json({ ok: false, error: 'INVALID_NUMBER', message: 'رقم غير صالح (7-16 رقمًا)' });}
        const cur = await store.managerJids();
        if (!cur.includes(digits)) {
            cur.push(digits);
            await store.setSetting('manager_jids', JSON.stringify(cur));
            try { await store.logEvent('manager_added', digits, req.user?.name || ''); } catch (_) {}
        }
        res.status(201).json({ ok: true, numbers: await store.managerJids() });
    } catch (e) { res.status(500).json({ ok: false, error: 'WA_MANAGER_ADD_FAILED' }); }
});
router.delete('/managers/:number', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const digits = String(req.params.number || '').replace(/\D/g, '');
        const next = (await store.managerJids()).filter((x) => x !== digits);
        await store.setSetting('manager_jids', JSON.stringify(next));
        try { await store.logEvent('manager_removed', digits, req.user?.name || ''); } catch (_) {}
        res.json({ ok: true, numbers: next });
    } catch (e) { res.status(500).json({ ok: false, error: 'WA_MANAGER_DEL_FAILED' }); }
});

// ─── التقارير المجدولة والتنبيهات (admin) ───
router.get('/automation', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const { getSettings } = require('./automation');
        res.json({ ok: true, settings: await getSettings() });
    } catch (e) { res.status(500).json({ ok: false, error: 'WA_AUTO_FAILED' }); }
});
router.post('/automation', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const { saveSettings } = require('./automation');
        res.json({ ok: true, settings: await saveSettings(req.body || {}) });
    } catch (e) { res.status(500).json({ ok: false, error: 'WA_AUTO_SAVE_FAILED' }); }
});
router.post('/automation/test', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const { pushBriefing, riyadhNow } = require('./automation');
        const r = await pushBriefing(engineRef, riyadhNow().day, 'manual-' + Date.now());
        res.json({ ok: true, ...r });
    } catch (e) { res.status(500).json({ ok: false, error: 'WA_AUTO_TEST_FAILED', message: String(e.message).slice(0, 200) }); }
});

// ═══════════════════════════════════════════════════════════════
// v4.0 — Professional Features API
// ═══════════════════════════════════════════════════════════════

// ─── الاستعلامات الذكية للنظام ───
// FIX 2026-10-11 (M10): was purging require.cache on EVERY request (CPU DoS
// amplifier). Now caches the module and only invalidates every 5 minutes.
let _sqCache = null;
let _sqCacheAt = 0;
const SQ_CACHE_TTL_MS = 5 * 60 * 1000;
function getSystemQuery() {
    if (!_sqCache || Date.now() - _sqCacheAt > SQ_CACHE_TTL_MS) {
        delete require.cache[require.resolve('./system-query')];
        _sqCache = require('./system-query');
        _sqCacheAt = Date.now();
    }
    return _sqCache;
}
router.get('/query/categories', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try { const sq = getSystemQuery(); res.json({ ok: true, categories: sq.getCategories() }); }
    catch (e) { res.status(500).json({ ok: false, error: 'QUERY_CATEGORIES_FAILED' }); }
});
router.post('/query', jwtAuth, requireRole(...WRITE_ROLES), rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
    try {
        const { question } = req.body || {};
        const sq = getSystemQuery();
        const result = await sq.executeQuery(question);
        res.json({ ok: true, result, question });
    } catch (e) { res.status(500).json({ ok: false, error: 'QUERY_FAILED', message: 'تعذر تنفيذ الاستعلام — راجع سجل الخادم' }); }
});

// ─── AI Chatbot ───
router.get('/ai/config', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try { res.json({ ok: true, enabled: engineRef.ai?.enabled || false, model: engineRef.config?.aiModel || 'N/A', temperature: engineRef.config?.aiTemperature || 0.3 }); }
    catch (e) { res.status(500).json({ ok: false, error: 'AI_CONFIG_FAILED' }); }
});
router.post('/ai/config', jwtAuth, requireRole('admin'), rateLimit({ windowMs: 60000, max: 5 }), async (req, res) => {
    try {
        const { model, temperature, maxTokens } = req.body || {};
        await store.setSetting('ai_model', model || 'auto/best-coding');
        await store.setSetting('ai_temperature', temperature || 0.3);
        await store.setSetting('ai_max_tokens', maxTokens || 200);
        res.json({ ok: true, message: 'AI config saved' });
    } catch (e) { res.status(500).json({ ok: false, error: 'AI_CONFIG_SAVE_FAILED' }); }
});
router.post('/ai/chat', jwtAuth, requireRole(...WRITE_ROLES), rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
    try {
        const { message, customerName } = req.body || {};
        if (!message) {return res.status(422).json({ ok: false, error: 'MESSAGE_REQUIRED' });}
        const response = await engineRef.ai.respond('admin-test', message, { customerName: customerName || 'Admin' });
        res.json({ ok: true, response });
    } catch (e) { res.status(500).json({ ok: false, error: 'AI_CHAT_FAILED', message: e.message.slice(0, 200) }); }
});

// ─── Message Templates ───
router.get('/templates', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const r = await store.pool.query(`SELECT name, category, ar, en, variables FROM wa_templates ORDER BY category, name`);
        res.json({ ok: true, templates: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: 'TEMPLATES_FAILED' }); }
});
router.post('/templates', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const { name, category, ar, en, variables } = req.body || {};
        await store.pool.query(
            `INSERT INTO wa_templates (name, category, ar, en, variables) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (name) DO UPDATE SET category=$2, ar=$3, en=$4, variables=$5`,
            [name, category, ar, en, variables || 0]
        );
        try { engineRef.templates?.clearCache?.(); } catch (_) {}
        res.json({ ok: true, message: `Template "${name}" saved` });
    } catch (e) { res.status(500).json({ ok: false, error: 'TEMPLATE_SAVE_FAILED' }); }
});
router.post('/templates/send', jwtAuth, requireRole(...WRITE_ROLES), rateLimit({ windowMs: 60000, max: 20, keyFn: (r) => `wa_tmpl:${r.user.id}` }), async (req, res) => {
    try {
        const to = String(req.body?.to || '').trim();
        const name = String(req.body?.name || '').trim();
        const lang = String(req.body?.lang || 'ar').toLowerCase() === 'en' ? 'en' : 'ar';
        const vars = Array.isArray(req.body?.vars) ? req.body.vars.map((v) => String(v ?? '').slice(0, 200)) : [];
        if (!isValidChatJid(to)) {return res.status(422).json({ ok: false, error: 'INVALID_JID', message: 'رقم/معرف غير صالح' });}
        if (!name) {return res.status(422).json({ ok: false, error: 'UNKNOWN_TEMPLATE', message: 'اسم القالب مطلوب' });}
        const tm = engineRef.templates;
        if (!tm) {return res.status(500).json({ ok: false, error: 'TEMPLATES_UNAVAILABLE' });}
        const text = await tm.get(name, lang);
        if (!text) {return res.status(422).json({ ok: false, error: 'UNKNOWN_TEMPLATE', message: `قالب غير معروف: ${name}` });}
        const need = tm.countVars ? tm.countVars(text) : 0;
        if (vars.length < need) {return res.status(422).json({ ok: false, error: 'MISSING_VARS', message: `القالب يحتاج ${need} متغيرات` });}
        const body = tm.fill(text, ...vars);
        const out = await engineRef.sender.enqueue(to, body, { createdBy: req.user?.id, clientKey: `tmpl:${to}:${name}:${Date.now()}` });
        res.status(201).json({ ok: true, id: out.id, status: out.status });
    } catch (e) {
        if (e && (e.code === 'BULK_FROZEN' || e.code === 'WARMUP_CAP' || e.code === 'COLD_CAP' || e.code === 'SENDER_PAUSED')) {
            return res.status(429).json({ ok: false, error: e.code, message: e.message });
        }
        logger.error('[wa/templates/send]', e.message); res.status(500).json({ ok: false, error: 'WA_TEMPLATE_SEND_FAILED' });
    }
});

// ─── Consent-based Campaigns ───
router.get('/campaigns', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const r = await store.pool.query(`
            SELECT c.*, COUNT(cr.id)::int AS recipients,
                   COUNT(cr.id) FILTER (WHERE cr.consent)::int AS consented,
                   COUNT(cr.id) FILTER (WHERE cr.status IN ('queued','sent'))::int AS queued,
                   COUNT(cr.id) FILTER (WHERE cr.status='sent')::int AS sent
              FROM wa_campaigns c LEFT JOIN wa_campaign_recipients cr ON cr.campaign_id=c.id
             GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`);
        res.json({ ok: true, campaigns: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: 'CAMPAIGNS_FAILED' }); }
});
router.post('/campaigns', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const name = String(req.body?.name || '').trim().slice(0, 160);
        const templateName = String(req.body?.template_name || '').trim().slice(0, 120);
        const lang = String(req.body?.lang || 'ar').toLowerCase() === 'en' ? 'en' : 'ar';
        const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients.slice(0, 1000) : [];
        if (!name || !templateName || !recipients.length) {return res.status(422).json({ ok: false, error: 'CAMPAIGN_FIELDS_REQUIRED' });}
        const scheduledAt = req.body?.scheduled_at ? new Date(req.body.scheduled_at) : null;
        if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {return res.status(422).json({ ok: false, error: 'INVALID_SCHEDULE' });}
        const client = await store.pool.connect();
        try {
            await client.query('BEGIN');
            const c = (await client.query(`INSERT INTO wa_campaigns (name,template_name,lang,scheduled_at,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [name, templateName, lang, scheduledAt, req.user?.id])).rows[0];
            for (const item of recipients) {
                const jid = String(item?.remote_jid || item?.jid || '').trim();
                if (!isValidChatJid(jid)) {continue;}
                await client.query(`INSERT INTO wa_campaign_recipients (campaign_id,remote_jid,vars,consent) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [c.id, jid, JSON.stringify(Array.isArray(item.vars) ? item.vars.slice(0, 20).map((v) => String(v).slice(0, 200)) : []), item.consent === true]);
            }
            await client.query('COMMIT');
            res.status(201).json({ ok: true, campaign: c });
        } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    } catch (e) { logger.error('[wa/campaign-create]', e.message); res.status(500).json({ ok: false, error: 'CAMPAIGN_CREATE_FAILED' }); }
});
router.post('/campaigns/:id/approve', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const r = await store.pool.query(`UPDATE wa_campaigns SET status='approved', approved_by=$2, approved_at=NOW(), updated_at=NOW() WHERE id=$1 AND status='draft' RETURNING *`, [req.params.id, req.user?.id]);
        if (!r.rows.length) {return res.status(409).json({ ok: false, error: 'CAMPAIGN_NOT_DRAFT' });}
        res.json({ ok: true, campaign: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'CAMPAIGN_APPROVE_FAILED' }); }
});
router.post('/campaigns/:id/pause', jwtAuth, requireRole('admin'), async (req, res) => {
    try { const r = await store.pool.query(`UPDATE wa_campaigns SET status='paused', updated_at=NOW() WHERE id=$1 AND status IN ('approved','running') RETURNING *`, [req.params.id]); res.json({ ok: true, campaign: r.rows[0] || null }); }
    catch (e) { res.status(500).json({ ok: false, error: 'CAMPAIGN_PAUSE_FAILED' }); }
});
router.post('/campaigns/:id/cancel', jwtAuth, requireRole('admin'), async (req, res) => {
    try { const r = await store.pool.query(`UPDATE wa_campaigns SET status='cancelled', updated_at=NOW() WHERE id=$1 AND status NOT IN ('completed','cancelled') RETURNING *`, [req.params.id]); res.json({ ok: true, campaign: r.rows[0] || null }); }
    catch (e) { res.status(500).json({ ok: false, error: 'CAMPAIGN_CANCEL_FAILED' }); }
});

// ─── Workflows ───
router.get('/workflows', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const r = await store.pool.query(`SELECT id, name, flow_key, is_active, created_at FROM wa_workflows ORDER BY name`);
        res.json({ ok: true, workflows: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: 'WORKFLOWS_FAILED' }); }
});
router.post('/workflows/:key/run', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const { key } = req.params;
        const result = await engineRef.workflows.startFlow('admin@admin', key);
        res.json({ ok: true, result });
    } catch (e) { res.status(500).json({ ok: false, error: 'WORKFLOW_RUN_FAILED', message: e.message.slice(0, 200) }); }
});
router.get('/workflows/active', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try { res.json({ ok: true, active: engineRef.workflows.activeCount, sessions: Array.from(engineRef.workflows._activeSessions.keys()) }); }
    catch (e) { res.status(500).json({ ok: false, error: 'WORKFLOW_ACTIVE_FAILED' }); }
});

// ─── Webhooks ───
router.get('/webhooks', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const r = await store.pool.query(`SELECT id, event, url, active FROM wa_webhooks ORDER BY event`);
        res.json({ ok: true, webhooks: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: 'WEBHOOKS_FAILED' }); }
});
router.post('/webhooks', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const { event, url } = req.body || {};
        const secret = crypto.randomBytes(32).toString('hex');
        await store.pool.query(`INSERT INTO wa_webhooks (event, url, secret, active) VALUES ($1,$2,$3,true) ON CONFLICT (event,url) DO UPDATE SET url=$2, active=true`, [event, url, secret]);
        res.json({ ok: true, secret, message: `Webhook ${event} registered` });
    } catch (e) { res.status(500).json({ ok: false, error: 'WEBHOOK_SAVE_FAILED' }); }
});
router.delete('/webhooks/:id', jwtAuth, requireRole('admin'), async (req, res) => {
    try { await store.pool.query(`DELETE FROM wa_webhooks WHERE id=$1`, [req.params.id]); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: 'WEBHOOK_DELETE_FAILED' }); }
});

// ─── Circuit Breaker ───
router.get('/circuit-breaker/status', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try { res.json({ ok: true, ...engineRef.circuitBreaker.getStatus() }); }
    catch (e) { res.status(500).json({ ok: false, error: 'CB_STATUS_FAILED' }); }
});

// ─── Analytics Dashboard ───
router.get('/analytics/dashboard', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const days = Number(req.query.days) || 30;
        const analytics = await engineRef.analytics.healthMetrics();
        res.json({ ok: true, analytics, period: days });
    } catch (e) { res.status(500).json({ ok: false, error: 'ANALYTICS_FAILED' }); }
});
router.get('/analytics/engagement', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const days = Number(req.query.days) || 7;
        const r = await store.pool.query(
            `SELECT day, total_messages, avg_response_sec, orders_confirmed FROM wa_analytics_daily WHERE day >= NOW() - INTERVAL '$1 days' ORDER BY day DESC`,
            [days]
        );
        res.json({ ok: true, data: r.rows, period: days });
    } catch (e) { res.status(500).json({ ok: false, error: 'ENGAGEMENT_FAILED' }); }
});

// ─── Media Upload ───
router.post('/media/upload', jwtAuth, requireRole(...WRITE_ROLES), rateLimit({ windowMs: 60000, max: 5 }), async (req, res) => {
    try {
        const { jid, mediaType } = req.body || {};
        if (!jid || !isValidChatJid(jid)) {return res.status(422).json({ ok: false, error: 'INVALID_JID' });}
        // Media upload creates a pending message with media type
        const out = await store.enqueueOutbox({ clientKey: clientKeyFor(jid, `media:${Date.now()}`), remoteJid: jid, body: '', status: 'pending_media', mediaType: mediaType || 'image' });
        try { engineRef.sender?.kick(); } catch (_) {}
        res.status(201).json({ ok: true, id: out.id, message: 'Media queued' });
    } catch (e) { res.status(500).json({ ok: false, error: 'MEDIA_UPLOAD_FAILED' }); }
});

// ════════════════════════════════════════════════════════════════════════════════
// v5.0 — World-Class Professional Features API
// ════════════════════════════════════════════════════════════════════════════════

// ─── Scheduled Messages ───
router.get('/scheduled', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const result = await engineRef.scheduler.list({
            status: req.query.status,
            jid: req.query.jid,
            page: Number(req.query.page) || 1,
            limit: Number(req.query.limit) || 20,
        });
        res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ ok: false, error: 'SCHEDULER_LIST_FAILED' }); }
});

router.post('/scheduled', jwtAuth, requireRole(...WRITE_ROLES), rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
    try {
        const { jid, text, scheduledAt, recurrence, templateName, templateVars } = req.body || {};
        if (!jid || !text || !scheduledAt) {
            return res.status(422).json({ ok: false, error: 'MISSING_FIELDS', message: 'jid, text, scheduledAt مطلوبة' });
        }
        const jidFull = String(jid).includes('@') ? jid : `${jid}@s.whatsapp.net`;
        const msg = await engineRef.scheduler.schedule(jidFull, text, scheduledAt, {
            recurrence: recurrence || 'once',
            templateName,
            templateVars,
            createdBy: req.user?.id,
        });
        res.status(201).json({ ok: true, message: 'تمت جدولة الرسالة', scheduled: msg });
    } catch (e) {
        if (e.message === 'INVALID_JID' || e.message === 'EMPTY_BODY' || e.message === 'NO_SCHEDULE_TIME' || e.message === 'INVALID_DATE') {
            return res.status(422).json({ ok: false, error: e.message });
        }
        logger.error('[wa/scheduled]', e.message);
        res.status(500).json({ ok: false, error: 'SCHEDULE_FAILED' });
    }
});

router.delete('/scheduled/:id', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const result = await engineRef.scheduler.cancel(Number(req.params.id));
        if (!result) {return res.status(404).json({ ok: false, error: 'NOT_FOUND' });}
        res.json({ ok: true, message: 'تم إلغاء الرسالة المجدولة' });
    } catch (e) { res.status(500).json({ ok: false, error: 'SCHEDULE_CANCEL_FAILED' }); }
});

// ─── Interactive Messages (Buttons, Lists) ───
router.post('/send-buttons', jwtAuth, requireRole(...WRITE_ROLES), rateLimit({ windowMs: 60000, max: 15 }), async (req, res) => {
    try {
        const { to, text, buttons, footer } = req.body || {};
        if (!to || !text || !Array.isArray(buttons)) {
            return res.status(422).json({ ok: false, error: 'MISSING_FIELDS', message: 'to, text, buttons مطلوبة' });
        }
        const btnList = buttons.slice(0, 3).map((b, i) => ({
            id: String(b.id || `btn_${i}`).slice(0, 200),
            text: String(b.text || '').slice(0, 25),
            description: String(b.description || '').slice(0, 72),
        }));
        const out = await engineRef.sender.enqueueButtons(to, { text, buttons: btnList, footer, createdBy: req.user?.id });
        res.status(201).json({ ok: true, id: out.id, status: out.status });
    } catch (e) {
        if (e?.code === 'BULK_FROZEN' || e?.code === 'WARMUP_CAP' || e?.code === 'COLD_CAP' || e?.code === 'SENDER_PAUSED') {
            return res.status(429).json({ ok: false, error: e.code, message: e.message });
        }
        logger.error('[wa/send-buttons]', e.message);
        res.status(500).json({ ok: false, error: 'BUTTONS_SEND_FAILED' });
    }
});

router.post('/send-quick-reply', jwtAuth, requireRole(...WRITE_ROLES), rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
    try {
        const { to, text, options } = req.body || {};
        if (!to || !text || !Array.isArray(options)) {
            return res.status(422).json({ ok: false, error: 'MISSING_FIELDS', message: 'to, text, options مطلوبة' });
        }
        const out = await engineRef.sender.enqueueQuickReply(to, { text, options, createdBy: req.user?.id });
        res.status(201).json({ ok: true, id: out.id, status: out.status });
    } catch (e) {
        if (e?.code === 'BULK_FROZEN' || e?.code === 'WARMUP_CAP' || e?.code === 'COLD_CAP' || e?.code === 'SENDER_PAUSED') {
            return res.status(429).json({ ok: false, error: e.code, message: e.message });
        }
        res.status(500).json({ ok: false, error: 'QUICK_REPLY_FAILED' });
    }
});

// ─── NLU Analytics & Training ───
router.get('/nlu/intents', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const { INTENTS } = require('./ai/nlu');
        const intents = Object.values(INTENTS).map(i => ({
            id: i.id, category: i.category,
            keywordsAr: (i.keywords.ar || []).length,
            keywordsEn: (i.keywords.en || []).length,
            entities: i.entities || [],
            minConfidence: i.minConfidence,
        }));
        res.json({ ok: true, intents, total: intents.length });
    } catch (e) { res.status(500).json({ ok: false, error: 'NLU_INTENTS_FAILED' }); }
});

router.post('/nlu/test', jwtAuth, requireRole(...READ_ROLES), rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
    try {
        const { text } = req.body || {};
        if (!text) {return res.status(422).json({ ok: false, error: 'TEXT_REQUIRED' });}
        const { processNLU } = require('./ai/nlu');
        const result = await processNLU(text, 'test@nlu');
        res.json({ ok: true, result });
    } catch (e) { res.status(500).json({ ok: false, error: 'NLU_TEST_FAILED' }); }
});

router.get('/nlu/analytics', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const days = Number(req.query.days) || 7;
        const r = await store.pool.query(
            `SELECT detected_intent, COUNT(*)::int AS count,
                    AVG(confidence)::float AS avg_confidence,
                    MAX(created_at) AS last_seen
               FROM wa_nlu_analytics
              WHERE created_at >= NOW() - ($1 || ' days')::interval
              GROUP BY detected_intent
              ORDER BY count DESC LIMIT 50`, [days]
        );
        res.json({ ok: true, analytics: r.rows, period: days });
    } catch (e) { res.status(500).json({ ok: false, error: 'NLU_ANALYTICS_FAILED' }); }
});

// ─── Conversation History ───
router.get('/conversations/:jid', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const jid = decodeURIComponent(req.params.jid);
        if (!isValidChatJid(jid)) {return res.status(422).json({ ok: false, error: 'INVALID_JID' });}
        const limit = Math.min(100, Number(req.query.limit) || 50);
        const r = await store.pool.query(
            `SELECT id, direction, body, intent, sentiment, language, is_ai_reply, ai_source, created_at
               FROM wa_conversation_history
              WHERE remote_jid = $1
              ORDER BY created_at DESC LIMIT $2`, [jid, limit]
        );
        res.json({ ok: true, conversations: r.rows.reverse() });
    } catch (e) { res.status(500).json({ ok: false, error: 'CONVERSATION_HISTORY_FAILED' }); }
});

router.delete('/conversations/:jid', jwtAuth, requireRole(...WRITE_ROLES), async (req, res) => {
    try {
        const jid = decodeURIComponent(req.params.jid);
        if (!isValidChatJid(jid)) {return res.status(422).json({ ok: false, error: 'INVALID_JID' });}
        // Clear in-memory context
        const { clearContext } = require('./ai/nlu');
        clearContext(jid);
        // Clear DB history
        await store.pool.query(`DELETE FROM wa_conversation_history WHERE remote_jid = $1`, [jid]);
        res.json({ ok: true, message: 'تم مسح سجل المحادثة' });
    } catch (e) { res.status(500).json({ ok: false, error: 'CONVERSATION_CLEAR_FAILED' }); }
});

// ─── AI Provider Status (Free & Open Source) ───
router.get('/ai/providers', jwtAuth, requireRole(...READ_ROLES), async (req, res) => {
    try {
        const { LLM_PROVIDERS } = require('./ai/chatbot');
        const providers = Object.entries(LLM_PROVIDERS).map(([id, p]) => ({
            id, url: p.url, model: p.model, isLocal: p.isLocal, isFree: true,
        }));
        res.json({
            ok: true,
            current: engineRef.getConfig().aiProvider,
            enabled: engineRef.ai?.enabled || false,
            llmAvailable: engineRef.ai?._llmAvailable || false,
            providers,
        });
    } catch (e) { res.status(500).json({ ok: false, error: 'AI_PROVIDERS_FAILED' }); }
});

module.exports = { router, setEngine: (e) => { engineRef = e; } };
