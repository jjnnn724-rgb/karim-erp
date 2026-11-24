import { toCents } from '@karim/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { type Dispatch, fetchDispatches } from '../lib/dispatches';
import { type Department, fetchCurrency, fetchDepartments } from '../lib/finance';
import { formatMoney } from '../lib/format';
import {
    fetchKitchenReturns,
    type KitchenReturnRow,
    kitchenReturnToRow,
    MAX_PAGES,
    returnTotals,
    PAGE_SIZE as SERVER_PAGE_SIZE,
} from '../lib/kitchen-returns';
import {
    createKitchenReturn,
    voidKitchenReturn,
    WH_RETURN_TEXT,
    type WhReturnItemInput,
    whReturnVoidVisible,
    whReturnWriteVisible,
} from '../lib/wh-returns-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';

import { PageHeader } from '../ui';
/**
 * مرتجعات المطبخ — قراءة من `/api/kitchenReturns` بنفس سؤال القديم
 * (`frontend/app/js/v2/screens/wh-returns.js`): الشهر الحالي فقط، والأحدث
 * أولًا، وسقف 8×1000 معلن. الإنشاء والإبطال عبر مسار العملية المخصص.
 */

const PAGE_SIZE = 20;

type SortKey = 'id' | 'dept' | 'date' | 'total' | 'items';

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

function compare(a: KitchenReturnRow, b: KitchenReturnRow, key: SortKey): number {
    if (key === 'total') {
        const left = toCents(a.total);
        const right = toCents(b.total);
        return left === right ? 0 : left > right ? 1 : -1;
    }
    if (key === 'items') {
        return a.itemsCount - b.itemsCount;
    }
    if (key === 'date') {
        return a.date.localeCompare(b.date);
    }
    if (key === 'dept') {
        return a.deptName.localeCompare(b.deptName, 'ar');
    }
    return a.id.localeCompare(b.id, 'ar', { numeric: true });
}

function matches(row: KitchenReturnRow, needle: string): boolean {
    if (!needle) {
        return true;
    }
    const haystack = `${row.deptName} ${row.deptCode} ${row.itemsSummary} ${row.reasonText}`;
    return haystack.toLocaleLowerCase('ar').includes(needle.toLocaleLowerCase('ar'));
}

