#!/usr/bin/env node
/**
 * tests/load/stress-test.js — اختبار ضغط حقيقي لنظام Karim ERP
 * ─────────────────────────────────────────────────────────────
 * سيناريوهات مغلقة الحلقة (closed-loop) على HTTPS محلي:
 *   1) reads-ladder    : سلّم قراءة 25 → 50 → 100 مستخدم متزامن (20 ثانية لكل درجة)
 *   2) login-storm     : عاصفة دخول bcrypt (10 متزامنين × 15 ثانية)
 *   3) writes          : إنشاء+حذف فوري لقسم HR (20 متزامنًا × 20 ثانية) — صافي نمو صفر
 *   4) mixed-sustained : 60 ثانية مستمرة (50 متزامنًا — 85% قراءة / 15% كتابة)
 *   5) spike           : قفزة مفاجئة 150 متزامنًا (10 ثوانٍ) لاختبار التعافي
 *
 * القياسات: rps، مئينات الاستجابة (p50/p90/p95/p99/max)، توزيع الحالات،
 * أخطاء الشبكة، RSS لعملية الخادم قبل/بعد، وفحص بقاء الخدمة بعد الضغط.
 *
 * الاستخدام:
 *   node tests/load/stress-test.js --out results/phase-before.json
 *   node tests/load/stress-test.js --smoke    (تشغيل مختصر للتحقق من الأداة)
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ─── إعدادات ثابتة (نفسها في كل مراحل القياس) ───
const BASE = 'https://127.0.0.1:5000';
// Never hard-code this: it used to live here and leaked to a public remote.
const API_KEY = process.env.API_KEY || '';
const ADMIN_USER = 'admin';
const ADMIN_PASS = process.env.KARIM_FIXED_ADMIN_PASSWORD || '';

const READ_ENDPOINTS = [
    '/api/employees',
    '/api/attendance',
    '/api/users',
    '/api/departments',
    '/api/hrDepartments',
    '/api/inventory',
    '/',
];

function arg(name, fallback) {
    const i = process.argv.indexOf('--' + name);
    return i > -1 ? process.argv[i + 1] : fallback;
}
const SMOKE = process.argv.includes('--smoke');
const OUT = arg('out', null);

const agent = new https.Agent({ keepAlive: true, maxSockets: 512, rejectUnauthorized: false });

// يُرجع الحالة + الجسم (الجسم لازم لحذف ما أنشأته فورًا)
function request(method, p, { token, body } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const started = process.hrtime.bigint();
        const req = https.request(BASE + p, {
            method,
            agent,
            rejectUnauthorized: false,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': API_KEY,
                ...(token ? { Authorization: 'Bearer ' + token } : {}),
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
            },
        }, (res) => {
            let raw = '';
            res.on('data', c => { raw += c; });
            res.on('end', () => {
                const ms = Number(process.hrtime.bigint() - started) / 1e6;
                resolve({ ms, status: res.statusCode, text: raw, bytes: Buffer.byteLength(raw) });
            });
        });
        req.on('timeout', () => { req.destroy(new Error('CLIENT_TIMEOUT')); });
        req.on('error', (e) => {
            const ms = Number(process.hrtime.bigint() - started) / 1e6;
            resolve({ ms, status: 0, error: e.message, text: '', bytes: 0 });
        });
        if (data) { req.write(data); }
        req.end();
    });
}

// ─── تجميع النتائج ───
function newStats() {
    return { requests: 0, byStatus: {}, byEndpoint: {}, errors: {}, latencies: [], bytes: 0 };
}
function record(stats, ep, r) {
    stats.requests++;
    stats.bytes += r.bytes || 0;
    const sk = r.status === 0 ? 'network_error' : String(r.status);
    stats.byStatus[sk] = (stats.byStatus[sk] || 0) + 1;
    if (r.status === 0) { stats.errors[r.error || 'unknown'] = (stats.errors[r.error || 'unknown'] || 0) + 1; }
    const e = stats.byEndpoint[ep] || (stats.byEndpoint[ep] = { requests: 0, latencies: [], byStatus: {} });
    e.requests++;
    e.latencies.push(r.ms);
    e.byStatus[sk] = (e.byStatus[sk] || 0) + 1;
    stats.latencies.push(r.ms);
}
function pct(sorted, p) {
    if (!sorted.length) { return 0; }
    const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return Math.round(sorted[i] * 10) / 10;
}
function summarize(stats, durationMs, label) {
    const lat = stats.latencies.slice().sort((a, b) => a - b);
    const secs = durationMs / 1000;
    return {
        label,
        requests: stats.requests,
        rps: Math.round((stats.requests / secs) * 10) / 10,
        duration_s: Math.round(secs * 10) / 10,
        mb_transferred: Math.round(stats.bytes / 1048576 * 10) / 10,
        p50: pct(lat, 50), p90: pct(lat, 90), p95: pct(lat, 95), p99: pct(lat, 99),
        max: lat.length ? Math.round(lat[lat.length - 1] * 10) / 10 : 0,
        byStatus: stats.byStatus,
        errors: stats.errors,
        perEndpoint: Object.fromEntries(Object.entries(stats.byEndpoint).map(([ep, e]) => {
            const l = e.latencies.slice().sort((a, b) => a - b);
            return [ep, { requests: e.requests, rps: Math.round((e.requests / secs) * 10) / 10, p50: pct(l, 50), p95: pct(l, 95), byStatus: e.byStatus }];
        })),
    };
}

// ─── قياس عملية الخادم (RSS) ───
function serverProcSample() {
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*backend*server.js*' } | ForEach-Object { '{0}|{1}' -f $_.ProcessId, [math]::Round($_.WorkingSetSize/1MB) }"],
        { encoding: 'utf-8' });
    const line = (r.stdout || '').trim().split('\n')[0];
    if (!line) { return null; }
    const [pid, ws] = line.split('|');
    return { pid: Number(pid), rss_mb: Number(ws) };
}

// ─── محرك الحلقة المغلقة ───
async function runScenario({ label, concurrency, durationMs, pickAction, warmupMs = 2000 }) {
    const stats = newStats();
    const deadline = Date.now() + durationMs;
    const warmupDeadline = Date.now() + warmupMs;
    let stop = false;

    const workers = [];
    for (let w = 0; w < concurrency; w++) {
        workers.push((async () => {
            let i = w;
            while (!stop) {
                const r = await pickAction(i++);
                if (Date.now() < warmupDeadline) { continue; } // التسخين لا يُحسب
                record(stats, r.ep, r.res);
            }
        })());
    }
    await new Promise((resolve) => {
        const iv = setInterval(() => {
            if (Date.now() >= deadline) { stop = true; clearInterval(iv); resolve(); }
        }, 250);
    });
    await Promise.all(workers);
    return summarize(stats, durationMs, label);
}

// عملية كتابة واقعية: إنشاء قسم ثم حذفه فورًا (صافي أثر صفر على القاعدة)
async function writePair(token, prefix) {
    const code = `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const created = await request('POST', '/api/hrDepartments', { token, body: { name: 'اختبار ضغط ' + code, code } });
    if (created.status >= 200 && created.status < 300) {
        let id = null;
        try { id = JSON.parse(created.text).id; } catch (_) {}
        if (id != null) {
            const del = await request('DELETE', '/api/hrDepartments/' + id, { token });
            return { ep: 'POST+DELETE hrDepartments', res: del.status === 200 ? created : del };
        }
    }
    return { ep: 'POST+DELETE hrDepartments', res: created };
}

(async () => {
    const t0 = Date.now();
    const phase = SMOKE ? 'smoke' : path.basename(OUT || 'run');
    console.log(`\n=== اختبار ضغط Karim ERP — ${phase} ===`);
    const procBefore = serverProcSample();
    console.log(`الخادم قبل الاختبار: PID=${procBefore?.pid} RSS=${procBefore?.rss_mb}MB`);

    // 0) دخول admin مرة واحدة والحصول على JWT
    const login = await request('POST', '/api/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASS } });
    let token = null;
    try { const j = JSON.parse(login.text); token = j.access_token || j.accessToken || j.token; } catch (_) {}
    if (login.status !== 200 || !token) {
        console.error('فشل الدخول المبدئي — أُلغي الاختبار.', login.status, login.text.slice(0, 200));
        process.exit(1);
    }
    console.log('الدخول المبدئي: OK');

    const results = { phase, startedAt: new Date().toISOString(), serverBefore: procBefore, scenarios: [] };
    let failed = false;

    // ─── 1) سلّم القراءة ───
    for (const c of SMOKE ? [5] : [25, 50, 100]) {
        const s = await runScenario({
            label: `reads-c${c}`,
            concurrency: c,
            durationMs: SMOKE ? 4000 : 20000,
            pickAction: (i) => {
                const ep = READ_ENDPOINTS[i % READ_ENDPOINTS.length];
                return request('GET', ep, { token }).then(res => ({ ep, res }));
            },
        });
        results.scenarios.push(s);
        console.log(`[${s.label}] rps=${s.rps} p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms max=${s.max}ms statuses=${JSON.stringify(s.byStatus)}`);
    }

    // ─── 2) عاصفة الدخول (bcrypt cost 12 — ثقيل عمدًا) ───
    {
        const s = await runScenario({
            label: 'login-storm-c10',
            concurrency: 10,
            durationMs: SMOKE ? 4000 : 15000,
            pickAction: () => request('POST', '/api/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASS } }).then(res => ({ ep: 'POST /api/auth/login', res })),
        });
        results.scenarios.push(s);
        console.log(`[${s.label}] rps=${s.rps} p50=${s.p50}ms p95=${s.p95}ms statuses=${JSON.stringify(s.byStatus)}`);
    }

    // ─── 3) الكتابة: إنشاء+حذف قسم HR ───
    {
        const s = await runScenario({
            label: 'writes-c20',
            concurrency: 20,
            durationMs: SMOKE ? 4000 : 20000,
            pickAction: () => writePair(token, 'HRD-ST').then(r => r),
        });
        results.scenarios.push(s);
        console.log(`[${s.label}] rps=${s.rps} p50=${s.p50}ms p95=${s.p95}ms statuses=${JSON.stringify(s.byStatus)}`);
    }

    // ─── 4) حمل مختلط مستمر 60 ثانية ───
    {
        const s = await runScenario({
            label: 'mixed-sustained-c50-60s',
            concurrency: 50,
            durationMs: SMOKE ? 4000 : 60000,
            pickAction: (i) => (i % 20 === 7
                ? writePair(token, 'HRD-MX')
                : request('GET', READ_ENDPOINTS[i % READ_ENDPOINTS.length], { token }).then(res => ({ ep: READ_ENDPOINTS[i % READ_ENDPOINTS.length], res }))),
        });
        results.scenarios.push(s);
        console.log(`[${s.label}] rps=${s.rps} p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms statuses=${JSON.stringify(s.byStatus)}`);
    }

    // ─── 5) قفزة مفاجئة ───
    {
        const s = await runScenario({
            label: 'spike-c150',
            concurrency: SMOKE ? 20 : 150,
            durationMs: SMOKE ? 4000 : 10000,
            warmupMs: 500,
            pickAction: (i) => {
                const ep = READ_ENDPOINTS[i % READ_ENDPOINTS.length];
                return request('GET', ep, { token }).then(res => ({ ep, res }));
            },
        });
        results.scenarios.push(s);
        console.log(`[${s.label}] rps=${s.rps} p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms statuses=${JSON.stringify(s.byStatus)}`);
    }

    // ─── فحص بقاء الخادم بعد الضغط ───
    await new Promise(r => setTimeout(r, 3000));
    const health = await request('GET', '/api/server/info');
    const procAfter = serverProcSample();
    results.serverAfter = procAfter;
    results.healthAfter = health.status;
    results.totalMinutes = Math.round((Date.now() - t0) / 60000 * 10) / 10;
    console.log(`\nبقاء الخادم بعد الضغط: GET /api/server/info → ${health.status} | RSS قبل=${procBefore?.rss_mb}MB بعد=${procAfter?.rss_mb}MB (PID ${procBefore?.pid} → ${procAfter?.pid})`);
    if (health.status !== 200) { failed = true; }

    if (OUT) {
        fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
        fs.writeFileSync(path.resolve(OUT), JSON.stringify(results, null, 2));
        console.log(`حُفظت النتائج: ${path.resolve(OUT)}`);
    }
    console.log(failed ? '=== انتهى الاختبار (تحذير: الخادم لم يستجب بعد الضغط) ===' : '=== انتهى الاختبار ===\n');
    process.exit(failed ? 2 : 0);
})().catch(e => { console.error('HARNESS_ERROR', e); process.exit(1); });
