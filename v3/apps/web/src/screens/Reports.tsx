import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, RangeControls, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { errorMessage, intOf, moneyOf, num, presetRange, qtyOf, rangeProblem } from '../lib/reporting';
import {
    fetchSalesReport,
    GROUP_LABELS,
    GROUP_OPTIONS,
    type GroupBy,
    ITEM_ROWS_CAP,
    PAYMENT_AR,
    reportRowLabel,
    reportRowQty,
} from '../lib/reports';

/**
 * تقرير مبيعات نقطة البيع — تجميع الخادم حسب قسم أو كاشير أو صنف.
 * بيان الفترة من `summary`، والصفوف كما رتّبها الخادم (الأعلى صافيًا أولًا).
 */
export function Reports() {
    const [draft, setDraft] = useState(() => presetRange('month'));
    const [range, setRange] = useState(draft);
    const [groupBy, setGroupBy] = useState<GroupBy>('department');
    const [problem, setProblem] = useState('');

    const reportQuery = useQuery({
        queryKey: ['pos', 'sales-report', range.from, range.to, groupBy],
        queryFn: ({ signal }) => fetchSalesReport(range.from, range.to, groupBy, signal),
    });

    const report = reportQuery.data;
    const summary = report?.summary;
    const rows = report?.rows ?? [];
    const payments = Object.entries(summary?.payment_methods ?? {});

    function apply() {
        const message = rangeProblem(draft.from, draft.to, 366);
        setProblem(message);
        if (!message) {
            setRange(draft);
        }
    }

    return (
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-lg">
            <ReportHeader
                title="التقارير"
                english="POS Sales Report"
                description="مبيعات نقطة البيع المسجّلة: فواتير وصافي وخصم وضريبة وأصناف، مجمّعة حسب القسم أو الكاشير أو الصنف."
                pending={reportQuery.isFetching}
                onRefresh={() => {
                    void reportQuery.refetch();
                }}
            />
            <PrintActions title="التقارير — مبيعات نقطة البيع" />

            <SectionCard title="النطاق" english="Scope">
                <div className="flex flex-col gap-sm p-sm">
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
                        pending={reportQuery.isFetching}
                    />
                    <div className="flex flex-wrap items-center gap-xs" role="group" aria-label="التجميع">
                        {GROUP_OPTIONS.map((option) => (
                            <button
                                key={option.key}
                                type="button"
                                aria-pressed={groupBy === option.key}
                                onClick={() => {
                                    setGroupBy(option.key);
                                }}
                                className={`rounded-md border px-md py-xs text-button-md ${
                                    groupBy === option.key
                                        ? 'border-primary bg-primary text-on-primary'
                                        : 'border-hairline-strong bg-surface text-ink hover:bg-surface-hover'
                                }`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    {problem ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                </div>
            </SectionCard>

            {reportQuery.isPending ? <StateLoading label="جارٍ جمع تقرير المبيعات…" /> : null}

            {reportQuery.isError ? (
                <StateError
                    message={errorMessage(reportQuery.error)}
                    onRetry={() => {
                        void reportQuery.refetch();
                    }}
                />
            ) : null}

            {report ? (
                <>
                    <ul
                        className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4"
                        aria-label="مؤشرات تقرير المبيعات"
                    >
                        <KpiCard
                            label="صافي المبيعات"
                            english="Net sales"
                            value={moneyOf(summary?.net_sales)}
                            hint={`قبل الضريبة ${moneyOf(summary?.subtotal_sales)}`}
                        />
                        <KpiCard
                            label="الفواتير"
                            english="Invoices"
                            value={intOf(summary?.invoice_count)}
                            hint={`متوسط الفاتورة ${moneyOf(summary?.avg_ticket)}`}
                        />
                        <KpiCard
                            label="الخصم والضريبة"
                            english="Discount & VAT"
                            value={moneyOf(summary?.tax_total)}
                            hint={`خصم ${moneyOf(summary?.discount_total)}`}
                            tone="warning"
                        />
                        <KpiCard
                            label="الأصناف المباعة"
                            english="Items sold"
                            value={qtyOf(summary?.items_qty)}
                            hint={`${intOf(summary?.unique_items)} صنفًا مختلفًا`}
                        />
                    </ul>

                    <SectionCard title="طرق الدفع" english="Payment methods">
                        {payments.length === 0 ? (
                            <StateEmpty title="لا مدفوعات مسجّلة" hint="لم تُسجَّل مدفوعات لهذه الفترة." />
                        ) : (
                            <ul className="flex list-none flex-wrap gap-xs p-sm">
                                {payments.map(([method, amount]) => (
                                    <li
                                        key={method}
                                        className="rounded-md border border-hairline bg-surface-sunken px-sm py-xs text-body-sm"
                                    >
                                        <span className="text-muted">{PAYMENT_AR[method] ?? method}</span>{' '}
                                        <span className="erp-numeric ms-xs text-ink" dir="ltr">
                                            {moneyOf(amount)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </SectionCard>

                    <SectionCard
                        title={`المبيعات حسب ${GROUP_LABELS[groupBy]}`}
                        english="Grouped rows"
                        actions={
                            <span className="text-body-sm text-muted" role="status">
                                {`${intOf(rows.length)} صفًا`}
                            </span>
                        }
                    >
                        {rows.length === 0 ? (
                            <StateEmpty title="لا صفوف" hint="لا فواتير معتمدة في هذه الفترة." />
                        ) : (
                            <TableScroll label="جدول صفوف تقرير المبيعات">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                {GROUP_LABELS[groupBy]}
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                فواتير
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                قبل الضريبة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الخصم
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الضريبة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الصافي
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الكمية
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row, index) => (
                                            <tr
                                                key={`${reportRowLabel(row, groupBy)}-${String(index)}`}
                                                className="border-b border-hairline hover:bg-surface-hover"
                                            >
                                                <td className="px-sm py-xxs text-ink">
                                                    {reportRowLabel(row, groupBy)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {intOf(row.invoice_count)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyOf(row.subtotal_sales)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {moneyOf(row.discount_total)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {moneyOf(row.tax_total)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                    {moneyOf(row.net_sales)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-body-sm" dir="ltr">
                                                    {qtyOf(reportRowQty(row, groupBy))}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                        {groupBy === 'item' && rows.length >= ITEM_ROWS_CAP ? (
                            <p
                                className="border-t border-hairline px-sm py-xs text-caption text-warning-text"
                                role="status"
                            >
                                {`النافذة مقصوصة عند ${intOf(ITEM_ROWS_CAP)} صنفًا — الأعلى صافيًا أولًا.`}
                            </p>
                        ) : null}
                        <p className="border-t border-hairline px-sm py-xs text-caption text-muted" role="status">
                            {`${num(summary?.invoice_count) > 0 ? 'فواتير معتمدة (issued/reported)' : 'لا فواتير'} · فلاتر القسم ${
                                report.filters?.department_id ? String(report.filters.department_id) : 'كلها'
                            }`}
                        </p>
                    </SectionCard>
                </>
            ) : null}
        </div>
    );
}
