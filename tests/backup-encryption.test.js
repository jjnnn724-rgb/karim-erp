'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

describe('encrypted backup archive safeguards', () => {
    test('requires a public-key fingerprint and an available GPG executable', () => {
        if (process.platform !== 'win32') {
            return;
        }

        const helperPath = path.resolve(__dirname, '..', 'scripts', 'backup-encryption.ps1').replace(/'/g, "''");
        const script = `
$ErrorActionPreference = 'Stop'
. '${helperPath}'
$missingRecipientRejected = $false
try { Resolve-BackupGpg -Recipient '' -GpgPath 'missing-gpg.exe' | Out-Null } catch { $missingRecipientRejected = $_.Exception.Message -match 'KARIM_BACKUP_GPG_RECIPIENT' }
if (-not $missingRecipientRejected) { throw 'Missing recipient was not rejected.' }
$invalidFingerprintRejected = $false
try { Resolve-BackupGpg -Recipient 'backup@example.com' -GpgPath 'missing-gpg.exe' | Out-Null } catch { $invalidFingerprintRejected = $_.Exception.Message -match 'fingerprint' }
if (-not $invalidFingerprintRejected) { throw 'Non-fingerprint recipient was not rejected.' }
`;
        const result = spawnSync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
        ], { encoding: 'utf8', timeout: 30000 });

        expect(result.error).toBeUndefined();
        if (result.status !== 0) {
            throw new Error(result.stderr || result.stdout || `PowerShell exited with status ${result.status}`);
        }
    });

    test('encrypts the archive and refuses to overwrite an existing ciphertext', () => {
        if (process.platform !== 'win32') {
            return;
        }

        const helperPath = path.resolve(__dirname, '..', 'scripts', 'backup-encryption.ps1').replace(/'/g, "''");
        const script = `
$ErrorActionPreference = 'Stop'
. '${helperPath}'
$root = Join-Path $env:TEMP ('karim-gpg-test-' + [guid]::NewGuid().ToString('N'))
$inputFile = Join-Path $root 'backup.zip'
$outputFile = Join-Path $root 'backup.zip.gpg'
$gpgFile = Join-Path $root 'gpg.cmd'
$fingerprint = '0123456789ABCDEF0123456789ABCDEF01234567'
try {
    New-Item -ItemType Directory -Path $root | Out-Null
    Set-Content -LiteralPath $inputFile -Value 'sensitive-fixture' -NoNewline
    @'
@echo off
setlocal
set "OUTPUT="
set "INPUT="
:parse
if "%~1"=="" goto done
if "%~1"=="--output" (
  set "OUTPUT=%~2"
  shift
)
if "%~1"=="--encrypt" (
  set "INPUT=%~2"
  shift
)
shift
goto parse
:done
if not defined OUTPUT exit /b 2
if not defined INPUT exit /b 3
>"%OUTPUT%" echo MOCK-PGP
type "%INPUT%" >>"%OUTPUT%"
exit /b 0
'@ | Set-Content -LiteralPath $gpgFile -Encoding ASCII
    Protect-BackupArchive -InputPath $inputFile -OutputPath $outputFile -Recipient $fingerprint -GpgPath $gpgFile
    if (-not (Test-Path -LiteralPath $outputFile) -or (Get-Item -LiteralPath $outputFile).Length -eq 0) { throw 'Ciphertext was not created.' }
    $overwriteRejected = $false
    try {
        Protect-BackupArchive -InputPath $inputFile -OutputPath $outputFile -Recipient $fingerprint -GpgPath $gpgFile
    } catch {
        $overwriteRejected = $_.Exception.Message -match 'refusing to overwrite'
    }
    if (-not $overwriteRejected) { throw 'Existing ciphertext was not protected.' }
} finally {
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
`;
        const result = spawnSync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
        ], { encoding: 'utf8', timeout: 30000 });

        expect(result.error).toBeUndefined();
        if (result.status !== 0) {
            throw new Error(result.stderr || result.stdout || `PowerShell exited with status ${result.status}`);
        }
    });

    test('offsite script transfers only encrypted archives and their checksum', () => {
        const source = require('fs').readFileSync(
            path.resolve(__dirname, '..', 'scripts', 'backup-offsite.bat'),
            'utf8',
        );
        const mirror = require('fs').readFileSync(
            path.resolve(__dirname, '..', 'scripts', 'backup-mirror.js'),
            'utf8',
        );
        const nightly = require('fs').readFileSync(
            path.resolve(__dirname, '..', 'scripts', 'backup-nightly.js'),
            'utf8',
        );
        expect(source).toContain('karim_FULL_*.zip.gpg');
        expect(source).toContain('.sha256');
        expect(source).not.toContain('env-backup.txt');
        expect(source).not.toContain('HorusData\\certs');
        expect(source).not.toContain('db-backups\\*.dump');
        // المرآة لا تقبل إلا ملفاً مشفّراً: .gpg (مفتاح عام) أو .kbak (عبارة مرور)
        expect(mirror).toContain("ext !== '.gpg' && ext !== '.kbak'");
        expect(mirror).toContain('plaintext-mirror-refused:encrypted-.gpg-or-.kbak-required');
        expect(nightly).toContain('encryptBackupFile(file)');
    });

    // يتطلّب بيئة GPG فعلية (مفتاح + gpg): على CI لا توجد ⇒ تخطّي.
    if (process.platform !== 'win32' || !process.env.KARIM_GPG_PATH) {
        return;
    }
    test('creates a ciphertext checksum before allowing an encrypted mirror', () => {
        const fs = require('fs');
        const os = require('os');
        const crypto = require('crypto');
        const childProcess = require('child_process');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karim-encrypt-test-'));
        const inputPath = path.join(root, 'backup.dump');
        const outputPath = `${inputPath}.gpg`;
        const spawn = jest.spyOn(childProcess, 'spawnSync').mockImplementation(() => {
            fs.writeFileSync(outputPath, 'ciphertext fixture');
            return { status: 0, error: null, stdout: '', stderr: '' };
        });
        try {
            fs.writeFileSync(inputPath, 'backup fixture');
            let encryptedPath;
            jest.isolateModules(() => {
                const { encryptBackupFile } = require('../scripts/backup-mirror');
                encryptedPath = encryptBackupFile(inputPath);
            });
            const expectedDigest = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex');
            expect(encryptedPath).toBe(outputPath);
            expect(fs.readFileSync(`${outputPath}.sha256`, 'utf8')).toBe(`${expectedDigest}  ${path.basename(outputPath)}\n`);
            expect(spawn).toHaveBeenCalledWith(
                'powershell.exe',
                expect.arrayContaining(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']),
                expect.objectContaining({ timeout: 600000 }),
            );
        } finally {
            spawn.mockRestore();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('passphrase path: يشفّر بـAES-256-GCM، ودورة فك التشفير تُطابق، والعبارة الخاطئة تُرفض', () => {
        const fs = require('fs');
        const os = require('os');
        const crypto = require('crypto');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karim-passphrase-test-'));
        const inputPath = path.join(root, 'backup.sql');
        const outputPath = path.join(root, 'backup.sql.kbak');
        const restoredPath = path.join(root, 'restored.sql');
        const passphrase = 'correct-horse-battery-staple-2026';
        try {
            fs.writeFileSync(inputPath, 'sensitive fixture\n-- سطر ثانٍ\n');
            const { encryptFile, decryptFile } = require('../scripts/backup-passphrase-encryption');
            encryptFile(inputPath, outputPath, passphrase);

            // النص الصريح غير موجود في الملف المشفَّر
            const cipherBytes = fs.readFileSync(outputPath);
            expect(cipherBytes.includes(Buffer.from('sensitive fixture'))).toBe(false);

            // دورة فك التشفير تُطابق بالبايت
            decryptFile(outputPath, restoredPath, passphrase);
            const a = crypto.createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex');
            const b = crypto.createHash('sha256').update(fs.readFileSync(restoredPath)).digest('hex');
            expect(a).toBe(b);

            // العبارة الخاطئة تُرفض (وسم GCM يكشف العبث)
            expect(() => decryptFile(outputPath, path.join(root, 'x.sql'), 'wrong-passphrase-entirely'))
                .toThrow(/Decryption failed/);

            // refuses to overwrite an existing ciphertext
            expect(() => encryptFile(inputPath, outputPath, passphrase)).toThrow(/refusing to overwrite/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('mirror refuses plaintext and verifies the encrypted archive checksum', () => {
        const fs = require('fs');
        const os = require('os');
        const crypto = require('crypto');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karim-mirror-test-'));
        const backupRoot = path.join(root, 'backup');
        const mirrorRoot = path.join(root, 'mirror');
        const encryptedPath = path.join(backupRoot, 'nightly.dump.gpg');
        const plaintextPath = path.join(backupRoot, 'nightly.dump');
        const oldD = process.env.KARIM_MIRROR_D;
        const oldE = process.env.KARIM_MIRROR_E;
        try {
            fs.mkdirSync(backupRoot);
            fs.writeFileSync(plaintextPath, 'plaintext fixture');
            fs.writeFileSync(encryptedPath, 'ciphertext fixture');
            const digest = crypto.createHash('sha256').update(fs.readFileSync(encryptedPath)).digest('hex');
            fs.writeFileSync(`${encryptedPath}.sha256`, `${digest}  ${path.basename(encryptedPath)}\n`);
            process.env.KARIM_MIRROR_D = mirrorRoot;
            process.env.KARIM_MIRROR_E = path.join(root, 'missing-mirror');
            jest.isolateModules(() => {
                const { mirrorFile } = require('../scripts/backup-mirror');
                const plaintextResult = mirrorFile(plaintextPath, 'nightly');
                expect(plaintextResult.ok).toBe(false);
                expect(plaintextResult.errors).toContain('plaintext-mirror-refused:encrypted-.gpg-or-.kbak-required');
                expect(fs.existsSync(path.join(mirrorRoot, 'nightly', path.basename(plaintextPath)))).toBe(false);

                fs.writeFileSync(encryptedPath, 'tampered fixture');
                const invalidChecksum = mirrorFile(encryptedPath, 'nightly');
                expect(invalidChecksum.ok).toBe(false);
                expect(invalidChecksum.errors).toContain('encrypted-backup-checksum-invalid');
                fs.writeFileSync(encryptedPath, 'ciphertext fixture');

                const encryptedResult = mirrorFile(encryptedPath, 'nightly');
                expect(encryptedResult.mirrored).toHaveLength(2);
                for (const mirrored of encryptedResult.mirrored) {
                    expect(fs.existsSync(`${mirrored}.sha256`)).toBe(true);
                }
            });
        } finally {
            if (oldD === undefined) {delete process.env.KARIM_MIRROR_D;} else {process.env.KARIM_MIRROR_D = oldD;}
            if (oldE === undefined) {delete process.env.KARIM_MIRROR_E;} else {process.env.KARIM_MIRROR_E = oldE;}
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
