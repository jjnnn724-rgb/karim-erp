#!/usr/bin/env node
'use strict';
/**
 * decrypt-backup.js — فك تشفير نسخة احتياطية (عبارة مرور أو GPG)
 * ══════════════════════════════════════════════════════════════════════════
 * الاستخدام:
 *   node scripts/decrypt-backup.js <encrypted-file> [output-file]
 *
 * يقبل:
 *   · حاوية عبارة المرور (Magic KBKP1) — يحتاج العبارة (تُقرأ من
 *     KARIM_BACKUP_PASSPHRASE أو تُطلب تفاعليًا بلا echo).
 *   · ملف GPG (.gpg) — يحتاج المفتاح الخاص في keyring GPG.
 *
 * مثال:
 *   node scripts/decrypt-backup.js D:\KarimBackups\full\karim-karim_erp-2026-10-20T23-36-41.sql.gpg C:\restore\karim_erp.sql
 */
const fs = require('fs');
const { execFileSync } = require('child_process');

const file = process.argv[2];
const outArg = process.argv[3];
if (!file) {
    console.error('الاستخدام: node scripts/decrypt-backup.js <encrypted-file> [output-file]');
    process.exit(2);
}
if (!fs.existsSync(file)) {
    console.error(`الملف غير موجود: ${file}`);
    process.exit(2);
}
const out = outArg || file.replace(/\.(gpg|kbak)$/i, '') + '.decrypted';

// ── 1) حاوية عبارة المرور؟ ──
const { decryptFile, MAGIC } = require('./backup-passphrase-encryption');
const head = fs.readFileSync(file, { flag: 'r' }).subarray(0, MAGIC.length);
if (head.equals(MAGIC)) {
    const envPass = String(process.env.KARIM_BACKUP_PASSPHRASE || '');
    let passphrase = envPass;
    if (!passphrase) {
        // قراءة بلا echo: نطلبها ونEchoها؟ لا — نستخدم stdin حتى لا تُطبع.
        process.stdout.write('عب��رة مرور فك التشفير: ');
        const chunks = [];
        process.stdin.on('data', (c) => chunks.push(c));
        process.stdin.on('end', () => {
            passphrase = Buffer.concat(chunks).toString('utf8').trim();
            try {
                decryptFile(file, out, passphrase);
                console.log(`فُك التشفير: ${out}`);
                process.exit(0);
            } catch (e) {
                console.error(`فشل فك التشفير: ${e.message}`);
                process.exit(1);
            }
        });
        process.stdin.resume();
    } else {
        try {
            decryptFile(file, out, passphrase);
            console.log(`فُك التشفير: ${out}`);
            process.exit(0);
        } catch (e) {
            console.error(`فشل فك التشفير: ${e.message}`);
            process.exit(1);
        }
    }
} else {
    // ── 2) ملف GPG ──
    const gpg = process.env.KARIM_GPG_PATH
        || (execFileSync('powershell.exe', ['-NoProfile', '-Command',
            "(Get-Command gpg -ErrorAction SilentlyContinue).Source"], { encoding: 'utf8' }).trim() || 'gpg');
    try {
        execFileSync(gpg, ['--batch', '--yes', '--pinentry-mode', 'loopback', '--passphrase', '',
            '--output', out, '--decrypt', file], { stdio: 'pipe', timeout: 1800000 });
        console.log(`فُك التشفير: ${out}`);
        process.exit(0);
    } catch (e) {
        console.error(`فشل فك تشفير GPG: ${String((e.stderr || e.message || '')).slice(0, 300)}`);
        process.exit(1);
    }
}
