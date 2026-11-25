import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { ToastProvider } from '../ui/Toast';
import { Cfo } from './Cfo';

/**
 * jsdom بلا تخطيط: نحاكي ارتفاع منطقة تمرير DataTable وحدها (520px) كي
 * يُختبر مسار التمرير الافتراضي لميزان المراجعة فعلًا — نفس نهج Sessions.test.tsx.
 */
Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
        return this.getAttribute('data-testid') === 'datatable' ? 520 : 0;
    },
});

const TB_REGION = 'جدول ميزان المراجعة';

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
                    <Cfo />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('لوحة المدير المالي', () => {
    it('تعرض الملخص والميزان والقيود والفترات والورديات', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/accounting/cfo-summary')) {
                    return json({
                        from: '2026-11-01',
                        to: '2026-11-07',
                        revenue: { total: 120000, count: 640 },
                        gross_profit: { amount: 50000, margin_pct: 41.7 },
                        expenses: { total: 20000, count: 14 },
                        net_profit: { amount: 30000, margin_pct: 25 },
                        cash_position: 9000,
                        cash_ledger: { petty_cash: 4000, bank: 5000 },
                        journal_entries: 12,
                        journal_entries_all_time: 900,
                        pos: { invoices: 640, total: 128500 },
                        reconciliation: {
                            status: 'متوافق',
                            difference: 0,
                            unposted_rows: 0,
                            mirror_revenue: 128500,
                            ledger_revenue: 128500,
                        },
                        basis: { revenue: 'صافي الكاشير + إيراد يدوي' },
                    });
                }
                if (url.includes('/api/accounting/trial-balance')) {
                    return json({
                        accounts: [
                            { code: '1000', name_ar: 'الصندوق', type: 'asset', debit: 5000, credit: 0 },
                            { code: '4000', name_ar: 'الإيرادات', type: 'revenue', debit: 0, credit: 5000 },
                        ],
                        total_debit: 5000,
                        total_credit: 5000,
                        balanced: true,
                    });
                }
                if (url.includes('/api/accounting/journal')) {
                    return json([
                        {
                            id: 1,
                            entry_no: 'JE-1001',
                            date: '2026-11-07',
                            memo: 'بيع كاشير',
                            source_type: 'pos',
                            status: 'posted',
                            lines: [{ account_code: '1000', debit: 500, credit: 0 }],
                        },
                    ]);
                }
                if (url.includes('/api/accounting/periods')) {
                    return json({ periods: [{ period: '2026-11', closed: false, posted: 12, drafts: 1 }] });
                }
                if (url.includes('/api/pos/shifts/open')) {
                    return json({
                        count: 1,
                        shifts: [
                            {
                                id: 7,
                                cashier_name: 'سالم',
                                dept_name: 'المطبخ',
                                biz_date: '2026-11-07',
                                expected_cash: 1200,
                                invoice_count: 12,
                            },
                        ],
                    });
                }
                if (url.includes('/api/pos/day-close/status')) {
                    return json({ date: '2026-11-07', open: [{ id: 7 }], closed: [], can_close: true });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('المدير المالي')).toBeTruthy();
        expect((await screen.findAllByText('120,000.00 SAR')).length).toBeGreaterThan(0);
        expect(screen.getAllByText('متوافق').length).toBeGreaterThan(0);
        expect(screen.getByText('JE-1001')).toBeTruthy();
        // اسم الحساب يظهر في الجدول وبطاقة الجوال معًا (jsdom بلا matchMedia).
        expect(screen.getAllByText('الصندوق').length).toBeGreaterThan(0);
        expect(screen.getByText('2026-11')).toBeTruthy();
        expect(screen.getByText('سالم')).toBeTruthy();
        expect(screen.getByText(/جاهز للإقفال/)).toBeTruthy();
    });

    it('تسمّي المصادر الفاشلة بدل عرض أصفار', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/accounting/cfo-summary')) {
                    return json({ revenue: { total: 10, count: 1 } });
                }
                return json({ error: 'UPSTREAM', message: 'تعذر الجلب' }, 500);
            }),
        );

        renderScreen();

        expect(await screen.findByText(/بعض المصادر لم تستجب/)).toBeTruthy();
        expect(screen.getAllByText(/ميزان المراجعة/).length).toBeGreaterThan(0);
    });

    it('تبويبات النمو السبعة تجلب أبوابها وتعرض صفوفها', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/accounting/cfo-summary')) {
                    return json({ revenue: { total: 0, count: 0 } });
                }
                if (url.includes('/api/accounting/trial-balance')) {
                    return json({ accounts: [], total_debit: 0, total_credit: 0, balanced: true });
                }
                if (url.includes('/api/accounting/journal')) {
                    return json([]);
                }
                if (url.includes('/api/accounting/periods')) {
                    return json({ periods: [] });
                }
                if (url.includes('/api/pos/shifts/open')) {
                    return json({ count: 0, shifts: [] });
                }
                if (url.includes('/api/pos/day-close/status')) {
                    return json({ date: '2026-11-10', can_close: true });
                }
                if (url.includes('/api/accounting/profit-by-cost-center')) {
                    return json({
                        ok: true,
                        from: '2026-11-01',
                        to: '2026-11-10',
                        centers: [
                            { cc: 'CC-KITCHEN', cc_name: 'المطبخ', revenue: 900, cogs: 300, expense: 100, net: 500 },
                        ],
                    });
                }
                if (url.includes('/api/accounting/ap-aging')) {
                    return json({
                        ok: true,
                        count: 1,
                        total: 500,
                        aging: [
                            {
                                supplier: 'مورد الخضار',
                                total: 500,
                                current: 100,
                                d30: 200,
                                d60: 100,
                                d90: 50,
                                over90: 50,
                            },
                        ],
                    });
                }
                if (url.includes('/api/accounting/bank-rec')) {
                    return json({
                        ok: true,
                        account: '1010',
                        from: '2026-11-01',
                        to: '2026-11-10',
                        book: 1000,
                        statement: 1200,
                        diff: 200,
                        unmatched: [{ id: 1, stmt_date: '2026-11-05', description: 'تحويل وارد', amount: 200 }],
                    });
                }
                if (url.includes('/api/accounting/fixed-assets')) {
                    return json({
                        ok: true,
                        assets: [
                            {
                                id: 3,
                                name: 'فرن مخبز',
                                cost: 12000,
                                accumulated: 2000,
                                monthly: 500,
                                remaining: 10000,
                                status: 'active',
                                last_month: '2026-10',
                            },
                        ],
                    });
                }
                if (url.includes('/api/accounting/cash-custody')) {
                    return json({
                        ok: true,
                        date: '2026-11-10',
                        myPending: 1,
                        rows: [
                            {
                                id: 9,
                                from_name: 'سالم',
                                to_name: 'خالد',
                                amount: 750,
                                note: 'عهدة مساء',
                                ack_at: null,
                            },
                        ],
                    });
                }
                if (url.includes('/api/accounting/budget-vs-actual')) {
                    return json({
                        ok: true,
                        period: '2026-11',
                        rows: [
                            {
                                id: 5,
                                label: 'موازنة المشتريات',
                                account_code: '5000',
                                budget: 1000,
                                actual: 1300,
                                variance: 300,
                                over: true,
                                pct: 130,
                            },
                        ],
                    });
                }
                if (url.includes('/api/accounting/alerts/log')) {
                    return json({
                        ok: true,
                        log: [
                            {
                                key: 'stale-shifts:2026-11-10',
                                last_title: 'ورديات عالقة',
                                last_sent_at: '2026-11-09T21:03:24.952Z',
                                times_sent: 2,
                            },
                        ],
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        fireEvent.click(await screen.findByRole('tab', { name: /ربحية المراكز/ }));
        expect(await screen.findByText('CC-KITCHEN')).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: /أعمار الذمم/ }));
        expect((await screen.findAllByText('مورد الخضار')).length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('tab', { name: /التسوية البنكية/ }));
        expect(await screen.findByText('تحويل وارد')).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: /الأصول والإهلاك/ }));
        expect((await screen.findAllByText('فرن مخبز')).length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('tab', { name: /العهد/ }));
        expect(await screen.findByText(/عهدة مساء/)).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: /الموازنات/ }));
        expect(await screen.findByText('موازنة المشتريات')).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: /سجل التنبيهات/ }));
        expect(await screen.findByText('ورديات عالقة')).toBeTruthy();
    });
});

