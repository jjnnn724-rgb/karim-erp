// ═══════════════════════════════════════════════════════════════════
// Karim ERP — الإشعارات الفورية الموجّهة (Targeted Real-time Notifications)
// ───────────────────────────────────────────────────────────────────
// Task 20: كل إجراء في سلسلة اعتماد طلبات الصرف يُشعِر الأطراف المعنية
// لحظيًا عبر Socket.IO (غرف role:/dept:/user:) + صف دائم في قاعدة
// البيانات يظهر في جرس الإشعارات حتى بعد إغلاق الجهاز.
//   • رئيس قسم يقدّم طلبًا → الشيف العمومي (بانتظار اعتمادك)
//   • الشيف يعتمد/يرفض → رئيس القسم + المخازن
//   • المخازن تصرف → رئيس القسم + الشيف
//   • الاستلام/الإرجاع → المخازن والشيف
// الإشعار لا يُفشل العملية الرئيسية أبدًا (best-effort بعد نجاح العملية).
// ═══════════════════════════════════════════════════════════════════
'use strict';

const { pool } = require('./shared-pool');
const { logger } = require('./logger');

let schemaReady = null;

/** مخطط ذاتي الترقية (idempotent): يستخدم جدول notifications القديم ويضيف الاستهداف والمرجع. */
function ensureNotificationsSchema() {
    if (schemaReady) {return schemaReady;}
    schemaReady = (async () => {
        await pool.query(`
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity VARCHAR(60);
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_id VARCHAR(60);
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link VARCHAR(255);
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
            CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, read) WHERE read = false;
            CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
            -- M21 (2026-10-11): per-user read tracking for PUBLIC notifications.
            -- Public rows (user_id NULL) previously shared one global read flag:
            -- user A marking one read hid it from user B. This table records
            -- which user read which public notification; personal notifications
            -- keep using the read column on the row itself.
            CREATE TABLE IF NOT EXISTS notification_reads (
                notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
                user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                read_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (notification_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads (user_id);
        `);
    })().catch(error => { schemaReady = null; throw error; });
    return schemaReady;
}

/**
 * نقية: يحدد مستخدمي الهدف من قائمة مستخدمين محمّلة.
 * - targetRoles: أدوار (kitchen/warehouse/...) — targetDeptCodes: أقسام —
 *   targetUserIds: مستخدمون بالهوية — targetUsernames: مطابقة اسم/اسم الدخول (لمقدمي الطلبات القدامى).
 * - يُستثنى الفاعل نفسه دائمًا حتى لا يُشعِر نفسه، والمكررون يُدمجون، وغير النشطين يُستبعدون.
 */
function resolveNotificationTargets(users, { targetRoles = [], targetDeptCodes = [], targetUserIds = [], targetUsernames = [], actorUserId = null } = {}) {
    const roles = new Set((Array.isArray(targetRoles) ? targetRoles : [targetRoles]).filter(Boolean).map(r => String(r).trim().toLowerCase()));
    const depts = new Set((Array.isArray(targetDeptCodes) ? targetDeptCodes : [targetDeptCodes]).filter(Boolean).map(d => String(d).trim().toLowerCase()));
    const ids = new Set((Array.isArray(targetUserIds) ? targetUserIds : [targetUserIds]).filter(v => v !== null && v !== undefined && v !== '').map(v => Number(v)).filter(v => Number.isInteger(v) && v > 0));
    const names = new Set((Array.isArray(targetUsernames) ? targetUsernames : [targetUsernames]).filter(Boolean).map(v => String(v).trim().toLowerCase()));
    if (!roles.size && !depts.size && !ids.size && !names.size) {return [];}
    const actor = actorUserId === null || actorUserId === undefined ? null : Number(actorUserId);
    const seen = new Set();
    const targets = [];
    for (const user of Array.isArray(users) ? users : []) {
        const userId = Number(user?.id);
        if (!Number.isInteger(userId) || userId <= 0) {continue;}
        if (user?.active === false) {continue;}
        if (actor !== null && userId === actor) {continue;}
        const role = String(user?.role || '').trim().toLowerCase();
        const dept = String(user?.dept_code || '').trim().toLowerCase();
        const uname = String(user?.username || '').trim().toLowerCase();
        const fullname = String(user?.name || '').trim().toLowerCase();
        const hit = (roles.size && roles.has(role))
            || (depts.size && dept && depts.has(dept))
            || (ids.size && ids.has(userId))
            || (names.size && names.size > 0 && ((uname && names.has(uname)) || (fullname && names.has(fullname))));
        if (!hit) {continue;}
        if (seen.has(userId)) {continue;}
        seen.add(userId);
        targets.push({ id: userId, role, dept_code: user?.dept_code || null, name: user?.name || user?.username || `#${userId}` });
    }
    return targets;
}

