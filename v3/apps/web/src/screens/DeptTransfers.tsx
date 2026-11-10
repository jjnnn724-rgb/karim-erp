import { toCents } from '@karim/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { PrintActions } from '../components/PrintActions';
import { useAuthState } from '../lib/auth';
import {
    fetchDeptTransfers,
    fetchTransferSummary,
    summarizeTransfers,
    summaryInt,
    summaryQty,
    summaryValue,
    TRANSFER_LIST_LIMIT,
    TRANSFER_STATUS_LABELS,
    TRANSFER_STATUS_ORDER,
    type TransferDaily,
    type TransferRow,
    type TransferSummaryDept,
    type TransferTopItem,
    transferToRow,
} from '../lib/dept-transfers';
import {
    approveTransfer,
    canChooseSourceDept,
    cancelTransfer,
    createDeptTransfer,
    createExternalSaleTransfer,
    EXTERNAL_DESTINATIONS,
    EXTERNAL_SALE_DEPT,
    fetchDeptStock,
    mySourceDeptCode,
    rejectTransfer,
    TRANSFER_TEXT,
    transferApproveVisible,
    transferCreateVisible,
    transferExternalVisible,
    type DeptStock,
    type DeptStockItem,
    type TransferItemInput,
} from '../lib/dept-transfers-write';
import { fetchDepartments, firstOfMonth, riyadhToday } from '../lib/finance';
import { formatMoney } from '../lib/format';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

/**
 * التحويلات الداخلية — قراءة فقط من `/api/warehouse/dept-transfers` بنفس
 * نافذة القديم (أحدث 200 إذن) ونفس شرائح الحالة وأعمدة السجل، مع لوحة
 * ملخص الفترة من `/dept-transfers/summary` (شهر الرياض الحالي).
 *
 * تحويلات التحقق الحي (`metadata.test`) مخفية كما في القديم. الإنشاء
 * والاعتماد والرفض والإلغاء والبيع الخارجي كاملة هنا بنفس بوابات الخادم.
 */

const PAGE_SIZE = 20;

type SortKey = 'number' | 'from' | 'to' | 'qty' | 'value' | 'status' | 'date';

const STATUS_TONE: Record<string, string> = {
    requested: 'text-ink-secondary',
    received: 'text-success-text',
    rejected: 'text-danger-text',
    cancelled: 'text-muted',
};

function formatInt(value: number): string {
    return value.toLocaleString('en-US');
}

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

function SortableTh({
    label,
    sortKey,
    sort,
    onToggle,
    align = 'start',
}: {
    label: string;
    sortKey: SortKey;
    sort: { key: SortKey; dir: 'asc' | 'desc' } | null;
    onToggle: (key: SortKey) => void;
    align?: 'start' | 'center' | 'end';
}) {
    const ariaSort = sort?.key !== sortKey ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending';
    const alignClass = align === 'end' ? 'text-end' : align === 'center' ? 'text-center' : 'text-start';
    return (
        <th scope="col" aria-sort={ariaSort} className={`px-sm py-xs font-medium ${alignClass}`}>
            <button type="button" onClick={() => onToggle(sortKey)}>
                {label}
            </button>
        </th>
    );
}

function compare(a: TransferRow, b: TransferRow, key: SortKey): number {
    if (key === 'qty') {
        return a.qty - b.qty;
    }
    if (key === 'value') {
        const left = toCents(a.value);
        const right = toCents(b.value);
        return left === right ? 0 : left > right ? 1 : -1;
    }
    if (key === 'from') {
        return a.fromName.localeCompare(b.fromName, 'ar');
    }
    if (key === 'to') {
        return a.toName.localeCompare(b.toName, 'ar');
    }
    if (key === 'status') {
        return a.statusLabel.localeCompare(b.statusLabel, 'ar');
    }
    if (key === 'date') {
        return a.createdAt.localeCompare(b.createdAt);
    }
    return a.number.localeCompare(b.number, 'ar', { numeric: true });
}

function matches(row: TransferRow, needle: string): boolean {
    if (!needle) {
        return true;
    }
    const haystack = [
        row.number,
        row.fromName,
        row.fromCode,
        row.toName,
        row.toCode,
        row.itemsText,
        row.notes,
        row.rejectionReason,
    ].join(' ');
    return haystack.toLocaleLowerCase('ar').includes(needle.toLocaleLowerCase('ar'));
}

