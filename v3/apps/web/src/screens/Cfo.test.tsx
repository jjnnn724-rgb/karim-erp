import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { ToastProvider } from '../ui/Toast';
import { Cfo } from './Cfo';

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
        expect(screen.getByText('الصندوق')).toBeTruthy();
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
                        centers: [{ cc: 'CC-KITCHEN', cc_name: 'المطبخ', revenue: 900, cogs: 300, expense: 100, net: 500 }],
                    });
                }
                if (url.includes('/api/accounting/ap-aging')) {
                    return json({
                        ok: true,
                        count: 1,
                        total: 500,
                        aging: [{ supplier: 'مورد الخضار', total: 500, current: 100, d30: 200, d60: 100, d90: 50, over90: 50 }],
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
        expect(await screen.findByText('مورد الخضار')).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: /التسوية البنكية/ }));
        expect(await screen.findByText('تحويل وارد')).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: /الأصول والإهلاك/ }));
        expect(await screen.findByText('فرن مخبز')).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: /العهد/ }));
        expect(await screen.findByText(/عهدة مساء/)).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: /الموازنات/ }));
        expect(await screen.findByText('موازنة المشتريات')).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: /سجل التنبيهات/ }));
        expect(await screen.findByText('ورديات عالقة')).toBeTruthy();
    });
});
