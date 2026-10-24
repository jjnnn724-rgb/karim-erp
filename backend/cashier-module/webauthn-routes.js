'use strict';

/**
 * webauthn-routes.js — مفاتيح المرور (Passkeys / WebAuthn).
 * ────────────────────────────────────────────────────────────────────────────
 * العامل الثاني صار شيئًا تملكه (هاتف/لابتوب ببصمة أو Face ID) بدل رمز
 * يُنسخ من تطبيق. المسارات:
 *
 *   GET  /api/auth/webauthn/status                 جلسة — الأجهزة المسجّلة (بلا مفاتيح)
 *   POST /api/auth/webauthn/register/options       جلسة + كلمة المرور — بدء تسجيل جهاز
 *   POST /api/auth/webauthn/register/verify        جلسة — تثبيت المفتاح العام
 *   POST /api/auth/webauthn/login/options          تذكرة — خيارات المصادقة
 *   POST /api/auth/webauthn/login/verify           تذكرة — توقيع صحيح ← جلسة
 *   POST /api/auth/webauthn/credentials/:id/remove جلسة + كلمة المرور — حذف جهاز
 *
 * لماذا كلمة المرور عند التسجيل والحذف: جلسة مسروقة وحدها لا يجب أن تضيف
 * مفتاحًا دائمًا (بابًا خلفيًا) ولا أن تُسقط العامل الثاني. التحقق من كلمة
 * المرور يجعل الجلسة وحدها غير كافية لتغيير شكل الحماية.
 *
 * التحدّي يُخزَّن في القاعدة ويُستهلك بحذفه (webauthn-store) — فلا يصلح تحدٍّ
 * واحد لتوقيعين، ولا يُقبل تحدٍّ من أصل (origin) آخر.
 */

const bcrypt = require('../pw-crypto');
const { pool } = require('./db-pool');
const { logger } = require('../logger');
const webauthnStore = require('./webauthn-store');
const {
    jwtAuth,
} = require('./jwt-middleware');
const { ticketOrSession, sendSession } = require('./mfa-routes');
const { writeAuditLog } = require('./audit-middleware');
const { createRateLimiter, generalLimiter } = require('../rate-limiter');

const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Karim ERP';
const RP_ID_DEFAULT = 'karimeg.online';
const BCRYPT_REGEX = /^\$2[aby]\$/;
const MAX_LABEL = 60;

const webauthnLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 15,
    message: 'محاولات تحقق كثيرة — انتظر قليلًا ثم أعد المحاولة.',
    keyGenerator: (req) => `webauthn:${req.user?.id || 'anonymous'}`,
    skipFailedRequests: false,
});

const passwordLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 8,
    message: 'محاولات كثيرة — انتظر قليلًا ثم أعد المحاولة.',
    keyGenerator: (req) => `webauthn-pw:${req.user?.id || 'anonymous'}`,
    skipFailedRequests: false,
});

const INVALID = {
    error: 'WEBAUTHN_FAILED',
    message: 'تعذّر التحقق من الجهاز — أعد المحاولة أو استخدم طريقة أخرى للدخول.',
};

// الحزمة ESM فقط؛ Node 20.19 يسمح بـ require لها وقد تحققنا على نسخة الخدمة.
// التحميل مؤجّل حتى أول طلب WebAuthn كي لا يتأخر إقلاع الخادم.
let _lib = null;
function lib() {
    if (!_lib) {_lib = require('@simplewebauthn/server');}
    return _lib;
}

function configuredRpId() {
    const configured = String(process.env.WEBAUTHN_RP_ID || '').trim();
    return configured || RP_ID_DEFAULT;
}

/**
 * يقبل الأصل (Origin) فقط إن كان https وامتدادًا للنطاق المُعدّ، أو محليًا
 * في غير الإنتاج. رفض الأصل علامة على طلب مزيّف، لا على عطل في المتصفح.
 */
