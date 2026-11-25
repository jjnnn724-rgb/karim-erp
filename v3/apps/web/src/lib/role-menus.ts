/**
 * خرائط الأدوار → الشاشات — مرآة V2 حرفيًا (`frontend/app/js/core/config.js`
 * `ROLES`) مضافًا إليها الشاشات الجديدة في V3 فقط (accounts/journal/
 * daily-locks/purchase-invoices/payments/warehouse-gov/shelves/weight/
 * goods-scan/sessions/briefing/executive/warehouse-dashboard/
 * accountant-dashboard/dept-head-dashboard/inventory-inquiry/
 * inventory-inquiry-pro/item-prices). `pos-entry` شاشة V3 فقط (V2 يفتح الكاشير المستقل)،
 * ومفتاحها ممنوح لأدوار الكاشير الأربعة في `POS_ROLES` — لا قائمة V2 لها.
 *
 * مفاتيح V2 → V3: `wh-invoices` = `purchase-invoices`، `query` =
 * `inventory-inquiry`، `professional` = `inventory-inquiry-pro`،
 * `yara-daily-locks` = `daily-locks`. القوائم المالية (cfo/journal/accounts/
 * pnl/cost-center/cost-analysis/monthly-comparison/reports) محجوزة
 * للأدوار المالية في الخادم (`accounting-routes.js` READ_ROLES) كما في V2 —
 * الـ sous_chef لا يرى هذه الشاشات في القائمة بدل أن يفتحها فيُرفض (403).
 */

export const ROLES = {
    admin: [
        'dashboard',
        'menu-board',
        'cfo',
        'accounts',
        'journal',
        'cash-register',
        'cashier-sales',
        'sales-inquiry',
        'revenues',
        'expenses',
        'daily-locks',
        'cost-center',
        'cost-analysis',
        'pnl',
        'monthly-comparison',
        'departments',
        'warehouse',
        'item-prices',
        'warehouse-gov',
        'purchase-invoices',
        'payments',
        'wh-moves',
        'wh-returns',
        'wh-prs',
        'dept-transfers',
        'procurement',
        'kitchen',
        'veg-requests',
        'weight',
        'goods-scan',
        'dispatch',
        'recipes',
        'reports',
        'vat-return',
        'financial-compliance',
        'settings',
        'users',
        'branches',
        'permissions',
        'hr-dashboard',
        'employees',
        'leaves',
        'attendance',
        'zkteco',
        'yarasoft',
        'oracle-data',
        'sales-analyzer',
        'whatsapp',
        'hr-departments',
        'payroll',
        'mudad',
        'employee-portal',
        'roster',
        'query',
        'professional',
        'shelves',
        'sessions',
        'briefing',
        'executive',
        'warehouse-dashboard',
        'accountant-dashboard',
        'dept-head-dashboard',
        'inventory-inquiry',
        'inventory-inquiry-pro',
        'dept-employees',
        'received-analyzer',
        'wh-vs-pos',
        'cashier-monitor',
        'pos-entry',
    ],
    manager: [
        'dashboard',
        'menu-board',
        'cfo',
        'accounts',
        'journal',
        'cash-register',
        'cashier-sales',
        'sales-inquiry',
        'revenues',
        'expenses',
        'daily-locks',
        'cost-center',
        'cost-analysis',
        'pnl',
        'monthly-comparison',
        'departments',
        'dispatch',
        'recipes',
        'reports',
        'vat-return',
        'financial-compliance',
        'hr-dashboard',
        'employees',
        'mudad',
        'leaves',
        'attendance',
        'zkteco',
        'whatsapp',
        'employee-portal',
        'warehouse',
        'item-prices',
        'warehouse-gov',
        'purchase-invoices',
        'payments',
        'wh-moves',
        'wh-returns',
        'wh-prs',
        'procurement',
        'kitchen',
        'veg-requests',
        'weight',
        'goods-scan',
        'roster',
        'shelves',
        'warehouse-dashboard',
        'accountant-dashboard',
        'pos-entry',
    ],
    warehouse: [
        'dashboard',
        'warehouse',
        'item-prices',
        'warehouse-gov',
        'purchase-invoices',
        'payments',
        'wh-moves',
        'wh-returns',
        'wh-prs',
        'veg-requests',
        'procurement',
        'dispatch',
        'roster',
        'shelves',
        'weight',
        'goods-scan',
        'warehouse-dashboard',
    ],
    kitchen: ['kitchen', 'dispatch', 'wh-prs', 'recipes', 'attendance', 'leaves', 'employee-portal', 'roster'],
    sous_chef: [
        'kitchen',
        'dispatch',
        'wh-prs',
        'veg-requests',
        'sales-analyzer',
        'sales-inquiry',
        'received-analyzer',
        'wh-vs-pos',
        'query',
        'professional',
        'item-prices',
        'recipes',
        'attendance',
        'leaves',
        'employee-portal',
        'roster',
        'weight',
        'inventory-inquiry',
        'inventory-inquiry-pro',
    ],
    dept_head: ['dashboard', 'attendance', 'leaves', 'employee-portal', 'dept-employees', 'dispatch', 'roster'],
    hr: [
        'dashboard',
        'hr-dashboard',
        'employees',
        'leaves',
        'attendance',
        'zkteco',
        'hr-departments',
        'payroll',
        'financial-compliance',
        'employee-portal',
        'roster',
    ],
    accountant: [
        'dashboard',
        'cfo',
        'accounts',
        'journal',
        'cash-register',
        'cashier-sales',
        'revenues',
        'expenses',
        'daily-locks',
        'cost-center',
        'cost-analysis',
        'pnl',
        'monthly-comparison',
        'departments',
        'warehouse',
        'item-prices',
        'warehouse-gov',
        'purchase-invoices',
        'payments',
        'wh-moves',
        'wh-returns',
        'wh-prs',
        'procurement',
        'dispatch',
        'reports',
        'vat-return',
        'financial-compliance',
        'payroll',
        'zkteco',
        'oracle-data',
        'roster',
        'accountant-dashboard',
        'pos-entry',
    ],
    employee: ['dashboard', 'attendance', 'leaves', 'employee-portal'],
    owner: ['cashier-monitor', 'dashboard', 'zkteco', 'sales-inquiry'],
    cashier: ['dashboard', 'attendance', 'leaves', 'employee-portal', 'pos-entry'],
} as const;

