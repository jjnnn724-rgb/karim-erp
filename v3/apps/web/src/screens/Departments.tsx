import './Departments.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { PrintActions } from '../components/PrintActions';
import {
    buildDepartmentRows,
    compareDepartmentRows,
    type DepartmentSortKey,
    isMirrorDepartment,
    monthTotals,
} from '../lib/departments';
import { fetchCurrency, fetchDepartments, fetchRegister } from '../lib/finance';
import { formatMoney } from '../lib/format';
import { useAuthState } from '../lib/auth';
import {
    createDepartment,
    deleteDepartment,
    updateDepartment,
    departmentDeleteConfirm,
    DEPARTMENT_TEXT,
    type DepartmentCreateInput,
    type DepartmentUpdateInput,
    departmentWriteVisible,
    departmentDeleteVisible,
} from '../lib/departments-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';

/**
 * سجل الأقسام — CRUD كامل مثل V2:
 *  • إنشاء قسم (POST /api/departments — admin|manager)
 *  • تعديل قسم (PATCH /api/departments/:id — admin|manager)
 *  • حذف قسم (DELETE /api/departments/:id — أدمن فقط)
 *  • طباعة القائمة (PrintActions — موجود مسبقاً)
 *
 * القراءة من `/api/departments` + `/api/revenues` و`/api/expenses` للشهر الحالي.
 * الأرقام تُجمَّع محليًا من الصفوف المحمّلة.
 */

const PAGE_SIZE = 25;

function formatInt(value: number): string {
    return value.toLocaleString('en-US');
}

