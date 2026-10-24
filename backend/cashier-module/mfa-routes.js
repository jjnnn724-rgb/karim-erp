'use strict';

/**
 * mfa-routes.js — المصادقة الثنائية (TOTP) لحسابات الإدارة
 * ────────────────────────────────────────────────────────────────────────────
 * تدفّق الدخول يصير مرحلتين:
 *   1. كلمة المرور  → loginHandler يصدر تذكرة `mfa` (5 دقائق) أو `mfa_enroll`
 *      (15 دقيقة) بدل الجلسة.
 *   2. factor الثاني → هذه المسارات تصدر الجلسة الكاملة (access + refresh).
 *
 * التذكرة ليست جلسة: jwtAuth يرفض أي توكن غرضه ليس `access`، فهي لا تفتح
 * أي API آخر. ونفس البوابة تُطبَّق بعد تدوير كلمة المرور الأولية.
 *
 * المسارات:
 *   GET  /api/auth/mfa/status          جلسة   — حالة التسجيل للمستخدم الحالي
 *   POST /api/auth/mfa/setup           تذكرة/جلسة — سر جديد + QR (إعادة التسجيل تتطلب رمزًا حاليًا)
 *   POST /api/auth/mfa/confirm         تذكرة/جلسة — تأكيد السر وإصدار رموز الاسترداد (+ جلسة للتذكرة)
 *   POST /api/auth/mfa/verify          تذكرة — تحقق TOTP أو رمز استرداد ← جلسة
 *   POST /api/auth/mfa/disable         جلسة — تعطيل (يمنع للدور الملزم بكلمة مروره)
 *   POST /api/auth/mfa/recovery-codes  جلسة — إصدار رموز استرداد جديدة (يبطل القديمة)
 *   POST /api/auth/mfa/admin-reset     مالك/مدير — مسح تسجيل مستخدم فقد جهازه (مسجَّل تدقيقيًا)
 *
 * كل مسار يلمس رمزًا أو كلمة مرور محكوم بمحدد معدل لكل مستخدم (10/15د)، لا
 * بمفتاح IP المدفوع لأن كل أجهزة المطعم خلف راوتر واحد.
 */

const QRCode = require('qrcode');
const bcrypt = require('../pw-crypto');
const { pool } = require('./db-pool');
const { logger } = require('../logger');
const totp = require('../totp');
const mfaStore = require('./mfa-store');
const {
    jwtAuth, requireRole, publicUserOf,
    signAccessToken, issueRefreshToken, verifyAccessToken, verifyMfaTicket,
} = require('./jwt-middleware');
const { writeAuditLog } = require('./audit-middleware');
const { createRateLimiter, generalLimiter } = require('../rate-limiter');

const MFA_ISSUER = process.env.MFA_ISSUER || 'Karim ERP';
const RECOVERY_CODE_COUNT = 8;
const ENROLL_TICKET_MINUTES = 15;

// محاولات محدودة لكل مستخدم/15 دقيقة — رمز من 6 أرقام لا يُخمَّن بهذا الحجم.
const mfaLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 10,
    message: 'محاولات مصادقة كثيرة — انتظر قليلًا ثم أعد المحاولة.',
    keyGenerator: (req) => `mfa:${req.user?.id || 'anonymous'}`,
    skipFailedRequests: false,
});

const INVALID_CODE = { error: 'INVALID_MFA_CODE', message: 'رمز المصادقة غير صحيح — تحقق من التطبيق أو استخدم رمز استرداد.' };
const CODE_REUSED = { error: 'MFA_CODE_REUSED', message: 'هذا الرمز مستعمل بالفعل — انتظر ظهور الرمز التالي.' };
const ACCOUNT_DISABLED = { error: 'ACCOUNT_DISABLED', message: 'تم إيقاف هذا الحساب — تواصل مع المسؤول.' };

async function loadLiveUser(userId) {
    const r = await pool.query(
        `SELECT id, username, name, role, active, must_change_password, dept_code, branch_id
           FROM users WHERE id = $1 LIMIT 1;`,
        [userId]
    );
    return r.rows[0] || null;
}

