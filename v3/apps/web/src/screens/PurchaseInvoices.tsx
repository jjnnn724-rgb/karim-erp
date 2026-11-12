import './PurchaseInvoices.premium.css';
import { toCents } from '@karim/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { fetchCurrency, firstOfMonth, riyadhToday } from '../lib/finance';
import { formatMoney } from '../lib/format';
import { fetchSuppliers, isSupplierActive, riyadhDaysAgo, type Supplier } from '../lib/procurement';
import {
    fetchPurchaseInvoices,
    invoiceToRow,
    invoiceTotals,
    MAX_PAGES,
    type PurchaseInvoiceRow,
    PAGE_SIZE as SERVER_PAGE_SIZE,
    supplierNameMap,
} from '../lib/purchase-invoices';
import {
    type ClearAllResult,
    clearAllConfirm,
    clearAllPurchaseInvoices,
    clearAllSuccess,
    createPurchaseInvoice,
    DISCOUNT_TYPE_OPTIONS,
    emptyInvoiceForm,
    emptyInvoiceItem,
    INVOICE_PAYMENT_METHOD_OPTIONS,
    INVOICE_TEXT,
    type InvoiceForm,
    type InvoiceItemInput,
    invoiceCreateVisible,
    invoiceEstimate,
    invoiceFormFromRow,
    invoiceNumberFallback,
    invoicePaymentVisible,
    invoiceSaveError,
    invoiceVoidVisible,
    isDuplicateInvoiceError,
    isVoidPaymentError,
    moneyWithUnit,
    PAID_ITEMS_ONLY_NOTICE,
    PARTIAL_PAYMENT_METHOD_OPTIONS,
    partialPaymentError,
    payFullConfirm,
    payFullSuccess,
    payInvoiceFull,
    payInvoicePartial,
    payPartialConfirm,
    payPartialSuccess,
    TAX_CATEGORIES,
    TAX_LABELS,
    UNIT_OPTIONS,
    updatePurchaseInvoice,
    type VoidInvoiceResult,
    voidConfirm,
    voidPurchaseInvoice,
    voidSuccess,
} from '../lib/purchase-invoices-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Dialog } from '../ui/Dialog';
import { useToast } from '../ui/Toast';

/**
 * فواتير الشراء — شاشة 08 بحسب سجل الترحيل: سؤال «ما جاء هذا الشهر؟»
 * (فترة افتراضية آخر 30 يومًا، وفلترة العميل بحقلَي from/to)، والكتابة
 * منقولة من V2 حرفيًّا (screens/wh-invoices.js وscreens/invoices.js):
 *
 *  • إنشاء/تعديل فاتورة بنموذج بنود كامل (invoice-editor.js) — الأدوار
 *    admin|manager|warehouse، مع تجميد الترويسة على الفاتورة المدفوعة.
 *  • إلغاء void + حذف الكل — admin فقط، حذف الكل بتأكيد مزدوج (مربع تأكيد
 *    ثم نافذة تأكيد) كما في screens/invoices.js:254-311.
 *  • تسديد كامل وتسديد جزئي — admin|manager|accountant كما V2.
 *
 * كل نص هنا منقول من V2؛ الخادم يبقى الحاكم في الأدوار والأرصدة.
 */

const PAGE_SIZE = 20;

type SortKey = 'number' | 'supplier' | 'date' | 'total' | 'paid' | 'remaining' | 'method' | 'status';

/** صفّ الخام كما يعود من `/api/purchaseInvoices` (فيه items للمحرر). */
type InvoiceRaw = Record<string, unknown>;

