/**
 * pos-path-policy.test.js — سياسة توحيد مسار POS + استمرارية إعدادات الواجهة
 * ══════════════════════════════════════════════════════════════════════════
 * عاد��ان Cases:
 *  1) في whitelist جدول settings — بدونه كان الحفظ يُسقَط الحقول بصمت
 *     (removedKeys بلا خطأ) فلا يبقى أي مفتاح في لوحة الإعدادات.
 *  2) منطق القرار في الحارس (off/banner/redirect) + رفض المسارات الخارجية.
 *  3) تطبيع السياسة القادمة من الخادم.
 */
const { filterBody } = require('../backend/schema-registry');
const { normalizeMode, normalizePath, MODES } = require('../backend/pos-path-routes');

describe('استمرارية إعدادات الواجهة (whitelist settings)', () => {
    test('الحقول الجديدة تبقى في الطلب (لا تُسقَط بصمت)', () => {
        const { filtered, removedKeys } = filterBody('settings', {
            name: 'مطعم',
            opening_balance_visible: false,
            pos_legacy_mode: 'banner',
            pos_official_path: '/app/cashier/',
        }, 'update');
        expect(removedKeys).toEqual([]);
        expect(filtered.opening_balance_visible).toBe(false);
        expect(filtered.pos_legacy_mode).toBe('banner');
        expect(filtered.pos_official_path).toBe('/app/cashier/');
    });

    test('الحقول القديمة ما زالت تعمل', () => {
        const { filtered } = filterBody('settings', {
            name: 'مطعم', currency: 'SAR', workStartHour: 9, hidden_nav_pages: 'cfo,reports',
        }, 'update');
        expect(filtered.hidden_nav_pages).toBe('cfo,reports');
        expect(filtered.workStartHour).toBe(9);
    });

    test('id محمي — خطأ صريح لا إسقاط صامت', () => {
        const { filtered, removedKeys, errors } = filterBody('settings', { name: 'x', id: 'main_settings' }, 'update');
        expect(filtered.id).toBeUndefined();
        expect(removedKeys).not.toContain('id');
        expect(errors.join(' ')).toContain('id');
    });
});

describe('تطبيع سياسة مسار POS (الخادم)', () => {
    test('الأوضاع المعروفة فقط', () => {
        expect(normalizeMode('off')).toBe('off');
        expect(normalizeMode('BANNER')).toBe('banner');
        expect(normalizeMode('redirect')).toBe('redirect');
        expect(normalizeMode('nonsense')).toBe('off');
        expect(normalizeMode('')).toBe('off');
        expect(normalizeMode(null)).toBe('off');
        expect([...MODES]).toEqual(['off', 'banner', 'redirect']);
    });

    test('المسار الداخلي فقط — لا تحويل مفتوح ولا خارجي', () => {
        expect(normalizePath('/app/cashier/')).toBe('/app/cashier/');
        expect(normalizePath('https://evil.example/x')).toBe('');
        expect(normalizePath('//evil.example/x')).toBe('');
        expect(normalizePath('javascript:alert(1)')).toBe('');
        expect(normalizePath('')).toBe('');
        expect(normalizePath(null)).toBe('');
    });
});
