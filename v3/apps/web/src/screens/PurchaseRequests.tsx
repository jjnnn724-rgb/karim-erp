import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { fetchDepartments } from '../lib/finance';
import {
    fetchPurchaseRequests,
    fetchShortages,
    PR_LIST_CAP,
    PR_STATUS_LABELS,
    PR_STATUS_ORDER,
    type PurchaseRequest,
    type PurchaseRequestRow,
    purchaseRequestToRow,
    type ShortageRow,
    shortageToRow,
    summarizePR,
} from '../lib/purchase-requests';
import {
    accountSignatureName,
    cancelPR,
    cancelVisible,
    chefActionsVisible,
    chefApprovePR,
    chefRejectPR,
    collectPRItems,
    createPR,
    deletePR,
    deleteVisible,
    filterPRDeptOptions,
    gmActionsVisible,
    gmApprovePR,
    gmRejectPR,
    isChefCreator,
    PR_WRITE_TEXT,
    type PRCreatePayload,
    type PRDecisionKind,
    type PRNotesPayload,
    type PRRejectPayload,
    prCanCreate,
    prCreateError,
    prCreatePayload,
    prCreateSuccess,
    prDecisionFailure,
    prDecisionSubmitLabel,
    prDecisionSuccess,
    prDecisionTitle,
    prNotesPayload,
    prReasonError,
    prRejectPayload,
    revertToChefApprovedPR,
    revertVisible,
} from '../lib/purchase-requests-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Dialog } from '../ui/Dialog';
import { SignaturePad } from '../ui/SignaturePad';
import { useToast } from '../ui/Toast';

/**
 * طلبات شراء النواقص — قراءة من `/api/warehouse/purchase-requests` وكتابة
 * مطابقة لدورة V2 كاملة (7 عمليات): إنشاء طلب، توقيع/رفض الشيف،
 * اعتماد/رفض المدير العام، إلغاء معلّق، وحذف نهائي.
 *
 * الأبواب والأدوار والنصوص منقولة حرفيًّا من `v2/data/pr-repo.js` و
 * `v2/screens/wh-prs.js` (انظر `lib/purchase-requests-write.ts`). القراءة لم
 * تتغيّر: نفس نافذة أحدث 200 طلب، وشرائح الحالة، والأعمدة، والنواقص الاستشارية.
 *
 * التواقيع كما في القديم: لوحة مقفلة باسم صاحب الحساب (لا اسم آخر)، ويحسمها
 * الخادم (`requireSignature`) — فلا يُرسَل قرار بلا `signatureData` و`signerName`.
 */

const PAGE_SIZE = 20;

type SortKey = 'number' | 'status' | 'by' | 'created';

const STATUS_TONE: Record<string, string> = {
    pending: 'text-ink-secondary',
    chef_approved: 'text-ink-secondary',
    approved: 'text-success-text',
    partially_fulfilled: 'text-ink-secondary',
    fulfilled: 'text-success-text',
    rejected: 'text-danger-text',
    cancelled: 'text-danger-text',
};

const INPUT_CLASS = 'h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink aria-[invalid=true]:border-danger';
const BUTTON_CLASS =
    'rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50';
const PRIMARY_BUTTON_CLASS =
    'rounded-md border border-primary-active/40 bg-primary px-sm py-xxs text-body-sm text-on-primary hover:bg-primary-hover disabled:opacity-50';
const DANGER_BUTTON_CLASS =
    'rounded-md border border-danger/50 bg-surface px-sm py-xxs text-body-sm text-danger-text hover:bg-danger-soft disabled:opacity-50';

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

function compare(a: PurchaseRequestRow, b: PurchaseRequestRow, key: SortKey): number {
    if (key === 'status') {
        return a.statusLabel.localeCompare(b.statusLabel, 'ar');
    }
    if (key === 'by') {
        return a.by.localeCompare(b.by, 'ar');
    }
    if (key === 'created') {
        return a.created.localeCompare(b.created);
    }
    return a.number.localeCompare(b.number, 'ar', { numeric: true });
}

/* ── أزرار الصف السياقية — نفس ترتيب وشروط V2 (`wh-prs.js:219-235`) ────── */

