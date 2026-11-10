import './Branches.premium.css';
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
import { useAuthState } from '../lib/auth';
import {
    createBranch,
    deactivateBranch,
    reactivateBranch,
    updateBranch,
    type BranchForm,
    type BranchRow,
    branchToRow,
    branchTotals,
    fetchBranches,
    searchBranches,
    validateBranchForm,
} from '../lib/branches';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { StatCard } from '../ui/StatCard';

/**
 * فروع المنشأة — CRUD كامل مثل V2:
 *  • إنشاء فرع (POST /api/branches — admin)
 *  • تعديل بيانات الفرع (PATCH /api/branches/:id — admin)
 *  • إيقاف/تفعيل الفرع (DELETE/PATCH /api/branches/:id — admin — حذف ليّن)
 *  • طباعة القائمة (PrintActions: طباعة · تحميل PDF · مشاركة PDF)
 *
 * القراءة من `/api/branches` متاحة لأي حساب مصادق. `?all=1` يُظهر المعطّل
 * للأدمن وحده. الكود غير قابل للتعديل بعد الإنشاء (مثل V2). الفرع الرئيسي
 * لا يُوقف.
 */

const PAGE_SIZE = 25;

type SortKey = 'id' | 'code' | 'nameAr' | 'currency' | 'status';

function formatInt(value: number): string {
    return value.toLocaleString('en-US');
}

