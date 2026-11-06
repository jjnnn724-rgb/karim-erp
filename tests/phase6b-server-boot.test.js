/**
 * phase6b-server-boot.test.js — Phase 6b: server.js الكامل في بيئة معزولة
 * ════════════════════════════════════════════════════════════════════════════
 * يشغّل backend/server.js الحقيقي (نفس نقطة الإقلاع التي تعمل في الإنتاج) على
 * قاعدة staging مستعادة من النسخة الاحتياطية، مع:
 *   • YARASOFT_ENABLED=false وYARASOFT_ORACLE_ENABLED=false
 *   • KARIM_LAN_BEACON=false (لا بيكل LAN)
 *   • حارس phase6b-egress-guard عبر NODE_OPTIONS يقطع TCP/UDP/DNS خارج loopback،
 *     يمنع تحميل oracledb، ويجبر الاستماع على 127.0.0.1 بدل 0.0.0.0.
 *
 * ثم يثبت عبر HTTPS حقيقي: صحة الإقلاع، ترحيل قيد، ميزان مراجعة، تدفق نقدي،
 * CFO، تسوية بنكية (بخريطة غائبة ⇒ fallback)، وإقفال/فتح فترة. وأخيرًا يقرأ
 * سجل الحارس ليثبت صفر محاولة خروج.
 *
 * المتطلبات (env):
 *   PHASE6B_DB      اسم قاعدة staging (افتراضي karim_erp_phase6b)
 *   PHASE6B_PORT    منفذ loopback (افتراضي 18973)
 *   PHASE6B_DUMP    مسار dump لإنشاء القاعدة إن لم تكن موجودة
 *   PHASE6B_KEEP_DB =1 لإبقاء القاعدة بعد الاختبار (افتراضي: تُحذف)
 *   PHASE6B_EXPECT_MAPPING =1 لقاعدة بعد التطبيق: account_mapping يجب أن
 *   تكون موجودة وغير فارغة (بدل افتراض الغياب قبل الهجرات).
 *
 * قفل الإنتاج (إلزامي): تشغيل الهارنس على قاعدة الإنتاج karim_erp مرفوض إلا إذا
 * كان PHASE6B_PRODUCTION_WINDOW=1 AND الخدمة الإنتاجية متوقفة AND لا يوجد أي
 * backend آخر على القاعدة. القواعد الأخرى (staging) تعمل بلا القفل.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn, execFileSync } = require('child_process');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PG_BIN = 'C:/Program Files/PostgreSQL/18/bin';
const DB = process.env.PHASE6B_DB || 'karim_erp_phase6b';
const PORT = Number(process.env.PHASE6B_PORT || 18973);
const GUARD = path.join(ROOT, 'scripts', 'phase6b-egress-guard.js');
const SERVER = path.join(ROOT, 'backend', 'server.js');
const RUN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'phase6b-'));
const EGRESS_LOG = path.join(RUN_DIR, 'egress.jsonl');
const OUT_LOG = path.join(RUN_DIR, 'server.out.log');
const ERR_LOG = path.join(RUN_DIR, 'server.err.log');

function loadEnv() {
    const env = {};
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) {env[m[1]] = m[2];}
    }
    return env;
}

const ENV = loadEnv();
const PRODUCTION_DB = 'karim_erp';
const PRODUCTION_PORT = Number(ENV.PORT || 5000);

async function assertProductionWindow() {
    if (DB !== PRODUCTION_DB) {return { mode: 'staging', db: DB };}

    if (process.env.PHASE6B_PRODUCTION_WINDOW !== '1') {
        throw new Error(
            `رفض: قاعدة ${PRODUCTION_DB} إنتاجية. اضبط PHASE6B_PRODUCTION_WINDOW=1 داخل نافذة مغلقة فقط، `
            + 'أو شغّل الهارنس على قاعدة staging.'
        );
    }
    if (PORT === PRODUCTION_PORT) {
        throw new Error(`رفض: PHASE6B_PORT=${PORT} يطابق منفذ الخدمة الإنتاجية — اختر منفذًا آخر.`);
    }

    const c = adminClient('postgres');
    await c.connect();
    try {
        let others = [];
        for (let i = 0; i < 2; i++) {
            const r = await c.query(
                `SELECT pid, datname, usename, COALESCE(client_addr::text, 'local') AS addr, state,
                        EXTRACT(EPOCH FROM (now() - state_change))::int AS state_seconds
                   FROM pg_stat_activity
                  WHERE backend_type = 'client backend' AND datname = $1
                    AND pid <> pg_backend_pid()`, [PRODUCTION_DB]);
            others = r.rows;
            if (!others.length) {break;}
            await new Promise((res) => setTimeout(res, 500));
        }
        if (others.length) {
            const lines = others.map((r) => `pid=${r.pid} user=${r.usename} from=${r.addr} state=${r.state} منذ ${r.state_seconds}s`);
            throw new Error(`رفض: ${others.length} اتصال آخر على ${PRODUCTION_DB} — النافذة ليست مغلقة:\n${lines.join('\n')}`);
        }
    } finally { await c.end(); }

    const listening = await new Promise((resolve) => {
        const s = require('net').connect({ host: '127.0.0.1', port: PRODUCTION_PORT });
        const done = (v) => { s.destroy(); resolve(v); };
        s.setTimeout(1200, () => done(false));
        s.once('connect', () => done(true));
        s.once('error', () => done(false));
    });
    if (listening) {
        throw new Error(`رفض: الخدمة الإنتاجية ما زالت تستمع على 127.0.0.1:${PRODUCTION_PORT} — أوقفها قبل التشغيل.`);
    }

    return { mode: 'production', db: PRODUCTION_DB, productionPort: PRODUCTION_PORT, otherBackends: 0, serviceStopped: true };
}


function adminClient(database) {
    return new Client({
        host: ENV.DB_HOST || '127.0.0.1',
        port: Number(ENV.DB_PORT) || 5432,
        user: ENV.DB_ADMIN_USER,
        password: ENV.DB_ADMIN_PASSWORD,
        database,
    });
}

async function dbExists(name) {
    const c = adminClient('postgres');
    await c.connect();
    try {
        const r = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
        return r.rowCount > 0;
    } finally { await c.end(); }
}

async function ensureRestoredDb() {
    if (await dbExists(DB)) {return { created: false };}
    const dump = process.env.PHASE6B_DUMP;
    if (!dump || !fs.existsSync(dump)) {
        throw new Error(`قاعدة ${DB} غير موجودة و PHASE6B_DUMP غير صالح — شغّل الاستعادة أولًا أو مرّر مسار dump.`);
    }
    const c = adminClient('postgres');
    await c.connect();
    try {
        await c.query(`CREATE DATABASE ${JSON.stringify(DB).replace(/"/g, '"')} OWNER ${ENV.DB_USER}`);
    } finally { await c.end(); }
    execFileSync(path.join(PG_BIN, 'pg_restore.exe'), [
        '-h', ENV.DB_HOST || '127.0.0.1', '-p', String(ENV.DB_PORT || 5432),
        '-U', ENV.DB_ADMIN_USER, '-d', DB, '--jobs=4', dump,
    ], { env: { ...process.env, PGPASSWORD: ENV.DB_ADMIN_PASSWORD }, timeout: 600000 });
    return { created: true };
}

async function dropDb() {
    const c = adminClient('postgres');
    await c.connect();
    try {
        await c.query(`DROP DATABASE IF EXISTS "${String(DB).replace(/"/g, '""')}" WITH (FORCE)`);
    } finally { await c.end(); }
}

function httpsJson(method, p, { body, token } = {}) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const req = https.request({
            host: '127.0.0.1', port: PORT, path: p, method,
            rejectUnauthorized: false,
            headers: {
                ...(ENV.API_KEY ? { 'x-api-key': ENV.API_KEY } : {}),
                ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
                ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
        }, (res) => {
            let s = '';
            res.on('data', (c) => { s += c; });
            res.on('end', () => {
                let parsed = null;
                try { parsed = JSON.parse(s); } catch (_) { /* نص غير JSON */ }
                resolve({ status: res.statusCode, body: parsed, raw: s.slice(0, 400) });
            });
        });
        req.on('error', reject);
        if (data) { req.write(data); }
        req.end();
    });
}

