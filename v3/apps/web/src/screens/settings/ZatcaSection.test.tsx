import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../components/ConfirmProvider';
import { ToastProvider } from '../../ui/Toast';
import { installDomPolyfills } from '../../ui/test-utils';
import { ZatcaSection } from './ZatcaSection';

const mocks = vi.hoisted(() => ({ role: 'admin' }));

vi.mock('../../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'مدير النظام', username: 'admin', role: mocks.role },
    }),
}));

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

const settingsBody = {
    config: {
        enabled: true,
        environment: 'simulation',
        environment_label: 'المحاكاة',
        seller_name: 'مؤسسة كريم',
        vat_number: '310123456700003',
        crn: '1010101010',
        branch_name: 'الفرع الرئيسي',
        address: 'الرياض',
        has_csr: true,
        has_csid: true,
        csid_masked: 'CSID-****-1234',
        has_private_key: true,
        eid_masked: '30****03',
        max_attempts: 5,
        poll_in_server: true,
        environments: [],
    },
    queue: {
        queued: 3,
        processing: 1,
        reported: 12,
        failed: 2,
        dead_letter: 1,
        skipped_cancelled: 4,
        skipped_disabled: 5,
    },
    engine: { mode: 'bullmq+sql', poller_in_server: true, poll_interval_ms: 15000 },
};

const queueBody = {
    stats: settingsBody.queue,
    engine: { mode: 'bullmq+sql', poll_interval_ms: 15000 },
    data: [
        {
            id: '9',
            status: 'dead_letter',
            attempts: 5,
            max_attempts: 5,
            next_retry_at: '2026-11-12 10:00:00',
            last_error: 'HTTP 500 من بوابة الهيئة',
            queued_at: '2026-11-12 09:00:00',
            reported_at: '',
            invoice_number: '#1042',
            total_amount: 320.5,
            order_date: '2026-11-12',
            department_name: 'الكاشير 1',
        },
    ],
};

let urls: string[] = [];

function stubFetch(): void {
    urls = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input.toString();
            urls.push(url);
            if (url.includes('/api/zatca/settings')) {
                return json(settingsBody);
            }
            if (url.includes('/api/zatca/queue')) {
                return json(queueBody);
            }
            return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
        }),
    );
}

function renderSection() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <ConfirmProvider>
                    <ZatcaSection />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
}

describe('قسم الفاتورة الضريبية — ربط ZATCA', () => {
    beforeEach(() => {
        mocks.role = 'admin';
        installDomPolyfills();
        stubFetch();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('يعلن حالة المحرّك ودورة الاستطلاع', async () => {
        renderSection();

        expect(await screen.findByText('الربط الضريبي')).toBeTruthy();
        expect(screen.getByText('المحرّك: bullmq+sql')).toBeTruthy();
        expect(screen.getByText('دورة الاستطلاع كل 15 ثانية')).toBeTruthy();
        expect(screen.getByText('الاستطلاع داخل الخادم')).toBeTruthy();
    });

    it('يعرض عدّادات المتجاوزة والفشل النهائي', async () => {
        renderSection();

        expect(await screen.findByText('متجاوزة (ملغاة)')).toBeTruthy();
        expect(screen.getByText('متجاوزة (موقوفة)')).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toContain('1 فاتورة فشلت نهائيًا');
    });

    it('يعرض خطوات الربط الأربع', async () => {
        renderSection();

        expect(await screen.findByText('شهادة الامتثال CSID')).toBeTruthy();
        expect(screen.getByText('الربط مفعّل')).toBeTruthy();
    });

    it('يرشّح الطابور من الخادم حسب الحالة', async () => {
        renderSection();
        expect(await screen.findByText('الربط الضريبي')).toBeTruthy();
        await waitFor(() => {
            expect(urls.some((url) => url.includes('/api/zatca/queue'))).toBe(true);
        });

        fireEvent.click(screen.getByRole('combobox', { name: 'الحالة' }));
        fireEvent.click(await screen.findByRole('option', { name: 'فشل نهائي' }));

        await waitFor(() => {
            expect(urls.some((url) => url.includes('status=dead_letter'))).toBe(true);
        });
    });
});
