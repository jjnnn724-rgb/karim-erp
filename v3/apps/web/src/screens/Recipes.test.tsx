import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { Recipes } from './Recipes';

/**
 * شاشة الوصفات تقرأ `/api/recipes` وكatalog الكاشير ودليل الأقسام —
 * نسبة التكلفة نقاط مئوية (24.00 ⇒ 24.0٪)، وفشل الكتالوج لا يُسقط السجل.
 */

const recipes = [
    {
        id: 1,
        name: 'كبسة لحم',
        deptId: 'external_sales',
        sellingPrice: '20.00',
        totalCost: '0.00',
        costRatio: '0.00',
    },
    {
        id: 2,
        name: 'كفتة',
        deptId: 'kitchen',
        sellingPrice: '50.00',
        totalCost: '12.00',
        costRatio: '24.00',
    },
];

const catalog = [
    {
        recipe_id: 1,
        name: 'كبسة لحم',
        sellingPrice: '20.00',
        totalCost: '0.00',
        costRatio: '0.00',
        product_id: 11,
        image_url: '/uploads/meat.png',
        ingredient_count: 3,
    },
];

const departments = [
    { code: 'external_sales', name: 'قسم البيع الخارجي' },
    { code: 'kitchen', name: 'المطبخ' },
];

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(options: { fail?: boolean; catalogFails?: boolean } = {}): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            const target = String(url);
            urls.push(target);
            if (target.includes('/api/pos/recipes/catalog')) {
                return options.catalogFails ? json({ error: 'FORBIDDEN', message: 'لا صلاحية لكتالوج الكاشير' }, 403) : json(catalog);
            }
            if (target.includes('/api/recipes?')) {
                return options.fail
                    ? json({ error: 'FAILED', message: 'تعذّر جلب الوصفات' }, 500)
                    : json({ data: recipes, pagination: { page: 1, limit: 1000, total: 2, totalPages: 1 } });
            }
            if (target.includes('/api/departments')) {
                return json({ data: departments });
            }
            if (target.includes('/api/settings/main_settings')) {
                return json({ currency: 'SAR' });
            }
            return json({ error: 'NOT_FOUND', message: target }, 404);
        }),
    );
    return urls;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <Recipes />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

function bodyRows(): HTMLElement[] {
    return screen.getAllByRole('row').slice(1) as HTMLElement[];
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('الوصفات', () => {
    it('يعرض الاسم والقسم والسعر والتكلفة والنسبة والمكوّنات والربط', async () => {
        stubFetch();
        renderScreen();
        expect(await screen.findByText('كبسة لحم')).toBeTruthy();
        expect(screen.getByText('كفتة')).toBeTruthy();
        const table = within(screen.getByRole('table'));
        expect(table.getByText('قسم البيع الخارجي')).toBeTruthy();
        expect(table.getByText('المطبخ')).toBeTruthy();
        expect(screen.getAllByText(/20\.00/).length).toBeGreaterThan(0);
        expect(screen.getAllByText('SAR').length).toBeGreaterThan(1);
        expect(screen.getByText('24.0%')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
        expect(table.getByText('مرتبط')).toBeTruthy();
        expect(table.getByText('بدون')).toBeTruthy();
        expect(screen.getByText('2 وصفة · العرض: SAR')).toBeTruthy();
        expect(bodyRows()).toHaveLength(2);
    });

    it('يطلب الوصفات تصاعديًا والكتالوج والأقسام والعملة — نفس عقد القديم', async () => {
        const urls = stubFetch();
        renderScreen();
        await screen.findByText('كبسة لحم');
        expect(urls.some((url) => url.includes('/api/recipes?page=1&limit=1000&sort=id&order=asc'))).toBe(true);
        expect(urls.some((url) => url.includes('/api/pos/recipes/catalog'))).toBe(true);
        expect(urls.some((url) => url.includes('/api/departments'))).toBe(true);
        expect(urls.some((url) => url.includes('/api/settings/main_settings'))).toBe(true);
    });

    it('يرشّح بالقسم وبربط POS', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('كبسة لحم');

        fireEvent.change(screen.getByLabelText('القسم'), { target: { value: 'kitchen' } });
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });
        expect(bodyRows()[0]?.textContent).toContain('كفتة');

        fireEvent.click(screen.getByRole('button', { name: 'مسح المرشّحات' }));
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(2);
        });

        fireEvent.click(screen.getByRole('button', { name: 'بدون' }));
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });
        expect(bodyRows()[0]?.textContent).toContain('كفتة');
    });

    it('يبحث بتطبيع الحروف العربية ويعلن التطبيع', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('كبسة لحم');

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'كبسه' } });
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });
        expect(bodyRows()[0]?.textContent).toContain('كبسة لحم');
        expect(screen.getByText('بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.')).toBeTruthy();
    });

    it('فشل كتالوج الكاشير لا يُسقط السجل — تُعرض الوصفات بلا مكوّنات', async () => {
        stubFetch({ catalogFails: true });
        renderScreen();
        expect(await screen.findByText('كبسة لحم')).toBeTruthy();
        expect(bodyRows()).toHaveLength(2);
        expect(within(screen.getByRole('table')).getAllByText('بدون')).toHaveLength(2);
        expect(screen.queryAllByRole('alert')).toHaveLength(0);
        expect(screen.getByText('2 وصفة · العرض: SAR')).toBeTruthy();
    });

    it('يرتّب بسعر البيع تصاعديًا ثم تنازليًا', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('كبسة لحم');

        fireEvent.click(screen.getByRole('button', { name: 'سعر البيع' }));
        await waitFor(() => {
            expect(bodyRows()[0]?.textContent).toContain('20.00');
        });
        fireEvent.click(screen.getByRole('button', { name: 'سعر البيع' }));
        await waitFor(() => {
            expect(bodyRows()[0]?.textContent).toContain('50.00');
        });
    });

    it('يعرض خطأ الجلب مع إعادة المحاولة', async () => {
        stubFetch({ fail: true });
        renderScreen();
        await waitFor(() => {
            expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
        });
        expect(screen.getByText('تعذّر جلب البيانات')).toBeTruthy();
        expect(screen.getByText('تعذّر جلب الوصفات')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});
