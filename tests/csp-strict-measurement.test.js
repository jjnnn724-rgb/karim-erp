/**
 * csp-strict-measurement.test.js — قياس CSP قبل الفرض (Phase: تقوية الـCSP)
 * ───────────────────────────────────────────────────────────────────────────
 * الواجهة القديمة فيها ~1100 معالج سطري، فلا يمكن فرض script-src-attr 'none'
 * دفعة واحدة. الطريق الآمن: سياسة صارمة كـReport-Only (لا تمنع شيئًا) + جامع
 * مخالفات، فنعرف ما الذي يكسر قبل الفرض.
 */
const { buildStrictCsp, createCspReportCollector } = require('../backend/middleware/security');

describe('سياسة CSP الصارمة (قياس قبل الفرض)', () => {
    test('تمنع inline handlers وinline scripts في وضع القياس', () => {
        const csp = buildStrictCsp();
        const scriptSrc = csp.split(';').map((d) => d.trim())
            .find((d) => d.startsWith('script-src '));
        expect(scriptSrc).toBeTruthy();
        // 'unsafe-inline' ممنوع في السكربتات تحديدًا (وهو ما يسمح بحقن HTML)
        expect(scriptSrc).not.toContain("'unsafe-inline'");
        expect(csp).toContain("script-src-attr 'none'");
        expect(csp).toContain("object-src 'none'");
        expect(csp).toContain("base-uri 'self'");
        expect(csp).toContain("frame-ancestors 'none'");
    });

    test('تبقى CSS الديناميكية مسموحة (وإلا كسرت الواجهة)', () => {
        expect(buildStrictCsp()).toContain("style-src 'self' 'unsafe-inline'");
    });

    test('placeholder الـnonce موجود ليُستبدل بطلب حقيقي', () => {
        expect(buildStrictCsp()).toContain("'nonce-__NONCE__'");
        expect(buildStrictCsp().replace('__NONCE__', 'abc')).toContain("'nonce-abc'");
    });

    test('جامع المخالفات يعدّ ولا يخزّن بيانات شخصية', () => {
        const c = createCspReportCollector();
        c.record({ 'csp-report': {
            'document-uri': 'http://host/app/index.html',
            'violated-directive': 'script-src-attr',
            'blocked-uri': 'inline',
        }});
        c.record({ 'csp-report': {
            'document-uri': 'http://host/app/index.html',
            'violated-directive': 'script-src-attr',
            'blocked-uri': 'inline',
        }});
        c.record({ 'csp-report': {
            'document-uri': 'http://host/app/pos.html',
            'violated-directive': 'script-src',
            'blocked-uri': 'http://host/app/js/app.js',
        }});
        expect(c.total()).toBe(3);
        const snap = c.snapshot();
        expect(Object.keys(snap)).toHaveLength(2);
        expect(Object.values(snap).reduce((a, b) => a + b, 0)).toBe(3);
    });

    test('تقرير تالف أو فارغ لا يكسر الجامع', () => {
        const c = createCspReportCollector();
        expect(() => c.record(null)).not.toThrow();
        expect(() => c.record({})).not.toThrow();
        expect(() => c.record({ 'csp-report': 'not-an-object' })).not.toThrow();
        expect(c.total()).toBeGreaterThanOrEqual(0);
    });

    test('العدّاد يُصفَّر عند reset', () => {
        const c = createCspReportCollector();
        c.record({ 'violated-directive': 'script-src-attr', 'blocked-uri': 'inline' });
        expect(c.total()).toBe(1);
        c.reset();
        expect(c.total()).toBe(0);
    });
});
