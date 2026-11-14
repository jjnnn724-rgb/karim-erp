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
const analyzer = require('./analyzer');
const { riyadhToday } = require('../riyadh-date');

/* الأدمن وحده — طلب المالك صراحة: الإدارة العليا فقط (لا مدير ولا محاسب). */
const ANALYTICS_ROLES = ['admin'];

/** تحقق صارم من تاريخ ISO. */
function isoStrict(value) {
    const s = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) ? s : null;
}

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
    res.set('Cache-Control', 'no-store');
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

/** تحليلٌ أعمق: النموذج المحلي يقرأ بالأدوات ثم يلخّص (اختيار المالك — أبطأ). */
router.post('/ask/deep', jwtAuth, requireRole('admin'), asyncHandler(async (req, res) => {
    const question = String((req.body || {}).question || '').trim();
    if (!question) {return res.status(400).json({ error: 'EMPTY_QUESTION', message: 'اكتب سؤالًا أولًا.' });}
    if (!(await localLlm.available().catch(() => false))) {
        return res.status(503).json({ error: 'LOCAL_LLM_UNAVAILABLE', message: 'النموذج المحلي غير متاح الآن.' });
    }
    const started = Date.now();
    const mode = (req.body || {}).mode || 'knowledge';
    // ميزانيةُ وقتٍ سخيّة: هذا مسار اختاره المالك (تحليلٌ أعمق بالنموذج
    // المحلي على معالجٍ بلا GPU).
    const budget = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 90000);
        if (typeof timer.unref === 'function') {timer.unref();}
    });
    const r = await Promise.race([assistant.deep({ question, mode, screen: (req.body || {}).screen }), budget]);
    if (!r) {
        return res.status(504).json({ error: 'LOCAL_LLM_TIMEOUT', message: 'تجاوز النموذج المحلي الوقت — أعد المحاولة.' });
    }
    logger.info(`[ai-assistant] تحليل عميق mode=${mode} model=${r.model} ms=${Date.now() - started}`);
    return res.json({ text: r.text, model: r.model, ms: Date.now() - started });
}));

/** المسوّدات المعلّقة (تعديلات مقترحة لم تُنفَّذ بعد). */
router.get('/drafts', jwtAuth, requireRole('admin'), (req, res) => {
    // لا تخزين: قائمة المسوّدات تتغيّر بتطبيق/رفض ⇒ ذاكرةٌ قديمة تخدع المالك.
    res.set('Cache-Control', 'no-store');
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

/** تحليلات مقارنة (أسبوع/شهر) — حتمية من القاعدة، بلا نموذج. */
router.get('/analytics', jwtAuth, requireRole(...ANALYTICS_ROLES), asyncHandler(async (req, res) => {
    const rangeRaw = String(req.query.range || 'week');
    const range = rangeRaw === 'month' ? 'month' : rangeRaw === 'custom' ? 'custom' : 'week';
    const fromParam = isoStrict(req.query.from);
    const toParam = isoStrict(req.query.to);
    const alertPct = Number(req.query.alertPct ?? 0);
    res.set('Cache-Control', 'no-store');
    if (range === 'custom' && (!fromParam || !toParam)) {
        return res.status(422).json({ error: 'RANGE_REQUIRED', message: 'custom يحتاج from وto بصيغة YYYY-MM-DD' });
    }
    res.json(await analyzer.cachedAnalytics({ range, alertPct: Number.isFinite(alertPct) ? alertPct : 0, from: fromParam, to: toParam }));
}));

/** شرح الصورة بالنموذج المحلي المجاني (اختياري — عند الطلب فقط). */
router.post('/analytics/explain', jwtAuth, requireRole(...ANALYTICS_ROLES), assistantLimiter, asyncHandler(async (req, res) => {
    const body = req.body || {};
    const range = body.range === 'month' ? 'month' : 'week';
    const alertPct = Number(body.alertPct ?? 0);
    const report = await analyzer.cachedAnalytics({ range, alertPct: Number.isFinite(alertPct) ? alertPct : 0 });
    const out = await analyzer.explain(report);
    res.json({ ...out, range: report.range, days: report.days, alertPct: report.alertPct });
}));


/** رادار النظام — كل الفحوصات في ملف واحد (٥ دقائق كاش). */
router.get('/radar', jwtAuth, requireRole(...ANALYTICS_ROLES), asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await require('./radar').cachedRadar());
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
        // هل يمكن للعميل أن يطلب تحليلًا أعمق بالنموذج المحلي؟
        canDeep: result.canDeep !== false,
    });
}));

module.exports = { router, assistantLimiter, MAX_PER_WINDOW, WINDOW_MS };
