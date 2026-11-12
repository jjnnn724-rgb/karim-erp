import './Attendance.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { AttendanceCorrectButton, AttendanceResolveButton, AttendanceWorkbench } from '../components/AttendanceWorkbench';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { ApiError } from '../lib/api';
import {
    ATTENDANCE_STATE_AR,
    type AttendancePeriodKind,
    type AttendanceState,
    applyAttendanceFilters,
    attendanceCsv,
    attendanceToRow,
    buildAttendanceKpis,
    buildAttendanceLegend,
    buildPunchBars,
    buildTodayExceptions,
    distinctValues,
    EXCEPTION_TYPES_AR,
    fetchAttendanceLeaves,
    fetchAttendanceRange,
    PERIODS,
    periodRange,
    searchAttendanceRows,
    seesFullPeriod,
    todayIso,
} from '../lib/attendance';
import { canWriteAttendance } from '../lib/attendance-write';
import { useAuthState } from '../lib/auth';
import { fetchEmployees, fetchHrDepartments } from '../lib/employees';
import { formatInt } from '../lib/inventory-register';
import { downloadBlob } from '../lib/pdf-share';
import { StatCard } from '../ui/StatCard';

const STATE_KEYS = Object.keys(ATTENDANCE_STATE_AR) as AttendanceState[];
const PAGE_SIZE = 20;

function Kpi({
    id,
    label,
    english,
    value,
    unit,
    hint,
    share,
}: {
    id: string;
    label: string;
    english: string;
    value: string;
    unit: string;
    hint: string;
    share: { text: string; aria: string };
}) {
    const tone = id === 'late' || id === 'early' ? 'warning' : id === 'missing' ? 'info' : id === 'present' ? 'success' : 'neutral';
    return (
        <StatCard
            label={label}
            english={english}
            value={value}
            {...(unit ? { unit } : {})}
            hint={hint}
            tone={tone}
            badge={{ text: share.text, aria: share.aria }}
        />
    );
}

function stateTone(state: AttendanceState): string {
    if (state === 'late' || state === 'early') {
        return 'text-warning-text';
    }
    if (state === 'missing') {
        return 'text-info-text';
    }
    if (state === 'leave') {
        return 'text-success-text';
    }
    return 'text-ink';
}

function minutesText(minutes: number | null): string {
    return minutes === null ? '—' : `${formatInt(Math.floor(minutes / 60))}:${String(minutes % 60).padStart(2, '0')}`;
}

