import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useAuthState } from '../lib/auth';
import {
    AUDIT_SCOPE_LABELS,
    AUDIT_SCOPE_MODES,
    AUDIT_TEXT,
    type AuditDetail,
    type AuditScopeFilter,
    type AuditScopeMode,
    approveInventoryAudit,
    auditPeriodLabel,
    auditProgressLabel,
    auditSignatureError,
    auditStatusLabel,
    auditStatusTone,
    auditToday,
    cancelInventoryAudit,
    canWriteAudit,
    clearAuditCount,
    createInventoryAudit,
    fetchAuditDetail,
    fetchAuditLocationPreview,
    fetchAuditLocations,
    fetchInventoryAudits,
    formatAuditInt,
    formatAuditMoney,
    formatAuditQty,
    type InventoryAudit,
    isAuditDraft,
    isAuditOpen,
    saveAuditCount,
    saveAuditCounts,
    submitInventoryAudit,
    varianceLabel,
} from '../lib/inventory-audits';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { SignaturePad } from '../ui/SignaturePad';
import { useToast } from '../ui/Toast';
import { TableScroll } from './TableState';

/**
 * استوديو الجرد الفعلي — الفجوة الأولى في جرد V2→V3
 * (`docs/phase-0/v3-parity-audit.md` §2-1).
 *
 * الدورة كاملة من داخل V3 وبلا رجوع للقديم:
 *  1. اختيار المخزن ← إنشاء جلسة مسودة من أرصدة النظام.
 *  2. عدّ الأصناف وحفظ الدفعة (الخادم يحسب الفرق وقيمته).
 *  3. إرسال موقّع (توقيع الحساب كما في V2).
 *  4. اعتماد موقّع ← يترحّل الفروق إلى الأرصدة وحركات المخزون.
 *  5. إلغاء بسبب موثّق للمسودات والمُرسلة.
 *
 * كل الأرقام من الخادم: لا حساب محلي يُرحَّل؛ هنا عرض وحقول إدخال فقط.
 * الأدوار تُقرأ من الخادم نفسه (`canWriteAudit`) والقراءة متاحة للمحاسب.
 */

const PAGE_ROWS = 120;

const FIELD_CLASS = 'h-9 w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink';

const PRIMARY_BUTTON_CLASS =
    'rounded-md border border-primary-active/40 bg-primary px-sm py-xxs text-body-sm text-on-primary hover:bg-primary-hover disabled:opacity-50';
const SECONDARY_BUTTON_CLASS =
    'rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50';
const DANGER_BUTTON_CLASS =
    'rounded-md border border-danger/50 bg-surface px-sm py-xxs text-body-sm text-danger-text hover:bg-danger-soft disabled:opacity-50';

const STATUS_TEXT_CLASS: Record<'info' | 'success' | 'warning' | 'danger', string> = {
    info: 'text-ink-secondary',
    success: 'text-success-text',
    warning: 'text-warning-text',
    danger: 'text-danger-text',
};

function today(): string {
    return auditToday();
}

export interface InventoryAuditStudioProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function InventoryAuditStudio({ open, onOpenChange }: InventoryAuditStudioProps) {
    const auth = useAuthState();
    const canWrite = canWriteAudit(auth.user?.role);
    const signerName = String(auth.user?.name ?? auth.user?.username ?? '').trim();
    const { toast } = useToast();

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [locationId, setLocationId] = useState('');
    const [periodType, setPeriodType] = useState<'daily' | 'weekly' | 'monthly' | 'custom' | 'annual'>('custom');
    const [periodStart, setPeriodStart] = useState(today());
    const [periodEnd, setPeriodEnd] = useState(today());
    const [createNotes, setCreateNotes] = useState('');
    const [formError, setFormError] = useState('');

    const [counts, setCounts] = useState<Record<string, string>>({});
    const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
    const [touched, setTouched] = useState<Record<string, boolean>>({});
    const [itemSearch, setItemSearch] = useState('');
    const [signature, setSignature] = useState<string | null>(null);
    const [actionError, setActionError] = useState('');
    const [cancelReason, setCancelReason] = useState('');
    const [cancelOpen, setCancelOpen] = useState(false);
    const [scopeMode, setScopeMode] = useState<AuditScopeMode>('all');
    const [scopeCategory, setScopeCategory] = useState('');
    const [scopeSearch, setScopeSearch] = useState('');

    const auditsQuery = useQuery({
        queryKey: ['inventory-audits'],
        queryFn: ({ signal }) => fetchInventoryAudits(signal),
        enabled: open,
        staleTime: 30_000,
    });

