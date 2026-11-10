import './Shelves.premium.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { Card, StateEmpty, StateError, StateLoading, TableSkeleton } from '../components/TableState';
import { PrintActions } from '../components/PrintActions';
import { useAuthState } from '../lib/auth';
import { fetchCurrency } from '../lib/finance';
import { formatMoney } from '../lib/format';
import {
    addShelfSuccess,
    createShelf,
    deleteShelf,
    deleteShelfConfirm,
    deleteShelfSuccess,
    emptyShelfForm,
    fetchShelfInventory,
    fetchShelves,
    filterShelves,
    formatInt,
    formatQty,
    SHELF_TEXT,
    SHELF_WRITE_ROLES,
    type Shelf,
    type ShelfField,
    type ShelfForm,
    shelfCapacity,
    shelfCodeExists,
    shelfItems,
    shelfStats,
    shelfToForm,
    updateShelf,
    updateShelfSuccess,
    validateShelfForm,
} from '../lib/shelves';
import { isWriteRole, useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';

/**
 * الرفوف — قراءة من `/api/shelves` و`/api/inventory`، وكتابة مطابقة لـV2:
 * إضافة/تعديل/حذف بنفس البوابة (POST/PUT/DELETE `/api/shelves`)، ونفس أدوار
 * الكتابة (`admin|manager|warehouse`)، ونفس رسائل التحقق والتأكيد والنجاح.
 *
 * بطاقة لكل رف: عدد الأصناف، الكمية، القيمة، السعة، وأول خمسة أصناف.
 * حذف الرف لا يحذف أصنافه — `inventory.shelfId` هو `ON DELETE SET NULL`،
 * فتُزال التعيينات فقط، والتأكيد يقول ذلك قبل الطلب.
 *
 * `icon` المخزَّن لا يُقرأ ولا يُعرض (كان يحمل وسوم HTML في القديم).
 */

const TOP_ITEMS = 5;

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

function ShelfCard({
    shelf,
    items,
    statsReady,
    currency,
    writable,
    pending,
    onEdit,
    onDelete,
}: {
    shelf: Shelf;
    items: ReturnType<typeof shelfItems> | null;
    statsReady: boolean;
    currency: string;
    writable: boolean;
    pending: boolean;
    onEdit: (shelf: Shelf) => void;
    onDelete: (shelf: Shelf) => void;
}) {
    const count = statsReady && items ? items.count : null;
    const top = items ? items.rows.slice(0, TOP_ITEMS) : [];
    const more = items ? items.rows.length - top.length : 0;
    const capacity = shelfCapacity(shelf);
    const name = String(shelf.name ?? '');

    return (
        <article className="flex flex-col gap-sm rounded-lg border border-hairline bg-surface p-md shadow-card">
            <header className="flex items-start justify-between gap-sm">
                <div>
                    <h2 className="text-heading-sm text-ink">{shelf.name || '—'}</h2>
                    <p className="text-body-sm text-muted">
                        <span className="erp-numeric" dir="ltr">
                            {shelf.code || '—'}
                        </span>
                        {shelf.location ? <span> · {shelf.location}</span> : null}
                    </p>
                </div>
                <span className="rounded-full bg-surface-sunken px-sm py-xxs text-caption text-ink-secondary">
                    {count === null ? '—' : `${formatInt(count)} صنف`}
                </span>
            </header>

            {writable ? (
                <div className="flex items-center justify-end gap-xs" data-erp-print-hide>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`تعديل الرف ${name}`}
                        onClick={() => {
                            onEdit(shelf);
                        }}
                    >
                        تعديل
                    </Button>
                    <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={pending}
                        aria-label={`حذف الرف ${name}`}
                        onClick={() => {
                            onDelete(shelf);
                        }}
                    >
                        حذف
                    </Button>
                </div>
            ) : null}

            <dl className="grid grid-cols-3 gap-xs border-y border-hairline py-xs text-body-sm">
                <div>
                    <dt className="text-caption text-muted">الكمية</dt>
                    <dd className="erp-numeric text-ink" dir="ltr">
                        {statsReady && items ? formatQty(items.qty) : '—'}
                    </dd>
                </div>
                <div>
                    <dt className="text-caption text-muted">القيمة</dt>
                    <dd className="erp-numeric text-ink" dir="ltr">
                        {statsReady && items
                            ? `${formatMoney(items.value.toFixed(2))}${currency ? ` ${currency}` : ''}`
                            : '—'}
                    </dd>
                </div>
                <div>
                    <dt className="text-caption text-muted">السعة</dt>
                    <dd className="erp-numeric text-ink" dir="ltr">
                        {capacity === null ? '—' : formatQty(capacity)}
                    </dd>
                </div>
            </dl>

            <ul className="flex flex-col gap-xxs text-body-sm" aria-label={`أصناف الرف ${shelf.name || ''}`}>
                {top.map((item) => (
                    <li key={String(item.id)} className="flex items-center justify-between gap-sm">
                        <span className="truncate text-ink">{item.name || '—'}</span>
                        <span className="erp-numeric shrink-0 text-muted" dir="ltr">
                            {formatQty(Number(item.qty) || 0)} {item.unit || ''}
                        </span>
                    </li>
                ))}
                {more > 0 ? <li className="text-caption text-muted">… و{formatInt(more)} أصناف أخرى</li> : null}
                {statsReady && top.length === 0 ? <li className="text-caption text-muted">الرف فارغ</li> : null}
                {!statsReady ? <li className="text-caption text-muted">أعداد الأصناف غير متاحة الآن</li> : null}
            </ul>
        </article>
    );
}

