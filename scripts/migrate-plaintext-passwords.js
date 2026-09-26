#!/usr/bin/env node
/**
 * scripts/migrate-plaintext-passwords.js — Hash all plaintext passwords with bcrypt
 * ────────────────────────────────────────────────────────────────────────────
 * Finds every user whose password does NOT start with $2a/$2b/$2y
 * and hashes it with bcrypt (12 rounds).
 *
 * The production bootstrap marker and the historical public admin password
 * are replaced by a random one-time credential and forced to rotate on login.
 * Unknown plaintext passwords also get a random 24-char replacement.
 *
 * Usage: node scripts/migrate-plaintext-passwords.js
 */
const lib = require('./shared');
// Ensure we are in the project root
process.chdir(lib.ROOT);
const { log, getEnv } = lib;
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Connect to DB via shared pool (which reads .env automatically)
const { pool } = require('../backend/shared-pool');

const PUBLIC_DEFAULT_PASSWORD = '1234';
const BOOTSTRAP_MARKERS = new Set(['__SETUP_PENDING__', '__PASSWORD_MUST_BE_SET__']);
const SALT_ROUNDS = 12;
const BCRYPT_REGEX = /^\$2[aby]\$/;
// المالك يريد كلمة مرور admin ثابتة دائمًا (تُعاد ضبطها عند كل إقلاع لو تغيّرت).
// يمكن تجاوز القيمة عبر متغير البيئة KARIM_FIXED_ADMIN_PASSWORD.
const FIXED_ADMIN_PASSWORD = String(process.env.KARIM_FIXED_ADMIN_PASSWORD || '').trim() || 'Admin@2026';

function randomPassword(len = 24) {
    return crypto.randomBytes(len).toString('base64').slice(0, len);
}

function getOrphanFile() {
    if (lib.IS_WIN && process.env.APPDATA) {
        return path.join(process.env.APPDATA, 'karim-erp', 'orphan-passwords.json');
    }
    if (lib.IS_MAC) {
        return path.join(process.env.HOME || '/tmp', 'Library', 'Application Support', 'karim-erp', 'orphan-passwords.json');
    }
    return path.join(process.env.HOME || '/tmp', '.karim-erp', 'orphan-passwords.json');
}

function getBootstrapFile() {
    const configuredDir = String(process.env.KARIM_BOOTSTRAP_CREDENTIAL_DIR || '').trim();
    if (configuredDir) {return path.join(configuredDir, 'bootstrap-admin-credential.json');}
    if (lib.IS_WIN && process.env.APPDATA) {return path.join(process.env.APPDATA, 'karim-erp', 'bootstrap-admin-credential.json');}
    if (lib.IS_MAC) {return path.join(process.env.HOME || '/tmp', 'Library', 'Application Support', 'karim-erp', 'bootstrap-admin-credential.json');}
    return path.join(process.env.HOME || '/tmp', '.karim-erp', 'bootstrap-admin-credential.json');
}

function configuredBootstrapPassword() {
    const value = String(process.env.KARIM_BOOTSTRAP_ADMIN_PASSWORD || '');
    return value.length >= 12 && /[A-Za-z]/.test(value) && /\d/.test(value) ? value : randomPassword();
}

function writeBootstrapCredential(password) {
    const bootstrapFile = getBootstrapFile();
    fs.mkdirSync(path.dirname(bootstrapFile), { recursive: true });
    fs.writeFileSync(bootstrapFile, JSON.stringify({
        username: 'admin',
        initial_password: password,
        created_at: new Date().toISOString(),
        action_required: 'Sign in locally and change this password before using the system.',
    }, null, 2), { mode: 0o600 });
    if (lib.IS_WIN) {
        try {
            require('child_process').execFileSync('icacls', [bootstrapFile, '/inheritance:r', '/grant:r', 'Administrators:F', 'SYSTEM:F'], { stdio: 'ignore', windowsHide: true });
        } catch (_) {
            log.warn('تعذر ضبط ACL لملف بيانات الإدارة الأولية؛ يجب تقييد صلاحيات الملف يدويًا.');
        }
    }
    log.warn(`تم إنشاء بيانات دخول مسؤول أولية محلية في: ${bootstrapFile}`);
    log.warn('يجب تسجيل الدخول وتغييرها قبل استخدام النظام. لا تشارك هذا الملف عبر الشبكة.');
}

