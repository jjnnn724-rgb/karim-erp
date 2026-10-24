'use strict';

/**
 * mfa-store.js — تخزين أسرار TOTP وحالتها.
 * ────────────────────────────────────────────────────────────────────────────
 * السر لا يُخزَّن كنص: يُشفَّر AES-256-GCM عبر password-vault (VAULT_KEY
 * أولاً ثم JWT_ACCESS_SECRET التراثي). رمز الاسترداد يُخزَّن SHA-256 مع
 * معرّف المستخدم كملح، ويُحذف فور استعماله.
 *
 * الجدول يُنشأ عند أول استعمال (نفس نمط ensureUserSecurityColumns) كي لا
 * ينكسر تسجيل الدخول على قاعدة لم تُطبَّق عليها الترحيلات بعد.
 */

const { pool } = require('./db-pool');
const { encryptForVault, decryptFromVault } = require('../password-vault');
const { logger } = require('../logger');
const { hashRecoveryCode } = require('../totp');

let _schemaReady = false;
async function ensureMfaSchema() {
    if (_schemaReady) {return;}
    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_mfa (
            user_id             BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            secret_enc          TEXT,
            pending_secret_enc  TEXT,
            pending_created_at  TIMESTAMPTZ,
            confirmed_at        TIMESTAMPTZ,
            last_used_step      BIGINT,
            recovery_codes      TEXT,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_user_mfa_confirmed ON user_mfa (confirmed_at);');
    // قواعد أُنشئت بالشكل الأول (سر واحد) تُرقّى في المكان.
    await pool.query('ALTER TABLE user_mfa ADD COLUMN IF NOT EXISTS pending_secret_enc TEXT;');
    await pool.query('ALTER TABLE user_mfa ADD COLUMN IF NOT EXISTS pending_created_at TIMESTAMPTZ;');
    await pool.query('ALTER TABLE user_mfa ALTER COLUMN secret_enc DROP NOT NULL;');
    _schemaReady = true;
}

function encryptSecret(secret) {
    const enc = encryptForVault(secret);
    if (!enc) {
        const err = new Error('MFA_KEY_NOT_CONFIGURED');
        err.code = 'MFA_KEY_NOT_CONFIGURED';
        throw err;
    }
    return enc;
}

function decryptSecret(enc) {
    return decryptFromVault(enc);
}

/** @returns {{secret:string|null, pendingSecret:string|null, confirmedAt:string|null, lastUsedStep:number|null, recoveryHashes:string[]}|null} */
async function loadState(userId) {
    await ensureMfaSchema();
    const r = await pool.query(
        `SELECT secret_enc, pending_secret_enc, confirmed_at, last_used_step, recovery_codes
           FROM user_mfa WHERE user_id = $1 LIMIT 1;`,
        [userId]
    );
    const row = r.rows[0];
    if (!row) {return null;}
    let hashes = [];
    try { hashes = JSON.parse(row.recovery_codes || '[]'); } catch { /* صفٌّ قديم تالف — لا رموز استرداد */ }
    return {
        secret: row.secret_enc ? decryptSecret(row.secret_enc) : null,
        pendingSecret: row.pending_secret_enc ? decryptSecret(row.pending_secret_enc) : null,
        confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
        lastUsedStep: row.last_used_step == null ? null : Number(row.last_used_step),
        recoveryHashes: Array.isArray(hashes) ? hashes : [],
    };
}

async function isConfirmed(userId) {
    const state = await loadState(userId);
    return Boolean(state && state.confirmedAt && state.secret);
}

/** يبدأ تسجيلًا جديدًا في عمود الانتظار. السر المؤكَّد الحالي يبقى عاملًا. */
async function savePending(userId, secret) {
    await ensureMfaSchema();
    const enc = encryptSecret(secret);
    await pool.query(
        `INSERT INTO user_mfa (user_id, pending_secret_enc, pending_created_at, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE
           SET pending_secret_enc = EXCLUDED.pending_secret_enc,
               pending_created_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP;`,
        [userId, enc]
    );
}

/**
 * يثبّت السر المنتظر كسر عامل. يعيد false إذا لم يكن هناك تسجيل منتظر
 * (سباق تأكيد مزدوج أو طلب قديم). يُحتفظ بالخطوة المستهلكة لمنع إعادة
 * استعمال نفس الرمز فورًا بعد التأكيد.
 */
async function confirm(userId, step, recoveryCodes) {
    await ensureMfaSchema();
    const hashes = recoveryCodes.map((c) => hashRecoveryCode(c, userId));
    const r = await pool.query(
        `UPDATE user_mfa
            SET secret_enc = pending_secret_enc,
                pending_secret_enc = NULL,
                pending_created_at = NULL,
                confirmed_at = CURRENT_TIMESTAMP,
                last_used_step = $2,
                recovery_codes = $3,
                updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $1 AND pending_secret_enc IS NOT NULL;`,
        [userId, step, JSON.stringify(hashes)]
    );
    return r.rowCount === 1;
}

/**
 * يثبّت آخر خطوة زمنية مستهلكة. يعيد false إذا كانت الخطوة مستعملة —
 * وهذا هو حارس منع إعادة استعمال الرمز داخل نافذة الثلاثين ثانية.
 */
async function consumeStep(userId, step) {
    const r = await pool.query(
        `UPDATE user_mfa
            SET last_used_step = $2, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $1
            AND (last_used_step IS NULL OR last_used_step < $2);`,
        [userId, step]
    );
    return r.rowCount === 1;
}

/** يستهلك رمز استرداد واحدًا (مرة واحدة فقط). */
async function consumeRecovery(userId, code) {
    const state = await loadState(userId);
    if (!state) {return false;}
    const hash = hashRecoveryCode(code, userId);
    if (!state.recoveryHashes.includes(hash)) {return false;}
    const remaining = state.recoveryHashes.filter((h) => h !== hash);
    const r = await pool.query(
        `UPDATE user_mfa SET recovery_codes = $2, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $1 AND recovery_codes = $3;`,
        [userId, JSON.stringify(remaining), JSON.stringify(state.recoveryHashes)]
    );
    if (r.rowCount !== 1) {return false;} // سباق: استُهلك من طلب آخر
    return true;
}

async function replaceRecoveryCodes(userId, codes) {
    const hashes = codes.map((c) => hashRecoveryCode(c, userId));
    await pool.query(
        `UPDATE user_mfa SET recovery_codes = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1;`,
        [userId, JSON.stringify(hashes)]
    );
}

async function remove(userId) {
    await ensureMfaSchema();
    await pool.query('DELETE FROM user_mfa WHERE user_id = $1;', [userId]);
}

// ─── السياسة ────────────────────────────────────────────────────────────────
// الافتراضي: إلزام في الإنتاج فقط، للأدوار owner/admin. الاختبارات والتطوير
// لا تُقفل عليهما الحسابات. `MFA_ENFORCE=0` مخرج طوارئ موثّق.
const _enforceRaw = process.env.MFA_ENFORCE;
const MFA_ENFORCE = _enforceRaw == null
    ? process.env.NODE_ENV === 'production'
    : !/^(0|false|off|no)$/i.test(String(_enforceRaw).trim());
const MFA_REQUIRED_ROLES = new Set(
    String(process.env.MFA_REQUIRED_ROLES || 'owner,admin')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
);

function mfaRequiredFor(role) {
    return MFA_ENFORCE && MFA_REQUIRED_ROLES.has(String(role || '').toLowerCase());
}

module.exports = {
    ensureMfaSchema,
    loadState,
    isConfirmed,
    savePending,
    confirm,
    consumeStep,
    consumeRecovery,
    replaceRecoveryCodes,
    remove,
    mfaRequiredFor,
    encryptSecret,
    decryptSecret,
    MFA_ENFORCE,
    MFA_REQUIRED_ROLES,
    _logger: logger,
};
