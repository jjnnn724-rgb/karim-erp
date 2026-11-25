import './Payroll.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PayrollSuite } from '../components/PayrollSuite';
import { PayrollWorkbench } from '../components/PayrollWorkbench';
import { PrintActions } from '../components/PrintActions';
import { Card } from '../components/TableState';
import { fetchHrDepartments } from '../lib/employees';
import { formatInt } from '../lib/inventory-register';
import {
    currentMonth,
    fetchPayrollRuns,
    fetchPayrollSheet,
    type PayrollRunRow,
    type PayrollSheetRow,
    payrollRunToRow,
    runsSummary,
    searchSheetRows,
    sheetRow,
    sheetSummary,
} from '../lib/payroll';
import { payrollSheetCsv } from '../lib/payroll-suite';
import { downloadBlob } from '../lib/pdf-share';
import { DataTable, type DataTableColumn, PageHeader } from '../ui';

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

/**
 * أعمدة المسيرات — الخلايا تحفظ دلالات العرض القديمة حرفيًا (أرقام لاتينية
 * معزولة الاتجاه، والصافي بخط عريض). الفرز محلي على كل المسيرات المحمّلة
 * (لا ترقيم هنا)، والمبالغ النصية تُفرز بقيمتها الرقمية لا بنصّها.
 */
const RUN_COLUMNS: DataTableColumn<PayrollRunRow>[] = [
    {
        key: 'month',
        header: 'الشهر',
        className: 'erp-numeric text-ink',
        cell: (run) => <span dir="ltr">{run.month}</span>,
        sortValue: (run) => run.month,
    },
    {
        key: 'count',
        header: 'الموظفون',
        className: 'erp-numeric text-ink',
        cell: (run) => <span dir="ltr">{formatInt(run.count)}</span>,
        sortValue: (run) => run.count,
    },
    {
        key: 'basic',
        header: 'الأساسي',
        className: 'text-ink',
        cell: (run) => <Money value={run.basic} />,
        sortValue: (run) => Number(run.basic),
    },
    {
        key: 'overtime',
        header: 'أوفرتايم',
        className: 'text-ink',
        cell: (run) => <Money value={run.overtime} />,
        sortValue: (run) => Number(run.overtime),
    },
    {
        key: 'bonuses',
        header: 'علاوات',
        className: 'text-ink',
        cell: (run) => <Money value={run.bonuses} />,
        sortValue: (run) => Number(run.bonuses),
    },
    {
        key: 'penalties',
        header: 'جزاءات',
        className: 'text-ink',
        cell: (run) => <Money value={run.penalties} />,
        sortValue: (run) => Number(run.penalties),
    },
    {
        key: 'advances',
        header: 'سلف',
        className: 'text-ink',
        cell: (run) => <Money value={run.advances} />,
        sortValue: (run) => Number(run.advances),
    },
    {
        key: 'net',
        header: 'الصافي',
        className: 'font-semibold text-ink',
        cell: (run) => <Money value={run.net} />,
        sortValue: (run) => Number(run.net),
    },
    {
        key: 'status',
        header: 'الحالة',
        className: 'text-muted',
        cell: (run) => run.status || '—',
        sortValue: (run) => run.status || null,
    },
];

/**
 * أعمدة الكشف — الراتب المخفي بقرار الخادم يبقى شرطة ولا يُخمَّن، ويُفرز
 * كقيمة فارغة (في النهاية) لا كصفر. الكشف بلا ترقيم: كل النتائج محمّلة،
 * فالفرز المحلي آمن وفوق 200 صف يتكفّل DataTable بالتمرير الافتراضي.
 */
const SHEET_COLUMNS: DataTableColumn<PayrollSheetRow>[] = [
    {
        key: 'name',
        header: 'الموظف',
        className: 'text-ink',
        cell: (row) => row.name,
        sortValue: (row) => row.name,
    },
    {
        key: 'dept',
        header: 'القسم',
        className: 'text-muted',
        cell: (row) => row.dept,
        sortValue: (row) => row.dept,
    },
    {
        key: 'position',
        header: 'المنصب',
        className: 'text-muted',
        cell: (row) => row.position,
        sortValue: (row) => row.position,
    },
    {
        key: 'salary',
        header: 'الراتب الأساسي',
        className: 'text-ink',
        cell: (row) => (row.salary === null ? '—' : <Money value={row.salary} />),
        sortValue: (row) => (row.salary === null ? null : Number(row.salary)),
    },
    {
        key: 'days',
        header: 'أيام الحضور',
        className: 'erp-numeric text-ink',
        cell: (row) => <span dir="ltr">{formatInt(row.days)}</span>,
        sortValue: (row) => row.days,
    },
];

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
            <PageHeader
                title="الرواتب"
                english="Payroll"
                description="سجل المسيرات وكشف الموظفين."
                actions={
                    <>
                        <div className="flex items-center gap-xs">
                            <PayrollWorkbench month={month} />
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
                    </>
                }
            />

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
            </Card>
            <DataTable<PayrollRunRow>
                caption="سجل مسيرات الرواتب"
                columns={RUN_COLUMNS}
                rows={filteredRuns}
                rowKey={(run) => run.id}
                state={
                    runsQuery.isPending
                        ? 'loading'
                        : runsQuery.isError
                          ? 'error'
                          : filteredRuns.length === 0
                            ? 'empty'
                            : 'data'
                }
                loadingRows={4}
                emptyTitle="لا مسيرات في هذا العرض"
                emptyDescription="غيّر مرشّح الحالة أو أعد المحاولة لاحقًا."
                errorMessage={runsQuery.error instanceof Error ? runsQuery.error.message : 'تعذّر تحميل المسيرات'}
                onRetry={() => {
                    void runsQuery.refetch();
                }}
                manualFiltering
            />

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
                    <button
                        type="button"
                        data-erp-print-hide
                        disabled={search.rows.length === 0}
                        onClick={() => {
                            const csv = payrollSheetCsv(search.rows);
                            downloadBlob(
                                new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
                                `payroll_${month}.csv`,
                            );
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                    >
                        تصدير CSV
                    </button>
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
                {sheetQuery.data ? (
                    <p className="px-sm pb-sm text-body-sm text-muted">
                        الإجمالي الظاهر: <Money value={visibleSheetSummary.total} />
                        {' · '}
                        {formatInt(visibleSheetSummary.shown)} راتبًا مرئيًا
                        {visibleSheetSummary.hidden
                            ? ` · ${formatInt(visibleSheetSummary.hidden)} مخفي بقرار الخادم`
                            : ''}
                    </p>
                ) : null}
            </Card>
            <DataTable<PayrollSheetRow>
                caption="كشف رواتب الموظفين"
                columns={SHEET_COLUMNS}
                rows={search.rows}
                rowKey={(row) => row.id}
                state={
                    sheetQuery.isPending
                        ? 'loading'
                        : sheetQuery.isError
                          ? 'error'
                          : search.rows.length === 0
                            ? 'empty'
                            : 'data'
                }
                loadingRows={5}
                emptyTitle="لا موظفون مطابقون"
                emptyDescription="عدّل البحث لعرض نتائج أخرى."
                errorMessage={sheetQuery.error instanceof Error ? sheetQuery.error.message : 'تعذّر تحميل كشف الرواتب'}
                onRetry={() => {
                    void sheetQuery.refetch();
                }}
                manualFiltering
            />

            <PayrollSuite month={month} />
        </div>
    );
}