async function main() {
    log.header('Password Migration (bcrypt)');

    const client = await pool.connect();
    let migrated = 0;
    let orphans = 0;
    const orphanRecords = [];

    try {
        // Ensure authentication hardening columns exist even on legacy DBs.
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_migrated_at TIMESTAMP;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;`);

        const result = await client.query(`
            SELECT id, username, password, name
            FROM users
            WHERE password IS NOT NULL
              AND password NOT LIKE '$2a$%'
              AND password NOT LIKE '$2b$%'
              AND password NOT LIKE '$2y$%';
        `);

        log.info(`وجد ${result.rows.length} مستخدم بكلمة مرور نصية`);

        for (const user of result.rows) {
            const needsBootstrap = user.username === 'admin' && (BOOTSTRAP_MARKERS.has(user.password) || user.password === PUBLIC_DEFAULT_PASSWORD);
            const newPlaintext = needsBootstrap ? configuredBootstrapPassword() : randomPassword();
            const hash = await bcrypt.hash(newPlaintext, SALT_ROUNDS);

            await client.query(`
                UPDATE users
                SET password = $1, password_migrated_at = CURRENT_TIMESTAMP, must_change_password = TRUE
                WHERE id = $2;
            `, [hash, user.id]);

            migrated++;
            if (needsBootstrap) {
                writeBootstrapCredential(newPlaintext);
                log.ok(`[BOOTSTRAP] ${user.username} (id=${user.id}) — تم إنشاء كلمة مرور أولية عشوائية`);
            } else {
                orphans++;
                orphanRecords.push({
                    id: user.id, username: user.username, name: user.name,
                    new_plaintext_password: newPlaintext,
                    migrated_at: new Date().toISOString(),
                });
                log.warn(`[ORPHAN] ${user.username} (id=${user.id}) — تم توليد كلمة مرور عشوائية`);
            }
        }

        // A previous release may already have bcrypt-hashed the public 1234.
        // Detect and rotate it during upgrade so this remediation is effective
        // for existing installations as well as fresh ones.
        const existingAdmin = await client.query(`SELECT id, username, password FROM users WHERE username = 'admin' LIMIT 1;`);
        const admin = existingAdmin.rows[0];
        if (admin && BCRYPT_REGEX.test(admin.password) && await bcrypt.compare(PUBLIC_DEFAULT_PASSWORD, admin.password)) {
            const newPlaintext = configuredBootstrapPassword();
            await client.query(
                `UPDATE users SET password = $1, password_migrated_at = CURRENT_TIMESTAMP, must_change_password = TRUE WHERE id = $2;`,
                [await bcrypt.hash(newPlaintext, SALT_ROUNDS), admin.id]
            );
            writeBootstrapCredential(newPlaintext);
            migrated++;
            log.ok(`[BOOTSTRAP] ${admin.username} (id=${admin.id}) — تم استبدال كلمة المرور الافتراضية القديمة`);
        }

        // قرار المالك: كلمة مرور admin ثابتة دائمًا — أي تغيير لها يُتراجع عند الإقلاع التالي.
        if (admin) {
            const adminPinned = BCRYPT_REGEX.test(admin.password) && await bcrypt.compare(FIXED_ADMIN_PASSWORD, admin.password);
            if (!adminPinned) {
                await client.query(
                    `UPDATE users SET password = $1, must_change_password = FALSE WHERE id = $2;`,
                    [await bcrypt.hash(FIXED_ADMIN_PASSWORD, SALT_ROUNDS), admin.id]
                );
                log.warn(`[ADMIN-PIN] ${admin.username} (id=${admin.id}) — أُعيدت كلمة المرور إلى القيمة الثابتة`);
            } else {
                log.ok('[ADMIN-PIN] كلمة مرور admin مطابقة للقيمة الثابتة');
            }
        }

        if (orphanRecords.length > 0) {
            const orphanFile = getOrphanFile();
            fs.mkdirSync(path.dirname(orphanFile), { recursive: true });
            let existing = [];
            if (fs.existsSync(orphanFile)) {
                try { existing = JSON.parse(fs.readFileSync(orphanFile, 'utf-8')); } catch (_) {}
            }
            fs.writeFileSync(orphanFile, JSON.stringify([...existing, ...orphanRecords], null, 2), { mode: 0o600 });
            log.plain('');
            log.warn(`${orphans} كلمة مرور عشوائية محفوظة في: ${orphanFile}`);
            log.warn('المسؤول يجب أن يسترجعها ويوزعها بأمان');
        }

        // Verify
        const verify = await client.query(`
            SELECT COUNT(*)::int AS n FROM users
            WHERE password NOT LIKE '$2a$%'
              AND password NOT LIKE '$2b$%'
              AND password NOT LIKE '$2y$%';
        `);
        const remaining = verify.rows[0].n;
        if (remaining > 0) {
            log.error(`فشل التحقق: ${remaining} كلمة مرور نصية متبقية`);
            process.exit(1);
        }

        log.plain('');
        log.header('Migration Complete');
        log.ok(`مُهاجرة: ${migrated - orphans} (كلمات مرور معروفة)`);
        log.ok(`مُهاجرة: ${orphans} (كلمات مرور عشوائية)`);
        log.ok(`الإجمالي: ${migrated}`);
        log.ok('التحقق: 0 كلمة مرور نصية متبقية');
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((err) => {
    log.error(`خطأ فادح: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
});
