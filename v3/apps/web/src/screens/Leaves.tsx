import './Leaves.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { fetchEmployees } from '../lib/employees';
import { formatInt } from '../lib/inventory-register';
import {
    buildLeavesKpis,
    doorScopeNote,
    fetchLeaveTypes,
    fetchLeaveWorkflow,
    flattenEvents,
    LEAVES_TYPE_PAGE,
    LEAVES_TYPE_PAGES,
    type LeaveEventRow,
    type LeaveRequestRow,
    type LeaveTypeRow,
    leaveStateOf,
    leaveToRow,
    leaveTypeMap,
    requestsByType,
    searchLeaveRequests,
    summarizeLeaves,
    topRequesters,
    typeToRow,
} from '../lib/leaves';
import { createLeaveRequest, decideLeaveRequest, LEAVE_TEXT, type LeaveActionKind } from '../lib/leaves-write';
import { roleLabel } from '../lib/users';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

/**
 * الإجازات — شاشة قراءةٍ كاملة لسلسلة الاعتماد.
 *
 * ما تنقله الشاشة القديمة (`frontend/app/js/v2/screens/leaves.js`):
 *   · سطر النطاق + مؤشرات الستة (`:624-634`، `leaves-repo.js:270-305`).
 *   · شريط الحالة (`:128-133`) وتصفية العميل بلا طلبٍ إضافي (`:606-612`).
 *   · جدول الطلبات (`:418-495`) وجدول أحداث الاعتماد (`:497-545`) وجدول
 *     أنواع الإجازات (`:547-579`).
 *   · لوحة «أكثر الموظفين طلبًا» (`:110-126`, `:636-641`).
 *
 * ما لا تنقله — وهو كتابة: إنشاء الطلب (`:147-149`) واعتماده ورفضه
 * وإعادة إرساله (`:475-493`) وإعادة الطلب للموظف (`:212-228`). كلها في
 * V2، وقاعدة الخادم تمنع التعديل المباشر أصلًا (`server.js:2056`).
 *
 * القاعدة: ما لم يرسله الخادم لا يُخمَّن — حالةٌ مخزَّنة غير معروفة تُعرض
 * خامًا، ومدةٌ غير محسوبة تُطبع «—»، والتاريخ يُعرض كما مخزَّن (`YYYY-MM-DD`).
 */

type LeaveStateFilter = 'all' | 'in_progress' | 'returned' | 'completed' | 'rejected';

const STATE_FILTERS: readonly LeaveStateFilter[] = ['all', 'in_progress', 'returned', 'completed', 'rejected'];

const STATE_FILTER_LABELS: Record<LeaveStateFilter, string> = {
    all: 'الكل',
    in_progress: 'قيد الاعتماد',
    returned: 'عاد للموظف للتعديل',
    completed: 'معتمد نهائيًا',
    rejected: 'مرفوض',
};

const TOP_PORTLET = 6;
const REQUEST_PAGE_SIZE = 15;
const EVENT_PAGE_SIZE = 10;
const TYPE_PAGE_SIZE = 10;

type RequestSortKey = 'employee' | 'type' | 'start' | 'end' | 'days' | 'stage' | 'state' | 'decidedAt';
type EventSortKey = 'employee' | 'requestId' | 'stage' | 'action' | 'actorRole' | 'at';
type TypeSortKey = 'name' | 'days' | 'paid' | 'requests';

type SortState<K extends string> = { key: K; dir: 'asc' | 'desc' } | null;

/** ساعةٌ محلية HH:MM — يحتاج المعتمِد أن يعرف قِدَم القائمة أمامه (`leaves.js:73-78`). */
function clockNow(): string {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function Kpi({ label, english, value, suffix, hint }: { label: string; english: string; value: string; suffix?: string; hint: string }) {
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
                {suffix ? <span className="text-body-sm text-muted"> {suffix}</span> : null}
            </p>
            <p className="mt-xxs text-caption text-muted">{hint}</p>
        </li>
    );
}

