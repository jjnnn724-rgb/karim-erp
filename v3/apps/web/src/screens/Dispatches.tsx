import './Dispatches.premium.css';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import {
    arSearchKey,
    DISPATCH_STATUS,
    type Dispatch,
    type DispatchRow,
    type DispatchScope,
    dispatchToRow,
    fetchDispatches,
    MAX_PAGES_ALL,
    MAX_PAGES_MONTH,
    matchDispatchProduct,
    statusOf,
    summarizeDispatches,
    summarizeProductWithdrawal,
} from '../lib/dispatches';
import {
    type ApproveBody,
    type ApproveDispatchResult,
    type ApproveDraft,
    anyActionVisible,
    approveDispatch,
    approveDraftError,
    approveErrorText,
    approveItemsPayload,
    approveSuccessText,
    type ChefApproveBody,
    type CreateDispatchPayload,
    canCreateDispatch,
    chefActionsVisible,
    chefApproveDispatch,
    chefRejectDispatch,
    createDispatch,
    createDispatchPayload,
    createErrorText,
    createRequestError,
    createSuccessText,
    DISPATCH_TEXT,
    type DispatchGateRow,
    decisionSignatureError,
    deleteConfirmText,
    deleteDispatch,
    deleteSuccessText,
    deleteVisible,
    dispatchGate,
    dispatchItemLines,
    type EditDispatchPayload,
    editDispatch,
    editDispatchPayload,
    editItemsError,
    editSuccessText,
    editVisible,
    type GateUser,
    type RejectBody,
    receiveDispatch,
    receiveDraftError,
    receivedItemsPayload,
    receiveSourceItems,
    receiveVisible,
    rejectDispatch,
    reopenDispatch,
    reopenVisible,
    type SignedDecision,
    warehouseActionsVisible,
} from '../lib/dispatches-write';
import { fetchDepartments, firstOfMonth, riyadhToday } from '../lib/finance';
import { fetchInventoryRegister } from '../lib/inventory-register';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { SignaturePad } from '../ui/SignaturePad';
import { Textarea } from '../ui/Textarea';
import { useToast } from '../ui/Toast';

/**
 * أذون الصرف — القراءة من `/api/dispatches` بنفس نطاق القديم (الشهر الحالي
 * افتراضيًا، وكل السجل عند الطلب) وبنفس سقفيه المعلنين، ودورة القرار كاملة
 * كما في V2 (`frontend/app/js/v2/screens/dispatch.js`):
 *
 *   إنشاء طلب صرف · تعديل قبل الاعتماد · إرجاع المعتمد قبل الاستلام للتعديل ·
 *   حذف (نهائي للأدمن موثّق) ·
 *   اعتماد/رفض الشيف العمومي · اعتماد/رفض المخازن · استلام القسم بالتوقيع.
 *
 * الأزرار تظهر بقوائم أدوار V2 نفسها وبحالة الإذن وحدها (lib/dispatches-write)،
 * والقرارات الخمسة توقيعها إلكتروني مقفل على اسم الحساب كما يفرضه الخادم
 * (`requireSignature`)، والخادم يبقى الحاكم على كل بوابة.
 */

const PAGE_SIZE = 20;

const TONE_CLASS: Record<string, string> = {
    warning: 'text-ink-secondary',
    info: 'text-ink-secondary',
    success: 'text-success-text',
    danger: 'text-danger-text',
    neutral: 'text-muted',
};

function formatInt(value: number): string {
    return value.toLocaleString('en-US');
}

function formatQty(value: number): string {
    return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
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

function deptNameOf(dispatch: Dispatch | null): string {
    return String(dispatch?.deptName ?? dispatch?.deptCode ?? '');
}

/* ── أدوات مشتركة للنماذج ───────────────────────────────────────────────── */

function FormMessage({ message }: { message: string }) {
    return message ? (
        <p role="alert" className="text-body-sm text-danger-text">
            {message}
        </p>
    ) : null;
}

function DialogFooter({
    formId,
    submitLabel,
    pending,
    onClose,
}: {
    formId: string;
    submitLabel: string;
    pending: boolean;
    onClose: () => void;
}) {
    return (
        <>
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                إلغاء
            </Button>
            <Button type="submit" form={formId} size="sm" loading={pending}>
                {submitLabel}
            </Button>
        </>
    );
}

function ActionsDialog({
    title,
    formId,
    submitLabel,
    pending,
    onClose,
    onSubmit,
    children,
}: {
    title: string;
    formId: string;
    submitLabel: string;
    pending: boolean;
    onClose: () => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    children: ReactNode;
}) {
    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title={title}
            size="lg"
            footer={<DialogFooter formId={formId} submitLabel={submitLabel} pending={pending} onClose={onClose} />}
        >
            <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-sm">
                {children}
            </form>
        </Dialog>
    );
}

/* ── نموذج الإنشاء/التعديل ─────────────────────────────────────────────── */

const REQUEST_FORM_ID = 'erp-dispatch-request-form';

interface EditableLine {
    name: string;
    unit: string;
    qty: string;
    mainQty: number;
}

