/**
 * خريطة التنقّل — المصدر الوحيد لمجموعات القائمة والعناوين والشريط السفلي.
 *
 * الشاشات الـ63 مفاتيح `V3_SCREENS` مقسّمة على سبع مجموعات منطقية (خطة
 * المرحلة الثانية §3.3). التقسيم هنا **بيانات** لا JSX، فيختبره حارس
 * الوحدة ويتحقّق من تغطية كل مفاتيح `screens.ts` مرّة واحدة.
 *
 * `Shell.tsx` يحمل كتلة `NAV_ITEMS` الـ63 نفسها (يحرسها
 * `registration.test.ts` نصًّا)، وهذا الملف يضيف ما فوقها: التجميع،
 * عنوان كل مسار، والشريط السفلي. أي انحراف بين الاثنين يُسقط
 * `Shell.test.tsx`.
 *
 * كل التنسيق خارج هذا الملف؛ هنا بيانات وتخزين تفضيلات فقط.
 */

/**
 * مجموعات التنقّل السبع — الترتيب هو ترتيب العرض.
 * التشغيل أولًا لأن نقطة البيع والمطبخ أكثر ما يُفتح يوميًا، ثم المال والمخزون،
 * والإدارة في آخر القائمة.
 */
export const NAV_GROUP_IDS = ['operations', 'finance', 'inventory', 'procurement', 'hr', 'analytics', 'system'] as const;

export type NavGroupId = (typeof NAV_GROUP_IDS)[number];

export interface NavGroup {
    readonly id: NavGroupId;
    readonly label: string;
    /** لصيقة قصيرة للوضع المضغوط (عمود 72px). */
    readonly shortLabel: string;
    /** مفاتيح الشاشات (`V3_SCREENS`) بهذا الترتيب. */
    readonly keys: readonly string[];
}

/** سبع مجموعات تغطّي 63 شاشة بلا تكرار ولا زيادة (يحرسه `Shell.test.tsx`). */
export const NAV_GROUPS: readonly NavGroup[] = [
    {
        id: 'operations',
        label: 'التشغيل',
        shortLabel: 'تشغيل',
        keys: ['pos-entry', 'cashier-monitor', 'kitchen', 'menu-board', 'recipes', 'departments', 'dept-transfers', 'whatsapp'],
    },
    {
        id: 'finance',
        label: 'المالية',
        shortLabel: 'مالية',
        keys: [
            'accounts',
            'journal',
            'revenues',
            'expenses',
            'cash-register',
            'daily-locks',
            'bank-rec',
            'pnl',
            'cfo',
            'monthly-comparison',
            'cost-analysis',
            'cost-center',
            'accountant-dashboard',
            'yarasoft',
        ],
    },
    {
        id: 'procurement',
        label: 'المشتريات والموردون',
        shortLabel: 'مشتريات',
        keys: ['procurement', 'purchase-invoices', 'payments', 'wh-prs', 'veg-requests'],
    },
    {
        id: 'inventory',
        label: 'المخزون',
        shortLabel: 'مخزون',
        keys: [
            'warehouse',
            'warehouse-dashboard',
            'wh-moves',
            'dispatch',
            'warehouse-gov',
            'shelves',
            'wh-returns',
            'weight',
            'goods-scan',
            'inventory-inquiry',
            'inventory-inquiry-pro',
            'wh-vs-pos',
        ],
    },
    {
        id: 'hr',
        label: 'الموارد البشرية',
        shortLabel: 'موارد',
        keys: [
            'employees',
            'hr-departments',
            'hr-dashboard',
            'attendance',
            'leaves',
            'payroll',
            'mudad',
            'roster',
            'dept-employees',
            'employee-portal',
            'zkteco',
        ],
    },
    {
        id: 'analytics',
        label: 'التحليل والتقارير',
        shortLabel: 'تحليل',
        keys: [
            'command-center',
            'briefing',
            'executive',
            'dept-head-dashboard',
            'reports',
            'vat-return',
            'cashier-sales',
            'sales-analyzer',
            'sales-inquiry',
            'received-analyzer',
        ],
    },
    {
        id: 'system',
        label: 'النظام',
        shortLabel: 'نظام',
        keys: ['users', 'branches', 'permissions', 'settings', 'sessions', 'oracle-data'],
    },
];

