import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
            <Yarasoft />
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('إيرادات الكاشير', () => {
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

        expect(await screen.findByText('تعذّر قراءة إيرادات الكاشير')).toBeTruthy();
    });
});
