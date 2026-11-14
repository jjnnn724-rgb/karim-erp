/**
 * مفاتيح الشاشات — السيرفر يعلنها في `<meta name="v3-screens">` عند الخدمة
 * (G8)، فتُقلب الشاشات واحدةً واحدة: المعطّلة تُخفى من القشرة، ورابطها المباشر
 * يُحوَّل إلى القديم على الخادم قبل تحميل التطبيق أصلًا.
 *
 * غياب الوسم = «كل الشاشات» — وضع التطوير والاختبارات، حيث لا سيرفر يحقن.
 * الرجوع للقديم من داخل الواجهة نفسها عبر `LEGACY_APP_URL` (نفس هيكل V2).
 */

export const V3_SCREENS = [
    'accounts',
    'journal',
    'revenues',
    'expenses',
    'cash-register',
    'daily-locks',
    'oracle-data',
    'procurement',
    'purchase-invoices',
    'payments',
    'departments',
    'wh-moves',
    'dispatch',
    'warehouse',
    'warehouse-gov',
    'shelves',
    'wh-returns',
    'wh-prs',
    'dept-transfers',
    'employees',
    'hr-departments',
    'users',
    'branches',
    'permissions',
    'veg-requests',
    'weight',
    'recipes',
    'goods-scan',
    'attendance',
    'leaves',
    'payroll',
    'mudad',
    'roster',
    'sessions',
    'whatsapp',
    'briefing',
    'settings',
    'executive',
    'hr-dashboard',
    'dept-employees',
    'employee-portal',
    'zkteco',
    'kitchen',
    'menu-board',
    'warehouse-dashboard',
    'accountant-dashboard',
    'dept-head-dashboard',
    'cost-analysis',
    'cost-center',
    'inventory-inquiry',
    'inventory-inquiry-pro',
    'pnl',
    'cfo',
    'monthly-comparison',
    'reports',
    'vat-return',
    'cashier-sales',
    'cashier-monitor',
    'pos-entry',
    'pos-reports',
    'sales-analyzer',
    'sales-inquiry',
    'received-analyzer',
    'wh-vs-pos',
    'yarasoft',
    'command-center',
    'bank-rec',
    'compliance-center',
    'balance-sheet',
    'cash-flow',
] as const;
export type V3Screen = (typeof V3_SCREENS)[number];

export const LEGACY_APP_URL = '/app/v2.html?live=1';

export function enabledScreens(doc: Document = document): Set<string> {
    const meta = doc.querySelector('meta[name="v3-screens"]');
    if (!meta) {
        return new Set(V3_SCREENS);
    }
    return new Set(
        (meta.getAttribute('content') || '')
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean),
    );
}

export function isScreenEnabled(screen: V3Screen, doc: Document = document): boolean {
    return enabledScreens(doc).has(screen);
}

/** أول شاشة مفعّلة — وجهة الجذر `/`؛ `null` يعني لا شاشة ⇒ القديم. */
export function firstEnabledScreen(doc: Document = document): V3Screen | null {
    const enabled = enabledScreens(doc);
    return V3_SCREENS.find((screen) => enabled.has(screen)) ?? null;
}
