#!/usr/bin/env node
'use strict';
/**
 * deploy-verify.js — نشر متحقَّق على خدمة ويندوز + قياس الانقطاع الحقيقي
 * ══════════════════════════════════════════════════════════════════════
 * لماذا: كنا نظنّ أن الانقطاع ~60 ثانية. القياس الفعلي: الخادم يقبل
 * الطلبات بعد ~1.8s ⇒ الانقطاع = إيقاف الخدمة + انتظار تحرير المنفذ.
 * هذا السكربت يجعل الرقم **مقيسًا ومقروءًا** في كل نشر (لا تقدير):
 *
 *   1) فحوص ما قبل النشر (بوابات CI السريعة).
 *   2) إعادة تشغيل الخدمة.
 *   3) قياس الانقطاع: أول فشل → أول نجاح (باستطلاع كل 200ms).
 *   4) تحقق ما بعد النشر: صحة الخدمة + رؤوس CSP + صفحات + دور قاعدة
 *      البيانات (ليس superuser) + سجل الترحيلات.
 *   5) تقرير (يُحفظ في logs/deploy-<ts>.json).
 *
 * الاستخدام:
 *   node scripts/deploy-verify.js --dry-run   # فحوص فقط بلا إعادة تشغيل
 *   node scripts/deploy-verify.js              # نشر + تحقق
 *   node scripts/deploy-verify.js --no-preflight
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env'), override: false });
const SERVICE = 'KarimERP-Server';
const HEALTH_URL = 'https://127.0.0.1:5000/api/health';
const DRY = process.argv.includes('--dry-run');
const NO_PREFLIGHT = process.argv.includes('--no-preflight');
const LOGS = path.join(ROOT, 'logs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(url, { timeout = 8000 } = {}) {
    return new Promise((resolve) => {
        const req = https.get(url, { rejectUnauthorized: false, timeout }, (res) => {
            let body = '';
            res.on('data', (c) => {body += c;});
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => {req.destroy(); resolve(null);});
    });
}

function run(cmd, args, opts = {}) {
    try {
        const out = execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...opts });
        return { ok: true, out: (out || '').trim() };
    } catch (e) {
        return { ok: false, out: (e.stdout || '') + (e.stderr || ''), code: e.status };
    }
}

const GATES = [
    { name: 'lint', cmd: process.execPath, args: ['scripts/lint-gate.js'] },
    { name: 'secrets', cmd: process.execPath, args: ['scripts/check-secrets.js'] },
    { name: 'inline-budget', cmd: process.execPath, args: ['scripts/audit-csp-inline-handlers.js', '--check', 'scripts/inline-handlers-baseline.json'] },
    { name: 'inline-scripts', cmd: process.execPath, args: ['scripts/audit-csp-inline-handlers.js', '--check-inline-scripts'] },
    { name: 'dispatch', cmd: process.execPath, args: ['scripts/audit-csp-inline-handlers.js', '--check-dispatch'] },
    { name: 'dead-handlers', cmd: process.execPath, args: ['scripts/audit-inline-handlers.js'] },
    { name: 'docker', cmd: process.execPath, args: ['scripts/check-docker.js'] },
    { name: 'frontend-version', cmd: process.execPath, args: ['scripts/frontend-version.js', '--check'] },
];

async function main() {
    const report = { startedAt: new Date().toISOString(), gates: [], restart: null, checks: [], downtimeMs: null };

    if (!NO_PREFLIGHT) {
        console.log('\n=== 1) فحوص ما قبل النشر ===');
        let failed = 0;
        for (const g of GATES) {
            const r = run(g.cmd, g.args);
            report.gates.push({ name: g.name, ok: r.ok });
            console.log(`  ${r.ok ? '✓' : '✗'} ${g.name}`);
            if (!r.ok) {failed++; console.log(`      ${r.out.split('\n').slice(0, 4).join('\n      ')}`);}
        }
        if (failed) {
            console.error(`\n✗ ${failed} فحص فشل — أُوقف النشر (لم يُمسّ الإنتاج).`);
            fs.mkdirSync(LOGS, { recursive: true });
            fs.writeFileSync(path.join(LOGS, `deploy-${Date.now()}.json`), JSON.stringify(report, null, 2));
            process.exit(1);
        }
    }

    if (DRY) {
        console.log('\n(dry-run) لم تُستأنف الخدمة.');
        return;
    }

    // ── إعادة التشغيل ──
    console.log('\n=== 2) إعادة تشغيل الخدمة ===');
    const before = await get(HEALTH_URL);
    // sc.exe لا ينتظر اكتمال الإقلاع (بع��ض PowerShell ينتظر) ⇒ نتحكّم
    // في التوقيت بأنفسنا عبر استطلاع /api/health.
    const stop = run('sc.exe', ['stop', SERVICE], { timeout: 60000 });
    await sleep(1500);
    const start = run('sc.exe', ['start', SERVICE], { timeout: 60000 });
    report.restart = { command: 'sc stop/start', stop: stop.ok, start: start.ok, at: new Date().toISOString() };
    console.log(`  ${stop.ok ? '✓' : '✗'} sc stop · ${start.ok ? '✓' : '✗'} sc start`);

    // ── قياس الانقطاع ──
    console.log('\n=== 3) قياس الانقطاع ===');
    let downAt = null; let upAt = null;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
        const h = await get(HEALTH_URL, { timeout: 2000 });
        const now = Date.now();
        if (!h || h.status !== 200) {
            if (downAt === null) {downAt = now;}
        } else if (downAt !== null) {
            upAt = now;
            break;
        } else if (before && before.status === 200) {
            // لم تنزل الخدمة أصلاً (إعادة تشغيل فورية) ⇒ لا انقطاع مرصود
            upAt = now;
            downAt = now;
            break;
        }
        await sleep(200);
    }
    report.downtimeMs = (downAt !== null && upAt !== null) ? (upAt - downAt) : null;
    console.log(`  ${report.downtimeMs === null ? '✗' : '✓'} الانقطاع = ${report.downtimeMs === null ? 'غير محدَّد' : `${report.downtimeMs}ms`}`);

    // ── تحقق ما بعد النشر ──
    console.log('\n=== 4) تحقق ما بعد النشر ===');
    const checks = [
        { id: 'health', run: async () => {
            const h = await get(HEALTH_URL);
            return h && h.status === 200
                ? { ok: true, detail: `status=${h.status} boot=${(JSON.parse(h.body).boot || {}).initialized}` }
                : { ok: false, detail: `status=${h ? h.status : 'no-response'}` };
        } },
        { id: 'app-page', run: async () => {
            const p = await get('https://127.0.0.1:5000/app/index.html');
            return p && p.status === 200 ? { ok: true, detail: `status=${p.status} len=${p.body.length}` } : { ok: false, detail: `status=${p ? p.status : 'no-response'}` };
        } },
        { id: 'csp-strict', run: async () => {
            const p = await get('https://127.0.0.1:5000/app/index.html');
            const csp = (p && p.headers['content-security-policy']) || '';
            const attr = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src-attr')) || '';
            return attr.includes("'none'") ? { ok: true, detail: attr } : { ok: false, detail: attr || 'missing' };
        } },
        { id: 'db-role', run: async () => {
            // نتحقّق بدور التطبيق نفسه (كما في .env) — لا postgres.
            const r = run('C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',
                ['-tA', '-h', process.env.DB_HOST || '127.0.0.1', '-p', process.env.DB_PORT || '5432',
                    '-U', process.env.DB_USER || 'karim_app', '-d', process.env.DB_NAME || 'karim_erp',
                    '-c', "SELECT r.rolname||' super='||r.rolsuper FROM pg_roles r WHERE r.rolname=current_user;"],
                { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD } });
            const out = (r.out || '').trim();
            return out.includes('super=false') ? { ok: true, detail: out } : { ok: false, detail: out || 'no-output' };
        } },
        { id: 'migrations', run: async () => {
            const r = run('C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',
                ['-tA', '-h', process.env.DB_HOST || '127.0.0.1', '-p', process.env.DB_PORT || '5432',
                    '-U', process.env.DB_USER || 'karim_app', '-d', process.env.DB_NAME || 'karim_erp',
                    '-c', 'SELECT count(*) FROM schema_migrations;'],
                { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD } });
            const n = Number((r.out || '').trim());
            return n > 100 ? { ok: true, detail: `${n} ترحيلًا مطبَّقًا` } : { ok: false, detail: `count=${n}` };
        } },
    ];
    for (const c of checks) {
        const res = await c.run();
        report.checks.push({ id: c.id, ...res });
        console.log(`  ${res.ok ? '✓' : '✗'} ${c.id}${res.detail ? ` — ${res.detail}` : ''}`);
    }

    fs.mkdirSync(LOGS, { recursive: true });
    const file = path.join(LOGS, `deploy-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));

    const failedChecks = report.checks.filter((c) => !c.ok).length;
    console.log(`\n=== الخلاصة ===`);
    console.log(`  الانقطاع: ${report.downtimeMs === null ? 'غير محدَّد' : `${report.downtimeMs}ms`}`);
    console.log(`  فحوص ما بعد النشر: ${report.checks.length - failedChecks}/${report.checks.length}`);
    console.log(`  التقرير: ${path.relative(ROOT, file)}`);
    if (failedChecks) {process.exitCode = 1;}
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