interface ShelfFormDialogProps {
    open: boolean;
    editing: Shelf | null;
    shelves: readonly Shelf[];
    onClose: () => void;
    onSaved: (message: string) => void;
}

/**
 * نموذج إضافة/تعديل الرف — نفس حقول V2 ونفس قواعدها:
 * الاسم مطلوب (255)، الكود مطلوب (50) وثابت عند التعديل، الموقع اختياري (255)،
 * السعة رقم ≥ 0 والافتراضي 50. الخطأ يظهر داخل النموذج ويُركَّز على حقله كما في
 * `fail(form, message, field)` في V2، لا توست يختفي قبل أن يُقرأ.
 */
function ShelfFormDialog({ open, editing, shelves, onClose, onSaved }: ShelfFormDialogProps) {
    const [form, setForm] = useState<ShelfForm>(emptyShelfForm);
    const [error, setError] = useState<{ field?: ShelfField; message: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        if (open) {
            setForm(editing ? shelfToForm(editing) : emptyShelfForm());
            setError(null);
        }
    }, [editing, open]);

    function focusField(field: ShelfField | undefined): void {
        if (!field) {
            return;
        }
        const input = formRef.current?.querySelector<HTMLInputElement>(`[name="${field}"]`);
        input?.focus();
    }

    function update(field: keyof ShelfForm, value: string): void {
        setForm((previous) => ({ ...previous, [field]: value }));
    }

    async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (saving) {
            return;
        }
        const errors = validateShelfForm(form);
        if (errors.length > 0) {
            const first = errors[0] as { field: ShelfField; message: string };
            setError(first);
            focusField(first.field);
            return;
        }
        if (shelfCodeExists(shelves, form.code, editing?.id)) {
            setError({ field: 'code', message: SHELF_TEXT.duplicateCode });
            focusField('code');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            if (editing) {
                await updateShelf(editing.id, form);
                onSaved(updateShelfSuccess(form.name));
            } else {
                await createShelf(form);
                onSaved(addShelfSuccess(form.name));
            }
        } catch (cause) {
            const message = writeErrorMessage(cause, SHELF_TEXT.saveFailed);
            setError({ field: 'name', message });
            focusField('name');
        } finally {
            setSaving(false);
        }
    }

    /** خاصية `error` بشرط وجودها — `exactOptionalPropertyTypes` يرفض `undefined`. */
    const errorProps = (field: ShelfField): { error?: string } => {
        const message = error && error.field === field ? error.message : undefined;
        return message === undefined ? {} : { error: message };
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title={editing ? SHELF_TEXT.editTitle : SHELF_TEXT.addTitle}
            size="md"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {SHELF_TEXT.cancel}
                    </Button>
                    <Button type="submit" form="erp-shelf-form" size="sm" disabled={saving}>
                        {SHELF_TEXT.save}
                    </Button>
                </>
            }
        >
            <form
                id="erp-shelf-form"
                ref={formRef}
                onSubmit={(event) => void submit(event)}
                className="flex flex-col gap-sm"
            >
                <Input
                    label="اسم الرف"
                    name="name"
                    value={form.name}
                    maxLength={255}
                    required
                    requiredMark
                    autoFocus
                    {...errorProps('name')}
                    onChange={(event) => {
                        update('name', event.target.value);
                    }}
                />
                <Input
                    label="الكود"
                    name="code"
                    value={form.code}
                    maxLength={50}
                    required
                    requiredMark
                    disabled={Boolean(editing)}
                    {...(editing ? { hint: 'الكود معرّف ثابت — لا يتغيّر عند التعديل (تكافؤ V2).' } : {})}
                    {...errorProps('code')}
                    className="erp-numeric"
                    onChange={(event) => {
                        update('code', event.target.value);
                    }}
                />
                <Input
                    label="الموقع"
                    name="location"
                    value={form.location}
                    maxLength={255}
                    {...errorProps('location')}
                    onChange={(event) => {
                        update('location', event.target.value);
                    }}
                />
                <Input
                    label="السعة"
                    name="capacity"
                    type="number"
                    min={0}
                    step={1}
                    value={form.capacity}
                    {...errorProps('capacity')}
                    onChange={(event) => {
                        update('capacity', event.target.value);
                    }}
                />
                {error && error.field === undefined ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error.message}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

