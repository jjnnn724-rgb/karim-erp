import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../ui/Toast';
import { PosReports } from './PosReports';

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function stubReports() {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/api/pos/departments')) {
            return jsonResponse([{ id: '2', name_ar: 'قسم البيع الخارجي' }]);
        }
        if (url.includes('/api/pos/reports/executive')) {
            return jsonResponse({
                from: '2026-11-14', to: '2026-11-14',
                previous: { from: '2026-11-13', to: '2026-11-13' },
                department_id: null,
                current: { invoices: 10, revenue: '1000.00', gross: '1000.00', vat: '150.00', discount: '0.00', cash: '400.00', card: '600.00', other: '0.00', average_ticket: '100.00' },
                previous_period: { invoices: 8, revenue: '800.00', gross: '800.00', vat: '120.00', discount: '0.00', cash: '300.00', card: '500.00', other: '0.00', average_ticket: '100.00' },
                daily: [{ day: '2026-11-14', invoices: 10, revenue: '1000.00' }],
                previous_daily: [{ day: '2026-11-13', invoices: 8, revenue: '800.00' }],
                by_department: [{ id: '2', name: 'قسم البيع الخارجي', legacy_code: 'external_sales', invoices: 10, revenue: '1000.00', share: 100 }],
                top_products: [{ code: '010403', name: 'ربع دجاج', qty: '10', revenue: '1000.00' }],
                payments: { cash: '400.00', card: '600.00', other: '0.00' },
            });
        }
        if (url.includes('/api/pos/reports/department')) {
            return jsonResponse({
                from: '2026-11-01', to: '2026-11-14',
                rows: [{ department_id: '2', code: 'erp_external_sales', name: 'قسم البيع الخارجي', legacy_code: 'external_sales', cashiers: ['4', '5'], invoices: 12, net: '300.00', total: '345.00', vat: '45.00', discount: '0.00', cash: '200.00', card: '145.00', other: '0.00', average_ticket: '28.75', accounting_revenue: '345.00', revenue_entries: 12 }],
                totals: { invoices: 12, net: '300.00', total: '345.00', vat: '45.00', discount: '0.00', cash: '200.00', card: '145.00', other: '0.00', average_ticket: '28.75' },
            });
        }
        if (url.includes('/api/pos/reports/product')) {
            return jsonResponse({
                from: '2026-11-01', to: '2026-11-14',
                rows: [{ code: '010403', name: 'ربع حبة دجاج مع الأرز', qty: '4', revenue: '34.80', vat: '4.54', discount: '0.00', invoices: 3, average_price: '8.70' }],
                daily: [],
                totals: { qty: '4', revenue: '34.80', vat: '4.54', discount: '0.00', invoices: 3, average_price: '8.70' },
            });
        }
        if (url.includes('/api/pos/reports/inventory')) {
            return jsonResponse({
                from: '2026-11-01', to: '2026-11-14',
                rows: [{ id: 'x', date: '2026-11-13', type: 'transfer_out', reference_type: 'dispatch_receipt', reason: 'صرف للمطبخ', item_id: '9', item_name: 'شوكة أسود', item_category: 'عام', unit: 'وحدة', quantity: '2', direction: 'out', unit_cost: '28.99', value: '57.98' }],
                totals: { in_qty: '0', out_qty: '2', in_value: '0.00', out_value: '57.98', movements: 1 },
            });
        }
        return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);
    return { calls, fetchMock };
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <PosReports />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

describe('مركز التقارير التنفيذي', () => {
    it('النظرة التنفيذية تعرض KPIs ومقارنة بالفترة السابقة', async () => {
        const { calls } = stubReports();
        renderScreen();

        await waitFor(() => {
            expect(screen.getByText('صافي الإيرادات')).toBeTruthy();
        });
        expect(screen.getByText('قسم البيع الخارجي')).toBeTruthy();
        expect(expect(screen.getAllByText(/\+25\.0%/).length).toBeGreaterThan(0)).toBeTruthy();
        expect(calls.some((url) => url.includes('/api/pos/reports/executive'))).toBe(true);
        expect(screen.getByRole('button', { name: /طباعة ورقة رسمية/ })).toBeTruthy();
    });

    it('التبديل لتبويب القسم يطلب من الخادم ويعرض الكاشيرين', async () => {
        const { calls } = stubReports();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByText('صافي الإيرادات')).toBeTruthy();
        });

        screen.getByRole('tab', { name: 'تقرير قسم' }).click();
        await waitFor(() => {
            expect(screen.getByText('كاشير 4، 5')).toBeTruthy();
        });
        expect(calls.some((url) => url.includes('/api/pos/reports/department'))).toBe(true);
    });

    it('التبديل لتقرير الصنف والمخزن يجلب من مساراته', async () => {
        const { calls } = stubReports();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByText('صافي الإيرادات')).toBeTruthy();
        });

        screen.getByRole('tab', { name: 'تقرير صنف' }).click();
        await waitFor(() => {
            expect(screen.getByText('ربع حبة دجاج مع الأرز')).toBeTruthy();
        });
        expect(calls.some((url) => url.includes('/api/pos/reports/product'))).toBe(true);

        screen.getByRole('tab', { name: 'تقرير المخزن' }).click();
        await waitFor(() => {
            expect(screen.getByText('شوكة أسود')).toBeTruthy();
        });
        expect(calls.some((url) => url.includes('/api/pos/reports/inventory'))).toBe(true);
    });
});
