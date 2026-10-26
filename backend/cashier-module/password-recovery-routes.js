/**
 * password-recovery-routes.js — استعادة كلمة المرور الذاتية للموظف
 * ────────────────────────────────────────────────────────────────────────────
 * المسارات:
 *   POST /api/auth/forgot-password/request-code  (admin/manager) — إصدار رمز
 *         استعادة لمرة واحدة (6 أرقام) لموظف نسي كلمة مروره. الرمز يعود في
 *         الرد مرة واحدة ليقرأه المدير على الموظف (بيئة مطعم بلا بريد/SMS —
 *         القناة الواقعية هي المدير الحاضر)، ويُخزَّن مجزأً SHA-256 فقط.
 *   POST /api/auth/forgot-password/reset  (عام، خلف authLimiter) — الموظف
 *         يدخل اسمه + الرمز + كلمة مرور جديدة بنفسه من شاشة الدخول.
 *
 * الأمان:
 *   - إصدار رمز جديد يحذف الرموز غير المستخدمة السابقة للمستخدم.
 *   - 5 محاولات خاطئة تقفل الرمز (429) حتى لو صحّ الرمز لاحقًا.
 *   - رسائل الفشل في /reset موحّدة (لا كشف لوجود الحساب أو صحة الرمز).
 *   - نجاح الاستعادة = bcrypt(12) + must_change_password=FALSE + سحب كل
 *     رموز التجديد (إبطال كل الجلسات القائمة على كل الأجهزة) + سجل تدقيق.
 *   - الرمز يستخدم مرة واحدة (used_at) وإعادة استخدامه تُرفض.
 */

const express = require('express');
const bcrypt = require('../pw-crypto');
const { pool } = require('./db-pool');
const { jwtAuth, requireRole } = require('./jwt-middleware');
const { writeAuditLog } = require('./audit-middleware');
const { authLimiter } = require('../rate-limiter');
const { logger } = require('../logger');
const { encryptForVault } = require('../password-vault');
const {
    RESET_CODE_TTL_MS,
    MAX_VERIFY_ATTEMPTS,
    generateResetCode,
    hashCode,
    requestCodeSchema,
    resetRequestSchema,
    evaluateCodeRow,
} = require('./password-recovery-logic');

const router = express.Router();

const GENERIC_RESET_ERROR = {
    error: 'RESET_FAILED',
    message: 'الرمز غير صحيح أو منتهي الصلاحية — اطلب رمزًا جديدًا من المدير.',
};

// ─── إصدار رمز استعادة (admin/manager فقط) ─────────────────────────────────
async function requestCodeHandler(req, res) {
    const parsed = requestCodeSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(422).json({
            error: 'VALIDATION',
            message: parsed.error.issues[0]?.message || 'بيانات غير صالحة',
        });
    }
    const { username } = parsed.data;

    const client = await pool.connect();
    try {
        const u = (await client.query(
            `SELECT id, username, name, active FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1;`,
            [username]
        )).rows[0];
        if (!u || !u.active) {
            return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'لا يوجد حساب نشط بهذا الاسم.' });
        }

        // إصدار جديد يبطل كل الرموز السابقة غير المستخدمة لنفس المستخدم
        await client.query(
            `DELETE FROM pos_password_reset_codes WHERE user_id = $1 AND used_at IS NULL;`,
            [u.id]
        );
        const code = generateResetCode();
        await client.query(
            `INSERT INTO pos_password_reset_codes (user_id, code_hash, expires_at, created_by)
             VALUES ($1, $2, $3, $4);`,
            [u.id, hashCode(code), new Date(Date.now() + RESET_CODE_TTL_MS), req.user.id]
        );

        await writeAuditLog({
            action: 'PASSWORD_RESET_CODE_ISSUED',
            tableName: 'users',
            rowPk: String(u.id),
            reason: 'إصدار رمز استعادة لمرة واحدة لموظف نسي كلمة المرور',
            metadata: { target_username: u.username, ttl_seconds: RESET_CODE_TTL_MS / 1000 },
            actor: { userId: req.user.id, userName: req.user.name, role: req.user.role, ip: req.ip, requestId: req.id },
        }).catch((e) => logger.error('[pw-recovery] audit log failed:', e.message));

        logger.info({ userId: u.id, username: u.username, by: req.user.id },
            '[pw-recovery] reset code issued (valid 10 min, single use)');
        return res.json({
            ok: true,
            username: u.username,
            user_name: u.name,
            code,
            expires_in_seconds: RESET_CODE_TTL_MS / 1000,
            message: 'الرمز للاستخدام مرة واحدة وصلاحيته 10 دقائق — شاركه مع الموظف فقط.',
        });
    } catch (err) {
        logger.error('[pw-recovery] request-code failed:', err.message, { stack: err.stack });
        console.error('[DEBUG] Full error:', err);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر إصدار رمز الاستعادة — حاول مرة أخرى.' });
    } finally {
        client.release();
    }
}