function RequestDialog({
    mode,
    dispatch,
    role,
    pending,
    onClose,
    onCreate,
    onEdit,
}: {
    mode: 'create' | 'edit';
    dispatch: Dispatch | null;
    role: string;
    pending: boolean;
    onClose: () => void;
    onCreate: (payload: CreateDispatchPayload) => Promise<unknown>;
    onEdit: (payload: EditDispatchPayload) => Promise<unknown>;
}) {
    const isEdit = mode === 'edit';
    const [deptCode, setDeptCode] = useState(isEdit ? String(dispatch?.deptCode ?? '') : '');
    const [notes, setNotes] = useState('');
    const [reason, setReason] = useState('');
    const [search, setSearch] = useState('');
    const [error, setError] = useState('');
    const [lines, setLines] = useState<EditableLine[]>(() =>
        isEdit
            ? dispatchItemLines(dispatch?.items).map((line) => ({
                  name: line.name,
                  unit: line.unit,
                  qty: String(line.qty),
                  mainQty: 0,
              }))
            : [],
    );

    // أقسام الطلب — تُقرأ فقط عند فتح النموذج (V2 يقرؤها في اللوحة نفسها).
    const departmentsQuery = useQuery({
        queryKey: ['departments', 'dispatch-request'],
        queryFn: ({ signal }) => fetchDepartments(signal),
        staleTime: 5 * 60 * 1000,
        enabled: role !== 'dept_head',
    });
    // كتالوج المخزون وأرصدته — بوابة «الصنف صفر لا يُعرض» كما في V2.
    const catalogQuery = useQuery({
        queryKey: ['inventory', 'dispatch-catalog'],
        queryFn: ({ signal }) => fetchInventoryRegister({ q: '', category: 'all', stock: 'all' }, signal),
        staleTime: 60 * 1000,
    });

    const departments = departmentsQuery.data ?? [];
    const catalog = useMemo(
        () =>
            (catalogQuery.data?.rows ?? [])
                .map((item) => ({
                    name: String(item.name ?? '').trim(),
                    unit: String(item.unit ?? '').trim(),
                    mainQty: Number(item.mainQty) || 0,
                }))
                .filter((item) => item.name !== ''),
        [catalogQuery.data],
    );

    const needle = arSearchKey(search.trim());
    const suggestions =
        needle === ''
            ? []
            : catalog
                  .filter(
                      (item) =>
                          item.mainQty > 0 && !lines.some((line) => line.name === item.name) && arSearchKey(item.name).includes(needle),
                  )
                  .slice(0, 8);

    function addLine(entry: { name: string; unit: string; mainQty: number }): void {
        setLines((previous) => [...previous, { name: entry.name, unit: entry.unit, qty: '1', mainQty: entry.mainQty }]);
        setSearch('');
        setError('');
    }

    function updateLine(index: number, qty: string): void {
        setLines((previous) => previous.map((line, position) => (position === index ? { ...line, qty } : line)));
    }

    function removeLine(index: number): void {
        setLines((previous) => previous.filter((_line, position) => position !== index));
    }

    async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (pending) {
            return;
        }
        setError('');
        if (isEdit) {
            const message = editItemsError(lines);
            if (message) {
                setError(message);
                return;
            }
            try {
                await onEdit(editDispatchPayload({ role, deptCode, items: lines, reason }));
            } catch (cause) {
                setError(writeErrorMessage(cause, DISPATCH_TEXT.editFailed));
            }
            return;
        }
        const message = createRequestError(role, deptCode, lines);
        if (message) {
            setError(message);
            return;
        }
        const department = departments.find((entry) => entry.code === deptCode);
        try {
            await onCreate(
                createDispatchPayload({
                    role,
                    deptCode,
                    deptName: department?.name ?? '',
                    items: lines,
                    notes,
                    date: riyadhToday(),
                }),
            );
        } catch (cause) {
            setError(createErrorText(cause));
        }
    }

    return (
        <ActionsDialog
            title={`${isEdit ? 'تعديل إذن الصرف' : 'طلب صرف جديد'}${isEdit && dispatch?.deptName ? ` — ${String(dispatch.deptName)}` : ''}`}
            formId={REQUEST_FORM_ID}
            submitLabel={isEdit ? 'حفظ التعديل' : 'إرسال الطلب'}
            pending={pending}
            onClose={onClose}
            onSubmit={(event) => void submit(event)}
        >
            {isEdit && dispatch?.status === 'chef_approved' ? (
                <p className="rounded-md border border-warning/40 bg-warning-soft p-sm text-body-sm text-ink">
                    ⚠ هذا الطلب معتمد من الشيف — الحفظ <strong>يلغي الاعتماد</strong> ويرجعه للمراجعة على الأرقام الجديدة
                </p>
            ) : null}

            {role === 'dept_head' ? (
                <p className="text-body-sm text-muted">
                    القسم الطالب: <strong className="text-ink">قسم حسابك</strong> — رئيس القسم ينشئ ويعدّل لقسمه فقط، والخادم يفرضه.
                </p>
            ) : (
                <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-dispatch-dept">
                    {isEdit ? 'القسم الطالب (يمكن نقله لقسم آخر)' : 'القسم الطالب'}
                    <select
                        id="erp-dispatch-dept"
                        value={deptCode}
                        onChange={(event) => {
                            setDeptCode(event.target.value);
                        }}
                        className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                    >
                        <option value="">— اختر القسم —</option>
                        {departments.map((entry) => (
                            <option key={entry.code} value={entry.code}>
                                {entry.name || entry.code}
                            </option>
                        ))}
                    </select>
                </label>
            )}

            <div className="flex flex-col gap-xxs">
                <label className="text-label-md text-ink-secondary" htmlFor="erp-dispatch-item-search">
                    إضافة صنف من المخزن
                </label>
                <input
                    id="erp-dispatch-item-search"
                    type="search"
                    value={search}
                    placeholder="ابحث باسم الصنف أو الباركود…"
                    onChange={(event) => {
                        setSearch(event.target.value);
                    }}
                    className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                />
                {suggestions.length > 0 ? (
                    <div className="flex flex-col rounded-md border border-hairline bg-surface-raised shadow-card">
                        {suggestions.map((item) => (
                            <button
                                key={item.name}
                                type="button"
                                onClick={() => {
                                    addLine(item);
                                }}
                                className="flex items-center justify-between gap-sm px-sm py-xxs text-start text-body-sm text-ink hover:bg-surface-hover"
                            >
                                <span>{item.name}</span>
                                <span className="erp-numeric shrink-0 text-caption text-muted" dir="ltr">
                                    المتاح: {formatQty(item.mainQty)} {item.unit}
                                </span>
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>

            {lines.length > 0 ? (
                <ul className="flex flex-col gap-xs">
                    {lines.map((line, index) => (
                        <li
                            key={`${line.name}-${String(index)}`}
                            className="flex flex-wrap items-end gap-xs rounded-md border border-hairline p-xs"
                        >
                            <div className="flex min-w-40 flex-1 flex-col gap-xxs">
                                <span className="text-body-sm text-ink">{line.name}</span>
                                <span className="text-caption text-muted">
                                    {isEdit || line.mainQty === 0
                                        ? `الوحدة: ${line.unit || '—'}`
                                        : `المتاح في المخزن الرئيسي: ${formatQty(line.mainQty)} ${line.unit}`}
                                </span>
                            </div>
                            <Input
                                label="الكمية"
                                name={`qty-${String(index)}`}
                                type="number"
                                min={0}
                                step={0.001}
                                value={line.qty}
                                containerClassName="w-32"
                                onChange={(event) => {
                                    updateLine(index, event.target.value);
                                }}
                            />
                            <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                aria-label={`إزالة الصنف ${line.name}`}
                                onClick={() => {
                                    removeLine(index);
                                }}
                            >
                                إزالة
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : null}

            {isEdit ? (
                <Input
                    label="سبب التعديل (يُوثَّق في سجل الطلب)"
                    name="reason"
                    value={reason}
                    placeholder="مثال: تعديل كميات بعد الجرد"
                    onChange={(event) => {
                        setReason(event.target.value);
                    }}
                />
            ) : (
                <Textarea
                    label="ملاحظات الطلب"
                    name="notes"
                    rows={2}
                    value={notes}
                    onChange={(event) => {
                        setNotes(event.target.value);
                    }}
                />
            )}

            <p className="text-caption text-muted">{`عدد الأصناف: ${formatInt(lines.length)}`}</p>
            <FormMessage message={error} />
        </ActionsDialog>
    );
}

/* ── لوحات القرار الموقّعة ───────────────────────────────────────────────── */

function ChefApproveDialog({
    dispatch,
    signerName,
    pending,
    onClose,
    onSubmit,
}: {
    dispatch: Dispatch;
    signerName: string;
    pending: boolean;
    onClose: () => void;
    onSubmit: (body: ChefApproveBody) => Promise<unknown>;
}) {
    const [notes, setNotes] = useState('');
    const [signature, setSignature] = useState<string | null>(null);
    const [error, setError] = useState('');
    const lines = dispatchItemLines(dispatch.items);
    const formId = 'erp-dispatch-chef-approve-form';

    async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (pending) {
            return;
        }
        const message = decisionSignatureError(signature, signerName);
        if (message) {
            setError(message);
            return;
        }
        setError('');
        try {
            await onSubmit({ notes, signatureData: signature ?? '', signerName });
        } catch (cause) {
            setError(writeErrorMessage(cause, DISPATCH_TEXT.chefApproveFailed));
        }
    }

    return (
        <ActionsDialog
            title={`اعتماد الشيف العمومي${deptNameOf(dispatch) ? ` — ${deptNameOf(dispatch)}` : ''}`}
            formId={formId}
            submitLabel="اعتماد وإحالة للمخازن"
            pending={pending}
            onClose={onClose}
            onSubmit={(event) => void submit(event)}
        >
            <p className="rounded-md border border-info/40 bg-info-soft p-sm text-body-sm text-ink">
                اعتمادك ينقل الطلب إلى <strong>المخازن</strong> للصرف والخصم — لا يُخصم أي مخزون بهذه الخطوة.
            </p>
            <ul className="flex flex-col gap-xxs text-body-sm">
                {lines.map((line) => (
                    <li key={line.name} className="flex items-center justify-between gap-sm">
                        <span className="text-ink">{line.name}</span>
                        <span className="erp-numeric text-muted" dir="ltr">
                            {formatQty(line.qty)} {line.unit}
                        </span>
                    </li>
                ))}
            </ul>
            <Textarea
                label="ملاحظات الشيف (اختياري)"
                name="notes"
                rows={2}
                value={notes}
                onChange={(event) => {
                    setNotes(event.target.value);
                }}
            />
            <SignaturePad label="توقيع الشيف العمومي" name={signerName} testId="dispatch-signature" onChange={setSignature} />
            <FormMessage message={error} />
        </ActionsDialog>
    );
}

function RejectDialog({
    kind,
    dispatch,
    signerName,
    pending,
    onClose,
    onSubmit,
}: {
    kind: 'chef-reject' | 'reject';
    dispatch: Dispatch;
    signerName: string;
    pending: boolean;
    onClose: () => void;
    onSubmit: (body: RejectBody) => Promise<unknown>;
}) {
    const [reason, setReason] = useState('');
    const [signature, setSignature] = useState<string | null>(null);
    const [error, setError] = useState('');
    const lines = dispatchItemLines(dispatch.items);
    const formId = `erp-dispatch-${kind}-form`;
    const isChef = kind === 'chef-reject';

    async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (pending) {
            return;
        }
        if (!reason.trim()) {
            setError(DISPATCH_TEXT.reasonRequired);
            return;
        }
        const message = decisionSignatureError(signature, signerName);
        if (message) {
            setError(message);
            return;
        }
        setError('');
        try {
            await onSubmit({ reason: reason.trim(), signatureData: signature ?? '', signerName });
        } catch (cause) {
            setError(writeErrorMessage(cause, isChef ? DISPATCH_TEXT.chefRejectFailed : DISPATCH_TEXT.rejectFailed));
        }
    }

    return (
        <ActionsDialog
            title={isChef ? `رفض الشيف العمومي — ${deptNameOf(dispatch)}` : 'رفض طلب صرف'}
            formId={formId}
            submitLabel="تأكيد الرفض"
            pending={pending}
            onClose={onClose}
            onSubmit={(event) => void submit(event)}
        >
            <p className="rounded-md border border-warning/40 bg-warning-soft p-sm text-body-sm text-ink">
                {isChef ? (
                    <>
                        <strong>الأصناف:</strong> {lines.map((line) => line.name).join('، ') || '—'}
                    </>
                ) : (
                    <>
                        <strong>القسم:</strong> {deptNameOf(dispatch) || '—'}
                        <br />
                        <strong>الأصناف:</strong> {formatInt(lines.length)}
                    </>
                )}
            </p>
            <Textarea
                label="سبب الرفض"
                name="reason"
                rows={3}
                value={reason}
                placeholder={isChef ? 'مثال: الكمية كبيرة على احتياج القسم / الصنف غير مناسب' : undefined}
                onChange={(event) => {
                    setReason(event.target.value);
                }}
            />
            <SignaturePad
                label={isChef ? 'توقيع الشيف العمومي على الرفض' : 'توقيع أمين المخزن على الرفض'}
                name={signerName}
                testId="dispatch-signature"
                onChange={setSignature}
            />
            <FormMessage message={error} />
        </ActionsDialog>
    );
}

interface ApproveRow {
    name: string;
    unit: string;
    requestedQty: number;
    catchWeight: boolean;
    packagingUom: string;
    approvedQty: string;
    actualWeight: string;
    boxes: string;
}

function ApproveDialog({
    dispatch,
    signerName,
    pending,
    onClose,
    onSubmit,
}: {
    dispatch: Dispatch;
    signerName: string;
    pending: boolean;
    onClose: () => void;
    onSubmit: (body: ApproveBody) => Promise<unknown>;
}) {
    const lines = dispatchItemLines(dispatch.items);
    const [rows, setRows] = useState<ApproveRow[]>(() =>
        lines.map((line) => ({
            name: line.name,
            unit: line.unit,
            requestedQty: line.qty,
            catchWeight: line.catchWeight,
            packagingUom: line.packagingUom,
            approvedQty: String(line.qty),
            actualWeight: line.catchWeight ? String(line.qty) : '',
            boxes: line.catchWeight && line.packagingQty > 0 ? String(line.packagingQty) : '',
        })),
    );
    const [notes, setNotes] = useState('');
    const [signature, setSignature] = useState<string | null>(null);
    const [error, setError] = useState('');
    const formId = 'erp-dispatch-approve-form';

    function update(index: number, field: 'approvedQty' | 'actualWeight' | 'boxes', value: string): void {
        setRows((previous) => previous.map((row, position) => (position === index ? { ...row, [field]: value } : row)));
    }

    const drafts: ApproveDraft[] = rows.map((row) => ({
        name: row.name,
        unit: row.unit,
        requestedQty: row.requestedQty,
        approvedQty: row.approvedQty,
        catchWeight: row.catchWeight,
        packagingQty: row.boxes,
        actualWeight: row.actualWeight,
        packagingUom: row.packagingUom,
    }));

    async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (pending) {
            return;
        }
        const message = approveDraftError(drafts);
        if (message) {
            setError(message);
            return;
        }
        const signatureMessage = decisionSignatureError(signature, signerName);
        if (signatureMessage) {
            setError(signatureMessage);
            return;
        }
        setError('');
        try {
            await onSubmit({
                approvedItems: approveItemsPayload(drafts),
                approveNotes: notes,
                signatureData: signature ?? '',
                signerName,
            });
        } catch (cause) {
            setError(approveErrorText(cause));
        }
    }

    return (
        <ActionsDialog
            title={`الموافقة على طلب صرف${deptNameOf(dispatch) ? ` — ${deptNameOf(dispatch)}` : ''}`}
            formId={formId}
            submitLabel="تأكيد الموافقة"
            pending={pending}
            onClose={onClose}
            onSubmit={(event) => void submit(event)}
        >
            <p className="rounded-md border border-warning/40 bg-warning-soft p-sm text-body-sm text-ink">
                اعتماد المخزن <strong>يخصم الكمية من المخزون ويسجل تكلفة القسم في نفس المعاملة</strong> — راجع الكميات والوزن الفعلي قبل
                التأكيد.
            </p>
            <ul className="flex flex-col gap-sm">
                {rows.map((row, index) => (
                    <li key={row.name} className="flex flex-col gap-xs rounded-md border border-hairline p-xs">
                        <span className="text-body-sm text-ink">
                            <strong>{row.name}</strong>{' '}
                            <span className="text-muted">
                                — المطلوب: {formatQty(row.requestedQty)} {row.unit}
                            </span>
                        </span>
                        {row.catchWeight ? (
                            <div className="flex flex-wrap gap-xs">
                                <Input
                                    label="عدد الكراتين المصروفة"
                                    name={`boxes-${String(index)}`}
                                    type="number"
                                    min={1}
                                    step={1}
                                    containerClassName="w-40"
                                    value={row.boxes}
                                    onChange={(event) => {
                                        update(index, 'boxes', event.target.value);
                                    }}
                                />
                                <Input
                                    label="الوزن الفعلي بالكيلو (الميزان)"
                                    name={`weight-${String(index)}`}
                                    type="number"
                                    min={0.001}
                                    step={0.001}
                                    containerClassName="w-48"
                                    value={row.actualWeight}
                                    onChange={(event) => {
                                        update(index, 'actualWeight', event.target.value);
                                    }}
                                />
                            </div>
                        ) : (
                            <Input
                                label="الكمية المعتمدة"
                                name={`qty-${String(index)}`}
                                type="number"
                                min={0}
                                step={0.001}
                                containerClassName="w-40"
                                value={row.approvedQty}
                                onChange={(event) => {
                                    update(index, 'approvedQty', event.target.value);
                                }}
                            />
                        )}
                    </li>
                ))}
            </ul>
            <Textarea
                label="ملاحظات الاعتماد"
                name="approveNotes"
                rows={2}
                value={notes}
                onChange={(event) => {
                    setNotes(event.target.value);
                }}
            />
            <SignaturePad label="توقيع أمين المخزن المعتمد" name={signerName} testId="dispatch-signature" onChange={setSignature} />
            <FormMessage message={error} />
        </ActionsDialog>
    );
}

interface ReceiveRow {
    name: string;
    approvedQty: number;
    catchWeight: boolean;
    approvedPackagingQty: number;
    receivedQty: string;
    receivedPackagingQty: string;
}

function ReceiveDialog({
    dispatch,
    signerName,
    pending,
    onClose,
    onSubmit,
}: {
    dispatch: Dispatch;
    signerName: string;
    pending: boolean;
    onClose: () => void;
    onSubmit: (body: { items: ReturnType<typeof receivedItemsPayload>; notes: string } & SignedDecision) => Promise<unknown>;
}) {
    const lines = dispatchItemLines(receiveSourceItems(dispatch), { approved: true });
    const [rows, setRows] = useState<ReceiveRow[]>(() =>
        lines.map((line) => ({
            name: line.name,
            approvedQty: line.qty,
            catchWeight: line.catchWeight,
            approvedPackagingQty: line.packagingQty,
            receivedQty: String(line.qty),
            receivedPackagingQty: line.catchWeight ? String(line.packagingQty) : '',
        })),
    );
    const [notes, setNotes] = useState('');
    const [signature, setSignature] = useState<string | null>(null);
    const [error, setError] = useState('');
    const formId = 'erp-dispatch-receive-form';

    function update(index: number, field: 'receivedQty' | 'receivedPackagingQty', value: string): void {
        setRows((previous) => previous.map((row, position) => (position === index ? { ...row, [field]: value } : row)));
    }

    const drafts = rows.map((row) => ({
        name: row.name,
        approvedQty: row.approvedQty,
        receivedQty: row.receivedQty,
        catchWeight: row.catchWeight,
        approvedPackagingQty: row.approvedPackagingQty,
        receivedPackagingQty: row.receivedPackagingQty,
    }));

    async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (pending) {
            return;
        }
        const message = receiveDraftError(drafts);
        if (message) {
            setError(message);
            return;
        }
        const signatureMessage = decisionSignatureError(signature, signerName);
        if (signatureMessage) {
            setError(signatureMessage);
            return;
        }
        setError('');
        try {
            await onSubmit({
                items: receivedItemsPayload(drafts),
                notes,
                signatureData: signature ?? '',
                signerName,
            });
        } catch (cause) {
            setError(writeErrorMessage(cause, DISPATCH_TEXT.receiveFailed));
        }
    }

    return (
        <ActionsDialog
            title={`استلام إذن الصرف${deptNameOf(dispatch) ? ` — ${deptNameOf(dispatch)}` : ''}`}
            formId={formId}
            submitLabel="تأكيد الاستلام والتوقيع"
            pending={pending}
            onClose={onClose}
            onSubmit={(event) => void submit(event)}
        >
            <p className="rounded-md border border-info/40 bg-info-soft p-sm text-body-sm text-ink">
                الاستلام والتوقيع باسم حسابك فقط (<strong>{signerName || '—'}</strong>) — لا يمكن توقيع أي اسم آخر. راجع الكميات ثم أكّد. لا
                يمكن تسجيل الاستلام مرتين.
            </p>
            <ul className="flex flex-col gap-sm">
                {rows.map((row, index) => (
                    <li key={row.name} className="flex flex-wrap items-end gap-xs rounded-md border border-hairline p-xs">
                        <div className="flex min-w-40 flex-1 flex-col gap-xxs">
                            <span className="text-body-sm text-ink">{row.name}</span>
                            <span className="text-caption text-muted">
                                المعتمد: {formatQty(row.approvedQty)}
                                {row.catchWeight && row.approvedPackagingQty > 0 ? ` (${formatQty(row.approvedPackagingQty)} كرتون)` : ''}
                            </span>
                        </div>
                        <Input
                            label={row.catchWeight ? 'الوزن المستلم فعليًا (كجم)' : 'الكمية المستلمة'}
                            name={`received-${String(index)}`}
                            type="number"
                            min={0}
                            max={row.approvedQty}
                            step={0.001}
                            containerClassName="w-40"
                            value={row.receivedQty}
                            onChange={(event) => {
                                update(index, 'receivedQty', event.target.value);
                            }}
                        />
                        {row.catchWeight ? (
                            <Input
                                label="عدد الكراتين المستلمة"
                                name={`received-boxes-${String(index)}`}
                                type="number"
                                min={0}
                                step={1}
                                containerClassName="w-40"
                                value={row.receivedPackagingQty}
                                onChange={(event) => {
                                    update(index, 'receivedPackagingQty', event.target.value);
                                }}
                            />
                        ) : null}
                    </li>
                ))}
            </ul>
            <Textarea
                label="ملاحظات الاستلام"
                name="notes"
                rows={2}
                placeholder="أي عجز أو تلف أو ملاحظة عند الاستلام"
                value={notes}
                onChange={(event) => {
                    setNotes(event.target.value);
                }}
            />
            <SignaturePad
                label={`توقيع المستلم — ${signerName || '—'}`}
                name={signerName}
                testId="dispatch-signature"
                onChange={setSignature}
            />
            <FormMessage message={error} />
        </ActionsDialog>
    );
}

/* ── الشاشة ─────────────────────────────────────────────────────────────── */

type ActiveDialog =
    | { kind: 'create' }
    | { kind: 'edit'; dispatch: Dispatch }
    | { kind: 'chef-approve'; dispatch: Dispatch }
    | { kind: 'chef-reject'; dispatch: Dispatch }
    | { kind: 'approve'; dispatch: Dispatch }
    | { kind: 'reject'; dispatch: Dispatch }
    | { kind: 'receive'; dispatch: Dispatch }
    | { kind: 'reopen'; dispatch: Dispatch };

function ReopenDialog({
    dispatch,
    pending,
    onClose,
    onSubmit,
}: {
    dispatch: Dispatch;
    pending: boolean;
    onClose: () => void;
    onSubmit: (reason: string) => Promise<unknown>;
}) {
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');
    const formId = 'erp-dispatch-reopen-form';

    async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (pending) {
            return;
        }
        const cleanReason = reason.trim();
        if (!cleanReason) {
            setError(DISPATCH_TEXT.reopenReasonRequired);
            return;
        }
        setError('');
        try {
            await onSubmit(cleanReason);
        } catch (cause) {
            setError(writeErrorMessage(cause, DISPATCH_TEXT.reopenFailed));
        }
    }

    return (
        <ActionsDialog
            title={`إرجاع الإذن للمخازن للتعديل — #${dispatch.id}`}
            formId={formId}
            submitLabel="إرجاع للمخازن"
            pending={pending}
            onClose={onClose}
            onSubmit={(event) => void submit(event)}
        >
            <p className="rounded-md border border-warning/40 bg-warning-soft p-sm text-body-sm text-ink">
                سيُعكس خصم المخزون وتكلفة القسم ويُلغى اعتماد المخازن وتوقيعه. بعد الإرجاع يمكن تعديل الإذن وإعادة إرساله في دورة الاعتماد من
                جديد. لا يمكن تنفيذ ذلك بعد تسجيل أي استلام.
            </p>
            <Textarea
                label="سبب الإرجاع (إلزامي)"
                name="reopen-reason"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(event) => {
                    setReason(event.target.value);
                }}
            />
            <FormMessage message={error} />
        </ActionsDialog>
    );
}

export function Dispatches() {
    const [scope, setScope] = useState<DispatchScope>('month');
    const [from, setFrom] = useState(firstOfMonth());
    const [to, setTo] = useState(riyadhToday());
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('ALL');
    const [page, setPage] = useState(1);
    const [active, setActive] = useState<ActiveDialog | null>(null);
    const [pageError, setPageError] = useState('');

    const auth = useAuthState();
    const role = auth.user?.role ?? '';
    const signerName = String(auth.user?.name ?? auth.user?.username ?? '').trim();
    const gateUser: GateUser = {
        id: auth.user?.id ?? null,
        deptCode: (auth.user as (typeof auth.user & { deptCode?: string | null }) | null)?.deptCode ?? null,
    };
    const canCreate = canCreateDispatch(role);
    const confirm = useConfirm();
    const { toast } = useToast();

    const dispatchesQuery = useQuery({
        queryKey: ['dispatches', scope],
        queryFn: ({ signal }) => fetchDispatches(scope, signal),
    });

    /* ── الكتابات: بوابة واحدة لكل عملية، والنصّ/الإبطال كما في V2 ───────── */

    const createMutation = useWriteMutation<CreateDispatchPayload, void>({
        mutationFn: (payload) => createDispatch(payload),
        successTitle: () => createSuccessText(role),
        invalidate: [['dispatches']],
        silentError: true,
        onSuccess: () => {
            setActive(null);
        },
    });

    const editMutation = useWriteMutation<{ dispatch: Dispatch; payload: EditDispatchPayload }, { chefApprovalReset: boolean }>({
        mutationFn: ({ dispatch, payload }) => editDispatch(dispatch.id, payload),
        invalidate: [['dispatches']],
        silentError: true,
        onSuccess: (data) => {
            setActive(null);
            toast({ title: editSuccessText(data.chefApprovalReset), variant: 'success' });
        },
    });

    const chefApproveMutation = useWriteMutation<{ dispatch: Dispatch; body: ChefApproveBody }, void>({
        mutationFn: ({ dispatch, body }) => chefApproveDispatch(dispatch.id, body),
        successTitle: DISPATCH_TEXT.chefApproved,
        invalidate: [['dispatches']],
        silentError: true,
        onSuccess: () => {
            setActive(null);
        },
    });

    const chefRejectMutation = useWriteMutation<{ dispatch: Dispatch; body: RejectBody }, void>({
        mutationFn: ({ dispatch, body }) => chefRejectDispatch(dispatch.id, body),
        successTitle: DISPATCH_TEXT.chefRejected,
        invalidate: [['dispatches']],
        silentError: true,
        onSuccess: () => {
            setActive(null);
        },
    });

    const approveMutation = useWriteMutation<{ dispatch: Dispatch; body: ApproveBody }, ApproveDispatchResult>({
        mutationFn: ({ dispatch, body }) => approveDispatch(dispatch.id, body),
        invalidate: [['dispatches'], ['inventory'], ['expenses']],
        silentError: true,
        onSuccess: (data) => {
            setActive(null);
            toast({ title: approveSuccessText(data.totalValue), variant: 'success' });
        },
    });

    const rejectMutation = useWriteMutation<{ dispatch: Dispatch; body: RejectBody }, void>({
        mutationFn: ({ dispatch, body }) => rejectDispatch(dispatch.id, body),
        successTitle: DISPATCH_TEXT.rejected,
        invalidate: [['dispatches']],
        silentError: true,
        onSuccess: () => {
            setActive(null);
        },
    });

    const receiveMutation = useWriteMutation<
        { dispatch: Dispatch; body: { items: ReturnType<typeof receivedItemsPayload>; notes: string } & SignedDecision },
        void
    >({
        mutationFn: ({ dispatch, body }) => receiveDispatch(dispatch.id, body),
        successTitle: DISPATCH_TEXT.received,
        invalidate: [['dispatches'], ['inventory']],
        silentError: true,
        onSuccess: () => {
            setActive(null);
        },
    });

    const deleteMutation = useWriteMutation<Dispatch, void>({
        mutationFn: (dispatch) => deleteDispatch(dispatch.id),
        successTitle: (dispatch) => deleteSuccessText(role, String(dispatch.status ?? '')),
        invalidate: [['dispatches'], ['inventory']],
        silentError: true,
        onError: (cause) => {
            setPageError(writeErrorMessage(cause, DISPATCH_TEXT.deleteFailed));
        },
    });

    const reopenMutation = useWriteMutation<{ dispatch: Dispatch; reason: string }, void>({
        mutationFn: ({ dispatch, reason }) => reopenDispatch(dispatch.id, reason),
        successTitle: DISPATCH_TEXT.reopenSuccess,
        invalidate: [['dispatches'], ['inventory'], ['expenses']],
        silentError: true,
        onSuccess: () => {
            setActive(null);
        },
    });

    const rangeInvalid = Boolean(from && to && from > to);
    const allRows = useMemo(() => (dispatchesQuery.data ?? []).map(dispatchToRow), [dispatchesQuery.data]);
    const rawById = useMemo(() => new Map((dispatchesQuery.data ?? []).map((dispatch) => [dispatch.id, dispatch])), [dispatchesQuery.data]);

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
            if (status !== 'ALL' && row.status !== status) {
                return false;
            }
            return matchDispatchProduct(row, search);
        });
    }, [allRows, from, to, search, status, rangeInvalid]);

    const counts = useMemo(() => summarizeDispatches(rows), [rows]);
    const withdrawal = useMemo(() => summarizeProductWithdrawal(rows, search), [rows, search]);

    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const cap = scope === 'all' ? MAX_PAGES_ALL : MAX_PAGES_MONTH;
    const capped = (dispatchesQuery.data?.length ?? 0) >= 1000 * cap;

    const showActions = pageRows.some((row) => {
        const raw = rawById.get(row.id);
        return raw ? anyActionVisible(role, dispatchGate(raw), gateUser) : false;
    });

    const statesLine = Object.entries(counts)
        .map(([key, value]) => `${statusOf(key).label} ${formatInt(value)}`)
        .join(' · ');
    const topProducts = [...withdrawal.byName.entries()]
        .slice(0, 3)
        .map(([name, qty]) => `${name} (${formatQty(qty)})`)
        .join(' · ');

    function resetFilters() {
        setFrom('');
        setTo('');
        setSearch('');
        setStatus('ALL');
        setPage(1);
    }

    /** أزرار الصف — نفس شروط V2 وحالاتها وقائمة أدوارها. */
    function actionsFor(dispatch: Dispatch): ReactNode {
        const row: DispatchGateRow = dispatchGate(dispatch);
        const buttons: ReactNode[] = [];
        const id = row.id;
        if (editVisible(role, row, gateUser)) {
            buttons.push(
                <Button
                    key="edit"
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`تعديل — إذن #${id}`}
                    onClick={() => {
                        setActive({ kind: 'edit', dispatch });
                    }}
                >
                    تعديل
                </Button>,
            );
        }
        if (reopenVisible(role, row)) {
            buttons.push(
                <Button
                    key="reopen"
                    type="button"
                    size="sm"
                    variant="secondary"
                    aria-label={`إرجاع للمخازن للتعديل — إذن #${id}`}
                    onClick={() => {
                        setActive({ kind: 'reopen', dispatch });
                    }}
                >
                    إرجاع للتعديل
                </Button>,
            );
        }
        if (chefActionsVisible(role, row)) {
            buttons.push(
                <Button
                    key="chef-approve"
                    type="button"
                    size="sm"
                    aria-label={`اعتماد الشيف — إذن #${id}`}
                    onClick={() => {
                        setActive({ kind: 'chef-approve', dispatch });
                    }}
                >
                    اعتماد الشيف
                </Button>,
                <Button
                    key="chef-reject"
                    type="button"
                    size="sm"
                    variant="danger"
                    aria-label={`رفض الشيف — إذن #${id}`}
                    onClick={() => {
                        setActive({ kind: 'chef-reject', dispatch });
                    }}
                >
                    رفض
                </Button>,
            );
        }
        if (warehouseActionsVisible(role, row)) {
            buttons.push(
                <Button
                    key="approve"
                    type="button"
                    size="sm"
                    aria-label={`اعتماد وصرف — إذن #${id}`}
                    onClick={() => {
                        setActive({ kind: 'approve', dispatch });
                    }}
                >
                    اعتماد وصرف
                </Button>,
                <Button
                    key="reject"
                    type="button"
                    size="sm"
                    variant="danger"
                    aria-label={`رفض المخازن — إذن #${id}`}
                    onClick={() => {
                        setActive({ kind: 'reject', dispatch });
                    }}
                >
                    رفض
                </Button>,
            );
        }
        if (receiveVisible(role, row, gateUser)) {
            buttons.push(
                <Button
                    key="receive"
                    type="button"
                    size="sm"
                    aria-label={`استلام — إذن #${id}`}
                    onClick={() => {
                        setActive({ kind: 'receive', dispatch });
                    }}
                >
                    استلام
                </Button>,
            );
        }
        if (deleteVisible(role, row)) {
            buttons.push(
                <Button
                    key="delete"
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={deleteMutation.isPending}
                    aria-label={`حذف — إذن #${id}`}
                    onClick={() => {
                        void handleDelete(dispatch);
                    }}
                >
                    حذف
                </Button>,
            );
        }
        return buttons;
    }

    async function handleDelete(dispatch: Dispatch): Promise<void> {
        if (deleteMutation.isPending) {
            return;
        }
        setPageError('');
        const row = dispatchGate(dispatch);
        const confirmed = await confirm(deleteConfirmText(role, row.status, statusOf(row.status).label));
        if (!confirmed) {
            return;
        }
        deleteMutation.mutate(dispatch);
    }

    return (
        <div className="erp-premium-screen flex flex-col gap-md">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        أذون الصرف{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Dispatch Orders
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">
                        سجل أذون الصرف ودورة قرارها كاملة (إنشاء · اعتماد الشيف · اعتماد المخازن · استلام بالتوقيع · تعديل · إرجاع المعتمد
                        قبل الاستلام للتعديل · حذف).
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-xs" data-erp-print-hide>
                    {canCreate ? (
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                                setPageError('');
                                setActive({ kind: 'create' });
                            }}
                        >
                            طلب صرف جديد
                        </Button>
                    ) : null}
                    <PrintActions title="أذون الصرف" />
                    <button
                        type="button"
                        onClick={() => {
                            void dispatchesQuery.refetch();
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
                <Kpi label="الأذون المعروضة" english="Dispatches" value={formatInt(rows.length)} hint="بعد المرشّحات" />
                <Kpi
                    label="بانتظار الاعتماد"
                    english="Pending"
                    value={formatInt(counts.pending ?? 0)}
                    hint={DISPATCH_STATUS.pending.label}
                />
                <Kpi
                    label="معتمد بانتظار الاستلام"
                    english="Approved"
                    value={formatInt(counts.approved ?? 0)}
                    hint={DISPATCH_STATUS.approved.label}
                />
                <Kpi label="مستلم ومغلق" english="Received" value={formatInt(counts.received ?? 0)} hint={DISPATCH_STATUS.received.label} />
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-dispatch-scope">
                        النطاق
                        <select
                            id="erp-dispatch-scope"
                            value={scope}
                            onChange={(event) => {
                                setScope(event.target.value === 'all' ? 'all' : 'month');
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            <option value="month">الشهر الحالي</option>
                            <option value="all">كل السجل</option>
                        </select>
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-dispatch-from">
                        من
                        <input
                            id="erp-dispatch-from"
                            type="date"
                            value={from}
                            max={riyadhToday()}
                            onChange={(event) => {
                                setFrom(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-dispatch-to">
                        إلى
                        <input
                            id="erp-dispatch-to"
                            type="date"
                            value={to}
                            max={riyadhToday()}
                            onChange={(event) => {
                                setTo(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <label className="flex min-w-56 flex-1 flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-dispatch-search">
                        بحث بالصنف
                        <input
                            id="erp-dispatch-search"
                            type="search"
                            value={search}
                            placeholder="ابحث باسم صنف مسحوب… (مثال: دجاج)"
                            onChange={(event) => {
                                setSearch(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-dispatch-status">
                        الحالة
                        <select
                            id="erp-dispatch-status"
                            value={status}
                            onChange={(event) => {
                                setStatus(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            <option value="ALL">كل الحالات</option>
                            {Object.entries(DISPATCH_STATUS).map(([key, entry]) => (
                                <option key={key} value={key}>
                                    {entry.label}
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
                    <span className="text-body-sm text-muted">{formatInt(rows.length)} إذنًا</span>
                </div>
                {rangeInvalid ? (
                    <p role="alert" className="mt-sm text-body-sm text-danger-text">
                        بداية الفترة بعد نهايتها — صحّح التاريخين قبل العرض.
                    </p>
                ) : null}
            </Card>

            <Card>
                {dispatchesQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل أذون الصرف" />
                        <TableSkeleton rows={6} columns={7} />
                    </div>
                ) : null}

                {dispatchesQuery.isError ? (
                    <StateError
                        message={dispatchesQuery.error instanceof Error ? dispatchesQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void dispatchesQuery.refetch();
                        }}
                    />
                ) : null}

                {!dispatchesQuery.isPending && !dispatchesQuery.isError && rows.length === 0 ? (
                    <StateEmpty
                        title="لا أذون"
                        hint={
                            rangeInvalid
                                ? 'صحّح التاريخين أولًا.'
                                : 'لا إذن يطابق الفترة أو الحالة أو بحث الصنف — وسّع النطاق أو امسح المرشّحات.'
                        }
                    />
                ) : null}

                {!dispatchesQuery.isPending && !dispatchesQuery.isError && rows.length > 0 ? (
                    <>
                        <p className="border-b border-hairline px-sm py-xs text-body-sm text-muted" role="status">
                            {`${formatInt(rows.length)} إذنًا${statesLine ? ` · ${statesLine}` : ''}`}
                            {` · ${scope === 'all' ? 'كل السجل' : 'الشهر الحالي'}`}
                            {search ? ` · نتائج «${search}»: ${formatInt(withdrawal.vouchers)} إذنًا` : ''}
                            {topProducts ? ` — الكميات المعتمدة: ${topProducts}` : ''}
                        </p>
                        <TableScroll label="جدول أذون الصرف">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" className="px-sm py-xs text-end font-medium">
                                            الإذن
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            القسم
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الأصناف والكميات
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-center font-medium">
                                            التاريخ
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الحالة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الطالب
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            المستلم
                                        </th>
                                        {showActions ? (
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                إجراءات
                                            </th>
                                        ) : null}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row: DispatchRow) => {
                                        const raw = rawById.get(row.id);
                                        return (
                                            <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                                <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                    #{row.id}
                                                </td>
                                                <td className="px-sm py-xxs text-ink">{row.dept}</td>
                                                <td className="px-sm py-xxs text-body-sm text-ink-secondary">{row.itemsText || '—'}</td>
                                                <td className="erp-numeric px-sm py-xxs text-center text-body-sm text-muted" dir="ltr">
                                                    {row.date || '—'}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm">
                                                    <span className={TONE_CLASS[row.statusTone]}>
                                                        {row.statusLabel}
                                                        {row.status && !row.statusKnown ? (
                                                            <span className="text-caption text-faint" dir="ltr">
                                                                {' '}
                                                                ({row.status})
                                                            </span>
                                                        ) : null}
                                                    </span>
                                                    {row.stage ? <span className="block text-caption text-muted">{row.stage}</span> : null}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">{row.by}</td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">{row.receivedBy || '—'}</td>
                                                {showActions ? (
                                                    <td className="px-sm py-xxs">
                                                        <div className="flex flex-wrap items-center justify-end gap-xxs">
                                                            {raw ? actionsFor(raw) : null}
                                                        </div>
                                                    </td>
                                                ) : null}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </TableScroll>

                        <div className="flex items-center justify-between gap-sm border-t border-hairline px-sm py-xs">
                            <span className="text-body-sm text-muted">
                                صفحة {formatInt(safePage)} من {formatInt(pageCount)}
                                {capped ? ` · الخادم أعاد أول ${formatInt(1000 * cap)} إذنًا فقط` : ''}
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

            {active?.kind === 'create' ? (
                <RequestDialog
                    mode="create"
                    dispatch={null}
                    role={role}
                    pending={createMutation.isPending}
                    onClose={() => {
                        setActive(null);
                    }}
                    onCreate={(payload) => createMutation.mutateAsync(payload)}
                    onEdit={() => Promise.resolve()}
                />
            ) : null}

            {active?.kind === 'edit' ? (
                <RequestDialog
                    mode="edit"
                    dispatch={active.dispatch}
                    role={role}
                    pending={editMutation.isPending}
                    onClose={() => {
                        setActive(null);
                    }}
                    onCreate={() => Promise.resolve()}
                    onEdit={(payload) => editMutation.mutateAsync({ dispatch: active.dispatch, payload })}
                />
            ) : null}

            {active?.kind === 'chef-approve' ? (
                <ChefApproveDialog
                    dispatch={active.dispatch}
                    signerName={signerName}
                    pending={chefApproveMutation.isPending}
                    onClose={() => {
                        setActive(null);
                    }}
                    onSubmit={(body) => chefApproveMutation.mutateAsync({ dispatch: active.dispatch, body })}
                />
            ) : null}

            {active?.kind === 'chef-reject' ? (
                <RejectDialog
                    kind="chef-reject"
                    dispatch={active.dispatch}
                    signerName={signerName}
                    pending={chefRejectMutation.isPending}
                    onClose={() => {
                        setActive(null);
                    }}
                    onSubmit={(body) => chefRejectMutation.mutateAsync({ dispatch: active.dispatch, body })}
                />
            ) : null}

            {active?.kind === 'approve' ? (
                <ApproveDialog
                    dispatch={active.dispatch}
                    signerName={signerName}
                    pending={approveMutation.isPending}
                    onClose={() => {
                        setActive(null);
                    }}
                    onSubmit={(body) => approveMutation.mutateAsync({ dispatch: active.dispatch, body })}
                />
            ) : null}

            {active?.kind === 'reject' ? (
                <RejectDialog
                    kind="reject"
                    dispatch={active.dispatch}
                    signerName={signerName}
                    pending={rejectMutation.isPending}
                    onClose={() => {
                        setActive(null);
                    }}
                    onSubmit={(body) => rejectMutation.mutateAsync({ dispatch: active.dispatch, body })}
                />
            ) : null}

            {active?.kind === 'receive' ? (
                <ReceiveDialog
                    dispatch={active.dispatch}
                    signerName={signerName}
                    pending={receiveMutation.isPending}
                    onClose={() => {
                        setActive(null);
                    }}
                    onSubmit={(body) => receiveMutation.mutateAsync({ dispatch: active.dispatch, body })}
                />
            ) : null}

            {active?.kind === 'reopen' ? (
                <ReopenDialog
                    dispatch={active.dispatch}
                    pending={reopenMutation.isPending}
                    onClose={() => {
                        setActive(null);
                    }}
                    onSubmit={(reason) => reopenMutation.mutateAsync({ dispatch: active.dispatch, reason })}
                />
            ) : null}
        </div>
    );
}
