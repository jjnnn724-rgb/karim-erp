import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { OracleData } from './OracleData';

/**
 * بيانات Oracle — اختبارات العقد: قائمة الجداول وعدّاداتها، فتح جدول يجلب
 * أعمدته وصفوفه من مساره، والبحث والترقيم خادميان. `fetch` مُستبدل بالكامل.
 */

const tablesBody = {
    ok: true,
    tables: [
        {
            pg_name: 'ora_items',
            oracle_name: 'ITEMS',
            oracle_rows: 100,
            imported_at: '2026-11-01T10:00:00',
            live_count: 70,
        },
        {
            pg_name: 'ora_customers',
            oracle_name: 'CUSTOMERS',
            oracle_rows: 50,
            imported_at: '2026-11-01T10:00:00',
            live_count: -1,
        },
        {
            pg_name: 'ora_empty',
            oracle_name: 'EMPTY_TABLE',
            oracle_rows: 0,
            imported_at: null,
            live_count: 0,
        },
    ],
};

const contentBody = {
    ok: true,
    table: 'ora_items',
    columns: ['ITEM_CODE', 'ITEM_NAME', 'QTY'],
    rows: [
        { ITEM_CODE: 'A1', ITEM_NAME: 'دجاج', QTY: 10 },
        { ITEM_CODE: 'B2', ITEM_NAME: 'أرز', QTY: 5 },
    ],
    total: 70,
    page: 1,
    limit: 50,
    totalPages: 2,
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(options: { tables?: unknown; content?: unknown } = {}) {
    const mock = vi.fn(async (input: unknown) => {
        const href = String(input);
        const url = new URL(href, 'http://localhost');
        if (url.pathname === '/api/oracle-data/tables') {
            return json(options.tables ?? tablesBody);
        }
        const page = Number(url.searchParams.get('page') ?? '1');
        return json({ ...(options.content ?? contentBody), table: 'ora_items', page });
    });
    vi.stubGlobal('fetch', mock);
    return mock;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <OracleData />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

function calledUrls(mock: ReturnType<typeof stubFetch>): string[] {
    return mock.mock.calls.map((call) => String(call[0]));
}

function listTable(): HTMLElement {
    return screen.getAllByRole('table')[0] as HTMLElement;
}

function detailTable(): HTMLElement {
    const tables = screen.getAllByRole('table');
    return tables[tables.length - 1] as HTMLElement;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('بيانات Oracle', () => {
    it('يعرض الجداول وعدّاداتها الحيّة ولا يجمع المجهول', async () => {
        stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('بيانات Oracle المنسوخة');

        const kpis = screen.getByRole('list', { name: 'مؤشرات بيانات Oracle' });
        expect(within(kpis).getByText('3')).toBeTruthy();
        expect(within(kpis).getByText('70')).toBeTruthy();
        expect(within(kpis).getByText('1')).toBeTruthy();

        const rows = within(listTable()).getAllByRole('row').slice(1);
        expect(rows).toHaveLength(3);

        const items = rows[0] as HTMLElement;
        expect(within(items).getByText('ITEMS')).toBeTruthy();
        expect(within(items).getByText('ora_items')).toBeTruthy();
        expect(within(items).getByText('70')).toBeTruthy();

        const unknown = rows[1] as HTMLElement;
        expect(within(unknown).getByText('CUSTOMERS')).toBeTruthy();
        expect(within(unknown).getByText('—')).toBeTruthy();
    });

    it('يفلتر جدول القائمة محليًا بالاسم', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('بحث في اسم الجدول'), { target: { value: 'customers' } });

        await waitFor(() => {
            expect(within(listTable()).queryByText('ITEMS')).toBeNull();
        });
        expect(within(listTable()).getByText('CUSTOMERS')).toBeTruthy();
    });

    it('يفتح الجدول فيجلب أعمدته وصفوفه من مساره', async () => {
        const mock = stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'عرض جدول ITEMS' }));

        await waitFor(() => {
            expect(screen.getAllByRole('table').length).toBe(2);
        });
        const detail = detailTable();
        expect(within(detail).getByText('ITEM_CODE')).toBeTruthy();
        expect(within(detail).getByText('ITEM_NAME')).toBeTruthy();
        expect(within(detail).getByText('دجاج')).toBeTruthy();
        expect(within(detail).getByText('أرز')).toBeTruthy();
        expect(screen.getByText(/70 صف · صفحة 1 من 2/)).toBeTruthy();

        const detailCall = calledUrls(mock).find((url) => url.includes('/api/oracle-data/items'));
        expect(detailCall).toBeTruthy();
        expect(detailCall).toContain('page=1');
        expect(detailCall).toContain('limit=50');
    });

    it('يبحث داخل الجدول ويرقّم صفحاته خادميًا', async () => {
        const mock = stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'عرض جدول ITEMS' }));
        await waitFor(() => {
            expect(screen.getAllByRole('table').length).toBe(2);
        });

        fireEvent.change(screen.getByLabelText('بحث داخل الجدول'), { target: { value: 'دجاج' } });
        fireEvent.click(screen.getByRole('button', { name: 'بحث' }));

        await waitFor(() => {
            const hit = calledUrls(mock).find(
                (url) => new URL(url, 'http://localhost').searchParams.get('search') === 'دجاج',
            );
            expect(hit).toBeTruthy();
        });
        // استعلام البحث الجديد يمرّ بحالة تحميل — ننتظر عودة الجدول قبل الترقيم.
        await waitFor(() => {
            expect(screen.getAllByRole('table').length).toBe(2);
        });

        fireEvent.click(screen.getByRole('button', { name: 'التالي' }));

        await waitFor(() => {
            const hit = calledUrls(mock).find((url) => url.includes('/api/oracle-data/items') && url.includes('page=2'));
            expect(hit).toBeTruthy();
        });
        await waitFor(() => {
            expect(screen.getByText('صفحة 2 من 2')).toBeTruthy();
        });
    });

    it('يغلق تفاصيل الجدول ويعود للقائمة', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'عرض جدول ITEMS' }));
        await waitFor(() => {
            expect(screen.getAllByRole('table').length).toBe(2);
        });

        fireEvent.click(screen.getByRole('button', { name: 'إغلاق الجدول' }));

        await waitFor(() => {
            expect(screen.getAllByRole('table').length).toBe(1);
        });
    });

    it('يزامن الجداول من الخادم ثم يعيد تحميل القائمة', async () => {
        let tablesCalls = 0;
        let refreshMethod = '';
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: unknown, init?: RequestInit) => {
                const url = new URL(String(input), 'http://localhost');
                if (url.pathname === '/api/oracle-data/refresh') {
                    refreshMethod = String(init?.method ?? '');
                    return json({ ok: true, refreshed: 2, failed: 1, total: 3 });
                }
                if (url.pathname === '/api/oracle-data/tables') {
                    tablesCalls += 1;
                    return json(tablesBody);
                }
                return json(contentBody);
            }),
        );
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });
        expect(tablesCalls).toBe(1);

        fireEvent.click(screen.getByRole('button', { name: 'مزامنة' }));

        await waitFor(() => {
            expect(refreshMethod).toBe('POST');
        });
        await waitFor(() => {
            expect(tablesCalls).toBe(2);
        });
    });

    it('يعرض حالة الفراغ حين لا جداول منسوخة', async () => {
        stubFetch({ tables: { ok: true, tables: [] } });
        renderScreen();

        await waitFor(() => {
            expect(screen.getByText('لا جداول منسوخة')).toBeTruthy();
        });
    });

    it('يعرض «لا صفوف» عندما لا يعيد الجدول صفوفًا', async () => {
        stubFetch({
            content: { ...contentBody, columns: ['ITEM_CODE', 'ITEM_NAME'], rows: [], total: 0, totalPages: 0 },
        });
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'عرض جدول ITEMS' }));

        await waitFor(() => {
            expect(screen.getByText('لا صفوف')).toBeTruthy();
        });
    });

    it('يعرض خطأ الخادم ويعيد المحاولة بنجاح', async () => {
        let calls = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: unknown) => {
                const url = new URL(String(input), 'http://localhost');
                if (url.pathname === '/api/oracle-data/tables') {
                    calls += 1;
                    return calls === 1 ? json({ ok: false, error: 'ORA_FAILED' }, 500) : json(tablesBody);
                }
                return json(contentBody);
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

describe('بيانات Oracle', () => {
    it('يفتح الجدول ويطبع محتواه', async () => {
        const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
        stubFetch();
        renderScreen();
        await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'عرض جدول ITEMS' }));
        await waitFor(() => expect(screen.getAllByRole('table').length).toBe(2));
        fireEvent.click(screen.getByRole('button', { name: 'طباعة' }));
        expect(print).toHaveBeenCalledTimes(1);
        print.mockRestore();
    });
});
