/**
 * jwt-middleware.js — JWT auth (Access 24h / Refresh طويل قابل للضبط) + RBAC
 * ────────────────────────────────────────────────────────────────────────────
 * Uses the EXISTING `users` table (id BIGINT, username, password, role, name).
 *
 * SECURITY POLICY (enforced since 2026-07-17):
 *   ALL passwords MUST be bcrypt-hashed ($2a$ / $2b$ / $2y$).
 *   Plaintext password comparison is REMOVED ENTIRELY from this file.
 *   Any user row whose password does NOT match the bcrypt regex is
 *   REJECTED at login with PASSWORD_MIGRATION_REQUIRED. The admin must
 *   run `node scripts/migrate-plaintext-passwords.js` to migrate them.
 *
 *   See:
 *     - database/migrations/007_force_bcrypt_passwords.sql
 *     - scripts/migrate-plaintext-passwords.js
 *
 * Refresh tokens are stored hashed in `pos_refresh_tokens` (new table).
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('../pw-crypto');
const { logger } = require('../logger');
const { encryptForVault } = require('../password-vault');
const { pool } = require('./db-pool');
const { updateUserContext } = require('../middleware/correlation');
const { loadState: loadMfaState, mfaRequiredFor } = require('./mfa-store');

// Known placeholder/template values from .env.example. These are PUBLIC
// (shipped in the repo), so if a real deployment ends up using one of them
// as the signing secret, anyone can forge a valid admin JWT. Length alone
// (≥32 chars) is NOT sufficient to treat a value as "configured" — the
// placeholders were deliberately written long to look like real secrets.
const KNOWN_PLACEHOLDER_SECRETS = new Set([
    'replace-me-with-a-long-random-secret-access-key-32chars-min',
    'replace-me-with-a-long-random-secret-refresh-key-32chars-min',
]);

function isPlaceholderSecret(value) {
    if (!value) {return false;}
    if (KNOWN_PLACEHOLDER_SECRETS.has(value)) {return true;}
    return /^replace-me/i.test(value);
}

const accessSecretIsPlaceholder  = isPlaceholderSecret(process.env.JWT_ACCESS_SECRET);
const refreshSecretIsPlaceholder = isPlaceholderSecret(process.env.JWT_REFRESH_SECRET);

// ─── Production Safety: Require explicit, real secrets ───
if (process.env.NODE_ENV === 'production' &&
    (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET ||
     accessSecretIsPlaceholder || refreshSecretIsPlaceholder)) {
    logger.error('🚨 [FATAL] JWT_ACCESS_SECRET / JWT_REFRESH_SECRET must be set to real, random values in production.');
    if (accessSecretIsPlaceholder || refreshSecretIsPlaceholder) {
        logger.error('   → The .env file still contains the placeholder value from .env.example.');
        logger.error('   → That value is public and would let anyone forge a valid admin token.');
    }
    logger.error('   → Run `npm run setup` to generate real secrets, or set them manually (≥32 random chars).');
    process.exit(1);
}

// In production, never sign with a placeholder even if somehow reached above.
const ACCESS_SECRET  = (process.env.JWT_ACCESS_SECRET  && !accessSecretIsPlaceholder)
    ? process.env.JWT_ACCESS_SECRET
    : crypto.randomBytes(32).toString('hex');
(process.env.JWT_REFRESH_SECRET && !refreshSecretIsPlaceholder)
    ? process.env.JWT_REFRESH_SECRET
    : crypto.randomBytes(32).toString('hex');
const ACCESS_TTL  = '24h';
// مدة رمز التحديث — H-4 (تدقيق 2026-10-23): نافذة جلسة مسروقة ≤ 30 يومًا.
// الافتراضي كان 365؛ خُفّض إلى 30. للتخصيص: JWT_REFRESH_DAYS في .env.
const REFRESH_TTL_DAYS = Math.max(1, parseInt(process.env.JWT_REFRESH_DAYS || '30', 10) || 30);

const BCRYPT_REGEX = /^\$2[aby]\$/;

let _userSecColsEnsured = false;
async function ensureUserSecurityColumns(client) {
    // STEEL: DDL مرة واحدة لكل عملية — تشغيلها مع كل دخول كان يعلّق الدخول
    // خلف أي معاملة طويلة (نسخ احتياطي/استيراد) فيفشل كل تسجيل دخول.
    if (_userSecColsEnsured) {return;}
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;`);
    // Task 19: ربط رئيس القسم بقسمه (dept_code) — NULL لغير رؤساء الأقسام
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dept_code VARCHAR(50);`);
    // 102_branches transitional: العمود يُخلق مبكرًا بلا FK حتى لا تنهار
    // قراءة المستخدم قبل تطبيق الـmigration — الـmigration تضيف بقية البنية.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER;`);
    _userSecColsEnsured = true;
}

function isStrongPassword(value) {
    // M-2 (تدقيق 2026-10-23): الحد الأدنى 12 حرفًا بدلًا من 8.
    return typeof value === 'string' && value.length >= 12 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

if (!process.env.JWT_ACCESS_SECRET || accessSecretIsPlaceholder) {
    logger.warn('⚠ [pos-auth] JWT_ACCESS_SECRET not set (or placeholder) — using ephemeral key. Sessions will not survive restart.');
}

function signAccessToken(user) {
    return jwt.sign(
        {
            sub: String(user.id),
            role: user.role,
            name: user.name,
            dept_code: user.dept_code || null,
            branch_id: user.branch_id ?? null,
            sid: user.session_id || null,
            pwd_change: Boolean(user.must_change_password),
            purpose: 'access',
        },
        ACCESS_SECRET,
        { expiresIn: ACCESS_TTL, algorithm: 'HS256' }
    );
}

/**
 * تذكرة قصيرة العمر بين كلمة المرور والرمز الثاني.
 * `mfa`: تحقق من رمز TOTP ومدته 5 دقائق.
 * `mfa_enroll`: تسجيل أول مرة (QR + تأكيد) ومدته 15 دقيقة.
 * التذكرة لا تفتح أي مسار آخر: jwtAuth يرفض أي توكن غرضه ليس access.
 */
