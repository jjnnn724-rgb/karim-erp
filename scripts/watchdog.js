// watchdog.js — المهندس المقيم: فحص وإصلاح ذاتي لمنظومة Karim ERP
// ────────────────────────────────────────────────────────────────────────────
// يفحص كل دورة (موصى به كل 5 دقائق كمهمة SYSTEM):
//   1) PostgreSQL يعمل؟ لا → تشغيل الخدمة
//   2) السيرفر يستجيب صحة؟ لا → إعادة تشغيل خدمة KarimERP-Server (أو بدء العملية)
//   3) النفق متصل؟ لا → إعادة تشغيل cloudflared
//   4) مساحة القرص < 2GB؟ نعم → تقليم السجلات القديمة + تنبيه
//   5) آخر نسخة ليلية أقدم من 30 ساعة؟ نعم → تشغيل نسخة فورًا
//   6) تقرير حالة JSON دائمًا (آخر فحص + أي إجراء)
// لا يوقف أي شيء يعمل — يتدخل فقط عند الفشل. خروج 0 دائمًا إلا عطل حرج.
// الاستخدام: node scripts/watchdog.js [--fix] (بدون --fix: فحص فقط)
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const https = require('https');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BACKUPS = path.join(ROOT, 'database', 'backups');
const LOGS = path.join(ROOT, 'logs');
const STATUS_FILE = path.join(BACKUPS, 'watchdog-status.json');
const MAINT_FILE = path.join(ROOT, 'runtime', 'maintenance.json');
const { readMaintenance, maintenanceDecision } = require('../backend/server-control-maintenance');
const FIX = process.argv.includes('--fix');
const report = { at: new Date().toISOString(), fix: FIX, checks: {}, actions: [], ok: true };
// تحميل .env (كلمة مرور القاعدة لفحص الروابط) — best-effort
try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m && (process.env[m[1]] === undefined || process.env[m[1]] === '')) {process.env[m[1]] = m[2];}
    }
} catch (_) {}