function Kpi({ label, english, value, hint }: { label: string; english: string; value: string; hint: string }) {
    return <StatCard label={label} english={english} value={value} hint={hint} />;
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

function compare(a: BranchRow, b: BranchRow, key: SortKey): number {
    if (key === 'id') {
        return Number(a.id) - Number(b.id);
    }
    if (key === 'code') {
        return a.code.localeCompare(b.code, 'en');
    }
    if (key === 'currency') {
        return a.currency.localeCompare(b.currency, 'en');
    }
    if (key === 'status') {
        return a.statusLabel.localeCompare(b.statusLabel, 'ar');
    }
    return a.nameAr.localeCompare(b.nameAr, 'ar');
}

const BRANCH_TEXT = {
    codeInvalid: 'كود الفرع: من 1 إلى 20 حرفًا لاتينيًا أو رقمًا أو _ أو -',
    nameRequired: 'اسم الفرع بالعربية مطلوب',
    currencyInvalid: 'العملة رمز ISO من 3 حروف (SAR / EGP / AED)',
    createFailed: 'فشل إنشاء الفرع في قاعدة البيانات',
    updateFailed: 'فشل تحديث بيانات الفرع',
    deactivateFailed: 'فشل إيقاف الفرع',
    activateFailed: 'فشل تفعيل الفرع',
    createSuccess: 'تم إنشاء الفرع بنجاح',
    updateSuccess: 'تم تحديث بيانات الفرع',
    deactivateSuccess: 'تم إيقاف الفرع',
    activateSuccess: 'تم تفعيل الفرع',
    confirmCreate: 'إضافة فرع جديد؟',
    confirmUpdate: 'تعديل بيانات الفرع «%s»؟',
    confirmDeactivate: 'إيقاف فرع «%s»؟ يُخفى من القوائم، وسجلاته التاريخية تبقى كما هي.',
    confirmActivate: 'تفعيل فرع «%s»؟ سيظهر في القوائم مرة أخرى.',
    mainCannotDeactivate: 'الفرع الرئيسي لا يُوقف',
    cancel: 'إلغاء',
} as const;

/* ── نموذج إضافة/تعديل فرع ───────────────────────────────────────────── */

interface BranchFormDialogProps {
    open: boolean;
    onClose: () => void;
    pending: boolean;
    editing: BranchRow | null;
    onSave: (payload: BranchForm) => Promise<void>;
}

const BRANCH_FORM_ID = 'erp-branches-form';

function BranchFormDialog({ open, onClose, pending, editing, onSave }: BranchFormDialogProps) {
    const [form, setForm] = useState<BranchForm>({
        code: '',
        name_ar: '',
        name_en: '',
        currency: 'SAR',
        timezone: 'Asia/Riyadh',
        phone: '',
        address: '',
    });
    const [formError, setFormError] = useState('');

    useEffect(() => {
        if (!open) {
            return;
        }
        if (editing) {
            setForm({
                code: editing.code,
                name_ar: editing.nameAr,
                name_en: editing.nameEn ?? '',
                currency: editing.currency,
                timezone: editing.timezone,
                phone: editing.phone ?? '',
                address: editing.address ?? '',
            });
        } else {
            setForm({ code: '', name_ar: '', name_en: '', currency: 'SAR', timezone: 'Asia/Riyadh', phone: '', address: '' });
        }
        setFormError('');
    }, [open, editing]);

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setFormError('');
        const errors = validateBranchForm(form, Boolean(editing));
        if (errors.length) {
            setFormError(errors.map((e) => e.message).join(' · '));
            return;
        }

        const payload: BranchForm = {
            code: (form.code ?? '').trim(),
            name_ar: (form.name_ar ?? '').trim(),
            name_en: (form.name_en ?? '').trim() || null,
            currency: ((form.currency ?? 'SAR').trim() || 'SAR').toUpperCase(),
            timezone: ((form.timezone ?? 'Asia/Riyadh').trim() || 'Asia/Riyadh'),
            phone: (form.phone ?? '').trim() || null,
            address: (form.address ?? '').trim() || null,
        };

        try {
            await onSave(payload);
            onClose();
        } catch (cause) {
            setFormError(writeErrorMessage(cause, editing ? BRANCH_TEXT.updateFailed : BRANCH_TEXT.createFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={editing ? 'تعديل الفرع' : 'فرع جديد'}
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {BRANCH_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={BRANCH_FORM_ID} size="sm" loading={pending}>
                        {editing ? 'حفظ التعديل' : 'إضافة الفرع'}
                    </Button>
                </>
            }
        >
            <form id={BRANCH_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <div className="grid gap-sm sm:grid-cols-2">
                    <Input
                        label="الكود"
                        name="code"
                        value={form.code ?? ''}
                        onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                        readOnly={Boolean(editing)}
                        maxLength={20}
                        placeholder="MAIN, NORTH, SOUTH…"
                        required
                    />
                    <Input
                        label="الاسم بالعربية"
                        name="name_ar"
                        value={form.name_ar ?? ''}
                        onChange={(e) => setForm((prev) => ({ ...prev, name_ar: e.target.value }))}
                        placeholder="فرع الشمال"
                        required
                    />
                    <Input
                        label="الاسم بالإنجليزية (اختياري)"
                        name="name_en"
                        value={form.name_en ?? ''}
                        onChange={(e) => setForm((prev) => ({ ...prev, name_en: e.target.value || null }))}
                        placeholder="North Branch"
                    />
                    <Input
                        label="العملة"
                        name="currency"
                        value={form.currency ?? 'SAR'}
                        onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))}
                        placeholder="SAR"
                        required
                    />
                    <Input
                        label="المنطقة الزمنية"
                        name="timezone"
                        value={form.timezone ?? 'Asia/Riyadh'}
                        onChange={(e) => setForm((prev) => ({ ...prev, timezone: e.target.value }))}
                        placeholder="Asia/Riyadh"
                        required
                    />
                    <Input
                        label="الهاتف (اختياري)"
                        name="phone"
                        value={form.phone ?? ''}
                        onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value || null }))}
                        placeholder="+20 2 12345678"
                    />
                    <Input
                        label="العنوان (اختياري)"
                        name="address"
                        value={form.address ?? ''}
                        onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value || null }))}
                        placeholder="القاهرة، مصر"
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

/* ── نموذج تأكيد الإيقاف/التفعيل ─────────────────────────────────────── */

interface BranchActionDialogProps {
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onClose: () => void;
    pending: boolean;
    confirmLabel: string;
}

function BranchActionDialog({
    open,
    title,
    message,
    onConfirm,
    onClose,
    pending,
    confirmLabel,
}: BranchActionDialogProps) {
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
                    {BRANCH_TEXT.cancel}
                </Button>
                <Button type="button" size="sm" variant="danger" loading={pending} onClick={onConfirm}>
                    {confirmLabel}
                </Button>
            </div>
        </Dialog>
    );
}

/* ── الشاشة ───────────────────────────────────────────────────────────── */