/** المسار الرئيسي والعنوان المعروض. */
export const HOME_PATH = '/';
export const HOME_TITLE = 'الرئيسية';
export const APP_NAME = 'Karim ERP';

/** عنوان كل مسار — من تسميات التنقّل العربية نفسها (لا قاموس ثانٍ). */
export const NAV_TITLES: Readonly<Record<string, string>> = {
    '/': HOME_TITLE,
    '/accounts': 'شجرة الحسابات',
    '/journal': 'القيود اليومية',
    '/revenues': 'الإيرادات',
    '/expenses': 'المصروفات',
    '/cash-register': 'سجلّ الصرف',
    '/daily-locks': 'لوحة التقفيل اليومي',
    '/bank-rec': 'مطابقة البنك',
    '/oracle-data': 'بيانات Oracle المنسوخة',
    '/procurement': 'الموردون',
    '/purchase-invoices': 'فواتير الشراء',
    '/payments': 'مدفوعات الموردين',
    '/departments': 'الأقسام',
    '/wh-moves': 'حركات المخزون',
    '/dispatch': 'أذون الصرف',
    '/warehouse': 'المخزون',
    '/warehouse-gov': 'حوكمة المخزن',
    '/shelves': 'الرفوف',
    '/wh-returns': 'مرتجعات المطبخ',
    '/wh-prs': 'طلبات الشراء',
    '/dept-transfers': 'التحويلات الداخلية',
    '/employees': 'دليل الموظفين',
    '/hr-departments': 'أقسام الموظفين',
    '/attendance': 'الحضور والانصراف',
    '/leaves': 'الإجازات',
    '/payroll': 'الرواتب',
    '/mudad': 'مدد والتأمينات وقوى',
    '/roster': 'الدوام',
    '/users': 'المستخدمون',
    '/branches': 'الفروع',
    '/permissions': 'الصلاحيات',
    '/veg-requests': 'طلبات الخضار',
    '/weight': 'الميزان',
    '/recipes': 'الوصفات',
    '/goods-scan': 'مسح البضاعة',
    '/briefing': 'موجز المدير',
    '/command-center': 'مركز القيادة الموحّد',
    '/sessions': 'الأجهزة والجلسات',
    '/whatsapp': 'واتساب والتنبيهات',
    '/settings': 'إعدادات النظام',
    '/executive': 'الموجز التنفيذي',
    '/hr-dashboard': 'لوحة الموارد البشرية',
    '/dept-employees': 'موظفو القسم',
    '/employee-portal': 'بوابة الموظف',
    '/zkteco': 'أجهزة البصمة',
    '/kitchen': 'المطبخ',
    '/menu-board': 'شاشة القائمة',
    '/warehouse-dashboard': 'لوحة المخزن',
    '/accountant-dashboard': 'لوحة المحاسب',
    '/dept-head-dashboard': 'لوحة رئيس القسم',
    '/cost-analysis': 'تحليل التكلفة',
    '/cost-center': 'مركز التكلفة',
    '/inventory-inquiry': 'محرك الاستعلامات',
    '/inventory-inquiry-pro': 'البطاقة الفاخرة',
    '/pnl': 'الأرباح والخسائر',
    '/cfo': 'المدير المالي',
    '/monthly-comparison': 'المقارنة الشهرية',
    '/reports': 'تقارير المبيعات',
    '/vat-return': 'مسودة مراجعة ضريبة القيمة المضافة',
    '/cashier-sales': 'مبيعات الكاشير',
    '/cashier-monitor': 'متابعة الكاشير',
    '/pos-entry': 'نقطة البيع',
    '/cashier': 'واجهة الكاشير',
    '/integrations': 'مصدر البيانات',
    '/sales-analyzer': 'تحليل المبيعات',
    '/sales-inquiry': 'استعلام المبيعات',
    '/received-analyzer': 'تحليل المستلَم',
    '/wh-vs-pos': 'المخزن مقابل نقطة البيع',
    '/yarasoft': 'تكامل قاعدة الكاشير',
};

