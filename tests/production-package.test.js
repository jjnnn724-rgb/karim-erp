const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

describe('production package hardening', () => {
  test('Windows service targets the Electron executable declared by the build', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const serviceXml = fs.readFileSync(path.join(ROOT, 'windows-service', 'AlShorfaERPService.xml'), 'utf8');
    const executableName = pkg.build.win.executableName;
    expect(executableName).toBe('AlShorfaERP');
    expect(serviceXml).toContain(`<executable>..\\..\\${executableName}.exe</executable>`);
    expect(serviceXml).toContain('<arguments>--service</arguments>');
  });

  test('fresh database seed does not ship the public admin password', () => {
    const seed = fs.readFileSync(path.join(ROOT, 'database', 'migrations', '002_seed.sql'), 'utf8');
    expect(seed).toContain('__SETUP_PENDING__');
    expect(seed).not.toContain("'admin', '1234'");
  });

  test('environment template contains no usable password or JWT placeholders', () => {
    const envTemplate = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    expect(envTemplate).toContain('DB_PASSWORD=\n');
    expect(envTemplate).toContain('JWT_ACCESS_SECRET=\n');
    expect(envTemplate).toContain('JWT_REFRESH_SECRET=\n');
    expect(envTemplate).not.toContain('karim_secure_password_123');
    expect(envTemplate).not.toContain('your_super_secret_jwt_key_change_this_in_production');
  });

  test('production authentication ships first-login rotation migration', () => {
    const migration = fs.readFileSync(path.join(ROOT, 'database', 'migrations', '032_first_login_password_rotation.sql'), 'utf8');
    expect(migration).toContain('must_change_password');
    expect(migration).toContain('BEGIN');
    expect(migration).toContain('COMMIT');
  });
});
