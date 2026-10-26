/**
 * boot-report-honest.test.js — عقد ملف تقرير الإقلاع وطباعته (٢٦ أكتوبر ٢٠٢٦)
 * الدافع: كان logs/startup-report.json يحتفظ بـ ok:false (JWT_SECRET) بعد زوال
 * السبب، وكان pino يبتلع وسيطاته المتعددة فيظهر «❌» وحدها في app-out.log.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'backend', 'startup.js'), 'utf8');

describe('تقرير الإقلاع: صحة الوصف وصدق الطباعة', () => {
    test('لا يفحص سر JWT_SECRET القديم كخطأ قاتل (إنذار كاذب)', () => {
        const lines = SRC.split('\n');
        const i = lines.findIndex((l) => l.includes("key === 'JWT_ACCESS_SECRET'"));
        expect(i).toBeGreaterThan(-1);
        const guard = lines.slice(i, i + 4).join('\n');
        expect(guard).toContain('JWT_REFRESH_SECRET');
        expect(guard).toContain('INSECURE_SECRET');
        expect(guard).not.toMatch(/(^|[^_A-Z])JWT_SECRET\b/);
        const legacyFatal = lines
            .filter((l) => !l.trim().startsWith('//'))
            .filter((l) => /push\(\{ key:? ?'JWT_SECRET'|key === 'JWT_SECRET'/.test(l));
        expect(legacyFatal).toEqual([]);
    });

    test('كل نداء logger في ملخص الفشل يستقبل نصًا واحدًا مكتملًا', () => {
        const calls = SRC.match(/logger\.(error|warn)\([^)]*\)/g) || [];
        const multiArg = calls.filter((c) => /\)\s*,\s*/.test(c) || /,\s*`/.test(c));
        expect(multiArg).toEqual([]);
    });

    test('النجاح يكتب تقريرًا بـ ok:true فلا يبقى تقرير فشل قديم', () => {
        expect(SRC).toContain('writeStartupReport({ ok: true');
        expect(SRC).toContain('writeStartupReport({ ok: false');
    });

    test('خزنة كلمات المرور مشتقة من سر التوقيع: تدويره يَبطرها — لا يدوَّر بلا ترحيل', () => {
        const vault = fs.readFileSync(path.join(__dirname, '..', 'backend', 'password-vault.js'), 'utf8');
        expect(vault).toContain('process.env.JWT_ACCESS_SECRET');
        expect(vault).toContain('VAULT_KEY');
    });
});
