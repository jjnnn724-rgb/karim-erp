import './Procurement.premium.css';
import { toCents } from '@karim/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { fetchCurrency } from '../lib/finance';
import { formatMoney } from '../lib/format';
import {
    fetchProcurementSummary,
    fetchSuppliers,
    isSupplierActive,
    moneyOf,
    type Supplier,
    supplierStatusLabel,
    TAX_STATUS_LABEL,
} from '../lib/procurement';
import {
    createSupplier,
    deleteSupplier,
    SUPPLIER_TEXT,
    type SupplierCreateInput,
    type SupplierUpdateInput,
    setSupplierActive,
    supplierActivateConfirm,
    supplierDeactivateConfirm,
    supplierDeleteConfirm,
    supplierDeleteVisible,
    supplierWriteVisible,
    updateSupplier,
} from '../lib/suppliers-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';

/**
 * دليل الموردين — CRUD كامل مثل V2:
 *  • إنشاء مورد (POST /api/procurement/suppliers — admin|manager|accountant)
 *  • تعديل مورد (PATCH /api/procurement/suppliers/:id — admin|manager|accountant)
 *  • إيقاف/تفعيل مورد (PATCH /api/procurement/suppliers/:id/active — admin|manager|accountant)
 *  • حذف مورد (DELETE /api/procurement/suppliers/:id — أدمن فقط)
 *  • طباعة القائمة (PrintActions)
 *
 * القراءة من `/api/procurement/suppliers`، والبحث والترشيح عميلان على الدليل المحمّل.
 */

const PAGE_SIZE = 20;

type SortKey = 'name' | 'purchasesTotal' | 'paymentsTotal' | 'dueTotal' | 'lastPurchaseDate';
type TaxFilter = 'ALL' | 'REGISTERED' | 'NOT_REGISTERED';
type StatusFilter = 'ALL' | 'active' | 'inactive';

function formatInt(value: number): string {
    return value.toLocaleString('en-US');
}

function compareSuppliers(a: Supplier, b: Supplier, key: SortKey): number {
    if (key === 'name') {
        return a.name.localeCompare(b.name, 'ar');
    }
    if (key === 'lastPurchaseDate') {
        return String(a.lastPurchaseDate ?? '').localeCompare(String(b.lastPurchaseDate ?? ''));
    }
    const left = toCents(moneyOf(a[key]));
    const right = toCents(moneyOf(b[key]));
    return left === right ? 0 : left > right ? 1 : -1;
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
            <p className="erp-numeric mt-xs text-heading-lg text-ink">{value}</p>
            <p className="mt-xxs text-caption text-muted">{hint}</p>
        </div>
    );
}

/* ── نموذج إضافة/تعديل مورد ───────────────────────────────────────────── */

interface SupplierFormDialogProps {
    open: boolean;
    onClose: () => void;
    pending: boolean;
    editing: Supplier | null;
    onSave: (payload: SupplierCreateInput | SupplierUpdateInput, isEditing: boolean) => Promise<void>;
}

const SUPPLIER_FORM_ID = 'erp-supplier-form';

