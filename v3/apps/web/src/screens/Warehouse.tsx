import './Warehouse.premium.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { BulkReceiptDialog } from '../components/BulkReceiptDialog';
import { useConfirm } from '../components/ConfirmProvider';
import { InventoryAuditStudio } from '../components/InventoryAuditStudio';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { canReadAudit } from '../lib/inventory-audits';
import {
    categoryCounts,
    fetchInventoryRegister,
    fetchShelves,
    formatInt,
    formatQty,
    type InventoryRow,
    inventoryToRow,
    STOCK_FILTERS,
    STOCK_LABELS,
    type StockFilter,
    shelfIssues,
    shelfMap,
    shortageRows,
    stateCounts,
} from '../lib/inventory-register';
import {
    type DirectEditPayload,
    type DuplicateGroup,
    deleteConfirm,
    deleteInventoryItem,
    directEditConfirm,
    directEditError,
    directEditInventoryItem,
    directEditPayload,
    directEditSuccess,
    duplicateGroups,
    forceDeleteConfirm,
    forceDeleteInventoryItem,
    hasMovementsError,
    INVENTORY_TEXT,
    invDirectVisible,
    invForceVisible,
    invMergeVisible,
    invWriteVisible,
    isForeignKeyError,
    type MergeResult,
    mergeConfirm,
    mergeInventoryItems,
    mergeScopeNote,
    mergeSuccess,
    type ReceiptPayload,
    receiptError,
    receiptPayload,
    receiptSuccess,
    receiveInventoryItem,
} from '../lib/inventory-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';

/**
 * المخزون — القراءة من `/api/warehouse/inventory/search`، والكتابة كما في V2:
 * أربعة أبواب ظاهرة حسب الدور (وارد سريع، تعديل مباشر، حذف، حذف نهائي داخل
 * الحذف، ودمج المكرر)، بنفس الأدوار والمسارات والنصوص.
 *
 * قوائم الأدوار حرفيًّا من الخادم (`inventory-write.ts`):
 *  • وارد/حذف عادي: admin|manager|warehouse
 *  • تعديل مباشر ودمج: admin فقط
 *  • حذف نهائي: admin|warehouse (يظهر كخطوة ثانية بعد رفض الحارس فقط)
 *
 * بعد كل كتابة يُبطَل استعلام السجل (`['inventory']`) فيُعاد جلبه في مكانه —
 * لا إعادة تحميل كاملة. أخطاء النماذج تظهر داخلها (نمط `fail(form)` في V2)
 * ولا تضيع توستًا، وأخطاء الحذف تظهر في شريط أعلى الشاشة كما كان `notify`.
 *
 * البحث والفئة والحالة تمر إلى الخادم؛ الشاشة لا تفلتر الصفوف محليًّا، لأن
 * الخادم يطابق بعائلات الحروف ويحسب الحالات في SQL على السجل كله.
 */

const PAGE_SIZE = 20;

const TONE_CLASS: Record<string, string> = {
    warning: 'text-ink-secondary',
    success: 'text-success-text',
    danger: 'text-danger-text',
    neutral: 'text-muted',
};

function Kpi({ label, english, value, hint }: { label: string; english: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg border border-hairline bg-surface p-md shadow-card">
            <p className="text-label-md text-muted">
                {label}{' '}
                <span className="text-caption text-faint" dir="ltr" lang="en">
                    {english}
                </span>
            </p>
            <p className="erp-numeric mt-xs text-heading-lg text-ink">{value}</p>
            <p className="mt-xxs text-caption text-muted">{hint}</p>
        </div>
    );
}

/* ── نموذج الوارد السريع (وارد) ─────────────────────────────────────────── */

interface ReceiptDialogProps {
    open: boolean;
    row: InventoryRow | null;
    pending: boolean;
    onClose: () => void;
    onSubmit: (payload: ReceiptPayload) => Promise<void>;
}

const RECEIPT_FORM_ID = 'erp-inventory-receipt-form';

