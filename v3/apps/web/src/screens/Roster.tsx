import './Roster.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { formatInt } from '../lib/inventory-register';
import {
    clockNow,
    fetchRosterWeek,
    type RosterCell,
    type RosterLogRow,
    rosterApprovalKey,
    rosterApprovalState,
    rosterDays,
    rosterErrorMessage,
    rosterLogToRow,
    rosterScopeNote,
    rosterSummary,
    rosterToRow,
    rosterWeekLabel,
    searchRoster,
    searchRosterLogs,
    weekOf,
} from '../lib/roster';
import { PrintActions } from '../components/PrintActions';

/**
 * الدوام — شبكة الدوام الأسبوعية، قراءة فقط من `/api/hr/dept-roster-week`.
 *
 * ما ينقله القديم (`frontend/app/js/v2/screens/roster.js`):
 *  · سطر النطاق: «دورك مقصور على قسمك… / نطاق مختار / دور مخوّل» وعدد
 *    الموظفين ووقت آخر قراءة (:357-360).
 *  · شبكة الموظف × يوم: العمود الأول الموظف، ثم أيام الأسبوع بترتيب
 *    الخادم (السبت أولًا) مع تاريخ كل يوم ووسمَي «اليوم» و«مقفل» (:275-302).
 *  · خلية الإجازة «إجازة» + نوعها، و«راحة» حين `day_off` موجود، وإلا وقت
 *    الدلام وساعاته (:237-261).
 *  · اعتماد الطباعة: لا شيء / بانتظار التوقيع / معتمد، ومفتاح الأسبوع
 *    من أقسام الخادم (:323-349، `roster-repo.js:55-69`).
 *  · «آخر تغييرات الدوام» — آخر 15 تغييرًا بعموداته الخمسة (:191-235).
 *
 * **ما لا ينتقل**: تحرير خلايا الشبكة ونسخ الصف ونسخ الأسبوع السابق
 * وحفظها (`POST /hr/dept-roster-week`) وطلب اعتماد الطباعة وتوقيعه
 * (`POST /hr/dept-roster-approval/*`) — كلها كتابة وتبقى في V2. لا في
 * هذه الشاشة زرُّ حفظ ولا نداء كتابة واحد.
 */

const LOG_PAGE_SIZE = 10;

type LogSortKey = 'employee' | 'effectiveFrom' | 'by' | 'at';

function Kpi({ label, english, value, hint }: { label: string; english: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg border border-hairline bg-surface p-md shadow-card">
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
        </div>
    );
}

/** خلية الشبكة كما في القديم (`roster.js:237-261`) — بلا حقول إدخال. */
function CellView({ cell }: { cell: RosterCell | undefined }) {
    if (!cell) {
        return <span className="text-body-sm text-muted">—</span>;
    }
    if (cell.onLeave) {
        return (
            <span className="flex flex-col gap-xxs">
                <span className="text-body-sm text-warning-text">إجازة</span>
                {cell.leaveType ? <small className="text-caption text-muted">{cell.leaveType}</small> : null}
            </span>
        );
    }
    if (cell.dayOff !== null) {
        return (
            <span className="flex flex-col gap-xxs">
                <span className="text-body-sm text-muted">راحة</span>
                <small className="erp-numeric text-caption text-faint" dir="ltr">
                    {cell.shiftStart}
                </small>
            </span>
        );
    }
    return (
        <span className="flex flex-col gap-xxs">
            <span className="erp-numeric text-body-sm text-ink" dir="ltr">
                {cell.shiftStart}
            </span>
            {cell.shiftHours === null ? null : <small className="text-caption text-muted">{cell.shiftHours}س</small>}
        </span>
    );
}

function SortableTh({
    label,
    sortKey,
    sort,
    onToggle,
}: {
    label: string;
    sortKey: LogSortKey;
    sort: { key: LogSortKey; dir: 'asc' | 'desc' } | null;
    onToggle: (key: LogSortKey) => void;
}) {
    const ariaSort = sort?.key !== sortKey ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending';
    return (
        <th scope="col" aria-sort={ariaSort} className="px-sm py-xs text-start font-medium">
            <button type="button" onClick={() => onToggle(sortKey)}>
                {label}
            </button>
        </th>
    );
}

function compareLogs(a: RosterLogRow, b: RosterLogRow, key: LogSortKey): number {
    if (key === 'effectiveFrom') {
        return a.effectiveFrom.localeCompare(b.effectiveFrom, 'en');
    }
    if (key === 'at') {
        return a.at.localeCompare(b.at, 'en');
    }
    if (key === 'by') {
        return a.by.localeCompare(b.by, 'ar');
    }
    return a.employee.localeCompare(b.employee, 'ar');
}

