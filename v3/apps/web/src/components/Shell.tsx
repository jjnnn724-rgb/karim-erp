import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { logout, useAuthState } from '../lib/auth';
import { useHiddenNavKeys } from '../lib/hidden-nav';
import { useAllowedMenus } from '../lib/my-menus';
import {
    APP_NAME,
    groupForPath,
    HOME_PATH,
    HOME_TITLE,
    MOBILE_PRIMARY,
    NAV_GROUPS,
    type NavPrefs,
    readNavPrefs,
    titleForPath,
    writeNavPrefs,
} from '../lib/navigation';
import { useDocumentMeta } from '../lib/page-meta';
import { isV3Preview } from '../lib/rollout';
import { enabledScreens, LEGACY_APP_URL } from '../lib/screens';
import { ThemeProvider, useTheme } from '../ui/ThemeProvider';
import { Breadcrumbs } from './Breadcrumbs';
import { type CommandAction, CommandPalette } from './CommandPalette';
import { ChevronIcon } from './icons';
import { PrintBrand, PrintRunner } from './PrintBrand';
import { SHELL_GROUP_ICONS, ShellBrandMark, ShellIcon, shellIconForPath } from './ShellIcons';
import { ThemeToggle } from './ThemeToggle';
import './shell-premium.css';

/**
 * قشرة KARIM — تنقّل منطقي RTL، وتفضيلات محفوظة، وثيم من ui-kit.
 * كتلة NAV_ITEMS تبقى نصًا صريحًا لحرّاس التسجيل؛ الشاشات المعطّلة لا تظهر
 * في التنقّل أو البحث. الدرج مستقل عن الوضع المضغوط للشريط المكتبي.
 */

