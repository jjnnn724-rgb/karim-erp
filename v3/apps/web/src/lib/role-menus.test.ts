import { describe, expect, it } from 'vitest';
import { allowedMenus, expandMenuKeys, isKnownRole, roleMenus } from './role-menus';

/**
 * قوائم الأدوار — الاختبار يحمي عقدين:
 *  1) أساس الدور لا يُسرَّب لغير أهله (لا شاشة بلا منح).
 *  2) مرادفات V2 → V3 تعمل: `query`/`professional`/`procurement` تفتح
 *     `inventory-inquiry`/`inventory-inquiry-pro`/`purchase-invoices` وإلا
 *     يرى المستخدم «لا تملك صلاحية» رغم أن المنح موجود في الخادم.
 */
describe('role-menus', () => {
    it('يعرف الأدوار المعرّفة فقط', () => {
        expect(isKnownRole('admin')).toBe(true);
        expect(isKnownRole('sous_chef')).toBe(true);
        expect(isKnownRole('nope')).toBe(false);
        expect(isKnownRole(null)).toBe(false);
        expect(roleMenus('nope')).toEqual([]);
    });

    it('يوسّع مفاتيح V2 القديمة إلى شاشات V3', () => {
        const keys = expandMenuKeys(['query', 'professional', 'procurement', 'wh-invoices', 'yara-daily-locks']);
        expect(keys).toContain('query');
        expect(keys).toContain('inventory-inquiry');
        expect(keys).toContain('inventory-inquiry-pro');
        expect(keys).toContain('purchase-invoices');
        expect(keys).toContain('daily-locks');
        // المفتاح المجهول يمر كما هو
        expect(expandMenuKeys(['unknown-key'])).toEqual(['unknown-key']);
    });

    it('منح query يفتح inventory-inquiry لرئيس القسم', () => {
        const menus = allowedMenus('dept_head', ['query'], []);
        expect(menus).toContain('inventory-inquiry');
        // أساس الدور يبقى موجودًا
        expect(menus).toContain('dispatch');
        expect(menus).toContain('dept-employees');
    });

    it('منح professional/procurement يفتح شاشات V3 المقابلة', () => {
        const menus = allowedMenus('dept_head', ['professional', 'procurement'], []);
        expect(menus).toContain('inventory-inquiry-pro');
        expect(menus).toContain('purchase-invoices');
    });

    it('الممنوع يُسحب حتى لو كان أساس الدور — بما فيه المرادفات', () => {
        const menus = allowedMenus('dept_head', [], ['dispatch']);
        expect(menus).not.toContain('dispatch');

        const aliased = allowedMenus('sous_chef', [], ['query']);
        expect(aliased).not.toContain('query');
        expect(aliased).not.toContain('inventory-inquiry');
    });

    it('الأدمن لا يُسحب منه شيء (مرآة V2)', () => {
        const menus = allowedMenus('admin', [], ['settings', 'dispatch']);
        expect(menus).toContain('settings');
        expect(menus).toContain('dispatch');
    });

    it('بلا منح ولا ممنوع: قوائم الدور كما هي بلا تكرار', () => {
        const menus = allowedMenus('hr', [], []);
        expect(menus).toEqual([...roleMenus('hr')]);
        expect(new Set(menus).size).toBe(menus.length);
    });
});
