'use strict';
/**
 * backup-mirror.js — نسخ ملفات النسخ الاحتياطي إلى هاردات خارجية (D/E)
 * ────────────────────────────────────────────────────────────────────────────
 * يُستدعى بعد أي نسخة ناجحة. best-effort: فشل المرايا لا يُفشل النسخة.
 * Returns: { ok, mirrored: [paths], errors: [msgs] }
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const MIRROR_ROOTS = [
    process.env.KARIM_MIRROR_D || 'D:/KarimBackups',
    process.env.KARIM_MIRROR_E || 'E:/KarimBackups',
];

function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    const fd = fs.openSync(filePath, 'r');
    try {
        let bytesRead;
        do {
            bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
            if (bytesRead > 0) {hash.update(buffer.subarray(0, bytesRead));}
        } while (bytesRead > 0);
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest('hex');
}

/** Reads the archive passphrase from the environment (never printed, never stored). */
function readBackupPassphrase() {
    const raw = String(process.env.KARIM_BACKUP_PASSPHRASE || '').trim();
    return raw.length >= 12 ? raw : null;
}

function encryptBackupFile(srcFile) {
    const outputFile = `${srcFile}.gpg`;
    const checksumFile = `${outputFile}.sha256`;
    // إعادة التشغيل (نفس الليلة/بعد فشل) يجب أن تنجح: ننظّف البقايا بدل
    // الفشل بـEEXIST. (الم refusal كان يُخفي السبب الحقيقي: EEXIST لا سبب
    // تشفير ✗ ⇒ بدا كأن التشفير معطّل.)
    for (const stale of [outputFile, checksumFile, `${srcFile}.kbak`, `${srcFile}.kbak.sha256`]) {
        try { if (fs.existsSync(stale)) {fs.unlinkSync(stale);} } catch (_) {}
    }

    // Preferred path: passphrase (no key file to move around — a secret the
    // owner keeps in their password manager). Falls back to GPG below.
    const passphrase = readBackupPassphrase();
    if (passphrase) {
        const { encryptFile } = require('./backup-passphrase-encryption');
        // امتداد مختلف عن .gpg حتى لا تختلط الصيغ (فك التشفير يقرأ الصيغة من الترويسة)
        const passphraseOutput = `${srcFile}.kbak`;
        try {
            encryptFile(srcFile, passphraseOutput, passphrase);
        } catch (e) {
            if (fs.existsSync(passphraseOutput)) {fs.unlinkSync(passphraseOutput);}
            throw new Error(`Passphrase encryption failed for ${srcFile}: ${String(e.message || e).slice(0, 200)}`, { cause: e });
        }
        const digest = sha256File(passphraseOutput);
        fs.writeFileSync(`${passphraseOutput}.sha256`, `${digest}  ${path.basename(passphraseOutput)}\n`, { encoding: 'utf8' });
        return passphraseOutput;
    }

    const helperPath = path.join(__dirname, 'backup-encryption.ps1')
        .replace(/'/g, "''");
    const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
    const command = [
        `$ErrorActionPreference = 'Stop'`,
        `. ${quote(helperPath)}`,
        '$gpg = Resolve-BackupGpg',
        `Protect-BackupArchive -InputPath ${quote(path.resolve(srcFile))} -OutputPath ${quote(path.resolve(outputFile))} -Recipient $gpg.Recipient -GpgPath $gpg.GpgPath`,
    ].join('; ');
    const result = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true, timeout: 600000 });

    if (result.error || result.status !== 0) {
        if (fs.existsSync(outputFile)) {fs.unlinkSync(outputFile);}
        const detail = result.error ? result.error.message : (result.stderr || result.stdout || `exit code ${result.status}`);
        throw new Error(`GPG encryption failed for ${srcFile}: ${String(detail).trim()}`);
    }
    if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
        if (fs.existsSync(outputFile)) {fs.unlinkSync(outputFile);}
        throw new Error(`GPG did not create a non-empty encrypted backup: ${outputFile}`);
    }

    const digest = sha256File(outputFile);
    fs.writeFileSync(checksumFile, `${digest}  ${path.basename(outputFile)}\n`, { encoding: 'utf8', flag: 'wx' });
    return outputFile;
}

function mirrorFile(srcFile, subdir) {
    const out = { ok: true, mirrored: [], errors: [] };
    const ext = path.extname(srcFile).toLowerCase();
    if (ext !== '.gpg' && ext !== '.kbak') {
        out.ok = false;
        out.errors.push('plaintext-mirror-refused:encrypted-.gpg-or-.kbak-required');
        return out;
    }
    const checksumFile = `${srcFile}.sha256`;
    if (!fs.existsSync(checksumFile)) {
        out.ok = false;
        out.errors.push('encrypted-backup-checksum-missing');
        return out;
    }
    const checksum = fs.readFileSync(checksumFile, 'utf8').trim().match(/^([a-f0-9]{64})\s+(.+)$/i);
    if (!checksum || checksum[2] !== path.basename(srcFile) || sha256File(srcFile).toLowerCase() !== checksum[1].toLowerCase()) {
        out.ok = false;
        out.errors.push('encrypted-backup-checksum-invalid');
        return out;
    }
    let stat;
    try { stat = fs.statSync(srcFile); } catch (e) { out.ok = false; out.errors.push('src-missing:' + e.message); return out; }
    if (!stat.size) { out.ok = false; out.errors.push('src-empty'); return out; }
    for (const root of MIRROR_ROOTS) {
        try {
            const dir = subdir ? path.join(root, subdir) : root;
            fs.mkdirSync(dir, { recursive: true });
            const dest = path.join(dir, path.basename(srcFile));
            fs.copyFileSync(srcFile, dest);
            fs.copyFileSync(checksumFile, `${dest}.sha256`);
            if (sha256File(dest).toLowerCase() !== checksum[1].toLowerCase()) {
                fs.unlinkSync(dest);
                fs.unlinkSync(`${dest}.sha256`);
                throw new Error('copied encrypted backup checksum mismatch');
            }
            out.mirrored.push(dest);
        } catch (e) {
            out.errors.push(root + ':' + String(e.message).slice(0, 80));
        }
    }
    if (!out.mirrored.length) {out.ok = false;}
    return out;
}

module.exports = { encryptBackupFile, mirrorFile, MIRROR_ROOTS };
