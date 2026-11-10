import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { login, logout } from '../lib/auth';
import { quickActionsForRole } from '../lib/home';
import { resetPageMetaForTests } from '../lib/page-meta';
import { V3_SCREENS } from '../lib/screens';
import { Home } from './Home';

/**
 * الصفحة الرئيسية — مصدر البيانات محقون (fetch) لا خادم حي:
 * نتحقق من العرض والدور والمؤشرات والحالات، لا من الشبكة.
 */

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

const SESSION = {
    access_token: 'test-token',
    refresh_token: 'test-refresh',
    app_key: 'test-key',
    user: { id: '1', name: 'سالم', role: 'admin', username: 'admin' },
};

function stubFetch(handler: (url: string) => Response | null): void {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input.toString();
            const handled = handler(url);
            if (handled) {
                return handled;
            }
            return json({ error: 'NOT_FOUND', message: 'مسار غير معروف في الاختبار' }, 404);
        }),
    );
}

function renderHome() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rootRoute = createRootRoute({ component: () => <Home /> });
    const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/' });
    const screenRoutes = V3_SCREENS.map((key) => createRoute({ getParentRoute: () => rootRoute, path: `/${key}` }));
    const router = createRouter({
        routeTree: rootRoute.addChildren([indexRoute, ...screenRoutes]),
        history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    return render(
        <QueryClientProvider client={client}>
            <RouterProvider router={router} />
        </QueryClientProvider>,
    );
}

const executivePayload = {
    day: '2026-11-08',
    postedToday: 12,
    kpi: {
        revenue: 4500,
        cogs: 1200,
        net: 3100,
        margin: 68.9,
        cash: 9800.5,
        openShifts: 2,
        negativeStock: 3,
    },
    series: [
        { day: '2026-11-06', revenue: 4000, cost: 1100, net: 2900 },
        { day: '2026-11-07', revenue: 4500, cost: 1200, net: 3100 },
    ],
    topDepts: [{ name: 'المطبخ', total: 3000 }],
    topItems: [{ name: 'شاورما', qty: 42, total: 1260 }],
    cash: [{ code: '1010', name: 'الصندوق', balance: 9800.5 }],
    alerts: [{ severity: 'high', title: 'إقفال متأخر', detail: 'آخر إقفال قبل يومين' }],
};

const pnlPayload = {
    period: { from: '2026-11-01', to: '2026-11-08' },
    statement: {
        revenue: { total: 5000, invoice_count: 10, manual_count: 2 },
        cogs: { net: 1200, dispatch: 1300, returns: 100 },
        net_profit: { amount: 3000, margin_pct: 60 },
        daily_series: [
            { date: '2026-11-06', revenue: 4000, cogs: 1000, opex: 500 },
            { date: '2026-11-07', revenue: 5000, cogs: 1200, opex: 600 },
        ],
        by_department: [{ name: 'المطبخ', revenue: 3000 }],
    },
};

beforeEach(() => {
    window.localStorage.clear();
    resetPageMetaForTests();
});

afterEach(() => {
    logout();
    window.localStorage.clear();
    cleanup();
    vi.unstubAllGlobals();
    resetPageMetaForTests();
});

describe('الصفحة الرئيسية', () => {
    it('ترحيب شخصي + 8 مؤشرات + رسوم + إجراءات سريعة حسب الدور', async () => {
        stubFetch((url) => {
            if (url.includes('/api/auth/login')) {
                return json(SESSION);
            }
            if (url.includes('/api/executive/summary')) {
                return json(executivePayload);
            }
            if (url.includes('/api/manager/briefing')) {
                return json({ cashiers: [], pos: {}, expenses: {}, cashiersTotal: {} });
            }
            if (url.includes('/api/pos/orders/stats/today')) {
                return json({ ok: true, orders_count: 10, total_sales: 900, avg_ticket: 90 });
            }
            if (url.includes('/api/finance/pnl')) {
                return json(pnlPayload);
            }
            if (url.includes('/api/revenues')) {
                return json({ data: [] });
            }
            if (url.includes('/api/expenses')) {
                return json({ data: [] });
            }
            if (url.includes('/api/settings/main_settings')) {
                return json({ currency: 'SAR' });
            }
            return null;
        });

        await login('admin', 'secret');
        renderHome();

        expect(await screen.findByText(/مرحبًا، سالم/)).toBeTruthy();
        expect(await screen.findByText(/إيراد اليوم/)).toBeTruthy();
        expect(screen.getAllByText(/الصافي/).length).toBeGreaterThan(0);
        expect(screen.getAllByText('4,500.00 SAR').length).toBeGreaterThan(0);
        expect(screen.getAllByText('أعلى من السابقة').length).toBeGreaterThan(0);

        // الرسوم: العنوان والجدول البديل يُعرضان دون انتظار حزمة Recharts.
        expect(screen.getByRole('heading', { name: /الإيراد مقابل التكلفة/ })).toBeTruthy();
        expect(screen.getAllByText('11-06').length).toBeGreaterThan(0);

        // إجراءات سريعة حسب دور admin.
        expect(screen.getByRole('link', { name: /المدير المالي/ })).toBeTruthy();
        expect(screen.getByText(/المصدر الأساسي: الموجز التنفيذي/)).toBeTruthy();

        // العنوان والأيقونة الديناميكيان.
        expect(document.title).toBe('الرئيسية — Karim ERP');
        const icon = document.head.querySelector('link[rel="icon"]');
        expect(icon?.getAttribute('href')?.startsWith('data:image/svg+xml')).toBe(true);
    });

    it('دور المحاسب: يسقط من الموجز التنفيذي إلى قائمة الدخل وموجز المدير', async () => {
        stubFetch((url) => {
            if (url.includes('/api/auth/login')) {
                return json({
                    ...SESSION,
                    user: { id: '2', name: 'هند', role: 'accountant', username: 'hend' },
                });
            }
            if (url.includes('/api/executive/summary')) {
                return json({ error: 'FORBIDDEN', message: 'صلاحية غير كافية' }, 403);
            }
            if (url.includes('/api/manager/briefing')) {
                return json({
                    cashiers: [{ department_name: 'المطبخ', total: 1200, count: 4 }],
                    pos: { total: 1200, count: 4 },
                    expenses: { total: 300 },
                    cashiersTotal: { total: 1200, count: 4 },
                });
            }
            if (url.includes('/api/pos/orders/stats/today')) {
                return json({ ok: true, orders_count: 4, total_sales: 1200, avg_ticket: 300 });
            }
            if (url.includes('/api/finance/pnl')) {
                return json(pnlPayload);
            }
            if (url.includes('/api/revenues')) {
                return json({ data: [{ id: '9', amount: '1200.50', date: '2026-11-08', source: 'pos' }] });
            }
            if (url.includes('/api/expenses')) {
                return json({ data: [{ id: '3', amount: '300.00', date: '2026-11-08', desc: 'كهرباء' }] });
            }
            if (url.includes('/api/settings/main_settings')) {
                return json({ currency: 'SAR' });
            }
            return null;
        });

        await login('hend', 'secret');
        renderHome();

        expect(await screen.findByText(/مرحبًا، هند/)).toBeTruthy();
        expect(await screen.findByText(/مبيعات اليوم/)).toBeTruthy();
        expect(screen.getAllByText(/صافي الربح/).length).toBeGreaterThan(0);
        expect(screen.getByText(/المصدر الأساسي: قائمة الدخل وموجز المدير/)).toBeTruthy();
        // رفض الموجز التنفيذي لهذا الدور متوقّع — لا يُعرض كعطل.
        expect(screen.queryByText(/تعذّر جلب بعض المصادر/)).toBeNull();
        // آخر النشاطات من سجلّي الإيراد والمصروف.
        expect(screen.getByText(/كهرباء/)).toBeTruthy();
        // إجراءات دور المحاسب.
        expect(screen.getByRole('link', { name: /الأرباح والخسائر/ })).toBeTruthy();
    });

    it('كل المصادر فاشلة ⇒ error مع إعادة المحاولة بلا أصفار كاذبة', async () => {
        stubFetch((url) => {
            if (url.includes('/api/auth/login')) {
                return json(SESSION);
            }
            return json({ error: 'UPSTREAM_FAILED', message: 'عطل مؤقت في القراءة' }, 500);
        });

        await login('admin', 'secret');
        renderHome();

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain('عطل مؤقت في القراءة');
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
        expect(screen.queryByText('إيراد اليوم')).toBeNull();
    });

    it('الإجراءات السريعة تُصفّى بالشاشات المفعّلة وبالدور', () => {
        expect(quickActionsForRole('accountant', new Set(['cfo', 'pnl']))).toEqual([
            { to: '/cfo', label: 'المدير المالي' },
            { to: '/pnl', label: 'الأرباح والخسائر' },
        ]);
        expect(quickActionsForRole('ghost-role', new Set(V3_SCREENS))).toHaveLength(6);
        expect(quickActionsForRole('accountant', new Set())).toEqual([]);
    });

    it('الإجراءات السريعة تحترم القوائم المسموحة (المنح والسحب) فوق شاشات الدور', () => {
        // كاشير: قوائمه الفعلية لا تشمل المالية/التقارير — لا إجراء يقود إلى رفض.
        const cashier = quickActionsForRole(
            'cashier',
            new Set(V3_SCREENS),
            ['dashboard', 'attendance', 'leaves', 'employee-portal', 'pos-entry'],
        );
        expect(cashier.map((action) => action.to)).toEqual([
            '/pos-entry',
            '/attendance',
            '/leaves',
            '/employee-portal',
        ]);
        // منحة إضافية تفتح إجراءً، والسحب يمنعه.
        expect(
            quickActionsForRole('accountant', new Set(V3_SCREENS), ['cfo', 'pnl', 'revenues']).map((a) => a.to),
        ).toEqual(['/cfo', '/pnl', '/revenues']);
        expect(
            quickActionsForRole('accountant', new Set(V3_SCREENS), ['cfo', 'revenues', 'expenses', 'cost-analysis']).map(
                (a) => a.to,
            ),
        ).toEqual(['/cfo', '/cost-analysis', '/revenues', '/expenses']);
    });

    it('accountant: لا يطلب مصادر admin-only (executive/briefing) فلا 403 متوقَّع في الطرفية', async () => {
        const calls: string[] = [];
        stubFetch((url) => {
            calls.push(url);
            if (url.includes('/api/auth/login')) {
                return json({
                    ...SESSION,
                    user: { id: '2', name: 'هند', role: 'accountant', username: 'hend' },
                });
            }
            if (url.includes('/api/pos/orders/stats/today')) {
                return json({ ok: true, orders_count: 1, total_sales: 10, avg_ticket: 10 });
            }
            if (url.includes('/api/finance/pnl')) {
                return json(pnlPayload);
            }
            if (url.includes('/api/revenues')) {
                return json({ data: [] });
            }
            if (url.includes('/api/expenses')) {
                return json({ data: [] });
            }
            if (url.includes('/api/settings/main_settings')) {
                return json({ currency: 'SAR' });
            }
            return null;
        });

        await login('hend', 'secret');
        renderHome();

        expect(await screen.findByText(/هند/)).toBeTruthy();
        expect(calls.some((url) => url.includes('/api/executive/summary'))).toBe(false);
        expect(calls.some((url) => url.includes('/api/manager/briefing'))).toBe(false);
    });
});
