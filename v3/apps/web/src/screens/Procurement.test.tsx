import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { Procurement } from './Procurement';

/**
 * الدليل يعرض ما يعيده الخادم: KPI من `/summary` والموردون من `/suppliers`
 * بمجاميعهم كما هي (نصوص NUMERIC). الترشيح والبحث عميلان على الدليل المحمّل.
 */

const summary = {
    activeSuppliers: 2,
    totalSuppliers: 3,
    purchasesTotal: 10000.5,
    paymentsTotal: 7500.25,
    dueTotal: 2500.25,
    unpaidInvoices: 1,
    invoicesRemaining: 2500.25,
};

const suppliers = [
    {
        id: '10',
        name: 'مورد اللحوم',
        name_en: 'Meat Co',
        phone: '0550000000',
        category: 'لحوم',
        vat_number: '300000000000003',
        tax_registration_status: 'REGISTERED',
        purchasesTotal: 6000.5,
        paymentsTotal: 5000,
        dueTotal: 1000.5,
        lastPurchaseDate: '2026-11-05',
        is_active: true,
    },
    {
        id: '11',
        name: 'مورد الخضار',
        phone: null,
        category: 'خضار',
        tax_registration_status: 'NOT_REGISTERED',
        purchasesTotal: 4000,
        paymentsTotal: 2500.25,
        dueTotal: 1499.75,
        lastPurchaseDate: '2026-11-03',
        is_active: false,
    },
    {
        id: '12',
        name: 'مورد جاف',
        phone: null,
        category: 'بقوليات',
        tax_registration_status: 'NOT_REGISTERED',
        purchasesTotal: 0,
        paymentsTotal: 0,
        dueTotal: 0,
        lastPurchaseDate: null,
        is_active: true,
    },
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
                return json({ error: 'FAILED', message: 'تعذر جلب الموردين' }, 500);
            }
            const href = String(url);
            if (href.includes('/api/procurement/summary')) {
                return json(summary);
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
                <Procurement />
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

describe('دليل الموردين', () => {
    it('يعرض KPI الخادم والدليل بمجاميعه', async () => {
        stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('الموردون');
        expect(screen.getByText('2 / 3')).toBeTruthy();
        expect(screen.getByText('10,000.50 SAR')).toBeTruthy();
        expect(screen.getByText('7,500.25 SAR')).toBeTruthy();
        expect(screen.getByText('1 فاتورة غير مدفوعة')).toBeTruthy();

        expect(dataRows()).toHaveLength(3);
        const row = screen.getByText('مورد اللحوم').closest('tr') as HTMLElement;
        expect(within(row).getByText('6,000.50')).toBeTruthy();
        expect(within(row).getByText('1,000.50')).toBeTruthy();
        expect(within(row).getByText('VAT 300000000000003')).toBeTruthy();
        expect(within(row).getByText('نشط')).toBeTruthy();
    });

    it('يترشّح بالحالة الضريبية وبالحالة ثم يبحث بالاسم', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('الحالة الضريبية'), { target: { value: 'REGISTERED' } });
        await waitFor(() => {
            expect(dataRows()).toHaveLength(1);
        });
        expect(screen.getByText('مورد اللحوم')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('الحالة الضريبية'), { target: { value: 'ALL' } });
        fireEvent.change(screen.getByLabelText('الحالة'), { target: { value: 'inactive' } });
        await waitFor(() => {
            expect(dataRows()).toHaveLength(1);
        });
        expect(screen.getByText('مورد الخضار')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('الحالة'), { target: { value: 'ALL' } });
        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'جاف' } });
        await waitFor(() => {
            expect(dataRows()).toHaveLength(1);
        });
        expect(screen.getByText('مورد جاف')).toBeTruthy();
    });

    it('يعرض الفراغ حين لا يطابق البحث شيئًا', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'لا-يوجد' } });

        await waitFor(() => {
            expect(screen.getByText('لا موردون')).toBeTruthy();
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
