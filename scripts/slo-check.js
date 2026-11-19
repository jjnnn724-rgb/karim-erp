#!/usr/bin/env node
/**
 * slo-check.js — فاحص أهداف مستوى الخدمة (SLO) مقابل /api/metrics الحي.
 * بلا اعتماديات. يصلح لمراقبة cron خارجية: exit 0 = كل الأهداف محققة، 1 = خرق.
 *
 * التشغيل:
 *   SLO_BASE_URL=http://127.0.0.1:5000 SLO_USER=... SLO_PASS=... SLO_API_KEY=... \
 *     node scripts/slo-check.js
 * (الاعتمادات من البيئة فقط — لا تُطبع أبدًا.)
 *
 * الأهداف (معايرة على قياسات فعلية: حمل 1786 rps بصفر أخطاء، p95 حي ≤163ms):
 *   availability : 5xx/total            < 0.5%
 *   latency      : p95(last5m)          < 300ms   (حد التنبيه 800ms = SLOW_MS)
 *   slow         : slow/total           < 1%
 *   eventLoop    : p99 lag              < 100ms
 *   dbPool       : waiting              = 0
 *   memory       : heapUsedMB           < 1024MB  (نسبة V8 used/total مضللة — حد مطلق)
 */
'use strict';
const BASE = process.env.SLO_BASE_URL || 'http://127.0.0.1:5000';
const USER = process.env.SLO_USER || '';
const PASS = process.env.SLO_PASS || '';
const KEY = process.env.SLO_API_KEY || '';

const THRESHOLDS = {
    availability5xxPct: 0.5,
    p95Ms: 300,
    slowPct: 1,
    eventLoopP99Ms: 100,
    poolWaiting: 0,
    heapUsedMB: 1024,
};

(async () => {
    if (!USER || !PASS) { console.error('SLO_USER/SLO_PASS مطلوبان في البيئة'); process.exit(2); }
    const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASS }) });
    if (!login.ok) { console.error('فشل الدخول لفاحص SLO:', login.status); process.exit(2); }
    const tok = (await login.json()).access_token;
    const r = await fetch(BASE + '/api/metrics', { headers: { Authorization: 'Bearer ' + tok, 'x-api-key': KEY } });
    if (!r.ok) { console.error('فشل جلب المقاييس:', r.status); process.exit(2); }
    const m = await r.json();
    const req = m.requests || {};
    const total = req.total || 0;
    const err5 = req.server5xx || 0;
    const slow = req.slow || 0;
    const p95 = (req.latency && req.latency.last5m && req.latency.last5m.p95) || 0;
    const lag = m.eventLoopLagUs || {};
    const lagP99Ms = (lag.p99Us || 0) / 1000;
    const pool = m.dbPool || {};
    const mem = m.memory || {};
    // نسبة used/total في V8 مضللة (heapTotal ينمو عند الطلب) — الحد المطلق هو الحقيقي.
    const heapUsedMB = mem.heapUsedMB || 0;

    const checks = [
        ['availability (5xx%)', total ? (100 * err5 / total) : 0, THRESHOLDS.availability5xxPct, '<'],
        ['latency p95 ms', p95, THRESHOLDS.p95Ms, '<'],
        ['slow requests %', total ? (100 * slow / total) : 0, THRESHOLDS.slowPct, '<'],
        ['event-loop p99 ms', lagP99Ms, THRESHOLDS.eventLoopP99Ms, '<'],
        ['db pool waiting', pool.waiting || 0, THRESHOLDS.poolWaiting, '='],
        ['heap used MB', heapUsedMB, THRESHOLDS.heapUsedMB, '<'],
    ];
    let breaches = 0;
    console.log('📈 SLO check — ' + BASE + ' (uptime ' + Math.round((m.uptimeSec || 0) / 60) + 'm, requests ' + total + ')');
    for (const [name, val, limit, op] of checks) {
        const ok = op === '=' ? val === limit : val < limit;
        if (!ok) { breaches++; }
        console.log((ok ? '  ✓ ' : '  ✗ ') + name + ': ' + (Math.round(val * 100) / 100) + ' (حد ' + op + ' ' + limit + ')');
    }
    console.log(breaches ? '🚨 SLO BREACH: ' + breaches + ' هدف/أهداف مخروقة' : '✅ كل أهداف SLO محققة');
    process.exit(breaches ? 1 : 0);
})().catch((e) => { console.error('SLO check error:', String(e.message).slice(0, 120)); process.exit(2); });