function monthLabel(): string {
    return new Intl.DateTimeFormat('ar', { month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' }).format(
        new Date(),
    );
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

/* ── نموذج إضافة/تعديل قسم ───────────────────────────────────────────── */

interface DepartmentFormDialogProps {
    open: boolean;
    onClose: () => void;
    pending: boolean;
    editing: { code: string; name: string; parent_code: string | null } | null;
    onSave: (payload: DepartmentCreateInput | DepartmentUpdateInput, isEditing: boolean) => Promise<void>;
}

const DEPARTMENT_FORM_ID = 'erp-department-form';

function DepartmentFormDialog({ open, onClose, pending, editing, onSave }: DepartmentFormDialogProps) {
    const [form, setForm] = useState<{
        code: string;
        name: string;
        parentCode: string;
    }>({
        code: '',
        name: '',
        parentCode: '',
    });
    const [formError, setFormError] = useState('');

    useEffect(() => {
        if (!open) {
            return;
        }
        if (editing) {
            setForm({
                code: editing.code,
                name: editing.name,
                parentCode: editing.parent_code ?? '',
            });
        } else {
            setForm({ code: '', name: '', parentCode: '' });
        }
        setFormError('');
    }, [open, editing]);

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setFormError('');
        if (!form.code.trim()) {
            setFormError(DEPARTMENT_TEXT.codeRequired);
            return;
        }
        if (!form.name.trim()) {
            setFormError(DEPARTMENT_TEXT.nameRequired);
            return;
        }

        const input: DepartmentCreateInput | DepartmentUpdateInput = {
            code: form.code.trim(),
            name: form.name.trim(),
            parent_code: form.parentCode.trim() || null,
        };

        try {
            await onSave(input, Boolean(editing));
            onClose();
        } catch (cause) {
            setFormError(writeErrorMessage(cause, editing ? DEPARTMENT_TEXT.updateFailed : DEPARTMENT_TEXT.createFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={editing ? 'تعديل القسم' : 'قسم جديد'}
            size="md"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {DEPARTMENT_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={DEPARTMENT_FORM_ID} size="sm" loading={pending}>
                        {editing ? 'حفظ التعديل' : 'إضافة القسم'}
                    </Button>
                </>
            }
        >
            <form id={DEPARTMENT_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <div className="grid gap-sm sm:grid-cols-2">
                    <Input
                        label="كود القسم"
                        name="code"
                        value={form.code}
                        onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                        readOnly={Boolean(editing)}
                        maxLength={20}
                        placeholder="ACC, HR, WH…"
                        required
                    />
                    <Input
                        label="اسم القسم"
                        name="name"
                        value={form.name}
                        onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="المحاسبة"
                        required
                    />
                    <Input
                        label="كود القسم الأب (اختياري)"
                        name="parentCode"
                        value={form.parentCode}
                        onChange={(e) => setForm((prev) => ({ ...prev, parentCode: e.target.value }))}
                        placeholder="مثال: MAIN"
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

interface DepartmentActionDialogProps {
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onClose: () => void;
    pending: boolean;
    confirmLabel: string;
}

function DepartmentActionDialog({
    open,
    title,
    message,
    onConfirm,
    onClose,
    pending,
    confirmLabel,
}: DepartmentActionDialogProps) {
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
                    {DEPARTMENT_TEXT.cancel}
                </Button>
                <Button type="button" size="sm" variant="danger" loading={pending} onClick={onConfirm}>
                    {confirmLabel}
                </Button>
            </div>
        </Dialog>
    );
}

/* ── الشاشة ───────────────────────────────────────────────────────────── */

export function Departments() {
    const auth = useAuthState();
    const canWrite = departmentWriteVisible(auth.user?.role);
    const canDelete = departmentDeleteVisible(auth.user?.role);

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<{ code: string; name: string; parent_code: string | null } | null>(null);
    const [actionOpen, setActionOpen] = useState(false);
    const [actionRow, setActionRow] = useState<{ code: string; name: string } | null>(null);
    const [actionMessage, setActionMessage] = useState('');

    const [search, setSearch] = useState('');
    const [showMirrors, setShowMirrors] = useState(false);
    const [sort, setSort] = useState<{ key: DepartmentSortKey; dir: 'asc' | 'desc' }>({
        key: 'revenue',
        dir: 'desc',
    });
    const [page, setPage] = useState(1);

    const departmentsQuery = useQuery({
        queryKey: ['departments', 'all'],
        queryFn: ({ signal }) => fetchDepartments(signal),
    });
    const revenuesQuery = useQuery({
        queryKey: ['finance', 'revenues', 'month'],
        queryFn: ({ signal }) => fetchRegister('revenues', signal),
    });
    const expensesQuery = useQuery({
        queryKey: ['finance', 'expenses', 'month'],
        queryFn: ({ signal }) => fetchRegister('expenses', signal),
    });
    const currencyQuery = useQuery({
        queryKey: ['finance', 'currency'],
        queryFn: ({ signal }) => fetchCurrency(signal),
        staleTime: 10 * 60 * 1000,
    });

    const currency = String(currencyQuery.data ?? '');
    const allRows = useMemo(
        () => buildDepartmentRows(departmentsQuery.data ?? [], revenuesQuery.data ?? [], expensesQuery.data ?? []),
        [departmentsQuery.data, revenuesQuery.data, expensesQuery.data],
    );
    const operationalRows = useMemo(() => allRows.filter((row) => !isMirrorDepartment(row.code)), [allRows]);
    const totals = useMemo(
        () => monthTotals(revenuesQuery.data ?? [], expensesQuery.data ?? []),
        [revenuesQuery.data, expensesQuery.data],
    );

    const rows = useMemo(() => {
        const term = search.trim().toLowerCase();
        const filtered = allRows.filter((row) => {
            if (!showMirrors && isMirrorDepartment(row.code)) {
                return false;
            }
            if (!term) {
                return true;
            }
            return [row.code, row.name, row.parentName]
                .map((value) => value.toLowerCase())
                .some((value) => value.includes(term));
        });
        const sorted = [...filtered].sort((a, b) => compareDepartmentRows(a, b, sort.key));
        return sort.dir === 'asc' ? sorted : sorted.reverse();
    }, [allRows, search, showMirrors, sort]);

    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    const loading = departmentsQuery.isPending || revenuesQuery.isPending || expensesQuery.isPending;
    const failure = departmentsQuery.error ?? revenuesQuery.error ?? expensesQuery.error;

    function toggleSort(key: DepartmentSortKey) {
        setPage(1);
        setSort((previous) =>
            previous.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' },
        );
    }

    function ariaSort(key: DepartmentSortKey): 'ascending' | 'descending' | 'none' {
        if (sort.key !== key) {
            return 'none';
        }
        return sort.dir === 'asc' ? 'ascending' : 'descending';
    }

    function resetFilters() {
        setSearch('');
        setShowMirrors(false);
        setSort({ key: 'revenue', dir: 'desc' });
        setPage(1);
    }

    /* ── الكتبات عبر useWriteMutation ────────────────────────────────── */

    const createDepartmentMutation = useWriteMutation<DepartmentCreateInput, { id: string | number }>({
        mutationFn: (input) => createDepartment(input).then((r) => ({ id: r.id })),
        successTitle: () => DEPARTMENT_TEXT.createSuccess,
        invalidate: [['departments', 'all'], ['finance', 'revenues', 'month'], ['finance', 'expenses', 'month']],
        silentError: true,
        onSuccess: () => {
            setFormOpen(false);
            setEditing(null);
        },
    });

    const updateDepartmentMutation = useWriteMutation<{ id: string | number; input: DepartmentUpdateInput }, { id: string | number }>({
        mutationFn: ({ id, input }) => updateDepartment(id, input).then((r) => ({ id: r.id })),
        successTitle: () => DEPARTMENT_TEXT.updateSuccess,
        invalidate: [['departments', 'all'], ['finance', 'revenues', 'month'], ['finance', 'expenses', 'month']],
        silentError: true,
        onSuccess: () => {
            setFormOpen(false);
            setEditing(null);
        },
    });

    const deleteDepartmentMutation = useWriteMutation<string | number, void>({
        mutationFn: (id) => deleteDepartment(id),
        successTitle: () => DEPARTMENT_TEXT.deleteSuccess,
        invalidate: [['departments', 'all'], ['finance', 'revenues', 'month'], ['finance', 'expenses', 'month']],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    async function openForm(row?: { code: string; name: string; parent_code: string | null }) {
        setEditing(row ?? null);
        setFormOpen(true);
    }

    async function handleDelete(row: { code: string; name: string }) {
        setActionRow(row);
        setActionMessage(departmentDeleteConfirm(row.name));
        setActionOpen(true);
    }

    async function confirmAction() {
        if (!actionRow) return;
        await deleteDepartmentMutation.mutateAsync(actionRow.code);
    }

    return (
        <div className="erp-premium-screen flex flex-col gap-md">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        الأقسام{' '}
                        <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted" dir="ltr" lang="en">
                            Departments
                        </span>
                    </h1>
                    <p className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                        سجل الأقسام وإيراد ومصروف {monthLabel()} — إضافة وتعديل وحذف.
                        القراءة من `/api/departments`، والكتابة لـ admin|manager والحذف للأدمن فقط.
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    {canWrite ? (
                        <Button type="button" size="sm" onClick={() => openForm()}>
                            إضافة قسم
                        </Button>
                    ) : null}
                    <PrintActions title="الأقسام" />
                    <button
                        type="button"
                        onClick={() => {
                            void departmentsQuery.refetch();
                            void revenuesQuery.refetch();
                            void expensesQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                    label="الأقسام التشغيلية"
                    english="Departments"
                    value={formatInt(operationalRows.length)}
                    hint="بلا أقسام المرآة ys_"
                />
                <Kpi
                    label="إيراد الشهر"
                    english="Revenue"
                    value={`${formatMoney(totals.revenue)} ${currency}`.trim()}
                    hint={`كل صفوف ${monthLabel()} — تشمل المرآة وغير المسندة`}
                />
                <Kpi
                    label="مصروف الشهر"
                    english="Expense"
                    value={`${formatMoney(totals.expense)} ${currency}`.trim()}
                    hint="كل الصفوف — صرف المخزون واليدوي والفرق معًا"
                />
                <Kpi
                    label="الصافي"
                    english="Net"
                    value={`${formatMoney(totals.net)} ${currency}`.trim()}
                    hint="الإيراد − المصروف"
                />
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label
                        className="flex min-w-56 flex-1 flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-departments-search"
                    >
                        بحث
                        <input
                            id="erp-departments-search"
                            type="search"
                            value={search}
                            placeholder="الكود أو الاسم أو القسم الأب…"
                            onChange={(event) => {
                                setSearch(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <label className="flex items-center gap-xs pb-xxs text-body-sm text-ink-secondary">
                        <input
                            type="checkbox"
                            checked={showMirrors}
                            onChange={(event) => {
                                setShowMirrors(event.target.checked);
                                setPage(1);
                            }}
                        />
                        إظهار أقسام المرآة (ys_)
                    </label>
                    <button
                        type="button"
                        onClick={resetFilters}
                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                    >
                        إعادة الضبط
                    </button>
                    <span className="text-body-sm text-muted">{formatInt(rows.length)} قسمًا</span>
                </div>
            </Card>

            <Card>
                {loading ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل الأقسام وأرقام الشهر" />
                        <TableSkeleton rows={6} columns={6} />
                    </div>
                ) : null}

                {failure ? (
                    <StateError
                        message={failure instanceof Error ? failure.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void departmentsQuery.refetch();
                            void revenuesQuery.refetch();
                            void expensesQuery.refetch();
                        }}
                    />
                ) : null}

                {!loading && !failure && rows.length === 0 ? (
                    <StateEmpty title="لا أقسام" hint="لا يوجد قسم مطابق للبحث — امسح البحث أو أظهر أقسام المرآة." />
                ) : null}

                {!loading && !failure && rows.length > 0 ? (
                    <>
                        <TableScroll label="جدول الأقسام">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th
                                            scope="col"
                                            aria-sort={ariaSort('code')}
                                            className="px-sm py-xs text-start font-medium"
                                        >
                                            <button type="button" onClick={() => toggleSort('code')}>
                                                الكود
                                            </button>
                                        </th>
                                        <th
                                            scope="col"
                                            aria-sort={ariaSort('name')}
                                            className="px-sm py-xs text-start font-medium"
                                        >
                                            <button type="button" onClick={() => toggleSort('name')}>
                                                القسم
                                            </button>
                                        </th>
                                        <th
                                            scope="col"
                                            aria-sort={ariaSort('revenue')}
                                            className="px-sm py-xs text-end font-medium"
                                        >
                                            <button type="button" onClick={() => toggleSort('revenue')}>
                                                الإيراد
                                            </button>
                                        </th>
                                        <th
                                            scope="col"
                                            aria-sort={ariaSort('expense')}
                                            className="px-sm py-xs text-end font-medium"
                                        >
                                            <button type="button" onClick={() => toggleSort('expense')}>
                                                المصروف
                                            </button>
                                        </th>
                                        <th
                                            scope="col"
                                            aria-sort={ariaSort('net')}
                                            className="px-sm py-xs text-end font-medium"
                                        >
                                            <button type="button" onClick={() => toggleSort('net')}>
                                                الصافي
                                            </button>
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-end font-medium">
                                            نسبة التكلفة
                                        </th>
                                        {(canWrite || canDelete) && (
                                            <th scope="col" className="px-sm py-xs text-start font-medium" data-erp-print-hide>
                                                إجراءات
                                            </th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row) => (
                                        <tr key={row.code} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {row.code}
                                            </td>
                                            <td className="px-sm py-xxs">
                                                <span className="block text-ink">{row.name}</span>
                                                {row.parentName ? (
                                                    <span className="block text-caption text-muted">
                                                        تحت {row.parentName}
                                                    </span>
                                                ) : null}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink">
                                                {row.revenue === '0.00' ? '—' : formatMoney(row.revenue)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink">
                                                {row.expense === '0.00' ? '—' : formatMoney(row.expense)}
                                            </td>
                                            <td
                                                className={`erp-numeric px-sm py-xxs text-end ${
                                                    row.net.startsWith('-') ? 'text-danger-text' : 'text-ink'
                                                }`}
                                            >
                                                {row.net === '0.00' ? '—' : formatMoney(row.net)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-body-sm text-muted">
                                                {row.costRatio === null ? '—' : `${row.costRatio.toFixed(1)}%`}
                                            </td>
                                            {(canWrite || canDelete) && (
                                                <td className="px-sm py-xxs" data-erp-print-hide>
                                                    <div className="flex flex-wrap items-center gap-xs">
                                                        {canWrite ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="secondary"
                                                                title="تعديل القسم"
                                                                onClick={() =>
                                                                    openForm({
                                                                        code: row.code,
                                                                        name: row.name,
                                                                        parent_code: row.parentCode,
                                                                    })
                                                                }
                                                            >
                                                                تعديل
                                                            </Button>
                                                        ) : null}
                                                        {canDelete ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="danger"
                                                                title="حذف القسم"
                                                                onClick={() => handleDelete({ code: row.code, name: row.name })}
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
            <DepartmentFormDialog
                open={formOpen}
                onClose={() => setFormOpen(false)}
                pending={createDepartmentMutation.isPending || updateDepartmentMutation.isPending}
                editing={editing}
                onSave={async (input, isEditing) => {
                    if (isEditing && editing) {
                        await updateDepartmentMutation.mutateAsync({ id: editing.code, input: input as DepartmentUpdateInput });
                    } else {
                        await createDepartmentMutation.mutateAsync(input as DepartmentCreateInput);
                    }
                }}
            />
            <DepartmentActionDialog
                open={actionOpen}
                title="حذف القسم"
                message={actionMessage}
                onConfirm={confirmAction}
                onClose={() => {
                    setActionOpen(false);
                    setActionRow(null);
                }}
                pending={deleteDepartmentMutation.isPending}
                confirmLabel="حذف"
            />
        </div>
    );
}
