import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localToday } from '../lib/weight';
import { ToastProvider } from '../ui/Toast';
import { Weight } from './Weight';

/**
 * شاشة الميزان تقرأ `/api/weightReadings` — المجاميع تُحوَّل للكيلوجرام،
 * والوحدة المجهولة لا تُجمع، والجدول يعرض آخر القراءات كما وصلت.
 */

const today = localToday();

const readings = [
    {
        id: 3,
        weight: '1.5',
        unit: 'kg',
        date: today,
        time: '09:15:00',
        itemName: 'لحم',
        notes: 'شحنة أولى',
        recordedBy: 'أحمد',
    },
    {
        id: 2,
        weight: '500',
        unit: 'g',
        date: today,
        time: '10:00:00',
        itemId: 5,
        itemName: null,
        notes: null,
        recordedBy: null,
    },
    {
        id: 1,
        weight: '2',
        unit: 'lb',
        date: '2026-11-01',
        time: '08:00:00',
        itemName: 'دقيق',
        notes: null,
        recordedBy: null,
    },
];

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(data: unknown = readings, fail = false): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            urls.push(String(url));
            if (fail) {
                return json({ error: 'FAILED', message: 'تعذّر جلب قراءات الميزان' }, 500);
            }
            return json({ data, pagination: { page: 1, limit: 1000, total: 3, totalPages: 1 } });
        }),
    );
    return urls;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <Weight />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

function bodyRows(): HTMLElement[] {
    return screen.getAllByRole('row').slice(1) as HTMLElement[];
}

function kpiValue(label: string): string {
    const card = screen.getByText(label).parentElement;
    return card?.textContent ?? '';
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('الميزان', () => {
    it('يعرض المؤشرات بالكيلوجرام بعد التحويل وآخر قراءة', async () => {
        stubFetch();
        renderScreen();
        expect(await screen.findByText('لحم')).toBeTruthy();
        expect(kpiValue('قراءات اليوم')).toContain('2');
        expect(kpiValue('إجمالي القراءات')).toContain('3');
        expect(kpiValue('إجمالي الوزن')).toContain('2.907');
        expect(kpiValue('آخر قراءة')).toContain(`${today} · 09:15:00`);
        expect(screen.getByText('3 قراءة محمّلة')).toBeTruthy();
        expect(bodyRows()).toHaveLength(3);
        expect(bodyRows()[1]?.textContent).toContain('#5');
        expect(bodyRows()[2]?.textContent).toContain('0.907');
    });

    it('يطلب limit=1000 مرتّبًا بـid تنازليًا — نفس عقد القديم', async () => {
        const urls = stubFetch();
        renderScreen();
        await screen.findByText('لحم');
        expect(urls.some((url) => url.includes('/api/weightReadings?page=1&limit=1000&sort=id&order=desc'))).toBe(true);
    });

    it('يرشّح بالوحدة ويعلن العدّ المطابق', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('لحم');

        fireEvent.click(screen.getByRole('button', { name: 'جرام' }));
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });
        expect(bodyRows()[0]?.textContent).toContain('#5');
        expect(screen.getByText('1 قراءة مطابقة من 3')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'مسح المرشّحات' }));
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(3);
        });
    });

    it('يبحث بتطبيع الحروف العربية ويعلن التطبيع', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('لحم');

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'احمد' } });
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });
        expect(bodyRows()[0]?.textContent).toContain('لحم');
        expect(screen.getByText('بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.')).toBeTruthy();
    });

    it('يرتّب بالوزن تصاعديًا ثم تنازليًا', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('لحم');

        fireEvent.click(screen.getByRole('button', { name: 'الوزن' }));
        await waitFor(() => {
            expect(bodyRows()[0]?.textContent).toContain('1.5');
        });
        fireEvent.click(screen.getByRole('button', { name: 'الوزن' }));
        await waitFor(() => {
            expect(bodyRows()[0]?.textContent).toContain('500');
        });
    });

    it('سجل فارغ ⇒ حالة فارغة لا جدول كاذب', async () => {
        stubFetch([]);
        renderScreen();
        expect(await screen.findByText('لا قراءات مسجّلة')).toBeTruthy();
        expect(screen.queryAllByRole('row')).toHaveLength(0);
    });

    it('يعرض خطأ الجلب مع إعادة المحاولة', async () => {
        stubFetch(readings, true);
        renderScreen();
        await waitFor(() => {
            expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
        });
        expect(screen.getByText('تعذّر جلب البيانات')).toBeTruthy();
        expect(screen.getByText('تعذّر جلب قراءات الميزان')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});