function resolveOrigin(req) {
    const raw = String(req.headers.origin || '').trim();
    if (!raw) {return null;}
    let url;
    try { url = new URL(raw); } catch { return null; }
    const host = url.hostname.toLowerCase();
    const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const rpId = configuredRpId();
    if (local) {
        return process.env.NODE_ENV !== 'production' || rpId === host ? raw : null;
    }
    if (url.protocol !== 'https:') {return null;}
    if (host !== rpId && !host.endsWith(`.${rpId}`)) {return null;}
    return raw;
}

function sanitizeLabel(value, fallback) {
    let text = '';
    for (const ch of String(value || '')) {
        const code = ch.codePointAt(0);
        text += code < 32 || ch === '<' || ch === '>' ? ' ' : ch;
    }
    return (text.trim() || fallback).slice(0, MAX_LABEL);
}

function challengeFromClientData(response) {
    const encoded = response && response.response && response.response.clientDataJSON;
    if (typeof encoded !== 'string') {return null;}
    try {
        const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        return typeof parsed.challenge === 'string' && parsed.challenge ? parsed.challenge : null;
    } catch {
        return null;
    }
}

async function loadLiveUser(userId) {
    const r = await pool.query(
        `SELECT id, username, name, role, active, must_change_password, dept_code, branch_id
           FROM users WHERE id = $1 LIMIT 1;`,
        [userId]
    );
    return r.rows[0] || null;
}

async function passwordMatches(userId, password) {
    const r = await pool.query('SELECT password FROM users WHERE id = $1 LIMIT 1;', [userId]);
    const hash = r.rows[0] && r.rows[0].password;
    if (!hash || !BCRYPT_REGEX.test(hash)) {return false;}
    return bcrypt.compare(String(password || ''), hash);
}

async function statusHandler(req, res) {
    try {
        const rows = await webauthnStore.listCredentials(req.user.id);
        res.set('Cache-Control', 'no-store');
        return res.json({
            ok: true,
            enabled: rows.length > 0,
            count: rows.length,
            max: webauthnStore.MAX_CREDENTIALS_PER_USER,
            credentials: rows.map((row) => ({
                id: Number(row.id),
                label: row.device_label || 'جهاز مسجّل',
                backed_up: Boolean(row.backed_up),
                created_at: row.created_at,
                last_used_at: row.last_used_at,
            })),
        });
    } catch (err) {
        logger.error('[webauthn] status failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذّر قراءة أجهزة الدخول — حاول مجددًا.' });
    }
}

async function registerOptionsHandler(req, res) {
    try {
        const password = String(req.body && req.body.password || '');
        if (!password) {
            return res.status(400).json({ error: 'PASSWORD_REQUIRED', message: 'أدخل كلمة المرور لتسجيل جهاز جديد.' });
        }
        const live = await loadLiveUser(req.user.id);
        if (!live || !live.active) {
            return res.status(401).json({ error: 'ACCOUNT_DISABLED', message: 'تم إيقاف هذا الحساب — تواصل مع المسؤول.' });
        }
        if (!await passwordMatches(live.id, password)) {
            return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'كلمة المرور غير صحيحة.' });
        }
        if (await webauthnStore.countCredentials(live.id) >= webauthnStore.MAX_CREDENTIALS_PER_USER) {
            return res.status(409).json({
                error: 'WEBAUTHN_LIMIT',
                message: `لا يمكن تسجيل أكثر من ${webauthnStore.MAX_CREDENTIALS_PER_USER} أجهزة — احذف جهازًا قديمًا أولًا.`,
            });
        }
        const origin = resolveOrigin(req);
        if (!origin) {
            return res.status(400).json({ error: 'WEBAUTHN_ORIGIN', message: 'أصل الطلب غير معروف — افتح النظام من عنوانه الرسمي وأعد المحاولة.' });
        }
        const rpID = configuredRpId();
        const existing = await webauthnStore.listForAllowCredentials(live.id);
        const { generateRegistrationOptions } = lib();
        const options = await generateRegistrationOptions({
            rpName: RP_NAME,
            rpID,
            userID: new TextEncoder().encode(String(live.id)),
            userName: live.username,
            userDisplayName: live.name || live.username,
            attestationType: 'none',
            excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports || [] })),
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'required',
            },
            timeout: 60_000,
        });
        await webauthnStore.saveChallenge({
            userId: live.id,
            purpose: 'register',
            challenge: options.challenge,
            origin,
        });
        res.set('Cache-Control', 'no-store');
        return res.json({ ok: true, options, device_label: sanitizeLabel(req.body && req.body.device_label, '') });
    } catch (err) {
        logger.error('[webauthn] register options failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذّر بدء تسجيل الجهاز — حاول مجددًا.' });
    }
}

