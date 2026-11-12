import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { ToastProvider } from '../ui/Toast';
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
            <ToastProvider>
                <ConfirmProvider>
                    <Whatsapp />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('واتساب والتنبيهات', () => {
    it('يقرأ عقود الخادم الحقيقية: connection.state وremote_jid وpreview وtemplates', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url.includes('/api/whatsapp/status')) {
                return json({
                    ok: true,
                    connection: {
                        state: 'CONNECTED',
                        qrAvailable: false,
                        reconnects: 1,
                        lastOkAt: '2026-11-11 09:00',
                        lastError: null,
                    },
                    metrics: { replied: 3 },
                });
            }
            if (url.includes('/api/whatsapp/messages')) {
                return json({
                    ok: true,
                    total: 4,
                    rows: [
                        {
                            id: 1,
                            remote_jid: '966511111111@s.whatsapp.net',
                            body: 'مرحبًا، أود الاستفسار عن الطلب',
                            status: 'queued',
                            created_at: '2026-11-07 14:00',
                        },
                    ],
                });
            }
            if (url.includes('/api/whatsapp/outbox')) {
                return json({
                    ok: true,
                    rows: [
                        {
                            id: 7,
                            remote_jid: '966522222222@s.whatsapp.net',
                            preview: 'تم استلام طلبكم رقم 1024 بنجاح',
                            status: 'sent',
                            attempts: 1,
                            created_at: '2026-11-07 13:50',
                        },
                    ],
                });
            }
            if (url.includes('/api/whatsapp/templates')) {
                return json({
                    ok: true,
                    templates: [
                        {
                            name: 'إشعار الفاتورة',
                            category: 'فواتير',
                            ar: 'عزيزنا العميل، تم إصدار فاتورتكم رقم {{1}}',
                            en: 'Dear customer, invoice {{1}} was issued',
                            variables: 1,
                        },
                    ],
                });
            }
            return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
        });
        vi.stubGlobal('fetch', fetchMock);

        renderScreen();

        expect((await screen.findAllByText('متصل ومفعّل')).length).toBeGreaterThan(0);
        expect(screen.getByText('مرحبًا، أود الاستفسار عن الطلب')).toBeTruthy();
        expect(screen.getByText('966511111111@s.whatsapp.net')).toBeTruthy();

        // تبويبات V2 كلها معروضة، وبوابة الإدارة تحجب تبويبي أرقام الإدارة والتنبيهات.
        for (const label of ['الربط وQR', 'الوارد', 'صندوق الصادر', 'القوالب', 'الحملات', 'قواعد الرد', 'سجل الأحداث', 'اسأل النظام']) {
            expect(screen.getByRole('tab', { name: label })).toBeTruthy();
        }
        expect(screen.queryByRole('tab', { name: 'أرقام الإدارة' })).toBeNull();
        expect(screen.queryByRole('tab', { name: 'التنبيهات' })).toBeNull();

        // صندوق الصادر: الخادم يعيد remote_jid وpreview لا to وbody.
        fireEvent.click(screen.getByRole('tab', { name: 'صندوق الصادر' }));
        expect(await screen.findByText('تم استلام طلبكم رقم 1024 بنجاح')).toBeTruthy();
        expect(screen.getByText('966522222222@s.whatsapp.net')).toBeTruthy();

        // القوالب: الخادم يعيد templates بحقل ar لا rows بحقل body.
        fireEvent.click(screen.getByRole('tab', { name: 'القوالب' }));
        expect(await screen.findByText('إشعار الفاتورة')).toBeTruthy();
        expect(screen.getByText('عزيزنا العميل، تم إصدار فاتورتكم رقم {{1}}')).toBeTruthy();
    });
});
