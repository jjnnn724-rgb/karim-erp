// ═══════════════════════════════════════════════════════════════════
// Karim ERP — مسارات إشعارات الهاتف (/api/push) — 2026-10-31
// ───────────────────────────────────────────────────────────────────
// تسجيل توكن جهاز (FCM) بعد الدخول وحذفه عند الخروج. هذا الملف مسارات
// فقط بلا SQL — التخزين يعيش في notification-service.js (نمط الدوال
// البحتة). كل النقاط محمية بـ jwtAuth: توكن جهاز لا يُسجَّل إلا لصاحب
// الجلسة نفسه.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const { jwtAuth } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');
const {
    savePushToken, deletePushToken, pushTokensForUsers,
} = require('./notification-service');
const { pushStatus } = require('./push-service');

const router = express.Router();

router.use(jwtAuth);

/** فحص حالة الخدمة (للتشخيص ولشاشة الجلسات لاحقًا). */
router.get('/status', (req, res) => {
    res.json(pushStatus());
});

/** توكنات أجهزتي (للمراجعة/التشخيص). */
router.get('/devices', async (req, res) => {
    try {
        const tokens = await pushTokensForUsers([req.user.id]);
        res.json({ devices: tokens.map((t) => ({ token: String(t).slice(0, 8) + '…', tokenHash8: t.slice(-6) })) });
    } catch (error) {
        logger.error('[push_devices]', error);
        res.status(500).json({ error: 'PUSH_DEVICES_FAILED', message: 'تعذر جلب أجهزتك' });
    }
});

/** تسجيل توكن جهاز بعد منح الإذن في التطبيق. */
router.post('/register', async (req, res) => {
    try {
        const token = String(req.body?.token || '').trim();
        if (token.length < 20) {
            return res.status(422).json({ error: 'PUSH_TOKEN_REQUIRED', message: 'توكن جهاز صالح مطلوب' });
        }
        const ok = await savePushToken(req.user.id, token, req.body?.platform);
        if (!ok) {return res.status(500).json({ error: 'PUSH_REGISTER_FAILED', message: 'تعذر تسجيل الجهاز' });}
        logger.info({ userId: req.user.id, platform: String(req.body?.platform || 'android') }, '[push] device registered');
        res.json({ ok: true });
    } catch (error) {
        logger.error('[push_register]', error);
        res.status(500).json({ error: 'PUSH_REGISTER_FAILED', message: 'تعذر تسجيل الجهاز' });
    }
});

/** إلغاء تسجيل توكن (خروج/مسح بيانات التطبيق). */
router.post('/unregister', async (req, res) => {
    try {
        const ok = await deletePushToken(req.body?.token);
        res.json({ ok });
    } catch (error) {
        logger.error('[push_unregister]', error);
        res.status(500).json({ error: 'PUSH_UNREGISTER_FAILED', message: 'تعذر إلغاء التسجيل' });
    }
});

module.exports = router;