async function registerVerifyHandler(req, res) {
    try {
        const response = req.body && req.body.response;
        const challenge = challengeFromClientData(response);
        if (!response || !challenge) {
            return res.status(400).json({ error: 'WEBAUTHN_RESPONSE', message: 'استجابة الجهاز غير مكتملة — أعد المحاولة.' });
        }
        const stored = await webauthnStore.takeChallenge({
            userId: req.user.id,
            purpose: 'register',
            challenge,
        });
        if (!stored) {
            return res.status(409).json({ error: 'WEBAUTHN_CHALLENGE', message: 'انتهت صلاحية التسجيل أو استُخدم — ابدأ من جديد.' });
        }
        const live = await loadLiveUser(req.user.id);
        if (!live || !live.active) {
            return res.status(401).json({ error: 'ACCOUNT_DISABLED', message: 'تم إيقاف هذا الحساب — تواصل مع المسؤول.' });
        }
        const rpID = configuredRpId();
        const { verifyRegistrationResponse } = lib();
        let verification;
        try {
            verification = await verifyRegistrationResponse({
                response,
                expectedChallenge: stored.challenge,
                expectedOrigin: stored.origin,
                expectedRPID: rpID,
                requireUserVerification: true,
            });
        } catch (verifyErr) {
            logger.warn({ userId: live.id, reason: verifyErr.message }, '[webauthn] registration rejected');
            return res.status(401).json(INVALID);
        }
        if (!verification.verified || !verification.registrationInfo) {
            return res.status(401).json(INVALID);
        }
        const info = verification.registrationInfo;
        const credential = info.credential;
        const saved = await webauthnStore.addCredential({
            userId: live.id,
            credentialId: credential.id,
            publicKey: Buffer.from(credential.publicKey),
            counter: credential.counter || 0,
            transports: Array.isArray(credential.transports) ? credential.transports : [],
            backedUp: Boolean(info.credentialBackedUp),
            deviceLabel: sanitizeLabel(req.body && req.body.device_label, 'جهاز مسجّل'),
        });
        if (!saved.ok) {
            if (saved.reason === 'DUPLICATE') {
                return res.status(409).json({ error: 'WEBAUTHN_DUPLICATE', message: 'هذا الجهاز مسجّل بالفعل.' });
            }
            return res.status(409).json({ error: 'WEBAUTHN_LIMIT', message: 'بلغت حد الأجهزة المسجّلة — احذف جهازًا قديمًا أولًا.' });
        }
        logger.info({ userId: live.id, credentialRow: saved.id }, '[webauthn] credential registered');
        await writeAuditLog({
            action: 'WEBAUTHN_REGISTERED',
            tableName: 'user_webauthn_credentials',
            rowPk: String(saved.id),
            reason: 'تسجيل جهاز جديد للدخول بالبصمة / Face ID',
            metadata: { backed_up: Boolean(info.credentialBackedUp), device_type: info.credentialDeviceType || null },
            actor: { userId: live.id, userName: live.name, role: live.role, ip: req.ip, requestId: req.id },
        }).catch((e) => logger.error('[webauthn] audit log failed:', e.message));
        return res.json({ ok: true, message: 'تم تسجيل الجهاز — يمكنك الآن الدخول بالبصمة أو Face ID.' });
    } catch (err) {
        logger.error('[webauthn] register verify failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذّر إتمام تسجيل الجهاز — حاول مجددًا.' });
    }
}