const MFA_TICKET_TTL = { mfa: '5m', mfa_enroll: '15m' };
function signMfaTicket(user, purpose) {
    const ttl = MFA_TICKET_TTL[purpose];
    if (!ttl) {throw new Error('INVALID_MFA_PURPOSE');}
    return jwt.sign(
        {
            sub: String(user.id),
            role: user.role,
            name: user.name,
            dept_code: user.dept_code || null,
            branch_id: user.branch_id ?? null,
            purpose,
        },
        ACCESS_SECRET,
        { expiresIn: ttl, algorithm: 'HS256', jwtid: crypto.randomBytes(9).toString('hex') }
    );
}

function verifyMfaTicket(token, allowedPurposes = ['mfa', 'mfa_enroll']) {
    const payload = jwt.verify(token, ACCESS_SECRET, { algorithms: ['HS256'] });
    if (!allowedPurposes.includes(payload.purpose)) {throw new Error('WRONG_TICKET_PURPOSE');}
    return payload;
}

async function issueRefreshToken(user, ctx = {}) {
    const raw = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000);

    const client = await pool.connect();
    try {
        await client.query(
            `INSERT INTO pos_refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at)
             VALUES ($1, $2, $3, $4, $5);`,
            [user.id, tokenHash, JSON.stringify(ctx.deviceInfo || {}), ctx.ip || null, expiresAt]
        );
    } finally {
        client.release();
    }
    return raw;
}

function verifyAccessToken(token) {
    return jwt.verify(token, ACCESS_SECRET, { algorithms: ['HS256'] });
}

