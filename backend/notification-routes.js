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

// M21 (2026-10-11): effective-read predicate.
// Personal notifications: read column on the row.
// Public (user_id NULL): a row in notification_reads for this user.
function effectiveReadSql(_userId) {
    return `(n.read = true OR (n.user_id IS NULL AND EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id AND nr.user_id = $1)))`;
}

router.get('/', async (req, res) => {
    try {
        await ensureNotificationsSchema();
        const uid = Number(req.user.id);
        // PERF-6: list + unread count are independent → run in parallel
        const [listRes, unreadRes] = await Promise.all([
            pool.query(
                `SELECT n.id, n.title, n.message, n.type, n.date, n.user_id, n.entity, n.entity_id, n.link, n.created_at,
                        (n.read = true OR (n.user_id IS NULL AND EXISTS (
                            SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id AND nr.user_id = $1
                        ))) AS read
                   FROM notifications n
                  WHERE (n.user_id = $1 OR n.user_id IS NULL)
                  ORDER BY n.created_at DESC, n.id DESC LIMIT 50`,
                [uid]
            ),
            pool.query(
                `SELECT COUNT(*)::int AS count FROM notifications n
                  WHERE (n.user_id = $1 OR n.user_id IS NULL)
                    AND NOT ${effectiveReadSql(uid)}`,
                [uid]
            ),
        ]);
        res.json({ notifications: listRes.rows, unread_count: Number(unreadRes.rows[0].count) });
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
        const uid = Number(req.user.id);
        // M21: personal → UPDATE read column; public → INSERT into notification_reads
        const personal = await pool.query(
            `UPDATE notifications SET read = true, read_at = CURRENT_TIMESTAMP
              WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read = false RETURNING id`,
            [uid, ids]
        );
        const pub = await pool.query(
            `INSERT INTO notification_reads (notification_id, user_id)
             SELECT id, $1 FROM notifications
              WHERE user_id IS NULL AND id = ANY($2::bigint[])
             ON CONFLICT (notification_id, user_id) DO NOTHING
             RETURNING notification_id`,
            [uid, ids]
        );
        res.json({ updated: personal.rowCount + pub.rowCount });
    } catch (error) {
        logger.error('[notifications_read]', error);
        res.status(500).json({ error: 'NOTIFICATIONS_READ_FAILED', message: 'تعذر تعليم الإشعارات كمقروءة' });
    }
});

router.post('/read-all', async (req, res) => {
    try {
        await ensureNotificationsSchema();
        const uid = Number(req.user.id);
        // M21: personal → UPDATE read column; public → INSERT into notification_reads
        const personal = await pool.query(
            `UPDATE notifications SET read = true, read_at = CURRENT_TIMESTAMP
              WHERE user_id = $1 AND read = false`,
            [uid]
        );
        const pub = await pool.query(
            `INSERT INTO notification_reads (notification_id, user_id)
             SELECT id, $1 FROM notifications
              WHERE user_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = notifications.id AND nr.user_id = $1)
             ON CONFLICT (notification_id, user_id) DO NOTHING`,
            [uid]
        );
        res.json({ updated: personal.rowCount + pub.rowCount });
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
