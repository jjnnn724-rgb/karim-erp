/**
 * csp-violation-log.test.js — المصرف الدائم لمخالفات CSP
 * ────────────────────────────────────────────────────────────────────────────
 * لماذا الملف وليس جدولًا: القياس يستمر أيامًا والخدمة تُعاد تشغيلها،
 * والعدّاد في الذاكرة يُفقد..FilePersist ⇒ بيانات تُقرأ بعد إعادة التشغيل.
 * ويجب ألا يحتوي الملف بيانات شخصية ولا يستهلك ذاكرة بلا حدّ.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCspViolationLog, sanitizeUrl } = require('../backend/csp-violation-log');

function tmpFile(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-log-'));
    return path.join(dir, name);
}

describe('مصرف مخالفات CSP', () => {
    test('يكتب سطر JSON لكل مخالفة', async () => {
        const f = tmpFile('v.jsonl');
        const log = createCspViolationLog(f);
        log.append({ directive: 'script-src-attr', blocked: 'inline', document: 'http://h/app/index.html', source: 'http://h/app/index.html:26' });
        log.append({ directive: 'script-src-elem', blocked: 'inline', document: 'http://h/app/pos.html', source: '' });
        await log.flush();
        const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
        expect(lines).toHaveLength(2);
        const first = JSON.parse(lines[0]);
        expect(first.directive).toBe('script-src-attr');
        expect(first.ts).toBeTruthy();
    });

    test('ينظّف الروابط: مسار فقط بلا استعلام ولا أصل', () => {
        expect(sanitizeUrl('https://user:pass@app.example.com/app/index.html?token=secret#x')).toBe('/app/index.html');
        expect(sanitizeUrl('http://127.0.0.1:5000/app/pos.html')).toBe('/app/pos.html');
        expect(sanitizeUrl('')).toBe('');
        expect(sanitizeUrl('inline')).toBe('inline');
    });

    test('لا يكتب استعلامات (لا أسرار في السجل)', async () => {
        const f = tmpFile('v.jsonl');
        const log = createCspViolationLog(f);
        log.append({ directive: 'x', blocked: 'inline', document: 'http://h/app/index.html?access_token=SECRET123' });
        await log.flush();
        const raw = fs.readFileSync(f, 'utf8');
        expect(raw).not.toContain('SECRET123');
        expect(raw).not.toContain('access_token');
    });

    test('الدوران عند تجاوز الحدّ (لا نمو بلا سقف)', async () => {
        const f = tmpFile('v.jsonl');
        const log = createCspViolationLog(f, { maxBytes: 200 });
        for (let i = 0; i < 50; i++) {
            log.append({ directive: 'script-src-attr', blocked: `inline-${i}`, document: `http://h/p${i}.html` });
        }
        await log.flush();
        const size = fs.statSync(f).size;
        expect(size).toBeLessThan(200 * 10);
        // ملف دوران واحد على الأكثر
        const rotated = fs.readdirSync(path.dirname(f)).filter((n) => n.includes('.jsonl.'));
        expect(rotated.length).toBeLessThanOrEqual(1);
    });

    test('مسار فارغ = مُعطّل بلا خطأ', async () => {
        const log = createCspViolationLog('');
        expect(() => log.append({ directive: 'x' })).not.toThrow();
        await log.flush();
    });

    test('أخطاء الكتابة لا تُسقط الطلب', async () => {
        const log = createCspViolationLog('C:/nonexistent-dir-xyz/violations.jsonl');
        expect(() => log.append({ directive: 'x', document: 'http://h/a' })).not.toThrow();
        await log.flush();
    });

    test('المسار النسبي يُثبَّت على جذر المشروع (لا على مجلد التشغيل)', () => {
        const log = createCspViolationLog('logs/csp-violations.jsonl');
        expect(path.isAbsolute(log.path)).toBe(true);
        expect(log.path).toContain(`${path.sep}logs${path.sep}csp-violations.jsonl`);
        // جذر المشروع = المجلد الأب ل backend/
        expect(log.path).toBe(path.resolve(__dirname, '..', 'logs', 'csp-violations.jsonl'));
    });
});
