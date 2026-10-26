const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { isCustomDump } = require('../database/scripts/restore');

describe('restore safety contract', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'database', 'scripts', 'restore.js'), 'utf8');
  const restoreScript = path.resolve(__dirname, '..', 'database', 'scripts', 'restore.js');

  function runRestore(args, backupContent = '-- safety test fixture\n') {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karim-restore-safety-'));
    const backupFile = path.join(tempDir, 'empty-fixture.sql');
    fs.writeFileSync(backupFile, backupContent);
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: '127.0.0.1',
      DB_PORT: '55432',
      DB_NAME: 'karim_erp_test',
      DB_USER: 'postgres',
      DB_PASSWORD: '',
    };
    try {
      return spawnSync(process.execPath, [restoreScript, backupFile, ...args], {
        cwd: path.resolve(__dirname, '..'),
        env,
        encoding: 'utf8',
        timeout: 10000,
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  test('requires an explicit matching destructive-action confirmation', () => {
    expect(source).toContain('--confirm-drop=');
    expect(source).toContain('confirmArg.slice');
    expect(source).toContain('تم رفض العملية');
  });

  test('detects PostgreSQL custom archives separately from SQL dumps', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karim-restore-format-'));
    const customFile = path.join(tempDir, 'backup.dump');
    const sqlFile = path.join(tempDir, 'backup.sql');
    try {
      fs.writeFileSync(customFile, Buffer.concat([Buffer.from('PGDMP'), Buffer.from([1, 2, 3])]));
      fs.writeFileSync(sqlFile, '-- PostgreSQL database dump\n');
      expect(isCustomDump(customFile)).toBe(true);
      expect(isCustomDump(sqlFile)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('creates a pre-restore backup before DROP DATABASE', () => {
    const backupIndex = source.indexOf('pre-restore-');
    const dropIndex = source.indexOf('DROP DATABASE IF EXISTS');
    expect(backupIndex).toBeGreaterThan(-1);
    expect(dropIndex).toBeGreaterThan(backupIndex);
    expect(source).toContain('pgDumpBin');
  });

  test('validates target database names before using them in SQL and backup paths', () => {
    const validationIndex = source.indexOf('اسم قاعدة البيانات غير صالح');
    const backupPathIndex = source.indexOf('const preRestorePath');
    const dropIndex = source.indexOf('DROP DATABASE IF EXISTS');
    expect(validationIndex).toBeGreaterThan(-1);
    expect(validationIndex).toBeLessThan(backupPathIndex);
    expect(validationIndex).toBeLessThan(dropIndex);
    expect(source).toContain("targetDb.replace(/\"/g, '\"\"')");
  });

  test('protects the canonical production database even when DB_NAME points elsewhere', () => {
    expect(source).toContain("targetDb === 'karim_erp'");
    expect(source).toContain("process.env.NODE_ENV === 'production'");
  });

  test('rejects path-like database names before invoking PostgreSQL tools', () => {
    const result = runRestore(['--target-db', '../karim_erp']);
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('اسم قاعدة البيانات غير صالح');
  });

  test('rejects an empty backup before invoking PostgreSQL tools', () => {
    const result = runRestore([], '');
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('ملف النسخة الاحتياطية فارغ');
  });

  test('requires explicit confirmation for karim_erp when DB_NAME is the test database', () => {
    const result = runRestore(['--target-db', 'karim_erp']);
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('تتطلب --yes');
  });
});
