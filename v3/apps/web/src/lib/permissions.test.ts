import { describe, expect, it } from 'vitest';
import {
    activeUserOptions,
    auditActionLabel,
    auditTimestamp,
    catalogTotals,
    groupCatalog,
    modeCounts,
    permissionModeLabel,
    permissionSchema,
    permMode,
    searchPermissions,
} from './permissions';
import { userSchema } from './users';

/**
 * عقد الصلاحيات — مطابق لـ `frontend/app/js/v2/data/permissions-repo.js`:
 * المجموعات بترتيب الورود، والسحب يغلب المنح يغلب وراثة الدور.
 */

const catalog = [
    permissionSchema.parse({
        key: 'finance.view',
        ar: 'عرض المالية',
        group: 'المالية',
        menus: ['finance'],
        entitiesRead: ['invoices'],
        entitiesWrite: [],
    }),
    permissionSchema.parse({
        key: 'finance.edit',
        ar: 'تعديل المالية',
        group: 'المالية',
        menus: ['finance'],
        entitiesRead: ['invoices'],
        entitiesWrite: ['invoices'],
    }),
    permissionSchema.parse({
        key: 'hr.view',
        ar: 'عرض الموارد البشرية',
        group: 'الموارد البشرية',
        menus: ['hr', 'employees'],
        entitiesRead: ['employees'],
        entitiesWrite: [],
    }),
    permissionSchema.parse({ key: 'loose.key' }),
];

const grants = new Set(['finance.view']);
const denies = new Set(['hr.view']);

describe('عقد الصلاحيات — التجميع والوضع', () => {
    it('يجمع بترتيب الورود ويسمّي الغائب «بلا مجموعة»', () => {
        const groups = groupCatalog(catalog);
        expect(groups.map((group) => [group.name, group.items.length])).toEqual([
            ['المالية', 2],
            ['الموارد البشرية', 1],
            ['بلا مجموعة', 1],
        ]);
    });

    it('السحب يغلب المنح يغلب وراثة الدور', () => {
        expect(permMode('hr.view', grants, denies)).toBe('deny');
        expect(permMode('finance.view', grants, denies)).toBe('grant');
        expect(permMode('finance.edit', grants, denies)).toBe('inherit');
        expect(permissionModeLabel('deny')).toBe('سحب');
        expect(modeCounts(catalog, grants, denies)).toEqual({ grant: 1, deny: 1, inherit: 2 });
    });

    it('يعدّ القوائم والكيانات الفريدة عبر الكتالوج', () => {
        expect(catalogTotals(catalog)).toEqual({ permissions: 4, groups: 3, menus: 3, entities: 2 });
        expect(catalogTotals([])).toEqual({ permissions: 0, groups: 0, menus: 0, entities: 0 });
    });

    it('يترجم إجراءات التدقيق بنغماتها ويقصّ التاريخ', () => {
        expect(auditActionLabel('grant')).toEqual({ label: 'منح', tone: 'success' });
        expect(auditActionLabel('deny')).toEqual({ label: 'سحب', tone: 'danger' });
        expect(auditActionLabel('undeny')).toEqual({ label: 'إلغاء سحب', tone: 'info' });
        expect(auditActionLabel('revoke')).toEqual({ label: 'سحب منح', tone: 'danger' });
        expect(auditTimestamp('2026-11-06T10:00:00.000Z')).toBe('2026-11-06 10:00:00');
        expect(auditTimestamp('')).toBe('—');
    });
});

describe('عقد الصلاحيات — البحث واختيار المستخدم', () => {
    it('يطابق بالاسم والمفتاح والمجموعة، ويطابق العربية المطوية', () => {
        expect(searchPermissions(catalog, 'finance').rows.map((item) => item.key)).toEqual(['finance.view', 'finance.edit']);
        const folded = searchPermissions(catalog, 'الموارد البشريه');
        expect(folded.rows.map((item) => item.key)).toEqual(['hr.view']);
        expect(folded.folded).toBe(true);
        expect(searchPermissions(catalog, 'ماليه finance').rows.map((item) => item.key)).toEqual(['finance.view', 'finance.edit']);
        expect(searchPermissions(catalog, 'ماليه hr').rows).toEqual([]);
        expect(searchPermissions(catalog, '').rows).toHaveLength(4);
    });

    it('يقصر الاختيار على النشطين ويرتّب عربيًا ويعلّم admin', () => {
        const users = [
            userSchema.parse({ id: 1, username: 'admin', name: 'مدير النظام', role: 'admin', active: true }),
            userSchema.parse({ id: 2, username: 'head', name: 'أحمد صالح', role: 'dept_head', active: true }),
            userSchema.parse({ id: 3, username: 'keeper', name: null, role: 'warehouse', active: false }),
        ];
        const options = activeUserOptions(users);
        expect(options.map((option) => option.id)).toEqual(['2', '1']);
        expect(options.find((option) => option.id === '1')).toMatchObject({
            label: 'مدير النظام (مدير النظام)',
            roleLabel: 'مدير النظام',
            admin: true,
        });
        expect(options.find((option) => option.id === '2')?.admin).toBe(false);
    });
});