    const locationsQuery = useQuery({
        queryKey: ['inventory-audit-locations'],
        queryFn: ({ signal }) => fetchAuditLocations(signal),
        enabled: open && canWrite,
        staleTime: 5 * 60_000,
    });

    const detailQuery = useQuery({
        queryKey: ['inventory-audit', selectedId],
        queryFn: ({ signal }) => fetchAuditDetail(selectedId ?? '', signal),
        enabled: open && selectedId !== null,
    });

    // معاينة نطاق الموقع قبل بدء الجلسة — نفس مرشّحات الخادم.
    const scopeReady =
        Boolean(locationId) &&
        (scopeMode !== 'category' || Boolean(scopeCategory.trim())) &&
        (scopeMode !== 'search' || Boolean(scopeSearch.trim()));

    const previewQuery = useQuery({
        queryKey: ['inventory-audit-preview', locationId, scopeMode, scopeCategory.trim(), scopeSearch.trim()],
        queryFn: ({ signal }) =>
            fetchAuditLocationPreview(
                locationId,
                {
                    mode: scopeMode,
                    category: scopeMode === 'category' ? scopeCategory.trim() : '',
                    search: scopeMode === 'search' ? scopeSearch.trim() : '',
                },
                signal,
            ),
        enabled: open && createOpen && canWrite && scopeReady,
        staleTime: 60_000,
    });

    const detail: AuditDetail | undefined = detailQuery.data;
    const audit: InventoryAudit | undefined = detail?.audit;

    // إعادة تهيئة الحقول عند تغيير الجلسة أو تحديث تفاصيلها.
    useEffect(() => {
        if (!detail) {
            return;
        }
        const nextCounts: Record<string, string> = {};
        const nextNotes: Record<string, string> = {};
        for (const item of detail.items) {
            nextCounts[String(item.item_id)] = formatAuditQty(item.counted_qty);
            nextNotes[String(item.item_id)] = String(item.notes ?? '');
        }
        setCounts(nextCounts);
        setItemNotes(nextNotes);
        setTouched({});
        setSignature(null);
        setActionError('');
        setCancelReason('');
    }, [detail]);

    useEffect(() => {
        if (!open) {
            setSelectedId(null);
            setCreateOpen(false);
            setFormError('');
            setActionError('');
            setSignature(null);
            setCancelOpen(false);
        }
    }, [open]);

    useEffect(() => {
        if (!locationId && locationsQuery.data && locationsQuery.data.length > 0) {
            setLocationId(String(locationsQuery.data[0]?.id ?? ''));
        }
    }, [locationId, locationsQuery.data]);

    const createMutation = useWriteMutation<
        {
            locationId: string;
            periodType: typeof periodType;
            periodStart: string;
            periodEnd: string;
            notes: string;
            scopeFilter: AuditScopeFilter;
        },
        void
    >({
        mutationFn: (input) => createInventoryAudit(input),
        successTitle: 'تم بدء جلسة جرد جديدة',
        invalidate: [['inventory-audits']],
        silentError: true,
        onSuccess: () => {
            setCreateOpen(false);
            setCreateNotes('');
            setFormError('');
        },
        onError: (cause) => {
            setFormError(writeErrorMessage(cause, AUDIT_TEXT.createFailed));
        },
    });

    const saveMutation = useWriteMutation<{ id: string; rows: { itemId: number; countedQty: number; notes: string }[] }, void>({
        mutationFn: async ({ id, rows }) => {
            const result = await saveAuditCounts(id, rows);
            if (result.rejectedCount > 0) {
                throw new Error(result.rejectedReasons[0] ?? AUDIT_TEXT.saveFailed);
            }
        },
        invalidate: [['inventory-audit'], ['inventory-audits']],
        silentError: true,
        onSuccess: () => {
            setActionError('');
            toast({ title: 'تم حفظ العدّ', variant: 'success' });
        },
        onError: (cause) => {
            setActionError(writeErrorMessage(cause, AUDIT_TEXT.saveFailed));
        },
    });

    const rowSaveMutation = useWriteMutation<{ id: string; itemId: number; countedQty: number; notes: string }, void>({
        mutationFn: async ({ id, itemId, countedQty, notes }) => {
            await saveAuditCount(id, itemId, countedQty, notes);
        },
        successTitle: 'تم حفظ عدّ الصنف',
        invalidate: [['inventory-audit', selectedId]],
        silentError: true,
        onSuccess: () => {
            setActionError('');
        },
        onError: (cause) => {
            setActionError(writeErrorMessage(cause, AUDIT_TEXT.saveFailed));
        },
    });