async function waitReady(deadlineMs = 180000) {
    const started = Date.now();
    let last = '';
    while (Date.now() - started < deadlineMs) {
        if (child && child.exitCode !== null) {
            throw new Error(`server.js خرج مبكرًا (${child.exitCode}). stderr:\n${tail(ERR_LOG)}`);
        }
        try {
            const r = await httpsJson('GET', '/api/health/startup');
            if (r.status === 200) {return r;}
            last = `${r.status} ${r.raw}`;
        } catch (e) {
            last = e.message;
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`لم يجهز /api/health/startup خلال ${deadlineMs}ms — آخر محاولة: ${last}\nstderr:\n${tail(ERR_LOG)}`);
}

function tail(file, n = 40) {
    try {
        return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-n).join('\n');
    } catch (_) { return '(no log)'; }
}

let child = null;
let token = null;
let createdDb = false;
const state = {};

jest.setTimeout(600000);

beforeAll(async () => {
    state.window = await assertProductionWindow();
    const restored = await ensureRestoredDb();
    createdDb = restored.created;

    const c = adminClient(DB);
    await c.connect();
    let user;
    try {
        const r = await c.query(
            `SELECT id, role, username FROM users
              WHERE role IN ('admin','owner') AND active = TRUE ORDER BY id LIMIT 1`);
        user = r.rows[0];
        state.accountMapping = (await c.query(`SELECT to_regclass('public.account_mapping')::text AS t`)).rows[0].t;
        state.mappingCount = state.accountMapping
            ? (await c.query('SELECT COUNT(*)::int AS n FROM account_mapping')).rows[0].n
            : 0;
    } finally { await c.end(); }
    if (!user) { throw new Error('لا يوجد مستخدم admin نشط في القاعدة المستعادة'); }
    state.user = user;

    token = jwt.sign(
        { sub: String(user.id), role: user.role, name: user.username || 'phase6b', purpose: 'access' },
        ENV.JWT_ACCESS_SECRET,
        { expiresIn: '15m', algorithm: 'HS256' }
    );

    const out = fs.openSync(OUT_LOG, 'w');
    const err = fs.openSync(ERR_LOG, 'w');
    const env = {
        ...process.env,
        ...ENV,
        NODE_ENV: 'production',
        PORT: String(PORT),
        HOST: '127.0.0.1',
        DB_NAME: DB,
        YARASOFT_ENABLED: 'false',
        YARASOFT_ORACLE_ENABLED: 'false',
        KARIM_LAN_BEACON: 'false',
        WARMUP_ENABLED: 'false',
        WHATSAPP_ENABLED: 'false',
        PUSH_ENABLED: 'false',
        SKIP_BULLMQ: 'true',
        GOVERNANCE_SCHEDULER: 'false',
        PHASE6B_EGRESS_LOG: EGRESS_LOG,
        NODE_OPTIONS: `--require ${GUARD.replace(/\\/g, '/')}`,
    };
    child = spawn(process.execPath, [SERVER], { cwd: ROOT, env, stdio: ['ignore', out, err] });
    await waitReady();
});