async function loginOptionsHandler(req, res) {
    try {
        const live = await loadLiveUser(req.user.id);
        if (!live || !live.active) {
            return res.status(401).json({ error: 'ACCOUNT_DISABLED', message: 'تم إيقاف هذا الحساب — تواصل مع المسؤول.' });
        }
        const allowed = await webauthnStore.listForAllowCredentials(live.id);
        if (!allowed.length) {
            return res.status(409).json({ error: 'WEBAUTHN_NOT_ENROLLED', message: 'لا يوجد جهاز مسجّل لهذا الحساب — سجّل الدخول بكلمة المرور أولًا.' });
        }
        const origin = resolveOrigin(req);
        if (!origin) {
            return res.status(400).json({ error: 'WEBAUTHN_ORIGIN', message: 'أصل الطلب غير معروف — افتح النظام من عنوانه الرسمي وأعد المحاولة.' });
        }
        const { generateAuthenticationOptions } = lib();
        const options = await generateAuthenticationOptions({
            rpID: configuredRpId(),
            allowCredentials: allowed.map((c) => ({ id: c.credential_id, transports: c.transports || [] })),
            userVerification: 'required',
            timeout: 60_000,
        });
        await webauthnStore.saveChallenge({
            userId: live.id,
            purpose: 'login',
            challenge: options.challenge,
            origin,
        });
        res.set('Cache-Control', 'no-store');
        return res.json({ ok: true, options });
    } catch (err) {
        logger.error('[webauthn] login options failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذّر بدء التحقق بالجهاز — حاول مجددًا.' });
    }
}

async function loginVerifyHandler(req, res) {
    try {
        const response = req.body && req.body.response;
        const challenge = challengeFromClientData(response);
        if (!response || !challenge || typeof response.id !== 'string') {
            return res.status(400).json({ error: 'WEBAUTHN_RESPONSE', message: 'استجابة الجهاز غير مكتملة — أعد المحاولة.' });
        }
        const stored = await webauthnStore.takeChallenge({
            userId: req.user.id,
            purpose: 'login',
            challenge,
        });
        if (!stored) {
            return res.status(409).json({ error: 'WEBAUTHN_CHALLENGE', message: 'انتهت صلاحية التحقق أو استُخدم — أعد إدخال كلمة المرور.' });
        }
        const live = await loadLiveUser(req.user.id);
        if (!live || !live.active) {
            return res.status(401).json({ error: 'ACCOUNT_DISABLED', message: 'تم إيقاف هذا الحساب — تواصل مع المسؤول.' });
        }
        const credential = await webauthnStore.getCredentialForAuth(live.id, response.id);
        if (!credential) {
            return res.status(401).json(INVALID);
        }
        const { verifyAuthenticationResponse } = lib();
        let verification;
        try {
            verification = await verifyAuthenticationResponse({
                response,
                expectedChallenge: stored.challenge,
                expectedOrigin: stored.origin,
                expectedRPID: configuredRpId(),
                credential: {
                    id: credential.credential_id,
                    publicKey: new Uint8Array(credential.public_key),
                    counter: Number(credential.counter) || 0,
                    transports: credential.transports || [],
                },
                requireUserVerification: true,
            });
        } catch (verifyErr) {
            logger.warn({ userId: live.id, reason: verifyErr.message }, '[webauthn] login rejected');
            return res.status(401).json(INVALID);
        }
        if (!verification.verified) {
            return res.status(401).json(INVALID);
        }
        await webauthnStore.touchCredential(live.id, credential.credential_id, verification.authenticationInfo.newCounter);
        logger.info({ userId: live.id }, '[webauthn] login verified with passkey');
        await writeAuditLog({
            action: 'WEBAUTHN_LOGIN',
            tableName: 'user_webauthn_credentials',
            rowPk: String(live.id),
            reason: 'دخول بمفتاح مرور (بصمة / Face ID)',
            metadata: {},
            actor: { userId: live.id, userName: live.name, role: live.role, ip: req.ip, requestId: req.id },
        }).catch((e) => logger.error('[webauthn] audit log failed:', e.message));
        return sendSession(req, res, live, { webauthn: true });
    } catch (err) {
        logger.error('[webauthn] login verify failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذّر التحقق من الجهاز — حاول مجددًا.' });
    }
}

