export interface ReportDestination {
    key: string;
    title: string;
    description: string;
    menu: string;
    href: string;
    output: string;
}

/** Existing V3 report/export surfaces; each destination enforces its own server permissions. */
export const REPORT_DESTINATIONS: readonly ReportDestination[] = [
    {
        key: 'general',
        title: 'الموجز التنفيذي',
        description: 'مؤشرات التشغيل والملخص التنفيذي.',
        menu: 'briefing',
        href: '/v3/briefing',
        output: 'طباعة وPDF',
    },
    {
        key: 'departments',
        title: 'الأقسام ومركز التكلفة',
        description: 'إيرادات ومصروفات وتحليل الأقسام.',
        menu: 'cost-center',
        href: '/v3/cost-center',
        output: 'طباعة وPDF',
    },
    {
        key: 'kitchen',
        title: 'تشغيل المطبخ',
        description: 'حركة التشغيل وطلبات المطبخ.',
        menu: 'kitchen',
        href: '/v3/kitchen',
        output: 'طباعة وPDF',
    },
    {
        key: 'returns',
        title: 'مرتجعات المخازن',
        description: 'سجلات المرتجعات وحالاتها.',
        menu: 'wh-returns',
        href: '/v3/wh-returns',
        output: 'طباعة وPDF',
    },
    {
        key: 'warehouse',
        title: 'المخزون',
        description: 'استعلام المخزون حسب الفترة والمرشحات.',
        menu: 'inventory-inquiry',
        href: '/v3/inventory-inquiry',
        output: 'Excel وطباعة وPDF',
    },
    {
        key: 'attendance',
        title: 'الحضور والانصراف',
        description: 'كشف الحضور حسب الفترة والموظف والقسم.',
        menu: 'attendance',
        href: '/v3/attendance',
        output: 'CSV وطباعة وPDF',
    },
    {
        key: 'employees',
        title: 'دليل الموظفين',
        description: 'قائمة الموظفين وبطاقاتهم وكشف الحضور الفردي.',
        menu: 'employees',
        href: '/v3/employees',
        output: 'طباعة وPDF',
    },
    {
        key: 'dept-employees',
        title: 'موظفو القسم',
        description: 'كشف الموظفين المرتبطين بالقسم.',
        menu: 'dept-employees',
        href: '/v3/dept-employees',
        output: 'طباعة وPDF',
    },
    {
        key: 'payroll',
        title: 'الرواتب',
        description: 'كشف الرواتب وأيام الحضور للشهر المحدد.',
        menu: 'payroll',
        href: '/v3/payroll',
        output: 'CSV وطباعة وPDF',
    },
    {
        key: 'revenues',
        title: 'سجل الإيرادات',
        description: 'مراجعة الإيرادات المسجلة.',
        menu: 'revenues',
        href: '/v3/revenues',
        output: 'طباعة وPDF',
    },
    {
        key: 'cashier-sales',
        title: 'مبيعات الكاشير',
        description: 'الفواتير والأصناف المسجلة حسب الكاشير.',
        menu: 'cashier-sales',
        href: '/v3/cashier-sales',
        output: 'طباعة وPDF',
    },
    {
        key: 'pnl',
        title: 'الأرباح والخسائر',
        description: 'قائمة الدخل وفق بيانات الحسابات.',
        menu: 'pnl',
        href: '/v3/pnl',
        output: 'طباعة وPDF',
    },
    {
        key: 'monthly-comparison',
        title: 'المقارنة الشهرية',
        description: 'مقارنة الإيرادات والمصروفات بين الفترات.',
        menu: 'monthly-comparison',
        href: '/v3/monthly-comparison',
        output: 'طباعة وPDF',
    },
    {
        key: 'cost-analysis',
        title: 'تحليل التكاليف',
        description: 'تحليل التكاليف التشغيلية.',
        menu: 'cost-analysis',
        href: '/v3/cost-analysis',
        output: 'طباعة وPDF',
    },
    {
        key: 'cash-register',
        title: 'سجلّ الصرف',
        description: 'سجل الصرف والتقارير التفصيلية.',
        menu: 'cash-register',
        href: '/v3/cash-register',
        output: 'طباعة وPDF',
    },
    {
        key: 'purchase-invoices',
        title: 'فواتير الشراء',
        description: 'فواتير الموردين وحركة الشراء.',
        menu: 'purchase-invoices',
        href: '/v3/purchase-invoices',
        output: 'طباعة وPDF',
    },
    {
        key: 'dispatch',
        title: 'أذون الصرف',
        description: 'أذون الصرف وحالات اعتمادها.',
        menu: 'dispatch',
        href: '/v3/dispatch',
        output: 'طباعة وPDF',
    },
    {
        key: 'wh-moves',
        title: 'حركة المخازن',
        description: 'حركة التحويلات والمستندات المخزنية.',
        menu: 'wh-moves',
        href: '/v3/wh-moves',
        output: 'طباعة وPDF',
    },
    {
        key: 'payments',
        title: 'مدفوعات الموردين',
        description: 'سجل المدفوعات والمراجعة المالية.',
        menu: 'payments',
        href: '/v3/payments',
        output: 'طباعة وPDF',
    },
    {
        key: 'sales-inquiry',
        title: 'استعلام المبيعات',
        description: 'استعلام مبيعات تفصيلي.',
        menu: 'sales-inquiry',
        href: '/v3/sales-inquiry',
        output: 'طباعة وPDF',
    },
    {
        key: 'sales-analyzer',
        title: 'تحليل مبيعات الأصناف',
        description: 'تحليل الأصناف والكميات المباعة.',
        menu: 'sales-analyzer',
        href: '/v3/sales-analyzer',
        output: 'طباعة وPDF',
    },
];

export function availableReportDestinations(allowedMenus: readonly string[], enabledScreens: ReadonlySet<string>): ReportDestination[] {
    const allowed = new Set(allowedMenus);
    return REPORT_DESTINATIONS.filter((report) => allowed.has(report.menu) && enabledScreens.has(report.menu));
}
