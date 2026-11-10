import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chartCaptureBody } from '../test-fixtures/captures';
import { AccountsTree } from './AccountsTree';

/**
 * الشجرة تُختبَر على **الالتقاط الحقيقي** (124 حسابًا) لا على بيانات مخترَعة:
 * الشجرة المبنية من `parent_code` يجب أن تُظهر الحسابات الفعلية بلا فقد.
 */

const chart = chartCaptureBody;

function stubFetch(body: unknown = chart, status = 200): void {
    vi.stubGlobal(
        'fetch',
        vi.fn(
            async () =>
                new Response(JSON.stringify(body), {
                    status,
                    headers: { 'Content-Type': 'application/json' },
                }),
        ),
    );
}

function renderTree() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <AccountsTree />
        </QueryClientProvider>,
    );
}

/** رموز الحسابات في العمود الأول — بالترتيب المعروض. */
function visibleCodes(): string[] {
    return screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0]?.textContent?.trim() ?? '');
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('شجرة الحسابات', () => {
    it('يعرض الالتقاط الحقيقي كاملًا بلا فقد حساب', async () => {
        stubFetch();
        renderTree();

        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('شجرة الحسابات');
        expect(screen.getByText(`${String(chart.length)} حسابًا · ${String(chart.length)} نشطًا`)).toBeTruthy();

        // الجذور مفتوحة افتراضيًا: 9 جذور + 24 ابنًا = 33 صفًا ظاهرًا.
        expect(visibleCodes()).toHaveLength(33);
        expect(visibleCodes()).toContain('1');
        expect(visibleCodes()).toContain('11');
    });

    it('يفتح مستوىً عند الطلب ويطويّه', async () => {
        stubFetch();
        renderTree();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        const toggle = screen.getByRole('button', { name: 'فتح حساب 11' });
        fireEvent.click(toggle);

        await waitFor(() => {
            expect(visibleCodes()).toContain('111');
        });
        expect(visibleCodes()).toHaveLength(38);

        fireEvent.click(screen.getByRole('button', { name: 'طيّ حساب 11' }));
        await waitFor(() => {
            expect(visibleCodes()).not.toContain('111');
        });
        expect(visibleCodes()).toHaveLength(33);
    });

    it('يبقي المطابقة وأسلافها مرئية عند البحث', async () => {
        stubFetch();
        renderTree();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'صندوق' } });

        await waitFor(() => {
            expect(visibleCodes()).toContain('1000');
        });
        // الطريق إلى المطابقة (1 ← 11 ← 111) يبقى ظاهرًا.
        expect(visibleCodes()).toEqual(['1', '11', '111', '1000', '1001']);
    });

    it('يعرض حالة الفراغ حين لا يطابق البحث شيئًا', async () => {
        stubFetch();
        renderTree();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'لا-يوجد-مثله' } });

        await waitFor(() => {
            expect(screen.getByText('لا نتائج')).toBeTruthy();
        });
        expect(screen.queryByRole('table')).toBeNull();
    });

    it('يعرض خطأً قابلًا لإعادة المحاولة حين يفشل الجلب', async () => {
        stubFetch({ error: 'LEDGER_CHART_FAILED', message: 'تعذر جلب شجرة الحسابات' }, 500);
        renderTree();

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeTruthy();
        });
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});
