import './Payments.premium.css';
import { toCents } from '@karim/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import {
    Card,
    StateEmpty,
    StateError,
    StateLoading,
    TableScroll,
    TableSkeleton,
} from '../components/TableState';
import { fetchCurrency, riyadhToday } from '../lib/finance';
import { formatMoney } from '../lib/format';
import { useAuthState } from '../lib/auth';
import {
    fetchSupplierPayments,
    fetchSuppliers,
    moneyOf,
    PAYMENTS_WINDOW_DAYS,
    type Payment,
    paymentMethodLabel,
    riyadhDaysAgo,
    sumMoney,
} from '../lib/procurement';
import {
    createPayment,
    deletePayment,
    updatePayment,
    paymentDeleteConfirm,
    PAYMENT_TEXT,
    type PaymentCreateInput,
    type PaymentUpdateInput,
    paymentWriteVisible,
    paymentDeleteVisible,
} from '../lib/payments-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

/**
 * مدفوعات الموردين — CRUD كامل مثل V2:
 *  • إنشاء دفعة (POST /api/payments — admin|manager|accountant)
 *  • تعديل دفعة (PATCH /api/payments/:id — admin|manager|accountant)
 *  • حذف دفعة (DELETE /api/payments/:id — أدمن فقط)
 *  • طباعة القائمة (PrintActions)
 *
 * القراءة من `/api/procurement/payments`، والفترة والمورد يُصفّيان في SQL عند
 * الخادم كما في القديم.
 */

const PAGE_SIZE = 20;
const SERVER_CAP = 500;

type SortKey = 'date' | 'supplierName' | 'amount' | 'method';

function formatInt(value: number): string {
    return value.toLocaleString('en-US');
}

function supplierOf(payment: Payment): string {
    if (payment.supplierName) {
        return payment.supplierName;
    }
    return payment.supplierId ? `#${payment.supplierId}` : '—';
}

function compare(a: Payment, b: Payment, key: SortKey): number {
    if (key === 'amount') {
        const left = toCents(moneyOf(a.amount));
        const right = toCents(moneyOf(b.amount));
        return left === right ? 0 : left > right ? 1 : -1;
    }
    if (key === 'supplierName') {
        return supplierOf(a).localeCompare(supplierOf(b), 'ar');
    }
    if (key === 'method') {
        return paymentMethodLabel(a.method).localeCompare(paymentMethodLabel(b.method), 'ar');
    }
    return a.date.localeCompare(b.date);
}

const PAYMENT_METHOD_OPTIONS = [
    { value: 'cash', label: 'نقدي' },
    { value: 'bank', label: 'تحويل بنكي' },
    { value: 'check', label: 'شيك' },
    { value: 'wallet', label: 'محفظة إلكترونية' },
    { value: 'other', label: 'أخرى' },
] as const;

/* ── نموذج إضافة/تعديل دفعة ───────────────────────────────────────────── */

interface PaymentFormDialogProps {
    open: boolean;
    onClose: () => void;
    pending: boolean;
    editing: Payment | null;
    suppliers: { id: string | number; name: string }[];
    onSave: (payload: PaymentCreateInput | PaymentUpdateInput, isEditing: boolean) => Promise<void>;
}

const PAYMENT_FORM_ID = 'erp-payments-form';

