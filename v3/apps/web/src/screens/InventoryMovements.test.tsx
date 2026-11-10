import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { InventoryMovements } from './InventoryMovements';

/**
 * الحركات تُعرض كما يعيدها `/api/inventoryTx`: نوع معروف بترجمته، ونوع
 * مجهول بشارة «افتتاحي» مع القيمة الخام — نفس قاعدة القديم حرفيًا.
 */

const movements = {
    data: [
        {
            id: 1,
            itemName: 'لحم بقري',
            type: 'in',
            date: '2026-11-03',
            qty: '12.500',
            cost: '80',
            totalValue: '1000',
            invoiceNumber: 'INV-9',
        },
        {
            id: 2,
            itemName: 'لحم بقري',
            type: 'out',
            date: '2026-11-04',
            qty: '3',
            cost: '80',
            totalValue: '250.50',
            dispatchId: 44,
        },
        {
            id: 3,
            itemName: 'دقيق',
            type: 'return',
            date: '2026-11-05',
            qty: '2',
            cost: '5',
            totalValue: '10',
            notes: 'مرتجع مطبخ',
        },
        {
            id: 4,
            itemName: 'زيت',
            type: 'opening',
            date: '2026-11-01',
            qty: '7',
            cost: '20',
            totalValue: '140',
            notes: null,
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

function stubFetch(fail = false): void {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            if (fail) {
                return json({ error: 'FAILED', message: 'تعذر جلب الحركات' }, 500);
            }
            if (String(url).includes('/api/inventoryTx')) {
                return json(movements);
            }
            if (String(url).includes('/api/settings/main_settings')) {
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
                <InventoryMovements />
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

describe('حركات المخزون', () => {
    it('يعرض الوارد والصادر والصافي ويترجم الأنواع', async () => {
        stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('حركات المخزون');
        expect(screen.getByText('1,000.00 SAR')).toBeTruthy();
        expect(screen.getByText('250.50 SAR')).toBeTruthy();
        expect(screen.getByText('749.50 SAR')).toBeTruthy();

        expect(dataRows()).toHaveLength(4);
        const incoming = screen.getAllByText('لحم بقري')[0]?.closest('tr') as HTMLElement;
        expect(within(incoming).getByText('وارد')).toBeTruthy();
        expect(within(incoming).getByText('12.5')).toBeTruthy();
        expect(within(incoming).getByText('INV-9')).toBeTruthy();

        const unknown = screen.getByText('زيت').closest('tr') as HTMLElement;
        expect(within(unknown).getByText(/افتتاحي/)).toBeTruthy();
        expect(within(unknown).getByText(/\(opening\)/)).toBeTruthy();
    });

    it('يترشّح بالنوع ويبحث بالصنف أو المرجع', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('النوع'), { target: { value: 'out' } });
        await waitFor(() => {
            expect(dataRows()).toHaveLength(1);
        });
        expect(screen.getByText('44')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('النوع'), { target: { value: 'ALL' } });
        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'دقيق' } });
        await waitFor(() => {
            expect(dataRows()).toHaveLength(1);
        });
        expect(screen.getByText('مرتجع مطبخ')).toBeTruthy();
    });

    it('يرفض فترة معكوسة قبل العرض', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('من'), { target: { value: '2026-11-30' } });
        fireEvent.change(screen.getByLabelText('إلى'), { target: { value: '2026-11-01' } });

        await waitFor(() => {
            expect(screen.getByRole('alert').textContent).toContain('بداية الفترة بعد نهايتها');
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
