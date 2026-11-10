import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Whatsapp } from './Whatsapp';

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
            <Whatsapp />
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('واتساب والتنبيهات', () => {
    it('يعرض حالة الاتصال وسجل الرسائل والتبويبات', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url.includes('/api/whatsapp/status')) {
                return json({ status: 'CONNECTED', connected: true, phone: '966500000000' });
            }
            if (url.includes('/api/whatsapp/messages')) {
                return json({
                    rows: [
                        {
                            id: 'msg-1',
                            from: '966511111111',
                            body: 'مرحبًا، أود الاستفسار عن الطلب',
                            created_at: '2026-11-07 14:00',
                            status: 'received',
                        },
                    ],
                });
            }
            if (url.includes('/api/whatsapp/outbox')) {
                return json({
                    rows: [
                        {
                            id: 'out-1',
                            to: '966522222222',
                            body: 'تم استلام طلبكم رقم 1024 بنجاح',
                            status: 'sent',
                            created_at: '2026-11-07 13:50',
                        },
                    ],
                });
            }
            if (url.includes('/api/whatsapp/templates')) {
                return json({
                    rows: [
                        {
                            name: 'إشعار الفاتورة',
                            body: 'عزيزنا العميل، تم إصدار فاتورتكم رقم {{1}}',
                            category: 'فواتير',
                        },
                    ],
                });
            }
            return json({ error: 'NOT_FOUND' }, 404);
        });
        vi.stubGlobal('fetch', fetchMock);

        renderScreen();

        expect((await screen.findAllByText('متصل ومفعّل')).length).toBeGreaterThan(0);
        expect(screen.getByText('مرحبًا، أود الاستفسار عن الطلب')).toBeTruthy();
        expect(screen.getByText('966511111111')).toBeTruthy();

        // التبديل إلى صندوق الصادر
        fireEvent.click(screen.getByRole('button', { name: /صندوق الصادر/ }));
        expect(await screen.findByText('تم استلام طلبكم رقم 1024 بنجاح')).toBeTruthy();

        // التبديل إلى القوالب
        fireEvent.click(screen.getByRole('button', { name: /القوالب/ }));
        expect(await screen.findByText('إشعار الفاتورة')).toBeTruthy();
    });
});