function RowActions({
    request,
    role,
    pending,
    onDecision,
    onCancel,
    onDelete,
}: {
    request: PurchaseRequest;
    role: string;
    pending: boolean;
    onDecision: (kind: PRDecisionKind, raw: PurchaseRequest) => void;
    onCancel: (raw: PurchaseRequest) => void;
    onDelete: (raw: PurchaseRequest) => void;
}) {
    const status = String(request.status ?? '');
    const number = request.request_number ? String(request.request_number) : `#${request.id}`;
    const buttons: { key: string; label: string; ariaLabel: string; className: string; run: () => void }[] = [];

    if (chefActionsVisible(role, status)) {
        buttons.push({
            key: 'chef-approve',
            label: 'توقيع الشيف',
            ariaLabel: `توقيع الشيف ${number}`,
            className: PRIMARY_BUTTON_CLASS,
            run: () => {
                onDecision('chef-approve', request);
            },
        });
        buttons.push({
            key: 'chef-reject',
            label: 'رفض',
            ariaLabel: `رفض الشيف ${number}`,
            className: DANGER_BUTTON_CLASS,
            run: () => {
                onDecision('chef-reject', request);
            },
        });
    }
    if (gmActionsVisible(role, status)) {
        buttons.push({
            key: 'gm-approve',
            label: 'اعتماد المدير العام',
            ariaLabel: `اعتماد المدير العام ${number}`,
            className: PRIMARY_BUTTON_CLASS,
            run: () => {
                onDecision('gm-approve', request);
            },
        });
        buttons.push({
            key: 'gm-reject',
            label: 'رفض',
            ariaLabel: `رفض المدير العام ${number}`,
            className: DANGER_BUTTON_CLASS,
            run: () => {
                onDecision('gm-reject', request);
            },
        });
    }
    if (cancelVisible(role, status)) {
        buttons.push({
            key: 'cancel',
            label: 'إلغاء',
            ariaLabel: `إلغاء ${number}`,
            className: DANGER_BUTTON_CLASS,
            run: () => {
                onCancel(request);
            },
        });
    }
    if (deleteVisible(role, status)) {
        buttons.push({
            key: 'delete',
            label: 'حذف نهائي',
            ariaLabel: `حذف نهائي ${number}`,
            className: DANGER_BUTTON_CLASS,
            run: () => {
                onDelete(request);
            },
        });
    }
    if (revertVisible(role, status)) {
        buttons.push({
            key: 'revert-to-chef-approved',
            label: 'إعادة للتصحيح',
            ariaLabel: `إعادة طلب ${number} إلى chef_approved`,
            className: PRIMARY_BUTTON_CLASS,
            run: () => {
                onDecision('revert-to-chef-approved', request);
            },
        });
    }
    if (buttons.length === 0) {
        return null;
    }
    return (
        <div className="flex flex-wrap items-center gap-xxs">
            {buttons.map((button) => (
                <button
                    key={button.key}
                    type="button"
                    aria-label={button.ariaLabel}
                    disabled={pending}
                    onClick={button.run}
                    className={button.className}
                >
                    {button.label}
                </button>
            ))}
        </div>
    );
}

/* ── لوحة الإنشاء: نواقص مختارة + صفوف يدوية + قسم طالب + ملاحظات + توقيع ── */

interface ShortageDraft {
    itemId: string;
    itemName: string;
    unit: string;
    qty: string;
    selected: boolean;
}

interface ManualDraft {
    key: number;
    name: string;
    unit: string;
    qty: string;
}

const CREATE_FORM_ID = 'erp-pr-create-form';
const DECISION_FORM_ID = 'erp-pr-decision-form';

