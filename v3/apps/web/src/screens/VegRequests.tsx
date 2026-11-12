import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { fetchCurrency } from '../lib/finance';
import { formatMoney } from '../lib/format';
import { openBlankTab, writeHtmlDocument } from '../lib/print-document';
import { vegRequestPrintHtml } from '../lib/veg-print';
import {
    fetchVegRequests,
    priorityLabel,
    searchVegRequests,
    VEG_FILTER_LABELS,
    VEG_STATUS_FILTERS,
    type VegRequestRow,
    type VegStatusFilter,
    vegRequestToRow,
    vegStatusCounts,
} from '../lib/veg-requests';
import {
    cancelVegRequest,
    createVegRequest,
    editVegItems,
    fetchVegCatalog,
    markVegPrinted,
    priceVegRequest,
    receiveVegRequest,
    VEG_TEXT,
    type VegCatalog,
    type VegItemInput,
    vegCancelConfirm,
    vegCreateVisible,
    vegPriceVisible,
    vegReceiveConfirm,
    vegReceiveVisible,
} from '../lib/veg-requests-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';

/**
 * طلبات شراء الخضار — CRUD كامل مثل V2:
 *  • إنشاء طلب (POST /api/veg-requests — sous_chef|admin|owner)
 *  • استلام (POST /api/veg-requests/:id/receive — sous_chef|admin|owner)
 *  • تسعير (POST /api/veg-requests/:id/price — warehouse|admin|owner|manager)
 *  • تعديل الكميات (PUT /api/veg-requests/:id/items — sous_chef|admin|owner)
 *  • إلغاء (POST /api/veg-requests/:id/cancel — صاحب الطلب أو الإدارة)
 *  • طباعة الطلب (ورقة A4 من صفّه + POST /api/veg-requests/:id/printed) وطباعة الشاشة (PrintActions)
 *
 * القراءة من `/api/veg-requests`، والكتابة محجوزة للأدوار أعلاه والخادم يحسم.
 */

const PAGE_SIZE = 25;