/**
 * ترحيل ميزان المراجعة (وتبويبا الذمم والأصول) إلى DataTable — نفس عقد
 * اختبارات الجلسات: تمرير افتراضي فوق 200 صف، فرز محلي، بحث من جهة الشاشة،
 * الحالات الأربع برؤوس حقيقية. الجداول المحدودة (اليومية 30/الفترات 12/
 * الورديات/بنود الكشف 100/العهد 100/التنبيهات 100) تبقى كما هي.
 */
function account(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        code: `A${String(index).padStart(3, '0')}`,
        name_ar: `حساب ${String(index).padStart(3, '0')}`,
        type: 'asset',
        debit: index * 10,
        credit: 0,
        ...overrides,
    };
}

function stubCfo(options: {
    accounts?: unknown[];
    trialFail?: boolean;
    neverResolve?: boolean;
    aging?: unknown[];
    agingFail?: boolean;
    assets?: unknown[];
}) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (options.neverResolve) {
            return new Promise<Response>(() => {});
        }
        if (url.includes('/api/accounting/cfo-summary')) {
            return json({ revenue: { total: 0, count: 0 } });
        }
        if (url.includes('/api/accounting/trial-balance')) {
            if (options.trialFail) {
                return json({ error: 'UPSTREAM', message: 'تعذر جلب الميزان' }, 500);
            }
            const accounts = options.accounts ?? [];
            return json({ accounts, total_debit: 0, total_credit: 0, balanced: true });
        }
        if (url.includes('/api/accounting/journal')) {
            return json([]);
        }
        if (url.includes('/api/accounting/periods')) {
            return json({ periods: [] });
        }
        if (url.includes('/api/pos/shifts/open')) {
            return json({ count: 0, shifts: [] });
        }
        if (url.includes('/api/pos/day-close/status')) {
            return json({ date: '2026-11-19', open: [], closed: [], can_close: true });
        }
        if (url.includes('/api/accounting/ap-aging')) {
            if (options.agingFail) {
                return json({ error: 'UPSTREAM', message: 'تعذر جلب الذمم' }, 500);
            }
            return json({ ok: true, count: options.aging?.length ?? 0, total: 0, aging: options.aging ?? [] });
        }
        if (url.includes('/api/accounting/fixed-assets')) {
            return json({ ok: true, assets: options.assets ?? [] });
        }
        return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('ميزان المراجعة (DataTable)', () => {
    it('فوق 200 حساب: تمرير افتراضي يرسم جزءًا ويحفظ العدّ الكامل', async () => {
        const accounts = Array.from({ length: 250 }, (_, index) => account(index + 1));
        stubCfo({ accounts });
        renderScreen();

        const region = await screen.findByRole('region', { name: TB_REGION });
        await within(region).findAllByText('حساب 001');
        expect(region.getAttribute('data-virtualized')).toBe('true');
        expect(region.getAttribute('data-row-count')).toBe('250');
        expect(within(region).getByRole('table').getAttribute('aria-rowcount')).toBe('251');
        const rendered = within(region).getAllByTestId('datatable-row');
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(250);
        expect(rendered[0]?.getAttribute('aria-rowindex')).toBe('2');
    });

    it('مقياس البيانات الغنية (~124 حسابًا): عتبة 50 تُفعّل التمرير الافتراضي', async () => {
        const accounts = Array.from({ length: 124 }, (_, index) => account(index + 1));
        stubCfo({ accounts });
        renderScreen();

        const region = await screen.findByRole('region', { name: TB_REGION });
        await within(region).findAllByText('حساب 001');
        expect(region.getAttribute('data-virtualized')).toBe('true');
        expect(region.getAttribute('data-row-count')).toBe('124');
        const rendered = within(region).getAllByTestId('datatable-row');
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(124);
    });

    it('البحث باسم الحساب من جهة الشاشة لا الجدول (manualFiltering)', async () => {
        stubCfo({
            accounts: [account(1, { name_ar: 'الصندوق' }), account(2, { name_ar: 'الإيرادات', type: 'revenue' })],
        });
        renderScreen();

        const region = await screen.findByRole('region', { name: TB_REGION });
        await within(region).findAllByText('الصندوق');
        expect(region.querySelector('table')?.getAttribute('data-manual-filtering')).toBe('true');
        fireEvent.change(screen.getByPlaceholderText('ابحث باسم الحساب أو الكود…'), {
            target: { value: 'الصندوق' },
        });
        expect(within(region).getAllByText('الصندوق').length).toBeGreaterThan(0);
        expect(within(region).queryByText('الإيرادات')).toBeNull();
    });

    it('يرتّب المبالغ محليًا على كل النتائج مع اتجاه تنازلي', async () => {
        stubCfo({
            accounts: [
                account(1, { name_ar: 'صغير', debit: 100 }),
                account(2, { name_ar: 'كبير', debit: 300 }),
                account(3, { name_ar: 'وسط', debit: 200 }),
            ],
        });
        renderScreen();

        const region = await screen.findByRole('region', { name: TB_REGION });
        await within(region).findAllByText('كبير');
        const sortButton = within(region).getByRole('button', { name: 'فرز حسب مدين' });
        fireEvent.click(sortButton);
        fireEvent.click(sortButton);
        const rows = within(region).getAllByTestId('datatable-row');
        expect(rows[0]?.textContent).toContain('كبير');
        expect(rows[0]?.textContent).toContain('300.00 SAR');
        expect(rows[2]?.textContent).toContain('صغير');
        expect(within(region).getByRole('columnheader', { name: /مدين/ }).getAttribute('aria-sort')).toBe('descending');
    });

    it('حالة loading: الرؤوس الحقيقية تبقى مع aria-busy ورسالة حالة', async () => {
        stubCfo({ neverResolve: true });
        renderScreen();

        const region = await screen.findByRole('region', { name: TB_REGION });
        expect(region.getAttribute('data-state')).toBe('loading');
        expect(within(region).getByRole('table').getAttribute('aria-busy')).toBe('true');
        expect(within(region).getByRole('columnheader', { name: 'الكود' })).toBeTruthy();
        expect(within(region).getByRole('columnheader', { name: 'مدين' })).toBeTruthy();
        expect(within(region).getByRole('status').textContent).toContain('جارٍ تحميل البيانات');
    });

    it('حالة empty: لا حركات في الفترة مع بقاء الرؤوس', async () => {
        stubCfo({ accounts: [] });
        renderScreen();

        const region = await screen.findByRole('region', { name: TB_REGION });
        await vi.waitFor(() => {
            expect(region.getAttribute('data-state')).toBe('empty');
        });
        expect(within(region).getByText('لا حركات في الفترة')).toBeTruthy();
        expect(within(region).getByText('رحّل المبيعات من الكاشير أو أدخل قيدًا في v2.')).toBeTruthy();
        expect(within(region).getByRole('columnheader', { name: 'الكود' })).toBeTruthy();
    });

    it('البحث بلا نتائج يعلن الحالة الفارغة ولا يخفي الرؤوس', async () => {
        stubCfo({ accounts: [account(1, { name_ar: 'الصندوق' })] });
        renderScreen();

        const region = await screen.findByRole('region', { name: TB_REGION });
        await within(region).findAllByText('الصندوق');
        fireEvent.change(screen.getByPlaceholderText('ابحث باسم الحساب أو الكود…'), {
            target: { value: 'حساب غير موجود' },
        });
        expect(region.getAttribute('data-state')).toBe('empty');
        expect(within(region).getByText('لا نتائج للبحث')).toBeTruthy();
        expect(within(region).getByRole('columnheader', { name: 'الكود' })).toBeTruthy();
    });

    it('فشل مصدر الميزان وحده: يبقى إعلان «غير متاح» وتسمية المصدر الفاشل', async () => {
        stubCfo({ trialFail: true });
        renderScreen();

        expect(await screen.findByText('ميزان المراجعة غير متاح')).toBeTruthy();
        expect(screen.getByText(/بعض المصادر لم تستجب/)).toBeTruthy();
        expect(screen.queryByRole('region', { name: TB_REGION })).toBeNull();
    });

    it('لا زر تصدير CSV للميزان — لم يكن في الشاشة القديمة ولا يُضاف الآن', async () => {
        stubCfo({ accounts: [account(1)] });
        renderScreen();

        const region = await screen.findByRole('region', { name: TB_REGION });
        await within(region).findAllByText('حساب 001');
        expect(within(region).queryByRole('button', { name: /تصدير/ })).toBeNull();
    });
});