/**
 * الشريط السفلي على الجوال: خمسة عناصر أساسية + «المزيد» يفتح الدرج.
 * `key === null` يعني الرئيسية (خارج عدّ التكافؤ).
 */
export interface MobilePrimaryItem {
    readonly key: string | null;
    readonly label: string;
}

export const MOBILE_PRIMARY: readonly MobilePrimaryItem[] = [
    { key: null, label: HOME_TITLE },
    { key: 'pos-entry', label: 'الكاشير' },
    { key: 'warehouse', label: 'المخزون' },
    { key: 'employees', label: 'الموظفون' },
    { key: 'reports', label: 'التقارير' },
];

/** المسار بلا `basepath`؛ يوحّد `/accounts/` و`/accounts` و`/`. */
export function normalizePath(pathname: string): string {
    const raw = String(pathname ?? '').trim();
    if (!raw || raw === '/') {
        return '/';
    }
    return raw.replace(/\/+$/, '') || '/';
}

/** عنوان المسار من خريطة التنقّل، أو `null` لمسار غير معروف. */
export function titleForPath(pathname: string): string | null {
    const path = normalizePath(pathname);
    return Object.hasOwn(NAV_TITLES, path) ? (NAV_TITLES[path] ?? null) : null;
}

/** عنوان الوثيقة الموحّد: «{الشاشة} — Karim ERP». */
export function documentTitle(title: string | null): string {
    const label = String(title ?? '').trim();
    return label ? `${label} — ${APP_NAME}` : APP_NAME;
}

/** المجموعة التي ينتمي إليها مسار شاشة، أو `null`. */
export function groupForPath(pathname: string): NavGroup | null {
    const path = normalizePath(pathname);
    const key = path.slice(1);
    if (!key) {
        return null;
    }
    return NAV_GROUPS.find((group) => group.keys.includes(key)) ?? null;
}

/** مفتاح الشاشة من مسارها؛ `''` للجذر. */
export function screenKeyOf(pathname: string): string {
    const path = normalizePath(pathname);
    return path === '/' ? '' : path.slice(1);
}

/* ─── تفضيلات التنقّل: الطي والوضع المضغوط ──────────────────────────────── */

export const NAV_PREFS_KEY = 'karim_nav_prefs_v1';

export interface NavPrefs {
    readonly collapsed: readonly string[];
    readonly compact: boolean;
}

export const DEFAULT_NAV_PREFS: NavPrefs = { collapsed: [], compact: false };

/** مخزن التفضيلات — واجهة `Storage` وحده، فاختبار الوحدة يمرّر بديلًا. */
export type PrefStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): PrefStorage | null {
    try {
        return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
        return null;
    }
}

/** يقرأ التفضيلات بأمان: تخزين معطّل أو JSON تالف ⇒ الافتراضي بلا رمي. */
export function readNavPrefs(storage: PrefStorage | null = defaultStorage()): NavPrefs {
    if (!storage) {
        return DEFAULT_NAV_PREFS;
    }
    try {
        const raw = storage.getItem(NAV_PREFS_KEY);
        if (!raw) {
            return DEFAULT_NAV_PREFS;
        }
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) {
            return DEFAULT_NAV_PREFS;
        }
        const record = parsed as Record<string, unknown>;
        const collapsed = Array.isArray(record.collapsed)
            ? record.collapsed
                  .filter((entry): entry is string => typeof entry === 'string')
                  .filter((entry) => (NAV_GROUP_IDS as readonly string[]).includes(entry))
            : [];
        const compact = record.compact === true;
        return { collapsed: [...new Set(collapsed)], compact };
    } catch {
        return DEFAULT_NAV_PREFS;
    }
}

/** يحفظ التفضيلات؛ فشل التخزين لا يمنع التفاعل في الجلسة الحالية. */
export function writeNavPrefs(prefs: NavPrefs, storage: PrefStorage | null = defaultStorage()): void {
    if (!storage) {
        return;
    }
    try {
        storage.setItem(NAV_PREFS_KEY, JSON.stringify({ collapsed: prefs.collapsed, compact: prefs.compact }));
    } catch {
        // تخزين معطّل — التفضيل يبقى في الذاكرة.
    }
}