    const rowClearMutation = useWriteMutation<{ id: string; itemId: number }, void>({
        mutationFn: async ({ id, itemId }) => {
            await clearAuditCount(id, itemId);
        },
        successTitle: 'تم مسح عدّ الصنف',
        invalidate: [['inventory-audit', selectedId]],
        silentError: true,
        onSuccess: () => {
            setActionError('');
        },
        onError: (cause) => {
            setActionError(writeErrorMessage(cause, AUDIT_TEXT.saveFailed));
        },
    });

    const submitMutation = useWriteMutation<{ id: string; signatureData: string; signerName: string }, void>({
        mutationFn: (input) => submitInventoryAudit(input.id, input),
        successTitle: 'تم إرسال الجرد للمراجعة',
        invalidate: [['inventory-audit'], ['inventory-audits']],
        silentError: true,
        onSuccess: () => {
            setActionError('');
        },
        onError: (cause) => {
            setActionError(writeErrorMessage(cause, AUDIT_TEXT.submitFailed));
        },
    });

    const approveMutation = useWriteMutation<{ id: string; signatureData: string; signerName: string }, void>({
        mutationFn: (input) => approveInventoryAudit(input.id, input),
        successTitle: 'تم اعتماد الجرد وترحيل الفروق',
        invalidate: [['inventory-audit'], ['inventory-audits'], ['inventory']],
        silentError: true,
        onSuccess: () => {
            setActionError('');
        },
        onError: (cause) => {
            setActionError(writeErrorMessage(cause, AUDIT_TEXT.approveFailed));
        },
    });

    const cancelMutation = useWriteMutation<{ id: string; reason: string }, void>({
        mutationFn: (input) => cancelInventoryAudit(input.id, input.reason),
        successTitle: 'تم إلغاء جلسة الجرد',
        invalidate: [['inventory-audit'], ['inventory-audits']],
        silentError: true,
        onSuccess: () => {
            setCancelOpen(false);
            setCancelReason('');
            setActionError('');
        },
        onError: (cause) => {
            setActionError(writeErrorMessage(cause, AUDIT_TEXT.cancelFailed));
        },
    });

    const pending =
        createMutation.isPending ||
        saveMutation.isPending ||
        submitMutation.isPending ||
        approveMutation.isPending ||
        cancelMutation.isPending;

    const dirtyRows = useMemo(() => {
        if (!detail) {
            return [];
        }
        const rows: { itemId: number; countedQty: number; notes: string }[] = [];
        for (const item of detail.items) {
            const key = String(item.item_id);
            const raw = counts[key];
            const notes = itemNotes[key] ?? '';
            if (raw === undefined) {
                continue;
            }
            const parsed = Number(raw);
            if (!Number.isFinite(parsed) || parsed < 0) {
                continue;
            }
            const changed = Math.abs(parsed - Number(item.counted_qty)) > 0.0005 || notes !== String(item.notes ?? '');
            // لا نعتبر الصنف معدودًا إلا إذا عدّله المستخدم فعليًا أو كان معدودًا
            // سابقًا بتغيير — وإلا فحفظ صنفٍ واحد كان سيعدّ ألف صنف بلا قصد.
            const edited = touched[key] === true;
            if (changed || (edited && !item.is_counted)) {
                rows.push({ itemId: Number(item.item_id), countedQty: parsed, notes });
            }
        }
        return rows;
    }, [detail, counts, itemNotes, touched]);

    const visibleItems = useMemo(() => {
        const items = detail?.items ?? [];
        const needle = itemSearch.trim().toLowerCase();
        if (!needle) {
            return items;
        }
        return items.filter((item) =>
            [item.item_name, item.category, item.barcode].some((value) =>
                String(value ?? '')
                    .toLowerCase()
                    .includes(needle),
            ),
        );
    }, [detail, itemSearch]);

    function openAudit(row: InventoryAudit): void {
        setSelectedId(row.id);
        setItemSearch('');
        setActionError('');
        setSignature(null);
    }

    function backToList(): void {
        setSelectedId(null);
        setActionError('');
        setSignature(null);
        setCancelOpen(false);
    }

    function startCreate(): void {
        setFormError('');
        setCreateOpen(true);
        if (!periodStart) {
            setPeriodStart(today());
        }
        if (!periodEnd) {
            setPeriodEnd(today());
        }
    }

    function submitCreate(): void {
        setFormError('');
        if (!locationId) {
            setFormError('اختر المخزن المراد جرده أولًا.');
            return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
            setFormError('تاريخ بداية ونهاية الفترة مطلوبان بصيغة YYYY-MM-DD.');
            return;
        }
        if (periodEnd < periodStart) {
            setFormError('نهاية فترة الجرد لا يمكن أن تسبق بدايتها.');
            return;
        }
        if (scopeMode === 'category' && !scopeCategory.trim()) {
            setFormError('اكتب اسم التصنيف المراد جرده.');
            return;
        }
        if (scopeMode === 'search' && !scopeSearch.trim()) {
            setFormError('اكتب اسم الصنف أو الباركود للبحث.');
            return;
        }
        createMutation.mutate({
            locationId,
            periodType,
            periodStart,
            periodEnd,
            notes: createNotes,
            scopeFilter: {
                mode: scopeMode,
                category: scopeMode === 'category' ? scopeCategory.trim() : null,
                search: scopeMode === 'search' ? scopeSearch.trim() : null,
            },
        });
    }

