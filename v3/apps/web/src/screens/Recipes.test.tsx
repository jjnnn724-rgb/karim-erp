import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { Recipes } from './Recipes';

/**
 * شاشة الوصفات تقرأ `/api/recipes` وكatalog الكاشير ودليل الأقسام —
 * نسبة التكلفة نقاط مئوية (24.00 ⇒ 24.0٪)، وفشل الكتالوج لا يُسقط السجل.
 * والكتابة (إنشاء/تعديل/حذف) على جدول `recipes` بحقول الخادم:
 * `name/deptId/sellingPrice/totalCost` — لا snake_case ولا `active`.
 */

const mocks = vi.hoisted(() => ({ role: 'admin' }));

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'مستخدم اختبار', username: 'test', role: mocks.role },
    }),
}));

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

type RecordedCall = { url: string; method: string; body: Record<string, unknown> };

function stubFetch(options: { fail?: boolean; catalogFails?: boolean } = {}): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
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
            if (target === '/api/recipes' && init?.method === 'POST') {
                return json({ id: 9 }, 201);
            }
            return json({ error: 'NOT_FOUND', message: target }, 404);
        }),
    );
    return urls;
}

/** يعترض الكتابة ويسجّل حمولتها كما أرسلها النموذج. */
function stubFetchRecordingWrites(): RecordedCall[] {
    const calls: RecordedCall[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
            const target = String(url);
            if (target.includes('/api/pos/recipes/catalog')) {
                return json(catalog);
            }
            if (target.includes('/api/recipes?')) {
                return json({ data: recipes, pagination: { page: 1, limit: 1000, total: 2, totalPages: 1 } });
            }
            if (target.includes('/api/departments')) {
                return json({ data: departments });
            }
            if (target.includes('/api/settings/main_settings')) {
                return json({ currency: 'SAR' });
            }
            if (target.startsWith('/api/recipes')) {
                calls.push({
                    url: target,
                    method: init?.method ?? 'GET',
                    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {},
                });
                return json({ id: 9 }, 201);
            }
            return json({ error: 'NOT_FOUND', message: target }, 404);
        }),
    );
    return calls;
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

        fireEvent.change(screen.getByLabelText(/^القسم/), { target: { value: 'kitchen' } });
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

describe('الوصفات — الكتابة بحقول الخادم', () => {
    it('الإنشاء يرسل name/deptId/sellingPrice/totalCost لا snake_case', async () => {
        const calls = stubFetchRecordingWrites();
        renderScreen();
        await screen.findByText('كبسة لحم');

        fireEvent.click(screen.getByRole('button', { name: 'إضافة وصفة' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/^اسم الوصفة/), { target: { value: '  كبسة لحم  ' } });
        fireEvent.change(within(dialog).getByLabelText(/^سعر البيع/), { target: { value: '45' } });
        fireEvent.change(within(dialog).getByLabelText(/^التكلفة/), { target: { value: '30' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'إضافة الوصفة' }));

        await waitFor(() => {
            expect(calls.some((call) => call.method === 'POST')).toBe(true);
        });
        const post = calls.find((call) => call.method === 'POST');
        expect(post?.url).toBe('/api/recipes');
        expect(post?.body).toEqual({ name: 'كبسة لحم', deptId: null, sellingPrice: 45, totalCost: 30 });
    });

    it('لا حقل active ولا costRatio ولا حقول snake_case في الحمولة', async () => {
        const calls = stubFetchRecordingWrites();
        renderScreen();
        await screen.findByText('كبسة لحم');

        fireEvent.click(screen.getByRole('button', { name: 'إضافة وصفة' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/^اسم الوصفة/), { target: { value: 'كفتة' } });
        fireEvent.change(within(dialog).getByLabelText(/^سعر البيع/), { target: { value: '50' } });
        fireEvent.change(within(dialog).getByLabelText(/^التكلفة/), { target: { value: '12' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'إضافة الوصفة' }));

        await waitFor(() => {
            expect(calls.some((call) => call.method === 'POST')).toBe(true);
        });
        const body = calls.find((call) => call.method === 'POST')?.body ?? {};
        expect(body).not.toHaveProperty('active');
        expect(body).not.toHaveProperty('costRatio');
        expect(body).not.toHaveProperty('selling_price');
        expect(body).not.toHaveProperty('total_cost');
        expect(body).not.toHaveProperty('department_code');
    });

    it('التعديل يرسل PUT بالحقول المرسَلة فقط', async () => {
        const calls = stubFetchRecordingWrites();
        renderScreen();
        await screen.findByText('كبسة لحم');

        fireEvent.click(screen.getAllByRole('button', { name: 'تعديل' })[0] as HTMLElement);
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/^سعر البيع/), { target: { value: '55' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ التعديل' }));

        await waitFor(() => {
            expect(calls.some((call) => call.method === 'PUT')).toBe(true);
        });
        const put = calls.find((call) => call.method === 'PUT');
        expect(put?.url).toBe('/api/recipes/1');
        expect(put?.body).toEqual({
            name: 'كبسة لحم',
            deptId: 'external_sales',
            sellingPrice: 55,
            totalCost: 0,
        });
    });
});