function MixList({
    title,
    note,
    rows,
    empty,
}: {
    title: string;
    note: string;
    rows: readonly { label: string; value: string; qty: string; transfers: number }[];
    empty: string;
}) {
    return (
        <section className="rounded-md border border-hairline bg-surface">
            <header className="flex items-baseline justify-between gap-xs border-b border-hairline px-sm py-xs">
                <h3 className="text-heading-sm text-ink">{title}</h3>
                <span className="text-caption text-muted">{note}</span>
            </header>
            {rows.length === 0 ? (
                <p className="px-sm py-xs text-body-sm text-muted">{empty}</p>
            ) : (
                <ul className="divide-y divide-hairline">
                    {rows.map((row) => (
                        <li
                            key={row.label}
                            className="flex flex-wrap items-baseline justify-between gap-xs px-sm py-xxs"
                        >
                            <span className="text-body-sm text-ink">{row.label}</span>
                            <span className="text-caption text-muted" dir="ltr">
                                {`${row.value} · ${row.qty} · ${formatInt(row.transfers)} تحويل`}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function DailyList({ rows }: { rows: readonly TransferDaily[] }) {
    return (
        <section className="rounded-md border border-hairline bg-surface">
            <header className="flex items-baseline justify-between gap-xs border-b border-hairline px-sm py-xs">
                <h3 className="text-heading-sm text-ink">الحركة اليومية</h3>
                <span className="text-caption text-muted">عدد التحويلات · القيمة</span>
            </header>
            {rows.length === 0 ? (
                <p className="px-sm py-xs text-body-sm text-muted">لا حركة تحويلات في هذه الفترة.</p>
            ) : (
                <ul className="divide-y divide-hairline">
                    {rows.map((row) => (
                        <li
                            key={String(row.day)}
                            className="flex flex-wrap items-baseline justify-between gap-xs px-sm py-xxs"
                        >
                            <span className="erp-numeric text-body-sm text-ink" dir="ltr">
                                {String(row.day ?? '') || '—'}
                            </span>
                            <span className="text-caption text-muted" dir="ltr">
                                {`${formatInt(summaryInt(row.transfers))} · ${formatMoney(summaryValue(row.value))}`}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function TopItemsList({ rows }: { rows: readonly TransferTopItem[] }) {
    return (
        <section className="rounded-md border border-hairline bg-surface">
            <header className="flex items-baseline justify-between gap-xs border-b border-hairline px-sm py-xs">
                <h3 className="text-heading-sm text-ink">أعلى الأصناف المحوَّلة</h3>
                <span className="text-caption text-muted">حسب القيمة</span>
            </header>
            {rows.length === 0 ? (
                <p className="px-sm py-xs text-body-sm text-muted">لا أصناف محوَّلة في هذه الفترة.</p>
            ) : (
                <ul className="divide-y divide-hairline">
                    {rows.map((row) => (
                        <li
                            key={String(row.inventory_id ?? row.item_name)}
                            className="flex flex-wrap items-baseline justify-between gap-xs px-sm py-xxs"
                        >
                            <span className="text-body-sm text-ink">
                                {String(row.item_name ?? '—')}{' '}
                                <span className="text-caption text-muted">{String(row.unit ?? '')}</span>
                            </span>
                            <span className="text-caption text-muted" dir="ltr">
                                {`${summaryQty(row.qty)} · ${formatMoney(summaryValue(row.value))}`}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function deptMix(rows: readonly TransferSummaryDept[] | null | undefined) {
    return (rows ?? []).slice(0, 6).map((row) => ({
        label: String(row.dept_name || row.dept_code || 'غير محدد'),
        value: formatMoney(summaryValue(row.value)),
        qty: summaryQty(row.qty),
        transfers: summaryInt(row.transfers),
    }));
}

export function DeptTransfers() {
    const auth = useAuthState();
    const role = auth.user?.role ?? '';
    const userId = auth.user?.id ?? '';
    const roleText = String(role).toLowerCase();
    const mayCreate = transferCreateVisible(role);
    const mayApprove = transferApproveVisible(role);
    const mayExternal = transferExternalVisible(role);
    const mayChooseSource = canChooseSourceDept(role);
    const mySrc = mySourceDeptCode({ role, deptCode: (auth.user as { dept_code?: string | null | undefined } | null)?.dept_code ?? null });

    const [status, setStatus] = useState('all');
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
    const [page, setPage] = useState(1);
    const range = useMemo(() => ({ from: firstOfMonth(), to: riyadhToday() }), []);

    const [createMode, setCreateMode] = useState<'internal' | 'external' | null>(null);
    const [actionRow, setActionRow] = useState<TransferRow | null>(null);
    const [actionKind, setActionKind] = useState<'approve' | 'reject' | 'cancel'>('approve');
    const [actionMessage, setActionMessage] = useState('');
    const [pageError, setPageError] = useState('');

    const invalidateTransfers: readonly (readonly string[])[] = [['dept-transfers'], ['dept-transfers', 'summary', range.from, range.to]];

    const createMutation = useWriteMutation<
        { sourceDeptCode: string; destDeptCode: string; items: TransferItemInput[]; notes: string },
        void
    >({
        mutationFn: (input) => createDeptTransfer(input).then(() => undefined),
        successTitle: () => TRANSFER_TEXT.createSuccess,
        invalidate: invalidateTransfers,
        silentError: true,
        onSuccess: () => setCreateMode(null),
    });

    const externalMutation = useWriteMutation<
        { sourceDeptCode: string; destDeptCode: string; items: TransferItemInput[]; notes: string },
        void
    >({
        mutationFn: (input) => createExternalSaleTransfer(input).then(() => undefined),
        successTitle: () => TRANSFER_TEXT.externalSuccess,
        invalidate: invalidateTransfers,
        silentError: true,
        onSuccess: () => setCreateMode(null),
    });

    const actionMutation = useWriteMutation<'approve' | 'reject' | 'cancel', void>({
        mutationFn: async (kind) => {
            if (!actionRow) {
                return;
            }
            if (kind === 'approve') {
                await approveTransfer(actionRow.id);
            } else if (kind === 'reject') {
                await rejectTransfer(actionRow.id, actionMessage);
            } else {
                await cancelTransfer(actionRow.id);
            }
        },
        successTitle: (kind) =>
            kind === 'approve'
                ? TRANSFER_TEXT.approveSuccess
                : kind === 'reject'
                  ? TRANSFER_TEXT.rejectSuccess
                  : TRANSFER_TEXT.cancelSuccess,
        invalidate: invalidateTransfers,
        silentError: true,
        onSuccess: () => {
            setActionRow(null);
            setActionMessage('');
            setPageError('');
        },
        onError: (cause) => setPageError(writeErrorMessage(cause, TRANSFER_TEXT.actionFailed)),
    });

    function openAction(row: TransferRow, kind: 'approve' | 'reject' | 'cancel') {
        setActionRow(row);
        setActionKind(kind);
        setActionMessage('');
        setPageError('');
    }

    const transfersQuery = useQuery({
        queryKey: ['dept-transfers'],
        queryFn: ({ signal }) => fetchDeptTransfers(signal),
    });
    const departmentsQuery = useQuery({
        queryKey: ['departments', 'options'],
        queryFn: ({ signal }) => fetchDepartments(signal),
        staleTime: 10 * 60 * 1000,
    });
    const summaryQuery = useQuery({
        queryKey: ['dept-transfers', 'summary', range.from, range.to],
        queryFn: ({ signal }) => fetchTransferSummary(range.from, range.to, signal),
    });

    const deptNames = useMemo(() => {
        const map = new Map<string, string>();
        for (const dept of departmentsQuery.data ?? []) {
            map.set(dept.code.toLowerCase(), dept.name);
        }
        return map;
    }, [departmentsQuery.data]);

    const visibleRows = useMemo(
        () =>
            (transfersQuery.data ?? [])
                .map((transfer) => transferToRow(transfer, deptNames))
                .filter((row) => !row.test),
        [transfersQuery.data, deptNames],
    );
    const totals = useMemo(() => summarizeTransfers(visibleRows), [visibleRows]);

    const needle = search.trim();
    const filtered = useMemo(() => {
        const byStatus = status === 'all' ? visibleRows : visibleRows.filter((row) => row.status === status);
        return byStatus.filter((row) => matches(row, needle));
    }, [visibleRows, status, needle]);

    const sorted = useMemo(() => {
        if (!sort) {
            return filtered;
        }
        const copy = [...filtered].sort((a, b) => compare(a, b, sort.key));
        return sort.dir === 'asc' ? copy : copy.reverse();
    }, [filtered, sort]);

    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const capped = (transfersQuery.data?.length ?? 0) >= TRANSFER_LIST_LIMIT;

    const summary = summaryQuery.data;
    const summaryTotals = summary?.totals;

    function toggleSort(key: SortKey) {
        setPage(1);
        setSort((previous) =>
            previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
        );
    }

    function chooseStatus(next: string) {
        setStatus(next);
        setPage(1);
    }

    return (
        <div className="flex flex-col gap-md">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        التحويلات الداخلية{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Internal Transfers
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">
                        تحويل البضاعة بين الأقسام ومنافذ البيع الخارجية — طلبٌ واعتماد الشيف وتنفيذٌ فوري بالتكلفة
                        الفعلية، وتحويل مباشر للبيع الخارجي.
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    {mayCreate ? (
                        <Button type="button" size="sm" onClick={() => setCreateMode('internal')}>
                            طلب تحويل جديد
                        </Button>
                    ) : null}
                    {mayExternal ? (
                        <Button type="button" size="sm" variant="secondary" onClick={() => setCreateMode('external')}>
                            تحويل للبيع الخارجي
                        </Button>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => {
                            void transfersQuery.refetch();
                            void summaryQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                    <PrintActions title="التحويلات الداخلية" />
                </div>
            </header>
            {pageError ? (
                <p role="alert" className="text-body-sm text-danger-text">
                    {pageError}
                </p>
            ) : null}

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                    label="إجمالي التحويلات"
                    english="Transfers"
                    value={formatInt(totals.total)}
                    hint={`أحدث ${formatInt(TRANSFER_LIST_LIMIT)} إذنًا`}
                />
                <Kpi
                    label="بانتظار الاعتماد"
                    english="Pending"
                    value={formatInt(totals.pending)}
                    hint={TRANSFER_STATUS_LABELS.requested ?? ''}
                />
                <Kpi
                    label="منفَّذة ومكتملة"
                    english="Completed"
                    value={formatInt(totals.done)}
                    hint={`${formatInt(totals.rejected)} مرفوضة · ${formatInt(totals.cancelled)} ملغاة`}
                />
                <Kpi
                    label="قيمة المنفَّذ (تكلفة فعلية)"
                    english="Value"
                    value={formatMoney(totals.value)}
                    hint="مجموع التحويلات المنفَّذة"
                />
            </div>

            <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-xs border-b border-hairline px-sm py-xs">
                    <div>
                        <h2 className="text-heading-sm text-ink">لوحة التحويلات</h2>
                        <p className="text-caption text-muted">
                            {`${range.from} → ${range.to} · تحويلات منفَّذة فقط (بلا تحقق حي)`}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            void summaryQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                    >
                        تحديث اللوحة
                    </button>
                </div>

                {summaryQuery.isPending ? (
                    <div className="px-sm py-sm" aria-busy="true">
                        <StateLoading label="جارٍ تحميل ملخص التحويلات" />
                        <TableSkeleton rows={3} columns={4} />
                    </div>
                ) : null}

                {summaryQuery.isError ? (
                    <p className="px-sm py-sm text-body-sm text-danger-text" role="alert">
                        تعذّر تحميل ملخص التحويلات —{' '}
                        {summaryQuery.error instanceof Error ? summaryQuery.error.message : 'خطأ غير معروف'}
                    </p>
                ) : null}

                {summaryQuery.isSuccess ? (
                    <div className="flex flex-col gap-sm p-sm">
                        <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                            <Kpi
                                label="قيمة البضاعة المنقولة"
                                english="Moved"
                                value={formatMoney(summaryValue(summaryTotals?.value))}
                                hint="تكلفة فعلية"
                            />
                            <Kpi
                                label="عدد التحويلات"
                                english="Count"
                                value={formatInt(summaryInt(summaryTotals?.transfers))}
                                hint={`${formatInt(summaryInt(summaryTotals?.lines))} بند صنف`}
                            />
                            <Kpi
                                label="أقسام مرسلة"
                                english="Sources"
                                value={formatInt(summaryInt(summaryTotals?.sources))}
                                hint="أقسام سلّمت بضاعة"
                            />
                            <Kpi
                                label="جهات مستلمة"
                                english="Destinations"
                                value={formatInt(summaryInt(summaryTotals?.destinations))}
                                hint="أقسام ومنافذ بيع خارجية"
                            />
                        </div>
                        <div className="grid gap-sm xl:grid-cols-2">
                            <MixList
                                title="أعلى الأقسام المرسلة"
                                note="قيمة البضاعة الخارجة"
                                rows={deptMix(summary?.bySource)}
                                empty="لا تحويلات صادرة في هذه الفترة."
                            />
                            <MixList
                                title="أعلى الجهات المستلمة"
                                note="قيمة البضاعة الواردة"
                                rows={deptMix(summary?.byDest)}
                                empty="لا تحويلات واردة في هذه الفترة."
                            />
                            <TopItemsList rows={summary?.topItems ?? []} />
                            <DailyList rows={summary?.daily ?? []} />
                        </div>
                    </div>
                ) : null}
            </Card>

            <Card className="p-sm">
                <fieldset className="flex flex-wrap items-center gap-xs">
                    <legend className="pb-2 text-label-md text-ink-secondary">حالة التحويل</legend>
                    <button
                        type="button"
                        aria-pressed={status === 'all'}
                        onClick={() => {
                            chooseStatus('all');
                        }}
                        className={`rounded-md border border-hairline-strong px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover ${
                            status === 'all' ? 'bg-surface-sunken font-medium' : 'bg-surface'
                        }`}
                    >
                        {`الكل (${formatInt(totals.total)})`}
                    </button>
                    {TRANSFER_STATUS_ORDER.map((key) => {
                        const count = visibleRows.filter((row) => row.status === key).length;
                        return (
                            <button
                                key={key}
                                type="button"
                                aria-pressed={status === key}
                                onClick={() => {
                                    chooseStatus(key);
                                }}
                                className={`rounded-md border border-hairline-strong px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover ${
                                    status === key ? 'bg-surface-sunken font-medium' : 'bg-surface'
                                }`}
                            >
                                {`${TRANSFER_STATUS_LABELS[key] ?? key} (${formatInt(count)})`}
                            </button>
                        );
                    })}
                </fieldset>
                <div className="mt-sm flex flex-wrap items-end gap-sm">
                    <label
                        className="flex min-w-56 flex-1 flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-transfers-search"
                    >
                        بحث
                        <input
                            id="erp-transfers-search"
                            type="search"
                            value={search}
                            placeholder="رقم الإذن أو القسم أو الصنف…"
                            onChange={(event) => {
                                setSearch(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <button
                        type="button"
                        onClick={() => {
                            setSearch('');
                            setSort(null);
                            setStatus('all');
                            setPage(1);
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                    >
                        مسح المرشّحات
                    </button>
                    <span className="text-body-sm text-muted">{formatInt(sorted.length)} تحويلًا</span>
                </div>
            </Card>

            <Card>
                {transfersQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل التحويلات" />
                        <TableSkeleton rows={6} columns={9} />
                    </div>
                ) : null}

                {transfersQuery.isError ? (
                    <StateError
                        message={transfersQuery.error instanceof Error ? transfersQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void transfersQuery.refetch();
                        }}
                    />
                ) : null}

                {transfersQuery.isSuccess && sorted.length === 0 ? (
                    <StateEmpty
                        title={visibleRows.length === 0 ? 'لا تحويلات مسجلة' : 'لا تحويلات مطابقة'}
                        hint={
                            visibleRows.length === 0
                                ? 'الإنشاء والبيع الخارجي غير متاحين من هذه الشاشة.'
                                : 'غيّر الحالة أو امسح البحث.'
                        }
                    />
                ) : null}

                {transfersQuery.isSuccess && sorted.length > 0 ? (
                    <>
                        <p className="border-b border-hairline px-sm py-xs text-body-sm text-muted" role="status">
                            {`${formatInt(totals.total)} تحويلًا · بانتظار ${formatInt(totals.pending)} · منفَّذة ${formatInt(totals.done)} · مرفوضة ${formatInt(totals.rejected)} · ملغاة ${formatInt(totals.cancelled)}`}
                            {` · إجمالي القيمة المنفَّذة ${formatMoney(totals.value)}`}
                            {needle ? ` · نتائج «${needle}»` : ''}
                            {capped ? ` · الخادم أعاد أحدث ${formatInt(TRANSFER_LIST_LIMIT)} إذنًا فقط` : ''}
                        </p>
                        <TableScroll label="جدول التحويلات الداخلية">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh label="الإذن" sortKey="number" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="من قسم" sortKey="from" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="إلى قسم" sortKey="to" sort={sort} onToggle={toggleSort} />
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الأصناف
                                        </th>
                                        <SortableTh
                                            label="الكمية"
                                            sortKey="qty"
                                            sort={sort}
                                            onToggle={toggleSort}
                                            align="end"
                                        />
                                        <SortableTh
                                            label="القيمة (تكلفة فعلية)"
                                            sortKey="value"
                                            sort={sort}
                                            onToggle={toggleSort}
                                            align="end"
                                        />
                                        <SortableTh label="الحالة" sortKey="status" sort={sort} onToggle={toggleSort} />
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            طلبها
                                        </th>
                                        <SortableTh
                                            label="التاريخ"
                                            sortKey="date"
                                            sort={sort}
                                            onToggle={toggleSort}
                                            align="center"
                                        />
                                        <th scope="col" className="px-sm py-xs text-start font-medium" data-erp-print-hide>
                                            إجراءات
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row) => (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="px-sm py-xxs text-start">
                                                <span className="erp-numeric text-ink" dir="ltr">
                                                    {row.number}
                                                </span>
                                                {row.factory ? (
                                                    <span className="block text-caption text-muted">تحويل مصنع</span>
                                                ) : row.external ? (
                                                    <span className="block text-caption text-muted">بيع خارجي</span>
                                                ) : null}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">{row.fromName}</td>
                                            <td className="px-sm py-xxs text-ink">{row.toName}</td>
                                            <td
                                                className="px-sm py-xxs text-body-sm text-ink-secondary"
                                                title={row.itemsText}
                                            >
                                                {row.itemsText}
                                            </td>
                                            <td
                                                className="erp-numeric px-sm py-xxs text-end text-body-sm text-muted"
                                                dir="ltr"
                                            >
                                                {row.qtyText}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink">
                                                {formatMoney(row.value)}
                                                {row.factory ? (
                                                    <span className="block text-caption text-muted">
                                                        {`تسوية القائمة: ${formatMoney(row.factoryValue)}`}
                                                    </span>
                                                ) : null}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm">
                                                <span className={STATUS_TONE[row.status] ?? 'text-muted'}>
                                                    {row.statusLabel}
                                                </span>
                                                {row.status && !row.statusKnown ? (
                                                    <span className="text-caption text-faint" dir="ltr">
                                                        {' '}
                                                        ({row.status})
                                                    </span>
                                                ) : null}
                                                {row.status === 'rejected' && row.rejectionReason ? (
                                                    <span
                                                        className="block text-caption text-muted"
                                                        title={row.rejectionReason}
                                                    >
                                                        {row.rejectionReason}
                                                    </span>
                                                ) : null}
                                            </td>
                                            <td
                                                className="erp-numeric px-sm py-xxs text-start text-body-sm text-muted"
                                                dir="ltr"
                                            >
                                                {row.requestedBy ? `#${row.requestedBy}` : '—'}
                                            </td>
                                            <td
                                                className="erp-numeric px-sm py-xxs text-center text-body-sm text-muted"
                                                dir="ltr"
                                            >
                                                {row.createdAt || '—'}
                                            </td>
                                            <td className="px-sm py-xxs" data-erp-print-hide>
                                                {(() => {
                                                    const mine = String(row.requestedBy) === String(userId);
                                                    const showApprove = mayApprove && row.status === 'requested' && !mine;
                                                    const showCancel = row.status === 'requested' && (mine || roleText === 'admin' || roleText === 'manager');
                                                    if (!showApprove && !showCancel) {
                                                        return <span className="text-muted">—</span>;
                                                    }
                                                    return (
                                                        <div className="flex flex-wrap items-center gap-xs">
                                                            {showApprove ? (
                                                                <>
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant="secondary"
                                                                        title="اعتماد وتنفيذ فوري"
                                                                        onClick={() => openAction(row, 'approve')}
                                                                    >
                                                                        اعتماد
                                                                    </Button>
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant="danger"
                                                                        title="رفض الطلب"
                                                                        onClick={() => openAction(row, 'reject')}
                                                                    >
                                                                        رفض
                                                                    </Button>
                                                                </>
                                                            ) : null}
                                                            {showCancel ? (
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="secondary"
                                                                    title="إلغاء الطلب"
                                                                    onClick={() => openAction(row, 'cancel')}
                                                                >
                                                                    إلغاء
                                                                </Button>
                                                            ) : null}
                                                        </div>
                                                    );
                                                })()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>

                        <div className="flex items-center justify-between gap-sm border-t border-hairline px-sm py-xs">
                            <span className="text-body-sm text-muted">
                                صفحة {formatInt(safePage)} من {formatInt(pageCount)}
                            </span>
                            <div className="flex gap-xs">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPage(safePage - 1);
                                    }}
                                    disabled={safePage <= 1}
                                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                >
                                    السابق
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPage(safePage + 1);
                                    }}
                                    disabled={safePage >= pageCount}
                                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                >
                                    التالي
                                </button>
                            </div>
                        </div>
                    </>
                ) : null}
            </Card>

            {/* حوار إنشاء تحويل / بيع خارجي */}
            <CreateTransferDialog
                open={createMode !== null}
                mode={createMode ?? 'internal'}
                departments={(departmentsQuery.data ?? []).map((dept) => ({ code: dept.code, name: dept.name }))}
                fixedSource={mayChooseSource ? null : mySrc}
                pending={createMutation.isPending || externalMutation.isPending}
                onClose={() => setCreateMode(null)}
                onSubmit={async (input) => {
                    if (createMode === 'external') {
                        await externalMutation.mutateAsync(input);
                    } else {
                        await createMutation.mutateAsync(input);
                    }
                }}
            />

            {/* حوار إجراء (اعتماد/رفض/إلغاء) */}
            <ActionDialog
                open={actionRow !== null}
                kind={actionKind}
                row={actionRow}
                message={actionMessage}
                pending={actionMutation.isPending}
                onMessageChange={setActionMessage}
                onClose={() => {
                    setActionRow(null);
                    setActionMessage('');
                }}
                onConfirm={async () => {
                    await actionMutation.mutateAsync(actionKind);
                }}
            />
        </div>
    );
}

/* ── حوار إنشاء تحويل ─────────────────────────────────────────────────── */

interface CreateDialogProps {
    open: boolean;
    mode: 'internal' | 'external';
    departments: readonly { code: string; name: string }[];
    fixedSource: string | null;
    pending: boolean;
    onClose: () => void;
    onSubmit: (input: {
        sourceDeptCode: string;
        destDeptCode: string;
        items: TransferItemInput[];
        notes: string;
    }) => Promise<void>;
}

const CREATE_FORM_ID = 'erp-transfer-create-form';

function CreateTransferDialog({
    open,
    mode,
    departments,
    fixedSource,
    pending,
    onClose,
    onSubmit,
}: CreateDialogProps) {
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [notes, setNotes] = useState('');
    const [stock, setStock] = useState<DeptStock | null>(null);
    const [stockLoading, setStockLoading] = useState(false);
    const [itemId, setItemId] = useState('');
    const [itemQty, setItemQty] = useState('1');
    const [lines, setLines] = useState<
        { inventory_id: string; name: string; unit: string; qty: number; avgCost: number }[]
    >([]);
    const [error, setError] = useState('');

    const isExternal = mode === 'external';

    useEffect(() => {
        if (open) {
            setFrom(fixedSource ?? '');
            setTo(isExternal ? EXTERNAL_SALE_DEPT : '');
            setNotes('');
            setStock(null);
            setItemId('');
            setItemQty('1');
            setLines([]);
            setError('');
        }
    }, [open, fixedSource, isExternal]);

    useEffect(() => {
        if (!open || !from) {
            setStock(null);
            return;
        }
        let cancelled = false;
        setStockLoading(true);
        setStock(null);
        void fetchDeptStock(from, 'month')
            .then((data) => {
                if (!cancelled) {
                    setStock(data);
                    setItemId('');
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setStock(null);
                    setError('تعذّر جلب بضاعة أذونات القسم');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setStockLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [open, from]);

    const stockItems: DeptStockItem[] = stock?.items ?? [];

    const sourceChoices = departments.filter(
        (d) => d.code && !EXTERNAL_DESTINATIONS.some((e) => e.code.toLowerCase() === d.code.toLowerCase()),
    );
    const destChoices = isExternal
        ? [...EXTERNAL_DESTINATIONS]
        : departments.filter(
              (d) =>
                  d.code &&
                  d.code.toLowerCase() !== from.toLowerCase() &&
                  !EXTERNAL_DESTINATIONS.some((e) => e.code.toLowerCase() === d.code.toLowerCase()),
          );

    function addLine() {
        setError('');
        const item = stockItems.find((s) => String(s.inventory_id) === String(itemId));
        if (!item) {
            setError('اختر صنفًا من بضاعة القسم');
            return;
        }
        const qty = Number(itemQty);
        if (!Number.isFinite(qty) || qty <= 0) {
            setError(TRANSFER_TEXT.qtyInvalid);
            return;
        }
        const cap = Number(item.available ?? 0);
        const already = lines
            .filter((l) => String(l.inventory_id) === String(item.inventory_id))
            .reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
        if (qty + already > cap + 0.000001) {
            setError(`الكمية تتجاوز المتاح من إذن الصرف — المتاح ${cap} ${item.voucher_unit ?? item.unit ?? ''}`);
            return;
        }
        setLines((previous) => {
            const existing = previous.find((l) => String(l.inventory_id) === String(item.inventory_id));
            if (existing) {
                return previous.map((l) => (l === existing ? { ...l, qty: l.qty + qty } : l));
            }
            return [
                ...previous,
                {
                    inventory_id: String(item.inventory_id),
                    name: String(item.item_name ?? `صنف #${item.inventory_id}`),
                    unit: String(item.voucher_unit ?? item.unit ?? ''),
                    qty,
                    avgCost: Number(item.avg_cost ?? 0),
                },
            ];
        });
        setItemQty('1');
    }

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setError('');
        if (!from) {
            setError(TRANSFER_TEXT.sourceRequired);
            return;
        }
        if (!to) {
            setError(TRANSFER_TEXT.destRequired);
            return;
        }
        if (!lines.length) {
            setError(TRANSFER_TEXT.itemsRequired);
            return;
        }
        try {
            await onSubmit({
                sourceDeptCode: from,
                destDeptCode: to,
                items: lines.map((l) => ({ inventory_id: l.inventory_id, qty: l.qty })),
                notes,
            });
            onClose();
        } catch (cause) {
            setError(writeErrorMessage(cause, TRANSFER_TEXT.createFailed));
        }
    }

    const total = lines.reduce((sum, l) => sum + l.qty * l.avgCost, 0);

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={isExternal ? 'تحويل لمنافذ البيع الخارجية — تنفيذ مباشر' : 'طلب تحويل بين قسمين'}
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {TRANSFER_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={CREATE_FORM_ID} size="sm" loading={pending}>
                        {isExternal ? 'تنفيذ التحويل الآن' : 'إرسال الطلب للشيف'}
                    </Button>
                </>
            }
        >
            <form id={CREATE_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <p className="text-body-sm text-muted">
                    {isExternal
                        ? 'يخصم فورًا من مخزن قسمك ويُضاف إلى منفذ البيع المختار — بدون اعتماد. المصدر: أذونات صرف الشهر الحالي بتكلفة الإذن الفعلية.'
                        : 'يرسل طلبًا للشيف — عند الاعتماد يُخصم ويُضاف بالتكلفة الفعلية. الكمية محصورة في أذونات الصرف المعتمدة فعليًا في الشهر الحالي.'}
                </p>
                <div className="grid gap-sm sm:grid-cols-2">
                    {fixedSource ? (
                        <div className="flex flex-col gap-xxs">
                            <span className="text-label-md text-ink-secondary">من قسم</span>
                            <span className="text-body-md text-ink">
                                {departments.find((d) => d.code.toLowerCase() === fixedSource.toLowerCase())?.name ?? fixedSource}
                            </span>
                        </div>
                    ) : (
                        <Select
                            label="من قسم"
                            name="from"
                            value={from}
                            onValueChange={(v) => setFrom(String(v ?? ''))}
                            options={sourceChoices.map((d) => ({ label: d.name, value: d.code }))}
                            required
                        />
                    )}
                    <Select
                        label={isExternal ? 'إلى منفذ' : 'إلى قسم'}
                        name="to"
                        value={to}
                        onValueChange={(v) => setTo(String(v ?? ''))}
                        options={destChoices.map((d) => ({ label: d.name, value: d.code }))}
                        required
                    />
                </div>
                {stockLoading ? (
                    <p className="text-body-sm text-muted" role="status">
                        جارٍ تحميل بضاعة أذونات القسم…
                    </p>
                ) : null}
                {from && !stockLoading ? (
                    <div className="grid gap-sm sm:grid-cols-[1fr_120px_auto]">
                        <Select
                            label="الصنف"
                            name="item"
                            value={itemId}
                            onValueChange={(v) => setItemId(String(v ?? ''))}
                            options={stockItems.map((s) => ({
                                label: `${String(s.item_name ?? `صنف #${s.inventory_id}`)} — متاح ${Number(s.available ?? 0)} ${String(s.voucher_unit ?? s.unit ?? '')}`,
                                value: String(s.inventory_id),
                            }))}
                        />
                        <Input
                            label="الكمية"
                            name="qty"
                            type="number"
                            min={0.001}
                            step={0.001}
                            value={itemQty}
                            onChange={(e) => setItemQty(e.target.value)}
                        />
                        <div className="flex items-end">
                            <Button type="button" variant="secondary" size="sm" onClick={addLine}>
                                إضافة
                            </Button>
                        </div>
                    </div>
                ) : null}
                {lines.length ? (
                    <ul className="flex flex-col gap-xxs">
                        {lines.map((line) => (
                            <li
                                key={line.inventory_id}
                                className="flex items-center justify-between gap-sm rounded-md bg-surface-sunken px-sm py-xxs text-body-sm"
                            >
                                <span className="text-ink">{line.name}</span>
                                <span className="erp-numeric text-muted" dir="ltr">
                                    {line.qty} {line.unit} · {formatMoney(String(line.qty * line.avgCost))}
                                </span>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setLines((previous) => previous.filter((l) => l.inventory_id !== line.inventory_id))
                                    }
                                    className="text-danger-text"
                                >
                                    إزالة
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-body-sm text-muted">
                        {from
                            ? 'لم تُضَف أصناف بعد — اختر صنفًا من بضاعة القسم ثم اضغط «إضافة».'
                            : 'حدد القسم المرسل لتظهر أصناف رصيده.'}
                    </p>
                )}
                {lines.length ? (
                    <p className="text-body-sm text-muted">القيمة التقديرية: {formatMoney(String(total))}</p>
                ) : null}
                <Input label="ملاحظات (اختياري)" name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

/* ── حوار الإجراء (اعتماد/رفض/إلغاء) ──────────────────────────────────── */

interface ActionDialogProps {
    open: boolean;
    kind: 'approve' | 'reject' | 'cancel';
    row: TransferRow | null;
    message: string;
    pending: boolean;
    onMessageChange: (value: string) => void;
    onClose: () => void;
    onConfirm: () => Promise<void>;
}

function ActionDialog({ open, kind, row, message, pending, onMessageChange, onClose, onConfirm }: ActionDialogProps) {
    const titles = {
        approve: 'اعتماد التحويل',
        reject: 'رفض التحويل',
        cancel: 'إلغاء التحويل',
    } as const;
    const messages = {
        approve: 'اعتماد التحويل وتنفيذه فورًا؟ سيخصم من مخزن المرسل ويضاف للمستلم بالتكلفة الفعلية.',
        reject: 'رفض طلب التحويل نهائيًا — لا يمكن الرجوع عن الرفض.',
        cancel: 'إلغاء طلب التحويل؟',
    } as const;

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={titles[kind]}
            size="md"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {TRANSFER_TEXT.cancel}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant={kind === 'approve' ? 'primary' : 'danger'}
                        loading={pending}
                        onClick={() => void onConfirm()}
                    >
                        تأكيد
                    </Button>
                </>
            }
        >
            <p className="text-body-md text-ink">{row ? `إذن ${row.number}: ${row.fromName} → ${row.toName}` : ''}</p>
            <p className="text-body-sm text-muted">{messages[kind]}</p>
            {kind === 'reject' ? (
                <div className="mt-sm">
                    <Input
                        label="سبب الرفض (مطلوب)"
                        name="reason"
                        value={message}
                        onChange={(e) => onMessageChange(e.target.value)}
                        placeholder="يُسجَّل ويُشعَر به مقدم الطلب"
                    />
                </div>
            ) : null}
        </Dialog>
    );
}
