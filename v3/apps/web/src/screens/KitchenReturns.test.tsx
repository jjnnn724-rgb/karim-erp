import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { riyadhToday } from '../lib/finance';
import { ToastProvider } from '../ui/Toast';
import { KitchenReturns } from './KitchenReturns';

const authMock = vi.hoisted(() => ({ role: 'accountant' }));
vi.mock('../lib/auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/auth')>()),
    useAuthState: () => ({ user: { id: '1', username: 'test', role: authMock.role, dept_code: 'K01' } }),
}));

/**
 * السجل يعرض ما يعيده `/api/kitchenReturns`: ملخص الأصناف كما في القديم
 * (`name (qty)` مفصولة بفاصلة عربية)، والسبب أو الملاحظات، والقيمة نصًّا.
 */

const today = riyadhToday();

const returns = {
    data: [
        {
            id: 9002,
            date: today,
            deptCode: 'K01',
            deptName: 'المطبخ الرئيسي',
            dispatchId: 501,
            items: [
                { itemName: 'دجاج', qty: '2' },
                { name: 'أرز', qty: '1.5' },
            ],
            reason: 'فائض إنتاج',
            notes: 'إرجاع نهاية الوردية',
            totalValue: '31.26',
            status: 'approved',
            createdBy: 7,
        },
        {
            id: 9001,
            date: today,
            deptCode: 'K02',
            deptName: 'المخبز',
            dispatchId: null,
            items: [{ name: 'خبز', qty: '3' }],
            reason: '',
            notes: 'تلف',
            totalValue: '10.00',
            status: 'approved',
            createdBy: 7,
        },
        {
            id: 9000,
            date: '2026-10-31',
            deptCode: 'K01',
            deptName: 'المطبخ الرئيسي',
            dispatchId: 480,
            items: [{ itemName: 'لحم', qty: '1' }],
            reason: 'خطأ في الصرف',
            notes: null,
            totalValue: '20.50',
            status: 'approved',
            createdBy: 8,
        },
    ],
    pagination: { totalPages: 1 },
};

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
                return json({ error: 'FAILED', message: 'تعذر جلب المرتجعات' }, 500);
            }
            if (String(url).includes('/api/kitchenReturns')) {
                return json(returns);
            }
            if (String(url).includes('/api/settings/main_settings')) {
                return json({ currency: 'SAR' });
            }
            return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
        }),
    );
    return urls;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <KitchenReturns />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

function dataRows(): HTMLElement[] {
    return screen.getAllByRole('row').slice(1) as HTMLElement[];
}

function summaryLine(): string {
    return screen.getByRole('status').textContent ?? '';
}

afterEach(() => {
    authMock.role = 'accountant';
    vi.unstubAllGlobals();
});

