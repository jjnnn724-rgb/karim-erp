'use strict';

/**
 * password-vault.js — خزنة كلمات المرور القابلة للاسترجاع (قراءة: أدمن فقط).
 * ────────────────────────────────────────────────────────────────────────────
 * القرار المطلوب من المالك: إمكانية «رؤية» كلمة مرور أي مستخدم من صفحة
 * المستخدمين (لمساعدة موظف نسي كلمته). bcrypt يبقى هو أداة التحقق من الدخول
 * ولم يُمس — هذه نسخة إضافية اختيارية تُكتب مع كل تعيين كلمة مرور:
 *   • AES-256-GCM بمفتاح مشتق من JWT_SECRET (سري بالفعل في .env خارج Git)
 *   • تُخزن في عمود users.password_vault — لا تُرجع في أي استجابة API عامة
 *   • لو تغيّر JWT_SECRET تصبح النسخ القديمة غير قابلة للفك (fail-safe)
 *
 * @module password-vault
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pool } = require('./shared-pool');
const { logger } = require('./logger');

const VAULT_PREFIX = 'v1:';

// FIX 2026-10-11 (C2): vault key now prefers dedicated VAULT_KEY env var.
// Falls back to legacy sha256 derivation for backward compatibility with
// existing encrypted passwords. Set VAULT_KEY in .env for full separation.
let _vaultKeyCache = null;
let _vaultKeySource = null;

/** مفتاح التشفير — VAULT_KEY أولاً، وإلا التراثي (للتوافق مع البيانات القديمة). */
function vaultKey() {
    if (_vaultKeyCache !== null) {return _vaultKeyCache;}
    // 1. Dedicated VAULT_KEY (الأفضل — فصل كامل عن مفتاح التوقيع)
    const dedicated = String(process.env.VAULT_KEY || '');
    if (dedicated.length >= 32) {
        _vaultKeyCache = crypto.createHash('sha256').update(dedicated + '|karim-pw-vault|v1').digest();
        _vaultKeySource = 'VAULT_KEY';
        return _vaultKeyCache;
    }
    // 2. Legacy fallback: sha256 من JWT secret (نفس المشتق القديم — للتوافق)
    const secret = String(process.env.JWT_ACCESS_SECRET || process.env.JWT_REFRESH_SECRET
        || process.env.JWT_SECRET || process.env.EMPLOYEE_QR_SECRET || '');
    if (secret.length < 16) {return null;}
    _vaultKeyCache = crypto.createHash('sha256').update(secret + '|karim-pw-vault|v1').digest();
    _vaultKeySource = 'JWT-derived (legacy)';
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

/** هجرة إضافية: عمود الخزنة. */
function ensurePasswordVaultSchema() {
    const file = path.join(__dirname, '..', 'database', 'migrations', '083_password_vault.sql');
    return (async () => {
        if (fs.existsSync(file)) {await pool.query(fs.readFileSync(file, 'utf-8'));}
        // C2: warn if VAULT_KEY not set
        if (!process.env.VAULT_KEY) {
            logger.warn('[PW_VAULT] VAULT_KEY env var not set — using JWT-derived key (legacy). Set VAULT_KEY in .env for full key separation.');
        }
        logger.info('[PW_VAULT] ready (users.password_vault)');
    })().catch((e) => { logger.error('[PW_VAULT] init skipped:', e.message); });
}

module.exports = { encryptForVault, decryptFromVault, ensurePasswordVaultSchema };
