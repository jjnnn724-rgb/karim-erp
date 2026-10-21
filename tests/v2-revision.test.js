/**
 * v2-revision.test.js — بوابة اتساق مراجعات V2
 * ═══════════════════════════════════════════════════════════════════════
 * القاعدة (scripts/v2-revision.js): JS = مراجعة الصفحة، CSS ≥ مراجعة الصفحة.
 * البوابة تفشل إن تأخّر أي CSS عن الصفحة أو انحرف أي استيراد JS.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'v2-revision.js');

const run = (args) => execFileSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});

describe('v2-revision --check', () => {
    test('الشجرة الحالية صادقة: صفر انحراف', () => {
        const out = run(['--check']);
        expect(out).toMatch(/صادقٌ تمامًا/);
        expect(out).toMatch(/js\/v2: \d+/);
    });

    test('--dry-run لا يكتب شيئًا', () => {
        const out = run(['--dry-run']);
        expect(out).toMatch(/الشجرةُ موائمةٌ تمامًا|dry-run/);
    });

    test('صفحاتُ الكاشير مرافقَة: مراجعُ عائلة V2 تحمل رقمَ الصفحة', () => {
        // الدرس (2026-10-22): تطبيقُ الكاشير يستدعي js/v2 وcss/v2 بمسارات
        // مطلقة، وكانت الأداة لا تراه ⇒ مراجعُه تجمّدت على رقمٍ قديم
        // فكسّرا عقدي v2-pos-buffet وv2-identity. فصارت الصفحات المرافقة
        // جزءًا من عقد الاتساق.
        const src = fs.readFileSync(SCRIPT, 'utf8');
        expect(src).toMatch(/REV_IN_ABS/);
        expect(src).toMatch(/COMPANION_DIR/);
        const page = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'v2.html'), 'utf8');
        const rev = (page.match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];
        expect(rev).toBeTruthy();
        for (const f of ['frontend/app/cashier/index.html', 'frontend/app/cashier/main.js']) {
            const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
            const stale = [...s.matchAll(/(?:\/app)?\/(?:css|js)\/v2\/[^"'`)\s]+?\?v=([0-9.]+)/g)]
                .filter((m) => m[1] !== rev);
            if (stale.length) {
                throw new Error(`مراجع قديمة في ${f} (الهدف ${rev}): ${stale.map((m) => m[0]).join(' | ')}`);
            }
        }
    });
});
