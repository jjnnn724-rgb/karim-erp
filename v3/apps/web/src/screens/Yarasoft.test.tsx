import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { ToastProvider } from '../ui/Toast';
import { Yarasoft } from './Yarasoft';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

const SNAPSHOT = {
    from: '2026-11-01',
    to: '2026-11-30',
    dept: null,
    total: '1500.50',
    entries: 4,
    invoices: 3,
    cashiers: [
        {
            deptCode: 'ys_cc_1',
            displayAr: 'كاشير 1',
            displayEn: 'Cashier 1',
            source: 'كاشير 1',
            total: '1000.00',
            entries: 2,
            invoices: 2,
        },
        {
            deptCode: 'ys_cc_4',
            displayAr: 'كاشير 4',
            displayEn: 'Cashier 4',
            source: 'كاشير 4',
            total: '500.50',
            entries: 2,
            invoices: 1,
        },
    ],
    byDay: [
        { date: '2026-11-07', total: '1500.50', entries: 4 },
        { date: '2026-11-06', total: '0.00', entries: 0 },
    ],
};

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <ConfirmProvider>
                    <Yarasoft />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
}

function openRevenuesTab() {
    fireEvent.click(screen.getByTestId('yarasoft-tab-revenues'));
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('شاشة يارسوفت', () => {
    it('تبدأ بتبويب التكامل وتعرض تبويب الإيرادات المحلية', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404)),
        );

        renderScreen();

        expect(screen.getByTestId('yarasoft-tab-integration').getAttribute('aria-selected')).toBe('true');
        expect(await screen.findByRole('tablist', { name: 'أقسام تكامل قاعدة الكاشير' })).toBeTruthy();
        expect(screen.getByTestId('yarasoft-tab-revenues').textContent).toContain('الإيرادات المحلية');
    });
});

describe('الإيرادات المحلية', () => {
    it('يقرأ اللقطة من الخادم ويعرض الكاشير والإجمالي', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/cashier-revenues')) {
                    return json(SNAPSHOT);
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();
        openRevenuesTab();

        expect(await screen.findByText('إيرادات الكاشير')).toBeTruthy();
        // العنوان ثابت قبل وصول البيانات؛ ننتظر الصف نفسه لا العنوان.
        expect(await screen.findByText('كاشير 1')).toBeTruthy();
        expect(screen.getByText('كاشير 4')).toBeTruthy();
        expect(screen.getAllByText('1,500.50').length).toBeGreaterThan(0);
        expect(screen.getByText('2026-11-07')).toBeTruthy();
    });

    it('يقرأ من عقد القراءة المحلي ولا يستدعي مسار Yarasoft', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url.includes('/api/cashier-revenues')) {
                return json(SNAPSHOT);
            }
            return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
        });
        vi.stubGlobal('fetch', fetchMock);

        renderScreen();
        // نُلغي ما سجّله تبويب التكامل عند التركيب؛ المقصود هنا سلوك تقرير الإيرادات وحده.
        fetchMock.mockClear();
        openRevenuesTab();

        await screen.findByText('كاشير 1');

        const urls = fetchMock.mock.calls.map((call) => String(call[0]));
        expect(urls.length).toBeGreaterThan(0);
        expect(urls.every((url) => url.includes('/api/cashier-revenues'))).toBe(true);
        expect(urls.some((url) => url.includes('/api/yarasoft'))).toBe(false);
    });

    it('تصفية الكاشير بنص البحث من الواجهة الأمامية', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/cashier-revenues')) {
                    return json(SNAPSHOT);
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();
        openRevenuesTab();

        await screen.findByText('كاشير 1');
        await screen.findByText('كاشير 4');

        const search = screen.getByTestId('yarasoft-filter-bar');
        fireEvent.input(search, { target: { value: 'كاشير 4' } });

        await screen.findByText('كاشير 4');
        expect(screen.queryByText('كاشير 1')).toBeNull();
    });

    it('يعرض رسالة الخادم عند فشل القراءة', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ error: 'INTERNAL_ERROR', message: 'تعذّر قراءة إيرادات الكاشير' }, 500)),
        );

        renderScreen();
        openRevenuesTab();

        expect(await screen.findByText('تعذّر قراءة إيرادات الكاشير')).toBeTruthy();
    });
});

describe('جودة مخازن الكاشير', () => {
    it('تطبع تقرير الحجر مع تهريب محتوى البيانات', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/yarasoft/oracle/catalog-status')) {
                    return json({ withQty: 1, zeroQty: 0, customers: 0, assets: 0, purchases: { n: 0, t: 0 } });
                }
                if (url.includes('/api/yarasoft/quality/quarantine')) {
                    return json([
                        {
                            kind: 'balance',
                            ref_code: 'Q-1',
                            qty: 5,
                            value_amount: 20,
                            unit_cost: 4,
                            reason: '<script>unsafe()</script>',
                        },
                    ]);
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();
        fireEvent.click(await screen.findByRole('tab', { name: 'جودة البيانات' }));
        expect(await screen.findByText('Q-1')).toBeTruthy();

        const printDocument = document.implementation.createHTMLDocument();
        const print = vi.fn();
        const printWindow = { document: printDocument, focus: vi.fn(), print } as unknown as Window;
        const open = vi.spyOn(window, 'open').mockReturnValue(printWindow);

        fireEvent.click(screen.getByRole('button', { name: 'طباعة بنود الحجر' }));

        expect(open).toHaveBeenCalledWith('', '_blank');
        expect(print).toHaveBeenCalledOnce();
        expect(printDocument.body.innerHTML).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
        expect(printDocument.body.innerHTML).not.toContain('<script>');
        open.mockRestore();
    });
});
