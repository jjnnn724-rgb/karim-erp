import { toCents } from '@karim/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { fetchCurrency } from '../lib/finance';
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
    deleteKitchenReturn,
    WH_RETURN_TEXT,
    type WhReturnItemInput,
    whReturnWriteVisible,
} from '../lib/wh-returns-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';

/**
 * مرتجعات المطبخ — قراءة فقط من `/api/kitchenReturns` بنفس سؤال القديم
 * (`frontend/app/js/v2/screens/wh-returns.js`): الشهر الحالي فقط، والأحدث
 * أولًا، وسقف 8×1000 معلن. الأعمدة نفسها والأصناف ملخص سطرٍ واحد.
 *
 * الإنشاء (إرجاع مباشر أو مرتبط بإذن صرف) والحذف بعكس الأثر يبقيان في
 * الشاشة القديمة حتى تُنقل دورتهما وتواقيعهما كاملة.
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
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
    const [page, setPage] = useState(1);
    const [createOpen, setCreateOpen] = useState(false);
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
        setSort((previous) => (previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
    }

    const createMutation = useWriteMutation<WhReturnItemInput[], void>({
        mutationFn: (items) => createKitchenReturn({ items, notes: '', reason: '' }).then(() => undefined),
        successTitle: () => WH_RETURN_TEXT.createSuccess,
        invalidate: [['kitchen-returns']],
        silentError: true,
        onSuccess: () => setCreateOpen(false),
    });

    const deleteMutation = useWriteMutation<string, void>({
        mutationFn: (id) => deleteKitchenReturn(id),
        successTitle: () => WH_RETURN_TEXT.deleteSuccess,
        invalidate: [['kitchen-returns']],
        silentError: true,
        onError: (cause) => setPageError(writeErrorMessage(cause, WH_RETURN_TEXT.deleteFailed)),
        onSuccess: () => setPageError(''),
    });

    async function handleDelete(row: KitchenReturnRow) {
        if (deleteMutation.isPending) return;
        const answer = window.confirm(`حذف المرتجع «${row.id}»؟`);
        if (answer) {
            await deleteMutation.mutateAsync(row.id);
        }
    }

    return (
        <div className="mx-auto flex w-full min-w-0 flex-col gap-lg">
            <header className="flex flex-wrap items-end justify-between gap-md border-b border-hairline pb-md">
                <div>
                    <h1 className="text-display-lg text-ink">
                        مرتجعات المطبخ{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Kitchen Returns
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">مرتجعات هذا الشهر من الأقسام إلى المخزن — إنشاء مباشر وحذف.</p>
                </div>

                <div className="flex items-center gap-xs" data-erp-print-hide>
                    {canWrite ? (
                        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
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
            </header>

            {pageError ? (
                <p role="alert" className="text-body-sm text-danger-text">
                    {pageError}
                </p>
            ) : null}

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="المرتجعات" english="Returns" value={formatInt(totals.count)} hint={`${formatInt(totals.items)} سطر صنف`} />
                <Kpi
                    label="القيمة المرتجعة"
                    english="Value"
                    value={`${formatMoney(totals.total)}${currency ? ` ${currency}` : ''}`}
                    hint="مجموع قيمة المرتجعات"
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
                    <label className="flex min-w-56 flex-1 flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-returns-search">
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
                        <TableSkeleton rows={6} columns={8} />
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
                            {`${formatInt(totals.count)} مرتجعًا · إجمالي ${formatMoney(totals.total)}${currency ? ` ${currency}` : ''}`}
                            {` · الشهر الحالي (أصل 8,000 الأحدث)`}
                            {needle ? ` · نتائج «${needle}»` : ''}
                            {capped ? ` · الخادم أعاد أول ${formatInt(SERVER_PAGE_SIZE * MAX_PAGES)} سجلًا فقط` : ''}
                        </p>
                        <TableScroll label="جدول مرتجعات المطبخ">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh label="الإرجاع" sortKey="id" sort={sort} onToggle={toggleSort} align="end" />
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
                                        <SortableTh label="التاريخ" sortKey="date" sort={sort} onToggle={toggleSort} align="center" />
                                        <SortableTh label="القيمة" sortKey="total" sort={sort} onToggle={toggleSort} align="end" />
                                        <SortableTh label="أصناف" sortKey="items" sort={sort} onToggle={toggleSort} align="end" />
                                        {canWrite ? (
                                            <th scope="col" className="px-sm py-xs text-start font-medium" data-erp-print-hide>
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
                                            <td className="erp-numeric px-sm py-xxs text-center text-body-sm text-muted" dir="ltr">
                                                {row.dispatchId ? `#${row.dispatchId}` : '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-ink-secondary">{row.itemsSummary || '—'}</td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{row.reasonText || '—'}</td>
                                            <td className="erp-numeric px-sm py-xxs text-center text-body-sm text-muted" dir="ltr">
                                                {row.date || '—'}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink">{formatMoney(row.total)}</td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-body-sm text-muted">
                                                {formatInt(row.itemsCount)}
                                                {row.itemsCount ? <span className="text-caption text-faint"> صف</span> : null}
                                            </td>
                                            {canWrite ? (
                                                <td className="px-sm py-xxs" data-erp-print-hide>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="danger"
                                                        title="حذف المرتجع (يعيد فتح سقف الإرجاع)"
                                                        disabled={deleteMutation.isPending}
                                                        onClick={() => void handleDelete(row)}
                                                    >
                                                        حذف
                                                    </Button>
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
                onClose={() => setCreateOpen(false)}
                onSubmit={async (items) => {
                    await createMutation.mutateAsync(items);
                }}
            />
        </div>
    );
}

/* ── حوار إنشاء مرتجع ───────────────────────────────────────────────── */