router.post('/request-code', authLimiter, jwtAuth, requireRole('admin', 'manager'), (req, res) => requestCodeHandler(req, res));

// ─── الاستعادة الذاتية (عام — الموظف من شاشة الدخول) ────────────────────────
async function resetHandler(req, res) {
    const parsed = resetRequestSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(422).json({
            error: 'VALIDATION',
            message: parsed.error.issues[0]?.message || 'بيانات غير صالحة',
        });
    }
    const { username, code, new_password } = parsed.data;

    const client = await pool.connect();
    try {
        const u = (await client.query(
            `SELECT id, username, active FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1;`,
            [username]
        )).rows[0];
        // توحيد الرد لغير الموجود وغير النشط — لا كشف لوجود الحساب
        if (!u || !u.active) {return res.status(401).json(GENERIC_RESET_ERROR);}

        const row = (await client.query(
            `SELECT * FROM pos_password_reset_codes WHERE user_id = $1 ORDER BY id DESC LIMIT 1;`,
            [u.id]
        )).rows[0];

        const verdict = evaluateCodeRow(row, code);
        if (!verdict.ok) {
            if (verdict.reason === 'CODE_LOCKED') {
                return res.status(429).json({ error: 'CODE_LOCKED', message: 'تم قفل الرمز بعد محاولات فاشلة متكررة — اطلب رمزًا جديدًا من المدير.' });
            }
            if (verdict.reason === 'CODE_MISMATCH') {
                const attempts = Number(row.attempts || 0) + 1;
                await client.query(
                    `UPDATE pos_password_reset_codes SET attempts = attempts + 1 WHERE id = $1;`,
                    [row.id]
                );
                if (attempts >= MAX_VERIFY_ATTEMPTS) {
                    logger.warn({ userId: u.id }, '[pw-recovery] code locked after repeated failed attempts');
                    return res.status(429).json({ error: 'CODE_LOCKED', message: 'تم قفل الرمز بعد محاولات فاشلة متكررة — اطلب رمزًا جديدًا من المدير.' });
                }
            }
            return res.status(401).json(GENERIC_RESET_ERROR);
        }

        // نجاح التحقق: كلمة مرور جديدة + استهلاك الرمز + سحب كل الجلسات
        const hash = await bcrypt.hash(new_password, 12);
        await client.query('BEGIN');
        try {
            await client.query(
                `UPDATE users SET password = $1, must_change_password = FALSE, password_migrated_at = CURRENT_TIMESTAMP WHERE id = $2;`,
                [hash, u.id]
            );
            // خزنة كلمات المرور: حدّث النسخة القابلة للاسترجاع
            const _vault = encryptForVault(new_password);
            if (_vault) { await client.query(`UPDATE users SET password_vault = $1 WHERE id = $2;`, [_vault, u.id]); }
            await client.query(
                `UPDATE pos_password_reset_codes SET used_at = CURRENT_TIMESTAMP WHERE id = $1;`,
                [row.id]
            );
            await client.query(`DELETE FROM pos_refresh_tokens WHERE user_id = $1;`, [u.id]);
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txErr;
        }

        await writeAuditLog({
            action: 'PASSWORD_SELF_RESET',
            tableName: 'users',
            rowPk: String(u.id),
            reason: 'استعادة ذاتية لكلمة المرور برمز لمرة واحدة',
            metadata: { target_username: u.username, code_id: row.id },
            actor: { userId: null, userName: u.username, role: 'self', ip: req.ip, requestId: req.id },
        }).catch((e) => logger.error('[pw-recovery] audit log failed:', e.message));

        logger.info({ userId: u.id, username: u.username }, '[pw-recovery] password self-reset completed');
        return res.json({
            ok: true,
            message: 'تم تغيير كلمة المرور بنجاح — سجّل الدخول بكلمة المرور الجديدة.',
        });
    } catch (err) {
        logger.error('[pw-recovery] reset failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر استعادة كلمة المرور — حاول مرة أخرى.' });
    } finally {
        client.release();
    }
}

router.post('/reset', authLimiter, (req, res) => resetHandler(req, res));

// المعالجات مُصدَّرة للاختبارات المباشرة (نمط security-rbac-hardening.test.js)
// — بوابات jwtAuth/requireRole/authLimiter تُختبر بصيغتها الوسيطة على حدة.
module.exports = { router, requestCodeHandler, resetHandler };