/** جلسة كاملة بعد اجتياز العامل الثاني. */
async function sendSession(req, res, row, extra = {}) {
    const user = { ...row };
    const access = signAccessToken(user);
    const refresh = await issueRefreshToken(user, {
        deviceInfo: { ua: req.headers['user-agent'], mfa: true },
        ip: req.ip,
    });
    await pool.query(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1;`, [user.id])
        .catch(() => {/* legacy schema */});
    const state = await mfaStore.loadState(user.id).catch(() => null);
    logger.info({ userId: user.id, username: user.username, role: user.role }, '[auth] MFA verified — session issued');
    return res.json({
        access_token: access,
        refresh_token: refresh,
        token_type: 'Bearer',
        expires_in: 86400,
        app_key: process.env.API_KEY || null,
        mfa_enabled: Boolean(state && state.confirmedAt),
        user: publicUserOf(user),
        ...extra,
    });
}

/**
 * يقبل جلسة عادية أو تذكرة MFA بغرض محدّد. الجلسة تمر عبر jwtAuth كاملةً
 * (فحص الحساب النشط وقفل التدوير)؛ التذكرة تُحقن كـ req.user + req.mfaTicket
 * ويُعاد فحص الحساب النشط عند إصدار الجلسة.
 */
function ticketOrSession(allowedPurposes) {
    return (req, res, next) => {
        const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
        if (!match) {return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing Bearer token.' });}
        const token = match[1];
        let sessionPayload = null;
        try { sessionPayload = verifyAccessToken(token); } catch { /* ليست جلسة — قد تكون تذكرة */ }
        if (sessionPayload && (!sessionPayload.purpose || sessionPayload.purpose === 'access')) {
            return jwtAuth(req, res, next);
        }
        let ticket;
        try {
            ticket = verifyMfaTicket(token, allowedPurposes);
        } catch (err) {
            const expired = err.name === 'TokenExpiredError';
            return res.status(401).json({
                error: expired ? 'MFA_TICKET_EXPIRED' : 'TOKEN_INVALID',
                message: expired
                    ? 'انتهت مهلة خطوة المصادقة — أعد إدخال كلمة المرور.'
                    : 'تذكرة المصادقة غير صالحة — أعد تسجيل الدخول.',
            });
        }
        req.user = {
            id: parseInt(ticket.sub, 10),
            role: ticket.role,
            name: ticket.name,
            dept_code: ticket.dept_code || null,
            branch_id: ticket.branch_id ?? null,
            must_change_password: false,
        };
        req.mfaTicket = ticket;
        return next();
    };
}

async function statusHandler(req, res) {
    try {
        const state = await mfaStore.loadState(req.user.id);
        res.set('Cache-Control', 'no-store');
        return res.json({
            ok: true,
            enabled: Boolean(state && state.confirmedAt),
            pending: Boolean(state && state.pendingSecret),
            required: mfaStore.mfaRequiredFor(req.user.role),
            recovery_codes_left: state ? state.recoveryHashes.length : 0,
            enrolled_at: state ? state.confirmedAt : null,
        });
    } catch (err) {
        logger.error('[mfa] status failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر قراءة حالة المصادقة الثنائية.' });
    }
}

async function setupHandler(req, res) {
    try {
        const user = await loadLiveUser(req.user.id);
        if (!user || !user.active) {return res.status(401).json(ACCOUNT_DISABLED);}

        const state = await mfaStore.loadState(user.id);
        // إعادة التسجيل إجراء حسّاس: رمز التطبيق الحالي شرط، حتى لا يكفي
        // توكن مسروق لتبديل جهاز المهاجم. حساب غير مؤكد لا يملك ما يثبت به.
        if (state && state.confirmedAt && state.secret) {
            const code = String(req.body?.code || '').trim();
            if (!code) {
                return res.status(428).json({
                    error: 'MFA_CODE_REQUIRED',
                    message: 'أدخل رمز تطبيق المصادقة الحالي قبل إعادة التسجيل.',
                });
            }
            const v = totp.verify(state.secret, code, { minStep: state.lastUsedStep });
            if (!v.ok) {return res.status(401).json(v.reason === 'REPLAY' ? CODE_REUSED : INVALID_CODE);}
            if (!await mfaStore.consumeStep(user.id, v.step)) {return res.status(409).json(CODE_REUSED);}
        }

        const secret = totp.generateSecret();
        await mfaStore.savePending(user.id, secret);
        const uri = totp.otpauthURI({ secret, account: user.username, issuer: MFA_ISSUER });
        let qrDataUrl = null;
        try {
            qrDataUrl = await QRCode.toDataURL(uri, {
                errorCorrectionLevel: 'M',
                margin: 1,
                width: 240,
                color: { dark: '#123c39', light: '#ffffff' },
            });
        } catch (qrErr) {
            logger.warn('[mfa] QR render failed — manual key still returned:', qrErr.message);
        }
        logger.info({ userId: user.id }, '[mfa] enrollment secret issued (pending)');
        res.set('Cache-Control', 'no-store');
        return res.json({
            ok: true,
            issuer: MFA_ISSUER,
            account: user.username,
            secret,
            otpauth_uri: uri,
            qr_data_url: qrDataUrl,
            expires_in_minutes: ENROLL_TICKET_MINUTES,
            message: 'امسح رمز QR بتطبيق مصادقة (Google Authenticator أو Microsoft Authenticator) ثم أدخل الرمز الظاهر.',
        });
    } catch (err) {
        if (err.code === 'MFA_KEY_NOT_CONFIGURED') {
            logger.error('[mfa] vault key unavailable — enrollment refused');
            return res.status(503).json({ error: 'MFA_KEY_NOT_CONFIGURED', message: 'خزنة الأسرار غير مهيأة على الخادم — تواصل مع مسؤول النظام.' });
        }
        logger.error('[mfa] setup failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر بدء تسجيل المصادقة الثنائية — حاول مجددًا.' });
    }
}

async function confirmHandler(req, res) {
    try {
        const code = String(req.body?.code || '').trim();
        if (!/^\d{6}$/.test(code)) {
            return res.status(422).json({ error: 'VALIDATION', message: 'أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.' });
        }
        const state = await mfaStore.loadState(req.user.id);
        if (!state || !state.pendingSecret) {
            return res.status(409).json({ error: 'MFA_NOT_PENDING', message: 'لا يوجد تسجيل بانتظار التأكيد — ابدأ التسجيل من جديد.' });
        }
        const v = totp.verify(state.pendingSecret, code);
        if (!v.ok) {
            return res.status(401).json(v.reason === 'REPLAY'
                ? CODE_REUSED
                : { error: 'INVALID_MFA_CODE', message: 'الرمز لا يطابق المفتاح المعروض — تحقق من ساعة الجهاز وأعد المحاولة.' });
        }
        const recoveryCodes = totp.generateRecoveryCodes(RECOVERY_CODE_COUNT);
        const applied = await mfaStore.confirm(req.user.id, v.step, recoveryCodes);
        if (!applied) {
            return res.status(409).json({ error: 'MFA_NOT_PENDING', message: 'اكتمل تأكيد آخر بالفعل — أعد تسجيل الدخول.' });
        }
        logger.info({ userId: req.user.id }, '[mfa] enrollment confirmed');
        await writeAuditLog({
            action: 'MFA_ENROLLED',
            tableName: 'user_mfa',
            rowPk: String(req.user.id),
            reason: 'تسجيل مصادقة ثنائية (TOTP)',
            metadata: { recovery_codes: recoveryCodes.length },
            actor: { userId: req.user.id, userName: req.user.name, role: req.user.role, ip: req.ip, requestId: req.id },
        }).catch((e) => logger.error('[mfa] audit log failed:', e.message));

        // التسجيل من تذكرة الدخول يُكمل الدخول مباشرة — لا خطوة إضافية.
        if (req.mfaTicket) {
            const live = await loadLiveUser(req.user.id);
            if (!live || !live.active) {return res.status(401).json(ACCOUNT_DISABLED);}
            return sendSession(req, res, live, {
                recovery_codes: recoveryCodes,
                message: 'تم تفعيل المصادقة الثنائية — احفظ رموز الاسترداد في مكان آمن، فهي تظهر مرة واحدة فقط.',
            });
        }
        return res.json({
            ok: true,
            recovery_codes: recoveryCodes,
            message: 'تم تفعيل المصادقة الثنائية — احفظ رموز الاسترداد في مكان آمن، فهي تظهر مرة واحدة فقط.',
        });
    } catch (err) {
        logger.error('[mfa] confirm failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر تأكيد المصادقة الثنائية — حاول مجددًا.' });
    }
}

async function verifyHandler(req, res) {
    try {
        const code = String(req.body?.code || '').trim();
        const recovery = String(req.body?.recovery_code || '').trim();
        if (!code && !recovery) {
            return res.status(400).json({ error: 'MISSING_CODE', message: 'أدخل رمز التطبيق أو رمز الاسترداد.' });
        }
        const live = await loadLiveUser(req.user.id);
        if (!live || !live.active) {return res.status(401).json(ACCOUNT_DISABLED);}

        if (recovery) {
            const consumed = await mfaStore.consumeRecovery(live.id, recovery);
            if (!consumed) {
                return res.status(401).json({ error: 'INVALID_RECOVERY_CODE', message: 'رمز الاسترداد غير صحيح أو مستعمل من قبل.' });
            }
            logger.warn({ userId: live.id }, '[mfa] login via recovery code (TOTP unavailable)');
            await writeAuditLog({
                action: 'MFA_RECOVERY_CODE_USED',
                tableName: 'user_mfa',
                rowPk: String(live.id),
                reason: 'دخول برمز استرداد بدل تطبيق المصادقة',
                metadata: {},
                actor: { userId: live.id, userName: live.username, role: live.role, ip: req.ip, requestId: req.id },
            }).catch((e) => logger.error('[mfa] audit log failed:', e.message));
            return sendSession(req, res, live);
        }

        const state = await mfaStore.loadState(live.id);
        if (!state || !state.confirmedAt || !state.secret) {
            return res.status(409).json({ error: 'MFA_NOT_ENROLLED', message: 'لا يوجد تسجيل مصادقة ثنائية مكتمل لهذا الحساب.' });
        }
        const v = totp.verify(state.secret, code, { minStep: state.lastUsedStep });
        // إعادة استعمال خطوة مستهلكة إشارة مختلفة عن رمز خاطئ: 409 صريح.
        if (!v.ok) {return res.status(v.reason === 'REPLAY' ? 409 : 401).json(v.reason === 'REPLAY' ? CODE_REUSED : INVALID_CODE);}
        if (!await mfaStore.consumeStep(live.id, v.step)) {return res.status(409).json(CODE_REUSED);}
        return sendSession(req, res, live);
    } catch (err) {
        logger.error('[mfa] verify failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر التحقق من رمز المصادقة — حاول مجددًا.' });
    }
}

async function disableHandler(req, res) {
    try {
        const password = String(req.body?.password || '');
        const code = String(req.body?.code || '').trim();
        const recovery = String(req.body?.recovery_code || '').trim();
        if (!password || (!code && !recovery)) {
            return res.status(400).json({ error: 'MISSING_CREDENTIALS', message: 'أدخل كلمة المرور ورمز المصادقة (أو رمز استرداد).' });
        }
        if (mfaStore.mfaRequiredFor(req.user.role)) {
            return res.status(409).json({
                error: 'MFA_REQUIRED_FOR_ROLE',
                message: 'المصادقة الثنائية إلزامية لهذا الدور ولا يمكن تعطيلها من هنا.',
            });
        }
        const state = await mfaStore.loadState(req.user.id);
        if (!state || !state.confirmedAt || !state.secret) {
            return res.status(409).json({ error: 'MFA_NOT_ENABLED', message: 'المصادقة الثنائية غير مفعّلة على هذا الحساب.' });
        }
        const pwdRow = await pool.query('SELECT password FROM users WHERE id = $1 LIMIT 1;', [req.user.id]);
        if (!pwdRow.rows[0] || !await bcrypt.compare(password, pwdRow.rows[0].password)) {
            return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'كلمة المرور غير صحيحة.' });
        }
        if (recovery) {
            if (!await mfaStore.consumeRecovery(req.user.id, recovery)) {
                return res.status(401).json({ error: 'INVALID_RECOVERY_CODE', message: 'رمز الاسترداد غير صحيح أو مستعمل من قبل.' });
            }
        } else {
            const v = totp.verify(state.secret, code, { minStep: state.lastUsedStep });
            if (!v.ok) {return res.status(401).json(v.reason === 'REPLAY' ? CODE_REUSED : INVALID_CODE);}
            if (!await mfaStore.consumeStep(req.user.id, v.step)) {return res.status(409).json(CODE_REUSED);}
        }
        await mfaStore.remove(req.user.id);
        logger.warn({ userId: req.user.id }, '[mfa] MFA disabled by owner of the account');
        await writeAuditLog({
            action: 'MFA_DISABLED',
            tableName: 'user_mfa',
            rowPk: String(req.user.id),
            reason: 'تعطيل المصادقة الثنائية بطلب صاحب الحساب',
            metadata: {},
            actor: { userId: req.user.id, userName: req.user.name, role: req.user.role, ip: req.ip, requestId: req.id },
        }).catch((e) => logger.error('[mfa] audit log failed:', e.message));
        return res.json({ ok: true, message: 'تم تعطيل المصادقة الثنائية لهذا الحساب.' });
    } catch (err) {
        logger.error('[mfa] disable failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر تعطيل المصادقة الثنائية — حاول مجددًا.' });
    }
}

async function recoveryCodesHandler(req, res) {
    try {
        const code = String(req.body?.code || '').trim();
        if (!/^\d{6}$/.test(code)) {
            return res.status(422).json({ error: 'VALIDATION', message: 'أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.' });
        }
        const state = await mfaStore.loadState(req.user.id);
        if (!state || !state.confirmedAt || !state.secret) {
            return res.status(409).json({ error: 'MFA_NOT_ENABLED', message: 'المصادقة الثنائية غير مفعّلة على هذا الحساب.' });
        }
        const v = totp.verify(state.secret, code, { minStep: state.lastUsedStep });
        if (!v.ok) {return res.status(401).json(v.reason === 'REPLAY' ? CODE_REUSED : INVALID_CODE);}
        if (!await mfaStore.consumeStep(req.user.id, v.step)) {return res.status(409).json(CODE_REUSED);}
        const codes = totp.generateRecoveryCodes(RECOVERY_CODE_COUNT);
        await mfaStore.replaceRecoveryCodes(req.user.id, codes);
        logger.info({ userId: req.user.id }, '[mfa] recovery codes regenerated');
        await writeAuditLog({
            action: 'MFA_RECOVERY_CODES_REGENERATED',
            tableName: 'user_mfa',
            rowPk: String(req.user.id),
            reason: 'إصدار رموز استرداد جديدة (القديمة أُبطلت)',
            metadata: { count: codes.length },
            actor: { userId: req.user.id, userName: req.user.name, role: req.user.role, ip: req.ip, requestId: req.id },
        }).catch((e) => logger.error('[mfa] audit log failed:', e.message));
        res.set('Cache-Control', 'no-store');
        return res.json({
            ok: true,
            recovery_codes: codes,
            message: 'الرموز السابقة أُبطلت. احفظ الرموز الجديدة في مكان آمن — تظهر مرة واحدة فقط.',
        });
    } catch (err) {
        logger.error('[mfa] recovery rotation failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر إصدار رموز الاسترداد — حاول مجددًا.' });
    }
}

/**
 * مسح تسجيل مستخدم فقد جهازه. مالك يستطيع مسح أي حساب؛ مدير يمسح
 * الحسابات غير الإدارية فقط (لا يملك إسقاط تحقق نظيره). الجلسات القائمة
 * للمستخدم المستهدف تُسحب كلها كي لا يبقى أي وصول بعد إسقاط العامل الثاني.
 */
async function adminResetHandler(req, res) {
    try {
        const username = String(req.body?.username || '').trim();
        if (!username) {
            return res.status(422).json({ error: 'VALIDATION', message: 'أدخل اسم المستخدم المطلوب.' });
        }
        const target = (await pool.query(
            `SELECT id, username, role, active FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1;`,
            [username]
        )).rows[0];
        if (!target) {
            return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'لا يوجد حساب بهذا الاسم.' });
        }
        if (Number(target.id) === Number(req.user.id)) {
            return res.status(409).json({ error: 'MFA_SELF_RESET', message: 'استخدم تعطيل المصادقة من حسابك نفسه.' });
        }
        const targetIsAdmin = ['owner', 'admin'].includes(String(target.role || '').toLowerCase());
        if (targetIsAdmin && req.user.role !== 'owner') {
            return res.status(403).json({ error: 'FORBIDDEN', message: 'مسح تسجيل حساب إداري يتطلب صلاحية المالك.' });
        }
        await mfaStore.remove(target.id);
        await pool.query('DELETE FROM pos_refresh_tokens WHERE user_id = $1;', [target.id]);
        logger.warn({ actor: req.user.id, target: target.id }, '[mfa] MFA registration cleared by admin');
        await writeAuditLog({
            action: 'MFA_ADMIN_RESET',
            tableName: 'user_mfa',
            rowPk: String(target.id),
            reason: 'مسح تسجيل المصادقة الثنائية لمستخدم فقد جهازه',
            metadata: { target_username: target.username, target_role: target.role },
            actor: { userId: req.user.id, userName: req.user.name, role: req.user.role, ip: req.ip, requestId: req.id },
        }).catch((e) => logger.error('[mfa] audit log failed:', e.message));
        return res.json({
            ok: true,
            username: target.username,
            message: 'تم مسح تسجيل المصادقة الثنائية — يسجّل المستخدم من جديد عبر شاشة الدخول.',
        });
    } catch (err) {
        logger.error('[mfa] admin reset failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر مسح تسجيل المصادقة — حاول مجددًا.' });
    }
}

function register(app) {
    app.get('/api/auth/mfa/status', generalLimiter, jwtAuth, statusHandler);

    // التسجيل من جلسة موثوقة أو من تذكرة تسجيل أول مرة.
    app.post('/api/auth/mfa/setup', generalLimiter, ticketOrSession(['mfa_enroll']), setupHandler);
    app.post('/api/auth/mfa/confirm', ticketOrSession(['mfa_enroll']), mfaLimiter, confirmHandler);
    app.post('/api/auth/mfa/verify', ticketOrSession(['mfa']), mfaLimiter, verifyHandler);

    // إجراءات على الحساب نفسه — جلسة كاملة فقط (لا تذكرة).
    app.post('/api/auth/mfa/disable', jwtAuth, mfaLimiter, disableHandler);
    app.post('/api/auth/mfa/recovery-codes', jwtAuth, mfaLimiter, recoveryCodesHandler);
    app.post('/api/auth/mfa/admin-reset', generalLimiter, jwtAuth, requireRole('owner', 'admin'), adminResetHandler);

    return app;
}

module.exports = {
    register,
    statusHandler,
    setupHandler,
    confirmHandler,
    verifyHandler,
    disableHandler,
    recoveryCodesHandler,
    adminResetHandler,
    ticketOrSession,
};