function PaymentFormDialog({ open, onClose, pending, editing, suppliers, onSave }: PaymentFormDialogProps) {
    const [form, setForm] = useState<{
        invoiceNo: string;
        amount: string;
        paymentDate: string;
        method: string;
        supplierId: string | number | '';
        notes: string;
    }>({
        invoiceNo: '',
        amount: '',
        paymentDate: '',
        method: '',
        supplierId: '',
        notes: '',
    });
    const [formError, setFormError] = useState('');

    useEffect(() => {
        if (!open) {
            return;
        }
        if (editing) {
            setForm({
                invoiceNo: editing.invoiceId != null ? String(editing.invoiceId) : '',
                amount: String(moneyOf(editing.amount)),
                paymentDate: String(editing.date ?? ''),
                method: String(editing.method ?? ''),
                supplierId: String(editing.supplierId ?? ''),
                notes: String(editing.notes ?? ''),
            });
        } else {
            setForm({ invoiceNo: '', amount: '', paymentDate: '', method: '', supplierId: '', notes: '' });
        }
        setFormError('');
    }, [open, editing]);

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setFormError('');
        if (!form.invoiceNo.trim()) {
            setFormError(PAYMENT_TEXT.invoiceRequired);
            return;
        }
        const amount = Number(form.amount);
        if (!form.amount.trim() || !Number.isFinite(amount) || amount <= 0) {
            setFormError(PAYMENT_TEXT.amountInvalid);
            return;
        }
        if (!form.paymentDate) {
            setFormError(PAYMENT_TEXT.dateRequired);
            return;
        }
        if (!form.method.trim()) {
            setFormError(PAYMENT_TEXT.methodRequired);
            return;
        }

        const input: PaymentCreateInput | PaymentUpdateInput = {
            invoiceNo: form.invoiceNo.trim(),
            amount,
            paymentDate: form.paymentDate,
            method: form.method.trim(),
            notes: form.notes.trim() || null,
        };

        try {
            await onSave(input, Boolean(editing));
            onClose();
        } catch (cause) {
            setFormError(writeErrorMessage(cause, editing ? PAYMENT_TEXT.updateFailed : PAYMENT_TEXT.createFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={editing ? 'تعديل دفعة مورد' : 'دفعة مورد جديدة'}
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {PAYMENT_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={PAYMENT_FORM_ID} size="sm" loading={pending}>
                        {editing ? 'حفظ التعديل' : 'تسجيل الدفعة'}
                    </Button>
                </>
            }
        >
            <form id={PAYMENT_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <div className="grid gap-sm sm:grid-cols-2">
                    <Input
                        label="رقم الفاتورة"
                        name="invoiceNo"
                        value={form.invoiceNo}
                        onChange={(e) => setForm((prev) => ({ ...prev, invoiceNo: e.target.value }))}
                        placeholder="INV-2026-001"
                        required
                    />
                    <Input
                        label="المبلغ"
                        name="amount"
                        type="number"
                        min={0}
                        step={0.01}
                        value={form.amount}
                        onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                        placeholder="0.00"
                        required
                    />
                    <Select
                        label="طريقة الدفع"
                        name="method"
                        value={form.method}
                        onValueChange={(value) => setForm((prev) => ({ ...prev, method: String(value ?? '') }))}
                        options={PAYMENT_METHOD_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
                        required
                    />
                    <Select
                        label="المورد"
                        name="supplierId"
                        value={String(form.supplierId ?? '')}
                        onValueChange={(value) => setForm((prev) => ({ ...prev, supplierId: value ?? '' }))}
                        options={suppliers.map((s) => ({ label: s.name, value: String(s.id) }))}
                    />
                    <Input
                        label="تاريخ الدفع"
                        name="paymentDate"
                        type="date"
                        value={form.paymentDate}
                        onChange={(e) => setForm((prev) => ({ ...prev, paymentDate: e.target.value }))}
                        required
                    />
                    <Input
                        label="ملاحظات (اختياري)"
                        name="notes"
                        value={form.notes}
                        onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                        placeholder="ملاحظات الدفعة…"
                    />
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

/* ── نموذج تأكيد الحذف ───────────────────────────────────────────────── */

interface PaymentActionDialogProps {
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onClose: () => void;
    pending: boolean;
    confirmLabel: string;
}

function PaymentActionDialog({
    open,
    title,
    message,
    onConfirm,
    onClose,
    pending,
    confirmLabel,
}: PaymentActionDialogProps) {
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
                    {PAYMENT_TEXT.cancel}
                </Button>
                <Button type="button" size="sm" variant="danger" loading={pending} onClick={onConfirm}>
                    {confirmLabel}
                </Button>
            </div>
        </Dialog>
    );
}

/* ── الشاشة ───────────────────────────────────────────────────────────── */

export function Payments() {
    const auth = useAuthState();
    const canWrite = paymentWriteVisible(auth.user?.role);
    const canDelete = paymentDeleteVisible(auth.user?.role);

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Payment | null>(null);
    const [actionOpen, setActionOpen] = useState(false);
    const [actionRow, setActionRow] = useState<Payment | null>(null);
    const [actionMessage, setActionMessage] = useState('');

    const [supplierId, setSupplierId] = useState('');
    const [from, setFrom] = useState(riyadhDaysAgo(PAYMENTS_WINDOW_DAYS));
    const [to, setTo] = useState(riyadhToday());
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
    const [page, setPage] = useState(1);

    const rangeInvalid = Boolean(from && to && from > to);

    const paymentsQuery = useQuery({
        queryKey: ['procurement', 'payments', supplierId, from, to],
        queryFn: ({ signal }) => fetchSupplierPayments({ supplierId, from, to }, signal),
        enabled: !rangeInvalid,
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
    const payments = paymentsQuery.data ?? [];

    const rows = useMemo(() => {
        const sorted = [...payments].sort((a, b) => compare(a, b, sort.key));
        return sort.dir === 'asc' ? sorted : sorted.reverse();
    }, [payments, sort]);

    const total = sumMoney(rows.map((payment) => payment.amount));
    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    function toggleSort(key: SortKey) {
        setPage(1);
        setSort((previous) =>
            previous.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
        );
    }

    function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
        if (sort.key !== key) {
            return 'none';
        }
        return sort.dir === 'asc' ? 'ascending' : 'descending';
    }

    function resetFilters() {
        setSupplierId('');
        setFrom(riyadhDaysAgo(PAYMENTS_WINDOW_DAYS));
        setTo(riyadhToday());
        setSort({ key: 'date', dir: 'desc' });
        setPage(1);
    }

    /* ── الكتبات عبر useWriteMutation ────────────────────────────────── */

    const createPaymentMutation = useWriteMutation<PaymentCreateInput, { id: string | number }>({
        mutationFn: (input) => createPayment(input).then((r) => ({ id: r.id })),
        successTitle: () => PAYMENT_TEXT.createSuccess,
        invalidate: [['procurement', 'payments']],
        silentError: true,
        onSuccess: () => {
            setFormOpen(false);
            setEditing(null);
        },
    });

    const updatePaymentMutation = useWriteMutation<{ id: string | number; input: PaymentUpdateInput }, { id: string | number }>({
        mutationFn: ({ id, input }) => updatePayment(id, input).then((r) => ({ id: r.id })),
        successTitle: () => PAYMENT_TEXT.updateSuccess,
        invalidate: [['procurement', 'payments']],
        silentError: true,
        onSuccess: () => {
            setFormOpen(false);
            setEditing(null);
        },
    });

    const deletePaymentMutation = useWriteMutation<string | number, void>({
        mutationFn: (id) => deletePayment(id),
        successTitle: () => PAYMENT_TEXT.deleteSuccess,
        invalidate: [['procurement', 'payments']],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    async function openForm(row?: Payment) {
        setEditing(row ?? null);
        setFormOpen(true);
    }

    async function handleDelete(row: Payment) {
        setActionRow(row);
        const ref = row.invoiceId ? `#${row.invoiceId}` : (row.supplierName ?? row.id);
        setActionMessage(paymentDeleteConfirm(String(ref)));
        setActionOpen(true);
    }

    async function confirmAction() {
        if (!actionRow) return;
        await deletePaymentMutation.mutateAsync(actionRow.id);
    }

    return (
        <div className="erp-premium-screen flex flex-col gap-md">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        مدفوعات الموردين{' '}
                        <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted" dir="ltr" lang="en">
                            Supplier Payments
                        </span>
                    </h1>
                    <p className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                        دفعات الموردين في الفترة المختارة — تسجيل وتعديل وحذف.
                        القراءة من `/api/procurement/payments`، والكتابة لـ admin|manager|accountant والحذف للأدمن فقط.
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    {canWrite ? (
                        <Button type="button" size="sm" onClick={() => openForm()}>
                            تسجيل دفعة
                        </Button>
                    ) : null}
                    <PrintActions title="مدفوعات الموردين" />
                    <button
                        type="button"
                        onClick={() => {
                            void paymentsQuery.refetch();
                            void suppliersQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label
                        className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-payments-supplier"
                    >
                        المورد
                        <select
                            id="erp-payments-supplier"
                            value={supplierId}
                            onChange={(event) => {
                                setSupplierId(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 min-w-48 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            <option value="">كل الموردين</option>
                            {(suppliersQuery.data ?? []).map((supplier) => (
                                <option key={String(supplier.id)} value={String(supplier.id)}>
                                    {supplier.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label
                        className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-payments-from"
                    >
                        من
                        <input
                            id="erp-payments-from"
                            type="date"
                            value={from}
                            max={to || undefined}
                            onChange={(event) => {
                                setFrom(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                            dir="ltr"
                        />
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-payments-to">
                        إلى
                        <input
                            id="erp-payments-to"
                            type="date"
                            value={to}
                            min={from || undefined}
                            max={riyadhToday()}
                            onChange={(event) => {
                                setTo(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                            dir="ltr"
                        />
                    </label>
                    <button
                        type="button"
                        onClick={resetFilters}
                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                    >
                        إعادة الضبط
                    </button>
                    <span className="text-body-sm text-muted">{formatInt(rows.length)} دفعة</span>
                </div>
                {rangeInvalid ? (
                    <p className="mt-xs text-body-sm text-danger-text" role="alert">
                        بداية الفترة بعد نهايتها — صحّح التاريخين قبل العرض.
                    </p>
                ) : null}
            </Card>

            <Card className="flex flex-wrap items-baseline justify-between gap-sm p-md">
                <span className="text-body-sm text-muted">إجمالي المعروض</span>
                <span className="erp-numeric text-heading-lg text-ink">
                    {formatMoney(total)}
                    {currency ? <span className="ms-xs text-body-sm text-muted">{currency}</span> : null}
                </span>
                <span className="text-body-sm text-muted">{formatInt(rows.length)} دفعة</span>
            </Card>

            <Card>
                {paymentsQuery.isPending && !rangeInvalid ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل المدفوعات" />
                        <TableSkeleton rows={6} columns={7} />
                    </div>
                ) : null}

                {paymentsQuery.isError ? (
                    <StateError
                        message={paymentsQuery.error instanceof Error ? paymentsQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void paymentsQuery.refetch();
                        }}
                    />
                ) : null}

                {paymentsQuery.isSuccess && rows.length === 0 ? (
                    <StateEmpty title="لا توجد دفعات في الفترة المحددة" hint="وسّع المدة أو غيّر المورد." />
                ) : null}

                {paymentsQuery.isSuccess && rows.length >= SERVER_CAP ? (
                    <p className="border-b border-hairline px-sm py-xs text-body-sm text-muted" role="status">
                        الخادم يعيد حتى {formatInt(SERVER_CAP)} دفعة — ضيّق الفترة أو اختر موردًا لرؤية الباقي.
                    </p>
                ) : null}

                {paymentsQuery.isSuccess && rows.length > 0 ? (
                    <>
                        <TableScroll label="جدول مدفوعات الموردين">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th
                                            scope="col"
                                            aria-sort={ariaSort('date')}
                                            className="px-sm py-xs text-center font-medium"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    toggleSort('date');
                                                }}
                                            >
                                                التاريخ
                                            </button>
                                        </th>
                                        <th
                                            scope="col"
                                            aria-sort={ariaSort('supplierName')}
                                            className="px-sm py-xs text-start font-medium"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    toggleSort('supplierName');
                                                }}
                                            >
                                                المورد
                                            </button>
                                        </th>
                                        <th
                                            scope="col"
                                            aria-sort={ariaSort('amount')}
                                            className="px-sm py-xs text-end font-medium"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    toggleSort('amount');
                                                }}
                                            >
                                                المبلغ
                                            </button>
                                        </th>
                                        <th
                                            scope="col"
                                            aria-sort={ariaSort('method')}
                                            className="px-sm py-xs text-start font-medium"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    toggleSort('method');
                                                }}
                                            >
                                                الطريقة
                                            </button>
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الفاتورة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الملاحظات
                                        </th>
                                        {(canWrite || canDelete) && (
                                            <th scope="col" className="px-sm py-xs text-start font-medium" data-erp-print-hide>
                                                إجراءات
                                            </th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((payment) => (
                                        <tr key={payment.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {payment.date}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm">
                                                {supplierOf(payment)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {formatMoney(moneyOf(payment.amount))}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">
                                                {paymentMethodLabel(payment.method)}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {payment.invoiceId ? `#${payment.invoiceId}` : '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">
                                                {String(payment.notes ?? '—')}
                                            </td>
                                            {(canWrite || canDelete) && (
                                                <td className="px-sm py-xxs" data-erp-print-hide>
                                                    <div className="flex flex-wrap items-center gap-xs">
                                                        {canWrite ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="secondary"
                                                                title="تعديل الدفعة"
                                                                onClick={() => openForm(payment)}
                                                            >
                                                                تعديل
                                                            </Button>
                                                        ) : null}
                                                        {canDelete ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="danger"
                                                                title="حذف الدفعة"
                                                                onClick={() => handleDelete(payment)}
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
                            <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
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
            <PaymentFormDialog
                open={formOpen}
                onClose={() => setFormOpen(false)}
                pending={createPaymentMutation.isPending || updatePaymentMutation.isPending}
                editing={editing}
                suppliers={suppliersQuery.data ?? []}
                onSave={async (input, isEditing) => {
                    if (isEditing && editing) {
                        await updatePaymentMutation.mutateAsync({ id: editing.id, input: input as PaymentUpdateInput });
                    } else {
                        await createPaymentMutation.mutateAsync(input as PaymentCreateInput);
                    }
                }}
            />
            <PaymentActionDialog
                open={actionOpen}
                title="حذف الدفعة"
                message={actionMessage}
                onConfirm={confirmAction}
                onClose={() => {
                    setActionOpen(false);
                    setActionRow(null);
                }}
                pending={deletePaymentMutation.isPending}
                confirmLabel="حذف"
            />
        </div>
    );
}
