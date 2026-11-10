import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ReportHeader, SectionCard } from '../components/Reports';
import { PrintActions } from '../components/PrintActions';
import { FilterBar, StatCard } from '../ui';
import { StateEmpty, StateError, StateLoading } from '../components/TableState';
import { fetchDeptHeadSnapshot } from '../lib/dashboards';
import { intOf, moneyOf, presetRange, rangeProblem } from '../lib/reporting';

const STATUS_AR: Record<string, string> = {
    pending: 'معلّق',
    chef_approved: 'اعتماد الشيف',
    approved: 'معتمد — بانتظار الاستلام',
    partially_received: 'استلام جزئي',
    received: 'مستلم',
    rejected: 'مرفوض',
    unknown: 'بلا حالة',
};

/** لوحة رئيس القسم — القسم ونطاقه ومصروفاته وأذونه من لوحة القسم على الخادم. */
export function DeptHeadDashboard() {
    const [draft, setDraft] = useState(() => presetRange('month'));
    const [range, setRange] = useState(draft);
    const [problem, setProblem] = useState('');
    const [q, setQ] = useState('');

    const snapshot = useQuery({
        queryKey: ['dashboard', 'dept-head', range.from, range.to],
        queryFn: ({ signal }) => fetchDeptHeadSnapshot(signal),
    });

    const data = snapshot.data;

    // فلاتر واجهة أمامية على المصروفات والأذون (نطاق تاريخ + بحث نصي)
    const filteredSources = useMemo(() => {
        return (data?.sources ?? []).filter((source) => {
            const textOk = q ? (source.label ?? '').includes(q) : true;
            return textOk;
        });
    }, [data, q]);

    const filteredDispatches = useMemo(() => {
        return (data?.dispatchStatuses ?? []).filter((status) => {
            const textOk = q ? ((STATUS_AR[status.key] ?? status.key) ?? '').includes(q) : true;
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
                title="لوحة رئيس القسم"
                english="Dept Head Dashboard"
                description="قسمك ونطاقه الفرعي، ومصروفاته بحسب المصدر، وأذون الصرف بمراحلها — النطاق محسوم على الخادم."
                pending={snapshot.isFetching}
                onRefresh={() => {
                    void snapshot.refetch();
                }}
            />
            <div className="flex justify-end gap-xs" data-erp-print-hide>
                <PrintActions title="لوحة رئيس القسم" />
            </div>

            <FilterBar
                id="dept-head-filter"
                from={draft.from}
                to={draft.to}
                onFrom={(value: string) => setDraft((current) => ({ ...current, from: value }))}
                onTo={(value: string) => setDraft((current) => ({ ...current, to: value }))}
                onApply={apply}
                searchLabel="بحث"
                searchPlaceholder="ابحث في المصروفات والأذون…"
                searchValue={q}
                onSearchChange={(next: string) => setQ(next)}
                pending={snapshot.isFetching}
                error={problem}
                data-testid="dept-head-filter-bar"
            />

            {snapshot.isPending ? <StateLoading label="جارٍ جمع لوحة القسم…" /> : null}

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
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات لوحة القسم">
                        <StatCard
                            label="القسم"
                            english="Department"
                            value={data.deptName || data.deptCode || '—'}
                            hint={data.deptCode ? `الكود: ${data.deptCode}` : 'لا كود قسم معلن'}
                        />
                        <StatCard
                            label="مصروفات القسم"
                            english="Expenses"
                            value={moneyOf(data.expensesTotal)}
                            hint={`${intOf(data.expensesCount)} حركة مسجلة`}
                            tone="warning"
                        />
                        <StatCard
                            label="أذون الصرف"
                            english="Dispatches"
                            value={intOf(data.dispatchTotal)}
                            hint="إجمالي أذون القسم"
                        />
                        <StatCard
                            label="أقسام فرعية"
                            english="Sub-departments"
                            value={intOf(data.subDepartments.length)}
                            hint={data.subDepartments.join(' · ') || 'لا أقسام فرعية'}
                        />
                    </ul>

                    <div className="grid gap-md lg:grid-cols-2">
                        <SectionCard title="المصروفات بحسب المصدر" english="By source">
                            {filteredSources.length === 0 ? (
                                <StateEmpty title="لا مصروفات مسجلة" hint="لم تُسجَّل حركة مصروف لهذا القسم." />
                            ) : (
                                <ul className="flex list-none flex-col gap-xxs p-sm">
                                    {filteredSources.map((source) => (
                                        <li
                                            key={source.key}
                                            className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-md"
                                        >
                                            <span className="text-ink">
                                                {source.label}{' '}
                                                <span className="text-caption text-faint">
                                                    ({intOf(source.count)})
                                                </span>
                                            </span>
                                            <span className="erp-numeric text-ink" dir="ltr">
                                                {moneyOf(source.total)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </SectionCard>

                        <SectionCard title="أذون الصرف بالحالة" english="Dispatches by status">
                            {filteredDispatches.length === 0 ? (
                                <StateEmpty title="لا أذون هذا الشهر" hint="لا أذون صرف مسجلة للقسم." />
                            ) : (
                                <ul className="flex list-none flex-col gap-xxs p-sm">
                                    {filteredDispatches.map((status) => (
                                        <li
                                            key={status.key}
                                            className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-md"
                                        >
                                            <span className="text-ink">
                                                {STATUS_AR[status.key] ?? status.key}
                                            </span>
                                            <span className="erp-numeric text-ink" dir="ltr">
                                                {intOf(status.count)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
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