describe('تبويبا الذمم والأصول (DataTable)', () => {
    it('فوق 200 مورد: تمرير افتراضي في جدول أعمار الذمم', async () => {
        const aging = Array.from({ length: 250 }, (_, index) => ({
            supplier: `مورد ${String(index + 1).padStart(3, '0')}`,
            total: index + 1,
            current: index + 1,
            d30: 0,
            d60: 0,
            d90: 0,
            over90: 0,
        }));
        stubCfo({ aging });
        renderScreen();

        fireEvent.click(await screen.findByRole('tab', { name: /أعمار الذمم/ }));
        const region = await screen.findByRole('region', { name: 'جدول أعمار ذمم الموردين' });
        await within(region).findAllByText('مورد 001');
        expect(region.getAttribute('data-virtualized')).toBe('true');
        expect(region.getAttribute('data-row-count')).toBe('250');
        const rendered = within(region).getAllByTestId('datatable-row');
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(250);
    });

    it('حالة error في الذمم: تنبيه وإعادة المحاولة داخل الجدول', async () => {
        const fetchMock = stubCfo({ agingFail: true });
        renderScreen();

        fireEvent.click(await screen.findByRole('tab', { name: /أعمار الذمم/ }));
        const region = await screen.findByRole('region', { name: 'جدول أعمار ذمم الموردين' });
        await vi.waitFor(() => {
            expect(region.getAttribute('data-state')).toBe('error');
        });
        expect(within(region).getByRole('alert')).toBeTruthy();
        const before = fetchMock.mock.calls.length;
        fireEvent.click(within(region).getByRole('button', { name: 'إعادة المحاولة' }));
        await vi.waitFor(() => {
            expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
        });
    });

    it('فوق 200 أصل نشط: تمرير افتراضي في جدول الأصول مع بقاء المستبعد خارج العدّ', async () => {
        const assets = Array.from({ length: 250 }, (_, index) => ({
            id: index + 1,
            name: `أصل ${String(index + 1).padStart(3, '0')}`,
            status: 'active',
            cost: 1000,
            monthly: 50,
            accumulated: 100,
            remaining: 900,
            last_month: '2026-10',
        }));
        assets.push({
            id: 999,
            name: 'أصل مستبعد',
            status: 'disposed',
            cost: 500,
            monthly: 0,
            accumulated: 500,
            remaining: 0,
            last_month: '2026-09',
        });
        stubCfo({ assets });
        renderScreen();

        fireEvent.click(await screen.findByRole('tab', { name: /الأصول والإهلاك/ }));
        const region = await screen.findByRole('region', { name: 'جدول الأصول الثابتة' });
        await within(region).findAllByText('أصل 001');
        expect(region.getAttribute('data-virtualized')).toBe('true');
        expect(region.getAttribute('data-row-count')).toBe('250');
        expect(within(region).queryByText('أصل مستبعد')).toBeNull();
    });
});