/** نص الوارد كما في V2: الكمية الحالية، ثم الكمية المضافة والسعر والصلاحية. */
function ReceiptDialog({ open, row, pending, onClose, onSubmit }: ReceiptDialogProps) {
    const [qty, setQty] = useState('1');
    const [price, setPrice] = useState('');
    const [expiry, setExpiry] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setQty('1');
            setPrice('');
            setExpiry('');
            setError('');
        }
    }, [open]);

    async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (!row || pending) {
            return;
        }
        const message = receiptError(row.name, qty, price, expiry);
        if (message) {
            setError(message);
            const field = Number(qty) <= 0 ? 'qty' : !String(price).trim() ? 'price' : 'expiry';
            document.querySelector<HTMLInputElement>(`#${RECEIPT_FORM_ID} [name="${field}"]`)?.focus();
            return;
        }
        setError('');
        try {
            await onSubmit(receiptPayload(row, qty, price, expiry));
        } catch (cause) {
            setError(writeErrorMessage(cause, INVENTORY_TEXT.receiptFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title="وارد سريع"
            size="md"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {INVENTORY_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={RECEIPT_FORM_ID} size="sm" loading={pending}>
                        إضافة للمخزون
                    </Button>
                </>
            }
        >
            {row ? (
                <form id={RECEIPT_FORM_ID} onSubmit={(event) => void submit(event)} className="flex flex-col gap-sm">
                    <p className="text-body-sm text-muted">
                        <strong className="text-ink">{row.name}</strong> — الكمية الحالية:{' '}
                        <span className="erp-numeric" dir="ltr">
                            {formatQty(row.qty)}
                        </span>{' '}
                        {row.unit}
                    </p>
                    <Input
                        label="الكمية المضافة"
                        name="qty"
                        type="number"
                        min={0.01}
                        step={0.01}
                        value={qty}
                        autoFocus
                        onChange={(event) => {
                            setQty(event.target.value);
                        }}
                    />
                    <Input
                        label="سعر الشراء"
                        name="price"
                        type="number"
                        min={0}
                        step={0.01}
                        value={price}
                        placeholder="مطلوب"
                        onChange={(event) => {
                            setPrice(event.target.value);
                        }}
                    />
                    <Input
                        label="تاريخ الصلاحية"
                        name="expiry"
                        type="date"
                        value={expiry}
                        hint="اختياري — YYYY-MM-DD"
                        onChange={(event) => {
                            setExpiry(event.target.value);
                        }}
                    />
                    {error ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {error}
                        </p>
                    ) : null}
                </form>
            ) : null}
        </Dialog>
    );
}

/* ── نموذج التعديل المباشر (أدمن فقط) ──────────────────────────────────── */

interface DirectDialogProps {
    open: boolean;
    row: InventoryRow | null;
    pending: boolean;
    onClose: () => void;
    onSubmit: (payload: DirectEditPayload) => Promise<void>;
}

const DIRECT_FORM_ID = 'erp-inventory-direct-form';

