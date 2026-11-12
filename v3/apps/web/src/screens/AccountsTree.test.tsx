import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chartCaptureBody } from '../test-fixtures/captures';
import { ToastProvider } from '../ui';
import { expectNoAxeViolations, installDomPolyfills } from '../ui/test-utils';
import { AccountsTree } from './AccountsTree';

/**
 * الشجرة تُختَبَر على الالتقاط الحقيقي (124 حسابًا) لا على بيانات مخترَعة.
 * الصفحات المعروضة يجب أن تحافظ على كل الحسابات الفعلية وبنية الآباء.
 */

const chart = chartCaptureBody;
installDomPolyfills();

function stubFetch(body: unknown = chart, status = 200) {
    const fetchMock = vi.fn(
        async () =>
            new Response(JSON.stringify(body), {
                status,
                headers: { 'Content-Type': 'application/json' },
            }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function renderTree() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <AccountsTree />
            </ToastProvider>
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

async function waitForDataTable(): Promise<HTMLElement> {
    const table = await screen.findByRole('table', { name: 'جدول شجرة الحسابات' });
    await waitFor(() => {
        expect(screen.getByTestId('datatable').getAttribute('data-state')).toBe('data');
    });
    return table;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('شجرة الحسابات', () => {
    it('يعرض صفحات من الالتقاط الحقيقي ويحافظ على الشجرة وقيود الفرع', async () => {
        const fetchMock = stubFetch();
        const { container } = renderTree();
        const table = await waitForDataTable();

        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('شجرة الحسابات');
        expect(screen.getByText(`${String(chart.length)} حساب مطابق · 9 مجموعة حساب رئيسية`)).toBeTruthy();
        expect(visibleCodes()).toContain('1');
        expect(visibleCodes()).toContain('11');
        expect(screen.getByRole('button', { name: 'الصفحة 2' })).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const branch = screen.getByRole('combobox', { name: 'الفرع' });
        expect(branch.hasAttribute('disabled')).toBe(true);
        expect(screen.getByText('واجهة الحسابات الحالية لا تتضمن ارتباطًا بالفرع.')).toBeTruthy();
        await expectNoAxeViolations(container);

        fireEvent.click(screen.getByRole('button', { name: 'الصفحة 2' }));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'الصفحة 2' }).getAttribute('aria-current')).toBe('page');
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(table.getAttribute('data-manual-filtering')).toBe('true');
        expect(table.getAttribute('data-manual-pagination')).toBe('true');
    });

    it('يفتح الحسابات الفرعية ويطويها باستخدام أزرار الوصول', async () => {
        stubFetch();
        renderTree();
        const table = await waitForDataTable();

        fireEvent.click(within(table).getByRole('button', { name: 'فتح حساب 11' }));
        expect(await within(table).findByText('111')).toBeTruthy();

        fireEvent.click(within(table).getByRole('button', { name: 'طيّ حساب 11' }));
        await waitFor(() => {
            expect(visibleCodes()).not.toContain('111');
        });
    });

    it('يطبّق البحث مع إبقاء الطريق إلى الحساب المطابق ويعلن النجاح', async () => {
        stubFetch();
        renderTree();
        const table = await waitForDataTable();

        fireEvent.change(screen.getByLabelText('بحث في الحسابات'), { target: { value: 'صندوق' } });
        fireEvent.click(screen.getByRole('button', { name: 'تطبيق المرشّحات' }));

        await waitFor(() => {
            expect(visibleCodes()).toContain('1000');
        });
        expect(visibleCodes()).toEqual(['1', '11', '111', '1000', '1001']);
        expect(within(table).getByText('النقدية بالصندوق')).toBeTruthy();
        expect(screen.getByRole('status').textContent).toContain('تم تطبيق المرشّحات');
    });

    it('يرشّح النوع والمستوى ولا يحوّل عدم التطابق إلى بيانات', async () => {
        stubFetch();
        renderTree();
        await waitForDataTable();

        fireEvent.click(screen.getByRole('combobox', { name: 'نوع الحساب' }));
        fireEvent.click(await screen.findByRole('option', { name: 'أصول' }));
        fireEvent.click(screen.getByRole('combobox', { name: 'مستوى الحساب' }));
        fireEvent.click(await screen.findByRole('option', { name: 'المستوى 2' }));
        fireEvent.click(screen.getByRole('button', { name: 'تطبيق المرشّحات' }));

        await waitFor(() => {
            expect(screen.getByTestId('datatable').getAttribute('data-state')).toBe('data');
        });
        expect(visibleCodes().length).toBeGreaterThan(0);
        expect(screen.getByRole('combobox', { name: 'نوع الحساب' }).textContent).toContain('أصول');
    });

    it('يعرض حالة الفراغ عند انعدام نتائج البحث مع الإبقاء على رؤوس الجدول', async () => {
        stubFetch();
        renderTree();
        await waitForDataTable();

        fireEvent.change(screen.getByLabelText('بحث في الحسابات'), { target: { value: 'لا-يوجد-مثله' } });
        fireEvent.click(screen.getByRole('button', { name: 'تطبيق المرشّحات' }));

        await waitFor(() => {
            expect(screen.getByTestId('datatable').getAttribute('data-state')).toBe('empty');
        });
        expect(screen.getByText('لا نتائج')).toBeTruthy();
        expect(screen.getByRole('table', { name: 'جدول شجرة الحسابات' })).toBeTruthy();
        expect(screen.getAllByRole('button', { name: 'مسح المرشّحات' })).toHaveLength(1);
    });

    it('يعرض الخطأ وإعادة المحاولة عند فشل جلب الشجرة', async () => {
        const fetchMock = stubFetch({ error: 'LEDGER_CHART_FAILED', message: 'تعذر جلب شجرة الحسابات' }, 500);
        renderTree();

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeTruthy();
        });
        fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });
    });
});
