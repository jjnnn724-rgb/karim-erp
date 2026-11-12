import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { BarList, KpiCard, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { fetchMonthlyComparison, latestMonth, MONTH_OPTIONS, topMonth } from '../lib/monthly-comparison';
import { errorMessage, intOf, moneyOf, pctOf, shareOf } from '../lib/reporting';

/**
 * المقارنة الشهرية — شهور النافذة كما يرتّبها الخادم، مع مجاميعه.
 * الهامش والصافي من الخادم؛ الشاشة ترتّب الجدول وتبرز آخر شهر فقط.
 */
export function MonthlyComparison() {
    const [months, setMonths] = useState<number>(12);

    const comparisonQuery = useQuery({
        queryKey: ['finance', 'monthly-comparison', months],
        queryFn: ({ signal }) => fetchMonthlyComparison(months, signal),
    });

    const data = comparisonQuery.data;
    const rows = data?.months ?? [];
    const latest = latestMonth(data);
    const best = topMonth(data);
    const bestRevenue = Number(best?.revenue ?? 0);
    const chart = [...rows].sort((a, b) => Number(b.revenue ?? 0) - Number(a.revenue ?? 0)).slice(0, 8);

    return (
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-lg">
            <ReportHeader
                title="المقارنة الشهرية"
                english="Monthly Comparison"
                description="إيراد وتكلفة وصافي وهامش كل شهر."
                pending={comparisonQuery.isFetching}
                onRefresh={() => {
                    void comparisonQuery.refetch();
                }}
            />
            <PrintActions title="المقارنة الشهرية" />

            <SectionCard title="النافذة" english="Window">
                <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-xs border-0 p-sm" aria-label="عدد الشهور">
                    {MONTH_OPTIONS.map((option) => (
                        <button
                            key={option}
                            type="button"
                            aria-pressed={months === option}
                            onClick={() => {
                                setMonths(option);
                            }}
                            className={`rounded-md border px-md py-xs text-button-md ${
                                months === option
                                    ? 'border-primary bg-primary text-on-primary'
                                    : 'border-hairline-strong bg-surface text-ink hover:bg-surface-hover'
                            }`}
                        >
                            {`${String(option)} شهرًا`}
                        </button>
                    ))}
                </fieldset>
            </SectionCard>

            {comparisonQuery.isPending ? <StateLoading label="جارٍ قراءة المقارنة الشهرية…" /> : null}

            {comparisonQuery.isError ? (
                <StateError
                    message={errorMessage(comparisonQuery.error)}
                    onRetry={() => {
                        void comparisonQuery.refetch();
                    }}
                />
            ) : null}

            {data ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات المقارنة الشهرية">
                        <KpiCard
                            label="إيراد آخر شهر"
                            english="Latest revenue"
                            value={moneyOf(latest?.revenue)}
                            hint={String(latest?.month ?? '—')}
                        />
                        <KpiCard
                            label="صافي آخر شهر"
                            english="Latest net"
                            value={moneyOf(latest?.net_profit)}
                            hint={pctOf(latest?.margin_pct)}
                            tone={Number(latest?.net_profit ?? 0) < 0 ? 'danger' : 'success'}
                        />
                        <KpiCard
                            label="إجمالي النافذة"
                            english="Window revenue"
                            value={moneyOf(data.totals?.revenue)}
                            hint={`تكلفة ${moneyOf(data.totals?.cost)} · هامش ${pctOf(data.totals?.margin_pct)}`}
                        />
                        <KpiCard
                            label="أعلى شهر"
                            english="Best month"
                            value={String(best?.month ?? '—')}
                            hint={`إيراد ${moneyOf(best?.revenue)}`}
                        />
                    </ul>

                    <SectionCard title="الشهور" english="Months">
                        {rows.length === 0 ? (
                            <StateEmpty title="لا شهور في النافذة" hint="لا حركة مالية مسجّلة في هذه النافذة." />
                        ) : (
                            <TableScroll label="جدول المقارنة الشهرية">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الشهر
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الإيراد
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                التكلفة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الصافي
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الهامش
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                فواتير
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row) => (
                                            <tr key={String(row.month ?? '')} className="border-b border-hairline">
                                                <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                    {String(row.month ?? row.label ?? '—')}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyOf(row.revenue)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyOf(row.cost)}
                                                </td>
                                                <td
                                                    className={`erp-numeric px-sm py-xxs ${
                                                        Number(row.net_profit ?? 0) < 0 ? 'text-danger-text' : ''
                                                    }`}
                                                    dir="ltr"
                                                >
                                                    {moneyOf(row.net_profit)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {pctOf(row.margin_pct)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {intOf(row.invoices ?? row.orders)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </SectionCard>

                    <SectionCard title="أعلى الشهور إيرادًا" english="Top months by revenue">
                        <BarList
                            ariaLabel="أعلى الشهور إيرادًا"
                            emptyText="لا شهور في النافذة."
                            items={chart.map((row) => ({
                                label: String(row.month ?? '—'),
                                value: moneyOf(row.revenue),
                                share: shareOf(Number(row.revenue ?? 0), bestRevenue),
                            }))}
                        />
                    </SectionCard>
                </>
            ) : null}
        </div>
    );
}
