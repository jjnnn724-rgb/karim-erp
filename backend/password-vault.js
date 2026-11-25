'use strict';

/**
 * password-vault.js — خزنة كلمات المرور القابلة للاسترجاع (قراءة: أدمن فقط).
 * ────────────────────────────────────────────────────────────────────────────
 * القرار المطلوب من المالك: إمكانية «رؤية» كلمة مرور أي مستخدم من صفحة
 * المستخدمين (لمساعدة موظف نسي كلمته). bcrypt يبقى هو أداة التحقق من الدخول
 * ولم يُمس — هذه نسخة إضافية اختيارية تُكتب مع كل تعيين كلمة مرور:
 *   • AES-256-GCM بمفتاح مشتق من VAULT_KEY (إلزامي — لا مشتق من أسرار JWT)
 *   • تُخزن في عمود users.password_vault — لا تُرجع في أي استجابة API عامة
 *   • لو تغيّر VAULT_KEY تصبح النسخ القديمة غير قابلة للفك (fail-safe)
 *
 * @module password-vault
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pool } = require('./shared-pool');
const { logger } = require('./logger');

const VAULT_PREFIX = 'v1:';

// VAULT_KEY is mandatory: the vault must never derive its key from JWT secrets.
// Missing/short key => no encryption/decryption (fail closed) + hard error at init.
let _vaultKeyCache = null;

/** مفتاح التشفير — VAULT_KEY فقط (بدون أي تراجع إلى أسرار JWT). */
function vaultKey() {
    if (_vaultKeyCache !== null) {return _vaultKeyCache;}
    const dedicated = String(process.env.VAULT_KEY || '');
    if (dedicated.length < 32) {return null;}
    _vaultKeyCache = crypto.createHash('sha256').update(dedicated + '|karim-pw-vault|v1').digest();
    return _vaultKeyCache;
}

/**
 * تشفير كلمة مرور للخزنة. يرجع null لو لا يوجد مفتاح صالح أو قيمة فارغة.
 * @param {string} plaintext
 * @returns {string|null} 'v1:iv:tag:ciphertext' (base64)
 */
function encryptForVault(plaintext) {
    const key = vaultKey();
    if (!key || typeof plaintext !== 'string' || !plaintext) {return null;}
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return VAULT_PREFIX + iv.toString('base64') + ':' + tag.toString('base64') + ':' + ct.toString('base64');
    } catch (e) {
        logger.warn('[pw-vault] encrypt failed:', e.message);
        return null;
    }
}

/**
 * فك نسخة الخزنة. يرجع null عند أي فشل (سر متغير / بيانات تالفة / غير موجودة).
 * @param {string|null} stored
 * @returns {string|null}
 */
function decryptFromVault(stored) {
    const key = vaultKey();
    if (!key || typeof stored !== 'string' || !stored.startsWith(VAULT_PREFIX)) {return null;}
    try {
        const parts = stored.slice(VAULT_PREFIX.length).split(':');
        if (parts.length !== 3) {return null;}
        const iv = Buffer.from(parts[0], 'base64');
        const tag = Buffer.from(parts[1], 'base64');
        const ct = Buffer.from(parts[2], 'base64');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } catch (_) {
        return null;
    }
}

/** هجرة إضافية: عمود الخزنة. يفشل فورًا لو VAULT_KEY غير موجود. */
function ensurePasswordVaultSchema() {
    // Fail closed at init: a dedicated VAULT_KEY is required. No JWT fallback.
    if (!vaultKey()) {
        throw new Error('VAULT_KEY is required for the password vault (at least 32 characters). Set it in .env; deriving the vault key from JWT secrets is no longer supported.');
    }
    const file = path.join(__dirname, '..', 'database', 'migrations', '083_password_vault.sql');
    return (async () => {
        if (fs.existsSync(file)) {await pool.query(fs.readFileSync(file, 'utf-8'));}
        logger.info('[PW_VAULT] ready (users.password_vault)');
    })().catch((e) => { logger.error('[PW_VAULT] init skipped:', e.message); });
}

module.exports = { encryptForVault, decryptFromVault, ensurePasswordVaultSchema };