export function KitchenReturns() {
    const auth = useAuthState();
    const canWrite = whReturnWriteVisible(auth.user?.role);
    const canVoid = whReturnVoidVisible(auth.user?.role);
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
    const [page, setPage] = useState(1);
    const [createOpen, setCreateOpen] = useState(false);
    const [voidRow, setVoidRow] = useState<KitchenReturnRow | null>(null);
    const [pageError, setPageError] = useState('');

    const returnsQuery = useQuery({
        queryKey: ['kitchen-returns'],
        queryFn: ({ signal }) => fetchKitchenReturns(signal),
    });
    const currencyQuery = useQuery({
        queryKey: ['finance', 'currency'],
        queryFn: ({ signal }) => fetchCurrency(signal),
        staleTime: 10 * 60 * 1000,
    });
    const departmentsQuery = useQuery({
        queryKey: ['departments', 'kitchen-return'],
        queryFn: ({ signal }) => fetchDepartments(signal),
        enabled: canWrite,
        staleTime: 5 * 60 * 1000,
    });
    const dispatchesQuery = useQuery({
        queryKey: ['dispatches', 'kitchen-return'],
        queryFn: ({ signal }) => fetchDispatches('month', signal),
        enabled: canWrite,
        staleTime: 60 * 1000,
    });
    const returnDispatches = (dispatchesQuery.data ?? []).filter((dispatch) =>
        ['approved', 'partially_received', 'received'].includes(dispatch.status ?? ''),
    );

    const currency = currencyQuery.data ?? '';
    const allRows = useMemo(() => (returnsQuery.data ?? []).map(kitchenReturnToRow), [returnsQuery.data]);

    const needle = search.trim();
    const rows = useMemo(() => allRows.filter((row) => matches(row, needle)), [allRows, needle]);

    const sorted = useMemo(() => {
        if (!sort) {
            return rows;
        }
        const copy = [...rows].sort((a, b) => compare(a, b, sort.key));
        return sort.dir === 'asc' ? copy : copy.reverse();
    }, [rows, sort]);

    const totals = useMemo(() => returnTotals(sorted), [sorted]);
    const capped = (returnsQuery.data?.length ?? 0) >= SERVER_PAGE_SIZE * MAX_PAGES;

    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    function toggleSort(key: SortKey) {
        setPage(1);
        setSort((previous) =>
            previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
        );
    }

    const createMutation = useWriteMutation<
        {
            items: WhReturnItemInput[];
            deptCode: string;
            deptName: string;
            reason: string;
            notes: string;
            dispatchId?: number;
        },
        void
    >({
        mutationFn: (input) => createKitchenReturn(input).then(() => undefined),
        successTitle: () => WH_RETURN_TEXT.createSuccess,
        invalidate: [['kitchen-returns']],
        silentError: true,
        onSuccess: () => setCreateOpen(false),
    });

    const voidMutation = useWriteMutation<{ row: KitchenReturnRow; reason: string }, void>({
        mutationFn: ({ row, reason }) => voidKitchenReturn(row.id, reason),
        successTitle: () => WH_RETURN_TEXT.deleteSuccess,
        invalidate: [['kitchen-returns']],
        silentError: true,
        onError: (cause) => setPageError(writeErrorMessage(cause, WH_RETURN_TEXT.deleteFailed)),
        onSuccess: () => {
            setVoidRow(null);
            setPageError('');
        },
    });

    return (
        <div className="mx-auto flex w-full min-w-0 flex-col gap-lg">
            <PageHeader
                title="مرتجعات المطبخ"
                english="Kitchen Returns"
                description="مرتجعات هذا الشهر من الأقسام إلى المخزن — إنشاء وإبطال مع حفظ أثر العملية."
                actions={
                    <>
                        <div className="flex items-center gap-xs" data-erp-print-hide>
                            {canWrite ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => {
                                        createMutation.reset();
                                        setCreateOpen(true);
                                    }}
                                >
                                    مرتجع جديد
                                </Button>
                            ) : null}
                            <PrintActions title="مرتجعات المطبخ" />
                            <button
                                type="button"
                                onClick={() => {
                                    void returnsQuery.refetch();
                                }}
                                className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                            >
                                تحديث
                            </button>
                        </div>
                    </>
                }
            />

            {pageError ? (
                <p role="alert" className="text-body-sm text-danger-text">
                    {pageError}
                </p>
            ) : null}

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                    label="المرتجعات"
                    english="Returns"
                    value={formatInt(totals.count)}
                    hint={`${formatInt(totals.items)} سطر صنف`}
                />
                <Kpi
                    label="القيمة المرتجعة النشطة"
                    english="Active Value"
                    value={`${formatMoney(totals.total)}${currency ? ` ${currency}` : ''}`}
                    hint="لا تشمل المرتجعات المبطلة"
                />
                <Kpi
                    label="مرتبطة بإذن صرف"
                    english="Linked"
                    value={formatInt(totals.linked)}
                    hint={`${formatInt(totals.count - totals.linked)} إرجاع مباشر`}
                />
                <Kpi label="الأقسام" english="Departments" value={formatInt(totals.depts)} hint="أقسام مُرجِعة" />
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label
                        className="flex min-w-56 flex-1 flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-returns-search"
                    >
                        بحث
                        <input
                            id="erp-returns-search"
                            type="search"
                            value={search}
                            placeholder="القسم أو الصنف أو السبب… (مثال: دجاج)"
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
                            setPage(1);
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                    >
                        مسح المرشّحات
                    </button>
                    <span className="text-body-sm text-muted">{formatInt(sorted.length)} مرتجعًا</span>
                </div>
            </Card>

            <Card>
                {returnsQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل مرتجعات المطبخ" />
                        <TableSkeleton rows={6} columns={9} />
                    </div>
                ) : null}

                {returnsQuery.isError ? (
                    <StateError
                        message={returnsQuery.error instanceof Error ? returnsQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void returnsQuery.refetch();
                        }}
                    />
                ) : null}

                {returnsQuery.isSuccess && rows.length === 0 ? (
                    <StateEmpty
                        title={allRows.length === 0 ? 'لا مرتجعات مسجلة هذا الشهر' : 'لا مرتجع يطابق البحث'}
                        hint={allRows.length === 0 ? 'يُعرض الشهر الحالي فقط.' : 'امسح البحث لعرض كل مرتجعات الشهر.'}
                    />
                ) : null}

                {returnsQuery.isSuccess && rows.length > 0 ? (
                    <>
                        <p className="border-b border-hairline px-sm py-xs text-body-sm text-muted" role="status">
                            {`${formatInt(totals.count)} مرتجعًا · قيمة نشطة ${formatMoney(totals.total)}${currency ? ` ${currency}` : ''}`}
                            {` · الشهر الحالي (أصل 8,000 الأحدث)`}
                            {needle ? ` · نتائج «${needle}»` : ''}
                            {capped ? ` · الخادم أعاد أول ${formatInt(SERVER_PAGE_SIZE * MAX_PAGES)} سجلًا فقط` : ''}
                        </p>
                        <TableScroll label="جدول مرتجعات المطبخ">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh
                                            label="الإرجاع"
                                            sortKey="id"
                                            sort={sort}
                                            onToggle={toggleSort}
                                            align="end"
                                        />
                                        <SortableTh label="القسم" sortKey="dept" sort={sort} onToggle={toggleSort} />
                                        <th scope="col" className="px-sm py-xs text-center font-medium">
                                            طلب الصرف
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الأصناف (كمية)
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            السبب/ملاحظات
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-center font-medium">
                                            الحالة
                                        </th>
                                        <SortableTh
                                            label="التاريخ"
                                            sortKey="date"
                                            sort={sort}
                                            onToggle={toggleSort}
                                            align="center"
                                        />
                                        <SortableTh
                                            label="القيمة"
                                            sortKey="total"
                                            sort={sort}
                                            onToggle={toggleSort}
                                            align="end"
                                        />
                                        <SortableTh
                                            label="أصناف"
                                            sortKey="items"
                                            sort={sort}
                                            onToggle={toggleSort}
                                            align="end"
                                        />
                                        {canVoid ? (
                                            <th
                                                scope="col"
                                                className="px-sm py-xs text-start font-medium"
                                                data-erp-print-hide
                                            >
                                                إجراءات
                                            </th>
                                        ) : null}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row) => (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                #{row.id}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">{row.deptName}</td>
                                            <td
                                                className="erp-numeric px-sm py-xxs text-center text-body-sm text-muted"
                                                dir="ltr"
                                            >
                                                {row.dispatchId ? `#${row.dispatchId}` : '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-ink-secondary">
                                                {row.itemsSummary || '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">
                                                {row.reasonText || '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-center text-body-sm">
                                                <span className={row.voided ? 'text-danger-text' : 'text-success-text'}>
                                                    {row.voided ? 'مبطل' : row.status === 'pending' ? 'قيد المراجعة' : 'معتمد'}
                                                </span>
                                            </td>
                                            <td
                                                className="erp-numeric px-sm py-xxs text-center text-body-sm text-muted"
                                                dir="ltr"
                                            >
                                                {row.date || '—'}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink">
                                                {formatMoney(row.total)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-body-sm text-muted">
                                                {formatInt(row.itemsCount)}
                                                {row.itemsCount ? (
                                                    <span className="text-caption text-faint"> صف</span>
                                                ) : null}
                                            </td>
                                            {canVoid ? (
                                                <td className="px-sm py-xxs" data-erp-print-hide>
                                                    {row.voided ? (
                                                        <span className="text-body-sm text-muted">محفوظ</span>
                                                    ) : (
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="danger"
                                                            title="إبطال المرتجع وعكس أثره مع حفظ السجل"
                                                            disabled={voidMutation.isPending}
                                                            onClick={() => {
                                                                voidMutation.reset();
                                                                setVoidRow(row);
                                                            }}
                                                        >
                                                            إبطال
                                                        </Button>
                                                    )}
                                                </td>
                                            ) : null}
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

            {/* حوار إنشاء مرتجع */}
            <CreateReturnDialog
                open={createOpen}
                pending={createMutation.isPending}
                departments={departmentsQuery.data ?? []}
                dispatches={returnDispatches}
                defaultDeptCode={auth.user?.dept_code ?? ''}
                onClose={() => setCreateOpen(false)}
                onSubmit={(input) => createMutation.mutateAsync(input)}
            />

            {voidRow ? (
                <VoidReturnDialog
                    row={voidRow}
                    pending={voidMutation.isPending}
                    onClose={() => setVoidRow(null)}
                    onSubmit={(reason) => voidMutation.mutate({ row: voidRow, reason })}
                />
            ) : null}
        </div>
    );
}

/* ── حوار إنشاء مرتجع ───────────────────────────────────────────────── */

type CreateReturnInput = {
    items: WhReturnItemInput[];
    deptCode: string;
    deptName: string;
    reason: string;
    notes: string;
    dispatchId?: number;
};

interface CreateReturnDialogProps {
    open: boolean;
    pending: boolean;
    departments: Department[];
    dispatches: Dispatch[];
    defaultDeptCode: string;
    onClose: () => void;
    onSubmit: (input: CreateReturnInput) => Promise<void>;
}

const CREATE_RETURN_FORM_ID = 'erp-return-create-form';

function CreateReturnDialog({
    open,
    pending,
    departments,
    dispatches,
    defaultDeptCode,
    onClose,
    onSubmit,
}: CreateReturnDialogProps) {
    const [lines, setLines] = useState<WhReturnItemInput[]>([]);
    const [name, setName] = useState('');
    const [qty, setQty] = useState('1');
    const [unit, setUnit] = useState('كجم');
    const [packagingQty, setPackagingQty] = useState('');
    const [deptCode, setDeptCode] = useState('');
    const [mode, setMode] = useState<'direct' | 'linked'>('direct');
    const [dispatchId, setDispatchId] = useState('');
    const [reason, setReason] = useState('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setLines([]);
            setName('');
            setQty('1');
            setUnit('كجم');
            setPackagingQty('');
            setDeptCode(defaultDeptCode);
            setMode('direct');
            setDispatchId('');
            setReason('');
            setNotes('');
            setError('');
        }
    }, [open, defaultDeptCode]);

    function addLine() {
        setError('');
        const quantity = Number(qty);
        const packaging = packagingQty.trim() ? Number(packagingQty) : null;
        if (!name.trim()) {
            setError(WH_RETURN_TEXT.nameRequired);
            return;
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
            setError(WH_RETURN_TEXT.qtyRequired);
            return;
        }
        if (packaging !== null && (!Number.isFinite(packaging) || packaging < 0)) {
            setError('عدد الكراتين غير صحيح');
            return;
        }
        if (lines.some((line) => line.name === name.trim())) {
            setError('الصنف موجود بالفعل');
            return;
        }
        setLines((previous) => [
            ...previous,
            {
                name: name.trim(),
                qty: quantity,
                unit: unit.trim() || 'كجم',
                ...(packaging !== null ? { packagingQty: packaging, packagingUom: 'كرتون' } : {}),
            },
        ]);
        setName('');
        setQty('1');
        setPackagingQty('');
    }

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setError('');
        if (!lines.length) {
            setError(WH_RETURN_TEXT.itemsRequired);
            return;
        }
        if (mode === 'direct' && !deptCode.trim()) {
            setError('اختر قسم الإرجاع');
            return;
        }
        if (mode === 'linked' && !dispatchId) {
            setError('اختر إذن الصرف');
            return;
        }
        if (!reason.trim()) {
            setError('سبب الإرجاع مطلوب');
            return;
        }
        const department = departments.find((entry) => entry.code === deptCode);
        try {
            await onSubmit({
                items: lines,
                deptCode,
                deptName: department?.name ?? '',
                reason: reason.trim(),
                notes: notes.trim(),
                ...(mode === 'linked' ? { dispatchId: Number(dispatchId) } : {}),
            });
            onClose();
        } catch (cause) {
            setError(writeErrorMessage(cause, WH_RETURN_TEXT.createFailed));
        }
    }

    const linkedDispatch = dispatches.find((dispatch) => String(dispatch.id) === dispatchId) ?? null;
    const linkedItems = linkedDispatch?.approvedItems?.length ? linkedDispatch.approvedItems : (linkedDispatch?.items ?? []);

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title="مرتجع جديد"
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {WH_RETURN_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={CREATE_RETURN_FORM_ID} size="sm" loading={pending}>
                        حفظ المرتجع
                    </Button>
                </>
            }
        >
            <form id={CREATE_RETURN_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <div className="flex flex-wrap gap-xs" role="group" aria-label="نوع المرتجع">
                    <Button
                        type="button"
                        size="sm"
                        variant={mode === 'direct' ? 'primary' : 'secondary'}
                        aria-pressed={mode === 'direct'}
                        onClick={() => {
                            setMode('direct');
                            setError('');
                        }}
                    >
                        إرجاع مباشر
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant={mode === 'linked' ? 'primary' : 'secondary'}
                        aria-pressed={mode === 'linked'}
                        disabled={!dispatches.length}
                        onClick={() => {
                            setMode('linked');
                            setDispatchId(dispatches[0] ? String(dispatches[0].id) : '');
                            setError('');
                        }}
                    >
                        مرتبط بإذن صرف
                    </Button>
                </div>
                {mode === 'linked' ? (
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                        إذن الصرف
                        <select
                            required
                            value={dispatchId}
                            onChange={(event) => {
                                setDispatchId(event.target.value);
                                setName('');
                                setError('');
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            {dispatches.map((dispatch) => (
                                <option key={dispatch.id} value={dispatch.id}>
                                    #{dispatch.id} — {dispatch.deptName || dispatch.deptCode || 'بدون قسم'} — {dispatch.date || 'بلا تاريخ'}
                                </option>
                            ))}
                        </select>
                    </label>
                ) : (
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                        قسم الإرجاع
                        <select
                            required
                            value={deptCode}
                            onChange={(event) => setDeptCode(event.target.value)}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            <option value="">اختر القسم</option>
                            {departments.map((department) => (
                                <option key={department.code} value={department.code}>
                                    {department.name}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                <Textarea label="سبب الإرجاع" required value={reason} onChange={(event) => setReason(event.target.value)} />
                <Textarea
                    label="ملاحظات"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="ملاحظات إضافية (اختياري)"
                />
                <div className="grid gap-sm sm:grid-cols-[1fr_120px_100px_130px]">
                    <Input
                        label="اسم الصنف"
                        name="name"
                        list={mode === 'linked' ? 'erp-return-dispatch-items' : undefined}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="طماطم"
                    />
                    <Input
                        label="الكمية"
                        name="qty"
                        type="number"
                        min={0.001}
                        step={0.001}
                        value={qty}
                        onChange={(event) => setQty(event.target.value)}
                    />
                    <Input label="الوحدة" name="unit" value={unit} onChange={(event) => setUnit(event.target.value)} />
                    <Input
                        label="كراتين (اختياري)"
                        name="packagingQty"
                        type="number"
                        min={0}
                        step={0.001}
                        value={packagingQty}
                        onChange={(event) => setPackagingQty(event.target.value)}
                    />
                </div>
                {mode === 'linked' ? (
                    <datalist id="erp-return-dispatch-items">
                        {linkedItems.map((item, index) => {
                            const itemName = item.itemName || item.name || '';
                            const quantity = Number(item.approvedQty ?? item.qty ?? 0);
                            return (
                                <option key={`${itemName}-${String(index)}`} value={itemName}>
                                    {`المعتمد ${quantity} ${item.unit || ''}${item.packagingQty ? ` · ${item.packagingQty} كرتون` : ''}`}
                                </option>
                            );
                        })}
                    </datalist>
                ) : null}
                <div>
                    <Button type="button" variant="secondary" size="sm" onClick={addLine}>
                        إضافة الصنف
                    </Button>
                </div>
                {lines.length ? (
                    <ul className="flex flex-col gap-xxs">
                        {lines.map((line) => (
                            <li
                                key={line.name}
                                className="flex items-center justify-between gap-sm rounded-md bg-surface-sunken px-sm py-xxs text-body-sm"
                            >
                                <span className="text-ink">{line.name}</span>
                                <span className="erp-numeric text-muted" dir="ltr">
                                    {line.qty} {line.unit}
                                    {line.packagingQty != null ? ` · ${line.packagingQty} كرتون` : ''}
                                </span>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setLines((previous) => previous.filter((entry) => entry.name !== line.name))
                                    }
                                    className="text-danger-text"
                                >
                                    إزالة
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-body-sm text-muted">لم تُضف أصناف بعد.</p>
                )}
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

const VOID_RETURN_FORM_ID = 'erp-return-void-form';

function VoidReturnDialog({
    row,
    pending,
    onClose,
    onSubmit,
}: {
    row: KitchenReturnRow;
    pending: boolean;
    onClose: () => void;
    onSubmit: (reason: string) => void;
}) {
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');

    function save(event: React.FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        if (!reason.trim()) {
            setError('سبب الإبطال مطلوب');
            return;
        }
        setError('');
        onSubmit(reason);
    }

    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={`إبطال المرتجع #${row.id}`}
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {WH_RETURN_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={VOID_RETURN_FORM_ID} variant="danger" size="sm" loading={pending}>
                        تأكيد الإبطال
                    </Button>
                </>
            }
        >
            <form id={VOID_RETURN_FORM_ID} onSubmit={save} className="flex flex-col gap-sm">
                <p className="text-body-sm text-ink-secondary">
                    سيُعكس أثر المرتجع على المخزون والمحاسبة ويُفتح سقف الإرجاع المرتبط، مع الاحتفاظ بالسجل كمرتجع مبطل.
                </p>
                <Textarea
                    required
                    autoFocus
                    label="سبب الإبطال"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
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
