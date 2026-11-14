/**
 * watchdog-health.mjs — حارس صحة karimeg.online
 * ════════════════════════════════════════════════════════════════════════════
 * ينقل "هل الموقع حيّ؟" من سؤال يدوي إلى يقين آلي. عند أي فشل:
 *   1. يسجّل في logs/watchdog-YYYY-MM-DD.log
 *   2. (اختياري) يرسل تنبيهًا فوريًا عبر HTTP إلى WATCHDOG_WEBHOOK
 *   3. خروج بحالة 1 — يمكن جدولة Windows Task Scheduler / cron لالتقاطه
 *
 * الاستخدام: node scripts/watchdog-health.mjs
 * للتفحص لمرة واحدة وفوري: WAKE=1 node scripts/watchdog-health.mjs
 * للتشغيل الدائم (توصيات الإنتاج الحقيقي: المراقبة تۆوي (`at` أو Task Scheduler)).
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import https from 'https';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, `watchdog-${new Date().toISOString().slice(0, 10)}.log`);
const HEALTH_URL = process.env.WATCHDOG_HEALTH_URL || 'https://karimeg.online/api/health';
const WEBHOOK = process.env.WATCHDOG_WEBHOOK || '';
const TIMEOUT_MS = 8000;
const MAX_FAILS = Number(process.env.WATCHDOG_MAX_FAILS || 3);

if (!existsSync(LOG_DIR)) { mkdirSync(LOG_DIR, { recursive: true }); }

const log = (line) => {
    const entry = `${new Date().toISOString()} | ${line}\n`;
    appendFileSync(LOG_FILE, entry);
    process.stdout.write(entry);
};

const checkOnce = () => new Promise((resolve) => {
    const lib = HEALTH_URL.startsWith('https:') ? https : http;
    const req = lib.get(HEALTH_URL, { timeout: TIMEOUT_MS, headers: { 'user-agent': 'karim-watchdog/1.0' } }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
            const ok = res.statusCode >= 200 && res.statusCode < 300;
            let parsed = null;
            try { parsed = JSON.parse(body); } catch (_) { /* ignore */ }
            resolve({ ok, status: res.statusCode, parsed, body: body.slice(0, 200) });
        });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, parsed: null, body: 'timeout' }); });
    req.on('error', (err) => resolve({ ok: false, status: 0, parsed: null, body: String(err.message) }));
});

const postWebhook = (statusText, payload) => new Promise((resolve) => {
    if (!WEBHOOK) { resolve(false); return; }
    const url = new URL(WEBHOOK);
    const lib = url.protocol === 'https:' ? https : http;
    const data = JSON.stringify({ status: statusText, url: HEALTH_URL, at: new Date().toISOString(), ...payload });
    const req = lib.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
        timeout: TIMEOUT_MS,
    }, (res) => { res.resume(); resolve(res.statusCode < 300); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.write(data);
    req.end();
});

const main = async () => {
    const result = await checkOnce();
    if (result.ok) {
        const p = result.parsed || {};
        const comps = Array.isArray(p.components) ? p.components.map((c) => `${c.component}:${c.status}`).join(',') : 'n/a';
        log(`✓ UP  status=${result.status} version=${p.app?.version || '?'} env=${p.app?.env || '?'} uptime=${p.boot?.uptime || '?'} comps=[${comps}] host=${p.host?.hostname || '?'}`);
        process.exit(0);
    }
    const failsFile = path.join(LOG_DIR, 'watchdog-fails.json');
    let fails = 0;
    try { fails = Number(JSON.parse((await import('fs')).readFileSync(failsFile, 'utf8') || '{}').count || 0); } catch (_) { fails = 0; }
    fails += 1;
    writeFileSync(failsFile, JSON.stringify({ count: fails, since: new Date().toISOString() }));
    log(`✗ DOWN #${fails} status=${result.status} body=${result.body}`);
    if (fails >= MAX_FAILS) {
        const sent = await postWebhook('DOWN', { consecutiveFails: fails, lastBody: result.body });
        log(sent ? '→ تنبيه وُجّه إلى WATCHDOG_WEBHOOK' : '→ لا WEBHOOK مضبوط — سجّل فقط (راجع RUNBOOK)');
        writeFileSync(failsFile, JSON.stringify({ count: 0, lastAt: new Date().toISOString() })); // reset — تنبيه واحد لكل سلسلة
        process.exit(1);
    }
    process.exit(fails >= 2 ? 1 : 0);
};

main().catch((err) => { log(`ERR watchdog crashed: ${err.message}`); process.exit(2); });