    function saveCounts(): void {
        if (!audit) {
            return;
        }
        if (dirtyRows.length === 0) {
            setActionError(AUDIT_TEXT.emptyCounts);
            return;
        }
        setActionError('');
        saveMutation.mutate({ id: audit.id, rows: dirtyRows });
    }

    function requireSignature(): boolean {
        const message = auditSignatureError(signature, signerName);
        if (message) {
            setActionError(message);
            return false;
        }
        setActionError('');
        return true;
    }

    function submitAudit(): void {
        if (!audit || !requireSignature()) {
            return;
        }
        submitMutation.mutate({ id: audit.id, signatureData: signature ?? '', signerName });
    }

    function approveAudit(): void {
        if (!audit || !requireSignature()) {
            return;
        }
        approveMutation.mutate({ id: audit.id, signatureData: signature ?? '', signerName });
    }

    function confirmCancel(): void {
        if (!audit) {
            return;
        }
        if (cancelReason.trim().length < 3) {
            setActionError(AUDIT_TEXT.cancelReason);
            return;
        }
        setActionError('');
        cancelMutation.mutate({ id: audit.id, reason: cancelReason });
    }

    const rows = auditsQuery.data ?? [];
    const openCount = rows.filter((row) => row.status === 'draft').length;
    const submittedCount = rows.filter((row) => row.status === 'submitted').length;
    const approvedCount = rows.filter((row) => row.status === 'approved').length;

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            size="lg"
            title="الجرد الفعلي للمخزون"
            description="جلسة جرد ← عدّ ← إرسال موقّع ← اعتماد يترحّل الفروق إلى الأرصدة."
        >
            {selectedId === null || !audit ? (
                <div className="flex min-w-0 flex-col gap-md">
                    <div className="grid gap-xs sm:grid-cols-3">
                        <KpiTile label="مسودات قيد العدّ" value={formatAuditInt(openCount)} />
                        <KpiTile label="بانتظار المراجعة" value={formatAuditInt(submittedCount)} />
                        <KpiTile label="معتمدة" value={formatAuditInt(approvedCount)} />
                    </div>

                    {canWrite ? (
                        <div className="flex flex-wrap items-center gap-xs">
                            <Button type="button" size="sm" onClick={startCreate}>
                                بدء جلسة جرد
                            </Button>
                            <span className="text-caption text-muted">الجلسة تُبنى من أرصدة المخزن المختار، ويمكن عدّها على مراحل.</span>
                        </div>
                    ) : null}

                    {createOpen ? (
                        <section className="flex min-w-0 flex-col gap-sm rounded-md border border-hairline bg-surface-sunken p-sm">
                            <h3 className="text-heading-sm text-ink">جلسة جرد جديدة</h3>
                            <div className="grid gap-sm sm:grid-cols-2">
                                <label className="flex min-w-0 flex-col gap-xxs text-label-md text-ink-secondary">
                                    المخزن
                                    <select
                                        value={locationId}
                                        onChange={(event) => {
                                            setLocationId(event.target.value);
                                        }}
                                        className={FIELD_CLASS}
                                    >
                                        <option value="">— اختر المخزن —</option>
                                        {(locationsQuery.data ?? []).map((location) => (
                                            <option key={location.id} value={location.id}>
                                                {`${String(location.name_ar ?? location.code ?? location.id)} (${formatAuditInt(location.items_count)} صنف)`}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex min-w-0 flex-col gap-xxs text-label-md text-ink-secondary">
                                    نوع الفترة
                                    <select
                                        value={periodType}
                                        onChange={(event) => {
                                            const value = event.target.value;
                                            setPeriodType(
                                                value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'annual'
                                                    ? value
                                                    : 'custom',
                                            );
                                        }}
                                        className={FIELD_CLASS}
                                    >
                                        <option value="daily">يومي</option>
                                        <option value="weekly">أسبوعي</option>
                                        <option value="monthly">شهري</option>
                                        <option value="annual">سنوي</option>
                                        <option value="custom">مخصص</option>
                                    </select>
                                </label>
                                <Input
                                    label="بداية الفترة"
                                    name="periodStart"
                                    type="date"
                                    value={periodStart}
                                    onChange={(event) => {
                                        setPeriodStart(event.target.value);
                                    }}
                                />
                                <Input
                                    label="نهاية الفترة"
                                    name="periodEnd"
                                    type="date"
                                    value={periodEnd}
                                    onChange={(event) => {
                                        setPeriodEnd(event.target.value);
                                    }}
                                />
                            </div>
                            <Input
                                label="ملاحظات (اختياري)"
                                name="auditNotes"
                                type="text"
                                maxLength={200}
                                value={createNotes}
                                onChange={(event) => {
                                    setCreateNotes(event.target.value);
                                }}
                            />
                            <div className="grid gap-sm sm:grid-cols-3">
                                <label className="flex min-w-0 flex-col gap-xxs text-label-md text-ink-secondary">
                                    نطاق الجرد
                                    <select
                                        value={scopeMode}
                                        onChange={(event) => {
                                            const value = event.target.value;
                                            setScopeMode(
                                                AUDIT_SCOPE_MODES.includes(value as AuditScopeMode) ? (value as AuditScopeMode) : 'all',
                                            );
                                        }}
                                        className={FIELD_CLASS}
                                    >
                                        {AUDIT_SCOPE_MODES.map((mode) => (
                                            <option key={mode} value={mode}>
                                                {AUDIT_SCOPE_LABELS[mode]}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                {scopeMode === 'category' ? (
                                    <label className="flex min-w-0 flex-col gap-xxs text-label-md text-ink-secondary">
                                        التصنيف
                                        <input
                                            type="text"
                                            value={scopeCategory}
                                            onChange={(event) => {
                                                setScopeCategory(event.target.value);
                                            }}
                                            placeholder="اسم التصنيف"
                                            className={FIELD_CLASS}
                                        />
                                    </label>
                                ) : null}
                                {scopeMode === 'search' ? (
                                    <label className="flex min-w-0 flex-col gap-xxs text-label-md text-ink-secondary">
                                        بحث
                                        <input
                                            type="search"
                                            value={scopeSearch}
                                            onChange={(event) => {
                                                setScopeSearch(event.target.value);
                                            }}
                                            placeholder="اسم الصنف أو الباركود"
                                            className={FIELD_CLASS}
                                        />
                                    </label>
                                ) : null}
                            </div>
                            {scopeReady ? (
                                <p className="text-body-sm text-muted">
                                    {previewQuery.isPending
                                        ? 'جارٍ معاينة نطاق الجرد…'
                                        : previewQuery.isError
                                          ? writeErrorMessage(previewQuery.error, 'تعذّر معاينة نطاق الجرد')
                                          : `النطاق يغطي ${formatAuditInt(previewQuery.data?.itemsCount ?? 0)} صنف — قيمة رصيد ${formatAuditMoney(
                                                previewQuery.data?.onHandValue ?? 0,
                                            )}`}
                                </p>
                            ) : null}
                            {formError ? (
                                <p role="alert" className="text-body-sm text-danger-text">
                                    {formError}
                                </p>
                            ) : null}
                            <div className="flex flex-wrap items-center justify-end gap-xs">
                                <button
                                    type="button"
                                    className={SECONDARY_BUTTON_CLASS}
                                    onClick={() => {
                                        setCreateOpen(false);
                                        setFormError('');
                                    }}
                                    disabled={pending}
                                >
                                    إلغاء
                                </button>
                                <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={submitCreate} disabled={pending}>
                                    {createMutation.isPending ? 'جارٍ الإنشاء…' : 'بدء الجرد'}
                                </button>
                            </div>
                        </section>
                    ) : null}

                    {auditsQuery.isPending ? (
                        <p className="text-body-sm text-muted" role="status">
                            جارٍ تحميل جلسات الجرد…
                        </p>
                    ) : auditsQuery.isError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {writeErrorMessage(auditsQuery.error, 'تعذّر تحميل جلسات الجرد')}
                        </p>
                    ) : rows.length === 0 ? (
                        <p className="text-body-sm text-muted">لا جلسات جرد بعد — ابدأ أول جلسة من الزر أعلاه.</p>
                    ) : (
                        <TableScroll label="جلسات الجرد">
                            <table className="w-full min-w-[720px] border-collapse text-body-sm">
                                <thead>
                                    <tr className="border-b border-hairline text-start text-caption text-muted">
                                        <th scope="col" className="px-xs py-xxs text-start font-medium">
                                            الجلسة
                                        </th>
                                        <th scope="col" className="px-xs py-xxs text-start font-medium">
                                            الحالة
                                        </th>
                                        <th scope="col" className="px-xs py-xxs text-start font-medium">
                                            الفترة
                                        </th>
                                        <th scope="col" className="px-xs py-xxs text-start font-medium">
                                            العدّ
                                        </th>
                                        <th scope="col" className="px-xs py-xxs text-start font-medium" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row) => (
                                        <tr key={row.id} className="border-b border-hairline last:border-0">
                                            <td className="px-xs py-xxs">
                                                <span className="text-ink">{String(row.audit_number ?? row.id)}</span>
                                                <span className="block text-caption text-muted">
                                                    {String(row.location_name ?? row.warehouse_scope ?? '')}
                                                </span>
                                            </td>
                                            <td className="px-xs py-xxs">
                                                <span className={`text-caption ${STATUS_TEXT_CLASS[auditStatusTone(row.status)]}`}>
                                                    {auditStatusLabel(row.status)}
                                                </span>
                                            </td>
                                            <td className="erp-numeric px-xs py-xxs text-caption text-ink-secondary" dir="ltr">
                                                {auditPeriodLabel(row)}
                                            </td>
                                            <td className="erp-numeric px-xs py-xxs text-caption text-ink-secondary" dir="ltr">
                                                {auditProgressLabel(row)}
                                            </td>
                                            <td className="px-xs py-xxs text-end">
                                                <button
                                                    type="button"
                                                    className={SECONDARY_BUTTON_CLASS}
                                                    onClick={() => {
                                                        openAudit(row);
                                                    }}
                                                >
                                                    {canWrite && isAuditDraft(row.status) ? 'متابعة العدّ' : 'عرض التفاصيل'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                    )}
                </div>
            ) : (
                <div className="flex min-w-0 flex-col gap-md">
                    <div className="flex flex-wrap items-start justify-between gap-sm">
                        <div className="min-w-0">
                            <h3 className="text-heading-sm text-ink">
                                {String(audit.audit_number ?? audit.id)}
                                <span className="ms-xs text-caption text-muted">{auditStatusLabel(audit.status)}</span>
                            </h3>
                            <p className="text-caption text-muted">
                                {`${String(detail?.location_name ?? audit.location_name ?? audit.warehouse_scope ?? '—')} · ${auditPeriodLabel(audit)}`}
                            </p>
                        </div>
                        <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={backToList}>
                            رجوع للجلسات
                        </button>
                    </div>

                    <div className="grid gap-xs sm:grid-cols-4">
                        <KpiTile label="إجمالي الأصناف" value={formatAuditInt(detail?.progress?.total ?? audit.total_items ?? 0)} />
                        <KpiTile label="تم عدّه" value={formatAuditInt(detail?.progress?.counted ?? audit.counted_items ?? 0)} />
                        <KpiTile label="أصناف بفروق" value={formatAuditInt(detail?.summary?.items_with_variance ?? 0)} />
                        <KpiTile label="قيمة الفروق" value={formatAuditMoney(detail?.summary?.projected_variance_value ?? 0)} />
                    </div>

                    {detailQuery.isPending ? (
                        <p role="status" className="text-body-sm text-muted">
                            جارٍ تحميل بنود الجلسة…
                        </p>
                    ) : detailQuery.isError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {writeErrorMessage(detailQuery.error, 'تعذّر تحميل تفاصيل الجلسة')}
                        </p>
                    ) : (
                        <>
                            <label className="flex min-w-0 flex-col gap-xxs text-label-md text-ink-secondary">
                                بحث في الأصناف
                                <input
                                    type="search"
                                    value={itemSearch}
                                    onChange={(event) => {
                                        setItemSearch(event.target.value);
                                    }}
                                    placeholder="اسم الصنف أو الباركود أو التصنيف"
                                    className={FIELD_CLASS}
                                />
                            </label>

                            <TableScroll label="بنود جلسة الجرد">
                                <table className="w-full min-w-[980px] border-collapse text-body-sm">
                                    <thead>
                                        <tr className="border-b border-hairline text-caption text-muted">
                                            <th scope="col" className="px-xs py-xxs text-start font-medium">
                                                الصنف
                                            </th>
                                            <th scope="col" className="px-xs py-xxs text-start font-medium">
                                                رصيد النظام
                                            </th>
                                            <th scope="col" className="px-xs py-xxs text-start font-medium">
                                                العدد الفعلي
                                            </th>
                                            <th scope="col" className="px-xs py-xxs text-start font-medium">
                                                الفرق
                                            </th>
                                            <th scope="col" className="px-xs py-xxs text-start font-medium">
                                                قيمة الفرق
                                            </th>
                                            <th scope="col" className="px-xs py-xxs text-start font-medium">
                                                ملاحظة
                                            </th>
                                            <th scope="col" className="px-xs py-xxs text-start font-medium">
                                                <span className="sr-only">إجراءات الصف</span>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visibleItems.slice(0, PAGE_ROWS).map((item) => {
                                            const key = String(item.item_id);
                                            const raw = counts[key] ?? formatAuditQty(item.counted_qty);
                                            const parsed = Number(raw);
                                            const variance = (Number.isFinite(parsed) ? parsed : 0) - Number(item.system_qty);
                                            const varianceValue = variance * Number(item.avg_cost ?? 0);
                                            const editable = canWrite && isAuditDraft(audit.status);
                                            const note = itemNotes[key] ?? '';
                                            const rowBusy = rowSaveMutation.isPending || rowClearMutation.isPending;
                                            return (
                                                <tr key={key} className="border-b border-hairline last:border-0">
                                                    <td className="px-xs py-xxs">
                                                        <span className="text-ink">{String(item.item_name ?? '—')}</span>
                                                        <span className="block text-caption text-muted">
                                                            {String(item.category ?? '')}
                                                            {item.is_stale ? ' · الرصيد تغيّر بعد اللقطة' : ''}
                                                        </span>
                                                    </td>
                                                    <td className="erp-numeric px-xs py-xxs" dir="ltr">
                                                        {`${formatAuditQty(item.system_qty)} ${String(item.unit ?? '')}`}
                                                    </td>
                                                    <td className="px-xs py-xxs">
                                                        {editable ? (
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                step={0.001}
                                                                inputMode="decimal"
                                                                aria-label={`العدد الفعلي — ${String(item.item_name ?? key)}`}
                                                                value={raw}
                                                                onChange={(event) => {
                                                                    const value = event.target.value;
                                                                    setCounts((previous) => ({ ...previous, [key]: value }));
                                                                    setTouched((previous) => ({ ...previous, [key]: true }));
                                                                }}
                                                                className="h-9 w-24 rounded-md border border-hairline-strong bg-surface px-xs text-body-sm text-ink"
                                                                dir="ltr"
                                                            />
                                                        ) : (
                                                            <span className="erp-numeric" dir="ltr">
                                                                {`${formatAuditQty(item.counted_qty)} ${String(item.unit ?? '')}`}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-xs py-xxs">
                                                        <span
                                                            className={
                                                                Math.abs(variance) < 0.0005
                                                                    ? 'text-caption text-muted'
                                                                    : variance < 0
                                                                      ? 'text-caption text-danger-text'
                                                                      : 'text-caption text-success-text'
                                                            }
                                                        >
                                                            {varianceLabel(variance)}
                                                        </span>
                                                    </td>
                                                    <td className="erp-numeric px-xs py-xxs" dir="ltr">
                                                        <span
                                                            className={
                                                                Math.abs(varianceValue) < 0.005
                                                                    ? 'text-caption text-muted'
                                                                    : varianceValue < 0
                                                                      ? 'text-caption text-danger-text'
                                                                      : 'text-caption text-success-text'
                                                            }
                                                        >
                                                            {formatAuditMoney(varianceValue)}
                                                        </span>
                                                    </td>
                                                    <td className="px-xs py-xxs">
                                                        {editable ? (
                                                            <input
                                                                type="text"
                                                                maxLength={200}
                                                                aria-label={`ملاحظة — ${String(item.item_name ?? key)}`}
                                                                value={note}
                                                                onChange={(event) => {
                                                                    const value = event.target.value;
                                                                    setItemNotes((previous) => ({ ...previous, [key]: value }));
                                                                    setTouched((previous) => ({ ...previous, [key]: true }));
                                                                }}
                                                                className="h-9 w-40 rounded-md border border-hairline-strong bg-surface px-xs text-body-sm text-ink"
                                                            />
                                                        ) : (
                                                            <span className="text-caption text-muted">{note || '—'}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-xs py-xxs">
                                                        {editable ? (
                                                            <div className="flex items-center gap-xxs">
                                                                <button
                                                                    type="button"
                                                                    disabled={rowBusy}
                                                                    onClick={() => {
                                                                        rowSaveMutation.mutate({
                                                                            id: audit.id,
                                                                            itemId: Number(item.item_id),
                                                                            countedQty: Number.isFinite(parsed) ? parsed : 0,
                                                                            notes: note.trim(),
                                                                        });
                                                                    }}
                                                                    className="rounded-md border border-hairline-strong bg-surface px-xs py-xxs text-caption text-ink hover:bg-surface-hover disabled:opacity-50"
                                                                >
                                                                    حفظ
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    disabled={rowBusy}
                                                                    onClick={() => {
                                                                        rowClearMutation.mutate({
                                                                            id: audit.id,
                                                                            itemId: Number(item.item_id),
                                                                        });
                                                                    }}
                                                                    className="rounded-md border border-hairline-strong bg-surface px-xs py-xxs text-caption text-ink hover:bg-surface-hover disabled:opacity-50"
                                                                >
                                                                    مسح
                                                                </button>
                                                            </div>
                                                        ) : null}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </TableScroll>

                            {visibleItems.length > PAGE_ROWS ? (
                                <p className="text-caption text-muted">
                                    {`تُعرض أول ${formatAuditInt(PAGE_ROWS)} من ${formatAuditInt(visibleItems.length)} صنفًا — استخدم البحث للوصول لبقيتها.`}
                                </p>
                            ) : null}

                            {isAuditOpen(audit.status) && canWrite ? (
                                <div className="flex flex-col gap-sm rounded-md border border-hairline bg-surface-sunken p-sm">
                                    {isAuditDraft(audit.status) ? (
                                        <div className="flex flex-wrap items-center justify-between gap-xs">
                                            <span className="text-caption text-muted">
                                                {dirtyRows.length > 0
                                                    ? `${formatAuditInt(dirtyRows.length)} صنفًا جاهزًا للحفظ`
                                                    : 'عدّل الكميات ثم احفظ'}
                                            </span>
                                            <button
                                                type="button"
                                                className={PRIMARY_BUTTON_CLASS}
                                                onClick={saveCounts}
                                                disabled={pending || detail?.items.length === 0}
                                            >
                                                {saveMutation.isPending ? 'جارٍ الحفظ…' : AUDIT_TEXT.save}
                                            </button>
                                        </div>
                                    ) : null}

                                    <SignaturePad
                                        label={isAuditDraft(audit.status) ? 'توقيع العدّ والإرسال' : 'توقيع الاعتماد النهائي'}
                                        name={signerName}
                                        onChange={setSignature}
                                        testId="audit-signature"
                                    />

                                    {actionError ? (
                                        <p role="alert" className="text-body-sm text-danger-text">
                                            {actionError}
                                        </p>
                                    ) : null}

                                    <div className="flex flex-wrap items-center justify-end gap-xs">
                                        <button
                                            type="button"
                                            className={DANGER_BUTTON_CLASS}
                                            onClick={() => {
                                                setCancelOpen(true);
                                                setActionError('');
                                            }}
                                            disabled={pending}
                                        >
                                            {AUDIT_TEXT.cancel}
                                        </button>
                                        {isAuditDraft(audit.status) ? (
                                            <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={submitAudit} disabled={pending}>
                                                {submitMutation.isPending ? 'جارٍ الإرسال…' : AUDIT_TEXT.submit}
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                className={PRIMARY_BUTTON_CLASS}
                                                onClick={approveAudit}
                                                disabled={pending}
                                            >
                                                {approveMutation.isPending ? 'جارٍ الاعتماد…' : AUDIT_TEXT.approve}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ) : null}

                            {!isAuditOpen(audit.status) ? (
                                <p className="text-caption text-muted">
                                    {audit.status === 'approved'
                                        ? 'جلسة معتمدة — رُحّلت فروقها إلى الأرصدة ولا تقبل التعديل.'
                                        : 'جلسة ملغاة — للعرض فقط.'}
                                </p>
                            ) : null}

                            {cancelOpen ? (
                                <div className="flex flex-col gap-xs rounded-md border border-danger/40 bg-danger-soft p-sm">
                                    <label className="flex min-w-0 flex-col gap-xxs text-label-md text-ink-secondary">
                                        سبب الإلغاء (3 أحرف على الأقل)
                                        <input
                                            type="text"
                                            value={cancelReason}
                                            maxLength={200}
                                            onChange={(event) => {
                                                setCancelReason(event.target.value);
                                            }}
                                            className={FIELD_CLASS}
                                        />
                                    </label>
                                    <div className="flex flex-wrap items-center justify-end gap-xs">
                                        <button
                                            type="button"
                                            className={SECONDARY_BUTTON_CLASS}
                                            onClick={() => {
                                                setCancelOpen(false);
                                                setCancelReason('');
                                            }}
                                            disabled={pending}
                                        >
                                            تراجع
                                        </button>
                                        <button type="button" className={DANGER_BUTTON_CLASS} onClick={confirmCancel} disabled={pending}>
                                            {cancelMutation.isPending ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </>
                    )}
                </div>
            )}
        </Dialog>
    );
}

function KpiTile({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex min-w-0 flex-col gap-xxs rounded-md border border-hairline bg-surface-raised p-sm">
            <span className="text-caption text-muted">{label}</span>
            <span className="erp-numeric text-heading-sm text-ink" dir="ltr">
                {value}
            </span>
        </div>
    );
}
