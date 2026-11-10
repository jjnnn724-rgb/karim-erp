import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { BarList, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import {
    buildHrKpis,
    departmentDistribution,
    fetchHrSnapshot,
    pendingLeaveRows,
    weeklyAttendance,
} from '../lib/hr-dashboard';
import { errorMessage, intOf, presetRange, rangeProblem, shareOf } from '../lib/reporting';
import { FilterBar, StatCard } from '../ui';

/**
 * لوحة الموارد البشرية — مؤشرات الفريق والحضور وسلسلة الإجازات.
 * المصادر خمسة، وكل فاشل يُسمّى أسفل الشاشة بدل إخفائه.
 */
export function HrDashboard() {
    const [draft, setDraft] = useState(() => presetRange('month'));
    const [range, setRange] = useState(draft);
    const [problem, setProblem] = useState('');
    const [q, setQ] = useState('');

    const snapshotQuery = useQuery({
        queryKey: ['hr', 'dashboard', range.from, range.to],
        queryFn: ({ signal }) => fetchHrSnapshot(signal),
    });

    const snapshot = snapshotQuery.data;
    const kpis = snapshot ? buildHrKpis(snapshot) : [];
    const weekly = snapshot ? weeklyAttendance(snapshot.attendance, snapshot.today) : [];
    const distribution = snapshot ? departmentDistribution(snapshot.employees, snapshot.departments) : [];
    const pending = snapshot ? pendingLeaveRows(snapshot.leaves, snapshot.employees) : [];
    const weekTotal = weekly.reduce((sum, day) => sum + day.present, 0);

    // فلتر واجهة أمامية على طلبات الإجازة باسم الموظف
    const filteredPending = useMemo(() => {
        return pending.filter((leave) => {
            const textOk = q ? (leave.employee ?? '').includes(q) : true;
            return textOk;
        });
    }, [pending, q]);

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
                title="لوحة الموارد البشرية"
                english="HR Dashboard"
                description="الفريق والحضور والإجازات في مكان واحد — كل مصدرٍ يُعلن نفسه، والفاشل يُسمّى."
                pending={snapshotQuery.isFetching}
                onRefresh={() => {
                    void snapshotQuery.refetch();
                }}
            />
            <PrintActions title="لوحة الموارد البشرية" />

            <FilterBar
                id="hr-filter"
                from={draft.from}
                to={draft.to}
                onFrom={(value: string) => setDraft((current) => ({ ...current, from: value }))}
                onTo={(value: string) => setDraft((current) => ({ ...current, to: value }))}
                onApply={apply}
                searchLabel="بحث"
                searchPlaceholder="ابحث باسم الموظف في طلبات الإجازة…"
                searchValue={q}
                onSearchChange={(next: string) => setQ(next)}
                pending={snapshotQuery.isFetching}
                error={problem}
                data-testid="hr-filter-bar"
            />

            {snapshotQuery.isPending ? <StateLoading label="جارٍ جمع بيانات الموارد البشرية…" /> : null}

            {snapshotQuery.isError ? (
                <StateError
                    message={errorMessage(snapshotQuery.error)}
                    onRetry={() => {
                        void snapshotQuery.refetch();
                    }}
                />
            ) : null}

            {snapshot ? (
                <>
                    <ul
                        className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4"
                        aria-label="مؤشرات الموارد البشرية"
                    >
                        {kpis.map((kpi) => (
                            <StatCard
                                key={kpi.id}
                                label={kpi.label}
                                english={kpi.english}
                                value={kpi.value}
                                hint={kpi.hint}
                                tone={kpi.tone}
                            />
                        ))}
                    </ul>

                    <div className="grid gap-md lg:grid-cols-2">
                        <SectionCard
                            title="الحضور آخر ٧ أيام"
                            english="Weekly attendance"
                            actions={
                                <span className="text-body-sm text-muted" role="status">
                                    {`${intOf(weekTotal)} بصمة حضور`}
                                </span>
                            }
                        >
                            <BarList
                                ariaLabel="حضور الأيام السبعة"
                                emptyText="لا بصمات حضور في الأسبوع."
                                items={weekly.map((day) => ({
                                    label: day.date,
                                    value: `${intOf(day.present)} حاضر`,
                                    share: shareOf(day.present, Math.max(1, snapshot.employees.length)),
                                }))}
                            />
                        </SectionCard>

                        <SectionCard title="التوزيع على الأقسام" english="By department">
                            <BarList
                                ariaLabel="توزيع الموظفين على الأقسام"
                                emptyText="لا موظفين في الدليل."
                                items={distribution.map((row) => ({
                                    label: row.label,
                                    value: intOf(row.value),
                                    share: shareOf(row.value, Math.max(1, snapshot.employees.length)),
                                }))}
                            />
                        </SectionCard>
                    </div>

                    <SectionCard
                        title="إجازات بانتظار القرار"
                        english="Pending leaves"
                        actions={
                            <span className="text-body-sm text-muted" role="status">
                                {`${intOf(filteredPending.length)} طلبًا`}
                            </span>
                        }
                    >
                        {filteredPending.length === 0 ? (
                            <StateEmpty title="لا طلبات معلقة" hint="سلسلة الاعتماد فارغة الآن." />
                        ) : (
                            <TableScroll label="جدول طلبات الإجازة المعلقة">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الموظف
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                من
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                إلى
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredPending.map((leave) => (
                                            <tr
                                                key={leave.id}
                                                className="border-b border-hairline hover:bg-surface-hover"
                                            >
                                                <td className="px-sm py-xxs text-ink">{leave.employee}</td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {leave.start || '—'}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {leave.end || '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </SectionCard>

                    {snapshot.failures.length > 0 ? (
                        <p
                            className="rounded-md border border-warning bg-surface p-sm text-body-sm text-warning-text"
                            role="alert"
                        >
                            {`تعذّر قراءة: ${snapshot.failures.join(' · ')}`}
                        </p>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}
