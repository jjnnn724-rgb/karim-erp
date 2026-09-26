const fs = require('fs');
const path = require('path');

describe('daily 02:00 database backup', () => {
  const root = path.resolve(__dirname, '..');
  const backup = fs.readFileSync(path.join(root, 'database', 'scripts', 'backup.js'), 'utf8');
  const electron = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const installer = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
  const batch = fs.readFileSync(path.join(root, 'windows-service', 'DailyBackup.bat'), 'utf8');

  test('writes scheduled backups outside the installation tree with bounded retention', () => {
    expect(backup).toContain('KARIM_BACKUP_DIR');
    expect(backup).toContain('KARIM_BACKUP_RETENTION');
    expect(backup).toContain('daily-backup-status.json');
    expect(backup).toContain('secureBackupDirectory');
    expect(backup).toContain('Administrators:(OI)(CI)F');
    expect(backup).toContain('Math.max(7, Math.min(365');
    expect(backup).toContain('fs.unlinkSync(`${old.path}.sha256`)');
  });

  test('runs backup mode headlessly from the embedded EXE', () => {
    expect(electron).toContain("process.argv.includes('--backup')");
    expect(electron).toContain('runScheduledBackup');
    expect(electron).toContain("KARIM_BACKUP_RETENTION: '30'");
    expect(electron).toContain('KARIM_PG_DUMP_PATH');
  });

  test('registers and removes a SYSTEM scheduled task at 02:00', () => {
    expect(installer).toContain('AlShorfaERP-DailyBackup');
    expect(installer).toContain('/SC DAILY /ST 02:00 /RU SYSTEM /RL HIGHEST /F');
    expect(installer).toContain('schtasks.exe /Delete');
    expect(batch).toContain('AlShorfaERP.exe" --backup');
    expect(batch).toContain('%ProgramData%\\AlShorfaERP\\logs');
  });
});
