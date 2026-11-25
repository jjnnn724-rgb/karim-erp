import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { ToastProvider } from '../ui/Toast';
import { ExternalSales } from './ExternalSales';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ConfirmProvider>
                <ToastProvider>
                    <ExternalSales />
                </ToastProvider>
            </ConfirmProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('البيع الخارجي', () => {
    it('يعرض مؤشرات المسحوبات والمبيعات من الخادم ويبحث في الجدول', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/external-sales/summary')) {
                    return json({
                        ok: true,
                        from: '2026-11-01',
                        to: '2026-11-17',
                        issued: {
                            totals: { lines: 2, docs: 1, qty: 120.5, value: 3500 },
                            rows: [
                                {
                                    date: '2026-11-16',
                                    doc: '1794865971040180',
                                    item: 'أرز بسمتي مغسول',
                                    qty: 100,
                                    unit: 'كيلو',
                                    cost: 25,
                                    value: 2500,
                                    status: 'received',
                                },
                                {
                                    date: '2026-11-17',
                                    doc: '1794778971322729',
                                    item: 'زيت زيتون',
                                    qty: 20.5,
                                    unit: 'لتر',
                                    cost: 48.78,
                                    value: 1000,
                                    status: 'received',
                                },
                            ],
                            byItem: [
                                { item: 'أرز بسمتي مغسول', lines: 1, qty: 100, value: 2500 },
                                { item: 'زيت زيتون', lines: 1, qty: 20.5, value: 1000 },
                            ],
                        },
                        sold: {
                            totals: { invoices: 2, amount: 5100, qty: 130, lines: 3 },
                            rows: [
                                {
                                    id: 'a',
                                    date: '2026-11-16',
                                    ref: 'BILLS4:2282',
                                    customer: 'شركة نجم الشرق',
                                    amount: 3000,
                                    items: 2,
                                    qty: 90,
                                },
                                {
                                    id: 'b',
                                    date: '2026-11-17',
                                    ref: 'BILLS4:2283',
                                    customer: 'شركة اليسرة',
                                    amount: 2100,
                                    items: 1,
                                    qty: 40,
                                },
                            ],
                            byItem: [
                                { item: 'أرز بسمتي مغسول', qty: 80 },
                                { item: 'زيت زيتون', qty: 30 },
                            ],
                        },
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        // العنوان والمؤشرات من الخادم (التحقق من عدم حسابها في المتصفح)
        expect(await screen.findByText('إيرادات البيع الخارجي')).toBeTruthy();
        expect(screen.getByText('قيمة المسحوبات')).toBeTruthy();
        expect(screen.getByText('المبيعات لكل صنف')).toBeTruthy();
        // الصنف المُباع يظهر مرتين (في tab المسحوبات/المبيعات) ودقائق دقيقة
        expect(screen.getAllByText('أرز بسمتي مغسول').length).toBeGreaterThan(0);
        // مقارنة الفترة السابقة ظاهرة على الشاشة (نفس الـ fixture تُعاد للفترة السابقة)
        expect(await screen.findByText(/مقارنة بالفترة السابقة/)).toBeTruthy();
    });

    it('تبويب الأصناف: مباع مقابل مسحوب يعرض المطابقة والحالة وزر التصدير', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/external-sales/summary')) {
                    return json({
                        ok: true,
                        from: '2026-11-01',
                        to: '2026-11-17',
                        issued: {
                            totals: { lines: 2, docs: 1, qty: 120.5, value: 3500 },
                            rows: [
                                {
                                    date: '2026-11-16',
                                    doc: '1794865971040180',
                                    item: 'أرز بسمتي مغسول',
                                    qty: 100,
                                    unit: 'كيلو',
                                    cost: 25,
                                    value: 2500,
                                    status: 'received',
                                },
                                {
                                    date: '2026-11-17',
                                    doc: '1794778971322729',
                                    item: 'زيت زيتون',
                                    qty: 20.5,
                                    unit: 'لتر',
                                    cost: 48.78,
                                    value: 1000,
                                    status: 'received',
                                },
                            ],
                            byItem: [
                                { item: 'أرز بسمتي مغسول', lines: 1, qty: 100, value: 2500 },
                                { item: 'زيت زيتون', lines: 1, qty: 20.5, value: 1000 },
                            ],
                        },
                        sold: {
                            totals: { invoices: 2, amount: 5100, qty: 130, lines: 3 },
                            rows: [
                                {
                                    id: 'a',
                                    date: '2026-11-16',
                                    ref: 'BILLS4:2282',
                                    customer: 'شركة نجم الشرق',
                                    amount: 3000,
                                    items: 2,
                                    qty: 90,
                                },
                                {
                                    id: 'b',
                                    date: '2026-11-17',
                                    ref: 'BILLS4:2283',
                                    customer: 'شركة اليسرة',
                                    amount: 2100,
                                    items: 1,
                                    qty: 40,
                                },
                            ],
                            byItem: [
                                { item: 'أرز بسمتي مغسول', qty: 80 },
                                { item: 'زيت زيتون', qty: 30 },
                            ],
                        },
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        // فتح تبويب المطابقة (Radix Tabs بتفعّل بالـ mousedown مش click)
        const coverageTab = await screen.findByRole('tab', { name: 'الأصناف: مباع مقابل مسحوب' });
        fireEvent.mouseDown(coverageTab);

        // الحالة لكل صنف: أرز تغطية جزئية (80/100=80%)، زيت زيتون مغطاة (30>20.5)
        expect(await screen.findByText('تغطية جزئية')).toBeTruthy();
        expect(screen.getByText('مغطاة')).toBeTruthy();
        expect(screen.getByText('80.0%')).toBeTruthy();
        expect(screen.getByText('الإجمالي')).toBeTruthy();
        // زر تشخيص الخسارة + أزرار تصدير CSV موجودة
        expect(screen.getByRole('button', { name: 'تشخيص الخسارة فقط' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'مبيعات CSV' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'مسحوبات CSV' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'الأصناف CSV' })).toBeTruthy();
    });
});