afterAll(async () => {
    if (child && child.exitCode === null) {
        child.kill();
        const t0 = Date.now();
        while (child.exitCode === null && Date.now() - t0 < 20000) {
            await new Promise((r) => setTimeout(r, 250));
        }
        if (child.exitCode === null) { child.kill('SIGKILL'); }
    }
    if (createdDb && process.env.PHASE6B_KEEP_DB !== '1') {
        await dropDb().catch(() => {});
    }
    // الطباعة قبل تنظيف مجلد التشغيل: الأدلة تبقى في مخرجات الاختبار.
    console.log('PHASE6B_EVIDENCE ' + JSON.stringify({
        db: DB, port: PORT, restoredByTest: createdDb,
        window: state.window,
        accountMappingTable: state.accountMapping,
        user: state.user,
        health: state.health,
        journal: state.journal,
        tb: state.tb,
        cashFlow: state.cashFlow,
        cfo: state.cfo,
        bankRec: state.bankRec,
        period: state.period,
        egress: state.egress,
        serverExit: child ? child.exitCode : null,
    }));
    try { fs.rmSync(RUN_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('Phase 6b — server.js كامل، شبكة مقطوعة', () => {
    test('1) الإقلاع الكامل والفحوص الصحية', async () => {
        const live = await httpsJson('GET', '/api/health/live');
        const startup = await httpsJson('GET', '/api/health/startup');
        const ready = await httpsJson('GET', '/api/health/ready');
        state.health = { live: live.status, startup: startup.status, ready: ready.status, readyState: ready.body?.status };
        expect(live.status).toBe(200);
        expect(startup.status).toBe(200);
        expect(ready.status).toBe(200);
        expect(ready.body.status).toBe('ok');
    });

    test('2) حالة account_mapping مطابقة لمرحلة القاعدة (fallback أو مُهاجَرة)', async () => {
        if (process.env.PHASE6B_EXPECT_MAPPING === '1') {
            expect(state.accountMapping).toBe('account_mapping');
            expect(state.mappingCount).toBeGreaterThan(0);
        } else {
            expect(state.accountMapping).toBeNull();
        }
    });

    test('3) ترحيل قيد حقيقي عبر HTTP ثم ميزان مراجعة متوازن', async () => {
        const runId = `zz-phase6b-${Date.now()}`;
        // الأساس: القاعدة المستعادة قابلة لإعادة التشغيل، فهي قد تحمل قيود جولات سابقة.
        // live=1: تجاوز كاش الـGET (30s) — القياس يجب أن يقرأ ما رُحّل للتو.
        const before = await httpsJson('GET', '/api/accounting/bank-rec?account=1010&from=2019-07-01&to=2019-07-31&live=1', { token });
        expect(before.status).toBe(200);
        state.bankBefore = Number(before.body.book || 0);
        const post = await httpsJson('POST', '/api/accounting/journal', {
            token,
            body: {
                date: '2019-07-15',
                memo: 'ZZ Phase6b قيد عبر السيرفر الكامل',
                source_id: runId,
                lines: [
                    { account_code: '1010', debit: 250, credit: 0, memo: 'ZZ تحصيل بنكي' },
                    { account_code: '4000', debit: 0, credit: 250, memo: 'ZZ إيراد' },
                ],
            },
        });
        expect(post.status).toBe(201);
        // journal_entries لا تحمل أعمدة إجماليات — نجمع السطور المرجعة من الإنشاء نفسه.
        const sum = (k) => (post.body.lines || []).reduce((s, l) => s + Number(l[k] || 0), 0);
        const dr = sum('debit');
        const cr = sum('credit');
        expect(dr).toBe(250);
        expect(cr).toBe(250);
        state.journal = { status: post.status, entryNo: post.body.entry.entry_no, debit: dr, credit: cr, lines: (post.body.lines || []).length };

        const tb = await httpsJson('GET', '/api/accounting/trial-balance?from=2019-07-01&to=2019-07-31&live=1', { token });
        expect(tb.status).toBe(200);
        expect(tb.body.balanced).toBe(true);
        const acc4000 = tb.body.accounts.find((a) => a.code === '4000');
        expect(Number(acc4000.credit)).toBeGreaterThanOrEqual(250);
        state.tb = { totalDebit: tb.body.total_debit, totalCredit: tb.body.total_credit, balanced: tb.body.balanced };
    });

    test('4) تدفق نقدي وCFO وتسوية بنكية عبر fallback (الخريطة غائبة)', async () => {
        const cf = await httpsJson('GET', '/api/accounting/cash-flow?from=2019-07-01&to=2019-07-31&live=1', { token });
        expect(cf.status).toBe(200);
        expect(Number(cf.body.inflow)).toBeGreaterThanOrEqual(250);
        state.cashFlow = { status: cf.status, inflow: cf.body.inflow, outflow: cf.body.outflow };

        const cfo = await httpsJson('GET', '/api/accounting/cfo-summary?from=2019-07-01&to=2019-07-31&live=1', { token });
        expect(cfo.status).toBe(200);
        expect(Number.isFinite(Number(cfo.body.revenue?.total))).toBe(true);
        state.cfo = { status: cfo.status, revenue: cfo.body.revenue?.total, net: cfo.body.net_profit?.amount };

        const bank = await httpsJson('GET', '/api/accounting/bank-rec?account=1010&from=2019-07-01&to=2019-07-31&live=1', { token });
        expect(bank.status).toBe(200);
        expect(Number(bank.body.book) - state.bankBefore).toBe(250);
        state.bankRec = { status: bank.status, before: state.bankBefore, book: bank.body.book, statement: bank.body.statement, diff: bank.body.diff };
    });

    test('5) إقفال فترة عبر HTTP يمنع الترحيل ثم يُفتح', async () => {
        const closed = await httpsJson('POST', '/api/accounting/periods/2019-07/close', { token, body: { note: 'zz-phase6b close' } });
        expect(closed.status).toBe(200);

        const blocked = await httpsJson('POST', '/api/accounting/journal', {
            token,
            body: {
                date: '2019-07-20', memo: 'ZZ يجب أن يُرفض', source_id: 'zz-phase6b-locked',
                lines: [
                    { account_code: '1010', debit: 10, credit: 0 },
                    { account_code: '4000', debit: 0, credit: 10 },
                ],
            },
        });
        expect(blocked.status).toBe(423);

        const reopened = await httpsJson('POST', '/api/accounting/periods/2019-07/open', { token, body: { note: 'zz-phase6b reopen' } });
        expect(reopened.status).toBe(200);
        state.period = { close: closed.status, blocked: blocked.status, reopen: reopened.status };
    });

    test('6) سجل الحارس: صفر خروج، صفر oracledb، والاستماع على loopback فقط', async () => {
        // سطر summary يُكتب عند خروج العملية (afterAll) — نكتفي هنا بالسطور الحية.
        const t0 = Date.now();
        while (!fs.existsSync(EGRESS_LOG) && Date.now() - t0 < 5000) {
            await new Promise((r) => setTimeout(r, 100));
        }
        expect(fs.existsSync(EGRESS_LOG)).toBe(true);
        const lines = fs.readFileSync(EGRESS_LOG, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
        const loaded = lines.filter((l) => l.kind === 'guard-loaded');
        const blocked = lines.filter((l) => /^blocked-(tcp|udp|dns|oracledb)/.test(l.kind));
        const forced = lines.filter((l) => l.kind === 'listen-forced');
        state.egress = {
            guardLoadedPids: loaded.map((l) => l.pid),
            serverPid: child.pid,
            blocked,
            oracleAttempts: lines.filter((l) => l.kind === 'blocked-oracledb-require').length,
            listenForced: forced,
            recordedLines: lines.length,
        };
        // الحارس يجب أن يكون محمّلًا داخل عملية السيرفر نفسها — لا في عملية أخرى.
        expect(loaded.some((l) => l.pid === child.pid)).toBe(true);
        expect(blocked).toEqual([]);
        expect(state.egress.oracleAttempts).toBe(0);
        // server.js يطلب 0.0.0.0 صراحة (server.js:3199)، فالحارس عليه أن يجبره على loopback.
        expect(forced.some((f) => f.to === '127.0.0.1' && Number(f.port) === Number(PORT))).toBe(true);

        // دليل حي إضافي: المنفذ غير مفتوح على عنوان LAN إطلاقًا.
        const lan = Object.values(os.networkInterfaces()).flat()
            .find((i) => i && !i.internal && i.family === 'IPv4');
        if (lan) {
            const exposed = await new Promise((resolve) => {
                const s = require('net').connect({ host: lan.address, port: PORT });
                const done = (v) => { s.destroy(); resolve(v); };
                s.setTimeout(1500, () => done(false));
                s.once('connect', () => done(true));
                s.once('error', () => done(false));
            });
            state.egress.lanProbe = { host: lan.address, connected: exposed };
            expect(exposed).toBe(false);
        }
        expect(state.health.live).toBe(200);
    });
});