export type RoleKey = keyof typeof ROLES;

export function isKnownRole(role: string | null | undefined): role is RoleKey {
    return Boolean(role) && Object.hasOwn(ROLES, String(role));
}

/** قوائم الدور الأساسية — مرآة `role.menus` في `allowedMenus()` (V2).
 *  أدمن يرى كل الشاشات: `Object.keys(ROLES)` مرتين لا — القائمة الصريحة. */
export function roleMenus(role: string | null | undefined): readonly string[] {
    return isKnownRole(role) ? ROLES[role] : [];
}

/**
 * مفاتيح قوائم V2 القديمة → شاشات V3 المقابلة. كتالوج الصلاحيات في الخادم
 * (`backend/permissions.js`) ما زال يمنح `query`/`professional`/`procurement`،
 * وV3 يسمّي نفس الشاشات `inventory-inquiry`/`inventory-inquiry-pro`/
 * `purchase-invoices`. بلا هذه الترجمة يرى المستخدم «لا تملك صلاحية» رغم أن
 * المنح موجود. المفتاح الأصلي يبقى أيضًا (قد يكون شاشة V3 صالحة بذاته).
 */
const MENU_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
    query: ['inventory-inquiry'],
    professional: ['inventory-inquiry-pro'],
    procurement: ['purchase-invoices'],
    'wh-invoices': ['purchase-invoices'],
    'yara-daily-locks': ['daily-locks'],
});

/** يوسّع كل مفتاح إلى نفسه + مرادفاته في V3 (بلا تكرار). */
export function expandMenuKeys(keys: readonly string[]): string[] {
    const out: string[] = [];
    for (const raw of keys) {
        const key = String(raw);
        out.push(key);
        for (const alias of MENU_ALIASES[key] ?? []) {
            out.push(alias);
        }
    }
    return out;
}

/** الإشهار: admin بلا سحب (مرآة `if (role === 'admin') {denied.clear();}`). */
export function allowedMenus(
    role: string | null | undefined,
    granted: readonly string[],
    denied: readonly string[],
): readonly string[] {
    const base = roleMenus(role);
    const deniedSet = new Set(role === 'admin' ? [] : expandMenuKeys(denied));
    return [...new Set([...base, ...expandMenuKeys(granted)])].filter((m) => !deniedSet.has(m));
}
