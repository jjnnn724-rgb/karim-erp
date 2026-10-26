/**
 * csp-inline-scripts.test.js — سكربتات inline = كود لا يعمل (却被 CSP يحجب)
 * ────────────────────────────────────────────────────────────────────────────
 * الاكتشاف (بمتصفح حقيقي على الإنتاج):
 *   سياسة CSP تحمل 'nonce-…' في script-src ⇒ المتصفح يتجاهل 'unsafe-inline'
 *   (قاعدة CSP2) ⇒ كل سكربت inline داخل HTML **محجوب ولا يُنفَّذ**.
 *   أثر ذلك في الإنتاج كان حقيقيًا:
 *     · تهيئة مسار POS على شاشة الكاشير لم تكن تعمل إطلاقًا،
 *     · تسجيل Service Worker على شاشة الكاشير لم يكن يحدث،
 *     · صفحة البوفيه القديمة (menu.html) كانت ميتة (0 عناصر + Tailwind محجوب).
 *
 * هذا الاختبار يمنع تكرار الخلل: لا سكربت inline، و路子 POS في ملف خارجي.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');

function runAudit(args) {
    try {
        const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'audit-csp-inline-handlers.js'), ...args], {
            cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
        });
        return { ok: true, out };
    } catch (e) {
        return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') };
    }
}

describe('سكربتات inline (محجوبة ⇒ لا تعمل)', () => {
    test('لا سكربت inline في أي صفحة (بوابة CI)', () => {
        const r = runAudit(['--check-inline-scripts']);
        expect(r.ok).toBe(true);
        expect(r.out).toContain('لا سكربتات inline');
    });

    test('صفحة الكاشير تستخدم ملف تهيئة خارجي', () => {
        const pos = fs.readFileSync(path.join(APP, 'pos.html'), 'utf8');
        expect(pos).toContain('js/pos-bootstrap.js');
        expect(pos).not.toMatch(/<script(?![^>]*\ssrc\s*=)[^>]*>/i);
    });

    test('ملف التهيئة يطبّق سياسة المسار ويسجّل Service Worker', () => {
        const boot = fs.readFileSync(path.join(APP, 'js', 'pos-bootstrap.js'), 'utf8');
        expect(boot).toContain('applyPosPathPolicy');
        expect(boot).toContain("navigator.serviceWorker.register('/app/sw.js')");
        // حراسة: لا انهيار إن لم يكن الحارس موجودًا
        expect(boot).toContain('typeof window.PosPathGuard.applyPosPathPolicy ===');
    });

    test('منطق صفحة البوفيه القديمة نُقل خارج HTML (سلامة النقل)', () => {
        const legacy = fs.readFileSync(path.join(APP, 'js', 'features', 'menu-legacy.js'), 'utf8');
        expect(legacy).toContain('DEFAULT_DATA');
        expect(legacy).toContain('fetchBuffetData');
        const html = fs.readFileSync(path.join(APP, 'menu.html'), 'utf8');
        expect(html).toContain('js/features/menu-legacy.js');
        expect(html).not.toMatch(/<script(?![^>]*\ssrc\s*=)[^>]*>/i);
    });

    test('صفحة الكاشير تحمّل الحارس قبل التهيئة (ترتيب السكربتات)', () => {
        const pos = fs.readFileSync(path.join(APP, 'pos.html'), 'utf8');
        const guardAt = pos.indexOf('js/pos-path-guard.js');
        const bootAt = pos.indexOf('js/pos-bootstrap.js');
        expect(guardAt).toBeGreaterThan(-1);
        expect(bootAt).toBeGreaterThan(guardAt);
    });
});
