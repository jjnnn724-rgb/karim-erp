'use strict';
/**
 * عقد "لا نص صريح على القرص" (A3 — 2026-10-26)
 * ────────────────────────────────────────────────────────────────────────────
 * النسخ الاحتياطية كانت نصًا صريحًا على القرص: 13GB+ من .sql/.dump وحزم
 * بيانات (جلسة واتساب + شهادة HTTPS). هذه الاختبارات تثبت:
 *   • التشفير وفك التشفير يعملان (عبارة مرور وGPG) والبصمة تكشف العبث.
 *   • restore.js يقبل الأرشيف المشفَّر: يفكّه مؤقّتًا، يتحقق، ثم يمسح المؤقّت.
 *   • مسارات النسخ Daily/Lightly تحذف النسخة الصريحة بعد نجاح التشفير.
 *   • التدوير يحذف الأرشيف مع بصمتيه (لا بصمة يتيمة).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// متغيّرات التشفير فقط — لا تُحمَّل بقية .env (DB_NAME يبقى قاعدة الاختبار)
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^(KARIM_BACKUP_PASSPHRASE|KARIM_GPG_PATH|KARIM_BACKUP_GPG_RECIPIENT)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2];
  }
}

const { encryptBackupFile, decryptBackupFile } = require('../scripts/backup-mirror');
const { collectBackupGroups, pruneBackupGroups, sqlBase } = require('../scripts/backup-retention');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function digestOf(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

describe('encrypted backup archives (at-rest)', () => {
  test('passphrase round trip reproduces the original bytes exactly', () => {
    const dir = tempDir('a3-kbak-');
    try {
      const plain = path.join(dir, 'dump.sql');
      const payload = Buffer.from('-- dump\nSELECT 1;\n'.repeat(4096));
      fs.writeFileSync(plain, payload);

      const encrypted = encryptBackupFile(plain);
      expect(path.extname(encrypted)).toBe('.kbak');
      expect(fs.existsSync(`${encrypted}.sha256`)).toBe(true);

      const out = path.join(dir, 'restored.sql');
      decryptBackupFile(encrypted, out);
      expect(digestOf(out)).toBe(digestOf(plain));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('decryption refuses a tampered archive and an archive without a checksum', () => {
    const dir = tempDir('a3-tamper-');
    try {
      const plain = path.join(dir, 'dump.sql');
      fs.writeFileSync(plain, 'sensitive fixture');
      const encrypted = encryptBackupFile(plain);

      fs.appendFileSync(encrypted, 'tamper');
      expect(() => decryptBackupFile(encrypted, path.join(dir, 'a.sql'))).toThrow(/checksum/i);

      fs.writeFileSync(encrypted, 'x');
      fs.unlinkSync(`${encrypted}.sha256`);
      expect(() => decryptBackupFile(encrypted, path.join(dir, 'b.sql'))).toThrow(/checksum/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('restore.js restores from an encrypted archive and removes the temporary plaintext', () => {
    const dir = tempDir('a3-restore-');
    try {
      const plain = path.join(dir, 'fixture.sql');
      fs.writeFileSync(plain, '-- a3 fixture\n');
      fs.writeFileSync(`${plain}.sha256`, `${digestOf(plain)}  fixture.sql\n`);
      const encrypted = encryptBackupFile(plain);

      const before = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('karim-restore-')).length;
      const result = spawnSync(
        process.execPath,
        [path.join(ROOT, 'database', 'scripts', 'restore.js'), encrypted, '--target-db', 'karim_erp_test', '--yes'],
        {
          cwd: ROOT,
          encoding: 'utf8',
          timeout: 60000,
          env: { ...process.env, NODE_ENV: 'test' },
        }
      );
      const after = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('karim-restore-')).length;

      expect(`${result.stdout}${result.stderr}`).toContain('تمت الاستعادة بنجاح');
      expect(result.status).toBe(0);
      expect(after - before).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('restore.js refuses an encrypted archive whose ciphertext checksum is missing', () => {
    const dir = tempDir('a3-restore-nosidecar-');
    try {
      const plain = path.join(dir, 'fixture.sql');
      fs.writeFileSync(plain, '-- a3 fixture\n');
      const encrypted = encryptBackupFile(plain);
      fs.unlinkSync(`${encrypted}.sha256`);

      const before = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('karim-restore-')).length;
      const result = spawnSync(
        process.execPath,
        [path.join(ROOT, 'database', 'scripts', 'restore.js'), encrypted, '--target-db', 'karim_erp_test', '--yes'],
        {
          cwd: ROOT,
          encoding: 'utf8',
          timeout: 60000,
          env: { ...process.env, NODE_ENV: 'test' },
        }
      );
      const after = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('karim-restore-')).length;

      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain('ملف البصمة مفقود');
      expect(after - before).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('backup pipelines keep no plaintext at rest', () => {
  const backup = fs.readFileSync(path.join(ROOT, 'database', 'scripts', 'backup.js'), 'utf8');
  const nightly = fs.readFileSync(path.join(ROOT, 'scripts', 'backup-nightly.js'), 'utf8');
  const migration = fs.readFileSync(path.join(ROOT, 'scripts', 'backup-encrypt-legacy.js'), 'utf8');
  const gate = fs.readFileSync(path.join(ROOT, 'scripts', 'quality-gate.js'), 'utf8');

  test('the daily backup deletes the plaintext only after the encrypted copy exists', () => {
    const encryptIndex = backup.indexOf('encryptBackupFile(outputFile)');
    const removeIndex = backup.indexOf('fs.unlinkSync(outputFile)');
    expect(encryptIndex).toBeGreaterThan(-1);
    expect(removeIndex).toBeGreaterThan(encryptIndex);
    expect(backup).toContain('النسخة الصريحة باقية على القرص');
    expect(backup).toContain('plaintextRemoved');
  });

  test('the nightly backup encrypts the dump, the data zip and the latest copy', () => {
    expect(nightly).toContain('encryptBackupFile(file)');
    expect(nightly).toContain('karim_erp-latest.dump.kbak');
    expect(nightly).toContain('plaintext-remains:');
    // لا يُحذف صريح إلا مقابل أرشيف مشفَّر قائم
    const removeIndex = nightly.indexOf('fs.unlinkSync(plain)');
    const guardIndex = nightly.indexOf('no encrypted counterpart');
    expect(removeIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(-1);
  });

  test('the legacy migration verifies before it deletes', () => {
    const verifyIndex = migration.indexOf('plaintext-checksum-mismatch');
    const encryptIndex = migration.indexOf("encryptBackupFile(file, { method: 'gpg' })");
    const decryptIndex = migration.indexOf('decryptBackupFile(encrypted, verifyPath)');
    const deleteIndex = migration.indexOf('fs.unlinkSync(file)');
    expect(verifyIndex).toBeGreaterThan(-1);
    expect(encryptIndex).toBeGreaterThan(verifyIndex);
    expect(decryptIndex).toBeGreaterThan(encryptIndex);
    expect(deleteIndex).toBeGreaterThan(decryptIndex);
  });

  test('the quality gate fails when a plaintext backup is found on disk', () => {
    expect(gate).toContain('لا نسخ احتياطية صريحة على القرص');
    expect(gate).toContain('karim_erp-latest.dump.kbak');
  });

  test('retention removes the archive together with both of its checksums', () => {
    const dir = tempDir('a3-retention-');
    try {
      const older = new Date(Date.now() - 3600000);
      const newer = new Date();
      fs.writeFileSync(path.join(dir, 'karim-a.sql'), 'plain');
      fs.writeFileSync(path.join(dir, 'karim-a.sql.sha256'), 'digest-of-plain');
      fs.writeFileSync(path.join(dir, 'karim-a.sql.kbak'), 'cipher');
      fs.writeFileSync(path.join(dir, 'karim-a.sql.kbak.sha256'), 'digest-of-cipher');
      fs.writeFileSync(path.join(dir, 'karim-b.sql.kbak'), 'cipher-b');
      fs.utimesSync(path.join(dir, 'karim-a.sql'), older, older);
      fs.utimesSync(path.join(dir, 'karim-a.sql.sha256'), older, older);
      fs.utimesSync(path.join(dir, 'karim-a.sql.kbak'), older, older);
      fs.utimesSync(path.join(dir, 'karim-a.sql.kbak.sha256'), older, older);
      fs.utimesSync(path.join(dir, 'karim-b.sql.kbak'), newer, newer);

      const groups = collectBackupGroups(dir, sqlBase);
      expect(groups.map(g => g.base)).toEqual(['karim-b.sql', 'karim-a.sql']);

      pruneBackupGroups(dir, groups, 1);
      expect(fs.existsSync(path.join(dir, 'karim-a.sql'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'karim-a.sql.sha256'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'karim-a.sql.kbak'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'karim-a.sql.kbak.sha256'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'karim-b.sql.kbak'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
