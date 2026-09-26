// ═══════════════════════════════════════════════════════════════════
// Karim ERP — مسارات الإشعارات (/api/notifications)
// ───────────────────────────────────────────────────────────────────
// Task 20: صندوق إشعارات لكل مستخدم:
//   GET    /                → إشعاراتي (خاصة بي أو عامة قديمة) + عدّاد غير المقروء
//   POST   /                → إشعار ذاتي (تخزين محلي للجرس) — user_id يُفرض على الطالب
//   POST   /read            → تعليم إشعاراتي كمقروءة { ids: [...] }
//   POST   /read-all        → تعليم كل إشعاراتي كمقروءة
//   DELETE /:id             → حذف إشعاري الخاص فقط (القديمة العامة لا تُحذف لغير الجميع)
// ═══════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const { pool } = require('./shared-pool');
const { jwtAuth } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');
const { ensureNotificationsSchema } = require('./notification-service');

const router = express.Router();

function fail(res, status, error, message, extra = {}) {
    return res.status(status).json({ error, message, ...extra });
}

// كل المستخدمين المصادقين لهم صندوق إشعارات
router.use(jwtAuth);

/** نقية: شرط الملكية — إشعاراتي الخاصة أو الإشعارات العامة القديمة (user_id NULL). */
function ownershipScope(userId) {
    return { clause: '(user_id = $1 OR user_id IS NULL)', params: [Number(userId)] };
}

router.get('/', async (req, res) => {
    try {
        await ensureNotificationsSchema();
        const scope = ownershipScope(req.user.id);
        const rows = (await pool.query(
            `SELECT id, title, message, type, date, read, user_id, entity, entity_id, link, created_at
               FROM notifications WHERE ${scope.clause}
              ORDER BY created_at DESC, id DESC LIMIT 50`,
            scope.params
        )).rows;
        const unread = (await pool.query(
            `SELECT COUNT(*)::int AS count FROM notifications WHERE ${scope.clause} AND read = false`,
            scope.params
        )).rows[0].count;
        res.json({ notifications: rows, unread_count: Number(unread) });
    } catch (error) {
        logger.error('[notifications_list]', error);
        res.status(500).json({ error: 'NOTIFICATIONS_LIST_FAILED', message: 'تعذر تحميل الإشعارات' });
    }
});

router.post('/', async (req, res) => {
    try {
        await ensureNotificationsSchema();
        const title = String(req.body?.title || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255);
        const message = String(req.body?.message || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
        if (!title && !message) {return fail(res, 422, 'NOTIFICATION_EMPTY', 'العنوان أو الرسالة مطلوبة');}
        const type = ['info', 'success', 'warning', 'error'].includes(String(req.body?.type)) ? String(req.body.type) : 'info';
        const id = Date.now() + Math.floor(Math.random() * 999999);
        const row = (await pool.query(
            `INSERT INTO notifications (id, title, message, type, date, read, user_id, created_at)
             VALUES ($1,$2,$3,$4,$5,false,$6,CURRENT_TIMESTAMP) RETURNING *`,
            [id, title.slice(0, 255), message, type, new Date().toISOString(), Number(req.user.id)]
        )).rows[0];
        res.status(201).json(row);
    } catch (error) {
        logger.error('[notifications_create_self]', error);
        res.status(500).json({ error: 'NOTIFICATION_CREATE_FAILED', message: 'تعذر حفظ الإشعار' });
    }
});

/** نقية: تقسيم معرفات الإشعارات إلى أعداد صحيحة موجبة فقط. */
function parseNotificationIds(rawIds) {
    const list = Array.isArray(rawIds) ? rawIds : [rawIds];
    const seen = new Set();
    const ids = [];
    for (const raw of list) {
        const id = Number(raw);
        if (Number.isInteger(id) && id > 0 && !seen.has(id)) { seen.add(id); ids.push(id); }
    }
    return ids;
}

router.post('/read', async (req, res) => {
    try {
        await ensureNotificationsSchema();
        const ids = parseNotificationIds(req.body?.ids);
        if (!ids.length) {return fail(res, 422, 'NOTIFICATION_IDS_REQUIRED', 'قائمة معرفات الإشعارات مطلوبة');}
        // $1 = صاحب الصندوق، $2 = المعرفات — ترتيب ثابت لتفادي تعارض المواضع
        const updated = await pool.query(
            `UPDATE notifications SET read = true, read_at = CURRENT_TIMESTAMP
              WHERE (user_id = $1 OR user_id IS NULL) AND id = ANY($2::bigint[]) AND read = false RETURNING id`,
            [Number(req.user.id), ids]
        );
        res.json({ updated: updated.rowCount });
    } catch (error) {
        logger.error('[notifications_read]', error);
        res.status(500).json({ error: 'NOTIFICATIONS_READ_FAILED', message: 'تعذر تعليم الإشعارات كمقروءة' });
    }
});

router.post('/read-all', async (req, res) => {
    try {
        await ensureNotificationsSchema();
        const scope = ownershipScope(req.user.id);
        const updated = await pool.query(
            `UPDATE notifications SET read = true, read_at = CURRENT_TIMESTAMP
              WHERE ${scope.clause} AND read = false`,
            scope.params
        );
        res.json({ updated: updated.rowCount });
    } catch (error) {
        logger.error('[notifications_read_all]', error);
        res.status(500).json({ error: 'NOTIFICATIONS_READ_ALL_FAILED', message: 'تعذر تعليم الإشعارات كمقروءة' });
    }
});

router.delete('/', async (req, res) => {
    try {
        await ensureNotificationsSchema();
        // حذف إشعاراتي الخاصة فقط — الإشعارات العامة القديمة (user_id NULL) تبقى للجميع
        const deleted = await pool.query('DELETE FROM notifications WHERE user_id = $1', [Number(req.user.id)]);
        res.json({ deleted: deleted.rowCount });
    } catch (error) {
        logger.error('[notifications_clear_mine]', error);
        res.status(500).json({ error: 'NOTIFICATIONS_CLEAR_FAILED', message: 'تعذر مسح الإشعارات' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        await ensureNotificationsSchema();
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {return fail(res, 422, 'NOTIFICATION_ID_INVALID', 'معرف الإشعار غير صحيح');}
        // يُحذف إشعاري الخاص فقط — الإشعارات العامة القديمة تبقى للجميع
        const deleted = await pool.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id', [id, Number(req.user.id)]);
        if (!deleted.rowCount) {return fail(res, 404, 'NOTIFICATION_NOT_OWNED', 'الإشعار غير موجود أو غير قابل للحذف');}
        res.json({ deleted: deleted.rowCount });
    } catch (error) {
        logger.error('[notifications_delete]', error);
        res.status(500).json({ error: 'NOTIFICATION_DELETE_FAILED', message: 'تعذر حذف الإشعار' });
    }
});

module.exports = router;
module.exports.parseNotificationIds = parseNotificationIds;
module.exports.ownershipScope = ownershipScope;