/** نص V2: الفرق يُقيَّد حركة تسوية في الدفتر باسم المنفّذ — لا تعديل صامت. */
function DirectDialog({ open, row, pending, onClose, onSubmit }: DirectDialogProps) {
    const confirm = useConfirm();
    const [qty, setQty] = useState('');
    const [cost, setCost] = useState('');
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setQty('');
            setCost('');
            setReason('');
            setError('');
        }
    }, [open]);

    async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (!row || pending) {
            return;
        }
        const message = directEditError(qty, cost, reason);
        if (message) {
            setError(message);
            const field =
                Number.parseFloat(qty) < 0 || !Number.isFinite(Number.parseFloat(qty))
                    ? 'qty'
                    : Number.parseFloat(cost) < 0 || !Number.isFinite(Number.parseFloat(cost))
                      ? 'cost'
                      : 'reason';
            document.querySelector<HTMLInputElement>(`#${DIRECT_FORM_ID} [name="${field}"]`)?.focus();
            return;
        }
        setError('');
        const confirmed = await confirm(directEditConfirm(row.name, row.qty, qty, cost));
        if (!confirmed) {
            return;
        }
        try {
            await onSubmit(directEditPayload(qty, cost, reason));
        } catch (cause) {
            setError(writeErrorMessage(cause, INVENTORY_TEXT.directFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title="تعديل مباشر (أدمن)"
            size="md"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {INVENTORY_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={DIRECT_FORM_ID} size="sm" loading={pending}>
                        تطبيق التعديل
                    </Button>
                </>
            }
        >
            {row ? (
                <form id={DIRECT_FORM_ID} onSubmit={(event) => void submit(event)} className="flex flex-col gap-sm">
                    <p className="rounded-md border border-warning/40 bg-warning-soft p-sm text-body-sm text-ink-secondary">
                        «{row.name}» — الكمية الحالية:{' '}
                        <span className="erp-numeric" dir="ltr">
                            {formatQty(row.qty)}
                        </span>{' '}
                        {row.unit}. الفرق يُقيَّد حركة تسوية في دفتر المخزون باسمك — لا يُسجَّل بلا سبب.
                    </p>
                    <Input
                        label="الكمية الجديدة"
                        name="qty"
                        type="number"
                        min={0}
                        step={0.01}
                        value={qty}
                        autoFocus
                        onChange={(event) => {
                            setQty(event.target.value);
                        }}
                    />
                    <Input
                        label="التكلفة الجديدة"
                        name="cost"
                        type="number"
                        min={0}
                        step={0.01}
                        value={cost}
                        onChange={(event) => {
                            setCost(event.target.value);
                        }}
                    />
                    <Input
                        label="سبب التعديل"
                        name="reason"
                        type="text"
                        value={reason}
                        placeholder="يُوثَّق في الدفتر"
                        maxLength={200}
                        onChange={(event) => {
                            setReason(event.target.value);
                        }}
                    />
                    {error ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {error}
                        </p>
                    ) : null}
                </form>
            ) : null}
        </Dialog>
    );
}

/* ── لوحة دمج المكرر (أدمن فقط) ─────────────────────────────────────────── */

interface MergeDialogProps {
    open: boolean;
    rows: readonly InventoryRow[];
    registerTotal: number;
    truncated: boolean;
    pending: boolean;
    onClose: () => void;
    onSubmit: (keepId: number, dupIds: number[]) => Promise<void>;
}

