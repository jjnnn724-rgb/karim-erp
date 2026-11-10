import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { journalCaptureBody } from '../test-fixtures/captures';
import { JournalViewer } from './JournalViewer';

/**
 * القيود تُختبَر على **الالتقاط الحقيقي** (20 قيدًا) بعد تطبيعه بقواعد ADR،
 * فيصل إلى الشاشة بالشكل الذي يُصدره v3: المال نصٌّ والتاريخ `YYYY-MM-DD`.
 */

const entries = journalCaptureBody;

function stubFetch(body: unknown = entries): void {
    vi.stubGlobal(
        'fetch',
        vi.fn(
            async () =>
                new Response(JSON.stringify(body), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
        ),
    );
}

function renderViewer() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <JournalViewer />
        </QueryClientProvider>,
    );
}

function firstRow(): HTMLElement {
    return screen.getAllByRole('row')[1] as HTMLElement;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('عارض القيود', () => {
    it('يعرض القيود بمبالغ منسّقة وتاريخ نصّي', async () => {
        stubFetch();
        renderViewer();

        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('القيود اليومية');
        expect(screen.getByText(`${String(entries.length)} قيدًا معروضًا`)).toBeTruthy();

        const row = firstRow();
        expect(within(row).getByText(entries[0]?.entry_no ?? '')).toBeTruthy();
        expect(within(row).getByText('2026-11-07')).toBeTruthy();
        expect(within(row).getByText('مرحّل')).toBeTruthy();
        // «40» في القديم ⇒ «40.00» نصًّا (ADR-04) ⇒ «40.00» معروضًا (مدين ودائن).
        expect(within(row).getAllByText('40.00')).toHaveLength(2);
    });

    it('يعرض سطور القيد عند توسيعه', async () => {
        stubFetch();
        renderViewer();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        const toggle = within(firstRow()).getByRole('button');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(toggle);

        await waitFor(() => {
            expect(screen.getAllByText('4000').length).toBeGreaterThan(0);
        });
        expect(screen.getAllByText('1000').length).toBeGreaterThan(0);
        expect(screen.getByText(/المصدر: yarasoft_revenue/)).toBeTruthy();
    });

    it('يغيّر عدد القيود ويعيد الجلب', async () => {
        stubFetch();
        renderViewer();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('عدد القيود'), { target: { value: '50' } });

        await waitFor(() => {
            const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
            expect(calls.some((call) => String(call[0]).includes('limit=50'))).toBe(true);
        });
    });

    it('يعرض حالة الفراغ حين لا توجد قيود', async () => {
        stubFetch([]);
        renderViewer();

        await waitFor(() => {
            expect(screen.getByText('لا قيود')).toBeTruthy();
        });
        expect(screen.queryByRole('table')).toBeNull();
    });
});
