const fs = require('fs');
const path = require('path');

describe('restore safety contract', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'database', 'scripts', 'restore.js'), 'utf8');

  test('requires an explicit matching destructive-action confirmation', () => {
    expect(source).toContain('--confirm-drop=');
    expect(source).toContain('confirmArg.slice');
    expect(source).toContain('تم رفض العملية');
  });

  test('creates a pre-restore backup before DROP DATABASE', () => {
    const backupIndex = source.indexOf('pre-restore-');
    const dropIndex = source.indexOf('DROP DATABASE IF EXISTS');
    expect(backupIndex).toBeGreaterThan(-1);
    expect(dropIndex).toBeGreaterThan(backupIndex);
    expect(source).toContain('pgDumpBin');
  });
});