function CreateRequestDialog({
    open,
    chef,
    signerName,
    shortages,
    departments,
    pending,
    error,
    onClose,
    onSubmit,
}: {
    open: boolean;
    chef: boolean;
    signerName: string;
    shortages: readonly ShortageRow[];
    departments: readonly { code: string; name: string }[];
    pending: boolean;
    error: string;
    onClose: () => void;
    onSubmit: (payload: PRCreatePayload) => void;
}) {
    const [drafts, setDrafts] = useState<ShortageDraft[]>([]);
    const [manual, setManual] = useState<ManualDraft[]>([]);
    const [deptCode, setDeptCode] = useState('');
    const [notes, setNotes] = useState('');
    const [localError, setLocalError] = useState('');
    const signatureRef = useRef<string | null>(null);
    const manualSeq = useRef(0);

    useEffect(() => {
        if (!open) {
            return;
        }
        setNotes('');
        setLocalError('');
        setManual([]);
        setDeptCode('');
        setDrafts(
            shortages.map((row) => ({
                itemId: String(row.itemId),
                itemName: row.itemName,
                unit: row.unit,
                qty: String(row.suggestedQty || 0),
                selected: true,
            })),
        );
    }, [open, shortages]);

    useEffect(() => {
        if (!open) {
            return;
        }
        setDeptCode((previous) => previous || departments[0]?.code || '');
    }, [open, departments]);

    const allSelected = drafts.length > 0 && drafts.every((draft) => draft.selected);

    function toggleAll(checked: boolean): void {
        setDrafts((previous) => previous.map((draft) => ({ ...draft, selected: checked })));
    }

    function updateDraft(index: number, patch: Partial<ShortageDraft>): void {
        setDrafts((previous) => previous.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
    }

    function addManual(): void {
        manualSeq.current += 1;
        setManual((previous) => [...previous, { key: manualSeq.current, name: '', unit: 'وحدة', qty: '0' }]);
    }

    function updateManual(key: number, patch: Partial<ManualDraft>): void {
        setManual((previous) => previous.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    }

    function removeManual(key: number): void {
        setManual((previous) => previous.filter((row) => row.key !== key));
    }

    function submit(event: React.FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        if (pending) {
            return;
        }
        const items = collectPRItems(
            drafts
                .filter((draft) => draft.selected)
                .map((draft) => ({
                    itemId: draft.itemId,
                    itemName: draft.itemName,
                    unit: draft.unit,
                    qty: draft.qty,
                })),
            manual.map((row) => ({ name: row.name, unit: row.unit, qty: row.qty })),
        );
        const itemError = prCreateError(items);
        if (itemError) {
            setLocalError(itemError);
            return;
        }
        let signatureData: string | null = null;
        if (chef) {
            signatureData = signatureRef.current;
            if (!signatureData) {
                setLocalError(PR_WRITE_TEXT.signatureFailed);
                return;
            }
        }
        setLocalError('');
        onSubmit(
            prCreatePayload({
                items,
                notes,
                deptCode,
                signatureData,
                signerName: chef ? signerName : null,
            }),
        );
    }

    const banner = chef
        ? 'توقيعك على الطلب يجعله نهائيًا ويوصله للمخزن مباشرة — أمين المخزن يطبعه وينفذه فورًا (بدون مرحلة المدير العام).'
        : 'علّم على أصناف النواقص وعدّل الكمية المطلوبة، أو أضف أصنافًا يدويًا — بعد الإنشاء يوقّع الشيف ثم يعتمد المدير العام نهائيًا.';

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title={PR_WRITE_TEXT.createTitle}
            size="lg"
            footer={
                <>
                    <button type="button" onClick={onClose} className={BUTTON_CLASS}>
                        {PR_WRITE_TEXT.cancelAction}
                    </button>
                    <button type="submit" form={CREATE_FORM_ID} disabled={pending} className={PRIMARY_BUTTON_CLASS}>
                        {chef ? PR_WRITE_TEXT.createSubmitChef : PR_WRITE_TEXT.createSubmit}
                    </button>
                </>
            }
        >
            <form
                id={CREATE_FORM_ID}
                onSubmit={(event) => {
                    submit(event);
                }}
                className="flex flex-col gap-sm"
            >
                <p className="rounded-md border border-hairline bg-surface-sunken p-sm text-body-sm text-ink-secondary">{banner}</p>
                {error || localError ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error || localError}
                    </p>
                ) : null}

                <section className="flex flex-col gap-xs">
                    <h3 className="text-heading-sm text-ink">نواقص المخزن</h3>
                    {drafts.length === 0 ? (
                        <p className="text-body-sm text-muted">{PR_WRITE_TEXT.noShortages}</p>
                    ) : (
                        <div className="max-h-64 overflow-y-auto rounded-md border border-hairline">
                            <table className="w-full border-collapse text-body-sm">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            <input
                                                type="checkbox"
                                                aria-label="تحديد كل النواقص"
                                                checked={allSelected}
                                                onChange={(event) => {
                                                    toggleAll(event.target.checked);
                                                }}
                                            />
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الصنف
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الوحدة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-end font-medium">
                                            الرصيد
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-end font-medium">
                                            الحد الأدنى
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-end font-medium">
                                            المطلوب شراؤه
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {drafts.map((draft, index) => (
                                        <tr key={draft.itemId} className="border-t border-hairline">
                                            <td className="px-sm py-xxs">
                                                <input
                                                    type="checkbox"
                                                    aria-label={`اختيار ${draft.itemName}`}
                                                    checked={draft.selected}
                                                    onChange={(event) => {
                                                        updateDraft(index, { selected: event.target.checked });
                                                    }}
                                                />
                                            </td>
                                            <td className="px-sm py-xxs text-ink">{draft.itemName}</td>
                                            <td className="px-sm py-xxs text-muted">{draft.unit}</td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-danger-text" dir="ltr">
                                                {formatQty(shortages[index]?.currentQty ?? 0)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-muted" dir="ltr">
                                                {formatQty(shortages[index]?.minQty ?? 0)}
                                            </td>
                                            <td className="px-sm py-xxs text-end">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    step={0.001}
                                                    aria-label={`الكمية المطلوبة من ${draft.itemName}`}
                                                    value={draft.qty}
                                                    onChange={(event) => {
                                                        updateDraft(index, { qty: event.target.value });
                                                    }}
                                                    className={`${INPUT_CLASS} w-24 text-end`}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>

                <section className="flex flex-col gap-xs">
                    <div className="flex items-center justify-between gap-sm">
                        <h3 className="text-heading-sm text-ink">إضافة يدوية</h3>
                        <button type="button" onClick={addManual} className={BUTTON_CLASS}>
                            صف جديد
                        </button>
                    </div>
                    {manual.map((row, index) => (
                        <div key={row.key} className="flex flex-wrap items-end gap-xs">
                            <input
                                type="text"
                                aria-label={`اسم الصنف اليدوي ${index + 1}`}
                                placeholder="اسم الصنف"
                                value={row.name}
                                onChange={(event) => {
                                    updateManual(row.key, { name: event.target.value });
                                }}
                                className={`${INPUT_CLASS} min-w-48 flex-1`}
                            />
                            <input
                                type="text"
                                aria-label={`وحدة الصنف اليدوي ${index + 1}`}
                                value={row.unit}
                                onChange={(event) => {
                                    updateManual(row.key, { unit: event.target.value });
                                }}
                                className={`${INPUT_CLASS} w-24`}
                            />
                            <input
                                type="number"
                                min={0}
                                step={0.001}
                                aria-label={`الكمية المطلوبة للصنف اليدوي ${index + 1}`}
                                value={row.qty}
                                onChange={(event) => {
                                    updateManual(row.key, { qty: event.target.value });
                                }}
                                className={`${INPUT_CLASS} w-28`}
                            />
                            <button
                                type="button"
                                aria-label={`حذف الصف اليدوي ${index + 1}`}
                                onClick={() => {
                                    removeManual(row.key);
                                }}
                                className={DANGER_BUTTON_CLASS}
                            >
                                حذف الصف
                            </button>
                        </div>
                    ))}
                </section>

                <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                    {PR_WRITE_TEXT.deptLabel}
                    <select
                        value={deptCode}
                        onChange={(event) => {
                            setDeptCode(event.target.value);
                        }}
                        aria-label={PR_WRITE_TEXT.deptLabel}
                        className={INPUT_CLASS}
                    >
                        <option value="">بدون قسم طالب</option>
                        {departments.map((department) => (
                            <option key={department.code} value={department.code}>
                                {department.name || department.code}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                    {PR_WRITE_TEXT.notesLabel}
                    <textarea
                        rows={2}
                        value={notes}
                        aria-label={PR_WRITE_TEXT.notesLabel}
                        placeholder="مثال: أولوية للسلطات قبل نهاية الأسبوع"
                        onChange={(event) => {
                            setNotes(event.target.value);
                        }}
                        className={`${INPUT_CLASS} min-h-16 py-xs leading-normal`}
                    />
                </label>

                {chef ? (
                    <SignaturePad
                        label="توقيع الشيف على الطلب"
                        name={signerName}
                        onChange={(value) => {
                            signatureRef.current = value;
                        }}
                    />
                ) : null}
            </form>
        </Dialog>
    );
}

/* ── لوحات القرار: توقيع/رفض الشيف، اعتماد/رفض المدير العام ─────────────── */

function DecisionDialog({
    open,
    decision,
    signerName,
    pending,
    error,
    onClose,
    onSubmit,
}: {
    open: boolean;
    decision: { kind: PRDecisionKind; raw: PurchaseRequest } | null;
    signerName: string;
    pending: boolean;
    error: string;
    onClose: () => void;
    onSubmit: (kind: PRDecisionKind, raw: PurchaseRequest, fields: { notes: string; reason: string; signatureData: string }) => void;
}) {
    const [notes, setNotes] = useState('');
    const [reason, setReason] = useState('');
    const [localError, setLocalError] = useState('');
    const signatureRef = useRef<string | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        setNotes('');
        setReason('');
        setLocalError('');
    }, [open]);

    if (!decision) {
        return null;
    }
    const { kind, raw } = decision;
    const number = raw.request_number ? String(raw.request_number) : `#${raw.id}`;
    const isReject = kind === 'chef-reject' || kind === 'gm-reject';
    const isChefDecision = kind === 'chef-approve' || kind === 'chef-reject';
    const isRevert = kind === 'revert-to-chef-approved';
    const items = Array.isArray(raw.items) ? raw.items : [];

    function submit(event: React.FormEvent<HTMLFormElement>): void {
        event.preventDefault();
        if (pending) {
            return;
        }
        if (isReject) {
            const reasonError = prReasonError(reason);
            if (reasonError) {
                setLocalError(reasonError);
                return;
            }
        }
        const signatureData = signatureRef.current;
        if (!signatureData) {
            setLocalError(PR_WRITE_TEXT.signatureFailed);
            return;
        }
        setLocalError('');
        onSubmit(kind, raw, { notes, reason, signatureData });
    }

    const note =
        kind === 'chef-approve'
            ? 'توقيعك يحيل الطلب إلى المدير العام للاعتماد النهائي — لا يحرك أي مخزون.'
            : kind === 'gm-approve'
              ? `وقّع الشيف ${raw.chef_approved_name ? String(raw.chef_approved_name) : '—'} — اعتمادك نهائي ويُغلق الطلب (طلب فقط بلا حركة مخزون).`
              : kind === 'revert-to-chef-approved'
                ? 'سيتم إعادة الطلب إلى chef_approved للتعديل، يمكنك تعديله ثم تعزيزه مجدداً'
                : '';

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title={`${prDecisionTitle(kind)} — ${number}`}
            size="md"
            footer={
                <>
                    <button type="button" onClick={onClose} className={BUTTON_CLASS}>
                        {PR_WRITE_TEXT.cancelAction}
                    </button>
                    <button
                        type="submit"
                        form={DECISION_FORM_ID}
                        disabled={pending}
                        className={isReject ? DANGER_BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
                    >
                        {prDecisionSubmitLabel(kind)}
                    </button>
                </>
            }
        >
            <form
                id={DECISION_FORM_ID}
                onSubmit={(event) => {
                    submit(event);
                }}
                className="flex flex-col gap-sm"
            >
                {error || localError ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error || localError}
                    </p>
                ) : null}
                {note ? (
                    <p className="rounded-md border border-hairline bg-surface-sunken p-sm text-body-sm text-ink-secondary">{note}</p>
                ) : null}
                {items.length > 0 ? (
                    <ul className="flex flex-col gap-xxs text-body-sm">
                        {items.map((item) => {
                            const label = String(item.itemName ?? item.name ?? '—');
                            const unit = item.unit ? String(item.unit) : '';
                            const qty = Number(item.requestedQty ?? item.qty ?? 0);
                            return (
                                <li key={`${label}-${unit}-${formatQty(qty)}`} className="flex justify-between gap-sm">
                                    <span className="text-ink">{label}</span>
                                    <span className="erp-numeric text-muted" dir="ltr">
                                        {formatQty(qty)} {unit}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                ) : null}
                {isReject ? (
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                        {PR_WRITE_TEXT.reasonLabel}
                        <textarea
                            rows={3}
                            value={reason}
                            aria-label={PR_WRITE_TEXT.reasonLabel}
                            placeholder={kind === 'chef-reject' ? PR_WRITE_TEXT.reasonPlaceholderChef : undefined}
                            onChange={(event) => {
                                setReason(event.target.value);
                            }}
                            className={`${INPUT_CLASS} min-h-16 py-xs leading-normal`}
                        />
                    </label>
                ) : (
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                        {isChefDecision || isRevert ? PR_WRITE_TEXT.chefNotesLabel : PR_WRITE_TEXT.gmNotesLabel}
                        <textarea
                            rows={2}
                            value={notes}
                            aria-label={isChefDecision || isRevert ? PR_WRITE_TEXT.chefNotesLabel : PR_WRITE_TEXT.gmNotesLabel}
                            onChange={(event) => {
                                setNotes(event.target.value);
                            }}
                            className={`${INPUT_CLASS} min-h-16 py-xs leading-normal`}
                        />
                    </label>
                )}
                {isRevert ? (
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                        {PR_WRITE_TEXT.reasonLabel}
                        <textarea
                            rows={3}
                            value={reason}
                            aria-label={PR_WRITE_TEXT.reasonLabel}
                            onChange={(event) => {
                                setReason(event.target.value);
                            }}
                            className={`${INPUT_CLASS} min-h-16 py-xs leading-normal`}
                        />
                    </label>
                ) : null}
                <SignaturePad
                    label={
                        kind === 'chef-approve'
                            ? 'توقيع الشيف العمومي'
                            : kind === 'chef-reject'
                              ? 'توقيع الشيف على الرفض'
                              : kind === 'gm-approve'
                                ? 'توقيع المدير العام'
                                : kind === 'revert-to-chef-approved'
                                  ? 'توقيع لإعادة التصحيح'
                                  : 'توقيع المدير العام على الرفض'
                    }
                    name={signerName}
                    onChange={(value) => {
                        signatureRef.current = value;
                    }}
                />
            </form>
        </Dialog>
    );
}

/* ── الشاشة ─────────────────────────────────────────────────────────────── */

export function PurchaseRequests() {
    const [status, setStatus] = useState('all');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
    const [page, setPage] = useState(1);
    const [createOpen, setCreateOpen] = useState(false);
    const [decision, setDecision] = useState<{ kind: PRDecisionKind; raw: PurchaseRequest } | null>(null);
    const [dialogError, setDialogError] = useState('');

    const auth = useAuthState();
    const role = String(auth.user?.role ?? '');
    const signerName = accountSignatureName(auth.user);
    const confirm = useConfirm();
    const { toast } = useToast();
    const canCreate = prCanCreate(role);

    const requestsQuery = useQuery({
        queryKey: ['purchase-requests'],
        queryFn: ({ signal }) => fetchPurchaseRequests(signal),
    });
    const shortagesQuery = useQuery({
        queryKey: ['purchase-requests', 'shortages'],
        queryFn: ({ signal }) => fetchShortages(signal),
        staleTime: 5 * 60 * 1000,
    });
    const departmentsQuery = useQuery({
        queryKey: ['purchase-requests', 'departments'],
        queryFn: ({ signal }) => fetchDepartments(signal),
        enabled: createOpen,
        staleTime: 10 * 60 * 1000,
    });

    const allRows = useMemo(() => (requestsQuery.data ?? []).map(purchaseRequestToRow), [requestsQuery.data]);
    const counts = useMemo(() => summarizePR(allRows), [allRows]);
    const rawById = useMemo(() => new Map((requestsQuery.data ?? []).map((entry) => [String(entry.id), entry])), [requestsQuery.data]);

    const rows = useMemo(() => (status === 'all' ? allRows : allRows.filter((row) => row.status === status)), [allRows, status]);

    const sorted = useMemo(() => {
        if (!sort) {
            return rows;
        }
        const copy = [...rows].sort((a, b) => compare(a, b, sort.key));
        return sort.dir === 'asc' ? copy : copy.reverse();
    }, [rows, sort]);

    const shortages = useMemo(() => (shortagesQuery.data ?? []).map(shortageToRow), [shortagesQuery.data]);
    const departmentOptions = useMemo(
        () =>
            filterPRDeptOptions(
                (departmentsQuery.data ?? []).map((department) => ({
                    code: department.code,
                    name: department.name,
                    parentCode: department.parent_code ?? '',
                })),
            ),
        [departmentsQuery.data],
    );
    const capped = allRows.length >= PR_LIST_CAP;

    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    /* ── الكتابات: نفس رسائل V2، والإبطال يعيد جلب السجل والنواقص ──────── */

    const createMutation = useWriteMutation<PRCreatePayload, { requestNumber: string }>({
        mutationFn: (payload) => createPR(payload),
        invalidate: [['purchase-requests']],
        silentError: true,
        onSuccess: (created) => {
            setCreateOpen(false);
            setDialogError('');
            toast({ title: prCreateSuccess(created.requestNumber, isChefCreator(role)), variant: 'success' });
        },
        onError: (cause) => {
            const message = writeErrorMessage(cause, PR_WRITE_TEXT.createFailed);
            setDialogError(message);
            toast({ title: message, variant: 'error' });
        },
    });

    type DecisionVars =
        | ({ kind: 'chef-approve'; id: string } & PRNotesPayload)
        | ({ kind: 'chef-reject'; id: string } & PRRejectPayload)
        | ({ kind: 'gm-approve'; id: string } & PRNotesPayload)
        | ({ kind: 'gm-reject'; id: string } & PRRejectPayload)
        | ({ kind: 'revert-to-chef-approved'; id: string; notes?: string; signatureData?: string; signerName?: string } & {
              kind: 'revert-to-chef-approved';
              id: string;
          });

    const decisionMutation = useWriteMutation<DecisionVars, void>({
        mutationFn: (vars) => {
            if (vars.kind === 'chef-approve') {
                return chefApprovePR(vars.id, {
                    notes: vars.notes,
                    signatureData: vars.signatureData,
                    signerName: vars.signerName,
                });
            }
            if (vars.kind === 'chef-reject') {
                return chefRejectPR(vars.id, {
                    reason: vars.reason,
                    signatureData: vars.signatureData,
                    signerName: vars.signerName,
                });
            }
            if (vars.kind === 'gm-approve') {
                return gmApprovePR(vars.id, {
                    notes: vars.notes,
                    signatureData: vars.signatureData,
                    signerName: vars.signerName,
                });
            }
            if (vars.kind === 'gm-reject') {
                return gmRejectPR(vars.id, {
                    reason: vars.reason,
                    signatureData: vars.signatureData,
                    signerName: vars.signerName,
                });
            }
            return revertToChefApprovedPR(vars.id);
        },
        invalidate: [['purchase-requests']],
        silentError: true,
        onSuccess: (_data, vars) => {
            setDecision(null);
            setDialogError('');
            toast({ title: prDecisionSuccess(vars.kind), variant: 'success' });
        },
        onError: (cause, vars) => {
            const message = writeErrorMessage(cause, prDecisionFailure(vars.kind));
            setDialogError(message);
            toast({ title: message, variant: 'error' });
        },
    });

    const cancelMutation = useWriteMutation<PurchaseRequest, void>({
        mutationFn: (raw) => cancelPR(raw.id),
        invalidate: [['purchase-requests']],
        silentError: true,
        onSuccess: () => {
            toast({ title: PR_WRITE_TEXT.cancelSuccess, variant: 'success' });
        },
        onError: (cause) => {
            toast({ title: writeErrorMessage(cause, PR_WRITE_TEXT.cancelFailed), variant: 'error' });
        },
    });

    const deleteMutation = useWriteMutation<PurchaseRequest, void>({
        mutationFn: (raw) => deletePR(raw.id),
        invalidate: [['purchase-requests']],
        silentError: true,
        onSuccess: () => {
            toast({ title: PR_WRITE_TEXT.deleteSuccess, variant: 'success' });
        },
        onError: (cause) => {
            toast({ title: writeErrorMessage(cause, PR_WRITE_TEXT.deleteFailed), variant: 'error' });
        },
    });

    const pending = createMutation.isPending || decisionMutation.isPending || cancelMutation.isPending || deleteMutation.isPending;

    function toggleSort(key: SortKey) {
        setPage(1);
        setSort((previous) => (previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
    }

    function chooseStatus(next: string) {
        setStatus(next);
        setPage(1);
    }

    function openCreate() {
        if (isChefCreator(role) && !signerName) {
            toast({ title: PR_WRITE_TEXT.signerMissing, variant: 'error' });
            return;
        }
        setDialogError('');
        setCreateOpen(true);
    }

    function openDecision(kind: PRDecisionKind, raw: PurchaseRequest) {
        if (!signerName) {
            toast({ title: PR_WRITE_TEXT.signerMissing, variant: 'error' });
            return;
        }
        setDialogError('');
        setDecision({ kind, raw });
    }

    async function handleCancel(raw: PurchaseRequest) {
        if (cancelMutation.isPending) {
            return;
        }
        const confirmed = await confirm(PR_WRITE_TEXT.cancelConfirm);
        if (!confirmed) {
            return;
        }
        cancelMutation.mutate(raw);
    }

    async function handleDelete(raw: PurchaseRequest) {
        if (deleteMutation.isPending) {
            return;
        }
        const confirmed = await confirm(PR_WRITE_TEXT.deleteConfirm);
        if (!confirmed) {
            return;
        }
        deleteMutation.mutate(raw);
    }

    function handleDecisionSubmit(
        kind: PRDecisionKind,
        raw: PurchaseRequest,
        fields: { notes: string; reason: string; signatureData: string },
    ) {
        if (kind === 'chef-approve' || kind === 'gm-approve') {
            const payload = prNotesPayload(fields.notes, fields.signatureData, signerName);
            decisionMutation.mutate({ kind, id: raw.id, ...payload });
            return;
        }
        if (kind === 'revert-to-chef-approved') {
            decisionMutation.mutate({ kind, id: raw.id });
            return;
        }
        const payload = prRejectPayload(fields.reason, fields.signatureData, signerName);
        decisionMutation.mutate({ kind, id: raw.id, ...payload });
    }

    return (
        <div className="mx-auto flex w-full min-w-0 flex-col gap-lg">
            <header className="flex flex-wrap items-end justify-between gap-md border-b border-hairline pb-md">
                <div>
                    <h1 className="text-display-lg text-ink">
                        طلبات شراء النواقص{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Purchase Requests
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">طلبات النواقص: إنشاء، توقيع الشيف، اعتماد المدير العام، ثم إلغاء أو حذف.</p>
                </div>
                <div className="flex flex-wrap items-center gap-xs" data-erp-print-hide>
                    {canCreate ? (
                        <button type="button" onClick={openCreate} className={PRIMARY_BUTTON_CLASS}>
                            {PR_WRITE_TEXT.createButton}
                        </button>
                    ) : null}
                    <PrintActions title="طلبات شراء النواقص" />
                    <button
                        type="button"
                        onClick={() => {
                            void requestsQuery.refetch();
                            void shortagesQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="الطلبات" english="Requests" value={formatInt(counts.total)} hint={`أحدث ${formatInt(PR_LIST_CAP)} طلبًا`} />
                <Kpi label="بانتظار الشيف" english="Pending" value={formatInt(counts.pending)} hint={PR_STATUS_LABELS.pending ?? ''} />
                <Kpi
                    label="موقّع من الشيف"
                    english="Chef Signed"
                    value={formatInt(counts.chefApproved)}
                    hint={PR_STATUS_LABELS.chef_approved ?? ''}
                />
                <Kpi label="معتمد نهائيًا" english="Approved" value={formatInt(counts.approved)} hint={PR_STATUS_LABELS.approved ?? ''} />
            </div>

            <Card className="p-sm">
                <fieldset className="flex flex-wrap items-center gap-xs">
                    <legend className="pb-2 text-label-md text-ink-secondary">حالة الطلب</legend>
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
                        {`الكل (${formatInt(counts.total)})`}
                    </button>
                    {PR_STATUS_ORDER.map((key) => {
                        const count = allRows.filter((row) => row.status === key).length;
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
                                {`${PR_STATUS_LABELS[key] ?? key} (${formatInt(count)})`}
                            </button>
                        );
                    })}
                    <span className="text-body-sm text-muted">{formatInt(sorted.length)} طلبًا</span>
                </fieldset>
                {capped ? (
                    <p className="mt-sm text-body-sm text-muted">
                        {`السجل يسقف عند أحدث ${formatInt(PR_LIST_CAP)} طلبًا — ما قبلها خارج هذه النافذة.`}
                    </p>
                ) : null}
            </Card>

            <Card>
                {requestsQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل طلبات الشراء" />
                        <TableSkeleton rows={6} columns={9} />
                    </div>
                ) : null}

                {requestsQuery.isError ? (
                    <StateError
                        message={requestsQuery.error instanceof Error ? requestsQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void requestsQuery.refetch();
                        }}
                    />
                ) : null}

                {requestsQuery.isSuccess && sorted.length === 0 ? (
                    <StateEmpty
                        title={allRows.length === 0 ? 'لا طلبات شراء مسجلة' : 'لا طلبات بهذه الحالة'}
                        hint={allRows.length === 0 ? 'أنشئ أول طلب.' : 'غيّر الفلتر.'}
                    />
                ) : null}

                {requestsQuery.isSuccess && sorted.length > 0 ? (
                    <>
                        <p className="border-b border-hairline px-sm py-xs text-body-sm text-muted" role="status">
                            {`${formatInt(sorted.length)} طلبًا (من ${formatInt(counts.total)}) · معلقة ${formatInt(counts.pending)} · موقّعة ${formatInt(counts.chefApproved)} · معتمدة ${formatInt(counts.approved)}`}
                        </p>
                        <TableScroll label="جدول طلبات الشراء">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh label="الطلب" sortKey="number" sort={sort} onToggle={toggleSort} />
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الأصناف والكميات
                                        </th>
                                        <SortableTh label="الحالة" sortKey="status" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="أنشأها" sortKey="by" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="التاريخ" sortKey="created" sort={sort} onToggle={toggleSort} align="center" />
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            توقيع الشيف
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            اعتماد المدير
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            استلام المخزن
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            إجراءات
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row) => {
                                        const raw = rawById.get(row.id);
                                        return (
                                            <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                                <td className="erp-numeric px-sm py-xxs text-start text-ink" dir="ltr">
                                                    {row.number}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm text-ink-secondary">{row.itemsText}</td>
                                                <td className="px-sm py-xxs text-body-sm">
                                                    <span className={STATUS_TONE[row.status] ?? 'text-muted'}>{row.statusLabel}</span>
                                                    {row.status && !row.statusKnown ? (
                                                        <span className="text-caption text-faint" dir="ltr">
                                                            {' '}
                                                            ({row.status})
                                                        </span>
                                                    ) : null}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">{row.by}</td>
                                                <td className="erp-numeric px-sm py-xxs text-center text-body-sm text-muted" dir="ltr">
                                                    {row.created || '—'}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">{row.chefSigned || '—'}</td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">{row.gmSigned || '—'}</td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">{row.whReceived || '—'}</td>
                                                <td className="px-sm py-xxs">
                                                    {raw ? (
                                                        <RowActions
                                                            request={raw}
                                                            role={role}
                                                            pending={pending}
                                                            onDecision={openDecision}
                                                            onCancel={(target) => {
                                                                void handleCancel(target);
                                                            }}
                                                            onDelete={(target) => {
                                                                void handleDelete(target);
                                                            }}
                                                        />
                                                    ) : null}
                                                </td>
                                            </tr>
                                        );
                                    })}
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

            <Card>
                <div className="border-b border-hairline px-sm py-xs">
                    <h2 className="text-heading-sm text-ink">
                        النواقص الحالية (استشاري) <span className="text-caption text-muted">{`(${formatInt(shortages.length)})`}</span>
                    </h2>
                    <p className="text-caption text-muted">أصناف المخزن عند الحد الأدنى أو تحته — من قائمة الخادم الاستشارية.</p>
                </div>
                {shortages.length === 0 ? (
                    <p className="px-sm py-xs text-body-sm text-muted">لا توجد نواقص حاليًا (كل الأصناف فوق الحد الأدنى).</p>
                ) : (
                    <TableScroll label="جدول النواقص الحالية">
                        <table className="w-full border-collapse text-body-md">
                            <thead>
                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الصنف
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        الرصيد
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        الحد الأدنى
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        عجز مقترح
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {shortages.map((row) => (
                                    <tr key={row.itemId} className="border-b border-hairline hover:bg-surface-hover">
                                        <td className="px-sm py-xxs text-ink">
                                            {row.itemName} <span className="text-caption text-muted">{row.unit}</span>
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs text-end text-danger-text" dir="ltr">
                                            {formatQty(row.currentQty)}
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs text-end text-muted" dir="ltr">
                                            {formatQty(row.minQty)}
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                            {formatQty(row.suggestedQty)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableScroll>
                )}
            </Card>

            <CreateRequestDialog
                open={createOpen}
                chef={isChefCreator(role)}
                signerName={signerName}
                shortages={shortages}
                departments={departmentOptions}
                pending={createMutation.isPending}
                error={dialogError}
                onClose={() => {
                    setCreateOpen(false);
                    setDialogError('');
                }}
                onSubmit={(payload) => {
                    createMutation.mutate(payload);
                }}
            />

            <DecisionDialog
                open={decision !== null}
                decision={decision}
                signerName={signerName}
                pending={decisionMutation.isPending}
                error={dialogError}
                onClose={() => {
                    setDecision(null);
                    setDialogError('');
                }}
                onSubmit={handleDecisionSubmit}
            />
        </div>
    );
}