/** نفس لوحة V2: اختر النسخة التي تبقى ثم دمِج — لا تراجع بعد الدمج. */
function MergeDialog({ open, rows, registerTotal, truncated, pending, onClose, onSubmit }: MergeDialogProps) {
    const confirm = useConfirm();
    const groups = useMemo(() => duplicateGroups(rows), [rows]);
    const [keep, setKeep] = useState<Record<string, string>>({});
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open) {
            return;
        }
        const next: Record<string, string> = {};
        for (const group of duplicateGroups(rows)) {
            const item = group.items[group.keepIdx];
            if (item) {
                next[group.key] = String(item.id);
            }
        }
        setKeep(next);
        setError('');
    }, [open, rows]);

    function keepIdOf(group: DuplicateGroup): string {
        const fallback = group.items[group.keepIdx];
        return keep[group.key] ?? (fallback ? String(fallback.id) : '');
    }

    async function submit(group: DuplicateGroup): Promise<void> {
        if (pending) {
            return;
        }
        setError('');
        const keepId = Number(keepIdOf(group));
        if (!Number.isFinite(keepId) || keepId <= 0) {
            setError(INVENTORY_TEXT.mergePickKeep);
            return;
        }
        const duplicates = group.items.filter((item) => Number(item.id) !== keepId);
        if (!duplicates.length) {
            setError(INVENTORY_TEXT.mergePickKeep);
            return;
        }
        const names = duplicates.map((item) => item.name).join('، ');
        const confirmed = await confirm(mergeConfirm(duplicates.length, names));
        if (!confirmed) {
            return;
        }
        try {
            await onSubmit(
                keepId,
                duplicates.map((item) => Number(item.id)),
            );
        } catch (cause) {
            setError(writeErrorMessage(cause, INVENTORY_TEXT.mergeFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title="دمج أصناف مكررة"
            size="lg"
            footer={
                <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                    {INVENTORY_TEXT.cancel}
                </Button>
            }
        >
            <div className="flex flex-col gap-sm">
                {groups.length === 0 ? (
                    <div role="status" className="flex flex-col gap-xxs rounded-md border border-hairline bg-surface-sunken p-sm">
                        <p className="text-body-md text-ink">{INVENTORY_TEXT.mergeNoDuplicates}</p>
                        <p className="text-body-sm text-muted">{mergeScopeNote(rows.length, registerTotal, truncated)}</p>
                    </div>
                ) : (
                    <>
                        <p className="rounded-md border border-warning/40 bg-warning-soft p-sm text-body-sm text-ink-secondary">
                            {INVENTORY_TEXT.mergeIntro}
                        </p>
                        {groups.map((group, index) => (
                            <div key={group.key} className="flex flex-col gap-xs rounded-md border border-hairline p-sm">
                                <p className="text-body-sm text-ink">
                                    «{group.items[0]?.name ?? ''}» — {formatInt(group.items.length)} نسخ
                                </p>
                                {group.items.map((item) => (
                                    <label key={String(item.id)} className="flex items-start gap-xs text-body-sm">
                                        <input
                                            type="radio"
                                            name={`erp-inventory-merge-keep-${String(index)}`}
                                            value={String(item.id)}
                                            checked={keepIdOf(group) === String(item.id)}
                                            onChange={() => {
                                                setKeep((previous) => ({ ...previous, [group.key]: String(item.id) }));
                                            }}
                                        />
                                        <span className="text-ink-secondary">
                                            {item.name} — رصيد {formatQty(item.qty)} {item.unit ?? ''}
                                            {Number(item.minQty) > 0 ? ` · حد أدنى ${formatQty(Number(item.minQty))}` : ''}{' '}
                                            <span className="erp-numeric text-faint" dir="ltr">
                                                (id: {String(item.id)})
                                            </span>
                                        </span>
                                    </label>
                                ))}
                                <div>
                                    <Button type="button" variant="danger" size="sm" loading={pending} onClick={() => void submit(group)}>
                                        {INVENTORY_TEXT.mergeAction}
                                    </Button>
                                </div>
                            </div>
                        ))}
                        <p className="text-body-sm text-muted">{mergeScopeNote(rows.length, registerTotal, truncated)}</p>
                    </>
                )}
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}
            </div>
        </Dialog>
    );
}

/* ── الشاشة ─────────────────────────────────────────────────────────────── */

type DeleteOutcome = 'deleted' | 'force' | 'cancelled';

export function Warehouse() {
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('all');
    const [stock, setStock] = useState<StockFilter>('all');
    const [page, setPage] = useState(1);
    const [pageError, setPageError] = useState('');
    const [receiptRow, setReceiptRow] = useState<InventoryRow | null>(null);
    const [directRow, setDirectRow] = useState<InventoryRow | null>(null);
    const [mergeOpen, setMergeOpen] = useState(false);
    const [auditsOpen, setAuditsOpen] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);

    const auth = useAuthState();
    const role = auth.user?.role;
    const canAudit = canReadAudit(role);
    const canWrite = invWriteVisible(role);
    const canDirect = invDirectVisible(role);
    const canMerge = invMergeVisible(role);
    const canForce = invForceVisible(role);
    const confirm = useConfirm();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // البحث نداء خادم — الانتظار 300ms يجمع ضربات المفتاح بدل طلب لكل حرف.
    useEffect(() => {
        const timer = setTimeout(() => {
            setSearch(searchInput.trim());
        }, 300);
        return () => {
            clearTimeout(timer);
        };
    }, [searchInput]);

    const inventoryQuery = useQuery({
        queryKey: ['inventory', search, category, stock],
        queryFn: ({ signal }) => fetchInventoryRegister({ q: search, category, stock }, signal),
    });

    const shelvesQuery = useQuery({
        queryKey: ['shelves'],
        queryFn: ({ signal }) => fetchShelves(signal),
        staleTime: 10 * 60 * 1000,
    });

    const shelfById = useMemo(() => shelfMap(shelvesQuery.data ?? []), [shelvesQuery.data]);
    const rows = useMemo(
        () => (inventoryQuery.data?.rows ?? []).map((item) => inventoryToRow(item, shelfById)),
        [inventoryQuery.data, shelfById],
    );

    const counts = useMemo(() => stateCounts(rows), [rows]);
    const shortages = useMemo(() => shortageRows(rows), [rows]);
    const categories = useMemo(() => categoryCounts(rows).slice(0, 6), [rows]);
    const shelves = useMemo(() => shelfIssues(rows), [rows]);
    const categoriesQuery = inventoryQuery.data?.categories ?? [];
    const total = inventoryQuery.data?.total ?? rows.length;
    const fuzzy = inventoryQuery.data?.fuzzy ?? false;
    const truncated = inventoryQuery.data?.truncated ?? false;

    /* ── الكتابات: مكوّن واحد لكل باب، والإبطال يعني إعادة جلب السجل في مكانه ── */

    const receiptMutation = useWriteMutation<{ row: InventoryRow; payload: ReceiptPayload }, void>({
        mutationFn: ({ row, payload }) => receiveInventoryItem(row.id, payload),
        successTitle: ({ row, payload }) => receiptSuccess(payload.qty, row.unit, row.name),
        invalidate: [['inventory']],
        silentError: true,
        onSuccess: () => {
            setReceiptRow(null);
        },
    });

    const directMutation = useWriteMutation<{ row: InventoryRow; payload: DirectEditPayload }, { delta: number }>({
        mutationFn: ({ row, payload }) => directEditInventoryItem(row.id, payload),
        invalidate: [['inventory']],
        silentError: true,
        onSuccess: (data, vars) => {
            setDirectRow(null);
            toast({ title: directEditSuccess(data.delta, vars.row.unit), variant: 'success' });
        },
    });

    const deleteMutation = useWriteMutation<InventoryRow, DeleteOutcome>({
        mutationFn: async (row) => {
            try {
                await deleteInventoryItem(row.id);
                return 'deleted';
            } catch (cause) {
                if (!hasMovementsError(cause)) {
                    const message = writeErrorMessage(cause, '');
                    if (isForeignKeyError(message)) {
                        throw new Error(INVENTORY_TEXT.deleteBlocked);
                    }
                    throw cause;
                }
                // حارس الأرصدة: لا force لمن ليس من قائمته (V2: لا زر ولا محاولة).
                if (!canForce) {
                    throw new Error(writeErrorMessage(cause, INVENTORY_TEXT.deleteBlocked));
                }
                const forceConfirmed = await confirm(forceDeleteConfirm(row.name));
                if (!forceConfirmed) {
                    return 'cancelled';
                }
                await forceDeleteInventoryItem(row.id);
                return 'force';
            }
        },
        invalidate: [['inventory']],
        silentError: true,
        onSuccess: (outcome) => {
            if (outcome === 'deleted') {
                toast({ title: INVENTORY_TEXT.deleteSuccess, variant: 'success' });
            } else if (outcome === 'force') {
                toast({ title: INVENTORY_TEXT.forceDeleteSuccess, variant: 'success' });
            }
        },
        onError: (cause) => {
            setPageError(writeErrorMessage(cause, INVENTORY_TEXT.deleteFailed));
        },
    });

    const mergeMutation = useWriteMutation<{ keepId: number; dupIds: number[] }, MergeResult>({
        mutationFn: ({ keepId, dupIds }) => mergeInventoryItems(keepId, dupIds),
        invalidate: [['inventory']],
        silentError: true,
        onSuccess: (data) => {
            toast({ title: mergeSuccess(data.mergedCount, data.movedQty), variant: 'success' });
        },
    });

    const maxCategory = categories[0]?.count ?? 0;
    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    const filtered = stock !== 'all' || category !== 'all' || search !== '';
    const scope = filtered ? 'مرشّحات الخادم' : 'السجل كله';
    const categoryOptions = ['all', ...categoriesQuery];
    if (category !== 'all' && !categoryOptions.includes(category)) {
        categoryOptions.push(category);
    }

    const statesLine = `تحت الحد ${formatInt(counts.low)} · نفد ${formatInt(counts.out)} · متوفر ${formatInt(counts.ok)}`;

    function resetFilters() {
        setSearchInput('');
        setSearch('');
        setCategory('all');
        setStock('all');
        setPage(1);
    }

    async function handleDelete(row: InventoryRow): Promise<void> {
        if (deleteMutation.isPending) {
            return;
        }
        setPageError('');
        const confirmed = await confirm(deleteConfirm(row.name));
        if (!confirmed) {
            return;
        }
        deleteMutation.mutate(row);
    }

    return (
        <div className="flex flex-col gap-md erp-premium-Warehouse">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        المخزون{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Inventory
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">سجل الأصناف وأرصدتها — وارد سريع وتعديل مباشر وحذف ودمج للمكرر وصلاحياتها.</p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    {canWrite ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                setBulkOpen(true);
                            }}
                        >
                            استلام مجمّع
                        </Button>
                    ) : null}
                    {canAudit ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                setAuditsOpen(true);
                            }}
                        >
                            الجرد الفعلي
                        </Button>
                    ) : null}
                    {canMerge ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                setPageError('');
                                setMergeOpen(true);
                            }}
                        >
                            دمج أصناف مكررة
                        </Button>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => {
                            void inventoryQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                    <PrintActions title="المخزون" />
                </div>
            </header>

            {pageError ? (
                <p role="alert" className="text-body-sm text-danger-text">
                    {pageError}
                </p>
            ) : null}

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                    label="الأصناف المعروضة"
                    english="Items"
                    value={formatInt(rows.length)}
                    hint={
                        truncated ? `أول ${formatInt(rows.length)} من ${formatInt(total)} — سقف الجلب` : `من ${formatInt(total)} في السجل`
                    }
                />
                <Kpi label="تحت الحد" english="Below minimum" value={formatInt(counts.low)} hint="الرصيد عند حد إعادة الطلب أو تحته" />
                <Kpi label="نفد" english="Out of stock" value={formatInt(counts.out)} hint="رصيد صفر أو أقل" />
                <Kpi label="متوفر" english="In stock" value={formatInt(counts.ok)} hint="الرصيد أعلى من الحد المسجّل" />
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label
                        className="flex min-w-56 flex-1 flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-inventory-search"
                    >
                        بحث
                        <input
                            id="erp-inventory-search"
                            type="search"
                            value={searchInput}
                            placeholder="اسم الصنف أو الباركود… (بازنجان تجد باذنجان)"
                            onChange={(event) => {
                                setSearchInput(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-inventory-category">
                        الفئة
                        <select
                            id="erp-inventory-category"
                            value={category}
                            onChange={(event) => {
                                setCategory(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            <option value="all">كل الفئات</option>
                            {categoryOptions
                                .filter((name) => name !== 'all')
                                .map((name) => (
                                    <option key={name} value={name}>
                                        {name || 'بلا فئة'}
                                    </option>
                                ))}
                        </select>
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-inventory-stock">
                        حالة المخزون
                        <select
                            id="erp-inventory-stock"
                            value={stock}
                            onChange={(event) => {
                                const value = event.target.value as StockFilter;
                                setStock(STOCK_FILTERS.includes(value) ? value : 'all');
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            {STOCK_FILTERS.map((key) => (
                                <option key={key} value={key}>
                                    {STOCK_LABELS[key]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button
                        type="button"
                        onClick={resetFilters}
                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                    >
                        مسح المرشّحات
                    </button>
                    <span className="text-body-sm text-muted">{formatInt(rows.length)} صنفًا</span>
                </div>
            </Card>

            {!inventoryQuery.isPending && !inventoryQuery.isError ? (
                <p className="text-body-sm text-muted" role="status">
                    {`${formatInt(rows.length)} صنفًا · ${statesLine} · بلا حد أدنى ${formatInt(counts.untracked)}`}
                    {` · بلا رف ${formatInt(shelves.noShelf)}`}
                    {shelves.unresolved ? ` · رفوف برقمها ${formatInt(shelves.unresolved)}` : ''}
                    {fuzzy ? ' · بحث متسامح بعائلات الحروف' : ''}
                    {truncated ? ` · أول ${formatInt(rows.length)} من ${formatInt(total)} بالسجل — سقف الجلب` : ''}
                    {` · ${scope}`}
                </p>
            ) : null}

            {!inventoryQuery.isPending && !inventoryQuery.isError && rows.length > 0 ? (
                <>
                    <Card>
                        <div className="border-b border-hairline px-sm py-xs">
                            <h2 className="text-heading-sm text-ink">تحت الحد — أكبر فجوة أولًا</h2>
                            <p className="text-caption text-muted">ستة أصناف فقط؛ الفجوة = الحد الأدنى − الرصيد.</p>
                        </div>
                        {shortages.length > 0 ? (
                            <TableScroll label="جدول الأصناف تحت الحد">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الصنف
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الفئة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-center font-medium">
                                                الرصيد
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-center font-medium">
                                                الحد الأدنى
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-center font-medium">
                                                الفجوة
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {shortages.map((row) => (
                                            <tr key={`short-${row.id}`} className="border-b border-hairline">
                                                <td className="px-sm py-xxs text-ink">{row.name}</td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">{row.category || '—'}</td>
                                                <td className="erp-numeric px-sm py-xxs text-center text-ink" dir="ltr">
                                                    {formatQty(row.qty)}
                                                    {row.unit ? <span className="text-caption text-muted"> {row.unit}</span> : null}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-center text-muted" dir="ltr">
                                                    {row.minQty === null ? '—' : formatQty(row.minQty)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-center text-danger-text" dir="ltr">
                                                    {formatQty(row.short)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        ) : (
                            <p className="px-sm py-md text-body-sm text-muted">لا صنف تحت حده الأدنى في هذه النتيجة.</p>
                        )}
                    </Card>

                    {categories.length > 0 ? (
                        <Card className="p-sm">
                            <h2 className="text-heading-sm text-ink">الأصناف حسب الفئة</h2>
                            <p className="mb-sm text-caption text-muted">أعلى ست فئات في النتيجة، بالمفتاح المخزَّن.</p>
                            <ul className="flex flex-col gap-xs">
                                {categories.map((entry) => (
                                    <li key={entry.value || '(none)'} className="flex items-center gap-sm">
                                        <span className="w-40 shrink-0 truncate text-body-sm text-ink">{entry.value || 'بلا فئة'}</span>
                                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
                                            <span
                                                className="block h-full rounded-full bg-primary"
                                                style={{
                                                    width: `${String(maxCategory ? (entry.count / maxCategory) * 100 : 0)}%`,
                                                }}
                                            />
                                        </span>
                                        <span className="erp-numeric w-12 text-end text-body-sm text-muted" dir="ltr">
                                            {formatInt(entry.count)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    ) : null}
                </>
            ) : null}

            <Card>
                {inventoryQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل سجل المخزون" />
                        <TableSkeleton rows={6} columns={8} />
                    </div>
                ) : null}

                {inventoryQuery.isError ? (
                    <StateError
                        message={inventoryQuery.error instanceof Error ? inventoryQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void inventoryQuery.refetch();
                        }}
                    />
                ) : null}

                {!inventoryQuery.isPending && !inventoryQuery.isError && rows.length === 0 ? (
                    <StateEmpty title="لا أصناف" hint="لا صنف يطابق البحث أو الفئة أو حالة المخزون — امسح المرشّحات أو غيّر كلمة البحث." />
                ) : null}

                {!inventoryQuery.isPending && !inventoryQuery.isError && rows.length > 0 ? (
                    <>
                        <TableScroll label="جدول المخزون">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الصنف
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الفئة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-center font-medium">
                                            الرصيد
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-center font-medium">
                                            المخزن الرئيسي
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-center font-medium">
                                            مخازن الأقسام
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-center font-medium">
                                            الحد الأدنى
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الرف
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الحالة
                                        </th>
                                        {canWrite || canDirect ? (
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                إجراءات
                                            </th>
                                        ) : null}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row: InventoryRow) => (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="px-sm py-xxs text-ink">
                                                <span className={row.nameResolved ? '' : 'text-muted'}>{row.name}</span>
                                                {row.barcode ? (
                                                    <span className="block erp-numeric text-caption text-faint" dir="ltr">
                                                        {row.barcode}
                                                    </span>
                                                ) : null}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{row.category || '—'}</td>
                                            <td className="erp-numeric px-sm py-xxs text-center text-ink" dir="ltr">
                                                {formatQty(row.qty)}
                                                {row.unit ? <span className="text-caption text-muted"> {row.unit}</span> : null}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-center text-ink" dir="ltr">
                                                {formatQty(row.mainQty)}
                                            </td>
                                            <td
                                                className="erp-numeric px-sm py-xxs text-center text-muted"
                                                dir="ltr"
                                                title={
                                                    row.mainOverTotal
                                                        ? 'رصيد المخزن الرئيسي أعلى من إجمالي السجل — الفرق مقصوص عند صفر'
                                                        : undefined
                                                }
                                            >
                                                {formatQty(row.deptQty)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-center text-muted" dir="ltr">
                                                {row.minQty === null ? '—' : formatQty(row.minQty)}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm">
                                                {!row.shelfId ? (
                                                    <span className="text-muted">بلا رف مسجّل</span>
                                                ) : row.shelfResolved ? (
                                                    <span className="text-ink-secondary">{row.shelf || row.shelfName || '—'}</span>
                                                ) : (
                                                    <span className="text-muted" title="رقم الرف كما هو في السجل — لم يُحلّ إلى اسم">
                                                        #{row.shelfId}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm">
                                                <span className={TONE_CLASS[row.state.tone]}>{row.state.label}</span>
                                                {row.untracked ? <span className="block text-caption text-faint">بلا حد أدنى</span> : null}
                                            </td>
                                            {canWrite || canDirect ? (
                                                <td className="px-sm py-xxs" data-erp-print-hide>
                                                    <div className="flex flex-wrap items-center gap-xs">
                                                        {canWrite ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                title="وارد سريع لهذا الصنف"
                                                                onClick={() => {
                                                                    setPageError('');
                                                                    setReceiptRow(row);
                                                                }}
                                                            >
                                                                وارد
                                                            </Button>
                                                        ) : null}
                                                        {canDirect ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="ghost"
                                                                title="تعديل مباشر للكمية والتكلفة (أدمن) — يُقيَّد الفرق في الدفتر"
                                                                onClick={() => {
                                                                    setPageError('');
                                                                    setDirectRow(row);
                                                                }}
                                                            >
                                                                تعديل
                                                            </Button>
                                                        ) : null}
                                                        {canWrite ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="danger"
                                                                title="حذف الصنف"
                                                                disabled={deleteMutation.isPending}
                                                                onClick={() => {
                                                                    void handleDelete(row);
                                                                }}
                                                            >
                                                                حذف
                                                            </Button>
                                                        ) : null}
                                                    </div>
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
                                {truncated ? ` · أول ${formatInt(rows.length)} من ${formatInt(total)} في السجل` : ''}
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

            <ReceiptDialog
                open={receiptRow !== null}
                row={receiptRow}
                pending={receiptMutation.isPending}
                onClose={() => {
                    setReceiptRow(null);
                }}
                onSubmit={async (payload) => {
                    if (!receiptRow) {
                        return;
                    }
                    await receiptMutation.mutateAsync({ row: receiptRow, payload });
                }}
            />

            <DirectDialog
                open={directRow !== null}
                row={directRow}
                pending={directMutation.isPending}
                onClose={() => {
                    setDirectRow(null);
                }}
                onSubmit={async (payload) => {
                    if (!directRow) {
                        return;
                    }
                    await directMutation.mutateAsync({ row: directRow, payload });
                }}
            />

            <MergeDialog
                open={mergeOpen}
                rows={rows}
                registerTotal={total}
                truncated={truncated}
                pending={mergeMutation.isPending}
                onClose={() => {
                    setMergeOpen(false);
                }}
                onSubmit={async (keepId, dupIds) => {
                    await mergeMutation.mutateAsync({ keepId, dupIds });
                }}
            />

            {canWrite ? (
                <BulkReceiptDialog
                    open={bulkOpen}
                    onOpenChange={(next) => {
                        setBulkOpen(next);
                    }}
                    onImported={(outcome) => {
                        void queryClient.invalidateQueries({ queryKey: ['inventory'] });
                        toast({
                            title: outcome.failures.length ? 'اكتمل الاستيراد جزئيًا' : 'تم الاستلام المجمّع',
                            description: `${outcome.imported} صنف — ${outcome.batches.length} دفعة`,
                            variant: outcome.failures.length ? 'info' : 'success',
                        });
                    }}
                />
            ) : null}

            {canAudit ? (
                <InventoryAuditStudio
                    open={auditsOpen}
                    onOpenChange={(next) => {
                        setAuditsOpen(next);
                    }}
                />
            ) : null}
        </div>
    );
}