const STATUS_TONE: Record<string, string> = {
    paid: 'text-success-text',
    partial: 'text-ink-secondary',
    unpaid: 'text-danger-text',
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

function compare(a: PurchaseInvoiceRow, b: PurchaseInvoiceRow, key: SortKey): number {
    if (key === 'total' || key === 'paid' || key === 'remaining') {
        const left = toCents(a[key]);
        const right = toCents(b[key]);
        return left === right ? 0 : left > right ? 1 : -1;
    }
    if (key === 'date') {
        return a.date.localeCompare(b.date);
    }
    if (key === 'number') {
        return a.number.localeCompare(b.number, 'ar', { numeric: true });
    }
    if (key === 'supplier') {
        return a.supplier.localeCompare(b.supplier, 'ar');
    }
    if (key === 'method') {
        return a.methodLabel.localeCompare(b.methodLabel, 'ar');
    }
    return a.statusLabel.localeCompare(b.statusLabel, 'ar');
}

const fieldClass = 'h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink disabled:opacity-60';
const labelClass = 'flex flex-col gap-xxs text-label-md text-ink-secondary';

/** بند نموذج بمعرّف عرض ثابت (لا يُرسل للخادم) حتى لا يتغيّر مفتاح React. */
interface InvoiceItemDraft extends InvoiceItemInput {
    draftKey: number;
}

interface InvoiceFormDialogProps {
    open: boolean;
    editing: InvoiceRaw | null;
    suppliers: readonly Supplier[];
    currency: string;
    saving: boolean;
    onClose: () => void;
    onSave: (form: InvoiceForm) => void;
}

/**
 * محرر الفاتورة — نفس حقول وترتيب `invoice-editor.js`:
 * ترويسة (رقم/تاريخ/مورد/هاتف)، بنود (صنف/كمية/وحدة/وزن/صلاحية/سعر/فئة
 * ضريبية)، خصم، طريقة دفع، مسدد، ملاحظات. الفاتورة المدفوعة تُقفل ترويستها
 * ويبقى الأصناف فقط قابلة للتعديل — قرار المالك 2026-10-31.
 */
function InvoiceFormDialog({ open, editing, suppliers, currency, saving, onClose, onSave }: InvoiceFormDialogProps) {
    const [form, setForm] = useState<InvoiceForm>(() => emptyInvoiceForm(riyadhToday()));
    const [items, setItems] = useState<InvoiceItemDraft[]>([]);
    const [paidTouched, setPaidTouched] = useState(false);
    const [error, setError] = useState('');
    const formRef = useRef<HTMLFormElement>(null);
    const nextDraftKey = useRef(1);

    function draftOf(item: InvoiceItemInput): InvoiceItemDraft {
        const draft: InvoiceItemDraft = { ...item, draftKey: nextDraftKey.current };
        nextDraftKey.current += 1;
        return draft;
    }

    const paidLock = Boolean(editing && Number(editing.paidAmount ?? 0) > 0);
    const editingId = editing ? String(editing.id ?? '') : '';

    useEffect(() => {
        if (!open) {
            return;
        }
        if (editing) {
            const model = invoiceFormFromRow(editing);
            setForm(model);
            setItems(
                (model.items ?? []).map((item) => {
                    const draft: InvoiceItemDraft = { ...item, draftKey: nextDraftKey.current };
                    nextDraftKey.current += 1;
                    return draft;
                }),
            );
            // V2: paidTouched = editing
            setPaidTouched(true);
        } else {
            const model = emptyInvoiceForm(riyadhToday());
            setForm(model);
            setItems([]);
            setPaidTouched(false);
        }
        setError('');
    }, [editing, open]);

    const selectedSupplier = form.supplierId ? suppliers.find((supplier) => String(supplier.id) === String(form.supplierId)) : undefined;
    const registered = String(selectedSupplier?.tax_registration_status ?? '').toUpperCase() === 'REGISTERED';
    const estimate = invoiceEstimate({ ...form, items }, registered);
    // V2 يعبّئ المسدد تلقائيًا ما لم يلمسه المشغّل: نقدي/بنكي = الإجمالي، آجل = 0.
    const paidValue = paidTouched ? String(form.paidAmount ?? '') : form.paymentMethod === 'credit' ? '0' : estimate.grand.toFixed(2);
    const supplierOptions = suppliers.filter(
        (supplier) => isSupplierActive(supplier) || String(supplier.id) === String(form.supplierId ?? ''),
    );

    function update(patch: Partial<InvoiceForm>): void {
        setForm((previous) => ({ ...previous, ...patch }));
    }

    function updateItem(index: number, patch: Partial<InvoiceItemInput>): void {
        setItems((previous) => previous.map((item, position) => (position === index ? { ...item, ...patch } : item)));
    }

    function addItem(): void {
        const draft = draftOf(emptyInvoiceItem());
        setItems((previous) => [...previous, draft]);
    }

    function removeItem(index: number): void {
        setItems((previous) => previous.filter((_item, position) => position !== index));
    }

    function submit(event: React.FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        const model: InvoiceForm = {
            ...form,
            items,
            paidTouched,
            paidAmount: paidValue,
            invoiceNumber: String(form.invoiceNumber ?? '').trim() || invoiceNumberFallback(),
        };
        const message = invoiceSaveError(model);
        if (message) {
            setError(message);
            const firstItem = formRef.current?.querySelector<HTMLInputElement>('[data-invoice-item-name]');
            firstItem?.focus();
            return;
        }
        setError('');
        onSave(model);
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title={INVOICE_TEXT.dialogTitle}
            size="lg"
            footer={
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        {INVOICE_TEXT.cancel}
                    </button>
                    <button
                        type="submit"
                        form="erp-invoice-form"
                        disabled={saving}
                        className="rounded-md border border-primary-active/40 bg-primary-active px-md py-xs text-button-md text-on-primary disabled:opacity-50"
                    >
                        {editingId ? INVOICE_TEXT.saveEdit : INVOICE_TEXT.saveNew}
                    </button>
                </>
            }
        >
            <form id="erp-invoice-form" ref={formRef} onSubmit={submit} className="flex flex-col gap-md">
                {paidLock ? (
                    <p className="rounded-md border border-hairline-strong bg-surface-sunken px-sm py-xs text-body-sm font-semibold text-ink-secondary">
                        ⚠ {PAID_ITEMS_ONLY_NOTICE}
                    </p>
                ) : null}

                <div className="grid gap-sm sm:grid-cols-2">
                    <label className={labelClass}>
                        رقم الفاتورة
                        <input
                            name="invoiceNumber"
                            value={String(form.invoiceNumber ?? '')}
                            placeholder="INV-001"
                            disabled={paidLock}
                            onChange={(event) => {
                                update({ invoiceNumber: event.target.value });
                            }}
                            className={fieldClass}
                        />
                    </label>
                    <label className={labelClass}>
                        تاريخ الفاتورة
                        <input
                            name="date"
                            type="date"
                            value={String(form.date ?? '')}
                            disabled={paidLock}
                            onChange={(event) => {
                                update({ date: event.target.value });
                            }}
                            className={fieldClass}
                            dir="ltr"
                        />
                    </label>
                </div>

                <div className="grid gap-sm sm:grid-cols-2">
                    <label className={labelClass}>
                        المورد (اختياري — يربط الفاتورة بالحساب)
                        <select
                            name="supplierId"
                            value={String(form.supplierId ?? '')}
                            disabled={paidLock}
                            onChange={(event) => {
                                update({ supplierId: event.target.value });
                            }}
                            className={fieldClass}
                        >
                            <option value="">بدون ربط (اسم حر)</option>
                            {supplierOptions.map((supplier) => (
                                <option key={supplier.id} value={supplier.id}>
                                    {supplier.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    {form.supplierId ? null : (
                        <label className={labelClass}>
                            اسم المورد
                            <input
                                name="supplierName"
                                value={String(form.supplierName ?? '')}
                                disabled={paidLock}
                                onChange={(event) => {
                                    update({ supplierName: event.target.value });
                                }}
                                className={fieldClass}
                            />
                        </label>
                    )}
                    {form.supplierId ? null : (
                        <label className={labelClass}>
                            رقم الهاتف
                            <input
                                name="supplierPhone"
                                value={String(form.supplierPhone ?? '')}
                                disabled={paidLock}
                                onChange={(event) => {
                                    update({ supplierPhone: event.target.value });
                                }}
                                className={fieldClass}
                                dir="ltr"
                            />
                        </label>
                    )}
                </div>

                <section className="flex flex-col gap-sm rounded-md border border-hairline p-sm">
                    <div className="flex items-center justify-between gap-sm">
                        <strong className="text-label-md text-ink">الأصناف</strong>
                        <span className="text-caption text-muted">الوحدة مرنة — الوزن والصلاحية اختياريان</span>
                    </div>
                    {items.length === 0 ? <p className="text-body-sm text-muted">{INVOICE_TEXT.itemsEmpty}</p> : null}
                    {items.map((item, index) => {
                        const lineTotal = (Number(item.qty) || 0) * (Number(item.price) || 0);
                        return (
                            <div
                                key={item.draftKey}
                                className="grid gap-xs rounded-md border border-hairline p-xs sm:grid-cols-2 xl:grid-cols-4"
                            >
                                <label className={labelClass}>
                                    الصنف
                                    <input
                                        name={`itemName-${index}`}
                                        data-invoice-item-name=""
                                        value={String(item.itemName ?? '')}
                                        onChange={(event) => {
                                            updateItem(index, { itemName: event.target.value });
                                        }}
                                        className={fieldClass}
                                    />
                                </label>
                                <label className={labelClass}>
                                    الكمية
                                    <input
                                        name={`qty-${index}`}
                                        type="number"
                                        min={0}
                                        step="0.001"
                                        value={String(item.qty ?? '')}
                                        onChange={(event) => {
                                            updateItem(index, { qty: event.target.value });
                                        }}
                                        className={fieldClass}
                                        dir="ltr"
                                    />
                                </label>
                                <label className={labelClass}>
                                    الوحدة
                                    <input
                                        name={`unit-${index}`}
                                        list="erp-invoice-units"
                                        value={String(item.unit ?? '')}
                                        onChange={(event) => {
                                            updateItem(index, { unit: event.target.value });
                                        }}
                                        className={fieldClass}
                                    />
                                </label>
                                <label className={labelClass}>
                                    الوزن (كجم)
                                    <input
                                        name={`weight-${index}`}
                                        type="number"
                                        min={0}
                                        step="0.001"
                                        value={String(item.weight ?? '')}
                                        onChange={(event) => {
                                            updateItem(index, { weight: event.target.value });
                                        }}
                                        className={fieldClass}
                                        dir="ltr"
                                    />
                                </label>
                                <label className={labelClass}>
                                    تاريخ الصلاحية
                                    <input
                                        name={`expiryDate-${index}`}
                                        type="date"
                                        value={String(item.expiryDate ?? '')}
                                        onChange={(event) => {
                                            updateItem(index, { expiryDate: event.target.value });
                                        }}
                                        className={fieldClass}
                                        dir="ltr"
                                    />
                                </label>
                                <label className={labelClass}>
                                    سعر الوحدة
                                    <input
                                        name={`price-${index}`}
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={String(item.price ?? '')}
                                        onChange={(event) => {
                                            updateItem(index, { price: event.target.value });
                                        }}
                                        className={fieldClass}
                                        dir="ltr"
                                    />
                                </label>
                                <label className={labelClass}>
                                    الفئة الضريبية
                                    <select
                                        name={`taxCategory-${index}`}
                                        value={String(item.taxCategory ?? 'STANDARD')}
                                        onChange={(event) => {
                                            updateItem(index, { taxCategory: event.target.value });
                                        }}
                                        className={fieldClass}
                                    >
                                        {TAX_CATEGORIES.map((category) => (
                                            <option key={category} value={category}>
                                                {TAX_LABELS[category]}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <div className="flex items-end justify-between gap-xs">
                                    <span className="text-body-sm text-muted">
                                        الإجمالي{' '}
                                        <span className="erp-numeric text-ink" dir="ltr">
                                            {formatMoney(lineTotal.toFixed(2))}
                                        </span>
                                    </span>
                                    <button
                                        type="button"
                                        aria-label={`حذف الصنف ${index + 1}`}
                                        onClick={() => {
                                            removeItem(index);
                                        }}
                                        className="rounded-md border border-danger/50 px-sm py-xxs text-body-sm text-danger-text hover:bg-danger-soft"
                                    >
                                        {INVOICE_TEXT.voidAction}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    <datalist id="erp-invoice-units">
                        {UNIT_OPTIONS.map((unit) => (
                            <option key={unit} value={unit} />
                        ))}
                    </datalist>
                    <div>
                        <button
                            type="button"
                            onClick={addItem}
                            className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                        >
                            {INVOICE_TEXT.addItem}
                        </button>
                    </div>
                </section>

                <div className="grid gap-sm sm:grid-cols-3">
                    <label className={labelClass}>
                        خصم الفاتورة
                        <select
                            name="discountType"
                            value={String(form.discountType ?? 'none')}
                            disabled={paidLock}
                            onChange={(event) => {
                                update({ discountType: event.target.value });
                            }}
                            className={fieldClass}
                        >
                            {DISCOUNT_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className={labelClass}>
                        قيمة الخصم
                        <input
                            name="discountValue"
                            type="number"
                            min={0}
                            step="0.01"
                            value={String(form.discountValue ?? 0)}
                            disabled={paidLock}
                            onChange={(event) => {
                                update({ discountValue: event.target.value });
                            }}
                            className={fieldClass}
                            dir="ltr"
                        />
                    </label>
                    <label className={labelClass}>
                        إجمالي الفاتورة (محسوب تلقائيًا)
                        <input
                            name="invoiceTotal"
                            readOnly
                            aria-readonly="true"
                            value={estimate.grand.toFixed(2)}
                            className={fieldClass}
                            dir="ltr"
                        />
                    </label>
                </div>

                <p className="text-body-sm text-muted">
                    {registered && estimate.vat > 0
                        ? `شامل الضريبة تلقائيًا: صافي ${moneyWithUnit(estimate.net, currency)} + ضريبة 15% (${moneyWithUnit(estimate.vat, currency)}) = شامل ${moneyWithUnit(estimate.grand, currency)} — يُحسم عند الحفظ`
                        : registered
                          ? 'المورد مسجل — لا ضريبة على هذه الأصناف (معفاة/صفرية)'
                          : selectedSupplier
                            ? 'المورد غير مسجل/معفى — لا ضريبة متوقعة'
                            : 'بدون ربط مورد — لا ضريبة متوقعة'}
                </p>

                <div className="grid gap-sm sm:grid-cols-3">
                    <label className={labelClass}>
                        طريقة الدفع
                        <select
                            name="paymentMethod"
                            value={String(form.paymentMethod ?? 'cash')}
                            disabled={paidLock}
                            onChange={(event) => {
                                update({ paymentMethod: event.target.value });
                            }}
                            className={fieldClass}
                        >
                            {INVOICE_PAYMENT_METHOD_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className={labelClass}>
                        المسدد الآن
                        <input
                            name="paidAmount"
                            type="number"
                            min={0}
                            step="0.01"
                            value={paidValue}
                            disabled={paidLock}
                            onChange={(event) => {
                                setPaidTouched(true);
                                update({ paidAmount: event.target.value });
                            }}
                            className={fieldClass}
                            dir="ltr"
                        />
                    </label>
                    <div className="flex flex-col justify-end gap-xxs text-body-sm text-muted">
                        <span>
                            المتبقي بعد السداد{' '}
                            <span className="erp-numeric text-ink" dir="ltr">
                                {formatMoney(Math.max(0, estimate.grand - Number(paidValue || 0)).toFixed(2))}
                            </span>
                        </span>
                        <span className="text-caption">تلقائي = الشامل (نقدي) أو 0 (آجل) — يقبل الكسور حتى هللتين</span>
                    </div>
                </div>

                <label className={labelClass}>
                    ملاحظات
                    <textarea
                        name="notes"
                        rows={2}
                        value={String(form.notes ?? '')}
                        disabled={paidLock}
                        onChange={(event) => {
                            update({ notes: event.target.value });
                        }}
                        className={`${fieldClass} h-auto py-xs`}
                    />
                </label>

                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

export function PurchaseInvoices() {
    const [from, setFrom] = useState(riyadhDaysAgo(30));
    const [to, setTo] = useState(riyadhToday());
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
    const [page, setPage] = useState(1);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingRaw, setEditingRaw] = useState<InvoiceRaw | null>(null);
    const [partialTarget, setPartialTarget] = useState<PurchaseInvoiceRow | null>(null);
    const [partialAmount, setPartialAmount] = useState('');
    const [partialMethod, setPartialMethod] = useState('cash');
    const [partialDate, setPartialDate] = useState(riyadhToday());
    const [partialNotes, setPartialNotes] = useState('');
    const [partialError, setPartialError] = useState('');
    const [clearChecked, setClearChecked] = useState(false);
    const [clearError, setClearError] = useState('');

    const auth = useAuthState();
    const role = auth.user?.role ?? null;
    const canCreate = invoiceCreateVisible(role);
    const canVoid = invoiceVoidVisible(role);
    const canPay = invoicePaymentVisible(role);
    const showActions = canCreate || canVoid || canPay;

    const confirm = useConfirm();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const rangeInvalid = Boolean(from && to && from > to);

    const invoicesQuery = useQuery({
        queryKey: ['purchase-invoices'],
        queryFn: ({ signal }) => fetchPurchaseInvoices(signal),
    });
    const suppliersQuery = useQuery({
        queryKey: ['procurement', 'suppliers'],
        queryFn: ({ signal }) => fetchSuppliers(signal),
        staleTime: 10 * 60 * 1000,
    });
    const currencyQuery = useQuery({
        queryKey: ['finance', 'currency'],
        queryFn: ({ signal }) => fetchCurrency(signal),
        staleTime: 10 * 60 * 1000,
    });

    const currency = currencyQuery.data ?? '';
    const supplierById = useMemo(() => supplierNameMap(suppliersQuery.data ?? []), [suppliersQuery.data]);
    const allRows = useMemo(
        () => (invoicesQuery.data ?? []).map((invoice) => invoiceToRow(invoice, supplierById)),
        [invoicesQuery.data, supplierById],
    );
    const rawById = useMemo(() => {
        const map = new Map<string, InvoiceRaw>();
        for (const invoice of invoicesQuery.data ?? []) {
            map.set(invoice.id, invoice as unknown as InvoiceRaw);
        }
        return map;
    }, [invoicesQuery.data]);

    const rows = useMemo(() => {
        if (rangeInvalid) {
            return [];
        }
        return allRows.filter((row) => {
            if (from && row.date < from) {
                return false;
            }
            if (to && row.date > to) {
                return false;
            }
            return true;
        });
    }, [allRows, from, to, rangeInvalid]);

    const sorted = useMemo(() => {
        if (!sort) {
            return rows;
        }
        const copy = [...rows].sort((a, b) => compare(a, b, sort.key));
        return sort.dir === 'asc' ? copy : copy.reverse();
    }, [rows, sort]);

    const totals = useMemo(() => invoiceTotals(sorted), [sorted]);
    const filtered = Boolean(from || to);
    const capped = (invoicesQuery.data?.length ?? 0) >= SERVER_PAGE_SIZE * MAX_PAGES;

    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    /* ── الكتابة: نفس أبواب V2 الستة ─────────────────────────────────── */

    const saveMutation = useWriteMutation<{ editingId: string | null; form: InvoiceForm }, void>({
        mutationFn: async ({ editingId, form }) => {
            if (editingId) {
                await updatePurchaseInvoice(editingId, form);
            } else {
                await createPurchaseInvoice(form);
            }
        },
        successTitle: ({ editingId }) => (editingId ? 'تم تحديث الفاتورة والمخزون والحسابات' : 'تم حفظ الفاتورة'),
        invalidate: [['purchase-invoices'], ['inventory']],
        silentError: true,
    });

    const voidMutation = useWriteMutation<PurchaseInvoiceRow, VoidInvoiceResult>({
        mutationFn: (row) => voidPurchaseInvoice(row.id),
        invalidate: [['purchase-invoices'], ['inventory']],
        silentError: true,
        onSuccess: (data, row) => {
            toast({
                title: voidSuccess(data.invoiceNumber || row.number, data.reversedItems, data.deletedPayments),
                variant: 'success',
            });
        },
        onError: (cause) => {
            const message = writeErrorMessage(cause, INVOICE_TEXT.voidFailedFallback);
            const guide = isVoidPaymentError(cause) ? INVOICE_TEXT.voidPaymentGuide : '';
            toast({ title: `${message}${guide}`, variant: 'error' });
        },
    });

    const payMutation = useWriteMutation<PurchaseInvoiceRow, void>({
        mutationFn: (row) => payInvoiceFull(row.id, { method: 'cash' }),
        successTitle: (row) => payFullSuccess(row.number, moneyWithUnit(row.remaining, currency)),
        invalidate: [['purchase-invoices'], ['procurement', 'payments'], ['procurement', 'suppliers'], ['procurement', 'summary']],
        silentError: true,
        onError: (cause) => {
            toast({ title: `${INVOICE_TEXT.payFailedPrefix}${writeErrorMessage(cause)}`, variant: 'error' });
        },
    });

    const partialMutation = useWriteMutation<
        { row: PurchaseInvoiceRow; amount: string; method: string; date: string; notes: string },
        number | null
    >({
        mutationFn: ({ row, amount, method, date, notes }) =>
            payInvoicePartial(row.id, { supplierId: row.supplierId ?? '', amount, method, date, notes }),
        invalidate: [['purchase-invoices'], ['procurement', 'payments'], ['procurement', 'suppliers'], ['procurement', 'summary']],
        silentError: true,
        onSuccess: (due, variables) => {
            const shown = moneyWithUnit(variables.amount, currency);
            toast({
                title: payPartialSuccess(shown, variables.row.number, due === null ? null : moneyWithUnit(due, currency)),
                variant: 'success',
            });
            setPartialTarget(null);
        },
        onError: (cause) => {
            const message = writeErrorMessage(cause, INVOICE_TEXT.partialFailed);
            setPartialError(message);
            toast({ title: message, variant: 'error' });
        },
    });

    const clearMutation = useWriteMutation<void, ClearAllResult>({
        mutationFn: () => clearAllPurchaseInvoices(),
        invalidate: [['purchase-invoices'], ['inventory']],
        silentError: true,
        onSuccess: (data) => {
            toast({ title: clearAllSuccess(data.deletedInvoices, data.reversedLedgerRows), variant: 'success' });
            setClearChecked(false);
            setClearError('');
        },
        onError: (cause) => {
            const message = writeErrorMessage(cause, INVOICE_TEXT.clearAllFailedFallback);
            setClearError(message);
            toast({ title: message, variant: 'error' });
        },
    });

    function toggleSort(key: SortKey) {
        setPage(1);
        setSort((previous) => (previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
    }

    function applyPreset(preset: '30' | 'month' | 'all') {
        if (preset === '30') {
            setFrom(riyadhDaysAgo(30));
            setTo(riyadhToday());
        } else if (preset === 'month') {
            setFrom(firstOfMonth());
            setTo(riyadhToday());
        } else {
            setFrom('');
            setTo('');
        }
        setPage(1);
    }

    function resetFilters() {
        setFrom('');
        setTo('');
        setSort(null);
        setPage(1);
    }

    function openNewInvoice(): void {
        setEditingRaw(null);
        setEditorOpen(true);
    }

    function openEditInvoice(row: PurchaseInvoiceRow): void {
        const raw = rawById.get(row.id);
        if (!raw) {
            toast({ title: 'الفاتورة غير موجودة', variant: 'error' });
            return;
        }
        setEditingRaw(raw);
        setEditorOpen(true);
    }

    async function handleSave(form: InvoiceForm): Promise<void> {
        const editingId = editingRaw ? String(editingRaw.id ?? '') : null;
        try {
            await saveMutation.mutateAsync({ editingId, form });
            setEditorOpen(false);
            setEditingRaw(null);
        } catch (cause) {
            if (isDuplicateInvoiceError(cause)) {
                toast({ title: INVOICE_TEXT.duplicateInvoice, variant: 'info' });
                return;
            }
            toast({
                title: `${INVOICE_TEXT.saveFailedPrefix}${writeErrorMessage(cause, INVOICE_TEXT.saveFailed)}`,
                variant: 'error',
            });
        }
    }

    async function handlePayFull(row: PurchaseInvoiceRow): Promise<void> {
        if (payMutation.isPending) {
            return;
        }
        const amount = moneyWithUnit(row.remaining, currency);
        const answer = await confirm(payFullConfirm(row.number, amount));
        if (!answer) {
            return;
        }
        payMutation.mutate(row);
    }

    async function handleVoid(row: PurchaseInvoiceRow): Promise<void> {
        if (voidMutation.isPending) {
            return;
        }
        const total = moneyWithUnit(row.total, currency);
        const paid = Number(row.paid) > 0 ? moneyWithUnit(row.paid, currency) : '';
        const answer = await confirm(voidConfirm(row.number, total, paid));
        if (!answer) {
            return;
        }
        voidMutation.mutate(row);
    }

    function openPartialPayment(row: PurchaseInvoiceRow): void {
        setPartialTarget(row);
        setPartialAmount('');
        setPartialMethod('cash');
        setPartialDate(riyadhToday());
        setPartialNotes('');
        setPartialError('');
    }

    function closePartialPayment(): void {
        if (partialMutation.isPending) {
            return;
        }
        setPartialTarget(null);
        setPartialError('');
    }

    async function submitPartialPayment(): Promise<void> {
        if (!partialTarget || partialMutation.isPending) {
            return;
        }
        const message = partialPaymentError(partialAmount, partialTarget.remaining);
        if (message) {
            setPartialError(message);
            return;
        }
        const shown = moneyWithUnit(partialAmount, currency);
        const answer = await confirm(payPartialConfirm(shown, partialTarget.number));
        if (!answer) {
            return;
        }
        setPartialError('');
        partialMutation.mutate({
            row: partialTarget,
            amount: partialAmount,
            method: partialMethod,
            date: partialDate,
            notes: partialNotes,
        });
    }

    async function handleClearAll(): Promise<void> {
        if (clearMutation.isPending) {
            return;
        }
        if (!clearChecked) {
            setClearError(INVOICE_TEXT.clearAllUnchecked);
            return;
        }
        if (allRows.length === 0) {
            return;
        }
        const answer = await confirm(clearAllConfirm(allRows.length));
        if (!answer) {
            return;
        }
        setClearError('');
        clearMutation.mutate();
    }

    function refresh(): void {
        void invoicesQuery.refetch();
        void queryClient.invalidateQueries({ queryKey: ['procurement', 'suppliers'] });
    }

    return (
        <div className="erp-premium-screen flex flex-col gap-md">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        فواتير الشراء{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Purchase Invoices
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">كل فواتير الموردين — الإجمالي والمسدد والمتبقي بحسب الفترة المحددة.</p>
                </div>
                <div className="flex flex-wrap items-center gap-xs" data-erp-print-hide>
                    {canCreate ? (
                        <button
                            type="button"
                            onClick={openNewInvoice}
                            className="rounded-md border border-primary-active/40 bg-primary-active px-md py-xs text-button-md text-on-primary"
                        >
                            {INVOICE_TEXT.createAction}
                        </button>
                    ) : null}
                    <PrintActions title="فواتير الشراء" />
                    <button
                        type="button"
                        onClick={refresh}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                    label="عدد الفواتير"
                    english="Invoices"
                    value={formatInt(totals.count)}
                    hint={`${formatInt(totals.suppliers)} موردًا`}
                />
                <Kpi
                    label="إجمالي المشتريات"
                    english="Total"
                    value={`${formatMoney(totals.total)}${currency ? ` ${currency}` : ''}`}
                    hint="مجموع الإجمالي للفترة"
                />
                <Kpi
                    label="المسدد"
                    english="Paid"
                    value={`${formatMoney(totals.paid)}${currency ? ` ${currency}` : ''}`}
                    hint="مجموع المدفوع للفترة"
                />
                <Kpi
                    label="المتبقي"
                    english="Remaining"
                    value={`${formatMoney(totals.remaining)}${currency ? ` ${currency}` : ''}`}
                    hint="إجمالي − مسدد"
                />
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <fieldset className="flex items-end gap-xs">
                        <legend className="pb-2 text-label-md text-ink-secondary">الفترة</legend>
                        <button
                            type="button"
                            onClick={() => {
                                applyPreset('30');
                            }}
                            className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                        >
                            آخر 30 يومًا
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                applyPreset('month');
                            }}
                            className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                        >
                            هذا الشهر
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                applyPreset('all');
                            }}
                            className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                        >
                            كل الفترات
                        </button>
                    </fieldset>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-invoices-from">
                        من
                        <input
                            id="erp-invoices-from"
                            type="date"
                            value={from}
                            max={to || riyadhToday()}
                            onChange={(event) => {
                                setFrom(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                            dir="ltr"
                        />
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-invoices-to">
                        إلى
                        <input
                            id="erp-invoices-to"
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
                        مسح المرشّحات
                    </button>
                    <span className="text-body-sm text-muted">{formatInt(sorted.length)} فاتورة</span>
                </div>
                {rangeInvalid ? (
                    <p role="alert" className="mt-sm text-body-sm text-danger-text">
                        بداية الفترة بعد نهايتها — صحّح التاريخين قبل العرض.
                    </p>
                ) : null}
            </Card>

            <Card>
                {invoicesQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل فواتير الشراء" />
                        <TableSkeleton rows={6} columns={8} />
                    </div>
                ) : null}

                {invoicesQuery.isError ? (
                    <StateError
                        message={invoicesQuery.error instanceof Error ? invoicesQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void invoicesQuery.refetch();
                        }}
                    />
                ) : null}

                {invoicesQuery.isSuccess && rows.length === 0 ? (
                    <StateEmpty
                        title="لا توجد فواتير في الفترة المحددة"
                        hint={rangeInvalid ? 'صحّح التاريخين أولًا.' : 'وسّع الفترة أو اختر «كل الفترات» لرؤية السجل كاملًا.'}
                    />
                ) : null}

                {invoicesQuery.isSuccess && rows.length > 0 ? (
                    <>
                        <p className="border-b border-hairline px-sm py-xs text-body-sm text-muted" role="status">
                            {`${formatInt(totals.count)} فاتورة بإجمالي ${formatMoney(totals.total)}${currency ? ` ${currency}` : ''}`}
                            {` · مسدد ${formatMoney(totals.paid)} · متبقٍ ${formatMoney(totals.remaining)}`}
                            {filtered ? '' : ' · كل الفترات'}
                            {capped ? ` · الخادم أعاد أول ${formatInt(SERVER_PAGE_SIZE * MAX_PAGES)} فاتورة فقط` : ''}
                        </p>
                        <TableScroll label="جدول فواتير الشراء">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh label="رقم الفاتورة" sortKey="number" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="المورد" sortKey="supplier" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="التاريخ" sortKey="date" sort={sort} onToggle={toggleSort} align="center" />
                                        <SortableTh label="الإجمالي" sortKey="total" sort={sort} onToggle={toggleSort} align="end" />
                                        <SortableTh label="المسدد" sortKey="paid" sort={sort} onToggle={toggleSort} align="end" />
                                        <SortableTh label="المتبقي" sortKey="remaining" sort={sort} onToggle={toggleSort} align="end" />
                                        <SortableTh label="الدفع" sortKey="method" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الحالة" sortKey="status" sort={sort} onToggle={toggleSort} />
                                        {showActions ? (
                                            <th scope="col" className="px-sm py-xs text-end font-medium">
                                                إجراءات
                                            </th>
                                        ) : null}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row) => (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {row.number}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">
                                                <span
                                                    title={
                                                        row.supplierResolved
                                                            ? undefined
                                                            : 'من لقطة وقت الإصدار — المورد ليس في الدليل الحالي'
                                                    }
                                                >
                                                    {row.supplier}
                                                </span>
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-center text-body-sm text-muted" dir="ltr">
                                                {row.date || '—'}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink">{formatMoney(row.total)}</td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-body-sm text-muted">
                                                {formatMoney(row.paid)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-body-sm text-ink">
                                                {formatMoney(row.remaining)}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{row.methodLabel}</td>
                                            <td className="px-sm py-xxs text-body-sm">
                                                <span
                                                    className={row.statusKnown ? (STATUS_TONE[row.status] ?? 'text-muted') : 'text-muted'}
                                                >
                                                    {row.statusLabel}
                                                </span>
                                                {row.statusKnown ? null : (
                                                    <span className="text-caption text-faint" dir="ltr">
                                                        {' '}
                                                        ({row.status})
                                                    </span>
                                                )}
                                            </td>
                                            {showActions ? (
                                                <td className="px-sm py-xxs">
                                                    <div className="flex flex-wrap items-center justify-end gap-xxs">
                                                        {canCreate ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    openEditInvoice(row);
                                                                }}
                                                                className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                                                            >
                                                                {INVOICE_TEXT.edit}
                                                            </button>
                                                        ) : null}
                                                        {canPay && Number(row.remaining) > 0 && row.supplierId ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    openPartialPayment(row);
                                                                }}
                                                                className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                                                            >
                                                                {INVOICE_TEXT.payPartial}
                                                            </button>
                                                        ) : null}
                                                        {canPay && Number(row.remaining) > 0 ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    void handlePayFull(row);
                                                                }}
                                                                className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                                                            >
                                                                {INVOICE_TEXT.payFull}
                                                            </button>
                                                        ) : null}
                                                        {canVoid ? (
                                                            <button
                                                                type="button"
                                                                aria-label={`حذف الفاتورة ${row.number}`}
                                                                onClick={() => {
                                                                    void handleVoid(row);
                                                                }}
                                                                className="rounded-md border border-danger/50 bg-surface px-sm py-xxs text-body-sm text-danger-text hover:bg-danger-soft"
                                                            >
                                                                {INVOICE_TEXT.voidAction}
                                                            </button>
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

            {canVoid && allRows.length > 0 ? (
                <Card className="p-sm">
                    <div className="flex flex-wrap items-center justify-between gap-sm">
                        <h2 className="text-heading-sm text-ink">
                            {INVOICE_TEXT.clearAllTitle}{' '}
                            <span className="rounded-full bg-danger-soft px-sm py-xxs text-caption text-danger-text">
                                {INVOICE_TEXT.clearAllBadge}
                            </span>
                        </h2>
                    </div>
                    <p className="mt-sm text-body-sm text-muted">{INVOICE_TEXT.clearAllDescription}</p>
                    <div className="mt-sm flex flex-wrap items-center gap-sm">
                        <label className="flex items-center gap-xs text-body-sm text-ink">
                            <input
                                type="checkbox"
                                checked={clearChecked}
                                onChange={(event) => {
                                    setClearChecked(event.target.checked);
                                    setClearError('');
                                }}
                            />
                            {INVOICE_TEXT.clearAllCheck}
                        </label>
                        <button
                            type="button"
                            disabled={!clearChecked || clearMutation.isPending}
                            onClick={() => {
                                void handleClearAll();
                            }}
                            className="rounded-md border border-danger/50 bg-danger px-sm py-xxs text-body-sm text-on-primary disabled:opacity-50"
                        >
                            {INVOICE_TEXT.clearAllAction}
                        </button>
                    </div>
                    {clearError ? (
                        <p role="alert" className="mt-sm text-body-sm text-danger-text">
                            {clearError}
                        </p>
                    ) : null}
                </Card>
            ) : null}

            <InvoiceFormDialog
                open={editorOpen}
                editing={editingRaw}
                suppliers={suppliersQuery.data ?? []}
                currency={currency}
                saving={saveMutation.isPending}
                onClose={() => {
                    if (saveMutation.isPending) {
                        return;
                    }
                    setEditorOpen(false);
                    setEditingRaw(null);
                }}
                onSave={(form) => {
                    void handleSave(form);
                }}
            />

            <Dialog
                open={partialTarget !== null}
                onOpenChange={(next) => {
                    if (!next) {
                        closePartialPayment();
                    }
                }}
                title={partialTarget ? `${INVOICE_TEXT.partialTitle} — ${partialTarget.number}` : INVOICE_TEXT.partialTitle}
                size="sm"
                footer={
                    <>
                        <button
                            type="button"
                            onClick={closePartialPayment}
                            className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                        >
                            {INVOICE_TEXT.cancel}
                        </button>
                        <button
                            type="button"
                            disabled={partialMutation.isPending}
                            onClick={() => {
                                void submitPartialPayment();
                            }}
                            className="rounded-md border border-primary-active/40 bg-primary-active px-md py-xs text-button-md text-on-primary disabled:opacity-50"
                        >
                            {INVOICE_TEXT.savePartial}
                        </button>
                    </>
                }
            >
                {partialTarget ? (
                    <div className="flex flex-col gap-sm">
                        <p className="text-body-sm text-muted">
                            {partialTarget.supplier} · {INVOICE_TEXT.remainingLabel}{' '}
                            <span className="erp-numeric text-ink" dir="ltr">
                                {moneyWithUnit(partialTarget.remaining, currency)}
                            </span>
                        </p>
                        <label className={labelClass}>
                            {INVOICE_TEXT.amountLabel}
                            <input
                                name="partialAmount"
                                type="number"
                                min={0.01}
                                step="0.01"
                                max={partialTarget.remaining}
                                value={partialAmount}
                                onChange={(event) => {
                                    setPartialAmount(event.target.value);
                                }}
                                className={fieldClass}
                                dir="ltr"
                            />
                        </label>
                        <label className={labelClass}>
                            {INVOICE_TEXT.methodLabel}
                            <select
                                name="partialMethod"
                                value={partialMethod}
                                onChange={(event) => {
                                    setPartialMethod(event.target.value);
                                }}
                                className={fieldClass}
                            >
                                {PARTIAL_PAYMENT_METHOD_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className={labelClass}>
                            {INVOICE_TEXT.dateLabel}
                            <input
                                name="partialDate"
                                type="date"
                                value={partialDate}
                                onChange={(event) => {
                                    setPartialDate(event.target.value);
                                }}
                                className={fieldClass}
                                dir="ltr"
                            />
                        </label>
                        <label className={labelClass}>
                            {INVOICE_TEXT.notesLabel}
                            <input
                                name="partialNotes"
                                maxLength={255}
                                value={partialNotes}
                                onChange={(event) => {
                                    setPartialNotes(event.target.value);
                                }}
                                className={fieldClass}
                            />
                        </label>
                        {partialError ? (
                            <p role="alert" className="text-body-sm text-danger-text">
                                {partialError}
                            </p>
                        ) : null}
                    </div>
                ) : null}
            </Dialog>
        </div>
    );
}
