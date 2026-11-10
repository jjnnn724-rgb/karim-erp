import './Payroll.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { fetchHrDepartments } from '../lib/employees';
import { formatInt } from '../lib/inventory-register';
import {
    currentMonth,
    fetchPayrollRuns,
    fetchPayrollSheet,
    payrollRunToRow,
    runsSummary,
    searchSheetRows,
    sheetRow,
    sheetSummary,
} from '../lib/payroll';

type PayrollView = 'all' | 'approved' | 'other';

function payrollViewFrom(value: string): PayrollView {
    if (value === 'approved' || value === 'other') {
        return value;
    }
    return 'all';
}

function Money({ value }: { value: string }) {
    return (
        <span className="erp-numeric" dir="ltr">
            {value}
        </span>
    );
}

function Kpi({ label, english, value, hint }: { label: string; english: string; value: string; hint: string }) {
    return (
        <li className="rounded-lg border border-hairline bg-surface p-md shadow-card">
            <p className="text-label-md text-muted">
                {label}{' '}
                <span className="text-caption text-faint" dir="ltr" lang="en">
                    {english}
                </span>
            </p>
            <p className="erp-numeric mt-xs text-heading-lg text-ink" dir="ltr">
                {value}
            </p>
            <p className="mt-xxs text-caption text-muted">{hint}</p>
        </li>
    );
}