async function removeCredentialHandler(req, res) {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'VALIDATION', message: 'جهاز غير معروف.' });
        }
        const password = String(req.body && req.body.password || '');
        if (!password) {
            return res.status(400).json({ error: 'PASSWORD_REQUIRED', message: 'أدخل كلمة المرور لحذف الجهاز.' });
        }
        const live = await loadLiveUser(req.user.id);
        if (!live || !live.active) {
            return res.status(401).json({ error: 'ACCOUNT_DISABLED', message: 'تم إيقاف هذا الحساب — تواصل مع المسؤول.' });
        }
        if (!await passwordMatches(live.id, password)) {
            return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'كلمة المرور غير صحيحة.' });
        }
        const removed = await webauthnStore.removeCredential(live.id, id);
        if (!removed) {
            return res.status(404).json({ error: 'NOT_FOUND', message: 'هذا الجهاز غير مسجّل — حدّث القائمة.' });
        }
        logger.warn({ userId: live.id, credentialRow: id }, '[webauthn] credential removed');
        await writeAuditLog({
            action: 'WEBAUTHN_REMOVED',
            tableName: 'user_webauthn_credentials',
            rowPk: String(id),
            reason: 'حذف جهاز دخول بالبصمة / Face ID',
            metadata: {},
            actor: { userId: live.id, userName: live.name, role: live.role, ip: req.ip, requestId: req.id },
        }).catch((e) => logger.error('[webauthn] audit log failed:', e.message));
        return res.json({ ok: true, message: 'تم حذف الجهاز.' });
    } catch (err) {
        logger.error('[webauthn] remove failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذّر حذف الجهاز — حاول مجددًا.' });
    }
}

function register(app) {
    app.get('/api/auth/webauthn/status', generalLimiter, jwtAuth, statusHandler);

    // التسجيل والحذف يغيّران شكل الحماية ⇒ كلمة المرور شرط، لا الجلسة وحدها.
    app.post('/api/auth/webauthn/register/options', generalLimiter, jwtAuth, passwordLimiter, registerOptionsHandler);
    app.post('/api/auth/webauthn/register/verify', jwtAuth, webauthnLimiter, registerVerifyHandler);
    app.post('/api/auth/webauthn/credentials/:id/remove', jwtAuth, passwordLimiter, removeCredentialHandler);

    // المصادقة نفسها: تذكرة قصيرة بعد كلمة المرور، والجلسة تُصدر هنا فقط.
    app.post('/api/auth/webauthn/login/options', generalLimiter, ticketOrSession(['mfa']), webauthnLimiter, loginOptionsHandler);
    app.post('/api/auth/webauthn/login/verify', ticketOrSession(['mfa']), webauthnLimiter, loginVerifyHandler);

    return app;
}

module.exports = {
    register,
    statusHandler,
    registerOptionsHandler,
    registerVerifyHandler,
    loginOptionsHandler,
    loginVerifyHandler,
    removeCredentialHandler,
    resolveOrigin,
    configuredRpId,
    challengeFromClientData,
};
