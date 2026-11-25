import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { riyadhToday } from '../lib/finance';
import { riyadhDaysAgo } from '../lib/procurement';
import { ToastProvider } from '../ui/Toast';
import { Payments } from './Payments';

/**
 * الدفعات تأتي من الخادم مصفّاة بالفترة والمورد، والشاشة تجمع المعروض نصًّا
 * على المليم (ADR-04) وتسمّي طرق الدفع بقاموس القديم نفسه.
 */

const TODAY = riyadhToday();

const payments = [
    {
        id: '1',
        supplierId: '10',
        supplierName: 'مورد اللحوم',
        amount: 6795.75,
        method: 'cash',
        date: `${TODAY}T18:37:05.844Z`,
        invoiceId: '77',
        notes: 'دفعة فاتورة',
        createdBy: '12',
    },
    {
        id: '2',
        supplierId: null,
        supplierName: null,
        amount: 100.25,
        method: 'bank',
        date: TODAY,
        invoiceId: null,
        notes: null,
        createdBy: null,
    },
];

const suppliers = [
    { id: '10', name: 'مورد اللحوم', is_active: true },
    { id: '11', name: 'مورد الخضار', is_active: true },
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
            if (fail) {
                return json({ error: 'FAILED', message: 'تعذر جلب المدفوعات' }, 500);
            }
            const href = String(url);
            if (href.includes('/api/procurement/payments')) {
                return json(payments);
            }
            if (href.includes('/api/procurement/suppliers')) {
                return json(suppliers);
            }
            if (href.includes('/api/settings/main_settings')) {
                return json({ currency: 'SAR' });
            }
            return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
        }),
    );
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <Payments />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

function dataRows(): HTMLElement[] {
    return screen.getAllByRole('row').slice(1) as HTMLElement[];
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('مدفوعات الموردين', () => {
    it('يعرض الدفعات والمجموع ويحلّ اسم المورد', async () => {
        stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('مدفوعات الموردين');
        expect(dataRows()).toHaveLength(2);
        // 6795.75 + 100.25 = 6896.00 نصًّا على المليم.
        expect(screen.getByText(/6,896\.00/)).toBeTruthy();

        const table = screen.getByRole('table');
        const row = within(table).getByText('مورد اللحوم').closest('tr') as HTMLElement;
        expect(within(row).getByText('6,795.75', { exact: false })).toBeTruthy();
        expect(within(row).getByText('نقدي')).toBeTruthy();
        expect(within(row).getByText('#77')).toBeTruthy();
        expect(within(row).getByText('دفعة فاتورة')).toBeTruthy();

        // بلا اسم مورد ولا معرّف ⇒ «—».
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('يمرّر المورد والفترة إلى الخادم', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('المورد'), { target: { value: '10' } });

        await waitFor(() => {
            const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
            expect(calls.some((call) => String(call[0]).includes('/api/procurement/payments?supplierId=10'))).toBe(
                true,
            );
        });
    });

    it('يرفض فترة معكوسة قبل الطلب', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('من'), { target: { value: riyadhToday() } });
        fireEvent.change(screen.getByLabelText('إلى'), { target: { value: riyadhDaysAgo(5) } });

        await waitFor(() => {
            expect(screen.getByText(/بداية الفترة بعد نهايتها/)).toBeTruthy();
        });
        expect(screen.queryByRole('table')).toBeNull();
    });

    it('يعرض خطأً قابلًا لإعادة المحاولة', async () => {
        stubFetch(true);
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeTruthy();
        });
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});
