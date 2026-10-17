/**
 * v2-revision.test.js — بوابة اتساق مراجعات V2
 * ═══════════════════════════════════════════════════════════════════════
 * القاعدة (scripts/v2-revision.js): JS = مراجعة الصفحة، CSS ≥ مراجعة الصفحة.
 * البوابة تفشل إن تأخّر أي CSS عن الصفحة أو انحرف أي استيراد JS.
 */
const { execFileSync } = require('child_process');
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
});
