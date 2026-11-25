import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { VegRequests } from './VegRequests';

vi.mock('../lib/auth', () => ({
    getAppKey: () => null,
    getAccessToken: () => 'test-token',
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'الشيف', role: 'sous_chef', username: 'chef' },
    }),
}));

/**
 * تدفق V3 للخضار يطابق عقود الخادم: قائمة الطلبات، كتالوج الفئات،
 * والإنشاء من الأصناف الأساسية بكميات ووحدات يحددها المستخدم.
 */

const requests = [
    {
        id: 17905,
        request_no: 'VR-20261025-17905',
        created_by_name: 'فاروق عبد احمد',
        priority: 'urgent',
        status: 'pending',
        items_count: 6,
        total: null,
        created_at: '2026-10-25T09:52:55.890Z',
    },
    {
        id: 17907,
        request_no: 'VR-20261105-17907',
        created_by_name: 'مدير النظام',
        priority: 'normal',
        status: 'received',
        items_count: 6,
        total: '1250.50',
        created_at: '2026-11-05T21:39:42.035Z',
    },
];

const summary = { pending: 1, pending_today: 0, today: 1 };

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(fail = false): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            urls.push(String(url));
            if (fail) {
                return json({ error: 'FAILED', message: 'تعذّر جلب طلبات الخضار' }, 500);
            }
            if (url.includes('/api/settings/main_settings')) {
                return json({ currency: 'SAR' });
            }
            const rows = url.includes('status=received')
                ? requests.filter((request) => request.status === 'received')
                : requests;
            return json({ ok: true, requests: rows, summary });
        }),
    );
    return urls;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <VegRequests />
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