// كتلة التنقّل الـ63 — نصّ صريح يحرسه registration.test.ts (لا تُولَّد آليًا).
export const NAV_ITEMS = [
    { to: '/accounts', label: 'شجرة الحسابات', hint: 'AccountsTree' },
    { to: '/journal', label: 'القيود اليومية', hint: 'JournalViewer' },
    { to: '/revenues', label: 'الإيرادات', hint: 'Revenues' },
    { to: '/expenses', label: 'المصروفات', hint: 'Expenses' },
    { to: '/cash-register', label: 'سجلّ الصرف', hint: 'Expense Register' },
    { to: '/daily-locks', label: 'لوحة التقفيل اليومي', hint: 'Daily Locks' },
    { to: '/oracle-data', label: 'بيانات Oracle المنسوخة', hint: 'Oracle Data' },
    { to: '/procurement', label: 'الموردون', hint: 'Suppliers' },
    { to: '/purchase-invoices', label: 'فواتير الشراء', hint: 'Invoices' },
    { to: '/payments', label: 'مدفوعات الموردين', hint: 'Payments' },
    { to: '/departments', label: 'الأقسام', hint: 'Departments' },
    { to: '/wh-moves', label: 'حركات المخزون', hint: 'WhMoves' },
    { to: '/dispatch', label: 'أذون الصرف', hint: 'Dispatch' },
    { to: '/warehouse', label: 'المخزون', hint: 'Inventory' },
    { to: '/warehouse-gov', label: 'حوكمة المخزن', hint: 'Governance' },
    { to: '/goods-scan', label: 'مسح البضاعة', hint: 'Barcode' },
    { to: '/shelves', label: 'الرفوف', hint: 'Shelves' },
    { to: '/weight', label: 'الميزان', hint: 'Scale' },
    { to: '/wh-returns', label: 'مرتجعات المطبخ', hint: 'Returns' },
    { to: '/wh-prs', label: 'طلبات الشراء', hint: 'PRs' },
    { to: '/dept-transfers', label: 'التحويلات الداخلية', hint: 'Transfers' },
    { to: '/employees', label: 'دليل الموظفين', hint: 'Employees' },
    { to: '/hr-departments', label: 'أقسام الموظفين', hint: 'HR Departments' },
    { to: '/attendance', label: 'الحضور والانصراف', hint: 'Attendance' },
    { to: '/leaves', label: 'الإجازات', hint: 'Leaves' },
    { to: '/payroll', label: 'الرواتب', hint: 'Payroll' },
    { to: '/mudad', label: 'مدد والتأمينات وقوى', hint: 'WPS · GOSI · Qiwa' },
    { to: '/roster', label: 'الدوام', hint: 'Roster' },
    { to: '/users', label: 'المستخدمون', hint: 'Users' },
    { to: '/branches', label: 'الفروع', hint: 'Branches' },
    { to: '/permissions', label: 'الصلاحيات', hint: 'Permissions' },
    { to: '/veg-requests', label: 'طلبات الخضار', hint: 'Vegetables' },
    { to: '/recipes', label: 'الوصفات', hint: 'Recipes' },
    { to: '/briefing', label: 'موجز المدير', hint: 'Briefing' },
    { to: '/command-center', label: 'مركز القيادة الموحّد', hint: 'Command Center' },
    { to: '/bank-rec', label: 'مطابقة البنك', hint: 'Bank Reconciliation' },
    { to: '/sessions', label: 'الأجهزة والجلسات', hint: 'Sessions' },
    { to: '/whatsapp', label: 'واتساب والتنبيهات', hint: 'WhatsApp' },
    { to: '/settings', label: 'إعدادات النظام', hint: 'Settings' },
    { to: '/executive', label: 'الموجز التنفيذي', hint: 'Executive' },
    { to: '/hr-dashboard', label: 'لوحة الموارد البشرية', hint: 'HR Dashboard' },
    { to: '/dept-employees', label: 'موظفو القسم', hint: 'Dept Employees' },
    { to: '/employee-portal', label: 'بوابة الموظف', hint: 'Employee Portal' },
    { to: '/zkteco', label: 'أجهزة البصمة', hint: 'ZKTeco' },
    { to: '/kitchen', label: 'المطبخ', hint: 'Kitchen' },
    { to: '/menu-board', label: 'شاشة القائمة', hint: 'Menu Board' },
    { to: '/warehouse-dashboard', label: 'لوحة المخزن', hint: 'WH Dashboard' },
    { to: '/inventory-inquiry', label: 'محرك الاستعلامات', hint: 'Inventory Query' },
    { to: '/inventory-inquiry-pro', label: 'البطاقة الفاخرة', hint: 'Item Card' },
    { to: '/accountant-dashboard', label: 'لوحة المحاسب', hint: 'Accountant' },
    { to: '/cfo', label: 'المدير المالي', hint: 'CFO' },
    { to: '/dept-head-dashboard', label: 'لوحة رئيس القسم', hint: 'Dept Head' },
    { to: '/cost-analysis', label: 'تحليل التكلفة', hint: 'Cost Analysis' },
    { to: '/cost-center', label: 'مركز التكلفة', hint: 'Cost Center' },
    { to: '/pnl', label: 'الأرباح والخسائر', hint: 'P&L' },
    { to: '/monthly-comparison', label: 'المقارنة الشهرية', hint: 'Monthly' },
    { to: '/reports', label: 'تقارير المبيعات', hint: 'Reports' },
    {
        to: '/vat-return',
        label: 'مسودة مراجعة ضريبة القيمة المضافة',
        hint: 'VAT Review',
    },
    { to: '/cashier-sales', label: 'مبيعات الكاشير', hint: 'Cashier Sales' },
    { to: '/cashier-monitor', label: 'متابعة الكاشير', hint: 'Cashier Monitor' },
    { to: '/pos-entry', label: 'نقطة البيع', hint: 'POS' },
    { to: '/cashier', label: 'واجهة الكاشير', hint: 'Cashier Page' },
    { to: '/integrations', label: 'مصدر البيانات', hint: 'Data Source' },
    { to: '/sales-analyzer', label: 'تحليل المبيعات', hint: 'Sales Analyzer' },
    { to: '/sales-inquiry', label: 'استعلام المبيعات', hint: 'Sales Inquiry' },
    { to: '/received-analyzer', label: 'تحليل المستلَم', hint: 'Received' },
    { to: '/wh-vs-pos', label: 'المخزن مقابل نقطة البيع', hint: 'WH vs POS' },
    { to: '/yarasoft', label: 'تكامل قاعدة الكاشير', hint: 'YaraSoft' },
] as const;