// ─── Security audit 2026-09-03: فحص التسجيل النشط ────────────────────────────
// JWT لا يعرف إبطال ما بعد الإصدار: مستخدم أُوقف (active=false) كان يبقى
// قادراً على استعمال توكنه حتى 24 ساعة. نضيف فحصاً سريعاً لحالة الحساب مع
// ذاكرة مؤقتة قصيرة (60 ثانية افتراضياً) حتى لا نضيف استعلاماً لكل طلب.
// يُفعّل في الإنتاج فقط حتى لا تتعثر اختبارات الوحدة التي توقّع توكنات اصطناعية.
const ACTIVE_CHECK_ENABLED = process.env.NODE_ENV === 'production' && process.env.JWT_CHECK_ACTIVE !== 'false';
const ACTIVE_CACHE_TTL_MS = Math.max(1000, parseInt(process.env.JWT_ACTIVE_CACHE_MS || '120000', 10) || 120000);
const activeStatusCache = new Map(); // userId -> { active, expiresAt }

async function isUserActive(userId) {
    const cached = activeStatusCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {return cached.active;}
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT active FROM users WHERE id = $1 LIMIT 1', [userId]);
        const active = Boolean(result.rows[0]?.active);
        activeStatusCache.set(userId, { active, expiresAt: Date.now() + ACTIVE_CACHE_TTL_MS });
        return active;
    } finally {
        client.release();
    }
}

function invalidateActiveCache(userId) {
    if (userId == null) {activeStatusCache.clear();}
    else {activeStatusCache.delete(userId);}
}

// المسارات الوحيدة المتاحة لحساب مُلزم بتغيير كلمة المرور قبل اكتمال التدوير.
const ROTATION_ALLOWED_PATHS = new Set(['/api/auth/change-password', '/api/auth/refresh', '/api/auth/logout']);

/**
 * Login endpoint: validates credentials and issues both tokens.
 *   POST /api/auth/login  body: { username, password }
 *
 * SECURITY: This function NEVER compares plaintext passwords. If a user's
 * stored password is not bcrypt-hashed, login is rejected with
 * PASSWORD_MIGRATION_REQUIRED and the admin is instructed to run the
 * migration script.
 */
// ─── R18 (Enterprise 2026-10-03): قفل تدريجي للحساب عند التخمين ──────────
// كان الاعتماد على حد المعدل فقط (20 محاولة/15د لكل حساب+IP). الآن: 5 فشلات
// خلال 15 دقيقة على (IP+اسم المستخدم) → قفل 15 دقيقة برسالة صريحة. النجاح
// يصفّر العداد. في الذاكرة (يتصفّر بإعادة التشغيل) — نفس نمط محدد المعدل.
const LOGIN_LOCKOUT = { MAX_FAILS: 5, WINDOW_MS: 15 * 60 * 1000, LOCK_MS: 15 * 60 * 1000 };
const _loginFails = new Map();
function loginLockKey(req, username) {
    return `${req.ip || 'ip'}:${String(username || '').toLowerCase().slice(0, 64)}`;
}
function loginLockState(req, username) {
    const k = loginLockKey(req, username);
    const e = _loginFails.get(k);
    if (!e) {return { locked: false, k }; }
    if (e.lockUntil && Date.now() < e.lockUntil) {
        return { locked: true, k, retryAfter: Math.ceil((e.lockUntil - Date.now()) / 1000) };
    }
    if (e.firstAt && Date.now() - e.firstAt > LOGIN_LOCKOUT.WINDOW_MS) {_loginFails.delete(k);}
    return { locked: false, k };
}
function recordLoginFail(req, username) {
    const k = loginLockKey(req, username);
    const now = Date.now();
    const e = _loginFails.get(k) || { count: 0, firstAt: now, lockUntil: 0 };
    if (now - e.firstAt > LOGIN_LOCKOUT.WINDOW_MS) {e.count = 0; e.firstAt = now;}
    e.count++;
    if (e.count >= LOGIN_LOCKOUT.MAX_FAILS) {e.lockUntil = now + LOGIN_LOCKOUT.LOCK_MS;}
    _loginFails.set(k, e);
    if (_loginFails.size > 10000) {
        for (const [kk, v] of _loginFails) {
            if (v.firstAt < now - LOGIN_LOCKOUT.WINDOW_MS && !(v.lockUntil > now)) {_loginFails.delete(kk);}
        }
    }
}

