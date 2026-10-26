/**
 * summarize-csp-violations.test.js — أداة تلخيص تقرير المخالفات
 * ────────────────────────────────────────────────────────────────────────────
 * الأداة هي واجهة المالك على بيانات القياس؛ لو قرأت مسارًا خاطئًا أو
 * تجاهلت وسائط ⇒ قرار مبني على فراغ.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'summarize-csp-violations.js');

function run(args) {
    try {
        const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
        return { ok: true, out };
    } catch (e) {
        return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') };
    }
}

describe('تلخيص مخالفات CSP', () => {
    let file;

    beforeAll(() => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-sum-'));
        file = path.join(dir, 'v.jsonl');
        const rows = [
            { ts: new Date().toISOString(), directive: 'script-src-attr', blocked: 'inline', document: '/app/index.html', source: '/app/index.html:26' },
            { ts: new Date().toISOString(), directive: 'script-src-attr', blocked: 'inline', document: '/app/index.html', source: '/app/index.html:26' },
            { ts: new Date().toISOString(), directive: 'script-src-elem', blocked: 'inline', document: '/app/pos.html', source: '/app/pos.html:552' },
        ];
        fs.writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
    });

    test('يقرأ المسار الممرَّر ويطبع الإجمالي', () => {
        const r = run([file]);
        expect(r.ok).toBe(true);
        expect(r.out).toContain('الإجمالي: 3 مخالفة');
        expect(r.out).toContain('script-src-attr');
        expect(r.out).toContain('/app/pos.html');
    });

    test('خيار --days لا يُفسَّر كمسار ملف', () => {
        // خطأ سابق: '1' بعد --days كان يُعامل كمسار ⇒ "لا يوجد ملف"
        const r = run([file, '--days', '1']);
        expect(r.ok).toBe(true);
        expect(r.out).toContain('الإجمالي: 3 مخالفة');
        expect(r.out).not.toContain('لا يوجد ملف');
    });

    test('ملف غير موجود ⇒ رسالة واضحة لا خطأ', () => {
        const r = run([path.join(ROOT, 'logs', 'definitely-missing.jsonl')]);
        expect(r.ok).toBe(true);
        expect(r.out).toContain('لا يوجد ملف');
    });
});