type NavItem = (typeof NAV_ITEMS)[number];

/** القشرة مع مزوّد الثيم — نقطة واحدة، بلا اعتماد على مزوّد خارجي. */
export function Shell() {
    return (
        <ThemeProvider>
            <ShellRoute />
        </ThemeProvider>
    );
}

/** وضع الكاشير المستقل لا يرث قائمة الإدارة أو بياناتها. */
function ShellRoute() {
    const path = useRouterState({ select: (state) => state.location.pathname });
    if (path.replace(/\/+$/, '') === '/cashier') {
        return <Outlet />;
    }
    // نقطة البيع سطح تشغيل مستقل: بلا شريط تنقّل إداري ولا رأس متصفّح.
    if (path.replace(/\/+$/, '') === '/pos-entry') {
        return <Outlet />;
    }
    return <ShellLayout />;
}

function ShellLayout() {
    const auth = useAuthState();
    const { resolvedTheme, setTheme } = useTheme();
    const [prefs, setPrefs] = useState<NavPrefs>(() => readNavPrefs());
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const mainRef = useRef<HTMLElement>(null);
    const drawerRef = useRef<HTMLDivElement>(null);
    const drawerCloseRef = useRef<HTMLButtonElement>(null);
    const drawerReturnFocusRef = useRef<HTMLElement | null>(null);
    const pendingPaletteFrameRef = useRef<number | null>(null);
    const previousPathRef = useRef<string | null>(null);
    const navigate = useNavigate();
    const currentPath = useRouterState({ select: (state) => state.location.pathname });
    const currentTitle = titleForPath(currentPath);
    const currentGroup = groupForPath(currentPath);
    // AccountsTree exposes only fetchChart; never infer access for other screens.
    const chartReadOnly = currentPath.replace(/\/+$/, '') === '/accounts';

    useDocumentMeta(currentTitle);

    const paletteActions = useMemo<CommandAction[]>(
        () => [
            {
                id: 'theme',
                label: 'تبديل الوضع',
                hint: resolvedTheme === 'dark' ? 'إلى الفاتح' : 'إلى الداكن',
                run: () => {
                    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
                },
            },
            {
                id: 'pos',
                label: 'فتح الكاشير (نقطة البيع)',
                hint: 'POS',
                run: () => {
                    void navigate({ to: '/pos-entry' });
                },
            },
            {
                id: 'legacy',
                label: 'فتح الواجهة القديمة',
                hint: 'v2',
                run: () => {
                    window.location.assign(LEGACY_APP_URL);
                },
            },
            {
                id: 'logout',
                label: 'تسجيل الخروج',
                hint: 'Logout',
                run: () => {
                    logout();
                },
            },
        ],
        [navigate, resolvedTheme, setTheme],
    );

    // نفس الاختصار السابق؛ نافذة واحدة نشطة بدل تداخل حصرَي التركيز.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                if (drawerOpen) {
                    setDrawerOpen(false);
                    // استعادة زر الدرج أولًا، ثم تمنح لوحة الأوامر التركيز لحقلها.
                    pendingPaletteFrameRef.current = window.requestAnimationFrame(() => {
                        pendingPaletteFrameRef.current = null;
                        setPaletteOpen(true);
                    });
                } else {
                    setPaletteOpen((open) => !open);
                }
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [drawerOpen]);

    useEffect(
        () => () => {
            if (pendingPaletteFrameRef.current !== null) window.cancelAnimationFrame(pendingPaletteFrameRef.current);
        },
        [],
    );

    // الانتقال يعيد التركيز للمحتوى ويغلق درج الجوال، بما في ذلك انتقالات التاريخ.
    useEffect(() => {
        const previous = previousPathRef.current;
        previousPathRef.current = currentPath;
        if (previous !== null && previous !== currentPath) {
            setDrawerOpen(false);
            mainRef.current?.focus();
            // كل صفحة تبدأ من فوقها — حركة السكرول عالمية (تفعيل تضيمي عند التبديل).
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
        }
    }, [currentPath]);

    // الدرج يبقى في DOM كما سابقًا؛ المخفي inert، والخلفية inert أثناء الفتح.
    useEffect(() => {
        if (!drawerOpen) return;
        const drawer = drawerRef.current;
        if (!drawer) return;
        const restoreTarget =
            drawerReturnFocusRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        drawerReturnFocusRef.current = null;
        const openedPath = previousPathRef.current;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        drawerCloseRef.current?.focus();

        const focusable = () =>
            Array.from(drawer.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')).filter((element) => {
                const style = window.getComputedStyle(element);
                return (
                    element.tabIndex >= 0 &&
                    !element.matches(':disabled') &&
                    !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden'
                );
            });
        const trapFocus = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setDrawerOpen(false);
                return;
            }
            if (event.key !== 'Tab') return;
            const items = focusable();
            const first = items[0];
            const last = items[items.length - 1];
            if (!first || !last) {
                event.preventDefault();
                drawer.focus();
            } else if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        };
        const keepFocusInside = (event: FocusEvent) => {
            if (event.target instanceof Node && !drawer.contains(event.target)) {
                (focusable()[0] ?? drawer).focus();
            }
        };
        const desktop = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 1024px)') : null;
        const closeOnDesktop = () => {
            if (desktop?.matches) setDrawerOpen(false);
        };
        document.addEventListener('keydown', trapFocus);
        document.addEventListener('focusin', keepFocusInside);
        desktop?.addEventListener('change', closeOnDesktop);
        closeOnDesktop();
        return () => {
            document.removeEventListener('keydown', trapFocus);
            document.removeEventListener('focusin', keepFocusInside);
            desktop?.removeEventListener('change', closeOnDesktop);
            document.body.style.overflow = previousOverflow;
            if (previousPathRef.current !== openedPath) {
                mainRef.current?.focus();
            } else if (restoreTarget?.isConnected && !restoreTarget.closest('[inert]')) {
                restoreTarget.focus();
            }
        };
    }, [drawerOpen]);

    const updatePrefs = useCallback((next: NavPrefs) => {
        setPrefs(next);
        writeNavPrefs(next);
    }, []);

    const toggleGroup = useCallback(
        (groupId: string) => {
            const collapsed = prefs.collapsed.includes(groupId)
                ? prefs.collapsed.filter((entry) => entry !== groupId)
                : [...prefs.collapsed, groupId];
            updatePrefs({ collapsed, compact: prefs.compact });
        },
        [prefs, updatePrefs],
    );

    const screens = enabledScreens();
    const allowedMenusSet = useAllowedMenus();
    const hiddenNav = new Set(useHiddenNavKeys());
    const navItems = NAV_ITEMS.filter((item) => {
        if (!screens.has(item.to.slice(1))) {
            return false;
        }
        if (hiddenNav.has(item.to.slice(1))) {
            return false;
        }
        // مرآة V2 (nav-model.js allowedMenus): ما ليس في قوائم الدور + المنح − الممنوع
        // لا يظهر في القائمة أصلًا — بدل أن يفتحه المستخدم فيُرفض (403).
        // null = لا جلسة/دور مجهول ⇒ لا ترشيح (لا قفل للخارجين).
        if (!allowedMenusSet) {
            return true;
        }
        return allowedMenusSet.includes(item.to.slice(1));
    });

    const renderNav = (compact: boolean, suffix: string) => (
        <nav aria-label="أقسام النظام" className="erp-shell__nav">
            {NAV_GROUPS.map((group) => {
                const items = group.keys
                    .map((key) => navItems.find((item) => item.to === `/${key}`))
                    .filter((item): item is NavItem => Boolean(item));
                if (items.length === 0) return null;
                const isCollapsed = prefs.collapsed.includes(group.id);
                const listId = `erp-nav-group-${group.id}-${suffix}`;
                return (
                    <div key={group.id} className="erp-shell__nav-group" data-current={currentGroup?.id === group.id || undefined}>
                        <button
                            type="button"
                            aria-expanded={!isCollapsed}
                            aria-controls={listId}
                            title={compact ? group.label : undefined}
                            onClick={() => {
                                toggleGroup(group.id);
                            }}
                            className="erp-shell__group-trigger"
                        >
                            <ShellIcon name={SHELL_GROUP_ICONS[group.id]} />
                            <span className={compact ? 'sr-only' : 'erp-shell__group-label'}>{group.label}</span>
                            {compact ? null : <ChevronIcon className={`erp-shell__chevron ${isCollapsed ? '-rotate-90' : ''}`} />}
                        </button>
                        {isCollapsed ? null : (
                            <ul id={listId} className="erp-shell__nav-list">
                                {items.map((item) => (
                                    <li key={item.to}>
                                        <Link
                                            to={item.to}
                                            activeOptions={{ exact: false }}
                                            title={compact ? item.label : undefined}
                                            aria-label={compact ? item.label : undefined}
                                            onClick={() => {
                                                setDrawerOpen(false);
                                            }}
                                            className="erp-nav-item erp-shell__nav-link"
                                        >
                                            <ShellIcon name={shellIconForPath(item.to)} />
                                            <span className={compact ? 'sr-only' : 'erp-shell__nav-label'}>{item.label}</span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                );
            })}
        </nav>
    );

    const renderBrand = (compact: boolean) => (
        <div className="erp-shell__brand">
            <ShellBrandMark />
            <div className={compact ? 'sr-only' : 'erp-shell__brand-copy'}>
                <span className="erp-shell__brand-name" dir="ltr">
                    {APP_NAME}
                </span>
                <span className="erp-shell__brand-caption">الإصدار الثالث · إدارة المطاعم</span>
            </div>
        </div>
    );

    const renderUser = (compact: boolean) =>
        auth.user ? (
            <div className="erp-shell__user" data-compact={compact || undefined}>
                <span className="erp-shell__avatar" aria-hidden="true">
                    <ShellIcon name="users" />
                </span>
                <div className={compact ? 'sr-only' : 'erp-shell__user-copy'}>
                    <p className="erp-shell__user-name">{auth.user.name}</p>
                    <p className="erp-shell__user-role">{auth.user.role}</p>
                </div>
                <button
                    type="button"
                    title="خروج"
                    aria-label={compact ? 'خروج' : undefined}
                    onClick={() => {
                        logout();
                    }}
                    className="erp-shell__logout"
                >
                    <ShellIcon name="logout" />
                    <span className={compact ? 'sr-only' : undefined}>خروج</span>
                </button>
            </div>
        ) : null;

    const homeLink = (compact: boolean) => (
        <Link
            to={HOME_PATH}
            activeOptions={{ exact: true }}
            title={compact ? HOME_TITLE : undefined}
            aria-label={compact ? HOME_TITLE : undefined}
            onClick={() => {
                setDrawerOpen(false);
            }}
            className="erp-nav-item erp-shell__nav-link erp-shell__home-link"
        >
            <ShellIcon name="home" />
            <span className={compact ? 'sr-only' : 'erp-shell__nav-label'}>الرئيسية</span>
        </Link>
    );

    return (
        <div className="erp-shell" dir="rtl">
            <a href="#erp-v3-main" className="erp-shell__skip-link sr-only focus:not-sr-only">
                تخطَّ إلى المحتوى
            </a>
            <div className="erp-shell__layout">
                <aside
                    aria-label="التنقّل الرئيسي"
                    inert={drawerOpen}
                    className="erp-shell__sidebar"
                    data-compact={prefs.compact || undefined}
                >
                    <div className="erp-shell__sidebar-head">{renderBrand(prefs.compact)}</div>
                    <div className="erp-shell__nav-scroll">
                        {homeLink(prefs.compact)}
                        {renderNav(prefs.compact, 'aside')}
                    </div>
                    <div className="erp-shell__sidebar-foot">
                        <div className="erp-shell__sidebar-tools">
                            <ThemeToggle iconOnly={prefs.compact} className="erp-shell__theme-toggle" />
                            <button
                                type="button"
                                aria-pressed={prefs.compact}
                                title={prefs.compact ? 'توسيع' : undefined}
                                onClick={() => {
                                    updatePrefs({ collapsed: prefs.collapsed, compact: !prefs.compact });
                                }}
                                className="erp-shell__compact-toggle"
                            >
                                <ShellIcon name="panel" />
                                <span className={prefs.compact ? 'sr-only' : undefined}>{prefs.compact ? 'توسيع' : 'وضع مضغوط'}</span>
                            </button>
                        </div>
                        {renderUser(prefs.compact)}
                    </div>
                </aside>

                {drawerOpen ? (
                    <button
                        type="button"
                        aria-label="إغلاق القائمة"
                        tabIndex={-1}
                        onClick={() => {
                            setDrawerOpen(false);
                        }}
                        className="erp-shell__backdrop"
                    />
                ) : null}
                <div
                    id="erp-v3-drawer"
                    ref={drawerRef}
                    tabIndex={-1}
                    role="dialog"
                    aria-modal={drawerOpen ? true : undefined}
                    aria-label="قائمة التنقّل"
                    aria-hidden={!drawerOpen}
                    inert={!drawerOpen}
                    className="erp-shell__drawer"
                    data-open={drawerOpen || undefined}
                >
                    <div className="erp-shell__drawer-head">
                        {renderBrand(false)}
                        <button
                            ref={drawerCloseRef}
                            type="button"
                            onClick={() => {
                                setDrawerOpen(false);
                            }}
                            className="erp-shell__drawer-close"
                        >
                            <ShellIcon name="close" />
                            <span className="sr-only">إغلاق</span>
                        </button>
                    </div>
                    <div className="erp-shell__nav-scroll">
                        {homeLink(false)}
                        {renderNav(false, 'drawer')}
                    </div>
                    <div className="erp-shell__sidebar-foot">
                        <ThemeToggle className="erp-shell__theme-toggle" />
                        {renderUser(false)}
                    </div>
                </div>

                <div className="erp-shell__workspace" inert={drawerOpen}>
                    <header className="erp-shell__header">
                        <div className="erp-shell__header-start">
                            <button
                                type="button"
                                onClick={(event) => {
                                    drawerReturnFocusRef.current = event.currentTarget;
                                    setDrawerOpen((open) => !open);
                                }}
                                aria-expanded={drawerOpen}
                                aria-controls="erp-v3-drawer"
                                className="erp-shell__menu-button"
                            >
                                <ShellIcon name="menu" />
                                <span className="sr-only">القائمة</span>
                            </button>
                            <div className="erp-shell__workspace-context">
                                <span className="erp-shell__workspace-label">مساحة إدارة المطعم</span>
                                <span className="erp-shell__page-context">
                                    {currentGroup ? (
                                        <>
                                            <span>{currentGroup.label}</span>
                                            <span aria-hidden="true" className="erp-shell__context-divider">
                                                /
                                            </span>
                                        </>
                                    ) : null}
                                    <strong>{currentTitle ?? APP_NAME}</strong>
                                </span>
                                {chartReadOnly ? (
                                    <span className="erp-shell__screen-access" title="صلاحية شاشة شجرة الحسابات: للقراءة فقط — بلا كتابة">
                                        للقراءة فقط — بلا كتابة
                                    </span>
                                ) : null}
                                {isV3Preview() ? (
                                    <a
                                        href="/v3-preview"
                                        target="_blank"
                                        rel="noopener"
                                        className="erp-shell__preview-chip"
                                        title="الإصدار الثالث قيد المعاينة — موعد الانتقال وتفاصيله"
                                    >
                                        <span aria-hidden="true" className="erp-shell__preview-dot" />
                                        معاينة · ينتقل النظام إليه قريبًا
                                    </a>
                                ) : null}
                            </div>
                        </div>
                        <Link to="/pos-entry" title="فتح نقطة البيع داخل النظام" className="erp-shell__command-trigger erp-shell__pos-link">
                            <ShellIcon name="monitor" />
                            <span>الكاشير</span>
                        </Link>
                        <button
                            type="button"
                            onClick={() => {
                                setPaletteOpen(true);
                            }}
                            aria-keyshortcuts="Control+K Meta+K"
                            className="erp-shell__command-trigger"
                        >
                            <ShellIcon name="search" />
                            <span>
                                بحث…<span className="erp-shell__command-description"> في الشاشات والأوامر</span>
                            </span>
                            <kbd dir="ltr">Ctrl K</kbd>
                        </button>
                        <div className="erp-shell__session-context">
                            <span className="erp-shell__session-icon" aria-hidden="true">
                                <ShellIcon name="users" />
                            </span>
                            <div>
                                <span className="erp-shell__session-name">{auth.user?.name ?? APP_NAME}</span>
                                <span className="erp-shell__session-role">
                                    {auth.user?.role ?? (auth.status === 'authenticated' ? 'جلسة مسجّلة' : 'إدارة المطاعم')}
                                </span>
                            </div>
                        </div>
                    </header>
                    <main id="erp-v3-main" ref={mainRef} tabIndex={-1} className="erp-shell__main">
                        <Breadcrumbs pathname={currentPath} />
                        {/* هوية الطباعة: شعار + اسم الشركة قبل محتوى الشاشة، وختم بعده. */}
                        <PrintBrand />
                        {/* انتقال الصفحات العالمي: مفتاح المسار يعيد تشغيل حركة الدخول. */}
                        <div key={currentPath} className="erp-route-transition">
                            <Outlet />
                        </div>
                        <PrintRunner title={currentTitle} />
                    </main>
                    <nav aria-label="التنقّل السريع" className="erp-shell__mobile-nav">
                        {MOBILE_PRIMARY.map((entry) => {
                            if (!entry.key)
                                return (
                                    <Link
                                        key="home"
                                        to={HOME_PATH}
                                        activeOptions={{ exact: true }}
                                        onClick={() => {
                                            setDrawerOpen(false);
                                        }}
                                        className="erp-nav-bottom erp-shell__mobile-link"
                                    >
                                        <ShellIcon name="home" />
                                        <span>{entry.label}</span>
                                    </Link>
                                );
                            const item = navItems.find((candidate) => candidate.to === `/${entry.key}`);
                            if (!item) return null;
                            return (
                                <Link
                                    key={item.to}
                                    to={item.to}
                                    activeOptions={{ exact: false }}
                                    aria-label={item.label}
                                    onClick={() => {
                                        setDrawerOpen(false);
                                    }}
                                    className="erp-nav-bottom erp-shell__mobile-link"
                                >
                                    <ShellIcon name={shellIconForPath(item.to)} />
                                    <span>{entry.label}</span>
                                </Link>
                            );
                        })}
                        <button
                            type="button"
                            onClick={(event) => {
                                drawerReturnFocusRef.current = event.currentTarget;
                                setDrawerOpen(true);
                            }}
                            aria-expanded={drawerOpen}
                            aria-controls="erp-v3-drawer"
                            className="erp-nav-bottom erp-shell__mobile-link"
                        >
                            <ShellIcon name="more" />
                            <span>المزيد</span>
                        </button>
                    </nav>
                </div>
            </div>
            <CommandPalette
                open={paletteOpen}
                actions={paletteActions}
                items={[
                    { to: HOME_PATH, label: HOME_TITLE, hint: 'Home' },
                    ...navItems.map((item) => ({ to: item.to, label: item.label, hint: item.hint })),
                ]}
                onClose={() => {
                    setPaletteOpen(false);
                }}
                onSelect={(to) => {
                    if (to === HOME_PATH) {
                        void navigate({ to: HOME_PATH });
                        return;
                    }
                    const target = navItems.find((item) => item.to === to);
                    if (target) {
                        void navigate({ to: target.to });
                    }
                }}
            />
        </div>
    );
}
