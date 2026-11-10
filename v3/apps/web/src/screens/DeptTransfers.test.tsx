import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstOfMonth, riyadhToday } from '../lib/finance';
import { ToastProvider } from '../ui/Toast';
import { DeptTransfers } from './DeptTransfers';

/**
 * السجل يعرض ما يعيده `/api/warehouse/dept-transfers`: أسماء الأقسام تُحل
 * من `/api/departments`، و`metadata.test` مخفي كما في القديم، والقيمة
 * كمية × تكلفة فعلية لكل بند.
 */

const transfers = [
    {
        id: 'a',
        transfer_number: 'TR-A',
        status: 'received',
        requested_by: 1,
        approved_by: 1,
        created_at: '2026-11-06T17:24:10.152Z',
        metadata: {
            mode: 'external_sale',
            sourceDeptCode: 'kitchen',
            destDeptCode: 'external_sales',
        },
        items: [{ inventory_id: 1, unit: 'piece', requested_qty: '2', received_qty: '2', unit_cost: '11.73' }],
    },
    {
        id: 'b',
        transfer_number: 'TR-B',
        status: 'rejected',
        requested_by: 2,
        approved_by: null,
        created_at: '2026-11-05T10:00:00.000Z',
        metadata: {
            mode: 'dept_transfer',
            sourceDeptCode: 'butcher',
            destDeptCode: 'kitchen',
            rejection_reason: 'كمية غير مطابقة',
        },
        items: [{ inventory_id: 2, unit: 'kg', requested_qty: '1.5', received_qty: null, unit_cost: '10.00' }],
    },
    {
        id: 'c',
        transfer_number: 'TR-C',
        status: 'received',
        requested_by: 1,
        approved_by: 1,
        created_at: '2026-11-04T09:00:00.000Z',
        metadata: { mode: 'external_sale', sourceDeptCode: 'kitchen', destDeptCode: 'CAF' },
        items: [{ inventory_id: 3, unit: 'باكت', requested_qty: '0.5', received_qty: '0.5', unit_cost: '20.44' }],
    },
    {
        id: 'd',
        transfer_number: 'TR-TEST',
        status: 'received',
        requested_by: 1,
        approved_by: 1,
        created_at: '2026-11-03T09:00:00.000Z',
        metadata: { mode: 'dept_transfer', sourceDeptCode: 'kitchen', destDeptCode: 'CAF', test: true },
        items: [{ inventory_id: 9, requested_qty: '1', received_qty: '1', unit_cost: '99.00' }],
    },
];

const departments = {
    data: [
        { code: 'kitchen', name: 'المطبخ' },
        { code: 'external_sales', name: 'قسم البيع الخارجي' },
        { code: 'butcher', name: 'قسم الجزار' },
        { code: 'CAF', name: 'كافيهshop' },
    ],
};

const summary = {
    from: firstOfMonth(),
    to: riyadhToday(),
    mode: 'all',
    totals: { transfers: 2, lines: 2, qty: 2.5, value: 33.68, sources: 1, destinations: 2 },
    bySource: [{ dept_code: 'kitchen', dept_name: 'المطبخ', transfers: 2, qty: '2.5', value: '33.68' }],
    byDest: [{ dept_code: 'external_sales', dept_name: 'قسم البيع الخارجي', transfers: 1, qty: '2', value: '23.46' }],
    topItems: [{ inventory_id: 1, item_name: 'دجاج', unit: 'piece', qty: '2', value: '23.46' }],
    daily: [{ day: riyadhToday(), transfers: 2, value: '33.68' }],
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
                return json({ error: 'FAILED', message: 'تعذر جلب التحويلات' }, 500);
            }
            if (String(url).includes('/api/warehouse/dept-transfers/summary')) {
                return json(summary);
            }
            if (String(url).includes('/api/warehouse/dept-transfers')) {
                return json(transfers);
            }
            if (String(url).includes('/api/departments')) {
                return json(departments);
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
                <DeptTransfers />
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
    vi.unstubAllGlobals();
});

