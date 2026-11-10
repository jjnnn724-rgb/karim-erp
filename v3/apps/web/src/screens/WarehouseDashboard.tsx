import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ReportHeader, SectionCard } from '../components/Reports';
import { PrintActions } from '../components/PrintActions';
import { FilterBar, StatCard } from '../ui';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { fetchWarehouseSnapshot } from '../lib/dashboards';
import { intOf, qtyOf, presetRange, rangeProblem } from '../lib/reporting';

/** لوحة المخزن — الأرصدة الحرجة وطوابير الاعتماد من أبواب المخزن نفسها. */
export function WarehouseDashboard() {
    const [draft, setDraft] = useState(() => presetRange('month'));
    const [range, setRange] = useState(draft);
    const [problem, setProblem] = useState('');
    const [q, setQ] = useState('');

    const snapshot = useQuery({
        queryKey: ['dashboard', 'warehouse', range.from, range.to],
        queryFn: ({ signal }) => fetchWarehouseSnapshot(signal),
    });

    const data = snapshot.data;

    // فلتر واجهة أمامية على الأصناف النافدة (بحث نصي باسم الصنف)
    const filteredLowRows = useMemo(() => {
        return (data?.lowRows ?? []).filter((row) => {
            const textOk = q ? (row.name ?? '').includes(q) : true;
            return textOk;
        });
    }, [data, q]);

    function apply() {
        const message = rangeProblem(draft.from, draft.to, 366);
        setProblem(message);
        if (!message) {
            setRange(draft);
        }
    }

    return (
        <div className="flex flex-col gap-md">
            <ReportHeader
                title="لوحة المخزن"
                english="Warehouse Dashboard"
                description="الأرصدة النافدة وتحت الحد، وطوابير الاعتماد والاستلام — قراءة من سجل المخزون والأذون والطلبات."
                pending={snapshot.isFetching}
                onRefresh={() => {
                    void snapshot.refetch();
                }}
            />
            <div className="flex justify-end gap-xs" data-erp-print-hide>
                <PrintActions title="لوحة المخزن" />
            </div>

            <FilterBar
                id="warehouse-filter"
                from={draft.from}
                to={draft.to}
                onFrom={(value: string) => setDraft((current) => ({ ...current, from: value }))}
                onTo={(value: string) => setDraft((current) => ({ ...current, to: value }))}
                onApply={apply}
                searchLabel="بحث بالأصناف"
                searchPlaceholder="ابحث باسم الصنف…"
                searchValue={q}
                onSearchChange={(next: string) => setQ(next)}
                pending={snapshot.isFetching}
                error={problem}
                data-testid="warehouse-filter-bar"
            />

            {snapshot.isPending ? <StateLoading label="جارٍ جمع لوحة المخزن…" /> : null}

            {snapshot.isError ? (
                <StateError
                    message={snapshot.error instanceof Error ? snapshot.error.message : 'خطأ غير معروف'}
                    onRetry={() => {
                        void snapshot.refetch();
                    }}
                />
            ) : null}

            {data ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات المخزن">
                        <StatCard
                            label="أصناف نافدة"
                            english="Out of stock"
                            value={intOf(data.out)}
                            hint="رصيد صفر أو سالب"
                            tone={data.out > 0 ? 'danger' : 'success'}
                        />
                        <StatCard
                            label="تحت الحد"
                            english="Below minimum"
                            value={intOf(data.low)}
                            hint="رصيد أقل من حد إعادة الطلب"
                            tone={data.low > 0 ? 'warning' : 'success'}
                        />
                        <StatCard label="أصناف سليمة" english="Healthy" value={intOf(data.ok)} hint="فوق الحد" />
                        <StatCard
                            label="إجمالي الأصناف"
                            english="Items"
                            value={intOf(data.total)}
                            hint="الصفوف المقروءة من المخزون"
                        />
                    </ul>

                    <div className="grid gap-md lg:grid-cols-2">
                        <SectionCard title="طوابير القرار" english="Queues">
                            <ul className="flex list-none flex-col gap-xxs p-sm">
                                <li className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-md">
                                    <span className="text-ink">بانتظار اعتماد الشيف</span>
                                    <span className="erp-numeric text-ink" dir="ltr">
                                        {intOf(data.queues.chef)}
                                    </span>
                                </li>
                                <li className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-md">
                                    <span className="text-ink">بانتظار اعتماد المخزن</span>
                                    <span className="erp-numeric text-ink" dir="ltr">
                                        {intOf(data.queues.warehouse)}
                                    </span>
                                </li>
                                <li className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-md">
                                    <span className="text-ink">طلبات شراء مفتوحة</span>
                                    <span className="erp-numeric text-ink" dir="ltr">
                                        {intOf(data.queues.purchase)}
                                    </span>
                                </li>
                                <li className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-md">
                                    <span className="text-ink">أذون الشهر / الطلبات</span>
                                    <span className="erp-numeric text-ink" dir="ltr">
                                        {`${intOf(data.queues.dispatches)} / ${intOf(data.queues.purchases)}`}
                                    </span>
                                </li>
                            </ul>
                        </SectionCard>

                        <SectionCard title="أصناف تحتاج قرارًا" english="Needs attention">
                            {filteredLowRows.length === 0 ? (
                                <StateEmpty title="لا نواقص" hint="كل الأصناف فوق حد إعادة الطلب." />
                            ) : (
                                <TableScroll label="جدول الأصناف النافدة وتحت الحد">
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الصنف
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الرصيد
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الحد
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الحالة
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredLowRows.map((row) => (
                                                <tr key={row.id} className="border-b border-hairline">
                                                    <td className="px-sm py-xxs text-ink">
                                                        {row.name}{' '}
                                                        <span className="text-caption text-faint" dir="ltr">
                                                            {row.unit}
                                                        </span>
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {qtyOf(row.qty)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                        {qtyOf(row.minQty)}
                                                    </td>
                                                    <td className="px-sm py-xxs text-body-sm">
                                                        <span
                                                            className={
                                                                row.state === 'نافد'
                                                                    ? 'text-danger-text'
                                                                    : 'text-warning-text'
                                                            }
                                                        >
                                                            {row.state}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                        </SectionCard>
                    </div>

                    {data.failures.length > 0 ? (
                        <p
                            className="rounded-md border border-warning bg-surface p-sm text-body-sm text-warning-text"
                            role="alert"
                        >
                            {`تعذّر قراءة: ${data.failures.join(' · ')}`}
                        </p>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
