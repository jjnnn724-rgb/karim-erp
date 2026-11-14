import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../ui/Toast';
import { PosReports } from './PosReports';

/**
 * مركز التقارير — اختبار العقد الظاهر:
 *  • ثلاثة تبويبات (قسم/صنف/مخزن) وبيانات من الخادم.
 *  • لا أرقام محلية: كل ما يظهر من ردّ /api/pos/reports/*.
 *  • زر «طباعة ورقة رسمية» موجود (المستند الرسمي يُفتح في نافذة طباعة).
 */

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
        if (url.includes('/api/pos/reports/department')) {
            return jsonResponse({
                from: '2026-11-01',
                to: '2026-11-14',
                rows: [{
                    department_id: '2', code: 'erp_external_sales', name: 'قسم البيع الخارجي', legacy_code: 'external_sales',
                    cashiers: ['4', '5'], invoices: 12, net: '300.00', total: '345.00', vat: '45.00', discount: '0.00',
                    cash: '200.00', card: '145.00', other: '0.00', average_ticket: '28.75', accounting_revenue: '345.00', revenue_entries: 12,
                }],
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

describe('مركز التقارير', () => {
    it('يعرض تقرير القسم بأرقام الخادم واسم الكاشيرين', async () => {
        const { calls } = stubReports();
        renderScreen();

        await waitFor(() => {
            expect(screen.getAllByText('قسم البيع الخارجي').length).toBeGreaterThan(0);
        });
        expect(screen.getByText('كاشير 4، 5')).toBeTruthy();
        expect(screen.getAllByText('345.00').length).toBeGreaterThan(0);
        expect(calls.some((url) => url.includes('/api/pos/reports/department'))).toBe(true);
        // زر الطباعة الرسمي موجود
        expect(screen.getByRole('button', { name: /طباعة ورقة رسمية/ })).toBeTruthy();
    });

    it('التبديل لتقرير الصنف والمخزن يجلب من مساراته', async () => {
        const { calls } = stubReports();
        renderScreen();
        await waitFor(() => {
            expect(screen.getAllByText('قسم البيع الخارجي').length).toBeGreaterThan(0);
        });

        const productTab = screen.getByRole('tab', { name: 'تقرير صنف' });
        productTab.click();
        await waitFor(() => {
            expect(screen.getByText('ربع حبة دجاج مع الأرز')).toBeTruthy();
        });
        expect(calls.some((url) => url.includes('/api/pos/reports/product'))).toBe(true);

        const inventoryTab = screen.getByRole('tab', { name: 'تقرير المخزن' });
        inventoryTab.click();
        await waitFor(() => {
            expect(screen.getByText('شوكة أسود')).toBeTruthy();
        });
        expect(calls.some((url) => url.includes('/api/pos/reports/inventory'))).toBe(true);
    });
});
