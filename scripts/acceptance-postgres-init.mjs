import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import process from 'process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pgBin = process.env.KARIM_ACCEPTANCE_PG_BIN || '/usr/lib/postgresql/16/bin';
const workDir = process.env.KARIM_ACCEPTANCE_DIR || '/home/ubuntu/karim-postgres-acceptance';
const dataDir = path.join(workDir, 'data');
const socketDir = path.join(workDir, 'socket');
const credentialDir = path.join(workDir, 'credentials');
const port = String(process.env.KARIM_ACCEPTANCE_PG_PORT || '55433');
const dbName = 'karim_acceptance';
const dbPassword = 'KarimAcceptanceOnly_2026!';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', timeout: 180000 });
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed (${result.status}): ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result.stdout || '';
}

function pg(name) {
  return path.join(pgBin, name);
}

function writeReport(report) {
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'acceptance-result.json'), JSON.stringify(report, null, 2));
}

let clusterStarted = false;
try {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(socketDir, { recursive: true });
  const passwordFile = path.join(workDir, 'postgres-password.txt');
  fs.writeFileSync(passwordFile, `${dbPassword}\n`, { mode: 0o600 });

  run(pg('initdb'), ['-D', dataDir, '-U', 'postgres', `--pwfile=${passwordFile}`, '--auth-host=scram-sha-256', '--auth-local=trust', '--no-locale']);
  fs.appendFileSync(path.join(dataDir, 'postgresql.conf'), `\nlisten_addresses = '127.0.0.1'\nport = ${port}\n`);
  run(pg('pg_ctl'), ['-D', dataDir, '-o', `-p ${port} -k ${socketDir}`, '-w', 'start']);
  clusterStarted = true;

  const pgEnv = { ...process.env, PGPASSWORD: dbPassword };
  run(pg('createdb'), ['-h', '127.0.0.1', '-p', port, '-U', 'postgres', dbName], pgEnv);
  const migrationsDir = path.join(root, 'database', 'migrations');
  const migrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql') && file !== '006_demo_seed.sql').sort();
  for (const file of migrations) {
    run(pg('psql'), ['-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', dbName, '-v', 'ON_ERROR_STOP=1', '-f', path.join(migrationsDir, file)], pgEnv);
  }

  const appEnv = {
    ...process.env,
    DB_HOST: '127.0.0.1', DB_PORT: port, DB_USER: 'postgres', DB_NAME: dbName, DB_PASSWORD: dbPassword,
    KARIM_BOOTSTRAP_CREDENTIAL_DIR: credentialDir,
    NODE_ENV: 'test',
  };
  run(process.execPath, [path.join(root, 'scripts', 'migrate-plaintext-passwords.js')], appEnv);

  const userResult = run(pg('psql'), ['-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', dbName, '-tAc', "SELECT username || '|' || must_change_password::text || '|' || password FROM users WHERE username='admin' LIMIT 1"], pgEnv).trim();
  const [username, mustChange, hash] = userResult.split('|');
  const credentialFile = path.join(credentialDir, 'bootstrap-admin-credential.json');
  const assertions = {
    database_created: Boolean(userResult),
    migrations_applied: migrations.includes('032_first_login_password_rotation.sql'),
    admin_present: username === 'admin',
    password_is_bcrypt: /^\$2[aby]\$/.test(hash || ''),
    password_is_not_public_default: !/(^|\|)1234$/.test(hash || ''),
    must_change_password: mustChange === 'true',
    bootstrap_credential_created: fs.existsSync(credentialFile),
  };
  if (Object.values(assertions).some((value) => !value)) throw new Error(`Acceptance assertions failed: ${JSON.stringify(assertions)}`);
  writeReport({ ok: true, port: Number(port), migrations: migrations.length, assertions, timestamp: new Date().toISOString() });
  console.log(`ACCEPTANCE_POSTGRES_INIT=PASS migrations=${migrations.length}`);
} catch (error) {
  writeReport({ ok: false, error: error.message, timestamp: new Date().toISOString() });
  console.error(`ACCEPTANCE_POSTGRES_INIT=FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  if (clusterStarted) {
    try { run(pg('pg_ctl'), ['-D', dataDir, '-m', 'fast', '-w', 'stop']); } catch (_) {}
  }
}