describe('التحويلات الداخلية', () => {
    it('يعرض الصفوف بأسماء الأقسام ويخفي تحويلات التحقق الحي', async () => {
        stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('التحويلات الداخلية');
        expect(dataRows()).toHaveLength(3);
        expect(screen.queryByText('TR-TEST')).toBeNull();
        expect(summaryLine()).toContain('3 تحويلًا');
        expect(summaryLine()).toContain('منفَّذة 2');
        expect(summaryLine()).toContain('مرفوضة 1');
        expect(summaryLine()).toContain('إجمالي القيمة المنفَّذة 33.68');

        const external = screen.getByText('TR-A').closest('tr') as HTMLElement;
        expect(within(external).getByText('المطبخ')).toBeTruthy();
        expect(within(external).getByText('قسم البيع الخارجي')).toBeTruthy();
        expect(within(external).getByText('بيع خارجي')).toBeTruthy();
        expect(within(external).getByText('صنف #1')).toBeTruthy();
        expect(within(external).getByText('23.46')).toBeTruthy();
        expect(within(external).getByText('منفَّذ ومكتمل')).toBeTruthy();
        expect(within(external).getByText('#1')).toBeTruthy();

        const rejected = screen.getByText('TR-B').closest('tr') as HTMLElement;
        expect(within(rejected).getByText('مرفوض')).toBeTruthy();
        expect(within(rejected).getByText('كمية غير مطابقة')).toBeTruthy();
        expect(within(rejected).getByText('15.00')).toBeTruthy();

        expect(screen.getByText('لوحة التحويلات')).toBeTruthy();
        expect(screen.getByText('دجاج')).toBeTruthy();
        expect(screen.getByText('أعلى الأقسام المرسلة')).toBeTruthy();
    });

    it('يبحث في رقم الإذن والقسم والصنف', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'الجزار' } });
        await waitFor(() => {
            expect(dataRows()).toHaveLength(1);
        });
        expect(screen.getByText('TR-B')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'صنف #3' } });
        await waitFor(() => {
            expect(dataRows()).toHaveLength(1);
        });
        expect(screen.getByText('TR-C')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'غير موجود' } });
        await waitFor(() => {
            expect(screen.getByText('لا تحويلات مطابقة')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'مسح المرشّحات' }));
        await waitFor(() => {
            expect(dataRows()).toHaveLength(3);
        });
    });

    it('يصفّي بالحالة ويعدّ كل شريحة', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'مرفوض (1)' }));
        await waitFor(() => {
            expect(dataRows()).toHaveLength(1);
        });
        expect(screen.getByText('TR-B')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'منفَّذ ومكتمل (2)' }));
        await waitFor(() => {
            expect(dataRows()).toHaveLength(2);
        });
    });

    it('يرتّب بالقيمة صعودًا ثم هبوطًا', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'القيمة (تكلفة فعلية)' }));
        await waitFor(() => {
            expect(dataRows()[0]?.textContent).toContain('10.22');
        });
        expect(dataRows()[2]?.textContent).toContain('23.46');

        fireEvent.click(screen.getByRole('button', { name: 'القيمة (تكلفة فعلية)' }));
        await waitFor(() => {
            expect(dataRows()[0]?.textContent).toContain('23.46');
        });
    });

    it('يقرأ نافذة القديم والتواريخ من الخادم حرفًا', async () => {
        const urls = stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        const list = urls.find((url) => url.includes('/api/warehouse/dept-transfers?'));
        expect(list).toContain('limit=200');

        const summaryCall = urls.find((url) => url.includes('/dept-transfers/summary'));
        expect(summaryCall).toContain(`from=${firstOfMonth()}`);
        expect(summaryCall).toContain(`to=${riyadhToday()}`);

        expect(urls.some((url) => url.includes('/api/departments'))).toBe(true);
    });

    it('يعرض خطأً قابلًا لإعادة المحاولة', async () => {
        stubFetch(true);
        renderScreen();

        await waitFor(() => {
            expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
        });
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });

    it('حالة فارغة عند غياب التحويلات', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                if (String(url).includes('/api/warehouse/dept-transfers/summary')) {
                    return json(summary);
                }
                if (String(url).includes('/api/warehouse/dept-transfers')) {
                    return json([]);
                }
                if (String(url).includes('/api/departments')) {
                    return json(departments);
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );
        renderScreen();

        await waitFor(() => {
            expect(screen.getByText('لا تحويلات مسجلة')).toBeTruthy();
        });
        expect(screen.queryByRole('table')).toBeNull();
    });
});
