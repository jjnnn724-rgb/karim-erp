/**
 * pos-path-guard.test.js — منطق حارس مسار POS (الواجهة)
 * ─────────────────────────────────────────────────────────────────
 * الحارس يقرأ السياسة من الخادم ويقرر: لا شيء / تنبيه / تحويل.
 * الافتراضي off ⇒ لا يتغيّر سلوك الواجهة إطلاقًا.
 *
 * الوحدة تُكتب بـESM (المتصفح يحتاجها كوحدة) — وNode 24 يدعم require(esm).
 */
const { normalizePolicy, decide } = require('../frontend/app/js/pos-path-guard.js');

describe('حارس توحيد مسار POS', () => {
    test('الوضع off ⇒ لا شيء إطلاقًا (السلوك الحالي)', () => {
        expect(decide({ mode: 'off', path: '/app/cashier/' })).toEqual({ action: 'none', href: '' });
        expect(decide({ mode: 'off' })).toEqual({ action: 'none', href: '' });
    });

    test('الوضع unknown يُعامل كـoff', () => {
        expect(decide({ mode: 'weird', path: '/app/cashier/' }).action).toBe('none');
        expect(decide(null).action).toBe('none');
    });

    test('redirect مع مسار رسمي ⇒ تحويل', () => {
        expect(decide({ mode: 'redirect', path: '/app/cashier/' }))
            .toEqual({ action: 'redirect', href: '/app/cashier/' });
    });

    test('redirect بلا مسار رسمي ⇒ لا تحويل (لا يُحبس المستخدم)', () => {
        expect(decide({ mode: 'redirect', path: '' }).action).toBe('none');
        expect(decide({ mode: 'redirect', path: 'https://evil.example' }).action).toBe('none');
    });

    test('banner ⇒ تنبيه مع رابط للمسار الرسمي', () => {
        const d = decide({ mode: 'banner', path: '/app/cashier/' });
        expect(d.action).toBe('banner');
        expect(d.href).toBe('/app/cashier/');
    });

    test('التطبيع: المسار الخارجي يُسقط', () => {
        const p = normalizePolicy({ mode: 'redirect', path: 'https://evil.example/x' });
        expect(p.path).toBe('');
        expect(p.mode).toBe('redirect');
    });

    test('التطبيع: الوضع غير المعروف ⇒ off', () => {
        expect(normalizePolicy({ mode: 'DROP TABLE' }).mode).toBe('off');
        expect(normalizePolicy(undefined).mode).toBe('off');
    });

    test('التطبيع: النص محدود الطول', () => {
        const p = normalizePolicy({ mode: 'banner', label: 'x'.repeat(500) });
        expect(p.label.length).toBeLessThanOrEqual(120);
    });
});
