import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rangeProblem } from '../lib/reporting';
import { ToastProvider } from '../ui/Toast';
import { InventoryInquiry } from './InventoryInquiry';

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
            <ToastProvider>
                <InventoryInquiry />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('محرك استعلامات المخزون', () => {
    it('يرفض التواريخ غير الموجودة بالتقويم ويقبل اليوم الكبيس الصحيح', () => {
        expect(rangeProblem('2026-02-31', '2026-03-02')).toContain('YYYY-MM-DD');
        expect(rangeProblem('2025-02-29', '2025-03-02')).toContain('YYYY-MM-DD');
        expect(rangeProblem('2024-02-29', '2024-03-02')).toBe('');
    });

    it('يعرض الإجماليات والأصناف وتكلفة الأقسام', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/inventory-inquiry/items')) {
                    return json({
                        rows: [
                            {
                                itemId: 11,
                                itemName: 'دجاج',
                                category: 'لحوم',
                                unit: 'كجم',
                                onHand: 12,
                                qtyInPurchases: 40,
                                qtyOutTotal: 28,
                                soldPos: 0,
                                soldYara: 0,
                                stockValue: 960,
                                nearestExpiry: '2026-11-10',
                                yaraMatched: true,
                            },
                        ],
                        totals: {
                            items: 1,
                            stockValue: 960,
                            qtyInPurchases: 40,
                            qtyOutTotal: 28,
                            purchaseCost: 3200,
                            outCost: 2240,
                            qtySoldPos: 0,
                            revenuePos: 0,
                        },
                    });
                }
                if (url.includes('/api/inventory-inquiry/departments')) {
                    return json({
                        rows: [
                            {
                                code: 'KITCHEN',
                                name: 'المطبخ',
                                issuedQty: 28,
                                issuedCost: 2240,
                                expenseOperating: 300,
                                costTotal: 2540,
                                revenuePos: 5000,
                            },
                        ],
                        totals: { departments: 1, costTotal: 2540 },
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('محرك الاستعلامات')).toBeTruthy();
        expect(await screen.findByText('دجاج')).toBeTruthy();
        expect(screen.getAllByText('المطبخ').length).toBeGreaterThan(0);
        expect(screen.getAllByText('2,540.00 SAR').length).toBeGreaterThan(0);
        expect(screen.getAllByText('960.00 SAR').length).toBeGreaterThan(0);
    });

    it('يفتح بطاقة الصنف عند اختياره', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/inventory-inquiry/items')) {
                    return json({
                        rows: [{ itemId: 11, itemName: 'دجاج', onHand: 12, stockValue: 960 }],
                        totals: { items: 1, stockValue: 960 },
                    });
                }
                if (url.includes('/api/inventory-inquiry/item/11')) {
                    return json({
                        item: { id: 11, name: 'دجاج', qty: 12, minQty: 5, avgCost: 80, stockValue: 960 },
                        cardex: [
                            // referenceId رقمي كما يُعيده بعض محوّلات JSON — العقد يقبله.
                            { date: '2026-11-05', type: 'purchase', referenceId: 9102, delta: 10, runningQty: 12, location: 'المخزن' },
                        ],
                        departments: [{ deptCode: 'KITCHEN', deptName: 'المطبخ', qty: 4, cost: 320 }],
                        purchases: { qty: 40, cost: 3200, invoices: [{ invoiceNumber: 'INV-9', qty: 10 }] },
                        batches: [{ expiryDate: '2026-11-10', qty: 6, expired: false }],
                        sales: { pos: 2, net: 180, orders: 1, lines: [] },
                    });
                }
                if (url.includes('/api/inventory-inquiry/departments')) {
                    return json({ rows: [], totals: {} });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        fireEvent.click(await screen.findByText('دجاج'));

        expect(await screen.findByText('Cardex')).toBeTruthy();
        expect(screen.getByText('INV-9')).toBeTruthy();
        expect(screen.getByText(/منتهية|سليمة|خلال/)).toBeTruthy();
    });

    it('يصدّر Excel من الخادم بنفس المرشّحات واسم الملف', async () => {
        const exportUrls: string[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/inventory-inquiry/export')) {
                    exportUrls.push(url);
                    return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
                        status: 200,
                        headers: {
                            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                            'Content-Disposition': 'attachment; filename="inventory-inquiry_2026-10-09_2026-11-07.xlsx"',
                        },
                    });
                }
                if (url.includes('/api/inventory-inquiry/items')) {
                    return json({ rows: [{ itemId: 11, itemName: 'دجاج', onHand: 2 }], totals: { items: 1 } });
                }
                if (url.includes('/api/inventory-inquiry/departments')) {
                    return json({ rows: [], totals: {} });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );
        const createObjectURL = vi.fn(() => 'blob:invoice');
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        renderScreen();

        // الزر معطّل حتى تصل صفوف الجدول — ننتظرها قبل النقر.
        await screen.findByText('دجاج');
        fireEvent.click(screen.getByRole('button', { name: 'تصدير Excel' }));

        await waitFor(() => {
            expect(exportUrls).toHaveLength(1);
        });
        expect(exportUrls[0]).toContain('/api/inventory-inquiry/export');
        expect(exportUrls[0]).toContain('only=all');
        expect(exportUrls[0]).toContain('sort=movements');
        expect(exportUrls[0]).toContain('limit=200');
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(click).toHaveBeenCalledTimes(1);
        expect(await screen.findByText('تم تصدير الملف')).toBeTruthy();
        click.mockRestore();
    });
});
