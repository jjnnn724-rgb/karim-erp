'use strict';
/**
 * server-control.js — الخدمة المرافقة لمركز التحكم بالسيرفر.
 * ────────────────────────────────────────────────────────────────────────────
 * لماذا خدمة منفصلة؟ زر «تشغيل» لا يمكن أن يقدّمه سيرفرٌ متوقف. هذه العملية
 * الصغيرة تعمل دائمًا على 127.0.0.1:5011، وتتحكم في خدمة ويندوز
 * KarimERP-Server وحدها (لا PostgreSQL ولا أي خدمة أخرى)، عبر أوامر sc.exe
 * ثابتة بـexecFile بلا shell. الواجهة الرئيسية تعرض حالتها وتوقف/تعيد
 * التشغيل عبر بروكسي محروس؛ التشغيل بعد إيقاف كامل يتم من صفحتها المستقلة.
 *
 * الأمان: الاستماع على 127.0.0.1 فقط · جلسة HttpOnly · CSRF مزدوج · فحص Origin
 * · تحديد محاولات الدخول والأوامر · عملية واحدة في الوقت نفسه · سجل تدقيق دائم
 * · سر مشترك للاتصال الداخلي من ERP. الوصول العام اختياري عبر نفق Cloudflare
 * (CONTROL_PUBLIC_HOST) ويشترط Host المطابق ورؤوس CF-Ray وCF-Connecting-IP
 * مع كوكي Secure؛ تبقى المسارات الداخلية محلية فقط.
 * لا توجد أوامر حرة: start|stop|restart فقط.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');
const dotenv = require('dotenv');
const {
    readMaintenance, writeMaintenance, clearMaintenance,
} = require('./server-control-maintenance');
const { HTML, CSS, JS } = require('./server-control-assets');

const ROOT = path.join(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const VERSION = '1.0.0';
const SERVICE_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const BCRYPT_RE = /^\$2[aby]\$/;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const BODY_LIMIT = 16 * 1024;
const ACTIONS = new Set(['start', 'stop', 'restart']);
const CONFIRM_PHRASE = { start: '', stop: 'STOP', restart: 'RESTART' };

function parseScState(text) {
    const state = String(text || '').match(/STATE\s*:\s*\d+\s+([A-Z_]+)/i);
    const pid = String(text || '').match(/PID\s*:\s*(\d+)/i);
    return {
        state: state ? state[1].toUpperCase() : 'UNKNOWN',
        pid: pid ? Number(pid[1]) : 0,
    };
}

function validAction(value) {
    const action = String(value || '').trim().toLowerCase();
    return ACTIONS.has(action) ? action : null;
}

function constantTimeEqual(left, right) {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    if (a.length !== b.length) {return false;}
    return crypto.timingSafeEqual(a, b);
}

function safeError(error) {
    return String((error && error.message) || error || 'خطأ غير معروف')
        .replace(/[\r\n]+/g, ' ')
        .slice(0, 200);
}

function parseCookies(header) {
    const out = {};
    String(header || '').split(';').forEach((part) => {
        const index = part.indexOf('=');
        if (index <= 0) {return;}
        try {out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());} catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
    });
    return out;
}

function createLimiter(limit, windowMs) {
    const hits = new Map();
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [key, list] of hits) {
            const fresh = list.filter((at) => now - at < windowMs);
            if (fresh.length) {hits.set(key, fresh);} else {hits.delete(key);}
        }
    }, Math.min(windowMs, 60_000));
    timer.unref();
    return {
        take(key) {
            const now = Date.now();
            const list = (hits.get(key) || []).filter((at) => now - at < windowMs);
            if (list.length >= limit) {return false;}
            list.push(now);
            hits.set(key, list);
            return true;
        },
        stop() {clearInterval(timer);},
    };
}

function cached(fn, ttlMs) {
    let at = 0;
    let value = null;
    let inflight = null;
    return async function read() {
        if (Date.now() - at < ttlMs && value) {return value;}
        if (inflight) {return inflight;}
        inflight = Promise.resolve().then(fn).then((result) => {
            value = result;
            at = Date.now();
            return result;
        }).finally(() => {inflight = null;});
        return inflight;
    };
}

function readTailLines(file, maxBytes, count) {
    try {
        const stat = fs.statSync(file);
        const length = Math.min(stat.size, maxBytes);
        if (!length) {return [];}
        const fd = fs.openSync(file, 'r');
        try {
            const buffer = Buffer.alloc(length);
            fs.readSync(fd, buffer, 0, length, stat.size - length);
            const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
            return lines.slice(-count);
        } finally {fs.closeSync(fd);}
    } catch (_) {return [];}
}

function createControlServer(options = {}) {
    const host = options.host || process.env.CONTROL_HOST || '127.0.0.1';
    const publicHost = String(options.publicHost || process.env.CONTROL_PUBLIC_HOST || '').trim().toLowerCase();
    if (publicHost && !/^[a-z0-9.-]{1,253}$/.test(publicHost)) {throw new Error('CONTROL_PUBLIC_HOST غير صالح');}
    const port = Number(options.port ?? process.env.CONTROL_PORT ?? 5011);
    const serviceName = options.serviceName || process.env.CONTROL_SERVICE_NAME || 'KarimERP-Server';
    if (!SERVICE_RE.test(serviceName)) {throw new Error('CONTROL_SERVICE_NAME غير صالح');}
    const runtimeDir = options.runtimeDir || process.env.KARIM_RUNTIME_DIR || path.join(ROOT, 'runtime');
    const auditFile = options.auditFile || path.join(ROOT, 'logs', 'server-control-audit.jsonl');
    const maintFile = path.join(runtimeDir, 'maintenance.json');
    const stateFile = path.join(runtimeDir, 'control-state.json');
    const secretFile = path.join(runtimeDir, 'control-secret');
    const actionsEnabled = options.actionsEnabled === true;
    const dryRun = options.dryRun === true;
    const actionDelayMs = options.actionDelayMs ?? 1500;
    const pollIntervalMs = options.pollIntervalMs ?? 1500;
    const stopTimeoutMs = options.stopTimeoutMs ?? 45_000;
    const startTimeoutMs = options.startTimeoutMs ?? 90_000;
    const enforceIntervalMs = options.enforceIntervalMs ?? 30_000;
    const erpPort = Number(options.erpPort || process.env.CONTROL_ERP_PORT || process.env.PORT || 5000);
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const log = options.logger || {
        info: (m) => console.log(`[server-control] ${m}`),
        warn: (m) => console.warn(`[server-control] ${m}`),
        error: (m) => console.error(`[server-control] ${m}`),
    };

    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(path.dirname(auditFile), { recursive: true });

    let secret = options.secret || '';
    if (!secret) {
        try {
            const existing = fs.readFileSync(secretFile, 'utf8').trim();
            if (/^[a-f0-9]{64}$/i.test(existing)) {secret = existing;}
        } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
        if (!secret) {
            secret = crypto.randomBytes(32).toString('hex');
            fs.writeFileSync(secretFile, secret, { mode: 0o600 });
        }
    }

    // ── الخدمة: أوامر ثابتة بلا shell ───────────────────────────────────────
    function scRun(args, timeout = 40_000) {
        if (dryRun) {return Promise.resolve({ ok: true, code: 0, stdout: '', stderr: '' });}
        return new Promise((resolve) => {
            execFile('sc.exe', args, {
                windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 1024 * 1024,
            }, (error, stdout, stderr) => {
                resolve({
                    ok: !error,
                    code: error && typeof error.code === 'number' ? error.code : (error ? 1 : 0),
                    stdout: stdout || '',
                    stderr: stderr || '',
                });
            });
        });
    }

    async function queryService() {
        if (dryRun) {return { installed: true, state: options.dryRunState || 'STOPPED', pid: 0, dryRun: true };}
        const result = await scRun(['queryex', serviceName], 10_000);
        const output = `${result.stdout}\n${result.stderr}`;
        if (!result.ok && (/1060|does not exist|غير موجود/i.test(output))) {
            return { installed: false, state: 'NOT_INSTALLED', pid: 0 };
        }
        const parsed = parseScState(result.stdout);
        return {
            installed: result.ok || parsed.state !== 'UNKNOWN',
            state: parsed.state,
            pid: parsed.pid,
        };
    }

    async function startService() {
        if (dryRun) {return;}
        const result = await scRun(['start', serviceName], 30_000);
        const output = `${result.stdout}\n${result.stderr}`;
        if (!result.ok && !/1056|START_PENDING|RUNNING/i.test(output)) {
            throw new Error(`تعذّر بدء الخدمة: ${output.trim().slice(0, 160)}`);
        }
    }

    async function stopService() {
        if (dryRun) {return;}
        const result = await scRun(['stop', serviceName], 35_000);
        const output = `${result.stdout}\n${result.stderr}`;
        if (!result.ok && !/1062|STOP_PENDING|STOPPED|1060/i.test(output)) {
            throw new Error(`تعذّر إيقاف الخدمة: ${output.trim().slice(0, 160)}`);
        }
    }

    function probeHealthOnce(url, timeout = 1400) {
        return new Promise((resolve) => {
            const client = url.startsWith('https:') ? https : http;
            const req = client.get(url, {
                rejectUnauthorized: false, timeout,
                headers: { 'user-agent': 'Karim-Control-Probe', accept: 'application/json' },
            }, (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { body += chunk; if (body.length > 64 * 1024) {req.destroy();} });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(body);
                        const ok = res.statusCode === 200 && ['ok', 'warn'].includes(String(json.status));
                        resolve(ok ? { healthy: true, status: json.status, version: json.app && json.app.version, uptimeMs: json.boot && json.boot.uptimeMs } : null);
                    } catch (_) {resolve(null);}
                });
            });
            req.on('timeout', () => { try { req.destroy(); } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ } resolve(null); });
            req.on('error', () => resolve(null));
        });
    }

    async function probeHealth() {
        const started = now();
        for (const scheme of ['https', 'http']) {
            const result = await probeHealthOnce(`${scheme}://127.0.0.1:${erpPort}/api/health`);
            if (result) {return { ...result, latencyMs: now() - started, checked: true };}
        }
        return { healthy: false, status: 'down', latencyMs: null, checked: true };
    }

    const deps = {
        query: options.serviceQuery || queryService,
        start: options.serviceStart || startService,
        stop: options.serviceStop || stopService,
        health: options.healthProbe || probeHealth,
    };

    const queryCached = cached(deps.query, options.statusCacheMs ?? 1200);
    const healthCached = cached(deps.health, options.statusCacheMs ?? 1200);

    // ── الجلسات والتحديد ──────────────────────────────────────────────────
    const sessions = new Map();
    const loginLimiter = createLimiter(options.loginLimit ?? 5, 10 * 60 * 1000);
    const actionLimiter = createLimiter(options.actionLimit ?? 6, 60 * 1000);
    const sessionTimer = setInterval(() => {
        const current = now();
        for (const [key, session] of sessions) {
            if (session.expiresAt <= current) {sessions.delete(key);}
        }
    }, 10 * 60 * 1000);
    sessionTimer.unref();

    const sessionsLimit = options.maxSessions ?? 50;

    // ── التدقيق ───────────────────────────────────────────────────────────
    function audit(entry) {
        const row = {
            at: new Date(now()).toISOString(),
            actor: String(entry.actor || '—').slice(0, 64),
            action: entry.action || '—',
            result: entry.result || '—',
            detail: String(entry.detail || '').slice(0, 300),
            ip: String(entry.ip || '').slice(0, 64),
        };
        try {
            try {
                if (fs.statSync(auditFile).size > 5 * 1024 * 1024) {
                    try {fs.renameSync(auditFile, `${auditFile}.1`);} catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
                }
            } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
            fs.appendFileSync(auditFile, `${JSON.stringify(row)}\n`, 'utf8');
        } catch (error) {log.warn(`audit write failed: ${safeError(error)}`);}
        return row;
    }

    function recentAudit(count = 8) {
        return readTailLines(auditFile, 256 * 1024, count).reverse().map((line) => {
            try {
                const row = JSON.parse(line);
                return { at: row.at, actor: row.actor, action: row.action, result: row.result };
            } catch (_) {return null;}
        }).filter(Boolean);
    }

    // ── آخر عملية ─────────────────────────────────────────────────────────
    let operation = null;
    try {
        const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        if (saved && saved.lastOperation && ACTIONS.has(String(saved.lastOperation.action))) {
            operation = { ...saved.lastOperation, state: saved.lastOperation.state === 'running' ? 'failed' : saved.lastOperation.state };
        }
    } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }

    function publicOperation(op) {
        if (!op) {return null;}
        return {
            id: op.id, action: op.action, state: op.state, stage: op.stage,
            actor: op.actor, startedAt: op.startedAt, finishedAt: op.finishedAt || null,
            error: op.error || null,
        };
    }

    function persistOperation() {
        try {
            const tmp = `${stateFile}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify({ lastOperation: publicOperation(operation), updatedAt: new Date(now()).toISOString() }, null, 2), 'utf8');
            fs.renameSync(tmp, stateFile);
        } catch (error) {log.warn(`state persist failed: ${safeError(error)}`);}
    }

    function finishOperation(op, state) {
        op.state = state;
        op.finishedAt = new Date(now()).toISOString();
        persistOperation();
        audit({ actor: op.actor, action: op.action, result: state, detail: op.error || op.stage, ip: op.ip });
    }

    function waitUntil(check, timeoutMs, intervalMs) {
        const deadline = now() + timeoutMs;
        return new Promise((resolve) => {
            const tick = async () => {
                try {if (await check()) {return resolve(true);}} catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
                if (now() >= deadline) {return resolve(false);}
                setTimeout(tick, intervalMs);
            };
            tick();
        });
    }

    async function executeOperation(op) {
        try {
            if (op.action === 'stop' || op.action === 'restart') {
                writeMaintenance(maintFile, op.action === 'stop' ? 'stopping' : 'restarting', {
                    by: op.actor, operationId: op.id,
                });
                op.stage = 'stopping';
                await deps.stop();
                op.stage = 'waiting_stop';
                const stopped = await waitUntil(async () => {
                    const snapshot = await deps.query();
                    return snapshot.state === 'STOPPED' || snapshot.state === 'NOT_INSTALLED';
                }, stopTimeoutMs, pollIntervalMs);
                if (!stopped) {throw new Error('انتهت المهلة ولم تتوقف خدمة KarimERP-Server');}
                const down = await waitUntil(async () => !(await deps.health()).healthy, 12_000, 1000);
                if (!down) {throw new Error(`توقفت الخدمة لكن المنفذ ${erpPort} ما زال يستجيب لعملية أخرى`);}
                if (op.action === 'stop') {
                    writeMaintenance(maintFile, 'stopped', { by: op.actor, operationId: op.id });
                    op.stage = 'stopped';
                    finishOperation(op, 'success');
                    log.info(`stopped by ${op.actor}`);
                    return;
                }
                op.stage = 'stopped';
            }

            writeMaintenance(maintFile, 'starting', { by: op.actor, operationId: op.id });
            op.stage = 'starting';
            const before = await deps.query();
            if (before.installed === false) {throw new Error('خدمة KarimERP-Server غير مثبّتة على هذا الجهاز');}
            if (before.state !== 'RUNNING') {await deps.start();}
            op.stage = 'waiting_health';
            const healthy = await waitUntil(async () => (await deps.health()).healthy === true, startTimeoutMs, pollIntervalMs);
            if (!healthy) {throw new Error('بدأت الخدمة لكن النظام لم يصبح جاهزًا خلال المهلة');}
            clearMaintenance(maintFile);
            op.stage = 'running';
            finishOperation(op, 'success');
            log.info(`started by ${op.actor}`);
        } catch (error) {
            op.error = safeError(error);
            try {
                const snapshot = await deps.query();
                if (op.action === 'stop' && snapshot.state !== 'RUNNING') {
                    writeMaintenance(maintFile, 'stopped', { by: op.actor, operationId: op.id, reason: 'operation-failed' });
                } else {
                    clearMaintenance(maintFile);
                }
            } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
            finishOperation(op, 'failed');
            log.error(`${op.action} failed: ${op.error}`);
        }
    }

    function startOperation(action, actor, source, ip) {
        if (operation && operation.state === 'running') {return null;}
        const op = {
            id: crypto.randomBytes(6).toString('hex'),
            action, state: 'running', stage: 'queued',
            actor: String(actor || '—').slice(0, 64),
            source, ip,
            startedAt: new Date(now()).toISOString(),
            finishedAt: null, error: null,
        };
        operation = op;
        audit({ actor: op.actor, action, result: 'accepted', detail: source, ip });
        setTimeout(() => {
            if (dryRun) {
                op.stage = action === 'stop' ? 'stopped' : 'running';
                finishOperation(op, 'success');
                return;
            }
            executeOperation(op).catch(() => {});
        }, Math.max(0, actionDelayMs));
        return op;
    }

    // ── المصادقة الافتراضية: نفس جدول users ونفس bcrypt ────────────────────
    let pool = null;
    async function defaultAuthenticate(username, password) {
        if (!pool) {
            const { Pool } = require('pg');
            pool = new Pool({
                host: process.env.DB_HOST || '127.0.0.1',
                port: Number(process.env.DB_PORT) || 5432,
                database: process.env.DB_NAME || 'karim_erp',
                user: process.env.DB_USER || 'postgres',
                password: process.env.DB_PASSWORD,
                max: 2,
                idleTimeoutMillis: 30_000,
                connectionTimeoutMillis: 5000,
                statement_timeout: 5000,
                application_name: 'karim-server-control',
            });
            pool.on('error', (error) => log.warn(`db pool: ${safeError(error)}`));
        }
        const result = await pool.query(
            `SELECT id, username, password, role, name, active, must_change_password
               FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`, [username]);
        const user = result.rows[0];
        if (!user || !user.active || !BCRYPT_RE.test(String(user.password))) {return null;}
        const bcrypt = require('bcryptjs');
        const matched = await bcrypt.compare(password, user.password);
        if (!matched) {return null;}
        if (user.role !== 'admin') {return { forbidden: true };}
        if (user.must_change_password) {return { password_change: true };}
        return { id: String(user.id), username: user.username, name: user.name || user.username, role: user.role };
    }
    const authenticate = options.authenticate || defaultAuthenticate;

    // ── أدوات HTTP ────────────────────────────────────────────────────────
    function isLoopback(req) {
        const address = req.socket && req.socket.remoteAddress;
        return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
    }

    function hostName(req) {
        return String(req.headers.host || '').trim().toLowerCase();
    }

    function isLocalHost(hostHeader) {
        return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(hostHeader);
    }

    // الطلب العام يصل من cloudflared على loopback؛ لا نثق بالعنوان إلا إذا
    // طابق Host المضيف العام وأضافت Cloudflare رؤوسها المحجوزة.
    function isPublicRequest(req) {
        if (!publicHost) {return false;}
        const hostHeader = hostName(req);
        if (hostHeader !== publicHost && hostHeader !== `${publicHost}:443`) {return false;}
        const ip = String(req.headers['cf-connecting-ip'] || '').trim();
        return net.isIP(ip) !== 0 && Boolean(req.headers['cf-ray']);
    }

    function clientIp(req) {
        if (isPublicRequest(req)) {return String(req.headers['cf-connecting-ip'] || '').trim();}
        return (req.socket && req.socket.remoteAddress) || 'local';
    }

    function requestAllowed(req) {
        return isLoopback(req) && (isLocalHost(hostName(req)) || isPublicRequest(req));
    }

    function originAllowed(req) {
        const origin = req.headers.origin;
        if (!origin) {return false;}
        let parsed;
        try {parsed = new URL(origin);} catch (_) {return false;}
        const hostHeader = hostName(req);
        const publicRequest = isPublicRequest(req);
        if (parsed.protocol !== (publicRequest ? 'https:' : 'http:')) {return false;}
        return parsed.host.toLowerCase() === hostHeader;
    }

    function securityHeaders(res) {
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    }

    function sendJson(res, status, payload) {
        const body = JSON.stringify(payload);
        res.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
        });
        res.end(body);
    }

    function sendText(res, status, body, type) {
        res.writeHead(status, {
            'Content-Type': type,
            'Content-Length': Buffer.byteLength(body),
        });
        res.end(body);
    }

    function readJson(req) {
        return new Promise((resolve, reject) => {
            let size = 0;
            const chunks = [];
            req.on('data', (chunk) => {
                size += chunk.length;
                if (size > BODY_LIMIT) {
                    reject(Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 }));
                    try {req.destroy();} catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
                    return;
                }
                chunks.push(chunk);
            });
            req.on('end', () => {
                try {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    resolve(raw ? JSON.parse(raw) : {});
                } catch (_) {
                    reject(Object.assign(new Error('BAD_JSON'), { status: 400 }));
                }
            });
            req.on('error', (error) => reject(error));
        });
    }

    function sessionFrom(req) {
        const cookies = parseCookies(req.headers.cookie);
        const raw = cookies.karim_ctl_sess;
        if (!raw || raw.length < 32) {return null;}
        const key = crypto.createHash('sha256').update(raw).digest('hex');
        const session = sessions.get(key);
        if (!session) {return null;}
        if (session.expiresAt <= now()) {sessions.delete(key); return null;}
        session.key = key;
        return session;
    }

    function setSessionCookie(res, raw, maxAgeSec, secure) {
        res.setHeader('Set-Cookie', `karim_ctl_sess=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
    }

    function requireSession(req, res) {
        if (!requestAllowed(req)) {sendJson(res, 403, { error: 'LOCAL_ONLY', message: 'هذه اللوحة متاحة من جهاز السيرفر فقط.' }); return null;}
        const session = sessionFrom(req);
        if (!session) {sendJson(res, 401, { error: 'UNAUTHORIZED', message: 'سجّل الدخول أولًا.' }); return null;}
        if (session.role !== 'admin') {sendJson(res, 403, { error: 'FORBIDDEN', message: 'هذه اللوحة لمدير النظام فقط.' }); return null;}
        return session;
    }

    function requireCsrf(req, res, session) {
        if (!originAllowed(req)) {
            sendJson(res, 403, { error: 'ORIGIN_REJECTED', message: 'طلب من أصل غير موثوق.' });
            return false;
        }
        const header = String(req.headers['x-control-csrf'] || '');
        if (!constantTimeEqual(header, session.csrf)) {
            sendJson(res, 403, { error: 'CSRF_FAILED', message: 'تحقق الطلب فشل — أعد تحميل الصفحة.' });
            return false;
        }
        return true;
    }

    function internalAllowed(req, res) {
        if (!isLoopback(req) || isPublicRequest(req) || !isLocalHost(hostName(req))) {
            sendJson(res, 403, { error: 'LOCAL_ONLY' }); return false;
        }
        if (!constantTimeEqual(req.headers['x-control-service'] || '', secret)) {
            sendJson(res, 401, { error: 'SERVICE_AUTH_FAILED' });
            return false;
        }
        return true;
    }

    async function snapshot() {
        const [serviceResult, erpResult] = await Promise.allSettled([queryCached(), healthCached()]);
        const service = serviceResult.status === 'fulfilled'
            ? serviceResult.value
            : { installed: null, state: 'UNKNOWN', pid: 0 };
        const erp = erpResult.status === 'fulfilled'
            ? erpResult.value
            : { healthy: false, status: 'down', latencyMs: null, checked: true };
        return {
            ok: true,
            control: {
                version: VERSION,
                pid: process.pid,
                host,
                publicHost: publicHost || null,
                port: server.address() ? server.address().port : port,
                uptimeSec: Math.floor((now() - startedAt) / 1000),
                actionsEnabled,
                dryRun,
                serviceName,
            },
            service: {
                name: serviceName,
                installed: service.installed !== false,
                state: service.state || 'UNKNOWN',
                pid: service.pid || 0,
            },
            erp,
            maintenance: readMaintenance(maintFile),
            operation: publicOperation(operation),
            lastOperation: operation && operation.state !== 'running' ? publicOperation(operation) : null,
            audit: recentAudit(8),
            serverTime: new Date(now()).toISOString(),
        };
    }

    const startedAt = now();

    // ── التوجيه ───────────────────────────────────────────────────────────
    const server = http.createServer(async (req, res) => {
        securityHeaders(res);
        if (!requestAllowed(req)) {
            return sendJson(res, 403, { error: 'LOCAL_ONLY', message: 'هذه اللوحة متاحة من جهاز السيرفر فقط.' });
        }

        const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
        const pathname = url.pathname;
        const method = req.method || 'GET';

        try {
            if ((method === 'GET' || method === 'HEAD') && pathname === '/') {
                return sendText(res, 200, HTML, 'text/html; charset=utf-8');
            }
            if ((method === 'GET' || method === 'HEAD') && pathname === '/app.css') {
                return sendText(res, 200, CSS, 'text/css; charset=utf-8');
            }
            if ((method === 'GET' || method === 'HEAD') && pathname === '/app.js') {
                return sendText(res, 200, JS, 'text/javascript; charset=utf-8');
            }
            if (pathname === '/favicon.ico') {
                res.writeHead(204); return res.end();
            }
            if (pathname === '/api/ping' && method === 'GET') {
                return sendJson(res, 200, { ok: true, app: 'karim-server-control', version: VERSION, actionsEnabled });
            }

            if (pathname === '/api/session' && method === 'GET') {
                const session = requireSession(req, res);
                if (!session) {return;}
                return sendJson(res, 200, {
                    ok: true,
                    csrf: session.csrf,
                    user: { username: session.username, name: session.name },
                });
            }

            if (pathname === '/api/login' && method === 'POST') {
                if (!loginLimiter.take(clientIp(req))) {
                    return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'محاولات كثيرة — انتظر 10 دقائق.' });
                }
                if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
                    return sendJson(res, 415, { error: 'JSON_REQUIRED' });
                }
                const body = await readJson(req);
                const username = String(body.username || '').trim().slice(0, 64);
                const password = String(body.password || '').slice(0, 200);
                if (!username || !password) {
                    return sendJson(res, 400, { error: 'VALIDATION_ERROR', message: 'اسم المستخدم وكلمة المرور مطلوبان.' });
                }
                let user;
                try {
                    user = await authenticate(username, password);
                } catch (error) {
                    log.warn(`login db error: ${safeError(error)}`);
                    audit({ actor: username, action: 'login', result: 'failed', detail: 'db_unavailable', ip: clientIp(req) });
                    return sendJson(res, 503, { error: 'DB_UNAVAILABLE', message: 'قاعدة البيانات غير متاحة الآن.' });
                }
                if (!user || user.forbidden) {
                    audit({ actor: username, action: 'login', result: 'failed', detail: user && user.forbidden ? 'not_admin' : 'bad_credentials', ip: clientIp(req) });
                    return sendJson(res, 401, { error: 'INVALID_CREDENTIALS', message: 'بيانات الدخول غير صحيحة أو الحساب ليس مدير نظام.' });
                }
                if (user.password_change) {
                    return sendJson(res, 403, { error: 'PASSWORD_CHANGE_REQUIRED', message: 'غيّر كلمة المرور من ERP أولًا.' });
                }
                const raw = crypto.randomBytes(32).toString('hex');
                const key = crypto.createHash('sha256').update(raw).digest('hex');
                const csrf = crypto.randomBytes(32).toString('hex');
                const expiresAt = now() + SESSION_TTL_MS;
                sessions.set(key, {
                    userId: user.id, username: user.username, name: user.name,
                    role: user.role, csrf, expiresAt,
                });
                if (sessions.size > sessionsLimit) {
                    const oldest = [...sessions.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
                    if (oldest) {sessions.delete(oldest[0]);}
                }
                setSessionCookie(res, raw, Math.floor(SESSION_TTL_MS / 1000), isPublicRequest(req));
                audit({ actor: user.username, action: 'login', result: 'login', detail: isPublicRequest(req) ? 'ok_remote' : 'ok', ip: clientIp(req) });
                log.info(`login: ${user.username}${isPublicRequest(req) ? ' (remote)' : ''}`);
                return sendJson(res, 200, {
                    ok: true, csrf,
                    user: { username: user.username, name: user.name },
                });
            }

            if (pathname === '/api/logout' && method === 'POST') {
                const session = requireSession(req, res);
                if (!session) {return;}
                if (!requireCsrf(req, res, session)) {return;}
                sessions.delete(session.key);
                setSessionCookie(res, '', 0, isPublicRequest(req));
                audit({ actor: session.username, action: 'logout', result: 'logout', detail: 'ok', ip: clientIp(req) });
                return sendJson(res, 200, { ok: true });
            }

            if (pathname === '/api/status' && method === 'GET') {
                if (!requireSession(req, res)) {return;}
                return sendJson(res, 200, await snapshot());
            }

            if (pathname === '/api/actions' && method === 'POST') {
                const session = requireSession(req, res);
                if (!session) {return;}
                if (!requireCsrf(req, res, session)) {return;}
                if (!actionLimiter.take(session.key || session.username)) {
                    return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'أوامر كثيرة — انتظر دقيقة.' });
                }
                if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
                    return sendJson(res, 415, { error: 'JSON_REQUIRED' });
                }
                const body = await readJson(req);
                const action = validAction(body.action);
                if (!action) {
                    return sendJson(res, 400, { error: 'INVALID_ACTION', message: 'الإجراء غير مسموح.' });
                }
                const phrase = CONFIRM_PHRASE[action];
                if (phrase && String(body.confirm || '').trim().toUpperCase() !== phrase) {
                    return sendJson(res, 400, { error: 'CONFIRM_REQUIRED', message: `اكتب ${phrase} للتأكيد.` });
                }
                if (!actionsEnabled) {
                    return sendJson(res, 503, { error: 'ACTIONS_DISABLED', message: 'الأوامر معطّلة في وضع المعاينة.' });
                }
                const op = startOperation(action, session.username, 'panel', clientIp(req));
                if (!op) {
                    return sendJson(res, 409, { error: 'BUSY', message: 'عملية أخرى قيد التنفيذ — انتظر اكتمالها.' });
                }
                return sendJson(res, 202, { ok: true, accepted: true, operationId: op.id, action });
            }

            // ── الباب الداخلي: ERP فقط، بسر الخدمة ──────────────────────────
            if (pathname === '/internal/status' && method === 'GET') {
                if (!internalAllowed(req, res)) {return;}
                return sendJson(res, 200, await snapshot());
            }

            if (pathname === '/internal/actions' && method === 'POST') {
                if (!internalAllowed(req, res)) {return;}
                if (!actionsEnabled) {
                    return sendJson(res, 503, { error: 'ACTIONS_DISABLED', message: 'الأوامر معطّلة.' });
                }
                const body = await readJson(req);
                const action = validAction(body.action);
                if (!action) {return sendJson(res, 400, { error: 'INVALID_ACTION' });}
                const phrase = CONFIRM_PHRASE[action];
                if (phrase && String(body.confirm || '').trim().toUpperCase() !== phrase) {
                    return sendJson(res, 400, { error: 'CONFIRM_REQUIRED' });
                }
                const actor = String(body.actor || 'ERP admin').slice(0, 64);
                if (!actionLimiter.take(`internal:${actor}`)) {
                    return sendJson(res, 429, { error: 'RATE_LIMITED' });
                }
                const op = startOperation(action, actor, 'erp', req.socket.remoteAddress);
                if (!op) {return sendJson(res, 409, { error: 'BUSY' });}
                return sendJson(res, 202, { ok: true, accepted: true, operationId: op.id, action });
            }

            return sendJson(res, 404, { error: 'NOT_FOUND' });
        } catch (error) {
            if (error && error.status === 413) {return sendJson(res, 413, { error: 'BODY_TOO_LARGE' });}
            if (error && error.status === 400) {return sendJson(res, 400, { error: 'BAD_JSON' });}
            log.error(`request failed: ${safeError(error)}`);
            return sendJson(res, 500, { error: 'INTERNAL_ERROR', message: 'خطأ داخلي في لوحة التحكم.' });
        }
    });

    server.headersTimeout = 12_000;
    server.requestTimeout = 25_000;
    server.keepAliveTimeout = 5000;
    server.on('clientError', (_error, socket) => {
        try {socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');} catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
    });

    // ── فرض وضع الصيانة: من أوقفه يبقى موقوفًا حتى يُطلب التشغيل ───────────
    let enforceTimer = null;
    async function enforceDesiredState() {
        if (!actionsEnabled || dryRun) {return;}
        if (operation && operation.state === 'running') {return;}
        const maintenance = readMaintenance(maintFile);
        if (!maintenance || maintenance.state !== 'stopped') {return;}
        try {
            const service = await deps.query();
            if (service.state === 'RUNNING') {
                log.warn('service is RUNNING while maintenance=stopped — enforcing stop');
                startOperation('stop', 'النظام (فرض الصيانة)', 'watchdog', 'local');
            }
        } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
    }

    async function start() {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, host, () => {
                server.removeListener('error', reject);
                resolve();
            });
        });
        if (enforceIntervalMs > 0) {
            enforceTimer = setInterval(() => {enforceDesiredState().catch(() => {});}, enforceIntervalMs);
            enforceTimer.unref();
        }
        const address = server.address();
        log.info(`control panel listening on http://${host}:${address.port} (actions=${actionsEnabled ? 'on' : 'off'}${dryRun ? ', dry-run' : ''})`);
        return { host, port: address.port };
    }

    async function close() {
        if (enforceTimer) {clearInterval(enforceTimer); enforceTimer = null;}
        loginLimiter.stop();
        actionLimiter.stop();
        clearInterval(sessionTimer);
        await new Promise((resolve) => server.close(() => resolve()));
        if (pool) {try {await pool.end();} catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }}
    }

    return { server, start, close, snapshot, _internals: {sessions, audit, enforceDesiredState, secret, maintFile, auditFile} };
}

function main() {
    const actionsEnabled = process.argv.includes('--service') || process.env.KARIM_CONTROL_ACTIONS === '1';
    const dryRun = process.argv.includes('--dry-run');
    const app = createControlServer({ actionsEnabled, dryRun });
    app.start().then(() => {
        const shutdown = () => {
            app.close().then(() => process.exit(0)).catch(() => process.exit(1));
        };
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    }).catch((error) => {
        console.error(`[server-control] FATAL: ${safeError(error)}`);
        process.exit(1);
    });
}

if (require.main === module) {main();}

module.exports = {
    createControlServer,
    parseScState,
    validAction,
    constantTimeEqual,
    createLimiter,
    CONFIRM_PHRASE,
    VERSION,
};
