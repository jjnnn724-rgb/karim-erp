const fs = require('fs');
const path = require('path');

describe('aaPanel production permissions', () => {
  const root = path.resolve(__dirname, '..');
  const install = fs.readFileSync(path.join(root, 'deploy', 'aapanel', 'install-aapanel.sh'), 'utf8');
  const update = fs.readFileSync(path.join(root, 'deploy', 'aapanel', 'update-aapanel.sh'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'deploy', 'aapanel', 'README.md'), 'utf8');

  test('uses a dedicated service user and never recommends world-writable permissions', () => {
    expect(install).toContain('APP_USER="${APP_USER:-www}"');
    expect(install).toContain('useradd --system');
    expect(install).toContain('never silently fall back to root');
    expect(install).toContain('chown -R "root:$APP_GROUP" "$APP_DIR"');
    expect(install).toContain('chmod 640 "$ENV_FILE"');
    expect(install).not.toContain('chmod -R 777');
    expect(update).toContain('chown -R "root:$APP_GROUP" "$APP_DIR"');
    expect(update).toContain('APP_USER" = "root"');
    expect(readme).toContain('لا تستخدم صلاحيات مفتوحة مثل `777`');
  });

  test('limits writes to runtime directories in the systemd service', () => {
    expect(install).toContain('User=$APP_USER');
    expect(install).toContain('NoNewPrivileges=true');
    expect(install).toContain('ProtectSystem=full');
    expect(install).toContain('ReadWritePaths=$APP_DIR/logs $APP_DIR/database/media $APP_DIR/database/backups');
  });

  test('validates database identifiers and quotes the password through psql variables', () => {
    expect(install).toContain('DB_NAME" =~');
    expect(install).toContain('DB_USER" =~');
    expect(install).toContain("-v new_password=\"$DB_PASSWORD\"");
    expect(install).toContain("PASSWORD :'new_password'");
  });
});
