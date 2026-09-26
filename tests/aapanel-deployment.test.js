const fs = require('fs');
const path = require('path');

describe('aaPanel deployment bundle', () => {
  const root = path.resolve(__dirname, '..');
  const deployDir = path.join(root, 'deploy', 'aapanel');
  const installScript = fs.readFileSync(path.join(deployDir, 'install-aapanel.sh'), 'utf8');
  const updateScript = fs.readFileSync(path.join(deployDir, 'update-aapanel.sh'), 'utf8');
  const envExample = fs.readFileSync(path.join(deployDir, '.env.aapanel.example'), 'utf8');
  const ecosystem = fs.readFileSync(path.join(deployDir, 'ecosystem.config.cjs'), 'utf8');
  const nginx = fs.readFileSync(path.join(deployDir, 'nginx-karim.conf.template'), 'utf8');

  test('contains production setup for PostgreSQL, migrations, and password hardening', () => {
    expect(installScript).toContain('006_demo_seed.sql');
    expect(installScript).toContain('migrate-plaintext-passwords.js');
    expect(installScript).toContain('npm ci --omit=dev --ignore-scripts');
    expect(updateScript).toContain('pm2 restart karim-erp');
  });

  test('does not ship credentials in the environment template', () => {
    expect(envExample).toContain('DB_PASSWORD=');
    expect(envExample).toContain('JWT_SECRET=');
    expect(envExample).not.toMatch(/DB_PASSWORD=\S+/);
    expect(envExample).not.toMatch(/JWT_SECRET=\S+/);
  });

  test('configures PM2 and Nginx for the local Node service and WebSocket traffic', () => {
    expect(ecosystem).toContain("name: 'karim-erp'");
    expect(ecosystem).toContain("script: './backend/server.js'");
    expect(nginx).toContain('proxy_pass http://127.0.0.1:5000');
    expect(nginx).toContain('location /socket.io/');
  });
});