function publicUserOf(user) {
    return { id: user.id, name: user.name, role: user.role, username: user.username, dept_code: user.dept_code || null };
}

/**
 * بوابة المصادقة الثنائية بعد التحقق من كلمة المرور. تعيد null عندما لا
 * يُشترط عامل ثانٍ، أو ردًّا جاهزًا (تذكرة تحقق/تسجيل) بدل الجلسة.
 * تُستدعى أيضًا بعد تدوير كلمة المرور الأولية: حساب مُلزم بالتدوير كان
 * سيتجاوز التسجيل ويهبط بجلسة كاملة (ثغرة حقيقية أُغلقت قبل شحنها).
 */
async function mfaGatePayload(user) {
    let state;
    try {
        state = await loadMfaState(user.id);
    } catch (err) {
        const wrapped = new Error('MFA_STATE_UNAVAILABLE');
        wrapped.cause = err;
        throw wrapped;
    }
    if (state && state.confirmedAt && state.secret) {
        return {
            mfa_required: true,
            mfa_token: signMfaTicket(user, 'mfa'),
            user: publicUserOf(user),
            message: 'أدخل رمز المصادقة الثنائية من تطبيق المصادقة.',
        };
    }
    if (mfaRequiredFor(user.role)) {
        return {
            mfa_enrollment_required: true,
            mfa_token: signMfaTicket(user, 'mfa_enroll'),
            user: publicUserOf(user),
            message: 'هذا الحساب الإداري يتطلب مصادقة ثنائية — امسح رمز QR وأدخل الرمز لإكمال الدخول.',
        };
    }
    return null;
}

