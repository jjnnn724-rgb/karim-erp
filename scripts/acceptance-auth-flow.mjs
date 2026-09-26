import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import process from 'process';
import { spawn, spawnSync } from 'child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pgBin = process.env.KARIM_ACCEPTANCE_PG_BIN || '/usr/lib/postgresql/16/bin';
const workDir = process.env.KARIM_AUTH_ACCEPTANCE_DIR || '/home/ubuntu/karim-auth-acceptance';
const reportFile = '/home/ubuntu/karim-auth-acceptance-result.json';
const dataDir = path.join(workDir, 'data');
const socketDir = path.join(workDir, 'socket');
const credentialDir = path.join(workDir, 'credentials');
const pgPort = String(process.env.KARIM_AUTH_ACCEPTANCE_PG_PORT || '55434');
const appPort = String(process.env.KARIM_AUTH_ACCEPTANCE_APP_PORT || '5501');
const dbName = 'karim_auth_acceptance';
const databasePassword = `Db_${crypto.randomBytes(18).toString('hex')}`;
const bootstrapPassword = `Boot${crypto.randomBytes(12).toString('hex')}9`;
const replacementPassword = `Rotate${crypto.randomBytes(12).toString('hex')}8`;
const apiKey = `Acceptance_${crypto.randomBytes(24).toString('hex')}`;
const jwtSecret = crypto.randomBytes(48).toString('hex');

function pg(binary) { return path.join(pgBin, binary); }
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', timeout: 180000 });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status}): ${(result.stderr || result.stdout || '').trim()}`);
  return result.stdout || '';
}
function writeReport(report) {
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
}
async function waitForHealth(url, headers) {
  let lastError = 'No response';
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) { lastError = error.message; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server health check did not become ready: ${lastError}`);
}
async function request(url, body, headers) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

let clusterStarted = false;
let server;
try {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(socketDir, { recursive: true });
  const passwordFile = path.join(workDir, 'postgres-password.txt');
  fs.writeFileSync(passwordFile, `${databasePassword}\n`, { mode: 0o600 });
  run(pg('initdb'), ['-D', dataDir, '-U', 'postgres', `--pwfile=${passwordFile}`, '--auth-host=scram-sha-256', '--auth-local=trust', '--no-locale']);
  fs.appendFileSync(path.join(dataDir, 'postgresql.conf'), `\nlisten_addresses = '127.0.0.1'\nport = ${pgPort}\n`);
  run(pg('pg_ctl'), ['-D', dataDir, '-o', `-p ${pgPort} -k ${socketDir}`, '-w', 'start']);
  clusterStarted = true;

  const pgEnv = { ...process.env, PGPASSWORD: databasePassword };
  run(pg('createdb'), ['-h', '127.0.0.1', '-p', pgPort, '-U', 'postgres', dbName], pgEnv);
  const migrations = fs.readdirSync(path.join(root, 'database', 'migrations')).filter((file) => file.endsWith('.sql') && file !== '006_demo_seed.sql').sort();
  for (const file of migrations) run(pg('psql'), ['-h', '127.0.0.1', '-p', pgPort, '-U', 'postgres', '-d', dbName, '-v', 'ON_ERROR_STOP=1', '-f', path.join(root, 'database', 'migrations', file)], pgEnv);

  const testEnv = {
    ...process.env,
    NODE_ENV: 'test', PORT: appPort, DB_HOST: '127.0.0.1', DB_PORT: pgPort, DB_USER: 'postgres', DB_NAME: dbName, DB_PASSWORD: databasePassword,
    KARIM_BOOTSTRAP_CREDENTIAL_DIR: credentialDir, KARIM_BOOTSTRAP_ADMIN_PASSWORD: bootstrapPassword,
    API_KEY: apiKey, JWT_SECRET: jwtSecret, PATH: `${pgBin}:${process.env.PATH}`,
  };
  run(process.execPath, [path.join(root, 'scripts', 'migrate-plaintext-passwords.js')], testEnv);
  const bootstrapRecord = JSON.parse(fs.readFileSync(path.join(credentialDir, 'bootstrap-admin-credential.json'), 'utf8'));
  if (bootstrapRecord.initial_password !== bootstrapPassword) throw new Error('Generated bootstrap credential did not match the isolated migration input.');

  const serverLog = fs.openSync(path.join(workDir, 'server.log'), 'a');
  server = spawn(process.execPath, [path.join(root, 'backend', 'server.js')], { cwd: root, env: testEnv, stdio: ['ignore', serverLog, serverLog] });
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const commonHeaders = { 'x-api-key': apiKey };
  await waitForHealth(`${baseUrl}/api/health`, commonHeaders);

  const initialLogin = await request(`${baseUrl}/api/auth/login`, { username: 'admin', password: bootstrapPassword }, commonHeaders);
  const blockedRequest = await request(`${baseUrl}/api/pos/departments`, null, { ...commonHeaders, authorization: `Bearer ${initialLogin.body.access_token || ''}` });
  const changed = await request(`${baseUrl}/api/auth/change-password`, { current_password: bootstrapPassword, new_password: replacementPassword }, { ...commonHeaders, authorization: `Bearer ${initialLogin.body.access_token || ''}` });
  const permittedRequest = await request(`${baseUrl}/api/pos/departments`, null, { ...commonHeaders, authorization: `Bearer ${changed.body.access_token || ''}` });
  const finalLogin = await request(`${baseUrl}/api/auth/login`, { username: 'admin', password: replacementPassword }, commonHeaders);
  const state = run(pg('psql'), ['-h', '127.0.0.1', '-p', pgPort, '-U', 'postgres', '-d', dbName, '-tAc', "SELECT must_change_password::text || '|' || (password_migrated_at IS NOT NULL)::text || '|' || password FROM users WHERE username='admin'"], pgEnv).trim().split('|');
  const assertions = {
    health_ok: true,
    initial_login_requires_rotation: initialLogin.status === 200 && initialLogin.body.password_change_required === true && initialLogin.body.error === 'PASSWORD_CHANGE_REQUIRED' && typeof initialLogin.body.access_token === 'string',
    restricted_token_blocks_operational_route: blockedRequest.status === 403 && blockedRequest.body.error === 'PASSWORD_CHANGE_REQUIRED',
    change_password_succeeds: changed.status === 200 && changed.body.password_change_required === false && typeof changed.body.access_token === 'string' && typeof changed.body.refresh_token === 'string',
    normal_token_permits_operational_route: permittedRequest.status === 200,
    login_after_rotation_succeeds: finalLogin.status === 200 && !finalLogin.body.password_change_required && typeof finalLogin.body.refresh_token === 'string',
    database_marks_rotation_complete: state[0] === 'false' && state[1] === 'true',
    stored_password_remains_bcrypt: /^\$2[aby]\$/.test(state[2] || ''),
  };
  if (Object.values(assertions).some((value) => !value)) throw new Error(`Authentication flow assertions failed: ${JSON.stringify(assertions)}`);
  writeReport({ ok: true, database: dbName, migrations: migrations.length, assertions, timestamp: new Date().toISOString() });
  console.log(`ACCEPTANCE_AUTH_FLOW=PASS migrations=${migrations.length}`);
} catch (error) {
  writeReport({ ok: false, error: error.message, timestamp: new Date().toISOString() });
  console.error(`ACCEPTANCE_AUTH_FLOW=FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  await stop(server);
  if (clusterStarted) {
    try { run(pg('pg_ctl'), ['-D', dataDir, '-m', 'fast', '-w', 'stop']); } catch (_) {}
  }
  fs.rmSync(workDir, { recursive: true, force: true });
}
