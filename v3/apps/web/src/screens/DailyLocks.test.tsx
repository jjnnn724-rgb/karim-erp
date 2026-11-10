import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DailyLocks } from './DailyLocks';

/**
 * لوحة التقفيل اليومي — اختبارات العقد: اليوم يُرسل للخادم، والأرقام تُعرض
 * كما وصلت، وحالة الفراغ/الخطأ/إعادة المحاولة مغطاة. `fetch` مُستبدل بالكامل.
 */

const locksBody = {
    ok: true,
    date: '2026-11-08',
    total: 3,
    locked: 2,
    unlocked: 1,
    rows: [
        {
            dept_code: '10',
            dept_name: 'المطبخ',
            gross: 1500.5,
            refund: 100.25,
            net: 1400.25,
            invoices: 40,
            refunds: 2,
            lock_count: 1,
            last_lock: '2026-11-08',
        },
        {
            dept_code: '20',
            dept_name: 'الصالة',
            gross: 900,
            refund: 0,
            net: 900,
            invoices: 25,
            refunds: 0,
            lock_count: 1,
            last_lock: '2026-11-08',
        },
        {
            dept_code: '30',
            dept_name: null,
            gross: 0,
            refund: 0,
            net: 0,
            invoices: 0,
            refunds: 0,
            lock_count: 0,
            last_lock: null,
        },
    ],
    totals: { gross: 2400.5, refund: 100.25, net: 2300.25, invoices: 65, refunds: 2 },
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(body: unknown = locksBody) {
    const mock = vi.fn(async (_input: unknown) => json(body));
    vi.stubGlobal('fetch', mock);
    return mock;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <DailyLocks />
        </QueryClientProvider>,
    );
}

function tableRows(): HTMLElement[] {
    const table = screen.getByRole('table');
    return within(table).getAllByRole('row').slice(1);
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('لوحة التقفيل اليومي', () => {
    it('يعرض مؤشرات اليوم وجدول الأقسام من استجابة الخادم', async () => {
        stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('لوحة التقفيل اليومي');
        expect(screen.getByText('2026-11-08')).toBeTruthy();
        expect(screen.getAllByText('مقفّل').length).toBeGreaterThan(0);
        expect(screen.getAllByText('مفتوح').length).toBeGreaterThan(0);
        expect(screen.getByText('65')).toBeTruthy();
        expect(screen.getByText('2,300.25')).toBeTruthy();

        const rows = tableRows();
        expect(rows).toHaveLength(3);

        const kitchen = rows[0] as HTMLElement;
        expect(within(kitchen).getByText('المطبخ')).toBeTruthy();
        expect(within(kitchen).getByText('مقفّل')).toBeTruthy();
        expect(within(kitchen).getByText('1,400.25')).toBeTruthy();
        expect(within(kitchen).getByText('40')).toBeTruthy();
        expect(within(kitchen).getByText('2')).toBeTruthy();

        const unnamed = rows[2] as HTMLElement;
        expect(within(unnamed).getByText('مفتوح')).toBeTruthy();
        expect(within(unnamed).getByText('—')).toBeTruthy();
    });

    it('يغيّر اليوم ويجلب اليوم المختار من الخادم', async () => {
        let calls = 0;
        const fetchMock = vi.fn(async (_input: unknown) => {
            calls += 1;
            return json(calls === 1 ? locksBody : { ...locksBody, date: '2026-11-01' });
        });
        vi.stubGlobal('fetch', fetchMock);
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('اليوم'), { target: { value: '2026-11-01' } });

        await waitFor(() => {
            expect(fetchMock.mock.calls.map((call) => String(call[0])).some((url) => url.includes('date=2026-11-01'))).toBe(
                true,
            );
        });
        await waitFor(() => {
            expect(screen.getByText('2026-11-01')).toBeTruthy();
        });
    });

    it('يشتق التوتال من الصفوف للعرض حين يغيب totals', async () => {
        stubFetch({ ...locksBody, totals: undefined });
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        // مجموع الصفوف: 1400.25 + 900 + 0
        expect(screen.getByText('2,300.25')).toBeTruthy();
        expect(screen.getByText('65')).toBeTruthy();
    });

    it('يعرض حالة الفراغ حين لا أقسام', async () => {
        stubFetch({
            ok: true,
            date: '2026-11-08',
            total: 0,
            locked: 0,
            unlocked: 0,
            rows: [],
            totals: { gross: 0, refund: 0, net: 0, invoices: 0, refunds: 0 },
        });
        renderScreen();

        await waitFor(() => {
            expect(screen.getByText('لا أقسام في هذا اليوم')).toBeTruthy();
        });
    });

    it('يعرض خطأ الخادم ويعيد المحاولة بنجاح', async () => {
        let calls = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                calls += 1;
                return calls === 1 ? json({ ok: false, error: 'DAILY_LOCKS_FAILED' }, 500) : json(locksBody);
            }),
        );
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));

        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