export function Shelves() {
    const [search, setSearch] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<Shelf | null>(null);
    const [pageError, setPageError] = useState('');
    const auth = useAuthState();
    const writable = isWriteRole(auth.user?.role, SHELF_WRITE_ROLES);
    const confirm = useConfirm();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const shelvesQuery = useQuery({
        queryKey: ['shelves', 'register'],
        queryFn: ({ signal }) => fetchShelves(signal),
    });
    const inventoryQuery = useQuery({
        queryKey: ['shelves', 'inventory'],
        queryFn: ({ signal }) => fetchShelfInventory(signal),
    });
    const currencyQuery = useQuery({
        queryKey: ['finance', 'currency'],
        queryFn: ({ signal }) => fetchCurrency(signal),
        staleTime: 10 * 60 * 1000,
    });

    const shelves = shelvesQuery.data ?? [];
    const items = inventoryQuery.data ?? [];
    const statsReady = inventoryQuery.isSuccess;
    const currency = currencyQuery.data ?? '';
    const stats = useMemo(() => (statsReady ? shelfStats(shelves, items) : null), [statsReady, shelves, items]);
    const visible = useMemo(() => filterShelves(shelves, search), [shelves, search]);

    // حذف الرف: توست النجاح من الطبقة المشتركة، والخطأ يُعرض في الشريط أعلى
    // الشاشة كما يفعل `say()` في V2 (لا توست يضيع أثناء إعادة الجلب).
    const deleteMutation = useWriteMutation<Shelf, void>({
        mutationFn: async (shelf) => {
            await deleteShelf(shelf.id);
        },
        successTitle: (shelf) => deleteShelfSuccess(String(shelf.name ?? '')),
        invalidate: [
            ['shelves', 'register'],
            ['shelves', 'inventory'],
        ],
        silentError: true,
        onError: (cause) => {
            setPageError(writeErrorMessage(cause, SHELF_TEXT.deleteFailed));
        },
    });

    function refresh() {
        void shelvesQuery.refetch();
        void inventoryQuery.refetch();
    }

    function openAdd(): void {
        setEditing(null);
        setDialogOpen(true);
    }

    function openEdit(shelf: Shelf): void {
        setEditing(shelf);
        setDialogOpen(true);
    }

    function handleSaved(message: string): void {
        setDialogOpen(false);
        setEditing(null);
        setPageError('');
        toast({ title: message, variant: 'success' });
        // نفس إعادة التحميل التي يفعلها V2 بعد الحفظ: الدليل والأعداد معًا.
        void queryClient.invalidateQueries({ queryKey: ['shelves', 'register'] });
        void queryClient.invalidateQueries({ queryKey: ['shelves', 'inventory'] });
    }

    async function handleDelete(shelf: Shelf): Promise<void> {
        if (deleteMutation.isPending) {
            return;
        }
        setPageError('');
        // نصّ V2 حرفيًّا: عدد الأصناف الذي سيُفقد تعيينه، والأصناف تبقى.
        const answer = await confirm(deleteShelfConfirm(String(shelf.name ?? ''), shelfItems(shelf.id, items).count));
        if (!answer) {
            return;
        }
        deleteMutation.mutate(shelf);
    }

    return (
        <div className="flex flex-col gap-md erp-premium-Shelves">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        الرفوف{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Shelves
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">
                        كل صنف يُعيَّن لرفٍ واحد من شاشة المخزن. إضافة وتعديل وحذف الرفوف.
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    {writable ? (
                        <Button type="button" size="sm" onClick={openAdd}>
                            إضافة رف
                        </Button>
                    ) : null}
                    <PrintActions title="الرفوف" />
                    <button
                        type="button"
                        onClick={refresh}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            <p className="text-body-sm text-muted">حذف الرف لا يحذف أصنافه — يزيل تعيينها فقط وتبقى في السجل.</p>

            {pageError ? (
                <p role="alert" className="text-body-sm text-danger-text">
                    {pageError}
                </p>
            ) : null}

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="رفوف مسجّلة" english="Shelves" value={formatInt(shelves.length)} hint="من دليل الرفوف" />
                <Kpi
                    label="أصناف معيّنة"
                    english="Assigned items"
                    value={stats ? formatInt(stats.assignedItems) : '—'}
                    hint={`من ${formatInt(items.length)} صنفًا في المخزون`}
                />
                <Kpi
                    label="رفوف فارغة"
                    english="Empty shelves"
                    value={stats ? formatInt(stats.emptyShelves) : '—'}
                    hint="لا صنف معيَّن لها"
                />
                <Kpi
                    label="نسبة الإشغال"
                    english="Occupancy"
                    value={stats ? `${stats.occupancy.toFixed(1)}%` : '—'}
                    hint="الأصناف المعيّنة ÷ كل الأصناف"
                />
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label
                        className="flex min-w-56 flex-1 flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-shelves-search"
                    >
                        بحث
                        <input
                            id="erp-shelves-search"
                            type="search"
                            value={search}
                            placeholder="بحث بالاسم أو الكود أو الموقع"
                            onChange={(event) => {
                                setSearch(event.target.value);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <span className="text-body-sm text-muted">
                        {formatInt(visible.length)} من {formatInt(shelves.length)} رفًّا
                    </span>
                </div>
            </Card>

            {inventoryQuery.isError ? (
                <p role="alert" className="text-body-sm text-danger-text">
                    تعذّر تحميل المخزون — أعداد الأصناف والقيم غير معروضة، والرفوف نفسها مقروءة.
                </p>
            ) : null}

            {shelvesQuery.isPending ? (
                <Card>
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل الرفوف" />
                        <TableSkeleton rows={4} columns={3} />
                    </div>
                </Card>
            ) : null}

            {shelvesQuery.isError ? (
                <Card>
                    <StateError
                        message={shelvesQuery.error instanceof Error ? shelvesQuery.error.message : 'خطأ غير معروف'}
                        onRetry={refresh}
                    />
                </Card>
            ) : null}

            {!shelvesQuery.isPending && !shelvesQuery.isError && shelves.length === 0 ? (
                <Card>
                    <StateEmpty title="لا رفوف مسجّلة" hint="دليل الرفوف فارغ — أضف أول رف." />
                </Card>
            ) : null}

            {!shelvesQuery.isPending && !shelvesQuery.isError && shelves.length > 0 && visible.length === 0 ? (
                <Card>
                    <StateEmpty title="لا رف يطابق البحث" hint="امسح كلمة البحث لعرض الدليل كاملًا." />
                </Card>
            ) : null}

            {!shelvesQuery.isPending && !shelvesQuery.isError && visible.length > 0 ? (
                <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-3">
                    {visible.map((shelf) => (
                        <ShelfCard
                            key={shelf.id}
                            shelf={shelf}
                            items={statsReady ? shelfItems(shelf.id, items) : null}
                            statsReady={statsReady}
                            currency={currency}
                            writable={writable}
                            pending={deleteMutation.isPending}
                            onEdit={openEdit}
                            onDelete={(target) => {
                                void handleDelete(target);
                            }}
                        />
                    ))}
                </div>
            ) : null}

            <ShelfFormDialog
                open={dialogOpen}
                editing={editing}
                shelves={shelves}
                onClose={() => {
                    setDialogOpen(false);
                    setEditing(null);
                }}
                onSaved={handleSaved}
            />
        </div>
    );
}
