const fs = require('fs');
const path = require('path');

describe('Windows service and desktop client coexistence', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'electron', 'main.js'), 'utf8');

  test('stores service-owned state in ProgramData', () => {
    expect(source).toContain("'AlShorfaERP'");
    expect(source).toContain('PROGRAMDATA');
    expect(source).toContain('PERSISTENT_PATH');
  });

  test('desktop UI attaches to an existing healthy Windows service', () => {
    expect(source).toContain('probeExistingLocalService');
    expect(source).toContain('isWindowsServiceInstalled');
    expect(source).toContain('waitForWindowsServiceHealth');
    expect(source).toContain('await waitForWindowsServiceHealth()');
    expect(source).toContain('Attached to the existing Windows service');
  });

  test('client shutdown and restart cannot control the service-owned backend', () => {
    expect(source).toContain('Restart blocked: the Windows service owns the server lifecycle');
    expect(source).toContain('Closing UI only; the Windows service remains running');
    expect(source).toContain('UI closed; Windows service continues running');
  });

  test('supports an isolated local PostgreSQL port without changing the production default', () => {
    // DB_PORT is the documented key; PG_PORT stays as a legacy fallback and
    // 5432 remains the final default (production contract unchanged)
    expect(source).toContain("DB_PORT: process.env.DB_PORT || process.env.PG_PORT || 5432");
    expect(source).toContain('port = ${CONFIG.DB_PORT}');
    expect(source).toContain('String(CONFIG.DB_PORT)');
  });
});