export function Roster() {
    const [week, setWeek] = useState('');
    const [dept, setDept] = useState('');
    const [query, setQuery] = useState('');
    const [logPage, setLogPage] = useState(1);
    const [logSort, setLogSort] = useState<{ key: LogSortKey; dir: 'asc' | 'desc' } | null>(null);
    const [readAt, setReadAt] = useState('');

    const weekQuery = useQuery({
        queryKey: ['roster-week', week, dept],
        queryFn: ({ signal }) => fetchRosterWeek(week, dept, signal),
    });

    const data = weekQuery.data;
    const days = useMemo(() => rosterDays(data?.days ?? []), [data]);
    const rows = useMemo(() => (data?.grid ?? []).map(rosterToRow), [data]);
    const logs = useMemo(() => (data?.recentLog ?? []).map(rosterLogToRow), [data]);
    const summary = useMemo(() => rosterSummary(rows, days, logs.length), [rows, days, logs]);

    const search = useMemo(() => searchRoster(rows, query), [rows, query]);
    const logSearch = useMemo(() => searchRosterLogs(logs, query), [logs, query]);

    const sortedLogs = useMemo(() => {
        if (!logSort) {
            return logSearch.rows;
        }
        const copy = [...logSearch.rows].sort((a, b) => compareLogs(a, b, logSort.key));
        return logSort.dir === 'asc' ? copy : copy.reverse();
    }, [logSearch.rows, logSort]);

    const logPageCount = Math.max(1, Math.ceil(sortedLogs.length / LOG_PAGE_SIZE));
    const safeLogPage = Math.min(logPage, logPageCount);
    const logRows = sortedLogs.slice((safeLogPage - 1) * LOG_PAGE_SIZE, safeLogPage * LOG_PAGE_SIZE);

    const approval = rosterApprovalState(data?.approval ?? null);
    const approvalKey = rosterApprovalKey(data?.depts ?? []);
    const scopeNote = rosterScopeNote(data?.fixed ?? false, data?.depts ?? [], dept);
    const weekLabel = rosterWeekLabel(data?.weekStart ?? '', days);
    const filtered = search.matched || logSearch.matched;

    useEffect(() => {
        if (data) {
            setReadAt(clockNow());
        }
    }, [data]);

    function toggleLogSort(key: LogSortKey) {
        setLogPage(1);
        setLogSort((previous) =>
            previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
        );
    }

    function stepWeek(delta: number) {
        const base = data?.weekStart ?? '';
        const next = delta === 0 ? '' : weekOf(base, delta);
        if (delta !== 0 && !next) {
            return;
        }
        setWeek(next);
    }

    const approvalLabel =
        approval.key === 'approved' ? 'معتمد' : approval.key === 'pending' ? 'بانتظار التوقيع' : 'لا اعتماد مسجَّل';

    const approvalHint =
        approval.key === 'approved'
            ? `معتمد من شؤون العاملين: ${approval.by}${approval.at ? ` — ${approval.at}` : ''} · الطباعة تخرج معتمدة لهذا الأسبوع.`
            : approval.key === 'pending'
              ? `أُرسل لاعتماد شؤون العاملين — ${approval.by}${approval.at ? ` (${approval.at})` : ''}، بانتظار التوقيع.`
              : 'لا اعتماد مسجَّل لهذا الأسبوع.';

    return (
        <div className="flex flex-col gap-md roster-premium">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        الدوام{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Dept Roster
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">
                        شبكة دوام الأسبوع.
                    </p>
                </div>
                <PrintActions title="الدوام" />
                <button
                    type="button"
                    onClick={() => {
                        void weekQuery.refetch();
                    }}
                    data-erp-print-hide className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                >
                    تحديث
                </button>
            </header>

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                    label="الموظفون في النطاق"
                    english="Employees"
                    value={formatInt(summary.employees)}
                    hint="صفوف الشبكة كما أرسلها الخادم — لا صفّ يُختلق"
                />
                <Kpi
                    label="أيام الأسبوع"
                    english="Days"
                    value={formatInt(summary.days)}
                    hint={`${formatInt(summary.pastDays)} يوم مقفل — الماضي محمي عند الخادم`}
                />
                <Kpi
                    label="خلايا مفتوحة"
                    english="Open cells"
                    value={formatInt(summary.editableCells)}
                    hint={`${formatInt(summary.restCells)} خلية راحة · ${formatInt(summary.leaveCells)} خلية إجازة`}
                />
                <Kpi label="اعتماد الطباعة" english="Approval" value={approvalLabel} hint={approvalHint} />
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-roster-q">
                        بحث
                        <input
                            id="erp-roster-q"
                            type="search"
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setLogPage(1);
                            }}
                            placeholder="اسم الموظف، رمزه، وظيفته، القسم"
                            className="h-9 w-72 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>

                    {!data?.fixed ? (
                        <label
                            className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                            htmlFor="erp-roster-dept"
                        >
                            القسم
                            <select
                                id="erp-roster-dept"
                                value={dept}
                                onChange={(event) => {
                                    setDept(event.target.value);
                                }}
                                title="أكواد الأقسام كما أرسلها الخادم — بلا قسم = كل الأقسام"
                                className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                            >
                                <option value="">كل الأقسام</option>
                                {(data?.validDepts ?? []).map((code) => (
                                    <option key={code} value={code}>
                                        {code}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : null}

                    <div className="flex flex-wrap items-end gap-xs">
                        <button
                            type="button"
                            onClick={() => {
                                stepWeek(-1);
                            }}
                            aria-label="الأسبوع السابق"
                            className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                        >
                            الأسبوع السابق
                        </button>
                        <span className="erp-numeric text-body-sm text-ink" dir="ltr">
                            {weekLabel || '—'}
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                stepWeek(1);
                            }}
                            aria-label="الأسبوع التالي"
                            className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                        >
                            الأسبوع التالي
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                stepWeek(0);
                            }}
                            className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                        >
                            هذا الأسبوع
                        </button>
                    </div>

                    <span className="text-body-sm text-muted" role="status" aria-live="polite">
                        {filtered
                            ? `${formatInt(search.hits)} موظف مطابق من ${formatInt(summary.employees)}`
                            : `${formatInt(summary.employees)} موظف في النطاق`}
                    </span>
                </div>

                {data ? (
                    <p className="mt-sm text-body-sm text-muted">
                        {scopeNote} · {formatInt(summary.employees)} موظفًا
                        {readAt ? ` · آخر قراءة ${readAt}` : ''}
                    </p>
                ) : null}

                {search.folded || logSearch.folded ? (
                    <p className="mt-sm text-body-sm text-muted">
                        بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.
                    </p>
                ) : null}
            </Card>

            <Card>
                <div className="flex flex-wrap items-center justify-between gap-sm px-sm py-xs">
                    <h2 className="text-heading-md text-ink">
                        شبكة الأسبوع{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Week Grid
                        </span>
                        <span className="erp-numeric text-body-sm text-muted" dir="ltr">
                            ({formatInt(summary.employees)})
                        </span>
                    </h2>
                    <span className="text-body-sm text-muted">
                        الأيام المقفلة والمظللة بالإجازة كما أرسلها الخادم — القرار للخادم
                    </span>
                </div>

                {weekQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل شبكة الدوام" />
                        <TableSkeleton rows={4} columns={9} />
                    </div>
                ) : null}

                {weekQuery.isError ? (
                    <StateError
                        message={rosterErrorMessage(weekQuery.error)}
                        onRetry={() => {
                            void weekQuery.refetch();
                        }}
                    />
                ) : null}

                {weekQuery.isSuccess && rows.length === 0 ? (
                    <StateEmpty
                        title="لا موظفون في نطاق هذا القسم"
                        hint="الخادم أرسل شبكة فارغة لهذا النطاق — الصف لا يُختلق."
                    />
                ) : null}

                {weekQuery.isSuccess && rows.length > 0 ? (
                    <TableScroll label="شبكة دوام الأسبوع">
                        <table className="w-full border-collapse text-body-md">
                            <caption className="sr-only">
                                شبكة دوام الأسبوع — كل خلية محفوظة تُطبق في تاريخها عبر مجدول المحرك
                            </caption>
                            <thead>
                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الموظف
                                    </th>
                                    {days.map((day) => (
                                        <th key={day.date} scope="col" className="px-sm py-xs text-center font-medium">
                                            {day.label}
                                            <small className="erp-numeric block text-caption text-muted" dir="ltr">
                                                {day.date}
                                            </small>
                                            {day.isToday ? (
                                                <small className="block text-caption text-success-text">اليوم</small>
                                            ) : null}
                                            {day.isPast ? (
                                                <small className="block text-caption text-muted">مقفل</small>
                                            ) : null}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {search.rows.map((row) => (
                                    <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                        <td className="px-sm py-xxs text-ink">
                                            <div className="text-body-md">{row.name}</div>
                                            <small className="erp-numeric block text-caption text-muted" dir="ltr">
                                                {row.employeeId}
                                            </small>
                                            {row.position ? (
                                                <small className="block text-caption text-muted">
                                                    · {row.position}
                                                </small>
                                            ) : null}
                                        </td>
                                        {days.map((day, index) => (
                                            <td key={day.date} className="px-sm py-xxs text-center">
                                                <CellView cell={row.cells[index]} />
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableScroll>
                ) : null}
            </Card>

            <Card>
                <div className="flex flex-wrap items-center justify-between gap-sm px-sm py-xs">
                    <h2 className="text-heading-md text-ink">
                        اعتماد الطباعة{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Print Approval
                        </span>
                    </h2>
                    <span className="erp-numeric text-body-sm text-muted" dir="ltr">
                        {`مفتاح الأسبوع: ${approvalKey} · ${data?.weekStart ?? ''}`}
                    </span>
                </div>
                <div className="px-sm pb-sm">
                    <p className="text-body-md text-ink">{approvalHint}</p>
                </div>
            </Card>

            <Card>
                <div className="flex flex-wrap items-center justify-between gap-sm px-sm py-xs">
                    <h2 className="text-heading-md text-ink">
                        آخر تغييرات الدوام{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Shift History
                        </span>
                    </h2>
                    <span className="text-body-sm text-muted">كل خلية محفوظة = تغيير مجدول بتاريخ سريانه (آخر 15)</span>
                </div>

                {weekQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل سجل تغييرات الدوام" />
                        <TableSkeleton rows={3} columns={5} />
                    </div>
                ) : null}

                {weekQuery.isError ? null : logs.length === 0 ? (
                    <StateEmpty
                        title="لا تغييرات مسجّلة في نطاق هذا القسم"
                        hint="أول حفظ لأي خلية سيظهر هنا بتاريخ سريانه ومن سجّله."
                    />
                ) : null}

                {weekQuery.isError ? null : logs.length > 0 ? (
                    <>
                        <TableScroll label="آخر تغييرات الدوام">
                            <table className="w-full border-collapse text-body-md">
                                <caption className="sr-only">
                                    آخر تغييرات الدوام — كل سطر تغيير مجدول بتاريخ سريانه
                                </caption>
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh
                                            label="الموظف"
                                            sortKey="employee"
                                            sort={logSort}
                                            onToggle={toggleLogSort}
                                        />
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الدوام
                                        </th>
                                        <SortableTh
                                            label="يسري من"
                                            sortKey="effectiveFrom"
                                            sort={logSort}
                                            onToggle={toggleLogSort}
                                        />
                                        <SortableTh
                                            label="بواسطة"
                                            sortKey="by"
                                            sort={logSort}
                                            onToggle={toggleLogSort}
                                        />
                                        <SortableTh
                                            label="وقت التسجيل"
                                            sortKey="at"
                                            sort={logSort}
                                            onToggle={toggleLogSort}
                                        />
                                    </tr>
                                </thead>
                                <tbody>
                                    {logRows.map((row) => (
                                        <tr key={row.key} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="px-sm py-xxs text-ink">
                                                {row.employee}
                                                {row.empNo ? (
                                                    <small
                                                        className="erp-numeric block text-caption text-muted"
                                                        dir="ltr"
                                                    >
                                                        {row.empNo}
                                                    </small>
                                                ) : null}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">
                                                <span className="erp-numeric" dir="ltr">
                                                    {row.start}
                                                </span>{' '}
                                                <span className="text-body-sm text-muted">{row.hours}س</span>
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {row.effectiveFrom}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">{row.by}</td>
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {row.at}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>

                        <div className="flex items-center justify-between gap-sm border-t border-hairline px-sm py-xs">
                            <span className="text-body-sm text-muted">
                                صفحة {formatInt(safeLogPage)} من {formatInt(logPageCount)}
                            </span>
                            <div className="flex gap-xs">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setLogPage(safeLogPage - 1);
                                    }}
                                    disabled={safeLogPage <= 1}
                                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                >
                                    السابق
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setLogPage(safeLogPage + 1);
                                    }}
                                    disabled={safeLogPage >= logPageCount}
                                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                >
                                    التالي
                                </button>
                            </div>
                        </div>
                    </>
                ) : null}
            </Card>
        </div>
    );
}
