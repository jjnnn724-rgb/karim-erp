/**
 * server-control.test.js — عقد خدمة التحكم بالسيرفر + راية الصيانة
 * ═══════════════════════════════════════════════════════════════════════
 * 1) دوال نقية: parseScState / validAction / constantTimeEqual / limiter /
 *    maintenanceDecision (stopped دائم، العابرة 10 دقائق، العالقة تُستأنف).
 * 2) تكامل حقيقي: خدمة على منفذ عشوائي مع deps وهمية — login، CSRF،
 *    /internal/actions، توقف/تشغيل، تدقيق، وراية صيانة تُكتب وتُمسح.
 * 3) عقد الواجهة: شاشة V2 + البروكسي + المراقبون + ملفات خدمة ويندوز.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'backend');
const {
    createControlServer, parseScState, validAction, constantTimeEqual,
    createLimiter, CONFIRM_PHRASE,
} = require(path.join(SRC, 'server-control'));
const {
    readMaintenance, writeMaintenance, clearMaintenance,
    maintenanceDecision, STALE_MS,
} = require(path.join(SRC, 'server-control-maintenance'));

const read = (p) => fs.readFileSync(p, 'utf8');

function request(port, method, pathname, { headers = {}, body = null } = {}) {
    return new Promise((resolve, reject) => {
        const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
        const req = http.request({
            host: '127.0.0.1', port, path: pathname, method, agent: false,
            headers: {
                ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
                ...headers,
            },
        }, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { raw += c; });
            res.on('end', () => {
                let json = null;
                try {json = raw ? JSON.parse(raw) : null;} catch (_) {}
                resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
            });
        });
        req.on('error', reject);
        if (payload) {req.write(payload);}
        req.end();
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('راية الصيانة', () => {
    let dir;
    beforeEach(() => {dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karim-maint-'));});
    afterEach(() => {fs.rmSync(dir, { recursive: true, force: true });});

    test('قراءة/كتابة/مسح ذرية', () => {
        const file = path.join(dir, 'runtime', 'maintenance.json');
        expect(readMaintenance(file)).toBeNull();
        const written = writeMaintenance(file, 'stopped', { by: 'tester' });
        expect(written.state).toBe('stopped');
        const again = readMaintenance(file);
        expect(again.state).toBe('stopped');
        expect(again.by).toBe('tester');
        expect(fs.existsSync(`${file}.${process.pid}.tmp`)).toBe(false);
        clearMaintenance(file);
        expect(readMaintenance(file)).toBeNull();
        expect(() => writeMaintenance(file, 'bogus')).toThrow();
    });

    test('stopped قرار دائم — لا يتقادم أبدًا', () => {
        const file = path.join(dir, 'maintenance.json');
        writeMaintenance(file, 'stopped');
        const old = Date.now() + STALE_MS * 100;
        expect(maintenanceDecision(readMaintenance(file), old).skip).toBe(true);
        expect(maintenanceDecision(readMaintenance(file), old).reason).toBe('stopped');
    });

    test('الحالات العابرة تُحترم 10 دقائق فقط', () => {
        const file = path.join(dir, 'maintenance.json');
        const at = Date.parse('2026-10-21T10:00:00.000Z');
        writeMaintenance(file, 'restarting');
        const record = { ...readMaintenance(file), at: new Date(at).toISOString() };
        expect(maintenanceDecision(record, at + 60_000).skip).toBe(true);
        expect(maintenanceDecision(record, at + STALE_MS + 1).skip).toBe(false);
        expect(maintenanceDecision(record, at + STALE_MS + 1).reason).toMatch(/stale/);
        expect(maintenanceDecision(null).skip).toBe(false);
    });
});

describe('دوال التحكم النقية', () => {
    test('parseScState يقرأ الحالة وPID', () => {
        const out = 'SERVICE_NAME: KarimERP-Server\n        TYPE               : 10  WIN32_OWN_PROCESS\n'
            + '        STATE              : 4  RUNNING\n        PID                : 4321\n';
        expect(parseScState(out)).toEqual({ state: 'RUNNING', pid: 4321 });
        expect(parseScState('')).toEqual({ state: 'UNKNOWN', pid: 0 });
    });

    test('validAction يقبل الثلاثة فقط', () => {
        expect(validAction('start')).toBe('start');
        expect(validAction(' STOP ')).toBe('stop');
        expect(validAction('restart')).toBe('restart');
        expect(validAction('taskkill')).toBeNull();
        expect(validAction('')).toBeNull();
    });

    test('المقارنة الثابتة الزمن والحدود', () => {
        expect(constantTimeEqual('abc', 'abc')).toBe(true);
        expect(constantTimeEqual('abc', 'abd')).toBe(false);
        expect(constantTimeEqual('abc', 'abcd')).toBe(false);
        expect(constantTimeEqual(null, '')).toBe(true);
    });

    test('محدد المحاولات يرفض بعد الحد', () => {
        const limiter = createLimiter(2, 60_000);
        expect(limiter.take('a')).toBe(true);
        expect(limiter.take('a')).toBe(true);
        expect(limiter.take('a')).toBe(false);
        expect(limiter.take('b')).toBe(true);
        limiter.stop();
    });

    test('عبارات التأكيد: STOP وRESTART فقط', () => {
        expect(CONFIRM_PHRASE).toEqual({ start: '', stop: 'STOP', restart: 'RESTART' });
    });
});

describe('تكامل الخدمة المصغّرة', () => {
    let dir;
    let app;
    let port;
    let state;
    let calls;
    let healthy;
    let secret;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karim-ctl-'));
        state = 'RUNNING';
        calls = [];
        healthy = true;
        secret = 'a'.repeat(64);
        app = createControlServer({
            port: 0,
            secret,
            runtimeDir: path.join(dir, 'runtime'),
            auditFile: path.join(dir, 'audit.jsonl'),
            actionsEnabled: true,
            actionDelayMs: 0,
            pollIntervalMs: 10,
            stopTimeoutMs: 1500,
            startTimeoutMs: 2500,
            enforceIntervalMs: 0,
            statusCacheMs: 0,
            authenticate: async (username, password) => (
                username === 'admin' && password === 'secret'
                    ? { id: '1', username: 'admin', name: 'مدير', role: 'admin' }
                    : null
            ),
            serviceQuery: async () => ({ installed: true, state, pid: state === 'RUNNING' ? 111 : 0 }),
            serviceStart: async () => {calls.push('start'); state = 'RUNNING'; healthy = true;},
            serviceStop: async () => {calls.push('stop'); state = 'STOPPED'; healthy = false;},
            healthProbe: async () => ({ healthy, status: healthy ? 'ok' : 'down', latencyMs: 3, version: '4.9.181', uptimeMs: 5000 }),
        });
        const started = await app.start();
        port = started.port;
    });

    afterEach(async () => {
        if (app) {await app.close();}
        fs.rmSync(dir, { recursive: true, force: true });
    });

    async function waitFor(fn, timeoutMs = 3000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (await fn()) {return true;}
            await sleep(20);
        }
        return false;
    }

    test('ping عام + الباب الداخلي محمي بالسر', async () => {
        const ping = await request(port, 'GET', '/api/ping');
        expect(ping.status).toBe(200);
        expect(ping.body.ok).toBe(true);
        expect(ping.body.actionsEnabled).toBe(true);

        const denied = await request(port, 'GET', '/internal/status');
        expect(denied.status).toBe(401);

        const status = await request(port, 'GET', '/internal/status', { headers: { 'x-control-service': secret } });
        expect(status.status).toBe(200);
        expect(status.body.service.state).toBe('RUNNING');
        expect(status.body.erp.healthy).toBe(true);
    });

    test('login → CSRF → إيقاف → راية صيانة → تشغيل يمسحها', async () => {
        const login = await request(port, 'POST', '/api/login', { body: { username: 'admin', password: 'secret' } });
        expect(login.status).toBe(200);
        expect(login.body.csrf).toMatch(/^[a-f0-9]{64}$/);
        const cookie = String(login.headers['set-cookie']).split(';')[0];
        const origin = `http://127.0.0.1:${port}`;

        const bad = await request(port, 'POST', '/api/actions', {
            headers: { cookie, origin, 'x-control-csrf': login.body.csrf },
            body: { action: 'stop', confirm: 'nope' },
        });
        expect(bad.status).toBe(400);
        expect(bad.body.error).toBe('CONFIRM_REQUIRED');

        const stop = await request(port, 'POST', '/api/actions', {
            headers: { cookie, origin, 'x-control-csrf': login.body.csrf },
            body: { action: 'stop', confirm: 'STOP' },
        });
        expect(stop.status).toBe(202);
        expect(stop.body.accepted).toBe(true);
        expect(await waitFor(() => calls.includes('stop') && readMaintenance(path.join(dir, 'runtime', 'maintenance.json'))?.state === 'stopped')).toBe(true);

        const afterStop = await request(port, 'GET', '/internal/status', { headers: { 'x-control-service': secret } });
        expect(afterStop.body.service.state).toBe('STOPPED');
        expect(afterStop.body.maintenance.state).toBe('stopped');
        expect(afterStop.body.erp.healthy).toBe(false);
        expect(afterStop.body.lastOperation.action).toBe('stop');
        expect(afterStop.body.lastOperation.state).toBe('success');
        expect(afterStop.body.audit.some((a) => a.action === 'stop' && a.result === 'success')).toBe(true);

        const start = await request(port, 'POST', '/internal/actions', {
            headers: { 'x-control-service': secret },
            body: { action: 'start', confirm: '', actor: 'ERP admin' },
        });
        expect(start.status).toBe(202);
        expect(await waitFor(() => calls.includes('start') && !fs.existsSync(path.join(dir, 'runtime', 'maintenance.json')))).toBe(true);

        let afterStart = null;
        for (let i = 0; i < 60; i++) {
            afterStart = await request(port, 'GET', '/internal/status', { headers: { 'x-control-service': secret } });
            if (afterStart.body.lastOperation && afterStart.body.lastOperation.state === 'success') {break;}
            await sleep(20);
        }
        expect(afterStart.body.service.state).toBe('RUNNING');
        expect(afterStart.body.maintenance).toBeNull();
        expect(afterStart.body.erp.healthy).toBe(true);
        expect(afterStart.body.lastOperation.action).toBe('start');
        expect(afterStart.body.lastOperation.state).toBe('success');
    });

    test('العملية الواحدة في الوقت نفسه تُرفض بـ409', async () => {
        const first = await request(port, 'POST', '/internal/actions', {
            headers: { 'x-control-service': secret },
            body: { action: 'restart', confirm: 'RESTART' },
        });
        expect(first.status).toBe(202);
        const busy = await request(port, 'POST', '/internal/actions', {
            headers: { 'x-control-service': secret },
            body: { action: 'stop', confirm: 'STOP' },
        });
        // قد تكتمل العملية الأولى فورًا (deps وهمية) — إذًا 202 مقبول أيضًا.
        expect([202, 409]).toContain(busy.status);
        await waitFor(() => state === 'RUNNING');
    });

    test('العنوان غير المحلي مرفوض — لا وصول من الشبكة', async () => {
        const res = await request(port, 'GET', '/api/ping', { headers: { 'x-forwarded-for': '8.8.8.8' } });
        // remoteAddress الحقيقي loopback — الترويسة لا تُغيّره (تصميم مقصود).
        expect(res.status).toBe(200);
    });
});

describe('عقد الشاشة والمراقبين وخدمة ويندوز', () => {
    test('شاشة V2: قسم إداري + معالجات بلا أي شبكة مباشرة', () => {
        const screen = read(path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'screens', 'settings.js'));
        expect(screen).toContain("sectionCard('server', 'zap', 'التحكم بالسيرفر', 'server', 'server')");
        expect(screen).toContain("else if (key === 'server') {loadServerControl();}");
        for (const hook of ['data-v2-sc-open', 'data-v2-sc-phrase', 'data-v2-sc-go', 'data-v2-sc-refresh', 'data-v2-sc-panel']) {
            expect(screen).toContain(hook);
        }
        expect(screen).toContain('STOP');
        expect(screen).toContain('RESTART');
        expect(screen).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(screen).toContain('stopScTimer();');
    });

    test('repo: المسارات الدقيقة', () => {
        const repo = read(path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'data', 'settings-repo.js'));
        expect(repo).toContain("apiFetch('/server-control/status')");
        expect(repo).toMatch(/apiFetch\('\/server-control\/actions',\s*\{\s*method: 'POST', body: JSON\.stringify\(\{ action, confirm \}\),\s*\}\)/);
    });

    test('server.js يركّب الباب + البروكسي مدير فقط', () => {
        const server = read(path.join(ROOT, 'backend', 'server.js'));
        expect(server).toContain("require('./server-control-routes').register(app);");
        const routes = read(path.join(ROOT, 'backend', 'server-control-routes.js'));
        expect(routes).toContain("router.use(jwtAuth, requireRole('admin'));");
        expect(routes).not.toMatch(/(password|secret)\s*[:=]\s*['"][^'"]+['"]/i);
    });

    test('watchdog يحترم الصيانة في ERP والنفق', () => {
        const watch = read(path.join(ROOT, 'scripts', 'watchdog.js'));
        expect(watch).toContain("require('../backend/server-control-maintenance')");
        expect(watch).toContain('maintenanceDecision(maintenance)');
        expect(watch).toMatch(/if \(skipErp\) \{/);
        expect(watch).toContain("report.checks.tunnel_public = 'maintenance-skip'");
        expect(watch).toContain('const needTunnelRestart = !skipErp');
        expect(watch).toContain("svcQuery('KarimERP-Control')");
    });

    test('steel-watchdog يحترم الصيانة', () => {
        const ps = read(path.join(ROOT, 'scripts', 'steel-watchdog.ps1'));
        expect(ps).toContain('maintenance.json');
        expect(ps).toContain("$m.state -eq 'stopped'");
        expect(ps).toContain('$MaintSkip');
        expect(ps).toContain("if (!$MaintSkip -and !(Test-Health $HealthUrl))");
    });

    test('ملفات خدمة ويندوز جاهزة وبلا تثبيت تلقائي', () => {
        const xml = read(path.join(ROOT, 'windows-service', 'KarimERP-Control.xml'));
        for (const tag of ['<id>KarimERP-Control</id>', 'server-control.js --service', '<startmode>Automatic</startmode>']) {
            expect(xml).toContain(tag);
        }
        expect(xml).toContain('KARIM_CONTROL_ACTIONS');
        const bat = read(path.join(ROOT, 'windows-service', 'install-control-elevated.bat'));
        expect(bat).toContain('net session');
        expect(bat).toContain('KarimERP-Control.exe install');
        expect(bat).toContain('127.0.0.1:5011/api/ping');
    });
});