async function loginHandler(req, res) {
    const { username, password } = req.body || {};
    if (!username || !password) {
        return res.status(400).json({ error: 'MISSING_CREDENTIALS' });
    }

    // R18: حساب مقفل؟ (قبل أي استعلام — لا إجابة حتى عن وجود الحساب)
    const lock = loginLockState(req, username);
    if (lock.locked) {
        logger.warn({ username: String(username).slice(0, 64), ip: req.ip }, '[auth] login attempt on LOCKED account');
        return res.status(423).json({ error: 'ACCOUNT_LOCKED', message: `الحساب مقفل مؤقتًا بسبب محاولات دخول فاشلة متكررة — أعد المحاولة بعد ${lock.retryAfter} ثانية`, retryAfter: lock.retryAfter });
    }

    const client = await pool.connect();
    try {
        await ensureUserSecurityColumns(client);
        const r = await client.query(
            `SELECT id, username, password, role, name, active, must_change_password, dept_code, branch_id FROM users WHERE LOWER(username) = LOWER($1);`,
            [username]
        );
        if (r.rows.length === 0 || !r.rows[0].active) {
            recordLoginFail(req, username);
            return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
        }
        const user = r.rows[0];
        const publicUser = () => publicUserOf(user);

        // ─── ENFORCE bcrypt-only ───────────────────────────────────
        // No plaintext comparison. No transparent migration. If the stored
        // password is not bcrypt, the admin must run the migration script.
        if (!BCRYPT_REGEX.test(user.password)) {
            logger.warn({ userId: user.id, username: user.username },
                '[auth] Login rejected: password is not bcrypt-hashed. Run scripts/migrate-plaintext-passwords.js');
            return res.status(401).json({
                error: 'PASSWORD_MIGRATION_REQUIRED',
                message: 'كلمة المرور تحتاج إلى ترحيل أمني إلى bcrypt. شغّل ترحيل كلمات المرور أو تواصل مع مسؤول النظام.',
            });
        }

        // Standard bcrypt compare — the ONLY password verification path
        let ok = false;
        try {
            ok = await bcrypt.compare(password, user.password);
        } catch (bcryptErr) {
            logger.error('[auth] bcrypt.compare failed:', bcryptErr);
            return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'bcrypt comparison failed', detail: bcryptErr?.message || String(bcryptErr) });
        }
        if (!ok) {
            recordLoginFail(req, username);
            return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
        }
        _loginFails.delete(loginLockKey(req, username)); // R18: نجاح = صفير العداد

        const access = signAccessToken(user);
        if (user.must_change_password) {
            logger.info({ userId: user.id, username: user.username }, '[auth] Password rotation required before access is granted');
            return res.json({
                error: 'PASSWORD_CHANGE_REQUIRED',
                message: 'يجب تغيير كلمة المرور الأولية قبل استخدام النظام.',
                access_token: access,
                password_change_required: true,
                app_key: process.env.API_KEY || null,
                user: publicUser(),
            });
        }

        // ─── المصادقة الثنائية (TOTP) ─────────────────────────────────────
        // الحساب المؤكَّد لا يحصل على أي رمز قبل الرمز الثاني. والحساب
        // الإداري غير المسجَّل يُوجَّه للتسجيل قبل إصدار الجلسة — لا قفل:
        // كلمة المرور الصحيحة + تطبيق المصادقة يكفيان لإكمال الدخول.
        let gate;
        try {
            gate = await mfaGatePayload(user);
        } catch (mfaErr) {
            logger.error({ userId: user.id, err: mfaErr.cause?.message || mfaErr.message }, '[auth] MFA state read failed — refusing login');
            return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر قراءة حالة المصادقة الثنائية — حاول مجددًا.' });
        }
        if (gate) {
            logger.info({ userId: user.id, username: user.username, enrollment: Boolean(gate.mfa_enrollment_required) },
                '[auth] Password verified — second factor required');
            return res.json(gate);
        }

        const refresh = await issueRefreshToken(user, {
            deviceInfo: { ua: req.headers['user-agent'] },
            ip: req.ip,
        });

        // Update last_login
        await client.query(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1;`, [user.id])
            .catch(() => {/* column may not exist on legacy schema */});

        logger.info({ userId: user.id, username: user.username, role: user.role },
            '[auth] Login successful');

        res.json({
            access_token: access,
            refresh_token: refresh,
            token_type: 'Bearer',
            expires_in: 86400,        // 24 hours
            app_key: process.env.API_KEY || null,
            user: publicUser(),
        });
} catch (err) {
        logger.error('[auth] login handler error:', err);
        if (!res.headersSent) {res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر تسجيل الدخول — حاول مرة أخرى', detail: err?.message || String(err) });}
    } finally {
        client.release();
    }
}

async function changePasswordHandler(req, res) {
    const { current_password: currentPassword, new_password: newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {return res.status(400).json({ error: 'MISSING_PASSWORDS', message: 'أدخل كلمة المرور الحالية والجديدة.' });}
    if (!isStrongPassword(newPassword)) {
        return res.status(422).json({
            error: 'WEAK_PASSWORD',
            message: 'يجب أن تتكون كلمة المرور من 12 حرفًا على الأقل وتحتوي حروفًا وأرقامًا.',
        });
    }
    if (currentPassword === newPassword) {
        return res.status(422).json({ error: 'PASSWORD_REUSED', message: 'اختر كلمة مرور جديدة مختلفة عن الحالية.' });
    }

    const client = await pool.connect();
    try {
        await ensureUserSecurityColumns(client);
        const result = await client.query(
            `SELECT id, username, password, role, name, active, must_change_password, dept_code, branch_id FROM users WHERE id = $1 FOR UPDATE;`,
            [req.user.id]
        );
        const user = result.rows[0];
        if (!user || !user.active || !BCRYPT_REGEX.test(user.password)) {return res.status(401).json({ error: 'INVALID_CREDENTIALS' });}
        if (!await bcrypt.compare(currentPassword, user.password)) {return res.status(401).json({ error: 'INVALID_CREDENTIALS' });}

        const wasRestricted = Boolean(user.must_change_password);
        const hash = await bcrypt.hash(newPassword, 12);
        await client.query(
            `UPDATE users SET password = $1, must_change_password = FALSE, password_migrated_at = CURRENT_TIMESTAMP WHERE id = $2;`,
            [hash, user.id]
        );
        // خزنة كلمات المرور: حدّث النسخة القابلة للاسترجاع (قرار المالك — أدمن فقط يقرأها)
        const _vault = encryptForVault(newPassword);
        if (_vault) { await client.query(`UPDATE users SET password_vault = $1 WHERE id = $2;`, [_vault, user.id]); }
        await client.query(`DELETE FROM pos_refresh_tokens WHERE user_id = $1;`, [user.id]).catch(() => {});
        const rotatedUser = { ...user, must_change_password: false };
        // من كان مقيّدًا بتدوير كلمة المرور لا يهبط بجلسة كاملة مباشرة:
        // نفس بوابة الدخول تُطبَّق كي لا يكون التدوير طريقًا لتجاوز MFA.
        if (wasRestricted) {
            let gate;
            try {
                gate = await mfaGatePayload(rotatedUser);
            } catch (mfaErr) {
                logger.error({ userId: user.id, err: mfaErr.cause?.message || mfaErr.message }, '[auth] MFA state read failed after rotation');
                return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تم تغيير كلمة المرور — أعد تسجيل الدخول لإكمال المصادقة.' });
            }
            if (gate) {
                logger.info({ userId: user.id, enrollment: Boolean(gate.mfa_enrollment_required) },
                    '[auth] Password rotated — second factor required before session');
                return res.json({
                    ...gate,
                    password_change_required: false,
                    message: 'تم تغيير كلمة المرور — أكمل المصادقة الثنائية من شاشة الدخول الحديثة.',
                });
            }
        }
        const access = signAccessToken(rotatedUser);
        const refresh = await issueRefreshToken(rotatedUser, { deviceInfo: { ua: req.headers['user-agent'] }, ip: req.ip });
        logger.info({ userId: user.id, username: user.username }, '[auth] Password changed successfully');
        return res.json({
            access_token: access,
            refresh_token: refresh,
            token_type: 'Bearer',
            expires_in: 86400,
            app_key: process.env.API_KEY || null,
            password_change_required: false,
            user: { id: user.id, name: user.name, role: user.role, username: user.username, dept_code: user.dept_code || null },
        });
    } catch (err) {
        logger.error('[auth] change-password failed:', err.message);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر تغيير كلمة المرور — حاول مرة أخرى' });
    } finally {
        client.release();
    }
}

/**
 * Express middleware: extract Bearer, verify, inject req.user.
 * Security audit 2026-09-03: يمنع حساب must_change_password من كل المسارات
 * عدا مسار تدوير كلمة المرور، ويرفض توكنات المستخدمين المُوقفين (فحص نشط
 * مُخبّأ في الإنتاج).
 */
function jwtAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing Bearer token.' });}
    let payload;
    try {
        payload = verifyAccessToken(match[1]);
    } catch (err) {
        const expired = err.name === 'TokenExpiredError';
        return res.status(401).json({
            error: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
            message: err.message,
        });
    }
    // تذاكر MFA غرضها مختلف ولا تصلح لجلسة: حتى لو سُرّبت، لا تفتح شيئًا
    // خارج مسارَي التسجيل/التحقق. التوكنات القديمة (بلا purpose) تبقى صالحة.
    if (payload.purpose && payload.purpose !== 'access') {
        return res.status(401).json({ error: 'TOKEN_INVALID', message: 'MFA ticket is not a session token.' });
    }
    req.user = {
        id: parseInt(payload.sub, 10),
        role: payload.role,
        name: payload.name,
        dept_code: payload.dept_code || null,
        branch_id: payload.branch_id ?? null,
        session_id: payload.sid || null,
        must_change_password: Boolean(payload.pwd_change),
    };

    // Enterprise: push identity into AsyncLocalStorage so every DB query,
    // log line, external HTTP call, and audit event deep in the stack
    // is automatically tagged with this user (no manual threading).
    updateUserContext({ id: req.user.id, role: req.user.role });

    // حساب لم يُكمل تدوير كلمة المرور الأولية: لا صلاحية لأي مسار عملي
    if (req.user.must_change_password && !ROTATION_ALLOWED_PATHS.has(req.path)) {
        return res.status(403).json({
            error: 'PASSWORD_CHANGE_REQUIRED',
            message: 'يجب تغيير كلمة المرور الأولية قبل استخدام النظام.',
        });
    }

    if (!ACTIVE_CHECK_ENABLED) {return next();}
    isUserActive(req.user.id)
        .then((active) => {
            if (!active) {
                return res.status(401).json({ error: 'ACCOUNT_DISABLED', message: 'تم إيقاف هذا الحساب — تواصل مع المسؤول.' });
            }
            return next();
        })
        .catch((err) => {
            // Fail-open under DB pressure: if we can't check the active status,
            // allow the request through (the JWT is still valid). Returning 503
            // here caused cascading failures under load — every authenticated
            // request failed when the pool was saturated.
            logger.warn('[auth] active-check failed (fail-open):', err.message);
            return next();
        });
}

/**
 * Security audit 2026-09-03: تدوير رمز التحديث.
 * POST /api/auth/refresh  body: { refresh_token }
 * يتحقق من الوجود وعدم الانتهاء، يرفض المستخدمين المُوقفين، يدوّر الرمز
 * (القديم يُحذف ويُصدر بديل) ويُصدر access token جديداً. الرموز مخزنة
 * مجزأة SHA-256 ولا تُخزن خاماً أبداً.
 */
async function refreshHandler(req, res) {
    const raw = String(req.body?.refresh_token || '').trim();
    if (!raw) {return res.status(400).json({ error: 'MISSING_REFRESH_TOKEN', message: 'رمز التحديث مطلوب.' });}
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');

    const client = await pool.connect();
    try {
        // 102_branches: الاستعلام يقرأ u.branch_id — نفس حماية مساري الدخول
        // (DDL مرة واحدة لكل عملية). بدونها: قاعدة لم تترحّل بعد + refresh
        // قبل أي login = 500 (كشفها tests/security-rbac-hardening 2026-10-13).
        await ensureUserSecurityColumns(client);
        const row = (await client.query(
            `SELECT rt.id, rt.user_id, rt.expires_at, u.id AS live_user_id, u.active, u.role, u.name, u.username,
                    u.must_change_password, u.dept_code, u.branch_id
               FROM pos_refresh_tokens rt
               JOIN users u ON u.id = rt.user_id
              WHERE rt.token_hash = $1
              LIMIT 1
              FOR UPDATE OF rt;`,
            [tokenHash]
        )).rows[0];
        if (!row) {return res.status(401).json({ error: 'REFRESH_TOKEN_INVALID', message: 'رمز التحديث غير صالح.' });}
        if (new Date(row.expires_at).getTime() <= Date.now()) {
            await client.query('DELETE FROM pos_refresh_tokens WHERE id = $1;', [row.id]);
            return res.status(401).json({ error: 'REFRESH_TOKEN_EXPIRED', message: 'انتهت صلاحية الجلسة — سجّل الدخول من جديد.' });
        }
        if (!row.active) {
            await client.query('DELETE FROM pos_refresh_tokens WHERE user_id = $1;', [row.user_id]);
            invalidateActiveCache(row.user_id);
            return res.status(401).json({ error: 'ACCOUNT_DISABLED', message: 'تم إيقاف هذا الحساب — تواصل مع المسؤول.' });
        }

        // Rotation: consume the presented token, issue a fresh pair.
        await client.query('BEGIN');
        // FIX 2026-10-11: verify DELETE actually removed the row (rotation race guard)
        const delResult = await client.query('DELETE FROM pos_refresh_tokens WHERE id = $1;', [row.id]);
        if (delResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(401).json({ error: 'REFRESH_TOKEN_INVALID', message: 'رمز التحديث مستخدم بالفعل.' });
        }
        const nextRaw = crypto.randomBytes(48).toString('hex');
        const nextHash = crypto.createHash('sha256').update(nextRaw).digest('hex');
        const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000);
        await client.query(
            `INSERT INTO pos_refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at)
             VALUES ($1, $2, $3, $4, $5);`,
            [row.user_id, nextHash, JSON.stringify({ ua: req.headers['user-agent'], rotated: true }), req.ip || null, expiresAt]
        );
        await client.query('COMMIT');

        const access = signAccessToken({
            id: row.user_id, role: row.role, name: row.name,
            dept_code: row.dept_code, must_change_password: row.must_change_password,
            branch_id: row.branch_id,
        });
        logger.info({ userId: row.user_id, username: row.username }, '[auth] refresh token rotated');
        return res.json({
            access_token: access,
            refresh_token: nextRaw,
            token_type: 'Bearer',
            expires_in: 86400,
            app_key: process.env.API_KEY || null,
            password_change_required: Boolean(row.must_change_password),
            user: { id: row.user_id, name: row.name, role: row.role, username: row.username, dept_code: row.dept_code || null },
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[auth] refresh failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر تجديد الجلسة — حاول مجدداً.' });
    } finally {
        client.release();
    }
}

/**
 * Security audit 2026-09-03: تسجيل الخروج بإبطال رموز التحديث.
 * POST /api/auth/logout — يحذف كل رموز تحديث المستخدم (كل الأجهزة)؛
 * access token الحالي يبقى صالحاً حتى انتهائه الطبيعي (حد أقصى 24 ساعة)
 * لكنه يفقد قيمته فور إيقاف الحساب بفضل الفحص النشط.
 */
async function logoutHandler(req, res) {
    const client = await pool.connect();
    try {
        const deleted = await client.query('DELETE FROM pos_refresh_tokens WHERE user_id = $1;', [req.user.id]);
        logger.info({ userId: req.user.id, revoked: deleted.rowCount }, '[auth] logout — refresh tokens revoked');
        return res.json({ ok: true, revoked: deleted.rowCount, message: 'تم تسجيل الخروج وإبطال جلسات التجديد.' });
    } catch (err) {
        logger.error('[auth] logout failed:', err.message);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر تسجيل الخروج — حاول مجدداً.' });
    } finally {
        client.release();
    }
}

function requireRole(...allowedRoles) {
    const set = new Set(allowedRoles);
    return (req, res, next) => {
        if (!req.user) {return res.status(401).json({ error: 'UNAUTHORIZED' });}
        if (req.user.must_change_password) {
            return res.status(403).json({
                error: 'PASSWORD_CHANGE_REQUIRED',
                message: 'يجب تغيير كلمة المرور قبل تنفيذ أي عملية في النظام.',
            });
        }
        if (!set.has(req.user.role)) {
            return res.status(403).json({
                error: 'FORBIDDEN',
                message: `Role '${req.user.role}' not permitted. Required: ${[...set].join(' | ')}.`,
            });
        }
        return next();
    };
}

module.exports = {
    jwtAuth, requireRole, loginHandler, changePasswordHandler,
    refreshHandler, logoutHandler,
    signAccessToken, issueRefreshToken, verifyAccessToken,
    signMfaTicket, verifyMfaTicket, mfaGatePayload, publicUserOf, MFA_TICKET_TTL,
    isUserActive, invalidateActiveCache,
    isStrongPassword,
    ACCESS_TTL, REFRESH_TTL_DAYS,
};