function SupplierFormDialog({ open, onClose, pending, editing, onSave }: SupplierFormDialogProps) {
    const [form, setForm] = useState<{
        name: string;
        nameEn: string;
        phone: string;
        address: string;
        taxNumber: string;
        category: string;
        active: boolean;
    }>({
        name: '',
        nameEn: '',
        phone: '',
        address: '',
        taxNumber: '',
        category: '',
        active: true,
    });
    const [formError, setFormError] = useState('');

    useEffect(() => {
        if (!open) {
            return;
        }
        if (editing) {
            setForm({
                name: String(editing.name),
                nameEn: String(editing.name_en ?? ''),
                phone: String(editing.phone ?? ''),
                address: String(editing.address ?? ''),
                taxNumber: String(editing.tax_number ?? ''),
                category: String(editing.category ?? ''),
                active: isSupplierActive(editing),
            });
        } else {
            setForm({ name: '', nameEn: '', phone: '', address: '', taxNumber: '', category: '', active: true });
        }
        setFormError('');
    }, [open, editing]);

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setFormError('');
        if (!form.name.trim()) {
            setFormError(SUPPLIER_TEXT.nameRequired);
            return;
        }
        if (!form.phone.trim()) {
            setFormError(SUPPLIER_TEXT.phoneRequired);
            return;
        }

        const input: SupplierCreateInput | SupplierUpdateInput = {
            name: form.name.trim(),
            phone: form.phone.trim(),
            address: form.address.trim() || null,
            tax_number: form.taxNumber.trim() || null,
            ...(form.category ? { category: form.category.trim() } : {}),
            active: form.active,
        };

        try {
            await onSave(input, Boolean(editing));
            onClose();
        } catch (cause) {
            setFormError(writeErrorMessage(cause, editing ? SUPPLIER_TEXT.updateFailed : SUPPLIER_TEXT.createFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={editing ? 'تعديل مورد' : 'مورد جديد'}
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {SUPPLIER_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={SUPPLIER_FORM_ID} size="sm" loading={pending}>
                        {editing ? 'حفظ التعديل' : 'إضافة المورد'}
                    </Button>
                </>
            }
        >
            <form id={SUPPLIER_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <div className="grid gap-sm sm:grid-cols-2">
                    <Input
                        label="اسم المورد"
                        name="name"
                        value={form.name}
                        onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="شركة التوريدات"
                        required
                    />
                    <Input
                        label="الاسم بالإنجليزية (اختياري)"
                        name="nameEn"
                        value={form.nameEn}
                        onChange={(e) => setForm((prev) => ({ ...prev, nameEn: e.target.value }))}
                        placeholder="Supplier Name"
                    />
                    <Input
                        label="رقم الهاتف"
                        name="phone"
                        value={form.phone}
                        onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                        placeholder="+20 12 345 6789"
                        required
                    />
                    <Input
                        label="العنوان (اختياري)"
                        name="address"
                        value={form.address}
                        onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                        placeholder="القاهرة، مصر"
                    />
                    <Input
                        label="الرقم الضريبي (اختياري)"
                        name="taxNumber"
                        value={form.taxNumber}
                        onChange={(e) => setForm((prev) => ({ ...prev, taxNumber: e.target.value }))}
                        placeholder="123456789"
                    />
                    <Input
                        label="الفئة (اختياري)"
                        name="category"
                        value={form.category}
                        onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                        placeholder="خضروات، ألبان، لحوم…"
                    />
                    <div className="flex items-end gap-sm">
                        <input
                            id="erp-supplier-active"
                            type="checkbox"
                            checked={form.active}
                            onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
                            className="h-5 w-5 text-primary rounded border-hairline-strong"
                        />
                        <label htmlFor="erp-supplier-active" className="text-body-sm text-ink-secondary">
                            المورد نشط
                        </label>
                    </div>
                </div>
                {formError ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {formError}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

/* ── نموذج تأكيد الإيقاف/التفعيل/الحذف ───────────────────────────────── */

interface SupplierActionDialogProps {
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onClose: () => void;
    pending: boolean;
    confirmLabel: string;
    variant: 'secondary' | 'danger';
}

function SupplierActionDialog({ open, title, message, onConfirm, onClose, pending, confirmLabel, variant }: SupplierActionDialogProps) {
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
                    {SUPPLIER_TEXT.cancel}
                </Button>
                <Button type="button" size="sm" variant={variant} loading={pending} onClick={onConfirm}>
                    {confirmLabel}
                </Button>
            </div>
        </Dialog>
    );
}

/* ── الشاشة ───────────────────────────────────────────────────────────── */

export function Procurement() {
    const auth = useAuthState();
    const canWrite = supplierWriteVisible(auth.user?.role);
    const canDelete = supplierDeleteVisible(auth.user?.role);

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Supplier | null>(null);
    const [actionOpen, setActionOpen] = useState(false);
    const [actionRow, setActionRow] = useState<Supplier | null>(null);
    const [actionType, setActionType] = useState<'activate' | 'deactivate' | 'delete'>('deactivate');
    const [actionTitle, setActionTitle] = useState('');
    const [actionMessage, setActionMessage] = useState('');

    const [search, setSearch] = useState('');
    const [tax, setTax] = useState<TaxFilter>('ALL');
    const [status, setStatus] = useState<StatusFilter>('ALL');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'dueTotal', dir: 'desc' });
    const [page, setPage] = useState(1);

    const summaryQuery = useQuery({
        queryKey: ['procurement', 'summary'],
        queryFn: ({ signal }) => fetchProcurementSummary(signal),
    });
    const suppliersQuery = useQuery({
        queryKey: ['procurement', 'suppliers'],
        queryFn: ({ signal }) => fetchSuppliers(signal),
    });
    const currencyQuery = useQuery({
        queryKey: ['finance', 'currency'],
        queryFn: ({ signal }) => fetchCurrency(signal),
        staleTime: 10 * 60 * 1000,
    });

    const currency = String(currencyQuery.data ?? '');

    const rows = useMemo(() => {
        const term = search.trim().toLowerCase();
        const filtered = (suppliersQuery.data ?? []).filter((supplier) => {
            if (tax !== 'ALL' && String(supplier.tax_registration_status ?? 'NOT_REGISTERED') !== tax) {
                return false;
            }
            const active = isSupplierActive(supplier);
            if (status === 'active' && !active) {
                return false;
            }
            if (status === 'inactive' && active) {
                return false;
            }
            if (!term) {
                return true;
            }
            return [supplier.name, supplier.name_en, supplier.phone, supplier.vat_number, supplier.category, supplier.id]
                .map((value) => String(value ?? '').toLowerCase())
                .some((value) => value.includes(term));
        });
        const sorted = [...filtered].sort((a, b) => compareSuppliers(a, b, sort.key));
        return sort.dir === 'asc' ? sorted : sorted.reverse();
    }, [suppliersQuery.data, search, tax, status, sort]);

    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const summary = summaryQuery.data;

    function toggleSort(key: SortKey) {
        setPage(1);
        setSort((previous) => (previous.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
    }

    function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
        if (sort.key !== key) {
            return 'none';
        }
        return sort.dir === 'asc' ? 'ascending' : 'descending';
    }

    function resetFilters() {
        setSearch('');
        setTax('ALL');
        setStatus('ALL');
        setSort({ key: 'dueTotal', dir: 'desc' });
        setPage(1);
    }

    /* ── الكتبات عبر useWriteMutation ────────────────────────────────── */

    const createSupplierMutation = useWriteMutation<SupplierCreateInput, { id: string | number }>({
        mutationFn: (input) => createSupplier(input).then((r) => ({ id: r.id })),
        successTitle: () => SUPPLIER_TEXT.createSuccess,
        invalidate: [
            ['procurement', 'suppliers'],
            ['procurement', 'summary'],
        ],
        silentError: true,
        onSuccess: () => {
            setFormOpen(false);
            setEditing(null);
        },
    });

    const updateSupplierMutation = useWriteMutation<{ id: string | number; input: SupplierUpdateInput }, { id: string | number }>({
        mutationFn: ({ id, input }) => updateSupplier(id, input).then((r) => ({ id: r.id })),
        successTitle: () => SUPPLIER_TEXT.updateSuccess,
        invalidate: [
            ['procurement', 'suppliers'],
            ['procurement', 'summary'],
        ],
        silentError: true,
        onSuccess: () => {
            setFormOpen(false);
            setEditing(null);
        },
    });

    const setSupplierActiveMutation = useWriteMutation<{ id: string | number; active: boolean }, { id: string | number; active: boolean }>({
        mutationFn: ({ id, active }) => setSupplierActive(id, active).then((r) => ({ id: r.id, active })),
        successTitle: ({ active }) => (active ? SUPPLIER_TEXT.activateSuccess : SUPPLIER_TEXT.deactivateSuccess),
        invalidate: [
            ['procurement', 'suppliers'],
            ['procurement', 'summary'],
        ],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    const deleteSupplierMutation = useWriteMutation<string | number, void>({
        mutationFn: (id) => deleteSupplier(id),
        successTitle: () => SUPPLIER_TEXT.deleteSuccess,
        invalidate: [
            ['procurement', 'suppliers'],
            ['procurement', 'summary'],
        ],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    async function openForm(row?: Supplier) {
        setEditing(row ?? null);
        setFormOpen(true);
    }

    async function handleChangeStatus(row: Supplier, activate: boolean) {
        setActionRow(row);
        setActionType(activate ? 'activate' : 'deactivate');
        setActionTitle(activate ? 'تفعيل المورد' : 'إيقاف المورد');
        setActionMessage(activate ? supplierActivateConfirm(row.name) : supplierDeactivateConfirm(row.name));
        setActionOpen(true);
    }

    async function handleDelete(row: Supplier) {
        setActionRow(row);
        setActionType('delete');
        setActionTitle('حذف المورد');
        setActionMessage(supplierDeleteConfirm(row.name));
        setActionOpen(true);
    }

    async function confirmAction() {
        if (!actionRow) return;
        if (actionType === 'activate') {
            await setSupplierActiveMutation.mutateAsync({ id: actionRow.id, active: true });
        } else if (actionType === 'deactivate') {
            await setSupplierActiveMutation.mutateAsync({ id: actionRow.id, active: false });
        } else if (actionType === 'delete') {
            await deleteSupplierMutation.mutateAsync(actionRow.id);
        }
    }

    return (
        <div className="erp-premium-screen flex flex-col gap-md">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        الموردون{' '}
                        <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted" dir="ltr" lang="en">
                            Suppliers
                        </span>
                    </h1>
                    <p className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                        دليل الموردين وملخص المشتريات — إضافة وتعديل وإيقاف وتفعيل وحذف. القراءة من `/api/procurement/suppliers`، والكتابة
                        لـ admin|manager|accountant والحذف للأدمن فقط.
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    {canWrite ? (
                        <Button type="button" size="sm" onClick={() => openForm()}>
                            إضافة مورد
                        </Button>
                    ) : null}
                    <PrintActions title="الموردون" />
                    <button
                        type="button"
                        onClick={() => {
                            void summaryQuery.refetch();
                            void suppliersQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                    label="موردون نشطون"
                    english="Active Suppliers"
                    value={summary ? `${formatInt(summary.activeSuppliers)} / ${formatInt(summary.totalSuppliers)}` : '—'}
                    hint="من دليل الموردين"
                />
                <Kpi
                    label="إجمالي المشتريات"
                    english="Purchases"
                    value={summary ? `${formatMoney(moneyOf(summary.purchasesTotal))} ${currency}`.trim() : '—'}
                    hint="مجموع فواتير الموردين المرتبطة"
                />
                <Kpi
                    label="إجمالي المدفوعات"
                    english="Payments"
                    value={summary ? `${formatMoney(moneyOf(summary.paymentsTotal))} ${currency}`.trim() : '—'}
                    hint="مجموع مدفوعات الموردين"
                />
                <Kpi
                    label="المستحق للموردين"
                    english="Amount Due"
                    value={summary ? `${formatMoney(moneyOf(summary.dueTotal))} ${currency}`.trim() : '—'}
                    hint={
                        summary && summary.unpaidInvoices > 0
                            ? `${formatInt(summary.unpaidInvoices)} فاتورة غير مدفوعة`
                            : 'الافتتاحي + المشتريات − المدفوعات'
                    }
                />
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label
                        className="flex min-w-56 flex-1 flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-procurement-search"
                    >
                        بحث
                        <input
                            id="erp-procurement-search"
                            type="search"
                            value={search}
                            placeholder="الاسم أو الهاتف أو الرقم الضريبي أو الفئة…"
                            onChange={(event) => {
                                setSearch(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-procurement-tax">
                        الحالة الضريبية
                        <select
                            id="erp-procurement-tax"
                            value={tax}
                            onChange={(event) => {
                                setTax(event.target.value as TaxFilter);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            <option value="ALL">كل الحالات</option>
                            <option value="REGISTERED">{TAX_STATUS_LABEL.REGISTERED}</option>
                            <option value="NOT_REGISTERED">{TAX_STATUS_LABEL.NOT_REGISTERED}</option>
                        </select>
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-procurement-status">
                        الحالة
                        <select
                            id="erp-procurement-status"
                            value={status}
                            onChange={(event) => {
                                setStatus(event.target.value as StatusFilter);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            <option value="ALL">الكل</option>
                            <option value="active">نشط</option>
                            <option value="inactive">موقوف</option>
                        </select>
                    </label>
                    <button
                        type="button"
                        onClick={resetFilters}
                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                    >
                        إعادة الضبط
                    </button>
                    <span className="text-body-sm text-muted">{formatInt(rows.length)} موردًا</span>
                </div>
            </Card>

            <Card>
                {suppliersQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل الموردين" />
                        <TableSkeleton rows={6} columns={8} />
                    </div>
                ) : null}

                {suppliersQuery.isError ? (
                    <StateError
                        message={suppliersQuery.error instanceof Error ? suppliersQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void suppliersQuery.refetch();
                        }}
                    />
                ) : null}

                {suppliersQuery.isSuccess && rows.length === 0 ? (
                    <StateEmpty title="لا موردون" hint="لا يوجد مورد مطابق للبحث أو المرشّحات — امسح البحث أو غيّر الحالة." />
                ) : null}

                {suppliersQuery.isSuccess && rows.length > 0 ? (
                    <>
                        <TableScroll label="جدول الموردين">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" aria-sort={ariaSort('name')} className="px-sm py-xs text-start font-medium">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    toggleSort('name');
                                                }}
                                            >
                                                المورد
                                            </button>
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الهاتف
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الفئة
                                        </th>
                                        <th scope="col" aria-sort={ariaSort('purchasesTotal')} className="px-sm py-xs text-end font-medium">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    toggleSort('purchasesTotal');
                                                }}
                                            >
                                                المشتريات
                                            </button>
                                        </th>
                                        <th scope="col" aria-sort={ariaSort('paymentsTotal')} className="px-sm py-xs text-end font-medium">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    toggleSort('paymentsTotal');
                                                }}
                                            >
                                                المدفوعات
                                            </button>
                                        </th>
                                        <th scope="col" aria-sort={ariaSort('dueTotal')} className="px-sm py-xs text-end font-medium">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    toggleSort('dueTotal');
                                                }}
                                            >
                                                المستحق
                                            </button>
                                        </th>
                                        <th
                                            scope="col"
                                            aria-sort={ariaSort('lastPurchaseDate')}
                                            className="px-sm py-xs text-center font-medium"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    toggleSort('lastPurchaseDate');
                                                }}
                                            >
                                                آخر شراء
                                            </button>
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الحالة
                                        </th>
                                        {(canWrite || canDelete) && (
                                            <th scope="col" className="px-sm py-xs text-start font-medium" data-erp-print-hide>
                                                إجراءات
                                            </th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((supplier) => (
                                        <tr key={supplier.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="px-sm py-xxs">
                                                <span className="block text-ink">{supplier.name}</span>
                                                {supplier.name_en || supplier.vat_number ? (
                                                    <span className="block text-caption text-muted" dir="ltr">
                                                        {supplier.vat_number ? `VAT ${supplier.vat_number}` : supplier.name_en}
                                                    </span>
                                                ) : null}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {supplier.phone || '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{supplier.category || '—'}</td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink">
                                                {formatMoney(moneyOf(supplier.purchasesTotal))}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink">
                                                {formatMoney(moneyOf(supplier.paymentsTotal))}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink">
                                                {formatMoney(moneyOf(supplier.dueTotal))}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-center text-body-sm text-muted">
                                                {supplier.lastPurchaseDate || '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm">
                                                {isSupplierActive(supplier) ? (
                                                    <span className="text-success-text">{supplierStatusLabel(supplier)}</span>
                                                ) : (
                                                    <span className="text-muted">{supplierStatusLabel(supplier)}</span>
                                                )}
                                            </td>
                                            {(canWrite || canDelete) && (
                                                <td className="px-sm py-xxs" data-erp-print-hide>
                                                    <div className="flex flex-wrap items-center gap-xs">
                                                        {canWrite ? (
                                                            <>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="secondary"
                                                                    title="تعديل المورد"
                                                                    onClick={() => openForm(supplier)}
                                                                >
                                                                    تعديل
                                                                </Button>
                                                                {isSupplierActive(supplier) ? (
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant="secondary"
                                                                        title="إيقاف المورد"
                                                                        onClick={() => handleChangeStatus(supplier, false)}
                                                                    >
                                                                        إيقاف
                                                                    </Button>
                                                                ) : (
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant="secondary"
                                                                        title="تفعيل المورد"
                                                                        onClick={() => handleChangeStatus(supplier, true)}
                                                                    >
                                                                        تفعيل
                                                                    </Button>
                                                                )}
                                                            </>
                                                        ) : null}
                                                        {canDelete ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="danger"
                                                                title="حذف المورد"
                                                                onClick={() => handleDelete(supplier)}
                                                            >
                                                                حذف
                                                            </Button>
                                                        ) : null}
                                                    </div>
                                                </td>
                                            )}
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
            <SupplierFormDialog
                open={formOpen}
                onClose={() => setFormOpen(false)}
                pending={createSupplierMutation.isPending || updateSupplierMutation.isPending}
                editing={editing}
                onSave={async (input, isEditing) => {
                    if (isEditing && editing) {
                        await updateSupplierMutation.mutateAsync({ id: editing.id, input: input as SupplierUpdateInput });
                    } else {
                        await createSupplierMutation.mutateAsync(input as SupplierCreateInput);
                    }
                }}
            />
            <SupplierActionDialog
                open={actionOpen}
                title={actionTitle}
                message={actionMessage}
                onConfirm={confirmAction}
                onClose={() => {
                    setActionOpen(false);
                    setActionRow(null);
                }}
                pending={setSupplierActiveMutation.isPending || deleteSupplierMutation.isPending}
                confirmLabel={actionType === 'activate' ? 'تفعيل' : actionType === 'deactivate' ? 'إيقاف' : 'حذف'}
                variant={actionType === 'delete' ? 'danger' : 'secondary'}
            />
        </div>
    );
}
