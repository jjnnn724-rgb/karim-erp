import './CashierSales.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { BarList, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { cashierLabel, deltaText, fetchCashierSales } from '../lib/cashier-sales';
import { errorMessage, intOf, moneyOf, num, pctOf, presetRange, rangeProblem, textOf } from '../lib/reporting';
import { FilterBar, StatCard } from '../ui';

/**
 * مبيعات الكاشير — ملخّص الفترة من مرآة YaraSoft. المحصّل والصافي والضريبة
 * والمتوسطات والنسب كما حسبها الخادم؛ لا جمع في الواجهة.
 */
export function CashierSales() {
    const [draft, setDraft] = useState(() => presetRange('month'));
    const [range, setRange] = useState(draft);
    const [problem, setProblem] = useState('');

    const summaryQuery = useQuery({
        queryKey: ['cashier-sales', 'summary', range.from, range.to],
        queryFn: ({ signal }) => fetchCashierSales(range.from, range.to, signal),
    });

    const data = summaryQuery.data;
    const totals = data?.totals;
    const cashiers = data?.cashiers ?? [];
    const payments = data?.payments ?? [];
    const topItems = data?.top_items ?? [];
    const series = data?.series ?? [];
    const delta = deltaText(totals?.delta);

    // بحث نصي من الواجهة الأمامية على قائمة الكاشيريات
    const [cashierQ, setCashierQ] = useState('');
    const filteredCashiers = useMemo(() => {
        return cashiers.filter((row) => {
            const label = cashierLabel(row);
            return cashierQ ? label.includes(cashierQ) : true;
        });
    }, [cashiers, cashierQ]);

    function apply() {
        const message = rangeProblem(draft.from, draft.to, 93);
        setProblem(message);
        if (!message) {
            setRange(draft);
        }
    }

    return (
        <div className="flex flex-col gap-md premium-screen premium-cashiersales">
            <PrintActions title="مبيعات الكاشير" />
            <ReportHeader
                title="مبيعات الكاشير"
                english="Cashier Sales"
                description="محصّل الفترة وفواتيرها وطرق الدفع والكاشيريات وأعلى الأصناف — من مرآة الكاشير، بلا إعادة حساب."
                pending={summaryQuery.isFetching}
                onRefresh={() => {
                    void summaryQuery.refetch();
                }}
            />

            <FilterBar
                id="cashier-filter"
                from={draft.from}
                to={draft.to}
                onFrom={(value: string) =>
                    setDraft((current: { from: string; to: string; label: string }) => ({ ...current, from: value }))
                }
                onTo={(value: string) => setDraft((current: { from: string; to: string; label: string }) => ({ ...current, to: value }))}
                onApply={apply}
                searchLabel="بحث بالكاشير"
                searchPlaceholder="ابحث باسم الكاشير…"
                searchValue={cashierQ}
                onSearchChange={(next: string) => setCashierQ(next)}
                pending={summaryQuery.isFetching}
                error={problem}
                data-testid="cashier-filter-bar"
            />

            {summaryQuery.isPending ? <StateLoading label="جارٍ قراءة مبيعات الكاشير…" /> : null}

            {summaryQuery.isError ? (
                <StateError
                    message={errorMessage(summaryQuery.error)}
                    onRetry={() => {
                        void summaryQuery.refetch();
                    }}
                />
            ) : null}

            {data ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات مبيعات الكاشير">
                        <StatCard
                            label="المحصّل"
                            english="Collected"
                            value={moneyOf(totals?.collected)}
                            hint={delta ? `مقابل الفترة السابقة ${delta}` : `صافي بلا ضريبة ${moneyOf(totals?.ex_vat)}`}
                            tone={Number(totals?.delta ?? 0) >= 0 ? 'success' : 'danger'}
                            trend={Number(totals?.delta ?? 0) >= 0 ? 'up' : 'down'}
                            delta={delta ?? ''}
                        />
                        <StatCard
                            label="الفواتير"
                            english="Documents"
                            value={intOf(totals?.docs)}
                            hint={`${intOf(totals?.days)} يومَ تشغيل · ${intOf(totals?.cashiers)} كاشير`}
                        />
                        <StatCard
                            label="متوسط الفاتورة"
                            english="Average ticket"
                            value={moneyOf(totals?.avg_invoice)}
                            hint={`متوسط اليوم ${moneyOf(totals?.avg_day)}`}
                        />
                        <StatCard
                            label="ضريبة القيمة المضافة"
                            english="VAT"
                            value={moneyOf(totals?.vat)}
                            hint={`خصم ${moneyOf(totals?.discount)} · بنود ${intOf(totals?.lines)}`}
                        />
                    </ul>

                    <div className="grid gap-md lg:grid-cols-2">
                        <SectionCard title="طرق الدفع" english="Payment methods">
                            <BarList
                                ariaLabel="توزيع طرق الدفع"
                                emptyText="لا مدفوعات في الفترة."
                                items={payments.map((payment) => ({
                                    label: textOf(payment.label) || textOf(payment.key) || 'أخرى',
                                    value: moneyOf(payment.amount),
                                    share: num(payment.share),
                                }))}
                            />
                        </SectionCard>

                        <SectionCard title="الكاشيريات" english="Cashiers">
                            {filteredCashiers.length === 0 ? (
                                <StateEmpty title="لا كاشيريات" hint="لا فواتير مسجّلة في الفترة." />
                            ) : (
                                <TableScroll label="جدول مبيعات الكاشيريات">
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الكاشير
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    فواتير
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    المحصّل
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الحصة
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredCashiers.map((row) => (
                                                <tr key={textOf(row.cashier_no) || cashierLabel(row)} className="border-b border-hairline">
                                                    <td className="px-sm py-xxs text-ink">{cashierLabel(row)}</td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {intOf(row.docs)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {moneyOf(row.collected)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                        {pctOf(row.share)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                        </SectionCard>
                    </div>

                    <SectionCard
                        title="أعلى الأصناف"
                        english="Top items"
                        actions={
                            <span className="text-body-sm text-muted" role="status">
                                {`${intOf(topItems.length)} صنفًا`}
                            </span>
                        }
                    >
                        {topItems.length === 0 ? (
                            <StateEmpty title="لا أصناف" hint="لا سطور أصناف في الفترة." />
                        ) : (
                            <TableScroll label="جدول أعلى الأصناف مبيعًا">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الصنف
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الكمية
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                قبل الضريبة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                فواتير
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الحصة
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {topItems.map((item) => (
                                            <tr key={textOf(item.code) || textOf(item.name)} className="border-b border-hairline">
                                                <td className="px-sm py-xxs text-ink">{textOf(item.name) || textOf(item.code) || '—'}</td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {intOf(item.qty)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyOf(item.ex_vat)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {intOf(item.docs)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {pctOf(item.share)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </SectionCard>

                    <SectionCard title="اليوميات" english="Daily series">
                        {series.length === 0 ? (
                            <StateEmpty title="لا أيام تشغيل" hint="الفترة بلا فواتير." />
                        ) : (
                            <TableScroll label="جدول المحصّل اليومي">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                اليوم
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                فواتير
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                المحصّل
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                قبل الضريبة
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {series.map((day) => (
                                            <tr key={textOf(day.day)} className="border-b border-hairline">
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {textOf(day.day)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {intOf(day.docs)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyOf(day.collected)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyOf(day.ex_vat)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </SectionCard>
                </>
            ) : null}
        </div>
    );
}
