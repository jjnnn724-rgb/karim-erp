import './ReceivedAnalyzer.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, RangeControls, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { errorMessage, intOf, presetRange, qtyOf, rangeProblem, textOf } from '../lib/reporting';
import { DISPATCH_STATUS_AR, fetchReceivedDispatches, fetchReceivedItems, receivedLabel, YARA_MAX_DAYS } from '../lib/yara-reports';

const numOf = (value: unknown): number => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * تحليل المستلَم — ما استلمته الأقسام في الفترة: بنود المستلَم وأذون الاستلام.
 * المجاميع هنا كميات على الصفوف الواصلة؛ لا مبالغ ولا تكلفة تُستنتج.
 */
export function ReceivedAnalyzer() {
    const [draft, setDraft] = useState(() => presetRange('week'));
    const [range, setRange] = useState(draft);
    const [problem, setProblem] = useState('');

    const itemsQuery = useQuery({
        queryKey: ['yara', 'received-items', range.from, range.to],
        queryFn: ({ signal }) => fetchReceivedItems(range.from, range.to, signal),
    });

    const dispatchesQuery = useQuery({
        queryKey: ['yara', 'received-dispatches', range.from, range.to],
        queryFn: ({ signal }) => fetchReceivedDispatches(range.from, range.to, signal),
    });

    const items = itemsQuery.data?.rows ?? [];
    const dispatches = dispatchesQuery.data?.rows ?? [];
    const qty = items.reduce((sum, row) => sum + numOf(row.qty), 0);
    const approved = items.reduce((sum, row) => sum + numOf(row.approved_qty), 0);
    const variance = items.reduce((sum, row) => sum + numOf(row.variance_qty), 0);

    function apply() {
        const message = rangeProblem(draft.from, draft.to, YARA_MAX_DAYS);
        setProblem(message);
        if (!message) {
            setRange(draft);
        }
    }

    return (
        <div className="screen-premium flex flex-col gap-md">
            <PrintActions title="تحليل المستلَم" />
            <ReportHeader
                title="تحليل المستلَم"
                english="Received Analyzer"
                description="بنود الاستلام وأذونها في الفترة: الكمية المرسلة والمستلمة والفرق، بحالة كل إذن."
                pending={itemsQuery.isFetching || dispatchesQuery.isFetching}
                onRefresh={() => {
                    void itemsQuery.refetch();
                    void dispatchesQuery.refetch();
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
                        pending={itemsQuery.isFetching || dispatchesQuery.isFetching}
                    />
                    {problem ? (
                        <p role="alert" className="mt-xs text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                </div>
            </SectionCard>

            {itemsQuery.isPending ? <StateLoading label="جارٍ قراءة المستلَم…" /> : null}

            {itemsQuery.isError ? (
                <StateError
                    message={errorMessage(itemsQuery.error)}
                    onRetry={() => {
                        void itemsQuery.refetch();
                    }}
                />
            ) : null}

            {itemsQuery.data ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات المستلَم">
                        <KpiCard
                            label="بنود المستلَم"
                            english="Received lines"
                            value={intOf(items.length)}
                            hint={`${intOf(itemsQuery.data.count ?? dispatches.length)} إذنًا`}
                        />
                        <KpiCard label="الكمية المرسلة" english="Sent qty" value={qtyOf(qty)} hint="مجموع صفوف النافذة" />
                        <KpiCard
                            label="الكمية المستلمة"
                            english="Approved qty"
                            value={qtyOf(approved)}
                            hint={`فرق ${qtyOf(variance)}`}
                            tone={variance === 0 ? 'success' : 'warning'}
                        />
                        <KpiCard
                            label="أذون مستلمة"
                            english="Dispatches"
                            value={intOf(dispatches.length)}
                            hint={textOf(dispatches[0]?.lastSyncAt) || 'من سجل الاستلام'}
                        />
                    </ul>

                    <div className="grid gap-md lg:grid-cols-2">
                        <SectionCard title="بنود الاستلام" english="Received items">
                            {items.length === 0 ? (
                                <StateEmpty title="لا بنود مستلمة" hint="لا استلام مسجّل في الفترة." />
                            ) : (
                                <TableScroll label="جدول بنود المستلَم">
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الصنف
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    القسم
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    مرسل
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    مستلم
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الفرق
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {items.map((row, index) => (
                                                <tr key={`${receivedLabel(row)}-${String(index)}`} className="border-b border-hairline">
                                                    <td className="px-sm py-xxs text-ink">{receivedLabel(row)}</td>
                                                    <td className="px-sm py-xxs text-body-sm text-muted">
                                                        {textOf(row.depts) || textOf(row.dept_name) || '—'}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {qtyOf(row.qty)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {qtyOf(row.approved_qty)}
                                                    </td>
                                                    <td
                                                        className={`erp-numeric px-sm py-xxs ${
                                                            numOf(row.variance_qty) !== 0 ? 'text-warning-text' : 'text-muted'
                                                        }`}
                                                        dir="ltr"
                                                    >
                                                        {qtyOf(row.variance_qty)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                        </SectionCard>

                        <SectionCard title="أذون الصرف" english="Dispatches">
                            {dispatchesQuery.isError ? (
                                <StateError
                                    message={errorMessage(dispatchesQuery.error)}
                                    onRetry={() => {
                                        void dispatchesQuery.refetch();
                                    }}
                                />
                            ) : dispatches.length === 0 ? (
                                <StateEmpty title="لا أذون" hint="لا أذون صرف في الفترة." />
                            ) : (
                                <TableScroll label="جدول أذون الاستلام">
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الإذن
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    القسم
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    التاريخ
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الحالة
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    أصناف / كمية
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dispatches.map((row) => (
                                                <tr key={row.id} className="border-b border-hairline">
                                                    <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                        {row.id}
                                                    </td>
                                                    <td className="px-sm py-xxs text-body-sm">
                                                        {textOf(row.dept_name) || textOf(row.dept_code) || '—'}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                        {textOf(row.date) || '—'}
                                                    </td>
                                                    <td className="px-sm py-xxs text-body-sm">
                                                        {DISPATCH_STATUS_AR[textOf(row.status)] ?? textOf(row.status) ?? '—'}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-body-sm" dir="ltr">
                                                        {`${intOf(row.items_count)} / ${qtyOf(row.total_qty)}`}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                        </SectionCard>
                    </div>
                </>
            ) : null}
        </div>
    );
}
