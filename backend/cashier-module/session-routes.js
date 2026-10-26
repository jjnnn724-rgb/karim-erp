/**
 * session-routes.js — الأجهزة والجلسات (البند ١٠: تقوية الجلسات)
 * ════════════════════════════════════════════════════════════════════════════
 * عرض جلسات المستخدم النشطة وإبطال جهاز بعينه. الهوية `session_id` تُنشأ
 * عند الدخول وتبقى نفسها عبر كل تدوير، فلا يظهر الجهاز الواحد إلا مرة واحدة
 * مهما جدّد رمزه.
 *
 * WHAT IS NEVER RETURNED
 *   لا token_hash ولا رمز خام ولا سر. الشاشة تعرض وصفًا مقروءًا للمتصفح
 *   والنظام، وآخر ظهور، ومن بدأ الجلسة — لا أكثر.
 *
 * SELF-SERVICE ONLY
 *   كل مسار هنا يعمل على `req.user.id` وحده. لا يمسح مستخدمٌ جلسات غيره؛
 *   إبطال حساب آخر يبقى في مسار MFA admin-reset ومسارات المستخدمين.
 */
const { jwtAuth } = require('./jwt-middleware');
const { pool } = require('./db-pool');
const { logger } = require('../logger');
const { writeAuditLog } = require('./audit-middleware');
const { generalLimiter } = require('../rate-limiter');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** وصفٌ بشريّ لجهاز من UA — ثابت وقابل للاختبار، بلا مكتبة تحليل. */
function describeDevice(deviceInfo) {
    const ua = String((deviceInfo && deviceInfo.ua) || '');
    if (!ua) {return 'جهاز غير معروف';}
    let browser = 'متصفح';
    if (/Edg\//.test(ua)) {browser = 'Edge';}
    else if (/OPR\/|Opera/.test(ua)) {browser = 'Opera';}
    else if (/Firefox\//.test(ua)) {browser = 'Firefox';}
    else if (/Chrome\//.test(ua)) {browser = 'Chrome';}
    else if (/Safari\//.test(ua) && /Version\//.test(ua)) {browser = 'Safari';}
    let os = '';
    if (/Android/.test(ua)) {os = 'Android';}
    else if (/iPhone|iPad|iPod/.test(ua)) {os = 'iOS';}
    else if (/Windows/.test(ua)) {os = 'Windows';}
    else if (/Mac OS X/.test(ua)) {os = 'macOS';}
    else if (/Linux/.test(ua)) {os = 'Linux';}
    return os ? `${browser} على ${os}` : browser;
}

function sessionView(row, currentSid) {
    return {
        id: row.session_id,
        current: String(row.session_id) === String(currentSid || ''),
        device: describeDevice(row.device_info),
        ip: row.ip_address || null,
        started_at: row.issued_at ? new Date(row.issued_at).toISOString() : null,
        last_seen_at: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
        expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    };
}

async function listHandler(req, res) {
    try {
        const r = await pool.query(
            `SELECT DISTINCT ON (session_id)
                    session_id, issued_at, last_seen_at, ip_address::text AS ip_address,
                    device_info, expires_at
               FROM pos_refresh_tokens
              WHERE user_id = $1
                AND session_id IS NOT NULL
                AND revoked_at IS NULL
                AND expires_at > CURRENT_TIMESTAMP
              ORDER BY session_id, last_seen_at DESC NULLS LAST;`,
            [req.user.id]
        );
        const sessions = r.rows
            .map((row) => sessionView(row, req.user.sid))
            .sort((a, b) => String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || '')));
        res.set('Cache-Control', 'no-store');
        return res.json({ ok: true, current_session_id: req.user.sid || null, sessions });
    } catch (err) {
        logger.error('[sessions] list failed:', err.message);
        return res.status(500).json({ error: 'SESSIONS_UNAVAILABLE', message: 'تعذر جلب الجلسات — حاول مجددًا.' });
    }
}

async function revokeOneHandler(req, res) {
    const sessionId = String(req.params.id || '').trim();
    if (!UUID_RE.test(sessionId)) {
        return res.status(422).json({ error: 'SESSION_ID_INVALID', message: 'معرف الجلسة غير صالح.' });
    }
    try {
        const r = await pool.query(
            `UPDATE pos_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP
              WHERE user_id = $1 AND session_id = $2 AND revoked_at IS NULL;`,
            [req.user.id, sessionId]
        );
        if (!r.rowCount) {
            return res.status(404).json({ error: 'SESSION_NOT_FOUND', message: 'الجلسة غير موجودة أو أُبطلت بالفعل.' });
        }
        const isCurrent = String(sessionId) === String(req.user.sid || '');
        await writeAuditLog({
            action: 'SESSION_REVOKED',
            tableName: 'pos_refresh_tokens',
            rowPk: sessionId,
            reason: isCurrent ? 'إبطال الجلسة الحالية من شاشة الجلسات' : 'إبطال جهاز من شاشة الجلسات',
            metadata: { current: isCurrent },
            actor: { userId: req.user.id, userName: req.user.username || req.user.name, role: req.user.role, ip: req.ip, requestId: req.id },
        }).catch((e) => logger.error('[sessions] audit log failed:', e.message));
        logger.info({ userId: req.user.id, sessionId, current: isCurrent }, '[sessions] session revoked');
        return res.json({ ok: true, revoked: r.rowCount, current: isCurrent, message: isCurrent ? 'أُبطلت هذه الجلسة — سجّل الدخول من جديد.' : 'أُبطل الجهاز المحدد.' });
    } catch (err) {
        logger.error('[sessions] revoke failed:', err.message);
        return res.status(500).json({ error: 'SESSION_REVOKE_FAILED', message: 'تعذر إبطال الجلسة — حاول مجددًا.' });
    }
}

async function revokeOthersHandler(req, res) {
    try {
        const sid = req.user.sid || null;
        const r = sid
            ? await pool.query(
                `UPDATE pos_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP
                  WHERE user_id = $1 AND revoked_at IS NULL AND (session_id IS NULL OR session_id <> $2);`,
                [req.user.id, sid]
            )
            : await pool.query(
                `UPDATE pos_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP
                  WHERE user_id = $1 AND revoked_at IS NULL;`,
                [req.user.id]
            );
        await writeAuditLog({
            action: 'SESSION_REVOKED_OTHERS',
            tableName: 'pos_refresh_tokens',
            reason: 'إبطال كل الأجهزة الأخرى من شاشة الجلسات',
            metadata: { revoked: r.rowCount, kept: sid },
            actor: { userId: req.user.id, userName: req.user.username || req.user.name, role: req.user.role, ip: req.ip, requestId: req.id },
        }).catch((e) => logger.error('[sessions] audit log failed:', e.message));
        logger.info({ userId: req.user.id, revoked: r.rowCount }, '[sessions] other sessions revoked');
        return res.json({ ok: true, revoked: r.rowCount, message: r.rowCount ? `أُبطلت ${r.rowCount} جلسة أخرى.` : 'لا توجد جلسات أخرى نشطة.' });
    } catch (err) {
        logger.error('[sessions] revoke-others failed:', err.message);
        return res.status(500).json({ error: 'SESSION_REVOKE_FAILED', message: 'تعذر إبطال الجلسات — حاول مجددًا.' });
    }
}

function register(app) {
    app.get('/api/auth/sessions', generalLimiter, jwtAuth, listHandler);
    app.delete('/api/auth/sessions/:id', jwtAuth, revokeOneHandler);
    app.post('/api/auth/sessions/revoke-others', jwtAuth, revokeOthersHandler);
    return app;
}

module.exports = { register, listHandler, revokeOneHandler, revokeOthersHandler, describeDevice };
