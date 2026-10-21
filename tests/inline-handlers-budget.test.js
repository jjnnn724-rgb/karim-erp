/**
 * inline-handlers-budget.test.js — ميزانية المعالجات السطرية (رافعة CSP)
 * ────────────────────────────────────────────────────────────────────────────
 * الترويسة الصارمة (script-src-attr 'none') لا يمكن فرضها على الواجهة
 * القديمة ما دام فيها معالجات سطرية. القياس الفعلي (متصفح حقيقي):
 * 1158 معالجًا في 45 ملفًا — أي أن تقرير المتصفح وحده (3 مخالفات) ناقص.
 * لذلك: ميزانية لكل ملف تُرفض أي زيادة، وتُخفض مع كل دفعة تحويل.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'audit-csp-inline-handlers.js');
const BASELINE = path.join(ROOT, 'scripts', 'inline-handlers-baseline.json');

function run(args) {
    try {
        const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
        return { ok: true, out };
    } catch (e) {
        return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') };
    }
}

describe('ميزانية المعالجات السطرية', () => {
    test('خط الأساس موجود ومتسق مع نفسه', () => {
        const b = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
        expect(typeof b.totalHandlers).toBe('number');
        expect(b.totalHandlers).toBeGreaterThan(0);
        const sum = Object.values(b.files).reduce((a, n) => a + n, 0);
        expect(sum).toBe(b.totalHandlers);
    });

    test('العدد الحالي ضمن الميزانية (لا زيادة)', () => {
        const r = run(['--check', BASELINE]);
        expect(r.ok).toBe(true);
        expect(r.out).toMatch(/المعالجات السطرية/);
    });

    test('العدد الحقيقي أكبر بكثير مما يبلّغه المتصفح وحده', () => {
        // هذا هو سبب وجود المدقّق الثابت: تقرير Report-Only جزئي.
        const b = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
        expect(b.totalHandlers).toBeGreaterThan(50);
    });

    test('تجاوز الميزانية يُرفض (سلوك البوابة)', () => {
        const tmp = path.join(ROOT, 'tests', '.tmp-inline-budget.json');
        fs.writeFileSync(tmp, JSON.stringify({ totalHandlers: 1, files: {} }), 'utf8');
        try {
            const r = run(['--check', tmp]);
            expect(r.ok).toBe(false);
            expect(r.out).toMatch('تجاوز ميزانية');
        } finally {
            fs.rmSync(tmp, { force: true });
        }
    });
});