describe('طلبات شراء الخضار', () => {
    it('يعرض الملخص وأرقام الطلبات والحالات والإجمالي بعملة الإعدادات', async () => {
        stubFetch();
        renderScreen();
        expect(await screen.findByText('VR-20261025-17905')).toBeTruthy();
        expect(screen.getByText('VR-20261105-17907')).toBeTruthy();
        expect(screen.getByText('فاروق عبد احمد')).toBeTruthy();
        expect(screen.getByText('عاجل')).toBeTruthy();
        expect(screen.getByText('عادي')).toBeTruthy();
        expect(screen.getByText('بانتظار المعالجة')).toBeTruthy();
        expect(screen.getByText('تم الاستلام')).toBeTruthy();
        expect(screen.getByText('1,250.50')).toBeTruthy();
        expect(screen.getByText('SAR')).toBeTruthy();
        expect(screen.getByText('معلقة 1 · معلقة اليوم 0 · طلبات اليوم 1')).toBeTruthy();
        expect(screen.getByText('2 طلبًا محمّلًا')).toBeTruthy();
    });

    it('يطلب السقف 200 دائمًا، ويرسل status=match عند ترشيح الحالة', async () => {
        const urls = stubFetch();
        renderScreen();
        await screen.findByText('VR-20261025-17905');
        expect(urls.some((url) => url.includes('/api/veg-requests?limit=200'))).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'مستلم' }));
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });
        expect(bodyRows()[0]?.textContent).toContain('VR-20261105-17907');
        expect(urls.some((url) => url.includes('status=received'))).toBe(true);
    });

    it('يبحث بتطبيع الحروف العربية ويعلن التطبيع', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('VR-20261025-17905');

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'أحمد' } });
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });
        expect(bodyRows()[0]?.textContent).toContain('VR-20261025-17905');
        expect(screen.getByText('بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.')).toBeTruthy();
    });

    it('بلا نتائج يعرض حالة فارغة، ومسح المرشّحات يعيد السجل', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('VR-20261025-17905');

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'zzz' } });
        await waitFor(() => {
            expect(screen.getByText('لا طلبات تطابق المرشّحات')).toBeTruthy();
        });
        fireEvent.click(screen.getByRole('button', { name: 'مسح المرشّحات' }));
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(2);
        });
    });

    it('يرتّب برقم الطلب تصاعديًا ثم تنازليًا', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('VR-20261025-17905');

        fireEvent.click(screen.getByRole('button', { name: 'رقم الطلب' }));
        await waitFor(() => {
            expect(bodyRows()[0]?.textContent).toContain('VR-20261025-17905');
        });
        fireEvent.click(screen.getByRole('button', { name: 'رقم الطلب' }));
        await waitFor(() => {
            expect(bodyRows()[0]?.textContent).toContain('VR-20261105-17907');
        });
    });

    it('يعرض خطأ الجلب مع إعادة المحاولة', async () => {
        stubFetch(true);
        renderScreen();
        await waitFor(() => {
            expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
        });
        expect(screen.getByText('تعذّر جلب البيانات')).toBeTruthy();
        expect(screen.getByText('تعذّر جلب طلبات الخضار')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });

    it('يرتّب السجل ويعلن اتجاه الفرز دلاليًا', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('VR-20261025-17905');

        fireEvent.click(screen.getByRole('button', { name: 'رقم الطلب' }));
        expect(screen.getByRole('columnheader', { name: 'رقم الطلب' })).toHaveAttribute('aria-sort', 'ascending');
        fireEvent.click(screen.getByRole('button', { name: 'رقم الطلب' }));
        expect(screen.getByRole('columnheader', { name: 'رقم الطلب' })).toHaveAttribute('aria-sort', 'descending');
    });

    it('ينشئ طلبًا من القائمة الأساسية بكميات ووحدات يختارها المستخدم فقط', async () => {
        const submitted: Record<string, unknown>[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init?: RequestInit) => {
                if (url.includes('/api/settings/main_settings')) return json({ currency: 'SAR' });
                if (url.includes('/api/veg-requests') && init?.method === 'POST') {
                    submitted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
                    return json({ id: 17920 });
                }
                if (url.includes('/api/veg-requests/catalog')) {
                    return json({
                        categories: [
                            {
                                key: 'main',
                                label: 'الأصناف الرئيسية',
                                items: [
                                    { name: 'طماطم', unit: 'كجم' },
                                    { name: 'كرنب أبيض', unit: 'كيس' },
                                    { name: 'زنجبيل', unit: 'كرتونة' },
                                ],
                            },
                        ],
                        units: ['كجم', 'كيس', 'كرتونة'],
                    });
                }
                return json({ ok: true, requests, summary });
            }),
        );
        renderScreen();
        await screen.findByText('VR-20261025-17905');
        fireEvent.click(screen.getByRole('button', { name: 'طلب جديد' }));

        expect(await screen.findByRole('combobox', { name: 'القسم' })).toHaveTextContent('الأصناف الرئيسية');
        expect(screen.getByRole('combobox', { name: 'وحدة كرنب أبيض' })).toHaveTextContent('كيس');
        expect(screen.getByRole('combobox', { name: 'وحدة زنجبيل' })).toHaveTextContent('كرتونة');
        expect(screen.queryByLabelText('كمية بطاطس')).toBeNull();
        expect(screen.queryByLabelText('كمية ملوخية')).toBeNull();

        fireEvent.change(screen.getByLabelText('كمية طماطم'), { target: { value: '3.5' } });
        fireEvent.change(screen.getByLabelText('كمية كرنب أبيض'), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('combobox', { name: 'وحدة كرنب أبيض' }));
        fireEvent.click(screen.getByRole('option', { name: 'كجم' }));
        const addButtons = screen.getAllByRole('button', { name: 'إضافة' });
        const [tomatoAddButton, cabbageAddButton] = addButtons;
        if (!tomatoAddButton || !cabbageAddButton) {
            throw new Error('Expected add buttons for the first two catalog items.');
        }
        fireEvent.click(tomatoAddButton);
        fireEvent.click(cabbageAddButton);
        fireEvent.click(screen.getByRole('button', { name: 'إرسال الطلب' }));

        await waitFor(() => {
            expect(submitted).toHaveLength(1);
        });
        expect(submitted[0]?.items).toEqual([
            { name: 'طماطم', qty: 3.5, unit: 'كجم', note: '' },
            { name: 'كرنب أبيض', qty: 2, unit: 'كجم', note: '' },
        ]);
        expect(submitted[0]?.priority).toBe('normal');
    });
});