function cleanNotificationText(value, max) {
    let text = value == null ? '' : String(value);
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {text = parsed.message || parsed.title || parsed.error || parsed.detail || text;}
    } catch (_) {}
    text = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

/** نقية: صف إشعار جاهز للإدخال — يعيد null إذا غاب العنوان والرسالة معًا. */
function buildNotificationRow({ id, type, title, message, entity, entityId, link, userId }) {
    const cleanTitle = cleanNotificationText(title, 255);
    const cleanMessage = cleanNotificationText(message, 500);
    if (!cleanTitle && !cleanMessage) {return null;}
    const createdAt = new Date().toISOString();
    return {
        id,
        user_id: userId === null || userId === undefined ? null : Number(userId),
        title: cleanTitle.slice(0, 255),
        message: cleanMessage,
        type: ['info', 'success', 'warning', 'error'].includes(String(type)) ? String(type) : 'info',
        date: createdAt,
        entity: entity ? String(entity).slice(0, 60) : null,
        entity_id: entityId === null || entityId === undefined || entityId === '' ? null : String(entityId).slice(0, 60),
        link: link ? String(link).slice(0, 255) : null,
        read: false,
        created_at: createdAt,
    };
}

/**
 * ينشئ صفوف إشعارات لكل مستخدمي الهدف (باستخدام client معطى — يدعم المعاملة).
 * يعيد { rows, targets }. لا يرمي أخطاء المستخدمين الغائبين — يعيد قائمة فارغة.
 */
async function createNotifications(client, opts) {
    const { type, title, message, entity = null, entityId = null, link = null, targetRoles = [], targetDeptCodes = [], targetUserIds = [], targetUsernames = [], actorUserId = null } = opts || {};
    const usersResult = await client.query('SELECT id, username, name, role, dept_code, active FROM users WHERE active = true');
    const targets = resolveNotificationTargets(usersResult.rows, { targetRoles, targetDeptCodes, targetUserIds, targetUsernames, actorUserId });
    if (!targets.length) {return { rows: [], targets };}
    const db = client || pool;
    const rows = [];
    for (const target of targets) {
        const row = buildNotificationRow({
            // FIX 2026-10-11 (C17): wider random range — Date.now() + small rand
            // collided under burst notifications. Use crypto for uniqueness.
            id: require('crypto').randomInt(1, Number.MAX_SAFE_INTEGER),
            type, title, message, entity, entityId, link,
            userId: target.id,
        });
        if (!row) {return { rows: [], targets };}
        // FIX 2026-10-11 (M14): SAVEPOINT per INSERT — a failed notification
        // INSERT was poisoning the caller's entire transaction (Postgres
        // aborts the whole txn after any error). SAVEPOINT isolates the
        // failure so the main business operation is never rolled back.
        await db.query('SAVEPOINT notify_row').catch(() => {});
        try {
            await db.query(
                `INSERT INTO notifications (id, title, message, type, date, read, user_id, entity, entity_id, link, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                [row.id, row.title, row.message, row.type, row.date, row.read, row.user_id, row.entity, row.entity_id, row.link, row.created_at]
            );
            rows.push(row);
        } catch (insertErr) {
            await db.query('ROLLBACK TO SAVEPOINT notify_row').catch(() => {});
            logger.warn('[notifications] INSERT failed for user', target.id, ':', insertErr.message);
        } finally {
            await db.query('RELEASE SAVEPOINT notify_row').catch(() => {});
        }
    }
    return { rows, targets };
}

/** يبث الإشعارات لحظيًا لغرف المستخدمين عبر Socket.IO (بعد نجاح العملية). */
function emitNotificationRows(io, rows) {
    if (!io || !Array.isArray(rows)) {return 0;}
    let sent = 0;
    for (const row of rows) {
        if (row?.user_id) {
            io.to(`user:${row.user_id}`).emit('notification', {
                id: row.id, title: row.title, message: row.message, type: row.type,
                entity: row.entity, entity_id: row.entity_id, link: row.link,
                date: row.created_at, read: false,
            });
            sent += 1;
        }
    }
    return sent;
}

/** أداة مركبة: تنشئ الصفوف وتبثها — best-effort، لا تُفشل العملية الرئيسية أبدًا. */
async function notifyBestEffort(client, opts) {
    try {
        const { rows } = await createNotifications(client, opts);
        emitNotificationRows(opts?.io, rows);
        return rows.length;
    } catch (error) {
        logger.warn('[notifications] best-effort notify failed:', error.message);
        return 0;
    }
}

module.exports = {
    ensureNotificationsSchema,
    resolveNotificationTargets,
    buildNotificationRow,
    createNotifications,
    emitNotificationRows,
    notifyBestEffort,
};