export function Attendance() {
    const auth = useAuthState();
    const role = auth.user?.role ?? '';
    const [today] = useState(() => todayIso());
    const [initialRange] = useState(() => periodRange('week') ?? { from: today, to: today });
    const [range, setRange] = useState(initialRange);
    const [from, setFrom] = useState(initialRange.from);
    const [to, setTo] = useState(initialRange.to);
    const [rangeError, setRangeError] = useState('');
    const [period, setPeriod] = useState<AttendancePeriodKind | ''>('week');
    const [query, setQuery] = useState('');
    const [dept, setDept] = useState('');
    const [state, setState] = useState('');
    const [page, setPage] = useState(1);

    const attendanceQuery = useQuery({
        queryKey: ['attendance-range', range.from, range.to],
        queryFn: ({ signal }) => fetchAttendanceRange({ ...range, signal }),
    });
    const todayQuery = useQuery({
        queryKey: ['attendance-today', today],
        queryFn: ({ signal }) => fetchAttendanceRange({ from: today, to: today, signal }),
    });
    const employeesQuery = useQuery({
        queryKey: ['attendance-employees'],
        queryFn: ({ signal }) => fetchEmployees(signal),
    });
    const departmentsQuery = useQuery({
        queryKey: ['attendance-departments'],
        queryFn: ({ signal }) => fetchHrDepartments(signal),
    });
    const leavesQuery = useQuery({
        queryKey: ['attendance-leaves'],
        queryFn: ({ signal }) => fetchAttendanceLeaves(signal),
    });

    const employeeById = useMemo(
        () => new Map((employeesQuery.data ?? []).map((employee) => [String(employee.id), employee])),
        [employeesQuery.data],
    );
    const departmentByCode = useMemo(
        () => new Map((departmentsQuery.data ?? []).map((department) => [String(department.code), department])),
        [departmentsQuery.data],
    );
    const recordById = useMemo(
        () => new Map((attendanceQuery.data?.rows ?? []).map((record) => [String(record.id), record])),
        [attendanceQuery.data],
    );
    const todayRecordByEmployee = useMemo(
        () => new Map((todayQuery.data?.rows ?? []).map((record) => [String(record.employeeId), record])),
        [todayQuery.data],
    );
    const rows = useMemo(
        () => (attendanceQuery.data?.rows ?? []).map((record) => attendanceToRow(record, employeeById, departmentByCode)),
        [attendanceQuery.data, employeeById, departmentByCode],
    );
    const search = useMemo(() => searchAttendanceRows(rows, query), [rows, query]);
    const visibleRows = useMemo(() => applyAttendanceFilters(search.rows, { dept, state }), [search.rows, dept, state]);
    const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = visibleRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const kpis = useMemo(() => buildAttendanceKpis(visibleRows), [visibleRows]);
    const legend = useMemo(() => buildAttendanceLegend(visibleRows), [visibleRows]);
    const bars = useMemo(() => buildPunchBars(visibleRows), [visibleRows]);
    const maxBar = Math.max(1, ...bars.map((bar) => bar.records));

    const todayExceptions = useMemo(() => {
        if (!todayQuery.data || !employeesQuery.data || !leavesQuery.data) {
            return null;
        }
        return buildTodayExceptions({
            records: todayQuery.data.rows,
            employees: employeesQuery.data,
            leaves: leavesQuery.data,
            deptByCode: departmentByCode,
            todayStr: today,
            full: seesFullPeriod(role),
        });
    }, [todayQuery.data, employeesQuery.data, leavesQuery.data, departmentByCode, today, role]);

    function choosePeriod(kind: AttendancePeriodKind) {
        const next = periodRange(kind, today);
        if (!next) {
            setRangeError('تعذّر حساب الفترة المطلوبة.');
            return;
        }
        setRangeError('');
        setPeriod(kind);
        setFrom(next.from);
        setTo(next.to);
        setPage(1);
        setRange(next);
    }

    function applyRange() {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
            setRangeError('أدخل تاريخي بداية ونهاية صحيحين، على أن تكون البداية قبل النهاية أو مساوية لها.');
            return;
        }
        setRangeError('');
        setPeriod('');
        setPage(1);
        setRange({ from, to });
    }

    function clearFilters() {
        setQuery('');
        setDept('');
        setState('');
        setPage(1);
    }

    const auxiliaryErrors = [
        employeesQuery.isError ? 'تعذّر تحميل دليل الموظفين؛ ستظهر أرقام السجلات بدل الأسماء.' : '',
        departmentsQuery.isError ? 'تعذّر تحميل أسماء الأقسام؛ ستظهر الأكواد كما وردت.' : '',
    ].filter(Boolean);

    return (
        <div className="flex flex-col gap-md attendance-premium">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        الحضور والانصراف{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Attendance
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">سجل البصمات ومؤشرات الفترة.</p>
                </div>
                <PrintActions title="الحضور والانصراف" />
                <AttendanceWorkbench employees={employeesQuery.data ?? []} todayStr={today} />
                <button
                    type="button"
                    data-erp-print-hide
                    disabled={visibleRows.length === 0}
                    onClick={() => {
                        const csv = attendanceCsv(visibleRows);
                        downloadBlob(
                            new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }),
                            `attendance_${range.from}_${range.to}.csv`,
                        );
                    }}
                    className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                >
                    تصدير CSV
                </button>
                <button
                    type="button"
                    onClick={() => {
                        void attendanceQuery.refetch();
                        void todayQuery.refetch();
                        void employeesQuery.refetch();
                        void departmentsQuery.refetch();
                        void leavesQuery.refetch();
                    }}
                    data-erp-print-hide
                    className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                >
                    تحديث
                </button>
            </header>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <fieldset className="m-0 flex flex-wrap gap-xxs border-0 p-0" aria-label="فترات سريعة">
                        {(Object.keys(PERIODS) as AttendancePeriodKind[]).map((kind) => (
                            <button
                                key={kind}
                                type="button"
                                aria-pressed={period === kind}
                                onClick={() => choosePeriod(kind)}
                                className={`rounded-md border px-sm py-xxs text-body-sm ${
                                    period === kind
                                        ? 'border-primary bg-primary text-on-primary'
                                        : 'border-hairline-strong bg-surface text-ink hover:bg-surface-hover'
                                }`}
                            >
                                {PERIODS[kind].seg}
                            </button>
                        ))}
                    </fieldset>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                        من
                        <input
                            type="date"
                            value={from}
                            onChange={(event) => {
                                setFrom(event.target.value);
                                setPeriod('');
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                        إلى
                        <input
                            type="date"
                            value={to}
                            onChange={(event) => {
                                setTo(event.target.value);
                                setPeriod('');
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <button
                        type="button"
                        onClick={applyRange}
                        className="h-9 rounded-md bg-primary px-md text-button-md text-on-primary hover:bg-primary-hover"
                    >
                        عرض الفترة
                    </button>
                    <span className="erp-numeric text-body-sm text-muted" dir="ltr" role="status" aria-live="polite">
                        {range.from} — {range.to}
                    </span>
                </div>
                {rangeError ? (
                    <p className="mt-xs text-body-sm text-danger-text" role="alert">
                        {rangeError}
                    </p>
                ) : null}
                {auxiliaryErrors.map((message) => (
                    <p key={message} className="mt-xs text-body-sm text-warning-text" role="status">
                        {message}
                    </p>
                ))}
            </Card>

            {attendanceQuery.isPending ? (
                <Card>
                    <StateLoading label="جارٍ تحميل سجل الحضور" />
                    <TableSkeleton rows={5} columns={7} />
                </Card>
            ) : null}
            {attendanceQuery.isError ? (
                <Card>
                    {attendanceQuery.error instanceof ApiError && attendanceQuery.error.code === 'NOT_LINKED_TO_EMPLOYEE' ? (
                        <StateEmpty title="حسابك غير مرتبط بسجل موظف" hint="الحضور الذاتي يظهر بعد ربط حساب الدخول ببطاقة الموظف." />
                    ) : (
                        <StateError
                            message={attendanceQuery.error instanceof Error ? attendanceQuery.error.message : 'تعذّر تحميل سجل الحضور'}
                            onRetry={() => {
                                void attendanceQuery.refetch();
                            }}
                        />
                    )}
                </Card>
            ) : null}

            {attendanceQuery.data ? (
                <>
                    <p className="text-body-sm text-muted" role="status" aria-live="polite">
                        {formatInt(visibleRows.length)} سجلًا ظاهرًا من {formatInt(rows.length)} سجل محمّل
                        {attendanceQuery.data.total > rows.length
                            ? ` — أرسل الخادم ${formatInt(rows.length)} من ${formatInt(attendanceQuery.data.total)}`
                            : ''}
                    </p>

                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-3" aria-label="مؤشرات الحضور على السجلات الظاهرة">
                        {kpis.map((item) => (
                            <Kpi
                                key={item.id}
                                id={item.id}
                                label={item.label}
                                english={item.en}
                                value={item.value}
                                unit={item.unit}
                                hint={item.hint}
                                share={item.pill}
                            />
                        ))}
                    </ul>

                    <Card className="p-sm">
                        <div className="flex flex-wrap items-center justify-between gap-sm">
                            <h2 className="text-heading-md text-ink">
                                البصمات حسب اليوم{' '}
                                <span className="text-body-sm text-muted" dir="ltr" lang="en">
                                    Daily punches
                                </span>
                            </h2>
                            <span className="text-body-sm text-muted">آخر {formatInt(bars.length)} يومًا مرسلًا</span>
                        </div>
                        {bars.length ? (
                            <section className="mt-sm flex min-h-36 items-end gap-xs overflow-x-auto" aria-label="مخطط البصمات اليومية">
                                {bars.map((bar) => (
                                    <div key={bar.date} className="flex min-w-12 flex-col items-center gap-xxs">
                                        <span className="erp-numeric text-caption text-muted" dir="ltr">
                                            {formatInt(bar.records)}
                                        </span>
                                        <div
                                            className="w-7 rounded-t bg-primary"
                                            style={{ height: `${Math.max(4, (bar.records / maxBar) * 96)}px` }}
                                            title={`${bar.date}: ${bar.records} سجل، ${bar.inCount} دخول، ${bar.outCount} انصراف، ${bar.late} تأخير`}
                                        />
                                        <span className="erp-numeric text-caption text-muted" dir="ltr">
                                            {bar.label}
                                        </span>
                                    </div>
                                ))}
                            </section>
                        ) : (
                            <StateEmpty title="لا بصمات في هذه الفترة" hint="غيّر نطاق التاريخ لعرض السجلات." />
                        )}
                        <div className="mt-sm flex flex-wrap gap-sm">
                            {legend.map((item) => (
                                <span key={item.key} className="rounded-full bg-surface-sunken px-sm py-xxs text-body-sm text-muted">
                                    {item.label}: {formatInt(item.count)} · {item.pill.text}
                                </span>
                            ))}
                        </div>
                    </Card>

                    <Card className="p-sm">
                        <div className="flex flex-wrap items-end gap-sm">
                            <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                                بحث
                                <input
                                    type="search"
                                    value={query}
                                    onChange={(event) => {
                                        setQuery(event.target.value);
                                        setPage(1);
                                    }}
                                    placeholder="موظف، قسم، تاريخ، مصدر أو حالة"
                                    className="h-9 w-72 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                                />
                            </label>
                            <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                                القسم
                                <select
                                    value={dept}
                                    onChange={(event) => {
                                        setDept(event.target.value);
                                        setPage(1);
                                    }}
                                    className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                                >
                                    <option value="">كل الأقسام</option>
                                    {distinctValues(rows, 'dept').map((value) => (
                                        <option key={value} value={value}>
                                            {value}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                                الحالة
                                <select
                                    value={state}
                                    onChange={(event) => {
                                        setState(event.target.value);
                                        setPage(1);
                                    }}
                                    className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                                >
                                    <option value="">كل الحالات</option>
                                    {STATE_KEYS.map((key) => (
                                        <option key={key} value={key}>
                                            {ATTENDANCE_STATE_AR[key]}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <button
                                type="button"
                                onClick={clearFilters}
                                disabled={!query && !dept && !state}
                                className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-sm text-ink disabled:opacity-50"
                            >
                                مسح المرشّحات
                            </button>
                            {search.folded ? (
                                <span className="text-caption text-muted">بعض النتائج ظهرت بعد تطبيع الحروف العربية.</span>
                            ) : null}
                        </div>
                        <p className="mt-sm text-body-sm text-muted" role="status" aria-live="polite">
                            {formatInt(visibleRows.length)} نتيجة
                            {search.matched ? ` من ${formatInt(rows.length)} بعد البحث` : ''}
                        </p>
                        {visibleRows.length ? (
                            <>
                                <TableScroll label="سجل الحضور والانصراف">
                                    <table className="w-full border-collapse text-body-md">
                                        <caption className="sr-only">سجل الحضور بالفترة المحددة — عرض فقط</caption>
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    الموظف
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    القسم
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    التاريخ
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    الدخول
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    الانصراف
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    العمل
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    الحالة
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    المصدر
                                                </th>
                                                {canWriteAttendance(role) ? (
                                                    <th scope="col" className="px-sm py-xs text-start" data-erp-print-hide>
                                                        إجراء
                                                    </th>
                                                ) : null}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {pageRows.map((row) => (
                                                <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                                    <td className="px-sm py-xxs text-ink">
                                                        {row.nameResolved ? (
                                                            row.employee
                                                        ) : (
                                                            <span className="text-muted">{row.employee}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-sm py-xxs text-ink">
                                                        {row.deptResolved ? row.dept : <span className="text-muted">{row.dept}</span>}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                        {row.date || '—'}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                        {row.in}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                        {row.out}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                        {minutesText(row.minutes)}
                                                    </td>
                                                    <td className={`px-sm py-xxs ${stateTone(row.state)}`}>{row.stateLabel}</td>
                                                    <td className="px-sm py-xxs text-muted">{row.sourceLabel}</td>
                                                    {canWriteAttendance(role) ? (
                                                        <td className="px-sm py-xxs" data-erp-print-hide>
                                                            {recordById.get(row.id) ? (
                                                                <AttendanceCorrectButton
                                                                    record={recordById.get(row.id)!}
                                                                    employee={employeeById.get(row.employeeId)}
                                                                />
                                                            ) : null}
                                                        </td>
                                                    ) : null}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                                <div
                                    className="flex items-center justify-between gap-sm border-t border-hairline px-sm py-xs"
                                    data-erp-print-hide
                                >
                                    <span className="text-body-sm text-muted">
                                        صفحة {formatInt(safePage)} من {formatInt(pageCount)}
                                    </span>
                                    <div className="flex gap-xs">
                                        <button
                                            type="button"
                                            onClick={() => setPage((value) => Math.max(1, value - 1))}
                                            disabled={safePage <= 1}
                                            className="rounded-md border border-hairline-strong px-sm py-xxs text-body-sm disabled:opacity-50"
                                        >
                                            السابق
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                                            disabled={safePage >= pageCount}
                                            className="rounded-md border border-hairline-strong px-sm py-xxs text-body-sm disabled:opacity-50"
                                        >
                                            التالي
                                        </button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <StateEmpty
                                title={rows.length ? 'لا نتائج مطابقة' : 'لا سجلات في الفترة'}
                                hint={rows.length ? 'لا نتائج مطابقة؛ عدّل المرشّحات.' : 'لا بصمات في هذه الفترة.'}
                            />
                        )}
                    </Card>
                </>
            ) : null}

            <Card className="p-sm">
                <div className="flex flex-wrap items-center justify-between gap-sm">
                    <h2 className="text-heading-md text-ink">استثناءات اليوم</h2>
                    <span className="erp-numeric text-body-sm text-muted" dir="ltr">
                        {today}
                    </span>
                </div>
                {todayQuery.isPending || employeesQuery.isPending || leavesQuery.isPending ? (
                    <StateLoading label="جارٍ تحميل استثناءات اليوم" />
                ) : null}
                {todayQuery.isError || employeesQuery.isError || leavesQuery.isError ? (
                    <StateError
                        message="تعذّر تحميل أحد مصادر استثناءات اليوم. أعد المحاولة لعرض قائمة موثوقة."
                        onRetry={() => {
                            void todayQuery.refetch();
                            void employeesQuery.refetch();
                            void leavesQuery.refetch();
                        }}
                    />
                ) : null}
                {todayExceptions ? (
                    todayExceptions.rows.length ? (
                        <TableScroll label="استثناءات الحضور لهذا اليوم">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" className="px-sm py-xs text-start">
                                            الموظف
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            القسم
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            الاستثناء
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            التفاصيل
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            الساعات
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start">
                                            العذر
                                        </th>
                                        {canWriteAttendance(role) ? (
                                            <th scope="col" className="px-sm py-xs text-start" data-erp-print-hide>
                                                إجراء
                                            </th>
                                        ) : null}
                                    </tr>
                                </thead>
                                <tbody>
                                    {todayExceptions.rows.map((item) => (
                                        <tr key={item.employeeId} className="border-b border-hairline">
                                            <td className="px-sm py-xxs text-ink">{item.employeeName}</td>
                                            <td className="px-sm py-xxs text-muted">{item.department}</td>
                                            <td className="px-sm py-xxs text-ink">{EXCEPTION_TYPES_AR[item.type]}</td>
                                            <td className="px-sm py-xxs text-muted">{item.detail}</td>
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {item.hours}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">{item.excused ? 'معذور' : 'غير معذور'}</td>
                                            {canWriteAttendance(role) ? (
                                                <td className="px-sm py-xxs" data-erp-print-hide>
                                                    {!item.excused && employeeById.get(item.employeeId) ? (
                                                        <AttendanceResolveButton
                                                            employees={employeesQuery.data ?? []}
                                                            employee={employeeById.get(item.employeeId)!}
                                                            date={today}
                                                            record={todayRecordByEmployee.get(item.employeeId) ?? null}
                                                        />
                                                    ) : null}
                                                </td>
                                            ) : null}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                    ) : (
                        <StateEmpty
                            title="لا استثناءات مرصودة اليوم"
                            hint={`النطاق المُرسل يتضمن ${formatInt(todayExceptions.open)} مفتوحًا و${formatInt(todayExceptions.excused)} معذورًا.`}
                        />
                    )
                ) : null}
            </Card>
        </div>
    );
}