function log(msg) { console.log(`[watchdog] ${msg}`); }
function tcpOk(host, port, ms = 4000) {
    return new Promise((resolve) => {
        const s = new net.Socket();
        const done = (v) => { try { s.destroy(); } catch (_) {} resolve(v); };
        s.setTimeout(ms);
        s.once('connect', () => done(true));
        s.once('timeout', () => done(false));
        s.once('error', () => done(false));
        s.connect(port, host);
    });
}
function httpsOk(urlStr, ms = 10000, family = 0) {
    return new Promise((resolve) => {
        const req = https.get(urlStr, { rejectUnauthorized: false, timeout: ms, family }, (res) => {
            let b = '';
            res.on('data', (c) => { b += c; });
            res.on('end', () => resolve(res.statusCode === 200 && b.includes('"status":"ok"')));
        });
        req.on('timeout', () => { try { req.destroy(); } catch (_) {} resolve(false); });
        req.on('error', () => resolve(false));
    });
}
function svc(cmd, name) {
    try {
        const out = execFileSync('sc', ['query', name], { encoding: 'utf8', timeout: 15000 });
        return /RUNNING/.test(out) ? 'running' : 'stopped';
    } catch (e) { return 'unknown:' + String(e.message).slice(0, 60); }
}
function svcQuery(name) {
    try {
        const out = execFileSync('sc', ['query', name], { encoding: 'utf8', timeout: 15000 });
        const state = (out.match(/STATE\s*:\s*\d+\s+([A-Z_]+)/) || [])[1] || 'UNKNOWN';
        return { exists: true, running: state === 'RUNNING', state };
    } catch (e) {
        const text = String(e.stdout || '') + String(e.message || '');
        if (/1060|does not exist/i.test(text)) {return { exists: false, running: false, state: 'NOT_INSTALLED' };}
        return { exists: true, running: false, state: 'UNKNOWN' };
    }
}
function svcStart(name) {
    const r = spawnSync('sc', ['start', name], { encoding: 'utf8', timeout: 60000 });
    return r.status === 0 || /START_PENDING|RUNNING/.test(r.stdout || '');
}
function procRunning(exe) {
    try {
        const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${exe}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 15000 });
        return out.toLowerCase().includes(exe.toLowerCase());
    } catch (_) { return false; }
}
// انتظار تحرّر المنفذ قبل تشغيل الخادم (FIX 2026-10-19): الإيقاف ليس فوريًا
// (stoptimeout=30s)، والتشغيل قبل التحرّر يُنتج EADDRINUSE يُسقط النسخة الجديدة.
async function waitPortFree(port, totalMs = 45000) {
    const t0 = Date.now();
    while (Date.now() - t0 < totalMs) {
        if (!(await tcpOk('127.0.0.1', port, 1500))) {return true;}
        await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
}

(async () => {
    // ── 1) PostgreSQL ──
    const pgPort = await tcpOk('127.0.0.1', 5432);
    report.checks.postgres = pgPort ? 'listening' : svc('x', 'postgresql-x64-18');
    if (!pgPort) {
        report.ok = false;
        if (FIX) {
            const started = svcStart('postgresql-x64-18');
            report.actions.push(`postgres-start:${started ? 'ok' : 'FAILED'}`);
            await new Promise((r) => setTimeout(r, 8000));
            report.checks.postgres_after = (await tcpOk('127.0.0.1', 5432)) ? 'listening' : 'STILL-DOWN';
            if (report.checks.postgres_after !== 'listening') {report.ok = false;}
        }
    }

    // ── 1b) الخدمة المرافقة للتحكم: إن كانت مثبتة يجب أن تبقى حيّة ──
    /* هي التي تستقبل «تشغيل» بعد الإيقاف، وتفرض وضع الصيانة. سقوطها لا يوقف
       ERP، لكنه يعطّل زر التشغيل — فيُعاد تشغيلها بأمان. */
    const ctl = svcQuery('KarimERP-Control');
    report.checks.control_service = ctl.exists ? ctl.state : 'not-installed';
    if (ctl.exists && !ctl.running) {
        report.ok = false;
        report.actions.push('control-down');
        if (FIX) {
            const started = svcStart('KarimERP-Control');
            report.actions.push(`control-start:${started ? 'ok' : 'FAILED'}`);
        }
    }

    // ── 2) ERP backend — مع احترام وضع الصيانة الصريح ──
    /* FIX 2026-10-20: لا نُسقط خادمًا حيًّا مشغولًا. الفحص الواحد كان يكفي
       لأن يمرّ ضغطُ الاستعلامات أو إقلاعٌ بطيء كـ«سقوط»، فيُعاد التشغيل بلا
       داعٍ ويرى المستخدم الخدمة تقع. ثلاث محاولات متباعدة = مهلة تعافٍ حقيقية،
       ولا تدخّل إلا إذا بقي ميتًا فعلًا.
       FIX 2026-10-21: إيقاف المشرف من لوحة التحكم قرار صريح — لا يُلغى تلقائيًا.
       راية الصيانة تُقرأ دائمًا، والحالات العابرة تُحترم 10 دقائق فقط. */
    const maintenance = readMaintenance(MAINT_FILE);
    const maintenanceGate = maintenanceDecision(maintenance);
    const skipErp = maintenanceGate.skip;
    report.checks.maintenance = maintenance
        ? `${maintenance.state}${skipErp ? '' : ' (stale)'}`
        : 'none';
    let apiOk = false;
    if (skipErp) {
        report.checks.erp = `maintenance:${maintenance.state}`;
        log(`maintenance=${maintenance.state} — healing skipped`);
    } else {
        for (let i = 0; i < 3 && !apiOk; i++) {
            if (i) {await new Promise((r) => setTimeout(r, 5000));}
            apiOk = await httpsOk('https://127.0.0.1:5000/api/health', 15000);
        }
        report.checks.erp = apiOk ? 'healthy' : 'DOWN';
        if (!apiOk) {
            report.ok = false;
            if (FIX) {
                let revived = false;
                // أ) خدمة الويندوز: إيقاف رشيق ← انتظار تحرّر المنفذ ← تشغيل.
                try {
                    const st = svc('x', 'KarimERP-Server');
                    if (st === 'running' || st === 'stopped' || String(st).startsWith('unknown') === false) {
                        spawnSync('sc', ['stop', 'KarimERP-Server'], { timeout: 40000 });
                        const freed = await waitPortFree(5000, 45000);
                        report.actions.push(`port-free:${freed ? 'ok' : 'timeout'}`);
                        revived = svcStart('KarimERP-Server');
                    }
                } catch (_) {}
                // ب) بدء مباشر مخفي كاحتياطي (فقط إذا لم تُقلع الخدمة)
                if (!revived) {
                    try {
                        await waitPortFree(5000, 20000);
                        spawnSync('C:\\nodejs\\node.exe', [path.join(ROOT, 'backend', 'server.js')],
                            { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true, timeout: 15000 }).unref?.();
                        revived = true;
                    } catch (_) {}
                }
                report.actions.push(`erp-restart:${revived ? 'attempted' : 'FAILED'}`);
                // انتظار أطول: الإقلاع الكامل (ترحيلات/فهارس/محركات) قد يتجاوز 25 ثانية.
                let healthy = false;
                for (let i = 0; i < 20 && !healthy; i++) {
                    await new Promise((r) => setTimeout(r, 3000));
                    healthy = await httpsOk('https://127.0.0.1:5000/api/health', 8000);
                }
                report.checks.erp_after = healthy ? 'healthy' : 'STILL-DOWN';
            }
        }
    }

    // ── 3) Cloudflare tunnel ───
    // HARDENED 2026-10-09: فحص العملية وحده لا يكفي
    const tunProc = procRunning('cloudflared.exe');
    try {
        const st = fs.statSync('C:\\cloudflared\\tunnel.log');
        if (st.size > 20 * 1024 * 1024) {
            try { fs.renameSync('C:\\cloudflared\\tunnel.log', 'C:\\cloudflared\\tunnel.log.1'); } catch (_) {}
            report.actions.push('tunnel-log-rotated');
        }
    } catch (_) {}
    report.checks.tunnel_proc = tunProc ? 'running' : 'MISSING';
    let pubOk = null;
    // وضع الصيانة: الموقع العام يسقط حتمًا لأن ERP متوقف بأمر المشرف —
    // فحص النفق هنا يُنتج إنذارات كاذبة ويعيد تشغيل cloudflared بلا سبب.
    if (!skipErp && tunProc) {
        try { pubOk = await httpsOk('https://karimeg.online/api/health', 12000, 4); }
        catch (_) { pubOk = false; }
        report.checks.tunnel_public = pubOk ? 'reachable' : 'UNREACHABLE';
    } else if (skipErp) {
        report.checks.tunnel_public = 'maintenance-skip';
    }
    let prevStrikes = 0;
    try {
        const prev = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
        prevStrikes = Number(prev.tunnel_strikes) || 0;
    } catch (_) {}
    let strikes = 0;
    if (!skipErp && tunProc && pubOk === false) {
        const localOk = await httpsOk('https://127.0.0.1:5000/api/health', 8000);
        strikes = localOk ? prevStrikes + 1 : 0;
        if (localOk) {report.actions.push('tunnel-public-fail:' + strikes + '/2');}
    }
    report.tunnel_strikes = skipErp ? 0 : strikes;
    const needTunnelRestart = !skipErp && (!tunProc || strikes >= 2);
    if (needTunnelRestart) {
        report.ok = false;
        if (FIX) {
            try {
                if (!tunProc) {
                    const bat = 'C:\\cloudflared\\run-tunnel.bat';
                    if (fs.existsSync(bat)) {
                        spawnSync('cmd', ['/c', 'start', '', '/MIN', bat], { windowsHide: true, timeout: 15000 });
                        report.actions.push('tunnel-restart:attempted');
                    } else { report.actions.push('tunnel-restart:NO-BAT'); }
                } else {
                    try { spawnSync('taskkill', ['/F', '/IM', 'cloudflared.exe'], { timeout: 20000 }); } catch (_) {}
                    await new Promise((r) => setTimeout(r, 4000));
                    spawnSync('cmd', ['/c', 'start', '', '/MIN', 'C:\\cloudflared\\run-tunnel.bat'], { windowsHide: true, timeout: 15000 });
                    report.actions.push('tunnel-sessions-reset:attempted');
                    report.tunnel_strikes = 0;
                }
            } catch (_) { report.actions.push('tunnel-restart:FAILED'); }
        }
    }

    // ── 3b) الوصول عن بعد (مراقبة فقط — لا لمس أبداً) ───
    try {
        const uv = procRunning('UltraViewer_Desktop.exe') || procRunning('UltraViewer_Service.exe');
        report.checks.remote_desktop = uv ? 'running' : 'NOT-RUNNING';
        if (!uv) { report.actions.push('remote-desktop-missing'); }
    } catch (_) {}

    // ── 4) مساحة القرص ──
    try {
        const st = fs.statfsSync(ROOT);
        const freeMB = Math.round((st.bfree * st.bsize) / 1048576);
        report.checks.disk_free_mb = freeMB;
        if (freeMB < 2048) {
            report.ok = false;
            report.actions.push(`disk-low:${freeMB}MB`);
            if (FIX) {
                // تقليم سجلات التدقيق القديمة + نسخ المهمات (ليست نسخ القاعدة)
                let pruned = 0;
                for (const d of [path.join(LOGS, 'audit'), LOGS]) {
                    try {
                        for (const f of fs.readdirSync(d)) {
                            const fp = path.join(d, f);
                            const s = fs.statSync(fp);
                            if (s.isFile() && Date.now() - s.mtimeMs > 14 * 86400000 && /\.(log|html|json)$/.test(f)) {
                                try { fs.unlinkSync(fp); pruned++; } catch (_) {}
                            }
                        }
                    } catch (_) {}
                }
                report.actions.push(`disk-pruned:${pruned}`);
            }
        }
    } catch (e) { report.checks.disk = 'unknown:' + String(e.message).slice(0, 60); }

    // ── 5) حداثة النسخ الليلية ──
    try {
        const dumps = fs.readdirSync(BACKUPS)
            .filter((f) => /^karim_erp-nightly-\d+\.dump$/.test(f))
            .map((f) => ({ f, m: fs.statSync(path.join(BACKUPS, f)).mtimeMs, s: fs.statSync(path.join(BACKUPS, f)).size }))
            .filter((x) => x.s > 5 * 1024 * 1024)
            .sort((a, b) => b.m - a.m);
        const ageH = dumps.length ? (Date.now() - dumps[0].m) / 3600000 : 9999;
        report.checks.backup_latest = dumps.length ? dumps[0].f : 'NONE-VALID';
        report.checks.backup_age_h = Math.round(ageH * 10) / 10;
        if (ageH > 30) {
            report.ok = false;
            report.actions.push(`backup-stale:${Math.round(ageH)}h`);
            if (FIX) {
                const r = spawnSync('C:\\nodejs\\node.exe', [path.join(ROOT, 'scripts', 'backup-nightly.js')],
                    { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
                report.actions.push(`backup-triggered:exit=${r.status}`);
            }
        }
    } catch (e) { report.checks.backup = 'unknown:' + String(e.message).slice(0, 60); }

    // ── 6) روابط رؤساء الأقسام (درس EMP-039: قسم مربوط غير موجود) ───
    // تنبيه فقط — الإصلاح يحتاج قرار بشري (أي قسم الصحيح؟)
    try {
        const { Pool } = require('pg');
        const pg = new Pool({
            host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 5432,
            database: process.env.DB_NAME || 'karim_erp', user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD, connectionTimeoutMillis: 8000,
        });
        const bad = (await pg.query(
            `SELECT u.username FROM users u
               LEFT JOIN departments d ON LOWER(d.code) = LOWER(u.dept_code)
               LEFT JOIN "hrDepartments" h ON LOWER(h.code) = LOWER(u.dept_code)
              WHERE u.role = 'dept_head' AND u.dept_code IS NOT NULL AND u.dept_code <> ''
                AND d.code IS NULL AND h.code IS NULL
              ORDER BY 1`)).rows.map((r) => r.username);
        await pg.end().catch(() => {});
        report.checks.dept_links = bad.length ? `BROKEN:${bad.join(',')}` : 'ok';
        if (bad.length) { report.ok = false; report.actions.push(`dept-links-broken:${bad.join(',')}`); }
    } catch (e) { report.checks.dept_links = 'skipped:' + String(e.message).slice(0, 60); }
    try { fs.writeFileSync(STATUS_FILE, JSON.stringify(report, null, 2)); } catch (_) {}
    log(`done ok=${report.ok} actions=[${report.actions.join(', ') || 'none'}]`);
    process.exit(report.ok ? 0 : 2);
})().catch((e) => { console.error('[watchdog] FATAL:', e.message); process.exit(3); });
