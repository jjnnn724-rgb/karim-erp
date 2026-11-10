import './SalesAnalyzer.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { BarList, KpiCard, RangeControls, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { fetchItemSales, groupItemSales, YARA_MAX_DAYS } from '../lib/yara-reports';
import { errorMessage, intOf, moneyOf, presetRange, qtyOf, rangeProblem, shareOf } from '../lib/reporting';
import { PrintActions } from '../components/PrintActions';

/**
 * تحليل مبيعات الأصناف — صفوف `item-sales` مجمّعة برمز الصنف على النافذة.
 * المجاميع من الخادم؛ التجميع هنا كمية وصافٍ على الصفوف الواصلة فقط.
 */
export function SalesAnalyzer() {
    const [draft, setDraft] = useState(() => presetRange('week'));
    const [range, setRange] = useState(draft);
    const [problem, setProblem] = useState('');

    const itemsQuery = useQuery({
        queryKey: ['yara', 'item-sales', range.from, range.to],
        queryFn: ({ signal }) => fetchItemSales(range.from, range.to, signal),
    });

    const data = itemsQuery.data;
    const grouped = groupItemSales(data?.rows ?? []);
    const topNet = grouped.length > 0 ? Number(grouped[0]?.net ?? 0) : 0;
    const top = grouped.slice(0, 8);

    function apply() {
        const message = rangeProblem(draft.from, draft.to, YARA_MAX_DAYS);
        setProblem(message);
        if (!message) {
            setRange(draft);
        }
    }

    return (
        <div className="screen-premium flex flex-col gap-md">
            <PrintActions title="تحليل مبيعات الأصناف" />
            <ReportHeader
                title="تحليل مبيعات الأصناف"
                english="Item Sales Analyzer"
                description="مبيعات الأصناف من مرآة YaraSoft: كميات وفواتير وصافي وضريبة، مجمّعة برمز الصنف."
                pending={itemsQuery.isFetching}
                onRefresh={() => {
                    void itemsQuery.refetch();
                }}
            />

            <SectionCard title="الفترة" english="Period">
                <div className="p-sm">
                    <RangeControls
                        from={draft.from}
                        to={draft.to}
                        onFrom={(value) => {
                            setDraft((current) => ({ ...current, from: value }));
                        }}
                        onTo={(value) => {
                            setDraft((current) => ({ ...current, to: value }));
                        }}
                        onApply={apply}
                        pending={itemsQuery.isFetching}
                    />
                    {problem ? (
                        <p role="alert" className="mt-xs text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                </div>
            </SectionCard>

            {itemsQuery.isPending ? <StateLoading label="جارٍ تحليل مبيعات الأصناف…" /> : null}

            {itemsQuery.isError ? (
                <StateError
                    message={errorMessage(itemsQuery.error)}
                    onRetry={() => {
                        void itemsQuery.refetch();
                    }}
                />
            ) : null}

            {data ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات مبيعات الأصناف">
                        <KpiCard
                            label="صافي المبيعات"
                            english="Net"
                            value={moneyOf(data.totals?.net)}
                            hint={`ضريبة ${moneyOf(data.totals?.vat)}`}
                        />
                        <KpiCard
                            label="الفواتير"
                            english="Invoices"
                            value={intOf(data.totals?.invoices)}
                            hint="فواتير المرآة في الفترة"
                        />
                        <KpiCard
                            label="الكميات المباعة"
                            english="Quantity"
                            value={qtyOf(data.totals?.qty)}
                            hint={`${intOf(grouped.length)} صنفًا مختلفًا`}
                        />
                        <KpiCard
                            label="صفوف المصدر"
                            english="Source rows"
                            value={intOf((data.rows ?? []).length)}
                            hint="الصفوف قبل التجميع برمز الصنف"
                        />
                    </ul>

                    <div className="grid gap-md lg:grid-cols-2">
                        <SectionCard title="أعلى الأصناف صافيًا" english="Top items">
                            <BarList
                                ariaLabel="أعلى الأصناف صافيًا"
                                emptyText="لا أصناف في الفترة."
                                items={top.map((row) => ({
                                    label: row.label,
                                    value: moneyOf(row.net),
                                    share: shareOf(row.net, topNet),
                                }))}
                            />
                        </SectionCard>

                        <SectionCard title="إجمالي الأصناف" english="All items">
                            {grouped.length === 0 ? (
                                <StateEmpty title="لا مبيعات أصناف" hint="لا سطور أصناف في هذه الفترة." />
                            ) : (
                                <TableScroll label="جدول مبيعات الأصناف">
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
                                                    فواتير
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الصافي
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {grouped.map((row) => (
                                                <tr key={row.code || row.label} className="border-b border-hairline">
                                                    <td className="px-sm py-xxs text-ink">{row.label}</td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {qtyOf(row.qty)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {intOf(row.invoices)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {moneyOf(row.net)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                        </SectionCard>
                    </div>

                    <p className="text-caption text-muted" role="status">
                        {`سقف الفترة ${intOf(YARA_MAX_DAYS)} يومًا · تجميع برمز الصنف`}
                    </p>
                </>
            ) : null}
        </div>
    );
}

