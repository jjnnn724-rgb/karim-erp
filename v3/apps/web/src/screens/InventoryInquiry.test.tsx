import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rangeProblem } from '../lib/reporting';
import { ToastProvider } from '../ui/Toast';
import { InventoryInquiry } from './InventoryInquiry';

/**
 * jsdom بلا تخطيط: نحاكي ارتفاع منطقة تمرير DataTable وحدها (520px) كي
 * يُختبر مسار التمرير الافتراضي لجدول الأصناف فعلًا — نفس نهج Payroll.test.tsx.
 */
Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
        return this.getAttribute('data-testid') === 'datatable' ? 520 : 0;
    },
});

const ITEMS_REGION = 'جدول أصناف المخزون — حركة الدخول والانصراف والمبيع';

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
        // الاسم يظهر في الجدول وبطاقة الجوال معًا — ننتظر ظهوره في أيهما.
        expect((await screen.findAllByText('دجاج')).length).toBeGreaterThan(0);
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
                            {
                                date: '2026-11-05',
                                type: 'purchase',
                                referenceId: 9102,
                                delta: 10,
                                runningQty: 12,
                                location: 'المخزن',
                            },
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

        // زر الاسم في الجدول (وبطاقة الجوال نسخة أخرى) — نضغط الأول.
        fireEvent.click((await screen.findAllByText('دجاج'))[0] as HTMLElement);

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
                            'Content-Disposition':
                                'attachment; filename="inventory-inquiry_2026-10-09_2026-11-07.xlsx"',
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
        await screen.findAllByText('دجاج');
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

    it('جدول الأصناف فوق العتبة: تمرير افتراضي يرسم جزءًا ويحفظ العدّ الكامل', async () => {
        const rows = Array.from({ length: 200 }, (_, index) => ({
            itemId: index + 1,
            itemName: `صنف ${String(index + 1).padStart(3, '0')}`,
            category: 'تصنيف',
            onHand: index,
            qtyInPurchases: index * 2,
            qtyOutTotal: index,
            soldPos: 0,
            soldYara: 0,
            stockValue: index * 10,
        }));
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/inventory-inquiry/items')) {
                    return json({ rows, totals: { items: 200, stockValue: 199000 } });
                }
                if (url.includes('/api/inventory-inquiry/departments')) {
                    return json({ rows: [], totals: {} });
                }
                return json({ error: 'NOT_FOUND' }, 404);
            }),
        );

        renderScreen();

        const region = await screen.findByRole('region', { name: ITEMS_REGION });
        await within(region).findAllByText('صنف 001');
        expect(region.getAttribute('data-virtualized')).toBe('true');
        expect(region.getAttribute('data-row-count')).toBe('200');
        expect(within(region).getByRole('table').getAttribute('aria-rowcount')).toBe('201');
        const rendered = within(region).getAllByTestId('datatable-row');
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(200);
        expect(rendered[0]?.getAttribute('aria-rowindex')).toBe('2');
    });

    it('أثناء التحميل: المؤشرات تحجز مكانها والرؤوس الحقيقية ظاهرة (CLS)', () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => new Promise<Response>(() => {})),
        );

        renderScreen();

        // شبكة المؤشرات موجودة من أول رسم بهيكل عظمي — لا تُدرَج بعد البيانات.
        const kpis = screen.getByRole('list', { name: 'إجماليات المحرك' });
        expect(kpis.querySelectorAll('li')).toHaveLength(4);
        expect(kpis.querySelectorAll('[aria-busy="true"]')).toHaveLength(4);
        const region = screen.getByRole('region', { name: ITEMS_REGION });
        expect(region.getAttribute('data-state')).toBe('loading');
        expect(within(region).getByRole('table').getAttribute('aria-busy')).toBe('true');
        expect(within(region).getByRole('columnheader', { name: 'الصنف' })).toBeTruthy();
        expect(within(region).getByRole('columnheader', { name: 'مبيع المرآة' })).toBeTruthy();
        expect(within(region).getByRole('status').textContent).toContain('جارٍ تحميل البيانات');
        // الأقسام أيضًا هيكل عظمي لا «لا أقسام» كاذبة أثناء التحميل.
        expect(screen.getByText('جارٍ تحميل تكلفة الأقسام…')).toBeTruthy();
        expect(screen.queryByText('لا أقسام في هذا المدى')).toBeNull();
    });

    it('حالة error: تنبيه داخل الجدول وإعادة المحاولة تعيد الجلب', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url.includes('/api/inventory-inquiry/items')) {
                return json({ error: 'SERVER', message: 'تعذّر تجميع الحركة' }, 500);
            }
            if (url.includes('/api/inventory-inquiry/departments')) {
                return json({ rows: [], totals: {} });
            }
            return json({ error: 'NOT_FOUND' }, 404);
        });
        vi.stubGlobal('fetch', fetchMock);

        renderScreen();

        const region = await screen.findByRole('region', { name: ITEMS_REGION });
        await waitFor(() => {
            expect(region.getAttribute('data-state')).toBe('error');
        });
        expect(within(region).getByRole('alert')).toBeTruthy();
        const before = fetchMock.mock.calls.length;
        fireEvent.click(within(region).getByRole('button', { name: 'إعادة المحاولة' }));
        await waitFor(() => {
            expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
        });
    });

    it('حالة empty: عنوان وتلميح مع بقاء الرؤوس', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/inventory-inquiry/items')) {
                    return json({ rows: [], totals: { items: 0 } });
                }
                if (url.includes('/api/inventory-inquiry/departments')) {
                    return json({ rows: [], totals: {} });
                }
                return json({ error: 'NOT_FOUND' }, 404);
            }),
        );

        renderScreen();

        const region = await screen.findByRole('region', { name: ITEMS_REGION });
        await waitFor(() => {
            expect(region.getAttribute('data-state')).toBe('empty');
        });
        expect(within(region).getByText('لا أصناف تطابق المرشّحات')).toBeTruthy();
        expect(within(region).getByText('وسّع المدى أو امسح البحث.')).toBeTruthy();
        expect(within(region).getByRole('columnheader', { name: 'الصنف' })).toBeTruthy();
    });

    it('اختيار صنف يظلّل صفّه ويعلن aria-pressed ثم يفتح البطاقة', async () => {
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
                    return json({ item: { id: 11, name: 'دجاج', qty: 12 }, cardex: [] });
                }
                if (url.includes('/api/inventory-inquiry/departments')) {
                    return json({ rows: [], totals: {} });
                }
                return json({ error: 'NOT_FOUND' }, 404);
            }),
        );

        renderScreen();

        const region = await screen.findByRole('region', { name: ITEMS_REGION });
        const button = await within(region).findByRole('button', { name: 'دجاج' });
        expect(button.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(button);
        expect(button.getAttribute('aria-pressed')).toBe('true');
        const row = within(region).getAllByTestId('datatable-row')[0];
        expect(row?.className).toContain('bg-surface-hover');
        expect(await screen.findByText('بطاقة الصنف')).toBeTruthy();
    });

    it('المدى المقلوب يعلن الخطأ ويعرض حالة فارغة بإرشاد التصحيح', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/inventory-inquiry/departments')) {
                    return json({ rows: [], totals: {} });
                }
                return json({ rows: [], totals: {} });
            }),
        );

        renderScreen();

        // ننتظر انتهاء الجلب الأول — زر «عرض» معطّل أثناءه.
        await waitFor(() => {
            expect(screen.getByTestId('range-apply')).not.toBeDisabled();
        });
        fireEvent.change(screen.getByTestId('range-from'), { target: { value: '2026-11-10' } });
        fireEvent.change(screen.getByTestId('range-to'), { target: { value: '2026-11-01' } });
        fireEvent.click(screen.getByTestId('range-apply'));

        expect(await screen.findByRole('alert')).toBeTruthy();
        const region = screen.getByRole('region', { name: ITEMS_REGION });
        expect(region.getAttribute('data-state')).toBe('empty');
        expect(within(region).getByText('صحّح المدى الزمني أولًا.')).toBeTruthy();
    });
});
