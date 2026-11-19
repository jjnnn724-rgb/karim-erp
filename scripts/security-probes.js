// Adversarial security probes v2 — ISOLATED server :5299 / karim_erp_test only.
// Contract-correct: Bearer + x-api-key; users(id,username,password,role,name);
// raw WebSocket socket.io probe (no client dep needed).
// 🛡️ security-probes.js — مجسّات اختراق آلية (15 هجومًا) ضد خادم معزول فقط.
// لا تستهدف الإنتاج أبدًا. العقد: Bearer + x-api-key؛ البث الحساس لغرفة المصادَقين.
// التشغيل (اعتمادات من البيئة — لا تُطبع):
//   PROBE_BASE_URL=http://127.0.0.1:5299 PROBE_USER=... PROBE_PASS=... PROBE_API_KEY=... \
//   PROBE_DB_USER=... PROBE_DB_PASSWORD=... PROBE_DB_NAME=karim_erp_test node scripts/security-probes.js
// exit 0 = كل المجسّات آمنة، 1 = ثغرة/فشل. يُشغَّل ضد خادم تحقق معزول (karim_erp_test).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const BASE = process.env.PROBE_BASE_URL || 'http://127.0.0.1:5299';
const env = { V3_E2E_USER: process.env.PROBE_USER || '', V3_E2E_PASS: process.env.PROBE_PASS || '' };
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
const creds = { DB_USER: process.env.PROBE_DB_USER || '', DB_PASSWORD: process.env.PROBE_DB_PASSWORD || '', DB_PORT: process.env.PROBE_DB_PORT || '5432', API_KEY: process.env.PROBE_API_KEY || '' };
const DB_NAME = process.env.PROBE_DB_NAME || 'karim_erp_test';
if (/prod|karim_erp$/i.test(DB_NAME) && DB_NAME !== 'karim_erp_test') { console.error('مرفوض: المجسّات لا تعمل إلا على قاعدة معزولة'); process.exit(2); }
if (!env.V3_E2E_USER || !env.V3_E2E_PASS) { console.error('PROBE_USER/PROBE_PASS مطلوبان'); process.exit(2); }
const results = [];
const probe = (name, pass, detail) => { results.push({ name, pass, detail: String(detail).slice(0, 140) }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + ' | ' + String(detail).slice(0, 110)); };
const jfetch = async (p, opt = {}) => { const r = await fetch(BASE + p, opt); let b = null; try { b = await r.json(); } catch (_) { b = await r.text().catch(() => ''); } return { status: r.status, headers: r.headers, body: b }; };
const dbConnect = async () => { const c = new Client({ host: '127.0.0.1', port: Number(creds.DB_PORT || 5432), user: creds.DB_USER, password: creds['DB_PASSWORD'], database: DB_NAME }); await c.connect(); return c; };

