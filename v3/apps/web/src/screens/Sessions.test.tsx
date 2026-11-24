import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sessions } from './Sessions';

/**
 * jsdom بلا تخطيط: `clientHeight` دائمًا صفر، فـreact-virtual لا يرسم
 * VirtualItems. نحاكي ارتفاع منطقة تمرير DataTable وحدها (520px) كي يُختبر
 * مسار التمرير الافتراضي فعلًا — نفس نهج Payroll.test.tsx وDataTable.test.tsx.
 */
Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
        return this.getAttribute('data-testid') === 'datatable' ? 520 : 0;
    },
});

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
            <Sessions />
        </QueryClientProvider>,
    );
}

interface FetchCall {
    url: string;
    method: string | undefined;
}

function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'sess-1',
        current: false,
        device: 'Chrome on Windows',
        ip: '192.168.1.50',
        started_at: '2026-11-07T10:00:00.000Z',
        last_seen_at: '2026-11-07T12:00:00.000Z',
        expires_at: '2026-11-14T10:00:00.000Z',
        ...overrides,
    };
}

/** خادم الاختبار — قائمة الجلسات فقط، مع تسجيل كل طلب للتحقق من الكتابات. */
function stubFetch(options: { sessions?: unknown[]; currentId?: string | null; calls?: FetchCall[]; fail?: boolean }) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        options.calls?.push({ url, method: init?.method });
        if (options.fail) {
            return json({ error: 'SERVER', message: 'تعذّر جلب الجلسات' }, 500);
        }
        if (url.includes('/api/auth/sessions')) {
            return json({
                ok: true,
                current_session_id: options.currentId ?? 'sess-1',
                sessions: options.sessions ?? [
                    session({ id: 'sess-1', current: true }),
                    session({
                        id: 'sess-2',
                        device: 'Safari on iPhone',
                        ip: '10.0.0.2',
                        started_at: '2026-11-06T08:00:00.000Z',
                        last_seen_at: '2026-11-06T09:00:00.000Z',
                        expires_at: '2026-11-13T08:00:00.000Z',
                    }),
                ],
            });
        }
        return json({ error: 'NOT_FOUND' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

/** ينتظر استقرار حالة DataTable بعد وصول الاستجابة (الاستعلام غير متزامن). */
async function waitForState(region: HTMLElement, state: string): Promise<void> {
    await vi.waitFor(() => {
        expect(region.getAttribute('data-state')).toBe(state);
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('الأجهزة والجلسات', () => {
    it('يعرض قائمة الجلسات النشطة والجلسة الحالية', async () => {
        const calls: FetchCall[] = [];
        stubFetch({ calls });

        renderScreen();

        // الاسم يظهر في الجدول وبطاقة الجوال معًا — ننتظر ظهوره في أيهما.
        expect((await screen.findAllByText('Chrome on Windows')).length).toBeGreaterThan(0);
        expect(screen.getAllByText('Safari on iPhone').length).toBeGreaterThan(0);
        expect(screen.getAllByText('الجلسة الحالية').length).toBeGreaterThan(0);
        expect(screen.getAllByText('192.168.1.50').length).toBeGreaterThan(0);
        expect(calls.every((call) => !call.method || call.method === 'GET')).toBe(true);
    });

    it('يسمح بالبحث والتصفية باسم الجهاز', async () => {
        stubFetch({});

        renderScreen();

        expect((await screen.findAllByText('Chrome on Windows')).length).toBeGreaterThan(0);
        const region = screen.getByRole('region', { name: 'سجل الجلسات النشطة' });
        const searchInput = screen.getByPlaceholderText(/ابحث بالجهاز/);
        fireEvent.change(searchInput, { target: { value: 'iPhone' } });
        // في الجدول بعد التصفية (مؤشر «جلسة هذا الجهاز» يبقى باسمه خارج الجدول)
        expect(within(region).getAllByText('Safari on iPhone').length).toBeGreaterThan(0);
        expect(within(region).queryByText('Chrome on Windows')).toBeNull();
    });

    it('البحث بالـ IP يرشّح من جهة الشاشة لا الجدول', async () => {
        stubFetch({});

        renderScreen();

        const region = await screen.findByRole('region', { name: 'سجل الجلسات النشطة' });
        await within(region).findAllByText('Chrome on Windows');
        expect(region.querySelector('table')?.getAttribute('data-manual-filtering')).toBe('true');
        fireEvent.change(screen.getByPlaceholderText(/ابحث بالجهاز/), { target: { value: '10.0.0.2' } });
        expect(within(region).getAllByText('Safari on iPhone').length).toBeGreaterThan(0);
        expect(within(region).queryByText('Chrome on Windows')).toBeNull();
    });

    it('فوق 200 جلسة: تمرير افتراضي يرسم جزءًا ويحفظ العدّ الكامل', async () => {
        const sessions = Array.from({ length: 250 }, (_, index) =>
            session({
                id: `sess-${String(index + 1)}`,
                current: index === 0,
                device: `جهاز ${String(index + 1).padStart(3, '0')}`,
                ip: `10.0.0.${String(index + 1)}`,
            }),
        );
        stubFetch({ sessions, currentId: 'sess-1' });

        renderScreen();

        const region = await screen.findByRole('region', { name: 'سجل الجلسات النشطة' });
        await within(region).findAllByText('جهاز 001');
        expect(region.getAttribute('data-virtualized')).toBe('true');
        expect(region.getAttribute('data-row-count')).toBe('250');
        expect(within(region).getByRole('table').getAttribute('aria-rowcount')).toBe('251');
        const rendered = within(region).getAllByTestId('datatable-row');
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(250);
        expect(rendered[0]?.getAttribute('aria-rowindex')).toBe('2');
    });

    it('يرتّب الجلسات محليًا على كل النتائج مع اتجاه تنازلي', async () => {
        stubFetch({
            sessions: [
                session({ id: 's-a', device: 'Chrome on Windows' }),
                session({ id: 's-b', device: 'Safari on iPhone' }),
                session({ id: 's-c', device: 'Firefox on Linux' }),
            ],
            currentId: null,
        });

        renderScreen();

        const region = await screen.findByRole('region', { name: 'سجل الجلسات النشطة' });
        await within(region).findAllByText('Chrome on Windows');
        const sortButton = within(region).getByRole('button', { name: 'فرز حسب الجهاز' });
        fireEvent.click(sortButton);
        fireEvent.click(sortButton);
        const rows = within(region).getAllByTestId('datatable-row');
        expect(rows[0]?.textContent).toContain('Safari on iPhone');
        expect(rows[2]?.textContent).toContain('Chrome on Windows');
        expect(
            within(region)
                .getByRole('columnheader', { name: /الجهاز/ })
                .getAttribute('aria-sort'),
        ).toBe('descending');
    });

    it('التاريخ الفارغ يُفرز في النهاية لا كبداية زمنية', async () => {
        stubFetch({
            sessions: [
                session({ id: 's-null', device: 'بلا تاريخ', started_at: null }),
                session({ id: 's-old', device: 'قديم', started_at: '2026-11-01T10:00:00.000Z' }),
                session({ id: 's-new', device: 'حديث', started_at: '2026-11-09T10:00:00.000Z' }),
            ],
            currentId: null,
        });

        renderScreen();

        const region = await screen.findByRole('region', { name: 'سجل الجلسات النشطة' });
        await within(region).findAllByText('بلا تاريخ');
        fireEvent.click(within(region).getByRole('button', { name: 'فرز حسب بدأت في' }));
        const rows = within(region).getAllByTestId('datatable-row');
        expect(rows[0]?.textContent).toContain('قديم');
        expect(rows[1]?.textContent).toContain('حديث');
        expect(rows[2]?.textContent).toContain('بلا تاريخ');
    });

    it('حالة loading: الرؤوس الحقيقية تبقى مع aria-busy ورسالة حالة', () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => new Promise<Response>(() => {})),
        );

        renderScreen();

        const region = screen.getByRole('region', { name: 'سجل الجلسات النشطة' });
        expect(region.getAttribute('data-state')).toBe('loading');
        expect(within(region).getByRole('table').getAttribute('aria-busy')).toBe('true');
        expect(within(region).getByRole('columnheader', { name: 'الجهاز' })).toBeTruthy();
        expect(within(region).getByRole('columnheader', { name: 'الإجراءات' })).toBeTruthy();
        expect(within(region).getByRole('status').textContent).toContain('جارٍ تحميل البيانات');
    });

    it('حالة error: تنبيه وإعادة المحاولة تعيد الجلب', async () => {
        const fetchMock = stubFetch({ fail: true });

        renderScreen();

        const region = await screen.findByRole('region', { name: 'سجل الجلسات النشطة' });
        await waitForState(region, 'error');
        expect(within(region).getByRole('alert')).toBeTruthy();
        const before = fetchMock.mock.calls.length;
        fireEvent.click(within(region).getByRole('button', { name: 'إعادة المحاولة' }));
        await vi.waitFor(() => {
            expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
        });
    });

    it('حالة empty: عنوان وتلميح مع بقاء الرؤوس', async () => {
        stubFetch({ sessions: [], currentId: null });

        renderScreen();

        const region = await screen.findByRole('region', { name: 'سجل الجلسات النشطة' });
        await waitForState(region, 'empty');
        expect(within(region).getByText('لا توجد جلسات مطابقة')).toBeTruthy();
        expect(within(region).getByText('لم يُعثر على جلسات توافق معيار البحث المدخل.')).toBeTruthy();
        expect(within(region).getByRole('columnheader', { name: 'الجهاز' })).toBeTruthy();
    });

    it('البحث بلا نتائج يعلن الحالة الفارغة ولا يخفي الرؤوس', async () => {
        stubFetch({});

        renderScreen();

        const region = await screen.findByRole('region', { name: 'سجل الجلسات النشطة' });
        await within(region).findAllByText('Chrome on Windows');
        fireEvent.change(screen.getByPlaceholderText(/ابحث بالجهاز/), { target: { value: 'جهاز غير موجود' } });
        expect(region.getAttribute('data-state')).toBe('empty');
        expect(within(region).getByText('لا توجد جلسات مطابقة')).toBeTruthy();
    });

    it('إبطال جلسة يستأذن ثم يرسل DELETE لنفس المعرّف', async () => {
        const calls: FetchCall[] = [];
        stubFetch({ calls });
        const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true);

        renderScreen();

        const region = await screen.findByRole('region', { name: 'سجل الجلسات النشطة' });
        await within(region).findAllByText('Safari on iPhone');
        const buttons = within(region).getAllByRole('button', { name: 'إبطال الجلسة' });
        fireEvent.click(buttons[1] as HTMLElement);
        expect(confirmMock).toHaveBeenCalledWith('هل أنت متأكد من إبطال جلسة (Safari on iPhone)؟');
        await vi.waitFor(() => {
            expect(
                calls.some((call) => call.method === 'DELETE' && call.url.includes('/api/auth/sessions/sess-2')),
            ).toBe(true);
        });
        expect(await screen.findByText('تم إبطال الجلسة بنجاح.')).toBeTruthy();
    });

    it('إبطال الجلسة الحالية يستأذن برسالة الخروج الفوري', async () => {
        const calls: FetchCall[] = [];
        stubFetch({ calls });
        const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true);

        renderScreen();

        const region = await screen.findByRole('region', { name: 'سجل الجلسات النشطة' });
        await within(region).findAllByText('Chrome on Windows');
        fireEvent.click(within(region).getAllByRole('button', { name: 'إبطال الجلسة' })[0] as HTMLElement);
        expect(confirmMock).toHaveBeenCalledWith('هل أنت متأكد من إبطال هذه الجلسة الحالية؟ سيتم تسجيل خروجك فورًا.');
        await vi.waitFor(() => {
            expect(
                calls.some((call) => call.method === 'DELETE' && call.url.includes('/api/auth/sessions/sess-1')),
            ).toBe(true);
        });
    });

    it('رفض التأكيد لا يرسل أي طلب إبطال', async () => {
        const calls: FetchCall[] = [];
        stubFetch({ calls });
        vi.spyOn(window, 'confirm').mockReturnValue(false);

        renderScreen();

        const region = await screen.findByRole('region', { name: 'سجل الجلسات النشطة' });
        await within(region).findAllByText('Safari on iPhone');
        fireEvent.click(within(region).getAllByRole('button', { name: 'إبطال الجلسة' })[1] as HTMLElement);
        expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    });

    it('إبطال الجلسات الأخرى يظهر عند وجودها ويرسل POST بعد التأكيد', async () => {
        const calls: FetchCall[] = [];
        stubFetch({ calls });
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        renderScreen();

        const button = await screen.findByRole('button', { name: 'إبطال الجلسات الأخرى' });
        fireEvent.click(button);
        await vi.waitFor(() => {
            expect(
                calls.some((call) => call.method === 'POST' && call.url.includes('/api/auth/sessions/revoke-others')),
            ).toBe(true);
        });
        expect(await screen.findByText('تم إبطال جميع الجلسات الأخرى بنجاح.')).toBeTruthy();
    });

    it('لا زر تصدير CSV — الشاشة لم تكن تصدّر ولا تُضاف دلالة جديدة', async () => {
        stubFetch({});

        renderScreen();

        await screen.findAllByText('Chrome on Windows');
        expect(screen.queryByRole('button', { name: /تصدير/ })).toBeNull();
    });
});
