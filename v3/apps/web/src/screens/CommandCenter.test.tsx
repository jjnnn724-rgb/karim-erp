import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { CommandCenter } from './CommandCenter';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rootRoute = createRootRoute();
    const commandCenterRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/command-center',
        component: CommandCenter,
    });
    const router = createRouter({
        routeTree: rootRoute.addChildren([commandCenterRoute]),
        history: createMemoryHistory({ initialEntries: ['/command-center'] }),
    });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <RouterProvider router={router} />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

const vatReport = {
    from: '2026-10-01',
    to: '2026-10-31',
    output_vat: 100,
    output_vat_reversals: 0,
    input_vat: 40,
    input_vat_adjustments: 0,
    net_payable: 60,
    carry_forward_credit: 0,
    payable_balance: 100,
    recoverable_balance: 40,
    unclassified_vat_movements: { output_debits: 0, input_credits: 0 },
    purchases_crosscheck: { count: 2, net: 200, vat: 40 },
    sales_source_counts: { unposted_sales: 0, unposted_voids: 0 },
    filing_period_validation: { frequency: 'monthly', matches_frequency: true },
    taxpayer_profile: { seller_name: 'منشأة', vat_number: '1', number_configured: true, registration_verified: true },
    opening_balances: { as_of: '2026-09-30', payable: 0, recoverable: 0 },
    filing_readiness: { status: 'blocked', can_file: false, blockers: [{ code: 'x', message: 'مانع اختبار' }] },
};

const wpsReadiness = {
    month: '2026-10',
    summary: {
        month: '2026-10',
        employees: 2,
        ready: 2,
        missing_id: 0,
        missing_salary: 0,
        missing_iban: 0,
        unknown_nationality: 0,
        missing_payroll_line: 0,
        posted: true,
        employer_identifier: true,
    },
    blockers: [],
    export_ready: true,
    employees: [],
};

const bankRec = {
    account: '1010',
    from: '2026-10-01',
    to: '2026-10-31',
    book: 5000,
    statement: 5000,
    diff: 0,
    unmatched: [],
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('مركز القيادة الموحّد', () => {
    it('يعرض الالتزام والمؤشرات والتحذيرات من بيانات النظام', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/accounting/vat-return')) {
                    return json(vatReport);
                }
                if (url.includes('/api/employees')) {
                    return json([
                        { id: '1', name: 'أحمد', status: 'active', salary: '1000' },
                        { id: '2', name: 'سارة', status: 'active', salary: '2000' },
                    ]);
                }
                if (url.includes('/api/attendance/range')) {
                    return json({ data: [], total: 0 });
                }
                if (url.includes('/api/integration/wps/readiness')) {
                    return json(wpsReadiness);
                }
                if (url.includes('/api/accounting/bank-rec')) {
                    return json(bankRec);
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('الالتزام العام')).toBeTruthy();
        expect(await screen.findByText('صافي الضريبة المستحقة')).toBeTruthy();
        expect(await screen.findByText('مانع اختبار')).toBeTruthy();
        // المصدر المنقول للرواتب: كشف الرواتب يضم موظفين نشطين.
        expect(await screen.findByText('2 موظفًا نشطًا في الشهر')).toBeTruthy();
    });
});
