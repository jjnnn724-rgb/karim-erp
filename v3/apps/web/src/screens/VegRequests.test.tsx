import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { VegRequests } from './VegRequests';

/**
 * شاشة طلبات الخضار تقرأ `/api/veg-requests` فقط — نفس أعمدة القديم
 * (`veg-requests.js`) والملخص من عدّاد الخادم، والمرشّح يُرسل status
 * بالاسم الذي يقبله الخادم. لا كتابة هنا.
 */

const requests = [
    {
        id: 17905,
        request_no: 'VR-20261025-17905',
        created_by_name: 'فاروق عبد احمد',
        priority: 'urgent',
        status: 'pending',
        items_count: 6,
        total: null,
        created_at: '2026-10-25T09:52:55.890Z',
    },
    {
        id: 17907,
        request_no: 'VR-20261105-17907',
        created_by_name: 'مدير النظام',
        priority: 'normal',
        status: 'received',
        items_count: 6,
        total: '1250.50',
        created_at: '2026-11-05T21:39:42.035Z',
    },
];

const summary = { pending: 1, pending_today: 0, today: 1 };

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(fail = false): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            urls.push(String(url));
            if (fail) {
                return json({ error: 'FAILED', message: 'تعذّر جلب طلبات الخضار' }, 500);
            }
            if (url.includes('/api/settings/main_settings')) {
                return json({ currency: 'SAR' });
            }
            const rows = url.includes('status=received')
                ? requests.filter((request) => request.status === 'received')
                : requests;
            return json({ ok: true, requests: rows, summary });
        }),
    );
    return urls;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <VegRequests />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

function bodyRows(): HTMLElement[] {
    return screen.getAllByRole('row').slice(1) as HTMLElement[];
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('طلبات شراء الخضار', () => {
    it('يعرض الملخص وأرقام الطلبات والحالات والإجمالي بعملة الإعدادات', async () => {
        stubFetch();
        renderScreen();
        expect(await screen.findByText('VR-20261025-17905')).toBeTruthy();
        expect(screen.getByText('VR-20261105-17907')).toBeTruthy();
        expect(screen.getByText('فاروق عبد احمد')).toBeTruthy();
        expect(screen.getByText('عاجل')).toBeTruthy();
        expect(screen.getByText('عادي')).toBeTruthy();
        expect(screen.getByText('بانتظار المعالجة')).toBeTruthy();
        expect(screen.getByText('تم الاستلام')).toBeTruthy();
        expect(screen.getByText('1,250.50')).toBeTruthy();
        expect(screen.getByText('SAR')).toBeTruthy();
        expect(screen.getByText('معلقة 1 · معلقة اليوم 0 · طلبات اليوم 1')).toBeTruthy();
        expect(screen.getByText('2 طلبًا محمّلًا')).toBeTruthy();
    });

    it('يطلب السقف 200 دائمًا، ويرسل status=match عند ترشيح الحالة', async () => {
        const urls = stubFetch();
        renderScreen();
        await screen.findByText('VR-20261025-17905');
        expect(urls.some((url) => url.includes('/api/veg-requests?limit=200'))).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'مستلم' }));
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });
        expect(bodyRows()[0]?.textContent).toContain('VR-20261105-17907');
        expect(urls.some((url) => url.includes('status=received'))).toBe(true);
    });

    it('يبحث بتطبيع الحروف العربية ويعلن التطبيع', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('VR-20261025-17905');

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'أحمد' } });
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });
        expect(bodyRows()[0]?.textContent).toContain('VR-20261025-17905');
        expect(screen.getByText('بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.')).toBeTruthy();
    });

    it('بلا نتائج يعرض حالة فارغة، ومسح المرشّحات يعيد السجل', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('VR-20261025-17905');

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'zzz' } });
        await waitFor(() => {
            expect(screen.getByText('لا طلبات تطابق المرشّحات')).toBeTruthy();
        });
        fireEvent.click(screen.getByRole('button', { name: 'مسح المرشّحات' }));
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(2);
        });
    });

    it('يرتّب برقم الطلب تصاعديًا ثم تنازليًا', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('VR-20261025-17905');

        fireEvent.click(screen.getByRole('button', { name: 'رقم الطلب' }));
        await waitFor(() => {
            expect(bodyRows()[0]?.textContent).toContain('VR-20261025-17905');
        });
        fireEvent.click(screen.getByRole('button', { name: 'رقم الطلب' }));
        await waitFor(() => {
            expect(bodyRows()[0]?.textContent).toContain('VR-20261105-17907');
        });
    });

    it('يعرض خطأ الجلب مع إعادة المحاولة', async () => {
        stubFetch(true);
        renderScreen();
        await waitFor(() => {
            expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
        });
        expect(screen.getByText('تعذّر جلب البيانات')).toBeTruthy();
        expect(screen.getByText('تعذّر جلب طلبات الخضار')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});