type SortKey = 'number' | 'itemsCount' | 'priority' | 'total' | 'by' | 'created' | 'status';

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
}: {
    label: string;
    sortKey: SortKey;
    sort: { key: SortKey; dir: 'asc' | 'desc' } | null;
    onToggle: (key: SortKey) => void;
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

/** نبرة الحالة من `v2/status.js:172-175` — النص نفسه من السجل. */
function statusTone(status: string): string {
    if (status === 'received') {
        return 'text-success-text';
    }
    if (status === 'priced') {
        return 'text-info-text';
    }
    if (status === 'pending') {
        return 'text-warning-text';
    }
    return 'text-muted';
}

function compare(a: VegRequestRow, b: VegRequestRow, key: SortKey): number {
    if (key === 'number') {
        return a.number.localeCompare(b.number, 'en');
    }
    if (key === 'itemsCount') {
        return a.itemsCount - b.itemsCount;
    }
    if (key === 'priority') {
        return Number(a.urgent) - Number(b.urgent);
    }
    if (key === 'total') {
        return Number(a.total ?? -1) - Number(b.total ?? -1);
    }
    if (key === 'created') {
        return a.created.localeCompare(b.created);
    }
    if (key === 'status') {
        return a.statusLabel.localeCompare(b.statusLabel, 'ar');
    }
    return a.by.localeCompare(b.by, 'ar');
}

/* ── نموذج إنشاء طلب ─────────────────────────────────────────────────────── */

interface CreateDialogProps {
    open: boolean;
    catalog: VegCatalog | null;
    catalogLoading: boolean;
    pending: boolean;
    onClose: () => void;
    onSubmit: (items: VegItemInput[], priority: 'normal' | 'urgent', notes: string) => Promise<void>;
}

const CREATE_FORM_ID = 'erp-veg-create-form';

function CreateDialog({ open, catalog, catalogLoading, pending, onClose, onSubmit }: CreateDialogProps) {
    const [lines, setLines] = useState<VegItemInput[]>([]);
    const [priority, setPriority] = useState<'normal' | 'urgent'>('normal');
    const [notes, setNotes] = useState('');
    const [selected, setSelected] = useState('');
    const [qty, setQty] = useState('1');
    const [unit, setUnit] = useState('كجم');
    const [error, setError] = useState('');

    const allItems = useMemo(() => {
        if (!catalog) return [];
        return Object.values(catalog.categories).flat();
    }, [catalog]);

    useEffect(() => {
        if (open) {
            setLines([]);
            setPriority('normal');
            setNotes('');
            setSelected('');
            setQty('1');
            setUnit('كجم');
            setError('');
        }
    }, [open]);

    function addLine() {
        setError('');
        const q = Number(qty);
        if (!selected) {
            setError('اختر الصنف من الكتالوج');
            return;
        }
        if (!Number.isFinite(q) || q <= 0) {
            setError('أدخل كمية صحيحة أكبر من صفر');
            return;
        }
        if (lines.some((line) => line.name === selected)) {
            setError('الصنف موجود بالفعل في الطلب');
            return;
        }
        setLines((previous) => [...previous, { name: selected, qty: q, unit: unit.trim() || 'كجم' }]);
        setSelected('');
        setQty('1');
    }

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setError('');
        if (!lines.length) {
            setError(VEG_TEXT.itemsRequired);
            return;
        }
        try {
            await onSubmit(lines, priority, notes);
            onClose();
        } catch (cause) {
            setError(writeErrorMessage(cause, VEG_TEXT.createFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title="طلب خضار جديد"
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {VEG_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={CREATE_FORM_ID} size="sm" loading={pending}>
                        إرسال الطلب
                    </Button>
                </>
            }
        >
            <form id={CREATE_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <div className="grid gap-sm sm:grid-cols-[1fr_120px_100px]">
                    <Select
                        label="الصنف من الكتالوج"
                        name="item"
                        value={selected}
                        onValueChange={(value) => setSelected(String(value ?? ''))}
                        options={allItems.map((name) => ({ label: name, value: name }))}
                    />
                    <Input
                        label="الكمية"
                        name="qty"
                        type="number"
                        min={0.001}
                        step={0.001}
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                    />
                    <Input label="الوحدة" name="unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="كجم" />
                </div>
                <div>
                    <Button type="button" variant="secondary" size="sm" onClick={addLine}>
                        إضافة الصنف
                    </Button>
                </div>

                {catalogLoading ? <p className="text-body-sm text-muted">جارٍ تحميل الكتالوج…</p> : null}

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
                    <p className="text-body-sm text-muted">لم تُضف أصناف بعد — اختر من الكتالوج أعلاه.</p>
                )}

                <Select
                    label="الأولوية"
                    name="priority"
                    value={priority}
                    onValueChange={(value) => setPriority(value === 'urgent' ? 'urgent' : 'normal')}
                    options={[
                        { label: 'عادي', value: 'normal' },
                        { label: 'عاجل', value: 'urgent' },
                    ]}
                />
                <Input
                    label="ملاحظات (اختياري)"
                    name="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="ملاحظات الطلب…"
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

/* ── نموذج تعديل كميات ──────────────────────────────────────────────────── */

interface EditItemsDialogProps {
    open: boolean;
    row: VegRequestRow | null;
    items: ReadonlyArray<{ name: string; qty: number; unit?: string | undefined }>;
    pending: boolean;
    onClose: () => void;
    onSubmit: (items: VegItemInput[]) => Promise<void>;
}

const EDIT_FORM_ID = 'erp-veg-edit-form';

function EditItemsDialog({ open, row, items, pending, onClose, onSubmit }: EditItemsDialogProps) {
    const [qtys, setQtys] = useState<Record<string, string>>({});
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            const next: Record<string, string> = {};
            for (const item of items) {
                next[item.name] = String(item.qty);
            }
            setQtys(next);
            setError('');
        }
    }, [open, items]);

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setError('');
        const payload: VegItemInput[] = [];
        for (const item of items) {
            const q = Number(qtys[item.name]);
            if (!Number.isFinite(q) || q <= 0) {
                setError(`كمية غير صالحة للصنف ${item.name}`);
                return;
            }
            payload.push({ name: item.name, qty: q, unit: item.unit });
        }
        try {
            await onSubmit(payload);
            onClose();
        } catch (cause) {
            setError(writeErrorMessage(cause, VEG_TEXT.editFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={row ? `تعديل كميات ${row.number}` : 'تعديل كميات'}
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {VEG_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={EDIT_FORM_ID} size="sm" loading={pending}>
                        حفظ الكميات
                    </Button>
                </>
            }
        >
            <form id={EDIT_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <p className="rounded-md border border-warning/40 bg-warning-soft p-sm text-body-sm text-ink-secondary">
                    إضافة أصناف جديدة مرفوضة — احتاج طلبًا جديدًا. الكميات تُوثَّق في سجل الطلب.
                </p>
                <ul className="flex flex-col gap-sm">
                    {items.map((item) => (
                        <li key={item.name} className="grid grid-cols-[1fr_120px] items-end gap-sm">
                            <span className="text-ink">{item.name}</span>
                            <Input
                                label="الكمية"
                                name={`qty-${item.name}`}
                                type="number"
                                min={0.001}
                                step={0.001}
                                value={qtys[item.name] ?? ''}
                                onChange={(e) => setQtys((previous) => ({ ...previous, [item.name]: e.target.value }))}
                            />
                        </li>
                    ))}
                </ul>
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

interface PriceDialogProps {
    open: boolean;
    row: VegRequestRow | null;
    items: ReadonlyArray<{ name: string; qty: number; unit?: string | undefined }>;
    pending: boolean;
    onClose: () => void;
    onSubmit: (prices: { name: string; price: number; qty?: number | undefined }[]) => Promise<void>;
}

const PRICE_FORM_ID = 'erp-veg-price-form';

function PriceDialog({ open, row, items, pending, onClose, onSubmit }: PriceDialogProps) {
    const [prices, setPrices] = useState<Record<string, string>>({});
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            const next: Record<string, string> = {};
            for (const item of items) {
                next[item.name] = '';
            }
            setPrices(next);
            setError('');
        }
    }, [open, items]);

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setError('');
        const payload: { name: string; price: number; qty?: number | undefined }[] = [];
        for (const item of items) {
            const p = Number(prices[item.name]);
            if (!Number.isFinite(p) || p < 0) {
                setError(`أدخل سعرًا صحيحًا للصنف ${item.name}`);
                return;
            }
            payload.push({ name: item.name, price: p, qty: item.qty });
        }
        try {
            await onSubmit(payload);
            onClose();
        } catch (cause) {
            setError(writeErrorMessage(cause, VEG_TEXT.priceFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={row ? `تسعير ${row.number}` : 'تسعير الطلب'}
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {VEG_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={PRICE_FORM_ID} size="sm" loading={pending}>
                        اعتماد التسعير
                    </Button>
                </>
            }
        >
            <form id={PRICE_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <p className="rounded-md border border-hairline bg-surface-sunken p-sm text-body-sm text-muted">
                    سعر الوحدة لكل صنف. سيُحمَّل الإجمالي كمصروف على قسم المطبخ تلقائيًا.
                </p>
                <ul className="flex flex-col gap-sm">
                    {items.map((item) => (
                        <li key={item.name} className="grid grid-cols-[1fr_140px] items-end gap-sm">
                            <span className="text-ink">
                                {item.name}{' '}
                                <span className="erp-numeric text-caption text-muted" dir="ltr">
                                    ({item.qty} {item.unit ?? ''})
                                </span>
                            </span>
                            <Input
                                label="السعر"
                                name={`price-${item.name}`}
                                type="number"
                                min={0}
                                step={0.01}
                                value={prices[item.name] ?? ''}
                                onChange={(e) => setPrices((previous) => ({ ...previous, [item.name]: e.target.value }))}
                            />
                        </li>
                    ))}
                </ul>
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

/* ── نموذج تأكيد ────────────────────────────────────────────────────── */

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    pending: boolean;
    onConfirm: () => Promise<void>;
    onClose: () => void;
}

function ConfirmDialog({ open, title, message, pending, onConfirm, onClose }: ConfirmDialogProps) {
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
                    {VEG_TEXT.cancel}
                </Button>
                <Button type="button" size="sm" variant="danger" loading={pending} onClick={() => void onConfirm()}>
                    تأكيد
                </Button>
            </div>
        </Dialog>
    );
}

/* ── الشاشة ───────────────────────────────────────────────────────────── */

export function VegRequests() {
    const auth = useAuthState();
    const { toast } = useToast();
    const canCreate = vegCreateVisible(auth.user?.role);
    const canReceive = vegReceiveVisible(auth.user?.role);
    const canPrice = vegPriceVisible(auth.user?.role);

    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<VegStatusFilter>('all');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
    const [page, setPage] = useState(1);
    const [printingId, setPrintingId] = useState<string | null>(null);

    const [createOpen, setCreateOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [editRow, setEditRow] = useState<VegRequestRow | null>(null);
    const [editItems, setEditItems] = useState<ReadonlyArray<{ name: string; qty: number; unit?: string | undefined }>>([]);
    const [priceOpen, setPriceOpen] = useState(false);
    const [priceRow, setPriceRow] = useState<VegRequestRow | null>(null);
    const [priceItems, setPriceItems] = useState<ReadonlyArray<{ name: string; qty: number; unit?: string | undefined }>>([]);
    const [actionOpen, setActionOpen] = useState(false);
    const [actionRow, setActionRow] = useState<VegRequestRow | null>(null);
    const [actionKind, setActionKind] = useState<'receive' | 'price' | 'cancel'>('receive');
    const [actionTitle, setActionTitle] = useState('');
    const [actionMessage, setActionMessage] = useState('');

    const vegQuery = useQuery({
        queryKey: ['veg-requests', status],
        queryFn: ({ signal }) => fetchVegRequests(status, signal),
    });
    const currencyQuery = useQuery({
        queryKey: ['settings-currency'],
        queryFn: ({ signal }) => fetchCurrency(signal),
        staleTime: 10 * 60 * 1000,
    });
    const catalogQuery = useQuery({
        queryKey: ['veg-catalog'],
        queryFn: ({ signal }) => fetchVegCatalog(signal),
        staleTime: 5 * 60 * 1000,
    });
    const currency = String(currencyQuery.data ?? '');

    const allRows = useMemo(() => (vegQuery.data?.requests ?? []).map(vegRequestToRow), [vegQuery.data]);
    const summary = vegQuery.data?.summary ?? { pending: 0, pendingToday: 0, today: 0 };
    const counts = useMemo(() => vegStatusCounts(allRows), [allRows]);

    const search = useMemo(() => searchVegRequests(allRows, query), [allRows, query]);
    const rows = search.rows;

    const sorted = useMemo(() => {
        if (!sort) return rows;
        const copy = [...rows].sort((a, b) => compare(a, b, sort.key));
        return sort.dir === 'asc' ? copy : copy.reverse();
    }, [rows, sort]);

    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const filtered = Boolean(query || status !== 'all');

    function toggleSort(key: SortKey) {
        setPage(1);
        setSort((previous) => (previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
    }

    function resetFilters() {
        setQuery('');
        setStatus('all');
        setSort(null);
        setPage(1);
    }

    /* ── الكتبات عبر useWriteMutation ────────────────────────────────── */

    const createMutation = useWriteMutation<{ items: VegItemInput[]; priority: 'normal' | 'urgent'; notes: string }, void>({
        mutationFn: (input) => createVegRequest(input).then(() => undefined),
        successTitle: () => VEG_TEXT.createSuccess,
        invalidate: [['veg-requests']],
        silentError: true,
        onSuccess: () => setCreateOpen(false),
    });

    const receiveMutation = useWriteMutation<string, void>({
        mutationFn: (id) => receiveVegRequest(id).then(() => undefined),
        successTitle: () => VEG_TEXT.receiveSuccess,
        invalidate: [['veg-requests']],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    const priceMutation = useWriteMutation<{ id: string; prices: { name: string; price: number; qty?: number | undefined }[] }, void>({
        mutationFn: ({ id, prices }) => priceVegRequest(id, prices).then(() => undefined),
        successTitle: () => VEG_TEXT.priceSuccess,
        invalidate: [['veg-requests']],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    const editMutation = useWriteMutation<VegItemInput[], void>({
        mutationFn: (items) => editVegItems(editRow?.id ?? '', { items }).then(() => undefined),
        successTitle: () => VEG_TEXT.editSuccess,
        invalidate: [['veg-requests']],
        silentError: true,
        onSuccess: () => {
            setEditOpen(false);
            setEditRow(null);
        },
    });

    const cancelMutation = useWriteMutation<string, void>({
        mutationFn: (id) => cancelVegRequest(id).then(() => undefined),
        successTitle: () => VEG_TEXT.cancelSuccess,
        invalidate: [['veg-requests']],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    async function openEdit(row: VegRequestRow) {
        // items details come from the list row; full items fetched on demand would need another endpoint.
        // The list already carries items via request payload — read from data cache.
        const raw = vegQuery.data?.requests.find((request) => request.id === row.id);
        const items = Array.isArray(raw?.items)
            ? (raw.items as Array<{ name?: string; qty?: number; quantity?: number; unit?: string }>)
            : [];
        setEditRow(row);
        setEditItems(
            items.map((item) => ({
                name: String(item.name ?? ''),
                qty: Number(item.qty ?? item.quantity ?? 0),
                unit: item.unit ? String(item.unit) : undefined,
            })),
        );
        setEditOpen(true);
    }

    function openAction(row: VegRequestRow, kind: 'receive' | 'price' | 'cancel') {
        if (kind === 'price') {
            const raw = vegQuery.data?.requests.find((request) => request.id === row.id);
            const items = Array.isArray(raw?.items)
                ? (raw.items as Array<{ name?: string; qty?: number; quantity?: number; unit?: string }>)
                : [];
            setPriceRow(row);
            setPriceItems(
                items.map((item) => ({
                    name: String(item.name ?? ''),
                    qty: Number(item.qty ?? item.quantity ?? 0),
                    unit: item.unit ? String(item.unit) : undefined,
                })),
            );
            setPriceOpen(true);
            return;
        }
        if (kind === 'receive') {
            setActionTitle('استلام الطلب');
            setActionMessage(vegReceiveConfirm(row.number));
        } else {
            setActionTitle('إلغاء الطلب');
            setActionMessage(vegCancelConfirm(row.number));
        }
        setActionRow(row);
        setActionKind(kind);
        setActionOpen(true);
    }

    async function confirmAction() {
        if (!actionRow) return;
        if (actionKind === 'receive') {
            await receiveMutation.mutateAsync(actionRow.id);
        } else {
            await cancelMutation.mutateAsync(actionRow.id);
        }
    }

    function printRequest(row: VegRequestRow) {
        if (printingId) return;
        const raw = vegQuery.data?.requests.find((request) => request.id === row.id);
        if (!raw) {
            toast({
                variant: 'error',
                title: 'تعذّرت طباعة الطلب',
                description: 'أعد تحميل السجل ثم حاول مرة أخرى.',
            });
            return;
        }
        const win = openBlankTab(`طلب شراء خضار ${row.number}`);
        if (!win) {
            toast({
                variant: 'error',
                title: 'تعذّرت طباعة الطلب',
                description: 'منع المتصفح فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة ثم أعد المحاولة.',
            });
            return;
        }
        setPrintingId(row.id);
        try {
            writeHtmlDocument(
                win,
                vegRequestPrintHtml(raw, {
                    byName: String(auth.user?.name ?? auth.user?.username ?? ''),
                    currency,
                }),
            );
            win.document.querySelector('[data-veg-print]')?.addEventListener('click', () => win.print());
            win.document.querySelector('[data-veg-close]')?.addEventListener('click', () => win.close());
            win.print();
            void markVegPrinted(row.id).catch(() => undefined);
        } finally {
            setPrintingId(null);
        }
    }

    return (
        <div className="mx-auto flex w-full min-w-0 flex-col gap-lg">
            <header className="flex flex-wrap items-end justify-between gap-md border-b border-hairline pb-md">
                <div>
                    <h1 className="text-display-lg text-ink">
                        طلبات شراء الخضار{' '}
                        <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted" dir="ltr" lang="en">
                            Vegetable Requests
                        </span>
                    </h1>
                    <p className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                        طلبات المطبخ إلى المخازن — الإنشاء والاستلام والتسعير وتعديل الكميات والإلغاء مثل الشاشة القديمة. الخادم يقرّر أدوار
                        الكتابة ويُعرض رفضه كما هو.
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    {canCreate ? (
                        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                            طلب جديد
                        </Button>
                    ) : null}
                    <PrintActions title="طلبات شراء الخضار" />
                    <button
                        type="button"
                        onClick={() => {
                            void vegQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="معلقة" english="Pending" value={formatInt(summary.pending)} hint="عدّاد الخادم لكل السجل" />
                <Kpi
                    label="معلقة اليوم"
                    english="Pending today"
                    value={formatInt(summary.pendingToday)}
                    hint="بانتظار المعالجة ومُنشأة اليوم"
                />
                <Kpi label="طلبات اليوم" english="Today" value={formatInt(summary.today)} hint="كل الحالات المُنشأة اليوم" />
                <Kpi
                    label="عاجل في العرض"
                    english="Urgent"
                    value={formatInt(counts.urgent)}
                    hint={`من ${formatInt(counts.total)} طلبًا محمّلًا`}
                />
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-veg-q">
                        بحث
                        <input
                            id="erp-veg-q"
                            type="search"
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setPage(1);
                            }}
                            placeholder="رقم الطلب، المنشئ، الحالة، ملاحظات"
                            className="h-9 w-72 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <fieldset className="m-0 flex flex-wrap items-end gap-xxs border-0 p-0">
                        <legend className="sr-only">ترشيح حالة الطلب</legend>
                        {VEG_STATUS_FILTERS.map((value) => (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={status === value}
                                onClick={() => {
                                    setStatus(value);
                                    setPage(1);
                                }}
                                className={
                                    status === value
                                        ? 'rounded-md border border-hairline-strong bg-surface-sunken px-sm py-xxs text-body-sm text-ink'
                                        : 'rounded-md border border-transparent px-sm py-xxs text-body-sm text-muted hover:bg-surface-hover'
                                }
                            >
                                {VEG_FILTER_LABELS[value]}
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
                        {`معلقة ${formatInt(summary.pending)} · معلقة اليوم ${formatInt(summary.pendingToday)} · طلبات اليوم ${formatInt(summary.today)}`}
                    </span>
                </div>
                <p className="mt-sm text-body-sm text-muted" role="status">
                    {filtered ? `${formatInt(sorted.length)} طلبًا مطابقًا` : `${formatInt(counts.total)} طلبًا محمّلًا`}
                    {counts.priced ? ` · ${formatInt(counts.priced)} مسعّر` : ''}
                    {counts.cancelled ? ` · ${formatInt(counts.cancelled)} ملغي` : ''}
                </p>
                {search.folded ? (
                    <p className="mt-sm text-body-sm text-muted">بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.</p>
                ) : null}
            </Card>

            <Card>
                {vegQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل طلبات الخضار" />
                        <TableSkeleton rows={4} columns={7} />
                    </div>
                ) : null}

                {vegQuery.isError ? (
                    <StateError
                        message={vegQuery.error instanceof Error ? vegQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void vegQuery.refetch();
                        }}
                    />
                ) : null}

                {vegQuery.isSuccess && sorted.length === 0 ? (
                    <StateEmpty
                        title={filtered ? 'لا طلبات تطابق المرشّحات' : 'لا طلبات مسجّلة'}
                        hint={filtered ? 'لا نتائج مطابقة؛ عدّل المرشّحات أو امسحها.' : 'أنشئ أول طلب.'}
                    />
                ) : null}

                {vegQuery.isSuccess && sorted.length > 0 ? (
                    <>
                        <TableScroll label="سجل طلبات شراء الخضار">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh label="رقم الطلب" sortKey="number" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الأصناف" sortKey="itemsCount" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الأولوية" sortKey="priority" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الإجمالي" sortKey="total" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="أنشأها" sortKey="by" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="التاريخ" sortKey="created" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الحالة" sortKey="status" sort={sort} onToggle={toggleSort} />
                                        <th scope="col" className="px-sm py-xs text-start font-medium" data-erp-print-hide>
                                            إجراءات
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row) => (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {row.number}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {formatInt(row.itemsCount)}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm">
                                                {row.urgent ? (
                                                    <span className="text-danger-text">{priorityLabel(row)}</span>
                                                ) : (
                                                    <span className="text-muted">{priorityLabel(row)}</span>
                                                )}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {row.total === null ? (
                                                    <span className="text-muted">—</span>
                                                ) : (
                                                    <>
                                                        {formatMoney(row.total)}
                                                        {currency ? <span className="text-caption text-faint"> {currency}</span> : null}
                                                    </>
                                                )}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">{row.by}</td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {row.created || '—'}
                                            </td>
                                            <td className="px-sm py-xxs">
                                                <span className={`text-body-sm ${statusTone(row.status)}`}>{row.statusLabel}</span>
                                            </td>
                                            <td className="px-sm py-xxs" data-erp-print-hide>
                                                <div className="flex flex-wrap items-center gap-xs">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="secondary"
                                                        title="طباعة ورقة الطلب"
                                                        onClick={() => printRequest(row)}
                                                    >
                                                        طباعة
                                                    </Button>
                                                    {row.status === 'pending' && (
                                                        <>
                                                            {canCreate ? (
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="secondary"
                                                                    title="تعديل الكميات"
                                                                    onClick={() => void openEdit(row)}
                                                                >
                                                                    تعديل
                                                                </Button>
                                                            ) : null}
                                                            {canReceive ? (
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="secondary"
                                                                    title="استلام الطلب"
                                                                    onClick={() => openAction(row, 'receive')}
                                                                >
                                                                    استلام
                                                                </Button>
                                                            ) : null}
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="secondary"
                                                                title="إلغاء الطلب"
                                                                onClick={() => openAction(row, 'cancel')}
                                                            >
                                                                إلغاء
                                                            </Button>
                                                        </>
                                                    )}
                                                    {row.status === 'received' && canPrice ? (
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="secondary"
                                                            title="تسعير الطلب"
                                                            onClick={() => openAction(row, 'price')}
                                                        >
                                                            تسعير
                                                        </Button>
                                                    ) : null}
                                                </div>
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

            {/* Dialogs */}
            <CreateDialog
                open={createOpen}
                catalog={catalogQuery.data ?? null}
                catalogLoading={catalogQuery.isPending}
                pending={createMutation.isPending}
                onClose={() => setCreateOpen(false)}
                onSubmit={async (items, priority, notes) => {
                    await createMutation.mutateAsync({ items, priority, notes });
                }}
            />
            <EditItemsDialog
                open={editOpen}
                row={editRow}
                items={editItems}
                pending={editMutation.isPending}
                onClose={() => {
                    setEditOpen(false);
                    setEditRow(null);
                }}
                onSubmit={async (items) => {
                    await editMutation.mutateAsync(items);
                }}
            />
            <PriceDialog
                open={priceOpen}
                row={priceRow}
                items={priceItems}
                pending={priceMutation.isPending}
                onClose={() => {
                    setPriceOpen(false);
                    setPriceRow(null);
                }}
                onSubmit={async (prices) => {
                    if (!priceRow) return;
                    await priceMutation.mutateAsync({ id: priceRow.id, prices });
                }}
            />
            <ConfirmDialog
                open={actionOpen}
                title={actionTitle}
                message={actionMessage}
                pending={receiveMutation.isPending || priceMutation.isPending || cancelMutation.isPending}
                onConfirm={confirmAction}
                onClose={() => {
                    setActionOpen(false);
                    setActionRow(null);
                }}
            />
        </div>
    );
}