interface CreateReturnDialogProps {
    open: boolean;
    pending: boolean;
    onClose: () => void;
    onSubmit: (items: WhReturnItemInput[]) => Promise<void>;
}

const CREATE_RETURN_FORM_ID = 'erp-return-create-form';

function CreateReturnDialog({ open, pending, onClose, onSubmit }: CreateReturnDialogProps) {
    const [lines, setLines] = useState<WhReturnItemInput[]>([]);
    const [name, setName] = useState('');
    const [qty, setQty] = useState('1');
    const [unit, setUnit] = useState('كجم');
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setLines([]);
            setName('');
            setQty('1');
            setUnit('كجم');
            setError('');
        }
    }, [open]);

    function addLine() {
        setError('');
        const q = Number(qty);
        if (!name.trim()) {
            setError(WH_RETURN_TEXT.nameRequired);
            return;
        }
        if (!Number.isFinite(q) || q <= 0) {
            setError(WH_RETURN_TEXT.qtyRequired);
            return;
        }
        if (lines.some((line) => line.name === name.trim())) {
            setError('الصنف موجود بالفعل');
            return;
        }
        setLines((previous) => [...previous, { name: name.trim(), qty: q, unit: unit.trim() || 'كجم' }]);
        setName('');
        setQty('1');
    }

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setError('');
        if (!lines.length) {
            setError(WH_RETURN_TEXT.itemsRequired);
            return;
        }
        try {
            await onSubmit(lines);
            onClose();
        } catch (cause) {
            setError(writeErrorMessage(cause, WH_RETURN_TEXT.createFailed));
        }
    }

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
                <div className="grid gap-sm sm:grid-cols-[1fr_120px_100px]">
                    <Input label="اسم الصنف" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="طماطم" />
                    <Input
                        label="الكمية"
                        name="qty"
                        type="number"
                        min={0.001}
                        step={0.001}
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                    />
                    <Input label="الوحدة" name="unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
                </div>
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
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setLines((previous) => previous.filter((entry) => entry.name !== line.name))}
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