export function Payroll() {
    const [month, setMonth] = useState(() => currentMonth());
    const [query, setQuery] = useState('');
    const [view, setView] = useState<PayrollView>('all');

    const runsQuery = useQuery({
        queryKey: ['payroll-runs'],
        queryFn: ({ signal }) => fetchPayrollRuns(signal),
    });
    const sheetQuery = useQuery({
        queryKey: ['payroll-sheet', month],
        queryFn: ({ signal }) => fetchPayrollSheet(month, signal),
    });
    const departmentsQuery = useQuery({
        queryKey: ['payroll-departments'],
        queryFn: ({ signal }) => fetchHrDepartments(signal),
    });

    const runs = useMemo(() => (runsQuery.data ?? []).map(payrollRunToRow), [runsQuery.data]);
    const summary = useMemo(() => runsSummary(runs), [runs]);
    const deptByCode = useMemo(
        () => new Map((departmentsQuery.data ?? []).map((department) => [String(department.code), department])),
        [departmentsQuery.data],
    );
    const sheetRows = useMemo(
        () =>
            (sheetQuery.data?.employees ?? []).map((employee) =>
                sheetRow(employee, deptByCode, sheetQuery.data?.monthDays.get(String(employee.id)) ?? 0),
            ),
        [sheetQuery.data, deptByCode],
    );
    const search = useMemo(() => searchSheetRows(sheetRows, query), [sheetRows, query]);
    const filteredRuns = useMemo(
        () =>
            view === 'all'
                ? runs
                : runs.filter((run) => (view === 'approved' ? run.status === 'approved' : run.status !== 'approved')),
        [runs, view],
    );
    const visibleSheetSummary = useMemo(() => sheetSummary(search.rows), [search.rows]);

    return (
        <div className="flex flex-col gap-md payroll-premium">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        الرواتب{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Payroll
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">
                        سجل المسيرات وكشف الموظفين.
                    </p>
                </div>
                <div className="flex items-center gap-xs">
                    <PrintActions title="الرواتب" />
                    <button
                        type="button"
                        onClick={() => {
                            void runsQuery.refetch();
                            void sheetQuery.refetch();
                            void departmentsQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات مسيرات الرواتب">
                <Kpi
                    label="عدد المسيرات"
                    english="Payroll runs"
                    value={formatInt(summary.count)}
                    hint="المسيرات التي أرسلها الخادم"
                />
                <Kpi
                    label="عدد الموظفين"
                    english="Employees"
                    value={formatInt(summary.employees)}
                    hint="مجموع أعداد الموظفين في المسيرات"
                />
                <Kpi
                    label="إجمالي الأساسي"
                    english="Basic total"
                    value={summary.basic}
                    hint="مجموع القيمة الأساسية المسجلة"
                />
                <Kpi
                    label="إجمالي الصافي"
                    english="Net total"
                    value={summary.net}
                    hint="مجموع الصافي المسجل في المسيرات"
                />
            </ul>

            <Card>
                <div className="flex flex-wrap items-center justify-between gap-sm px-sm py-xs">
                    <div>
                        <h2 className="text-heading-md text-ink">
                            سجل مسيرات الرواتب{' '}
                            <span className="text-body-sm text-muted" dir="ltr" lang="en">
                                Payroll runs
                            </span>
                        </h2>
                        <p className="text-body-sm text-muted">
                            المجاميع من أعمدة المسير المخزّنة، لا تُعاد صياغة مبالغ الخادم.
                        </p>
                    </div>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                        الحالة
                        <select
                            value={view}
                            onChange={(event) => setView(payrollViewFrom(event.target.value))}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            <option value="all">كل الحالات</option>
                            <option value="approved">معتمد</option>
                            <option value="other">أخرى أو غير محددة</option>
                        </select>
                    </label>
                </div>
                {runsQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل مسيرات الرواتب" />
                        <TableSkeleton rows={4} columns={8} />
                    </div>
                ) : null}
                {runsQuery.isError ? (
                    <StateError
                        message={runsQuery.error instanceof Error ? runsQuery.error.message : 'تعذّر تحميل المسيرات'}
                        onRetry={() => {
                            void runsQuery.refetch();
                        }}
                    />
                ) : null}
                {runsQuery.data ? (
                    filteredRuns.length ? (
                        <TableScroll label="سجل مسيرات الرواتب">
                            <table className="w-full border-collapse text-body-md">
                                <caption className="sr-only">مسيرات الرواتب</caption>
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" className="px-sm py-xs text-start">
                                            الشهر
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            الموظفون
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            الأساسي
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            أوفرتايم
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            علاوات
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            جزاءات
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            سلف
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            الصافي
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            الحالة
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredRuns.map((run) => (
                                        <tr key={run.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {run.month}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {formatInt(run.count)}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">
                                                <Money value={run.basic} />
                                            </td>
                                            <td className="px-sm py-xxs text-ink">
                                                <Money value={run.overtime} />
                                            </td>
                                            <td className="px-sm py-xxs text-ink">
                                                <Money value={run.bonuses} />
                                            </td>
                                            <td className="px-sm py-xxs text-ink">
                                                <Money value={run.penalties} />
                                            </td>
                                            <td className="px-sm py-xxs text-ink">
                                                <Money value={run.advances} />
                                            </td>
                                            <td className="px-sm py-xxs font-semibold text-ink">
                                                <Money value={run.net} />
                                            </td>
                                            <td className="px-sm py-xxs text-muted">{run.status || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                    ) : (
                        <StateEmpty
                            title="لا مسيرات في هذا العرض"
                            hint="غيّر مرشّح الحالة أو أعد المحاولة لاحقًا."
                        />
                    )
                ) : null}
            </Card>

            <Card>
                <div className="flex flex-wrap items-end justify-between gap-sm px-sm py-xs">
                    <div>
                        <h2 className="text-heading-md text-ink">
                            كشف الرواتب{' '}
                            <span className="text-body-sm text-muted" dir="ltr" lang="en">
                                Employee payroll sheet
                            </span>
                        </h2>
                        <p className="text-body-sm text-muted">
                            الموظفون النشطون وأيام الحضور للشهر المختار؛ الراتب المخفي من الخادم لا يُخمَّن.
                        </p>
                    </div>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                        شهر الكشف
                        <input
                            type="month"
                            value={month}
                            onChange={(event) => setMonth(event.target.value)}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                </div>
                <div className="flex flex-wrap items-end gap-sm px-sm pb-sm">
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                        بحث باسم الموظف
                        <input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            className="h-9 w-72 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <span className="text-body-sm text-muted" role="status" aria-live="polite">
                        {formatInt(search.hits)} موظفًا مطابقًا من {formatInt(sheetRows.length)}
                    </span>
                    {search.folded ? (
                        <span className="text-caption text-muted">
                            البحث طابق بعض الأسماء بعد تطبيع الحروف العربية.
                        </span>
                    ) : null}
                </div>
                {departmentsQuery.isError ? (
                    <p className="px-sm pb-sm text-body-sm text-warning-text" role="status">
                        تعذّر جلب أسماء الأقسام؛ تظهر القيم غير المحلولة كشرطة.
                        <button
                            type="button"
                            onClick={() => {
                                void departmentsQuery.refetch();
                            }}
                            className="ms-xs underline"
                        >
                            إعادة المحاولة
                        </button>
                    </p>
                ) : null}
                {sheetQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل كشف الرواتب" />
                        <TableSkeleton rows={5} columns={5} />
                    </div>
                ) : null}
                {sheetQuery.isError ? (
                    <StateError
                        message={
                            sheetQuery.error instanceof Error ? sheetQuery.error.message : 'تعذّر تحميل كشف الرواتب'
                        }
                        onRetry={() => {
                            void sheetQuery.refetch();
                        }}
                    />
                ) : null}
                {sheetQuery.data ? (
                    <>
                        <p className="px-sm pb-sm text-body-sm text-muted">
                            الإجمالي الظاهر: <Money value={visibleSheetSummary.total} />
                            {' · '}
                            {formatInt(visibleSheetSummary.shown)} راتبًا مرئيًا
                            {visibleSheetSummary.hidden
                                ? ` · ${formatInt(visibleSheetSummary.hidden)} مخفي بقرار الخادم`
                                : ''}
                        </p>
                        {search.rows.length ? (
                            <TableScroll label="كشف رواتب الموظفين">
                                <table className="w-full border-collapse text-body-md">
                                    <caption className="sr-only">
                                        رواتب الموظفين النشطين وأيام الحضور
                                    </caption>
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start">
                                                الموظف
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                القسم
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                المنصب
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                الراتب الأساسي
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                أيام الحضور
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {search.rows.map((row) => (
                                            <tr
                                                key={row.id}
                                                className="border-b border-hairline hover:bg-surface-hover"
                                            >
                                                <td className="px-sm py-xxs text-ink">{row.name}</td>
                                                <td className="px-sm py-xxs text-muted">{row.dept}</td>
                                                <td className="px-sm py-xxs text-muted">{row.position}</td>
                                                <td className="px-sm py-xxs text-ink">
                                                    {row.salary === null ? '—' : <Money value={row.salary} />}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                    {formatInt(row.days)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        ) : (
                            <StateEmpty title="لا موظفون مطابقون" hint="عدّل البحث لعرض نتائج أخرى." />
                        )}
                    </>
                ) : null}
            </Card>
        </div>
    );
}