describe('مرتجعات المطبخ', () => {
    it('يعرض الصفوف وملخص الأصناف والسبب/الملاحظات والمجاميع', async () => {
        stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('مرتجعات المطبخ');
        expect(summaryLine()).toContain('3 مرتجعًا');
        expect(summaryLine()).toContain('قيمة نشطة 61.76 SAR');
        expect(summaryLine()).toContain('الشهر الحالي (أصل 8,000 الأحدث)');
        expect(dataRows()).toHaveLength(3);

        const linked = screen.getByText('#9002').closest('tr') as HTMLElement;
        expect(within(linked).getByText('المطبخ الرئيسي')).toBeTruthy();
        expect(within(linked).getByText('#501')).toBeTruthy();
        expect(within(linked).getByText('دجاج (2)، أرز (1.5)')).toBeTruthy();
        expect(within(linked).getByText('فائض إنتاج')).toBeTruthy();
        expect(within(linked).getByText('31.26')).toBeTruthy();

        // بلا سبب ⇒ ملاحظات القديم تظهر مكانه (:673)
        const direct = screen.getByText('#9001').closest('tr') as HTMLElement;
        expect(within(direct).getByText('—')).toBeTruthy();
        expect(within(direct).getByText('تلف')).toBeTruthy();

        const linkedKpi = screen.getByText('1 إرجاع مباشر').parentElement as HTMLElement;
        expect(within(linkedKpi).getByText('2')).toBeTruthy();
    });

    it('يربط المرتجع بإذن صرف ويحفظ الكميات والكراتين', async () => {
        authMock.role = 'admin';
        const posted: Record<string, unknown>[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init?: RequestInit) => {
                const target = String(url);
                if (target.includes('/api/kitchenReturns')) return json(returns);
                if (target.includes('/api/settings/main_settings')) return json({ currency: 'SAR' });
                if (target.includes('/api/departments')) {
                    return json({ data: [{ code: 'K01', name: 'المطبخ الرئيسي' }], pagination: { totalPages: 1 } });
                }
                if (target.includes('/api/dispatches')) {
                    return json({
                        data: [
                            {
                                id: 501,
                                date: today,
                                deptCode: 'K01',
                                deptName: 'المطبخ الرئيسي',
                                status: 'partially_received',
                                items: [{ itemName: 'دجاج', qty: 2 }],
                                approvedItems: [
                                    { itemName: 'دجاج', approvedQty: 2, packagingQty: 4, unit: 'kg' },
                                ],
                            },
                        ],
                        pagination: { totalPages: 1 },
                    });
                }
                if (target.includes('/api/warehouse/returns') && init?.method === 'POST') {
                    posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
                    return json({ return: { id: 9010 } });
                }
                return json({ error: 'NOT_FOUND' }, 404);
            }),
        );
        renderScreen();
        await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'مرتجع جديد' }));

        const linkedButton = screen.getByRole('button', { name: 'مرتبط بإذن صرف' });
        await waitFor(() => expect((linkedButton as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(linkedButton);
        expect(screen.queryByLabelText('قسم الإرجاع')).toBeNull();
        expect(screen.getByLabelText('إذن الصرف')).toBeTruthy();
        expect(screen.getByLabelText('اسم الصنف').getAttribute('list')).toBe('erp-return-dispatch-items');

        fireEvent.change(screen.getByLabelText('اسم الصنف'), { target: { value: 'دجاج' } });
        fireEvent.change(screen.getByLabelText('الكمية'), { target: { value: '0.5' } });
        fireEvent.change(screen.getByLabelText('كراتين (اختياري)'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText(/سبب الإرجاع/), { target: { value: 'فائض وردية' } });
        fireEvent.click(screen.getByRole('button', { name: 'إضافة الصنف' }));
        fireEvent.click(screen.getByRole('button', { name: 'حفظ المرتجع' }));

        await waitFor(() => expect(posted).toHaveLength(1));
        expect(posted[0]).toMatchObject({
            dispatchId: 501,
            reason: 'فائض وردية',
            items: [{ name: 'دجاج', qty: 0.5, packagingQty: 1, packagingUom: 'كرتون' }],
        });
    });

    it('يعرض المبطل محفوظًا ويستبعده من القيمة النشطة', async () => {
        const body = {
            data: [
                returns.data[0],
                { ...returns.data[1], id: 9003, status: 'voided', voidedAt: `${today}T12:00:00.000Z` },
            ],
            pagination: { totalPages: 1 },
        };
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                if (String(url).includes('/api/kitchenReturns')) return json(body);
                if (String(url).includes('/api/settings/main_settings')) return json({ currency: 'SAR' });
                return json({ error: 'NOT_FOUND' }, 404);
            }),
        );
        renderScreen();
        await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());

        const voided = screen.getByText('#9003').closest('tr') as HTMLElement;
        expect(within(voided).getByText('مبطل')).toBeTruthy();
        expect(summaryLine()).toContain('قيمة نشطة 31.26 SAR');
        expect(screen.queryByRole('button', { name: 'إبطال' })).toBeNull();
    });

    it('يبحث في القسم والصنف والسبب', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'خبز' } });
        await waitFor(() => {
            expect(dataRows()).toHaveLength(1);
        });
        expect(summaryLine()).toContain('نتائج «خبز»');

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'المطبخ الرئيسي' } });
        await waitFor(() => {
            expect(dataRows()).toHaveLength(2);
        });

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'خطأ في الصرف' } });
        await waitFor(() => {
            expect(dataRows()).toHaveLength(1);
        });

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'غير موجود' } });
        await waitFor(() => {
            expect(screen.getByText('لا مرتجع يطابق البحث')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'مسح المرشّحات' }));
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });
    });

    it('يرتّب بالقيمة صعودًا ثم هبوطًا', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'القيمة' }));
        await waitFor(() => {
            expect(dataRows()[0]?.textContent).toContain('10.00');
        });
        expect(dataRows()[2]?.textContent).toContain('31.26');

        fireEvent.click(screen.getByRole('button', { name: 'القيمة' }));
        await waitFor(() => {
            expect(dataRows()[0]?.textContent).toContain('31.26');
        });
    });

    it('يقرأ الشهر الحالي من الخادم حرفًا كما في القديم', async () => {
        const urls = stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });
        const call = urls.find((url) => url.includes('/api/kitchenReturns'));
        expect(call).toContain('v2_period=month');
        expect(call).toContain('limit=1000');
        expect(call).toContain('order=desc');
    });

    it('يعرض خطأً قابلًا لإعادة المحاولة', async () => {
        stubFetch(true);
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeTruthy();
        });
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });

    it('حالة فارغة عند غياب مرتجعات الشهر', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                if (String(url).includes('/api/kitchenReturns')) {
                    return json({ data: [], pagination: { totalPages: 1 } });
                }
                if (String(url).includes('/api/settings/main_settings')) {
                    return json({ currency: 'SAR' });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );
        renderScreen();

        await waitFor(() => {
            expect(screen.getByText('لا مرتجعات مسجلة هذا الشهر')).toBeTruthy();
        });
        expect(screen.queryByRole('table')).toBeNull();
    });
});
