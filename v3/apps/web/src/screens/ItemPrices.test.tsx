import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { ItemPrices } from './ItemPrices';

/**
 * أسعار الأصناف — بترجع `avgCost` كما هي من `/api/warehouse/inventory/search`
 * (بيتحدث أوتوماتيك من فواتير/استلامات الشراء بالمتوسط المرجح) وتعرض القيمة
 * = الكمية × التكلفة. الاختبار يعمل stub للـfetch فقط.
 */

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'مدير المخزن', username: 'test', role: 'warehouse' },
    }),
}));

const items = [
    { id: 1, name: 'فراخ أبيض', category: 'طيور', unit: 'كرتونة', qty: '10', avgCost: '80.00', minQty: '2' },
    { id: 2, name: 'رز عنتر', category: 'بقالة', unit: 'شيكارة', qty: '5', avgCost: '650.50', minQty: '1' },
    { id: 3, name: 'ليمون', category: 'خضار', unit: 'كيلو', qty: '30', avgCost: '0', minQty: '5' },
];

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(fail = false): void {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            const target = String(url);
            if (fail) {
                return json({ error: 'FAILED', message: 'تعذر الاتصال بالخادم' }, 500);
            }
            if (target.includes('/api/settings/main_settings')) {
                return json({ currency: 'SAR' });
            }
            if (target.includes('/api/warehouse/inventory/search')) {
                const params = new URL(target, 'http://local').searchParams;
                const q = params.get('q') ?? '';
                const category = params.get('category') ?? 'all';
                const data = items.filter((item) => {
                    if (q && !item.name.includes(q)) {
                        return false;
                    }
                    if (category !== 'all' && item.category !== category) {
                        return false;
                    }
                    return true;
                });
                return json({
                    data,
                    pagination: { page: 1, limit: 200, total: data.length, pages: 1 },
                    categories: [...new Set(items.map((item) => item.category))].sort(),
                    fuzzy: false,
                });
            }
            return json({ error: 'NOT_FOUND', message: 'غير موجود' }, 404);
        }),
    );
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <ItemPrices />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('أسعار الأصناف', () => {
    it('يعرض متوسط التكلفة وقيمة المخزون المحسوبة من المشتريات', async () => {
        stubFetch();
        renderScreen();

        expect(await screen.findByText('فراخ أبيض')).toBeTruthy();
        expect(screen.getAllByText('80.00').length).toBeGreaterThan(0);
        // قيمة المخزون الكلية: 800.00 + 3,252.50 = 4,052.50 (KPI + tfoot)
        expect(screen.getAllByText('4,052.50').length).toBeGreaterThan(0);
        expect(screen.getAllByText('رز عنتر').length).toBeGreaterThan(0);
    });

    it('يعلّم الأصناف بدون تكلفة بشارة تحذيرية', async () => {
        stubFetch();
        renderScreen();

        await screen.findByText('ليمون');
        expect(screen.getAllByText('بدون تكلفة').length).toBeGreaterThan(0);
    });

    it('يعرض حالة الخطأ مع زر إعادة المحاولة عند فشل التحميل', async () => {
        stubFetch(true);
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeTruthy();
        });
        expect(screen.getByText('إعادة المحاولة')).toBeTruthy();
    });
});
