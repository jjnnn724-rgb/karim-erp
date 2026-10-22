/**
 * ai-assistant/routes.js — بوابة المساعد (الأدمن فقط)
 * ══════════════════════════════════════════════════════════════════════
 * البوابة ثلاثة أقفال لا يُفتح أحدها:
 *   1) session حيّة (jwtAuth) — لا anon ولا مفتاح واجهة.
 *   2) دور admin (requireRole) — المساعد يقرأ المشروع وال.Diagnostics الحيّة.
 *   3) محدّد معدل خاص — الطلب مكلف (نموذج مجاني بحصة يومية)، فسقفٌ
 *      صغير لكل مستخدم: 12 طلبًا / 5 دقائق.
 *
 * ما لا يُسجَّل: نصّ السؤال (فيه بيانات المالك) ولا نصّ الرد. يُسجَّل
 * الوضع والمدة والنموذج فقط — عيّن تشغيل بلا محتوى.
 */
'use strict';

const express = require('express');
const { jwtAuth, requireRole } = require('../cashier-module/jwt-middleware');
const { asyncHandler } = require('../errors/error-handler');
const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const assistant = require('./assistant');
const localLlm = require('./local-llm');
const tools = require('./tools');
const { riyadhToday } = require('../riyadh-date');

const router = express.Router();

/* محدّد المساعد: 12 طلبًا لكل مستخدم كل 5 دقائق. */
const WINDOW_MS = 5 * 60 * 1000;
const MAX_PER_WINDOW = 12;
const hits = new Map();

function assistantLimiter(req, res, next) {
    const key = String((req.user && (req.user.id || req.user.username)) || req.ip || 'anon');
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
    if (list.length >= MAX_PER_WINDOW) {
        const wait = Math.ceil((WINDOW_MS - (now - list[0])) / 1000);
        res.set('Retry-After', String(wait));
        return res.status(429).json({
            error: 'RATE_LIMITED',
            message: `تجاوزت حدّ المساعد (${MAX_PER_WINDOW} طلبًا كل ${WINDOW_MS / 60000} دقائق). حاول بعد ${wait} ثانية.`,
        });
    }
    list.push(now);
    hits.set(key, list);
    return next();
}

/** حالة المساعد: محلي أولًا (بلا مفاتيح) ثم سحابي اختياري. */
router.get('/status', jwtAuth, requireRole('admin'), async (req, res) => {
    const local = await localLlm.available().catch(() => false);
    res.json({
        enabled: local || assistant.enabled(),
        local,
        model: local ? await localLlm.activeModel().catch(() => localLlm.MODEL) : (assistant.enabled() ? assistant.model() : null),
        free: true,
        modes: assistant.MODES,
        maxQuestion: assistant.MAX_QUESTION,
    });
});

/** إنشاء مسوّدة مباشرة (بلا نموذج): المالك يملأ الحقول بنفسه. */
router.post('/drafts', jwtAuth, requireRole('admin'), asyncHandler(async (req, res) => {
    const body = req.body || {};
    const kind = body.kind === 'revenue' ? 'revenue' : 'expense';
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(422).json({ error: 'AMOUNT_INVALID', message: 'المبلغ مطلوب ويجب أن يكون أكبر من صفر.' });
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? String(body.date) : riyadhToday();
    const d = tools.draft(kind, {
        date,
        deptId: String(body.deptId || '').slice(0, 60),
        amount: Math.round(amount * 100) / 100,
        method: String(body.method || 'cash').slice(0, 40),
        note: String(body.note || '').slice(0, 200),
    });
    return res.json({ draft: d, ok: true });
}));

/** المسوّدات المعلّقة (تعديلات مقترحة لم تُنفَّذ بعد). */
router.get('/drafts', jwtAuth, requireRole('admin'), (req, res) => {
    res.json({ drafts: tools.listDrafts() });
});

/** تنفيذ مسوّدة بموافقة المالك (بصلاحيته هو — بلا تجاوز). */
router.post('/drafts/:id/apply', jwtAuth, requireRole('admin'), asyncHandler(async (req, res) => {
    const d = await tools.applyDraft(req.params.id, { token: req.headers.authorization, user: req.user });
    res.json({ draft: d, ok: d.result && d.result.ok });
}));

/** رفض مسوّدة. */
router.post('/drafts/:id/reject', jwtAuth, requireRole('admin'), asyncHandler(async (req, res) => {
    res.json({ draft: tools.rejectDraft(req.params.id) });
}));

/** سؤال واحد ⇒ رد واحد. */
router.post('/ask', jwtAuth, requireRole('admin'), assistantLimiter, asyncHandler(async (req, res) => {
    const body = req.body || {};
    const question = String(body.question || '').trim();
    if (!question) {
        return res.status(400).json({ error: 'EMPTY_QUESTION', message: 'اكتب سؤالًا أولًا.' });
    }
    if (question.length > assistant.MAX_QUESTION) {
        return res.status(400).json({
            error: 'QUESTION_TOO_LONG',
            message: `الحدّ ${assistant.MAX_QUESTION} حرف.`,
        });
    }
    const started = Date.now();
    const result = await assistant.ask({
        question,
        mode: body.mode,
        screen: body.screen,
        paths: body.paths,
        pool,
        ctx: { token: req.headers.authorization, user: req.user },
    });
    // عيّن تشغيل بلا محتوى: الوضع والمدة والنموذج فقط.
    logger.info(`[ai-assistant] mode=${result.mode} model=${result.model || 'rule-based'} fallback=${result.fallback} ms=${Date.now() - started}`);
    return res.json({
        text: result.text,
        mode: result.mode,
        model: result.model,
        fallback: result.fallback,
        grounded: result.grounded,
    });
}));

module.exports = { router, assistantLimiter, MAX_PER_WINDOW, WINDOW_MS };
