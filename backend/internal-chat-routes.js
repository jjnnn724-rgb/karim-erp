/**
 * internal-chat-routes.js — الشات الداخلي بين الأجهزة (مُستخلص من server.js)
 * رسائل بشرية بين الطاقم: حفظ دائم + بث لحظي + سجل. سياسة العرض في الواجهة.
 */
const { jwtAuth } = require('./cashier-module/jwt-middleware');
const { pool } = require('./shared-pool');
const { logger } = require('./logger');

let _chatSchemaReady = null;
function ensureChatSchema() {
    if (_chatSchemaReady) {return _chatSchemaReady;}
    _chatSchemaReady = pool.query(`
        CREATE TABLE IF NOT EXISTS internal_chat (
            id BIGSERIAL PRIMARY KEY,
            from_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
            from_name VARCHAR(120) NOT NULL DEFAULT '—',
            from_device VARCHAR(160) NOT NULL DEFAULT '',
            body TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_internal_chat_created ON internal_chat (created_at DESC);
        ALTER TABLE internal_chat ADD COLUMN IF NOT EXISTS to_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_internal_chat_pair ON internal_chat (from_user_id, to_user_id, id DESC);
    `).catch((e) => { _chatSchemaReady = null; throw e; });
    return _chatSchemaReady;
}
const _chatThrottle = new Map(); // userId -> last send timestamp (anti-spam)
async function handleChatSend({ userId, toUserId, body }) {
    // eslint-disable-next-line no-control-regex -- تعقيم مقصود: إزالة أحرف التحكم من مدخلات المحادثة
    const text = String(body || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, 1000);
    if (!text) {const e = new Error('EMPTY_MESSAGE'); e.statusCode = 422; throw e;}
    const peer = Number(toUserId);
    if (!Number.isInteger(peer) || peer <= 0) {const e = new Error('PEER_REQUIRED'); e.statusCode = 422; throw e;}
    if (peer === Number(userId)) {const e = new Error('SELF_CHAT'); e.statusCode = 422; throw e;}
    const now = Date.now();
    if (now - (_chatThrottle.get(Number(userId)) || 0) < 2000) {
        const e = new Error('TOO_FAST'); e.statusCode = 429; throw e;
    }
    _chatThrottle.set(Number(userId), now);
    await ensureChatSchema();
    const u = (await pool.query('SELECT id, username, name, role FROM users WHERE id = $1 AND active = true', [Number(userId)])).rows[0];
    if (!u) {const e = new Error('UNKNOWN_USER'); e.statusCode = 401; throw e;}
    const p = (await pool.query('SELECT id FROM users WHERE id = $1 AND active = true', [peer])).rows[0];
    if (!p) {const e = new Error('PEER_NOT_FOUND'); e.statusCode = 404; throw e;}
    const r = (await pool.query(
        `INSERT INTO internal_chat (from_user_id, from_name, from_device, body, to_user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [u.id, u.name || u.username, '', text, peer]
    )).rows[0];
    pool.query(`DELETE FROM internal_chat WHERE created_at < NOW() - INTERVAL '7 days'`).catch(() => {});
    return r;
}

function register(app, opts = {}) {
    const { io, connectedClients } = opts;

    // سجل محادثة خاصة مع موظف (أحدث 50) — ?with=<userId> إجباري (لا عام)
    app.get('/api/chat/history', jwtAuth, async (req, res) => {
        try {
            const peer = Number(req.query.with);
            if (!Number.isInteger(peer) || peer <= 0) {
                return res.status(422).json({ error: 'PEER_REQUIRED', message: 'حدد الموظف (with)' });
            }
            await ensureChatSchema();
            const r = await pool.query(
                `SELECT id, from_user_id, to_user_id, from_name, body, created_at FROM internal_chat
                  WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)
                  ORDER BY id DESC LIMIT 50`,
                [Number(req.user.id), peer]);
            res.json({ ok: true, messages: r.rows.reverse() });
        } catch (e) {
            logger.error('[chat] history failed:', e.message);
            res.status(500).json({ error: 'CHAT_HISTORY_FAILED', message: 'تعذر جلب سجل الشات' });
        }
    });

    // قائمة موظفي الإدارة والمخازن للاختيار + المتصل منهم الآن
    app.get('/api/chat/users', jwtAuth, async (req, res) => {
        try {
            const r = await pool.query(
                `SELECT id, username, name, role FROM users WHERE active = true AND role IN ('admin','manager','hr','warehouse') AND id <> $1 ORDER BY name LIMIT 200`,
                [Number(req.user.id)]);
            const online = new Set();
            for (const c of connectedClients.values()) { if (c.userId) {online.add(Number(c.userId));} }
            res.json({ ok: true, users: r.rows.map((u) => ({ ...u, online: online.has(Number(u.id)) })) });
        } catch (e) {
            logger.error('[chat] users failed:', e.message);
            res.status(500).json({ error: 'CHAT_USERS_FAILED', message: 'تعذر جلب الموظفين' });
        }
    });

    // إرسال رسالة خاصة — حفظ + توصيل للطرفين فقط عبر غرف user:<id>
    app.post('/api/chat/send', jwtAuth, async (req, res) => {
        try {
            const row = await handleChatSend({ userId: req.user.id, toUserId: req.body?.to_user_id, body: req.body?.body });
            try {
                io.to(`user:${row.from_user_id}`).emit('chat:new', row);
                io.to(`user:${row.to_user_id}`).emit('chat:new', row);
            } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
            res.status(201).json({ ok: true, message: row });
        } catch (e) {
            const map = { EMPTY_MESSAGE: [422, 'الرسالة فارغة'], PEER_REQUIRED: [422, 'حدد الموظف'], SELF_CHAT: [422, 'لا تراسل نفسك'], PEER_NOT_FOUND: [404, 'الموظف غير موجود'], TOO_FAST: [429, 'تمهل ثانيتين بين الرسائل'] };
            const pair = map[e.message] || [e.statusCode || 500, 'تعذر إرسال الرسالة'];
            res.status(pair[0]).json({ error: e.message, message: pair[1] });
        }
    });
}

module.exports = { register };