function SortableTh<K extends string>({
    label,
    sortKey,
    sort,
    onToggle,
}: {
    label: string;
    sortKey: K;
    sort: SortState<K>;
    onToggle: (key: K) => void;
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

function Pager({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (page: number) => void }) {
    return (
        <div className="flex items-center justify-between gap-sm border-t border-hairline px-sm py-xs">
            <span className="text-body-sm text-muted">
                صفحة {formatInt(page)} من {formatInt(pageCount)}
            </span>
            <div className="flex gap-xs">
                <button
                    type="button"
                    onClick={() => onChange(page - 1)}
                    disabled={page <= 1}
                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                >
                    السابق
                </button>
                <button
                    type="button"
                    onClick={() => onChange(page + 1)}
                    disabled={page >= pageCount}
                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                >
                    التالي
                </button>
            </div>
        </div>
    );
}

/** الترتيب على الجدول القديم: `value` العمود decides، والقيم الفارغة في آخر الترتيب. */
function compareRequest(a: LeaveRequestRow, b: LeaveRequestRow, key: RequestSortKey): number {
    if (key === 'days') {
        return (a.days ?? -1) - (b.days ?? -1);
    }
    if (key === 'stage') {
        return (a.stageKnown ? a.stageAr : a.stage).localeCompare(b.stageKnown ? b.stageAr : b.stage, 'ar');
    }
    if (key === 'state') {
        return leaveStateOf(a.wfStatus, a.status).key.localeCompare(leaveStateOf(b.wfStatus, b.status).key, 'en');
    }
    if (key === 'start' || key === 'end' || key === 'decidedAt') {
        return a[key].localeCompare(b[key], 'en');
    }
    return a[key].localeCompare(b[key], 'ar');
}

function compareEvent(a: LeaveEventRow, b: LeaveEventRow, key: EventSortKey): number {
    if (key === 'at' || key === 'requestId') {
        return a[key].localeCompare(b[key], 'en');
    }
    return a[key].localeCompare(b[key], 'ar');
}

function compareType(a: LeaveTypeRow, b: LeaveTypeRow, key: TypeSortKey): number {
    if (key === 'days') {
        return (a.days ?? -1) - (b.days ?? -1);
    }
    if (key === 'paid') {
        return Number(a.paid) - Number(b.paid);
    }
    if (key === 'requests') {
        return a.requests - b.requests;
    }
    return a.name.localeCompare(b.name, 'ar');
}

function sortRows<K extends string, T>(rows: readonly T[], sort: SortState<K>, compare: (a: T, b: T, key: K) => number): T[] {
    if (!sort) {
        return [...rows];
    }
    const copy = [...rows].sort((a, b) => compare(a, b, sort.key));
    return sort.dir === 'asc' ? copy : copy.reverse();
}

export function Leaves() {
    const auth = useAuthState();
    const role = auth.user?.role ?? '';

    const [stateFilter, setStateFilter] = useState<LeaveStateFilter>('all');
    const [query, setQuery] = useState('');
    const [requestSort, setRequestSort] = useState<SortState<RequestSortKey>>(null);
    const [requestPage, setRequestPage] = useState(1);
    const [eventSort, setEventSort] = useState<SortState<EventSortKey>>(null);
    const [eventPage, setEventPage] = useState(1);
    const [typeSort, setTypeSort] = useState<SortState<TypeSortKey>>(null);
    const [typePage, setTypePage] = useState(1);

    const [createOpen, setCreateOpen] = useState(false);
    const [actionOpen, setActionOpen] = useState(false);
    const [actionRow, setActionRow] = useState<LeaveRequestRow | null>(null);
    const [actionKind, setActionKind] = useState<LeaveActionKind>('approve');
    const [actionTitle, setActionTitle] = useState('');
    const [actionMessage, setActionMessage] = useState('');

    const employeesQuery = useQuery({
        queryKey: ['employees-for-leave'],
        queryFn: ({ signal }) => fetchEmployees(signal),
        staleTime: 10 * 60 * 1000,
    });

    const createLeaveMutation = useWriteMutation<
        { employeeId: string; leaveTypeId: string; startDate: string; endDate: string; reason: string },
        void
    >({
        mutationFn: (input) => createLeaveRequest(input).then(() => undefined),
        successTitle: () => LEAVE_TEXT.createSuccess,
        invalidate: [['leave-workflow']],
        silentError: true,
        onSuccess: () => setCreateOpen(false),
    });

    const decideMutation = useWriteMutation<LeaveActionKind, void>({
        mutationFn: (kind) => {
            const raw = workflowQuery.data?.find((entry) => String(entry.id) === String(actionRow?.id));
            const workflowId = raw?.workflow_id ?? actionRow?.id ?? '';
            return decideLeaveRequest(workflowId, kind).then(() => undefined);
        },
        successTitle: () => LEAVE_TEXT.actionSuccess,
        invalidate: [['leave-workflow']],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    const workflowQuery = useQuery({
        queryKey: ['leave-workflow'],
        queryFn: ({ signal }) => fetchLeaveWorkflow(signal),
    });
    // الأنواع مرجعٌ فرعي: فشله لا يُسقط الشاشة — القديم يبتلع خطأها ويكمل
    // بالسجل وحده (`leaves.js:692`).
    const typesQuery = useQuery({
        queryKey: ['leave-types'],
        queryFn: ({ signal }) => fetchLeaveTypes(signal),
    });

    const typeList = useMemo(() => typesQuery.data?.rows ?? [], [typesQuery.data]);
    const typeById = useMemo(() => leaveTypeMap(typeList), [typeList]);
    const allRows = useMemo(() => (workflowQuery.data ?? []).map((raw) => leaveToRow(raw, typeById)), [workflowQuery.data, typeById]);
    const summary = useMemo(() => summarizeLeaves(allRows), [allRows]);

    const stateRows = useMemo(
        () => (stateFilter === 'all' ? allRows : allRows.filter((row) => row.wfStatus === stateFilter)),
        [allRows, stateFilter],
    );
    const search = useMemo(() => searchLeaveRequests(stateRows, query), [stateRows, query]);
    const sortedRequests = useMemo(() => sortRows(search.rows, requestSort, compareRequest), [search.rows, requestSort]);

    const events = useMemo(() => flattenEvents(allRows), [allRows]);
    const sortedEvents = useMemo(() => sortRows(events, eventSort, compareEvent), [events, eventSort]);

    const typeCounts = useMemo(() => requestsByType(allRows), [allRows]);
    const typeRows = useMemo(() => typeList.map((type) => typeToRow(type, typeCounts.get(String(type.id)) ?? 0)), [typeList, typeCounts]);
    const sortedTypes = useMemo(() => sortRows(typeRows, typeSort, compareType), [typeRows, typeSort]);

    const requestPageCount = Math.max(1, Math.ceil(sortedRequests.length / REQUEST_PAGE_SIZE));
    const safeRequestPage = Math.min(requestPage, requestPageCount);
    const requestPageRows = sortedRequests.slice((safeRequestPage - 1) * REQUEST_PAGE_SIZE, safeRequestPage * REQUEST_PAGE_SIZE);

    const eventPageCount = Math.max(1, Math.ceil(sortedEvents.length / EVENT_PAGE_SIZE));
    const safeEventPage = Math.min(eventPage, eventPageCount);
    const eventPageRows = sortedEvents.slice((safeEventPage - 1) * EVENT_PAGE_SIZE, safeEventPage * EVENT_PAGE_SIZE);

    const typePageCount = Math.max(1, Math.ceil(sortedTypes.length / TYPE_PAGE_SIZE));
    const safeTypePage = Math.min(typePage, typePageCount);
    const typePageRows = sortedTypes.slice((safeTypePage - 1) * TYPE_PAGE_SIZE, safeTypePage * TYPE_PAGE_SIZE);

    const readAt = useMemo(() => (workflowQuery.isSuccess ? clockNow() : ''), [workflowQuery.isSuccess]);
    const paidTypes = typeList.filter((type) => type.paid).length;
    const kpis = useMemo(() => buildLeavesKpis(summary, typeList.length, paidTypes), [summary, typeList.length, paidTypes]);
    const top = useMemo(() => topRequesters(allRows, TOP_PORTLET), [allRows]);
    const topMax = top.length > 0 ? (top[0]?.count ?? 0) : 0;

    const scopeLine = allRows.length
        ? `${doorScopeNote(role)} · ${formatInt(summary.total)} طلبًا محمّل (${formatInt(summary.inProgress)} قيد الاعتماد، ${formatInt(summary.completed)} معتمدة نهائيًا، ${formatInt(summary.rejected)} مرفوضة${summary.returned ? `، ${formatInt(summary.returned)} أعيدت` : ''}) · ${formatInt(typeList.length)} نوعًا مخزّنًا · آخر قراءة ${readAt}`
        : `${doorScopeNote(role)} · لا طلبات في هذا النطاق عند آخر قراءة (${readAt})`;

    const windowNote = typesQuery.data?.capped
        ? `مرجع الأنواع توقّف عند ${formatInt(LEAVES_TYPE_PAGE * LEAVES_TYPE_PAGES)} نوعًا من ${formatInt(typesQuery.data.total)} — الأنواع الأقدم خارج هذه الطبقة`
        : typesQuery.data && typesQuery.data.total > typeList.length
          ? `أُرسل ${formatInt(typeList.length)} من ${formatInt(typesQuery.data.total)} نوعًا — الباقي وراء نهاية المشي`
          : '';

    const filtered = Boolean(query) || stateFilter !== 'all';

    function toggleRequestSort(key: RequestSortKey) {
        setRequestPage(1);
        setRequestSort((previous) => (previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
    }

    function toggleEventSort(key: EventSortKey) {
        setEventPage(1);
        setEventSort((previous) => (previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
    }

    function toggleTypeSort(key: TypeSortKey) {
        setTypePage(1);
        setTypeSort((previous) => (previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
    }

    function resetFilters() {
        setQuery('');
        setStateFilter('all');
        setRequestSort(null);
        setRequestPage(1);
    }

    function openAction(row: LeaveRequestRow, kind: LeaveActionKind) {
        setActionRow(row);
        setActionKind(kind);
        setActionTitle(
            kind === 'approve'
                ? `اعتماد طلب ${row.employee}`
                : kind === 'reject'
                  ? `رفض طلب ${row.employee}`
                  : `إعادة الطلب ${row.employee} للموظف`,
        );
        setActionMessage(
            kind === 'approve'
                ? 'الموافقة على طلب الإجازة ونقله للمرحلة التالية في سلسلة الاعتماد.'
                : kind === 'reject'
                  ? 'رفض الطلب نهائيًا — لا يمكن الرجوع عن الرفض.'
                  : 'إعادة الطلب للموظف لتعديله وإعادة إرساله.',
        );
        setActionOpen(true);
    }

    return (
        <div className="flex flex-col gap-md leaves-premium">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        الإجازات{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Leave Requests
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">
                        سلسلة اعتماد الطلبات في نطاق صلاحيتك: إنشاء طلب، واعتماد/رفض/إعادة داخل السلسلة مثل الشاشة القديمة، والخادم هو صاحب
                        القرار في كل الحالات.
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                        طلب إجازة جديد
                    </Button>
                    <PrintActions title="الإجازات" />
                    <button
                        type="button"
                        onClick={() => {
                            void workflowQuery.refetch();
                            void typesQuery.refetch();
                        }}
                        data-erp-print-hide
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            <p className="text-body-sm text-muted" role="status" aria-live="polite">
                {scopeLine}
            </p>

            <ul
                className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-3"
                aria-label="مؤشرات الإجازات — كل رقم معدود على السجل الذي أرسله الخادم لهذا الحساب"
            >
                {kpis.map((kpi) => (
                    <Kpi key={kpi.id} label={kpi.label} english={kpi.en} value={formatInt(kpi.value)} suffix={kpi.unit} hint={kpi.hint} />
                ))}
            </ul>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-leaves-q">
                        بحث
                        <input
                            id="erp-leaves-q"
                            type="search"
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setRequestPage(1);
                            }}
                            placeholder="الموظف، النوع، المرحلة، الملاحظة"
                            className="h-9 w-72 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <fieldset className="m-0 flex flex-wrap items-end gap-xxs border-0 p-0">
                        <legend className="sr-only">حالة سلسلة الاعتماد</legend>
                        {STATE_FILTERS.map((value) => (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={stateFilter === value}
                                onClick={() => {
                                    setStateFilter(value);
                                    setRequestPage(1);
                                }}
                                className={
                                    stateFilter === value
                                        ? 'rounded-md border border-hairline-strong bg-surface-sunken px-sm py-xxs text-body-sm text-ink'
                                        : 'rounded-md border border-transparent px-sm py-xxs text-body-sm text-muted hover:bg-surface-hover'
                                }
                            >
                                {STATE_FILTER_LABELS[value]}{' '}
                                <span className="erp-numeric" dir="ltr">
                                    {formatInt(
                                        value === 'all'
                                            ? summary.total
                                            : value === 'in_progress'
                                              ? summary.inProgress
                                              : value === 'returned'
                                                ? summary.returned
                                                : value === 'completed'
                                                  ? summary.completed
                                                  : summary.rejected,
                                    )}
                                </span>
                            </button>
                        ))}
                    </fieldset>
                    <button
                        type="button"
                        onClick={resetFilters}
                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                    >
                        مسح المرشّحات
                    </button>
                    <span className="text-body-sm text-muted" role="status" aria-live="polite">
                        {filtered
                            ? `${formatInt(sortedRequests.length)} طلبًا مطابقًا من ${formatInt(allRows.length)}`
                            : `${formatInt(allRows.length)} طلبًا محمّلًا`}
                    </span>
                </div>
                {search.folded ? (
                    <p className="mt-sm text-body-sm text-muted">بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.</p>
                ) : null}
                {windowNote ? <p className="mt-sm text-body-sm text-muted">{windowNote}</p> : null}
            </Card>

            <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-xs px-sm py-xs">
                    <h2 className="text-heading-sm text-ink">
                        طلبات الإجازة{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            The Chain
                        </span>
                    </h2>
                    <span className="text-body-sm text-muted">
                        {filtered
                            ? `${formatInt(sortedRequests.length)} من ${formatInt(summary.total)} في هذه الحالة`
                            : `${formatInt(summary.total)} طلبًا · ${formatInt(summary.employees)} موظفًا · آخر قراءة ${readAt}`}
                    </span>
                </div>

                {workflowQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل طلبات الإجازة" />
                        <TableSkeleton rows={4} columns={6} />
                    </div>
                ) : null}

                {workflowQuery.isError ? (
                    <StateError
                        message={workflowQuery.error instanceof Error ? workflowQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void workflowQuery.refetch();
                        }}
                    />
                ) : null}

                {workflowQuery.isSuccess && sortedRequests.length === 0 ? (
                    <StateEmpty
                        title={filtered ? 'لا طلبات في هذه الحالة' : 'لا طلبات في هذا النطاق'}
                        hint={
                            filtered
                                ? 'غيّر شريط الحالة أو امسح المرشّحات؛ القائمة محصورة فيما أرسله الخادم لدورك.'
                                : 'لم يُرسل الباب أي طلب لهذا الحساب — لا رقم يُختلق لصف غائب.'
                        }
                    />
                ) : null}

                {workflowQuery.isSuccess && sortedRequests.length > 0 ? (
                    <>
                        <TableScroll label="سجل طلبات الإجازة">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh label="الموظف" sortKey="employee" sort={requestSort} onToggle={toggleRequestSort} />
                                        <SortableTh label="النوع" sortKey="type" sort={requestSort} onToggle={toggleRequestSort} />
                                        <SortableTh label="من" sortKey="start" sort={requestSort} onToggle={toggleRequestSort} />
                                        <SortableTh label="إلى" sortKey="end" sort={requestSort} onToggle={toggleRequestSort} />
                                        <SortableTh label="المدة (يوم)" sortKey="days" sort={requestSort} onToggle={toggleRequestSort} />
                                        <SortableTh label="لدى من الآن" sortKey="stage" sort={requestSort} onToggle={toggleRequestSort} />
                                        <SortableTh label="الحالة" sortKey="state" sort={requestSort} onToggle={toggleRequestSort} />
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الملاحظة/السبب
                                        </th>
                                        <SortableTh
                                            label="تاريخ القرار"
                                            sortKey="decidedAt"
                                            sort={requestSort}
                                            onToggle={toggleRequestSort}
                                        />
                                        <th scope="col" className="px-sm py-xs text-start font-medium" data-erp-print-hide>
                                            إجراءات
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {requestPageRows.map((row) => (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="px-sm py-xxs text-ink">
                                                {row.employeeResolved ? row.employee : <span className="text-muted">{row.employee}</span>}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">
                                                {row.typeResolved ? row.type : <span className="text-muted">{row.type}</span>}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-ink" dir="ltr">
                                                {row.start || '—'}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-ink" dir="ltr">
                                                {row.end || '—'}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-ink" dir="ltr">
                                                {row.days === null ? <span className="text-muted">—</span> : formatInt(row.days)}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">
                                                {!row.stage ? (
                                                    <span className="text-muted">—</span>
                                                ) : row.stageKnown ? (
                                                    row.stageAr
                                                ) : (
                                                    <span className="text-muted">{row.stage}</span>
                                                )}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-ink">
                                                {row.stateKnown ? row.stateLabel : <span className="text-muted">{row.stateKey}</span>}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{row.note || '—'}</td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-ink" dir="ltr">
                                                {row.decidedAt || '—'}
                                            </td>
                                            <td className="px-sm py-xxs" data-erp-print-hide>
                                                {row.wfStatus === 'pending' || row.hasChain ? (
                                                    <div className="flex flex-wrap items-center gap-xs">
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="secondary"
                                                            title="موافقة"
                                                            onClick={() => openAction(row, 'approve')}
                                                        >
                                                            موافقة
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="danger"
                                                            title="رفض"
                                                            onClick={() => openAction(row, 'reject')}
                                                        >
                                                            رفض
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="secondary"
                                                            title="إعادة للموظف"
                                                            onClick={() => openAction(row, 'return')}
                                                        >
                                                            إعادة
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <span className="text-muted">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                        <Pager page={safeRequestPage} pageCount={requestPageCount} onChange={setRequestPage} />
                    </>
                ) : null}
            </Card>

            <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-xs px-sm py-xs">
                    <h2 className="text-heading-sm text-ink">
                        أكثر الموظفين طلبًا{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Top Requesters
                        </span>
                    </h2>
                    <span className="text-body-sm text-muted">
                        {top.length > 1
                            ? `أكبر ${formatInt(Math.min(TOP_PORTLET, top.length))} من ${formatInt(summary.employees)} موظفًا في السجل — ترتيبٌ محسوب هنا`
                            : `${formatInt(top.length)} من ${formatInt(summary.employees)} موظفًا في السجل`}
                    </span>
                </div>
                <div className="px-sm pb-sm">
                    {top.length === 0 ? (
                        <p className="text-body-sm text-muted">لا طلبات في نطاقك — لم يُرسل الباب أي طلب لهذا الحساب.</p>
                    ) : (
                        <ul className="flex flex-col gap-xs" aria-label="أكثر الموظفين طلبًا في السجل المُرسل">
                            {top.map((person) => (
                                <li key={`${person.name}-${person.count}`} className="flex items-center gap-sm">
                                    <span
                                        className={person.resolved ? 'text-body-sm text-ink' : 'text-body-sm text-muted'}
                                        title={`${person.name}: ${person.count} طلبًا، منها ${person.open} قيد الاعتماد`}
                                    >
                                        {person.name}
                                    </span>
                                    <span className="h-2 flex-1 overflow-hidden rounded-sm bg-surface-sunken">
                                        <span
                                            className="block h-2 rounded-sm bg-primary"
                                            style={{
                                                inlineSize: `${topMax > 0 ? Math.round((person.count / topMax) * 100) : 0}%`,
                                            }}
                                        />
                                    </span>
                                    <span className="erp-numeric text-body-sm text-ink" dir="ltr">
                                        {formatInt(person.count)}
                                    </span>
                                    <span className="text-caption text-faint">طلب</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </Card>

            <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-xs px-sm py-xs">
                    <h2 className="text-heading-sm text-ink">
                        سجل الاعتماد{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Approval Events
                        </span>
                    </h2>
                    <span className="text-body-sm text-muted">أحداث السلسلة كما أرسلها الباب، الأحدث أولًا</span>
                </div>

                {workflowQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل سجل الاعتماد" />
                        <TableSkeleton rows={3} columns={5} />
                    </div>
                ) : null}

                {workflowQuery.isSuccess && events.length === 0 ? <StateEmpty title="لا أحداث بعد" hint="لا أحداث اعتماد بعد." /> : null}

                {workflowQuery.isSuccess && events.length > 0 ? (
                    <>
                        <TableScroll label="سجل أحداث الاعتماد">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh label="الموظف" sortKey="employee" sort={eventSort} onToggle={toggleEventSort} />
                                        <SortableTh label="الطلب" sortKey="requestId" sort={eventSort} onToggle={toggleEventSort} />
                                        <SortableTh label="المرحلة" sortKey="stage" sort={eventSort} onToggle={toggleEventSort} />
                                        <SortableTh label="الحدث" sortKey="action" sort={eventSort} onToggle={toggleEventSort} />
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الملاحظة
                                        </th>
                                        <SortableTh label="دور الفاعل" sortKey="actorRole" sort={eventSort} onToggle={toggleEventSort} />
                                        <SortableTh label="التوقيت" sortKey="at" sort={eventSort} onToggle={toggleEventSort} />
                                    </tr>
                                </thead>
                                <tbody>
                                    {eventPageRows.map((row) => (
                                        <tr key={row.key} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="px-sm py-xxs text-ink">{row.employee}</td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-ink" dir="ltr">
                                                {row.requestId}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">
                                                {!row.stage ? (
                                                    <span className="text-muted">—</span>
                                                ) : row.stageKnown ? (
                                                    row.stageAr
                                                ) : (
                                                    <span className="text-muted">{row.stage}</span>
                                                )}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">
                                                {!row.action ? (
                                                    <span className="text-muted">—</span>
                                                ) : row.actionKnown ? (
                                                    row.actionAr
                                                ) : (
                                                    <span className="text-muted">{row.action}</span>
                                                )}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{row.note || '—'}</td>
                                            <td className="px-sm py-xxs text-body-sm text-ink">
                                                {row.actorRole ? roleLabel(row.actorRole).label : <span className="text-muted">—</span>}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-ink" dir="ltr">
                                                {row.at || '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                        <Pager page={safeEventPage} pageCount={eventPageCount} onChange={setEventPage} />
                    </>
                ) : null}
            </Card>

            <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-xs px-sm py-xs">
                    <h2 className="text-heading-sm text-ink">
                        أنواع الإجازات{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Leave Types
                        </span>
                    </h2>
                    <span className="text-body-sm text-muted">الأيام من رصد الخادم</span>
                </div>

                {typesQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل أنواع الإجازات" />
                        <TableSkeleton rows={3} columns={4} />
                    </div>
                ) : null}

                {typesQuery.isError ? (
                    <StateError
                        message={typesQuery.error instanceof Error ? typesQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void typesQuery.refetch();
                        }}
                    />
                ) : null}

                {typesQuery.isSuccess && sortedTypes.length === 0 ? (
                    <StateEmpty title="لا أنواع مخزنة" hint="بلا نوعٍ لا يُنشأ طلب — النظام يرفض الطلب بلا نوع." />
                ) : null}

                {typesQuery.isSuccess && sortedTypes.length > 0 ? (
                    <>
                        <TableScroll label="سجل أنواع الإجازات">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh label="النوع" sortKey="name" sort={typeSort} onToggle={toggleTypeSort} />
                                        <SortableTh label="الأيام المرصودة" sortKey="days" sort={typeSort} onToggle={toggleTypeSort} />
                                        <SortableTh label="مدفوعة الأجر" sortKey="paid" sort={typeSort} onToggle={toggleTypeSort} />
                                        <SortableTh label="طلباتها في السجل" sortKey="requests" sort={typeSort} onToggle={toggleTypeSort} />
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الأيقونة
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {typePageRows.map((row) => (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="px-sm py-xxs text-ink">{row.name}</td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-ink" dir="ltr">
                                                {row.days === null ? <span className="text-muted">—</span> : formatInt(row.days)}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-ink">{row.paid ? 'نعم' : 'لا'}</td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-ink" dir="ltr">
                                                {formatInt(row.requests)}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {row.icon || '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                        <Pager page={safeTypePage} pageCount={typePageCount} onChange={setTypePage} />
                    </>
                ) : null}
            </Card>

            {/* Dialogs */}
            <CreateLeaveDialog
                open={createOpen}
                employees={employeesQuery.data ?? []}
                types={typeList}
                pending={createLeaveMutation.isPending}
                onClose={() => setCreateOpen(false)}
                onSubmit={async (input) => {
                    await createLeaveMutation.mutateAsync(input);
                }}
            />
            <ConfirmLeaveDialog
                open={actionOpen}
                title={actionTitle}
                message={actionMessage}
                pending={decideMutation.isPending}
                onClose={() => {
                    setActionOpen(false);
                    setActionRow(null);
                }}
                onConfirm={async () => {
                    await decideMutation.mutateAsync(actionKind);
                }}
            />
        </div>
    );
}

/* ── حوار إنشاء طلب ──────────────────────────────────────────────────── */

interface CreateLeaveDialogProps {
    open: boolean;
    employees: readonly { id: string; name?: string | null | undefined; employeeId?: string | null | undefined }[];
    types: readonly { id: string; name?: string | null }[];
    pending: boolean;
    onClose: () => void;
    onSubmit: (input: { employeeId: string; leaveTypeId: string; startDate: string; endDate: string; reason: string }) => Promise<void>;
}

const CREATE_LEAVE_FORM_ID = 'erp-leave-create-form';

function CreateLeaveDialog({ open, employees, types, pending, onClose, onSubmit }: CreateLeaveDialogProps) {
    const [employeeId, setEmployeeId] = useState('');
    const [leaveTypeId, setLeaveTypeId] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setEmployeeId('');
            setLeaveTypeId('');
            setStartDate('');
            setEndDate('');
            setReason('');
            setError('');
        }
    }, [open]);

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setError('');
        if (!employeeId) {
            setError(LEAVE_TEXT.employeeRequired);
            return;
        }
        if (!leaveTypeId) {
            setError(LEAVE_TEXT.typeRequired);
            return;
        }
        if (!startDate || !endDate) {
            setError(LEAVE_TEXT.datesRequired);
            return;
        }
        if (endDate < startDate) {
            setError(LEAVE_TEXT.datesInvalid);
            return;
        }
        try {
            await onSubmit({ employeeId, leaveTypeId, startDate, endDate, reason });
            onClose();
        } catch (cause) {
            setError(writeErrorMessage(cause, LEAVE_TEXT.createFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title="طلب إجازة جديد"
            size="md"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {LEAVE_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={CREATE_LEAVE_FORM_ID} size="sm" loading={pending}>
                        إرسال الطلب
                    </Button>
                </>
            }
        >
            <form id={CREATE_LEAVE_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <Select
                    label="الموظف"
                    name="employeeId"
                    value={employeeId}
                    onValueChange={(v) => setEmployeeId(String(v ?? ''))}
                    options={employees.map((e) => ({
                        label: `${e.name ?? `#${e.id}`} (${e.employeeId ?? ''})`,
                        value: String(e.id),
                    }))}
                    required
                />
                <Select
                    label="نوع الإجازة"
                    name="leaveTypeId"
                    value={leaveTypeId}
                    onValueChange={(v) => setLeaveTypeId(String(v ?? ''))}
                    options={types.map((t) => ({ label: String(t.name ?? t.id), value: String(t.id) }))}
                    required
                />
                <div className="grid gap-sm sm:grid-cols-2">
                    <Input
                        label="من تاريخ"
                        name="startDate"
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        dir="ltr"
                        required
                    />
                    <Input
                        label="إلى تاريخ"
                        name="endDate"
                        type="date"
                        value={endDate}
                        min={startDate || undefined}
                        onChange={(e) => setEndDate(e.target.value)}
                        dir="ltr"
                        required
                    />
                </div>
                <Input
                    label="السبب (اختياري)"
                    name="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="سبب الطلب…"
                />
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

/* ── حوار تأكيد القرار ───────────────────────────────────────────────── */

interface ConfirmLeaveDialogProps {
    open: boolean;
    title: string;
    message: string;
    pending: boolean;
    onClose: () => void;
    onConfirm: () => Promise<void>;
}

function ConfirmLeaveDialog({ open, title, message, pending, onClose, onConfirm }: ConfirmLeaveDialogProps) {
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={title}
            size="md"
        >
            <p className="text-body-md text-ink">{message}</p>
            <div className="flex justify-end gap-sm" data-erp-print-hide>
                <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                    {LEAVE_TEXT.cancel}
                </Button>
                <Button type="button" size="sm" variant="danger" loading={pending} onClick={() => void onConfirm()}>
                    تأكيد
                </Button>
            </div>
        </Dialog>
    );
}
