/**
 * frontend-version.test.js — بوابة إصدار الواجهة (cache-busting)
 * ────────────────────────────────────────────────────────────────────────────
 * المشكلة التي تحرسها البوابة: إصدار الواجهة كان يُرفع يدويًا، ومنه يولّد
 * الخادم CACHE_VERSION للـService Worker ⇒ لو نُسي ⇒ **العملاء يبقون على
 * النسخة القديمة** (وهو ما حدث فعلاً: تعديلات اليوم لم تصل للمتصفح).
 *
 * الاختبار يتحقق من: تطابق النسخة مع الوسوم، تطابق البصمة مع المحتوى،
 * وفشل البوابة عند اختلاف أي منهما.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'frontend-version.js');
const STATE = path.join(ROOT, 'scripts', 'frontend-version.json');
const INDEX = path.join(ROOT, 'frontend', 'app', 'index.html');

function run(args) {
    try {
        const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
        return { ok: true, out };
    } catch (e) {
        return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') };
    }
}

describe('إصدار الواجهة (cache-busting)', () => {
    test('النسخة في index.html هي مصدر CACHE_VERSION (main.js?v=)', () => {
        const html = fs.readFileSync(INDEX, 'utf8');
        const m = html.match(/main\.js\?v=([\d.]+)/);
        expect(m).toBeTruthy();
        expect(m[1]).toMatch(/^\d+(\.\d+)*$/);
    });

    test('النسخة المسجَّلة = النسخة في الصفحة', () => {
        const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
        const html = fs.readFileSync(INDEX, 'utf8');
        const m = html.match(/main\.js\?v=([\d.]+)/);
        expect(state.version).toBe(m[1]);
    });

    test('البوابة تمرّ الآن (المحتوى مطابق للنسخة المسجَّلة)', () => {
        const r = run(['--check']);
        expect(r.ok).toBe(true);
        expect(r.out).toContain('متسق');
    });

    test('--compute يعطي بصمة ثابتة لنفس المحتوى', () => {
        const a = JSON.parse(run(['--compute']).out);
        const b = JSON.parse(run(['--compute']).out);
        expect(a.hash).toBe(b.hash);
        expect(a.hash).toHaveLength(16);
    });

    test('تعديل ملف واجهة ⇒ البوابة تفشل (لولا الزيادة يبقى العميل على القديم)', () => {
        const probe = path.join(ROOT, 'frontend', 'app', 'js', '.probe-version-test.js');
        fs.writeFileSync(probe, '// probe\n', 'utf8');
        try {
            const r = run(['--check']);
            expect(r.ok).toBe(false);
            expect(r.out).toContain('تغيّرت ملفات الواجهة');
        } finally {
            fs.rmSync(probe, { force: true });
        }
    });

    test('عدم تطابق النسخة ⇒ البوابة تفشل', () => {
        const original = fs.readFileSync(STATE, 'utf8');
        try {
            const state = JSON.parse(original);
            state.version = '0.0.1';
            fs.writeFileSync(STATE, JSON.stringify(state, null, 2), 'utf8');
            const r = run(['--check']);
            expect(r.ok).toBe(false);
        } finally {
            fs.writeFileSync(STATE, original, 'utf8');
        }
    });
});