export function Branches() {
    const auth = useAuthState();
    const canManage = auth.user?.role === 'admin';
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<BranchRow | null>(null);
    const [actionOpen, setActionOpen] = useState(false);
    const [actionRow, setActionRow] = useState<BranchRow | null>(null);
    const [actionType, setActionType] = useState<'activate' | 'deactivate'>('deactivate');
    const [actionTitle, setActionTitle] = useState('');
    const [actionMessage, setActionMessage] = useState('');

    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('');
    const [currency, setCurrency] = useState('');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
    const [page, setPage] = useState(1);

    const branchesQuery = useQuery({
        queryKey: ['branches'],
        queryFn: ({ signal }) => fetchBranches(signal),
    });

    const allRows = useMemo(() => (branchesQuery.data ?? []).map(branchToRow), [branchesQuery.data]);
    const totals = useMemo(() => branchTotals(allRows), [allRows]);

    const filteredRows = useMemo(() => {
        return allRows.filter((row) => {
            if (status === 'active' && !row.active) return false;
            if (status === 'inactive' && row.active) return false;
            if (currency && row.currency !== currency) return false;
            return true;
        });
    }, [allRows, status, currency]);

    const search = useMemo(() => searchBranches(filteredRows, query), [filteredRows, query]);
    const rows = search.rows;

    const sorted = useMemo(() => {
        if (!sort) return rows;
        const copy = [...rows].sort((a, b) => compare(a, b, sort.key));
        return sort.dir === 'asc' ? copy : copy.reverse();
    }, [rows, sort]);

    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const filtered = Boolean(query || status || currency);

    function toggleSort(key: SortKey) {
        setPage(1);
        setSort((previous) =>
            previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
        );
    }

    function resetFilters() {
        setQuery('');
        setStatus('');
        setCurrency('');
        setSort(null);
        setPage(1);
    }

    /* ── الكتبات عبر useWriteMutation ────────────────────────────────── */

    const createBranchMutation = useWriteMutation<BranchForm, { id: string }>({
        mutationFn: (form) => createBranch(form).then(() => ({ id: '' })),
        successTitle: () => BRANCH_TEXT.createSuccess,
        invalidate: [['branches']],
        silentError: true,
        onSuccess: () => {
            setFormOpen(false);
            setEditing(null);
        },
    });

    const updateBranchMutation = useWriteMutation<{ id: string; form: BranchForm }, { id: string }>({
        mutationFn: ({ id, form }) => updateBranch(id, form).then(() => ({ id })),
        successTitle: () => BRANCH_TEXT.updateSuccess,
        invalidate: [['branches']],
        silentError: true,
        onSuccess: () => {
            setFormOpen(false);
            setEditing(null);
        },
    });

    const changeBranchStatusMutation = useWriteMutation<{ id: string; active: boolean }, { id: string; active: boolean }>({
        mutationFn: ({ id, active }) =>
            active ? reactivateBranch(id).then(() => ({ id, active: true })) : deactivateBranch(id).then(() => ({ id, active: false })),
        successTitle: ({ active }) => (active ? BRANCH_TEXT.activateSuccess : BRANCH_TEXT.deactivateSuccess),
        invalidate: [['branches']],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    async function openForm(row?: BranchRow) {
        setEditing(row ?? null);
        setFormOpen(true);
    }

    async function handleChangeStatus(row: BranchRow, activate: boolean) {
        setActionRow(row);
        setActionType(activate ? 'activate' : 'deactivate');
        setActionTitle(activate ? 'تفعيل الفرع' : 'إيقاف الفرع');
        setActionMessage(activate ? BRANCH_TEXT.confirmActivate.replace('%s', row.nameAr) : BRANCH_TEXT.confirmDeactivate.replace('%s', row.nameAr));
        setActionOpen(true);
    }

    async function confirmAction() {
        if (!actionRow) return;
        await changeBranchStatusMutation.mutateAsync({ id: actionRow.id, active: actionType === 'activate' });
    }

    return (
        <div className="flex flex-col gap-lg erp-premium erp-premium-branches">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        فروع المنشأة{' '}
                        <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted" dir="ltr" lang="en">
                            Branches
                        </span>
                    </h1>
                    <p className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                        الفروع وأكوادها وعملاتها ومناطقها الزمنية — إضافة وتعديل وإيقاف وتفعيل.
                        القراءة متاحة لأي حساب مصادق، والكتابة والإدارة محجوزة للأدمن. الفرع الرئيسي لا يُوقف.
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    {canManage ? (
                        <Button type="button" size="sm" onClick={() => openForm()}>
                            إضافة فرع
                        </Button>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => {
                            void branchesQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                    <PrintActions title="فروع المنشأة" />
                </div>
            </header>

            <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات الفروع">
                <Kpi
                    label="الفروع"
                    english="Branches"
                    value={formatInt(totals.total)}
                    hint={filtered ? `بعد المرشّحات: ${formatInt(sorted.length)}` : 'كل ما وصل من الخادم'}
                />
                <Kpi
                    label="مفعّل"
                    english="Active"
                    value={formatInt(totals.active)}
                    hint={totals.inactive ? `${formatInt(totals.inactive)} موقوف` : 'كل الفروع مفعّلة'}
                />
                <Kpi
                    label="موقوف"
                    english="Inactive"
                    value={formatInt(totals.inactive)}
                    hint={totals.inactive ? 'سجلاته التاريخية تبقى كما هي' : 'لا فروع موقوفة'}
                />
                <Kpi
                    label="العملات"
                    english="Currencies"
                    value={formatInt(totals.currencies.length)}
                    hint={totals.currencies.length ? totals.currencies.join(' · ') : 'لا عملة مسجّلة'}
                />
            </ul>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-md">
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-branches-q">
                        بحث
                        <input
                            id="erp-branches-q"
                            type="search"
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setPage(1);
                            }}
                            placeholder="كود، اسم، عملة، منطقة، هاتف"
                            className="h-10 w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-64"
                        />
                    </label>
                    <label
                        className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-branches-status"
                    >
                        الحالة
                        <select
                            id="erp-branches-status"
                            value={status}
                            onChange={(event) => {
                                setStatus(event.target.value);
                                setPage(1);
                            }}
                            className="h-10 w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-auto"
                        >
                            <option value="">كل الحالات</option>
                            <option value="active">مفعّل</option>
                            <option value="inactive">موقوف</option>
                        </select>
                    </label>
                    <label
                        className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-branches-currency"
                    >
                        العملة
                        <select
                            id="erp-branches-currency"
                            value={currency}
                            onChange={(event) => {
                                setCurrency(event.target.value);
                                setPage(1);
                            }}
                            className="h-10 w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-auto"
                        >
                            <option value="">كل العملات</option>
                            {totals.currencies.map((code) => (
                                <option key={code} value={code}>
                                    {code}
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
                    <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted" role="status">
                        {formatInt(sorted.length)} فرعًا معروضًا من {formatInt(totals.total)}
                    </span>
                </div>
                {search.folded ? (
                    <p className="mt-sm text-body-sm text-muted">
                        بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.
                    </p>
                ) : null}
            </Card>

            <Card className="p-sm">
                <h2 className="px-sm pt-sm text-heading-sm text-ink">توزيع الفروع حسب الحالة</h2>
                <ul className="flex flex-col gap-xxs p-sm" aria-label="توزيع الفروع على الحالات">
                    <li key="active" className="flex items-center gap-sm text-body-sm">
                        <span className="w-40 shrink-0 truncate text-ink">مفعّل</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                            <span className="block h-full rounded-full bg-success-text" style={{ width: `${totals.total ? (totals.active / totals.total) * 100 : 0}%` }} />
                        </span>
                        <span className="erp-numeric w-16 shrink-0 text-end text-ink" dir="ltr">{formatInt(totals.active)}</span>
                        <span className="erp-numeric w-14 shrink-0 text-end text-caption text-muted" dir="ltr">{totals.total ? ((totals.active / totals.total) * 100).toFixed(1) : '0'}%</span>
                    </li>
                    <li key="inactive" className="flex items-center gap-sm text-body-sm">
                        <span className="w-40 shrink-0 truncate text-ink">موقوف</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                            <span className="block h-full rounded-full bg-danger-text" style={{ width: `${totals.total ? (totals.inactive / totals.total) * 100 : 0}%` }} />
                        </span>
                        <span className="erp-numeric w-16 shrink-0 text-end text-ink" dir="ltr">{formatInt(totals.inactive)}</span>
                        <span className="erp-numeric w-14 shrink-0 text-end text-caption text-muted" dir="ltr">{totals.total ? ((totals.inactive / totals.total) * 100).toFixed(1) : '0'}%</span>
                    </li>
                </ul>
            </Card>

            <Card>
                {branchesQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل الفروع" />
                        <TableSkeleton rows={4} columns={8} />
                    </div>
                ) : null}

                {branchesQuery.isError ? (
                    <StateError
                        message={branchesQuery.error instanceof Error ? branchesQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void branchesQuery.refetch();
                        }}
                    />
                ) : null}

                {branchesQuery.isSuccess && sorted.length === 0 ? (
                    <StateEmpty
                        title={filtered ? 'لا فروع تطابق المرشّحات' : 'لا فروع مسجّلة'}
                        hint={
                            filtered
                                ? 'لا نتائج مطابقة؛ عدّل المرشّحات أو امسحها.'
                                : 'أضف أول فرع.'
                        }
                    />
                ) : null}

                {branchesQuery.isSuccess && sorted.length > 0 ? (
                    <>
                        <p className="border-b border-hairline px-sm py-xs text-body-sm text-muted" role="status">
                            {`${formatInt(sorted.length)} فرعًا`}
                            {search.exact ? ` · ${formatInt(search.exact)} مطابقة تامة للكود` : ''}
                        </p>
                        <TableScroll label="جدول فروع المنشأة">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh label="#" sortKey="id" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الكود" sortKey="code" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الاسم" sortKey="nameAr" sort={sort} onToggle={toggleSort} />
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الاسم الإنجليزي
                                        </th>
                                        <SortableTh label="العملة" sortKey="currency" sort={sort} onToggle={toggleSort} />
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            المنطقة الزمنية
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الهاتف
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            العنوان
                                        </th>
                                        <SortableTh label="الحالة" sortKey="status" sort={sort} onToggle={toggleSort} />
                                        {canManage ? (
                                            <th scope="col" className="px-sm py-xs text-start font-medium" data-erp-print-hide>
                                                إجراءات
                                            </th>
                                        ) : null}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row) => (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="erp-numeric px-sm py-xxs text-end text-muted" dir="ltr">
                                                {row.id}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {row.code || '—'}
                                                {row.code.toUpperCase() === 'MAIN' ? (
                                                    <span className="text-caption text-faint"> (رئيسي)</span>
                                                ) : null}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">{row.nameAr || '—'}</td>
                                            <td className="px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {row.nameEn || '—'}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {row.currency || '—'}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {row.timezone || '—'}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {row.phone || '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">
                                                {row.address || '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm">
                                                <span className={row.active ? 'text-success-text' : 'text-muted'}>
                                                    {row.statusLabel}
                                                </span>
                                            </td>
                                            {canManage ? (
                                                <td className="px-sm py-xxs" data-erp-print-hide>
                                                    <div className="flex flex-wrap items-center gap-xs">
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="secondary"
                                                            title="تعديل الفرع"
                                                            onClick={() => openForm(row)}
                                                        >
                                                            تعديل
                                                        </Button>
                                                        {row.code.toUpperCase() === 'MAIN' ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="secondary"
                                                                disabled
                                                                title={BRANCH_TEXT.mainCannotDeactivate}
                                                            >
                                                                إيقاف
                                                            </Button>
                                                        ) : row.active ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="secondary"
                                                                title="إيقاف الفرع"
                                                                onClick={() => handleChangeStatus(row, false)}
                                                            >
                                                                إيقاف
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="secondary"
                                                                title="تفعيل الفرع"
                                                                onClick={() => handleChangeStatus(row, true)}
                                                            >
                                                                تفعيل
                                                            </Button>
                                                        )}
                                                    </div>
                                                </td>
                                            ) : null}
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
            <BranchFormDialog
                open={formOpen}
                onClose={() => setFormOpen(false)}
                pending={createBranchMutation.isPending || updateBranchMutation.isPending}
                editing={editing}
                onSave={async (payload: BranchForm) => {
                    if (editing) {
                        await updateBranchMutation.mutateAsync({ id: editing.id, form: payload });
                    } else {
                        await createBranchMutation.mutateAsync(payload);
                    }
                }}
            />
            <BranchActionDialog
                open={actionOpen}
                title={actionTitle}
                message={actionMessage}
                onConfirm={confirmAction}
                onClose={() => {
                    setActionOpen(false);
                    setActionRow(null);
                }}
                pending={changeBranchStatusMutation.isPending}
                confirmLabel={actionType === 'activate' ? 'تفعيل' : 'إيقاف'}
            />
        </div>
    );
}