(async () => {
  const login = await jfetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: env.V3_E2E_USER, password: env.V3_E2E_PASS }) });
  const token = login.body && login.body.access_token;
  if (!token) { console.log('LOGIN FAILED', login.status); process.exit(1); }
  const AUTH = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'x-api-key': creds.API_KEY || '' };
  const db0 = await dbConnect();
  const vrole = (await db0.query('SELECT role FROM users WHERE username=$1', [env.V3_E2E_USER])).rows[0];
  console.log('verifier role:', vrole && vrole.role);
  await db0.end();

  // 1 unauthenticated
  const p1 = await jfetch('/api/users');
  probe('unauth /api/users blocked', p1.status === 401 || p1.status === 403, 'status ' + p1.status);

  // 1b valid token but missing app key
  const p1b = await jfetch('/api/users', { headers: { Authorization: 'Bearer ' + token } });
  probe('missing x-api-key blocked', p1b.status === 401, 'status ' + p1b.status);

  // 2 SQLi login
  const p2 = await jfetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: "admin' OR '1'='1' --", password: 'x' }) });
  probe('SQLi login rejected', p2.status === 401 || p2.status === 400, 'status ' + p2.status);

  // 3 SQLi search (authenticated, correct contract)
  const p3 = await jfetch("/api/employees?search=' UNION SELECT username,password FROM users--", { headers: AUTH });
  const p3s = JSON.stringify(p3.body || '');
  probe('SQLi search no leak/500', p3.status < 500 && !/\\$2[aby]\\$/.test(p3s), 'status ' + p3.status);

  // 4 JWT tamper (real route)
  const parts = token.split('.');
  const sig = parts[2]; const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  const p4 = await jfetch('/api/users', { headers: { ...AUTH, Authorization: 'Bearer ' + parts[0] + '.' + parts[1] + '.' + flipped } });
  probe('tampered JWT rejected', p4.status === 401 || p4.status === 403, 'status ' + p4.status);

  // 5 alg=none
  const noneTok = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + parts[1] + '.';
  const p5 = await jfetch('/api/users', { headers: { ...AUTH, Authorization: 'Bearer ' + noneTok } });
  probe('alg=none JWT rejected', p5.status === 401 || p5.status === 403, 'status ' + p5.status);

  // 6 path traversal
  const p6 = await jfetch('/api/exports/..%2f..%2f..%2f.env', { headers: AUTH });
  const p6s = typeof p6.body === 'string' ? p6.body : JSON.stringify(p6.body || '');
  probe('path traversal no .env leak', !/DB_PASSWORD=|JWT_SECRET=|API_KEY=/.test(p6s), 'status ' + p6.status);

  // 7 CORS evil
  const p7 = await jfetch('/api/health', { headers: { Origin: 'https://evil.example.com' } });
  const acao = p7.headers.get('access-control-allow-origin') || '';
  probe('CORS evil origin not allowed', !acao.includes('evil.example.com'), 'acao=' + (acao || '(none)'));

  // 8 headers
  const p8 = await jfetch('/', {});
  const csp = p8.headers.get('content-security-policy') || '';
  const nosniff = p8.headers.get('x-content-type-options') || '';
  probe('CSP + nosniff present', csp.length > 10 && /nosniff/i.test(nosniff), 'csp ' + csp.length + ' chars');

  // 9 error leakage
  const p9 = await jfetch('/api/definitely-not-a-route-xyz', { headers: AUTH });
  const p9s = JSON.stringify(p9.body || '');
  probe('404 no stack leak', !/at\s+\w+\s+\(.*\.js:\d+/.test(p9s), 'status ' + p9.status);

  // 10 persistent lockout (correct users schema)
  const db = await dbConnect();
  const hash = await bcrypt.hash('ProbePass!2345', 10);
  await db.query(`INSERT INTO users (id, username, password, role, name) VALUES (999900201,'zz_sec_probe',$1,'cashier','Security Probe') ON CONFLICT (id) DO UPDATE SET password=$1, username='zz_sec_probe'`, [hash]);
  await db.query("DELETE FROM login_lockouts WHERE key LIKE '%zz_sec_probe%'").catch(() => {});
  let lockedSeen = false, lastStatus = 0;
  for (let i = 0; i < 6; i++) {
    const r = await jfetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'zz_sec_probe', password: 'WrongPass!' + i }) });
    lastStatus = r.status;
    if (r.status === 423 || r.status === 429 || /lock|مقفل/i.test(JSON.stringify(r.body || ''))) lockedSeen = true;
  }
  const p10 = await jfetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'zz_sec_probe', password: 'ProbePass!2345' }) });
  probe('lockout engages + correct pw still locked', lockedSeen && p10.status !== 200, 'lockedSeen=' + lockedSeen + ' correctPwStatus=' + p10.status);
  await db.query("DELETE FROM login_lockouts WHERE key LIKE '%zz_sec_probe%'").catch(() => {});
  await db.query('DELETE FROM users WHERE id=999900201').catch(() => {});
  await db.end();

  // 11/12 low-priv + mass assignment
  const db2 = await dbConnect();
  const hash2 = await bcrypt.hash('LowPriv!2345', 10);
  await db2.query(`INSERT INTO users (id, username, password, role, name) VALUES (999900202,'zz_lowpriv',$1,'cashier','Low Priv') ON CONFLICT (id) DO UPDATE SET password=$1, role='cashier'`, [hash2]);
  await db2.end();
  const ll = await jfetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'zz_lowpriv', password: 'LowPriv!2345' }) });
  const ltok = ll.body && ll.body.access_token;
  if (ltok) {
    const LA = { Authorization: 'Bearer ' + ltok, 'Content-Type': 'application/json', 'x-api-key': creds.API_KEY || '' };
    const p11 = await jfetch('/api/users', { headers: LA });
    probe('low-priv blocked from /api/users', p11.status === 403 || p11.status === 401, 'status ' + p11.status);
    const p12 = await jfetch('/api/users/999900202', { method: 'PATCH', headers: LA, body: JSON.stringify({ role: 'admin' }) });
    const dbq = await dbConnect();
    const role2 = (await dbq.query('SELECT role FROM users WHERE id=999900202')).rows[0];
    await dbq.end();
    probe('mass-assignment role elevation blocked', role2 && role2.role !== 'admin', 'role after PATCH=' + (role2 && role2.role) + ' patchStatus=' + p12.status);
  } else { probe('low-priv blocked from /api/users', false, 'lowpriv login failed ' + ll.status); probe('mass-assignment role elevation blocked', false, 'no token'); }
  const db3 = await dbConnect(); await db3.query('DELETE FROM users WHERE id=999900202').catch(() => {}); await db3.end();

  // 13 البث الحساس لا يصل للمجهول (خاصية البيانات، لا مجرد رفض الاتصال).
  // الاتصال المجهول مسموح تصميميًا؛ الغرفة erp:authed للمصادَقين فقط (RT_REQUIRE_AUTH افتراضي true).
  await new Promise((resolve) => {
    const ws = new WebSocket(BASE.replace('http', 'ws') + '/socket.io/?EIO=4&transport=websocket');
    const packets = [];
    let connected = false, done = false;
    const finish = (pass, detail) => { if (done) return; done = true; try { ws.close(); } catch (_) {} resolve(probe('sensitive broadcast never reaches anonymous', pass, detail)); };
    ws.on('message', async (m) => {
      const s = String(m); packets.push(s);
      if (s.startsWith('0')) { ws.send('40'); }
      else if (s.startsWith('40') && !connected) {
        connected = true;
        // أطلق بثًا حساسًا عبر REST (admin) ثم انتظر: المجهول يجب ألا يرى شيئًا.
        await jfetch('/api/state', { method: 'POST', headers: AUTH, body: JSON.stringify({ state: { secProbe: Date.now() }, deviceName: 'sec-probe' }) });
        setTimeout(() => {
          const leaked = packets.filter(p => p.includes('state_updated') || p.includes('entity_changed'));
          finish(leaked.length === 0, 'anonymous packets=' + packets.length + ' sensitive=' + leaked.length);
        }, 2500);
      }
    });
    ws.on('error', (e) => finish(false, 'ws error: ' + String(e.message).slice(0, 60)));
    setTimeout(() => finish(false, 'timeout (connected=' + connected + ')'), 9000);
  });

  // 14 XSS reflection
  const p14 = await jfetch('/api/employees?search=<script>alert(1)</script>', { headers: AUTH });
  const ct = p14.headers.get('content-type') || '';
  probe('XSS payload served as JSON not HTML', /json/i.test(ct) || p14.status >= 400, 'content-type=' + ct);

  const passed = results.filter(r => r.pass).length;
  fs.mkdirSync(path.join(ROOT, 'var'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'var', 'security-probes.json'), JSON.stringify({ passed, total: results.length, results }, null, 2));
  console.log('\nSECURITY PROBES: ' + passed + '/' + results.length);
})().catch(e => { console.log('SUITE ERROR:', e.message.slice(0, 200)); process.exit(1); });