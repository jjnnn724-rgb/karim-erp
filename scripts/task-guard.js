'use strict';
/* task-guard.js — حارس المهام المجدولة: يتحقق من مهام KarimERP الخمس ويعيد إنشاء الناقص.
 * يعمل ضمن سلسلة الصبح بحساب SYSTEM (صلاحيات كاملة). آمن وتكراري. */
const { execSync } = require('child_process');

const ERP = 'C:\\Users\\DELL\\Desktop\\k\\karimabdelhamedeldsouky\\karimabdelhamed12\\karim-erp';
const WANT = [
    { tn: 'KarimERP-Backup-0300', tr: `${ERP}\\scripts\\backup-nightly-task.bat`, mk: '/sc daily /st 03:00' },
    { tn: 'KarimERP-Backup-1500', tr: `${ERP}\\scripts\\backup-nightly-task.bat`, mk: '/sc daily /st 15:00' },
    { tn: 'KarimERP-Punch-Reconcile', tr: `${ERP}\\scripts\\reconcile-portal-punches-task.bat`, mk: '/sc minute /mo 30' },
    { tn: 'KarimERP-Server-Keepalive', tr: 'C:\\cloudflared\\keepalive-server.bat', mk: '/sc minute /mo 5' },
    { tn: 'KarimERP-Tunnel-Keepalive', tr: 'C:\\cloudflared\\keepalive-tunnel.bat', mk: '/sc minute /mo 15' },
];

function sh(cmd) {
    try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (_) { return null; }
}

(async () => {
    const fixed = [], ok = [];
    for (const w of WANT) {
        const q = sh(`schtasks /query /tn "${w.tn}" /v /fo list`);
        const actionOk = q && q.includes(w.tr);
        const enabledOk = q && /Ready|Running/i.test(q);
        if (actionOk && enabledOk) { ok.push(w.tn); continue; }
        const mk = `schtasks /create /tn "${w.tn}" /tr "${w.tr}" ${w.mk} /ru SYSTEM /f`;
        const r = sh(mk);
        if (r != null) { fixed.push(w.tn + (q ? ':action-fixed' : ':recreated')); }
        else { console.log(`GUARD_FAIL:${w.tn}:needs-admin`); }
    }
    console.log(JSON.stringify({ ok, fixed }));
    process.exit(0);
})().catch((e) => { console.error('FAIL:' + (e && e.message)); process.exit(1); });
