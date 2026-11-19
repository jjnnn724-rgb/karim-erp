import './FinanceRegister.premium.css';
import { toCents } from '@karim/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import {
    type Department,
    EXPENSE_KIND_LABEL,
    expenseKind,
    fetchCurrency,
    fetchDepartments,
    fetchRegister,
    firstOfMonth,
    normalizeAmount,
    noteText,
    type RegisterEntity,
    type RegisterRow,
    riyadhToday,
    sumAmounts,
} from '../lib/finance';
import {
    addExpenseSuccess,
    addRevenueSuccess,
    createRegisterRow,
    deleteExpenseConfirm,
    deleteExpenseSuccess,
    deleteRegisterRow,
    deleteRevenueConfirm,
    deleteRevenueSuccess,
    EXPENSE_CATEGORIES,
    type ExpenseForm,
    expenseFormOf,
    expenseNameOf,
    FINANCE_TEXT,
    FINANCE_WRITE_ROLES,
    type FinanceEntity,
    type FinanceField,
    type FinanceForm,
    type FinanceFormError,
    financeFailureText,
    isLockedExpense,
    type RevenueForm,
    revenueFormOf,
    revenueNameOf,
    updateExpenseSuccess,
    updateRegisterRow,
    updateRevenueSuccess,
    validateRegisterForm,
} from '../lib/finance-register-write';
import { formatMoney } from '../lib/format';
import { isWriteRole, useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';

/**
 * سجل مالي للقراءة — الإيرادات والمصروفات على سجلٍ واحد.
 *
 * البيانات من المسار القديم نفسه، فالمجاميع المعروضة هي مجموع السجلات لا
 * إعادة حسابٍ خادمية جديدة. التاريخ والبحث والقسم مرشّحات عميلة كما في
 * الشاشة القديمة؛ والترتيب للعرض فقط (المبالغ تُقارن بالمليم).
 */

const PAGE_SIZE = 50;

export interface RegisterConfig {
    entity: RegisterEntity;
    title: string;
    english: string;
    subtitle: string;
    sourceLabel: string;
    sourceOf: (row: RegisterRow) => string;
    showKind: boolean;
}

interface ViewRow {
    row: RegisterRow;
    source: string;
    deptName: string;
    notes: string;
    kind: string;
}

type SortKey = 'date' | 'amount' | 'source';

function formatInt(value: number): string {
    return value.toLocaleString('en-US');
}

function deptNameOf(departments: readonly { code: string; name: string }[], code: string): string {
    const found = departments.find((dept) => dept.code === code);
    return found ? found.name : code || '—';
}

function compareRows(a: ViewRow, b: ViewRow, key: SortKey): number {
    if (key === 'amount') {
        const left = toCents(normalizeAmount(a.row.amount));
        const right = toCents(normalizeAmount(b.row.amount));
        return left === right ? 0 : left > right ? 1 : -1;
    }
    if (key === 'source') {
        return a.source.localeCompare(b.source, 'ar');
    }
    return a.row.date.localeCompare(b.row.date);
}

function emptyFinanceForm(entity: FinanceEntity): FinanceForm {
    return entity === 'revenues'
        ? { source: '', deptId: '', amount: '', date: riyadhToday(), notes: '' }
        : { desc: '', deptId: '', category: '', amount: '', date: riyadhToday(), notes: '' };
}

interface RegisterEditDialogProps {
    open: boolean;
    entity: FinanceEntity;
    row: RegisterRow | null;
    departments: readonly Department[];
    onClose: () => void;
    onSaved: (message: string) => void;
}

/**
 * نموذج تعديل السجل — نفس حقول V2 ونفس رسائلها:
 * إيراد: المصدر/القسم/المبلغ/التاريخ/ملاحظات. مصروف: البيان/القسم/الفئة
 * (فئات V2 الأربع)/المبلغ/التاريخ/ملاحظات. الخطأ يظهر داخل النموذج ويُركَّز
 * على حقله، ورفض الخادم يُعرض بنصّه (نمط `paintFormErrors` في V2).
 */
function RegisterEditDialog({ open, entity, row, departments, onClose, onSaved }: RegisterEditDialogProps) {
    const [form, setForm] = useState<FinanceForm>(() => emptyFinanceForm(entity));
    const [error, setError] = useState<FinanceFormError | null>(null);
    const [saving, setSaving] = useState(false);
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        if (!open || !row) {
            return;
        }
        const record = row as Record<string, unknown>;
        setForm(entity === 'revenues' ? revenueFormOf(record) : expenseFormOf(record));
        setError(null);
    }, [entity, open, row]);

    function update(field: FinanceField, value: string): void {
        setForm((previous) => ({ ...previous, [field]: value }));
    }

    function errorProps(field: FinanceField): { error?: string } {
        const message = error && error.field === field ? error.message : undefined;
        return message === undefined ? {} : { error: message };
    }

    function focusField(field: FinanceField | ''): void {
        if (!field) {
            return;
        }
        formRef.current?.querySelector<HTMLInputElement>(`[name="${field}"]`)?.focus();
    }

    async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (saving || !row) {
            return;
        }
        const errors = validateRegisterForm(entity, form);
        if (errors.length > 0) {
            const first = errors[0] as FinanceFormError;
            setError(first);
            focusField(first.field);
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await updateRegisterRow(entity, String(row.id), form);
            if (entity === 'revenues') {
                onSaved(updateRevenueSuccess((form as RevenueForm).source));
            } else {
                onSaved(updateExpenseSuccess((form as ExpenseForm).desc));
            }
        } catch (cause) {
            setError({ field: '', message: writeErrorMessage(cause, FINANCE_TEXT.saveFailed) });
        } finally {
            setSaving(false);
        }
    }

    const deptId = form.deptId;
    const knownDept = departments.some((dept) => dept.code === deptId);
    const category = entity === 'expenses' ? (form as ExpenseForm).category : '';
    const knownCategory = EXPENSE_CATEGORIES.some((entry) => entry === category);

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title={entity === 'revenues' ? FINANCE_TEXT.editRevenueTitle : FINANCE_TEXT.editExpenseTitle}
            size="md"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {FINANCE_TEXT.cancel}
                    </Button>
                    <Button type="submit" form="erp-finance-edit-form" size="sm" disabled={saving}>
                        {FINANCE_TEXT.save}
                    </Button>
                </>
            }
        >
            <form
                id="erp-finance-edit-form"
                ref={formRef}
                onSubmit={(event) => void submit(event)}
                className="flex flex-col gap-sm"
            >
                {entity === 'revenues' ? (
                    <Input
                        label="المصدر"
                        name="source"
                        required
                        requiredMark
                        maxLength={255}
                        value={(form as RevenueForm).source}
                        {...errorProps('source')}
                        onChange={(event) => {
                            update('source', event.target.value);
                        }}
                    />
                ) : (
                    <Input
                        label="البيان"
                        name="desc"
                        required
                        requiredMark
                        maxLength={255}
                        value={(form as ExpenseForm).desc}
                        {...errorProps('desc')}
                        onChange={(event) => {
                            update('desc', event.target.value);
                        }}
                    />
                )}

                <label
                    className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                    htmlFor="erp-finance-edit-dept"
                >
                    القسم
                    <select
                        id="erp-finance-edit-dept"
                        name="deptId"
                        value={deptId}
                        onChange={(event) => {
                            update('deptId', event.target.value);
                        }}
                        className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                    >
                        {deptId === '' ? <option value="">— بلا قسم —</option> : null}
                        {departments.map((dept) => (
                            <option key={dept.code} value={dept.code}>
                                {dept.name}
                            </option>
                        ))}
                        {deptId !== '' && !knownDept ? <option value={deptId}>{deptId}</option> : null}
                    </select>
                </label>

                {entity === 'expenses' ? (
                    <label
                        className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-finance-edit-category"
                    >
                        الفئة
                        <select
                            id="erp-finance-edit-category"
                            name="category"
                            value={category}
                            onChange={(event) => {
                                update('category', event.target.value);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            {category === '' ? <option value="">— بلا فئة —</option> : null}
                            {EXPENSE_CATEGORIES.map((entry) => (
                                <option key={entry} value={entry}>
                                    {entry}
                                </option>
                            ))}
                            {category !== '' && !knownCategory ? <option value={category}>{category}</option> : null}
                        </select>
                    </label>
                ) : null}

                <Input
                    label="المبلغ"
                    name="amount"
                    type="number"
                    step="0.01"
                    required
                    requiredMark
                    dir="ltr"
                    value={form.amount}
                    {...errorProps('amount')}
                    onChange={(event) => {
                        update('amount', event.target.value);
                    }}
                />

                <Input
                    label="التاريخ"
                    name="date"
                    type="date"
                    required
                    requiredMark
                    dir="ltr"
                    value={form.date}
                    {...errorProps('date')}
                    onChange={(event) => {
                        update('date', event.target.value);
                    }}
                />

                <Input
                    label="ملاحظات"
                    name="notes"
                    value={form.notes}
                    onChange={(event) => {
                        update('notes', event.target.value);
                    }}
                />

                {entity === 'revenues' ? <p className="text-body-sm text-muted">{FINANCE_TEXT.revenueHint}</p> : null}

                {error && error.field === '' ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error.message}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

interface RegisterCreateDialogProps {
    open: boolean;
    entity: FinanceEntity;
    departments: readonly Department[];
    onClose: () => void;
    onSaved: (message: string) => void;
}

/**
 * نموذج إضافة سجل جديد — نفس حقول التعديل وقواعدها، ويُنشئ بطلب POST على
 * نفس البوابة العامة (`/api/revenues` أو `/api/expenses`) بنفس الأدوار
 * (admin|manager|accountant). لا يُرسل `id` ولا حقول النظام (autoGenerated).
 */
function RegisterCreateDialog({ open, entity, departments, onClose, onSaved }: RegisterCreateDialogProps) {
    const [form, setForm] = useState<FinanceForm>(() => emptyFinanceForm(entity));
    const [error, setError] = useState<FinanceFormError | null>(null);
    const [saving, setSaving] = useState(false);
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        setForm(emptyFinanceForm(entity));
        setError(null);
    }, [entity, open]);

    function update(field: FinanceField, value: string): void {
        setForm((previous) => ({ ...previous, [field]: value }));
    }

    function errorProps(field: FinanceField): { error?: string } {
        const message = error && error.field === field ? error.message : undefined;
        return message === undefined ? {} : { error: message };
    }

    function focusField(field: FinanceField | ''): void {
        if (!field) {
            return;
        }
        formRef.current?.querySelector<HTMLInputElement>(`[name="${field}"]`)?.focus();
    }

    async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (saving) {
            return;
        }
        const errors = validateRegisterForm(entity, form);
        if (errors.length > 0) {
            const first = errors[0] as FinanceFormError;
            setError(first);
            focusField(first.field);
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await createRegisterRow(entity, form);
            if (entity === 'revenues') {
                onSaved(addRevenueSuccess((form as RevenueForm).source));
            } else {
                onSaved(addExpenseSuccess((form as ExpenseForm).desc));
            }
        } catch (cause) {
            setError({ field: '', message: writeErrorMessage(cause, FINANCE_TEXT.saveFailed) });
        } finally {
            setSaving(false);
        }
    }

    const deptId = form.deptId;
    const category = entity === 'expenses' ? (form as ExpenseForm).category : '';

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title={entity === 'revenues' ? FINANCE_TEXT.addRevenueTitle : FINANCE_TEXT.addExpenseTitle}
            size="md"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {FINANCE_TEXT.cancel}
                    </Button>
                    <Button type="submit" form="erp-finance-create-form" size="sm" disabled={saving}>
                        {FINANCE_TEXT.save}
                    </Button>
                </>
            }
        >
            <form
                id="erp-finance-create-form"
                ref={formRef}
                onSubmit={(event) => void submit(event)}
                className="flex flex-col gap-sm"
            >
                {entity === 'revenues' ? (
                    <Input
                        label="المصدر"
                        name="source"
                        required
                        requiredMark
                        maxLength={255}
                        value={(form as RevenueForm).source}
                        {...errorProps('source')}
                        onChange={(event) => {
                            update('source', event.target.value);
                        }}
                    />
                ) : (
                    <Input
                        label="البيان"
                        name="desc"
                        required
                        requiredMark
                        maxLength={255}
                        value={(form as ExpenseForm).desc}
                        {...errorProps('desc')}
                        onChange={(event) => {
                            update('desc', event.target.value);
                        }}
                    />
                )}

                <label
                    className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                    htmlFor="erp-finance-create-dept"
                >
                    القسم
                    <select
                        id="erp-finance-create-dept"
                        name="deptId"
                        value={deptId}
                        onChange={(event) => {
                            update('deptId', event.target.value);
                        }}
                        className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                    >
                        <option value="">— بلا قسم —</option>
                        {departments.map((dept) => (
                            <option key={dept.code} value={dept.code}>
                                {dept.name}
                            </option>
                        ))}
                    </select>
                </label>

                {entity === 'expenses' ? (
                    <label
                        className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-finance-create-category"
                    >
                        الفئة
                        <select
                            id="erp-finance-create-category"
                            name="category"
                            value={category}
                            onChange={(event) => {
                                update('category', event.target.value);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            <option value="">— بلا فئة —</option>
                            {EXPENSE_CATEGORIES.map((entry) => (
                                <option key={entry} value={entry}>
                                    {entry}
                                </option>
                            ))}
                        </select>
                    </label>
                ) : null}

                <Input
                    label="المبلغ"
                    name="amount"
                    type="number"
                    step="0.01"
                    required
                    requiredMark
                    dir="ltr"
                    value={form.amount}
                    {...errorProps('amount')}
                    onChange={(event) => {
                        update('amount', event.target.value);
                    }}
                />

                <Input
                    label="التاريخ"
                    name="date"
                    type="date"
                    required
                    requiredMark
                    dir="ltr"
                    value={form.date}
                    {...errorProps('date')}
                    onChange={(event) => {
                        update('date', event.target.value);
                    }}
                />

                <Input
                    label="ملاحظات"
                    name="notes"
                    value={form.notes}
                    onChange={(event) => {
                        update('notes', event.target.value);
                    }}
                />

                {error && error.field === '' ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error.message}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

export function FinanceRegister({ config }: { config: RegisterConfig }) {
    const [from, setFrom] = useState(firstOfMonth());
    const [to, setTo] = useState(riyadhToday());
    const [dept, setDept] = useState('all');
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
    const [page, setPage] = useState(1);
    const [editingRow, setEditingRow] = useState<RegisterRow | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [pageError, setPageError] = useState('');
    const auth = useAuthState();
    const writable = isWriteRole(auth.user?.role, FINANCE_WRITE_ROLES);
    const confirm = useConfirm();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const registerQuery = useQuery({
        queryKey: ['finance', config.entity],
        queryFn: ({ signal }) => fetchRegister(config.entity, signal),
    });
    const departmentsQuery = useQuery({
        queryKey: ['finance', 'departments'],
        queryFn: ({ signal }) => fetchDepartments(signal),
        staleTime: 10 * 60 * 1000,
    });
    const currencyQuery = useQuery({
        queryKey: ['finance', 'currency'],
        queryFn: ({ signal }) => fetchCurrency(signal),
        staleTime: 10 * 60 * 1000,
    });

    // حذف السجل: نجاح بتوست V2، وفشل في شريط أعلى الشاشة بنصّ V2
    // «فشلت العملية: …» (نمط notify(kind=error) في الشاشة القديمة).
    const deleteMutation = useWriteMutation<RegisterRow, void>({
        mutationFn: async (row) => {
            await deleteRegisterRow(config.entity, String(row.id));
        },
        successTitle: (row) => {
            const record = row as Record<string, unknown>;
            return config.entity === 'revenues'
                ? deleteRevenueSuccess(revenueNameOf(record), String(row.id))
                : deleteExpenseSuccess(expenseNameOf(record), String(row.id));
        },
        invalidate: [['finance', config.entity]],
        silentError: true,
        onError: (cause) => {
            setPageError(financeFailureText(writeErrorMessage(cause)));
        },
    });

    const departments = departmentsQuery.data ?? [];
    const currency = currencyQuery.data ?? '';

    const rows = useMemo<ViewRow[]>(() => {
        const query = search.trim().toLowerCase();
        const mapped = (registerQuery.data ?? [])
            .filter((row) => {
                if (dept !== 'all' && String(row.deptId ?? '') !== dept) {
                    return false;
                }
                if (from && row.date < from) {
                    return false;
                }
                if (to && row.date > to) {
                    return false;
                }
                return true;
            })
            .map((row) => {
                const source = config.sourceOf(row);
                const notes = noteText(row.notes);
                return {
                    row,
                    source,
                    notes,
                    deptName: deptNameOf(departments, String(row.deptId ?? '')),
                    kind: config.showKind && 'adjustmentType' in row ? EXPENSE_KIND_LABEL[expenseKind(row)] : '',
                };
            });
        const searched = query
            ? mapped.filter((item) =>
                  `${item.source} ${item.notes} ${String(item.row.deptId ?? '')}`.toLowerCase().includes(query),
              )
            : mapped;
        const sorted = [...searched].sort((a, b) => compareRows(a, b, sort.key));
        return sort.dir === 'asc' ? sorted : sorted.reverse();
    }, [registerQuery.data, departments, dept, from, to, search, sort, config]);

    const total = sumAmounts(rows.map((item) => item.row));
    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const filtered = from !== firstOfMonth() || to !== riyadhToday() || dept !== 'all' || search.trim() !== '';

    function toggleSort(key: SortKey) {
        setPage(1);
        setSort((previous) =>
            previous.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
        );
    }

    function resetFilters() {
        setFrom(firstOfMonth());
        setTo(riyadhToday());
        setDept('all');
        setSearch('');
        setPage(1);
    }

    function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
        if (sort.key !== key) {
            return 'none';
        }
        return sort.dir === 'asc' ? 'ascending' : 'descending';
    }

    function openEdit(row: RegisterRow): void {
        setEditingRow(row);
        setDialogOpen(true);
    }

    function handleSaved(message: string): void {
        setDialogOpen(false);
        setEditingRow(null);
        setPageError('');
        toast({ title: message, variant: 'success' });
        void queryClient.invalidateQueries({ queryKey: ['finance', config.entity] });
    }

    async function handleDelete(row: RegisterRow): Promise<void> {
        if (deleteMutation.isPending) {
            return;
        }
        setPageError('');
        const record = row as Record<string, unknown>;
        const message =
            config.entity === 'revenues'
                ? deleteRevenueConfirm(revenueNameOf(record), String(row.id))
                : deleteExpenseConfirm(expenseNameOf(record), String(row.id));
        const answer = await confirm(message);
        if (!answer) {
            return;
        }
        deleteMutation.mutate(row);
    }

    function editLocked(row: RegisterRow): boolean {
        return config.entity === 'expenses' && isLockedExpense(row as Record<string, unknown>);
    }

    return (
        <div className="finance-register-premium flex flex-col gap-md">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        {config.title}{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            {config.english}
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">{config.subtitle}</p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    {writable ? (
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                                setPageError('');
                                setCreateOpen(true);
                            }}
                        >
                            {config.entity === 'revenues' ? 'إضافة إيراد' : 'إضافة مصروف'}
                        </Button>
                    ) : null}
                    <PrintActions title={config.title} />
                    <button
                        type="button"
                        onClick={resetFilters}
                        disabled={!filtered}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                    >
                        عرض الكل
                    </button>
                </div>
            </header>

            {pageError ? (
                <p role="alert" className="text-body-sm text-danger-text">
                    {pageError}
                </p>
            ) : null}

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <label
                        className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor={`erp-${config.entity}-from`}
                    >
                        من
                        <input
                            id={`erp-${config.entity}-from`}
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
                    <label
                        className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor={`erp-${config.entity}-to`}
                    >
                        إلى
                        <input
                            id={`erp-${config.entity}-to`}
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
                    <label
                        className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor={`erp-${config.entity}-dept`}
                    >
                        القسم
                        <select
                            id={`erp-${config.entity}-dept`}
                            value={dept}
                            onChange={(event) => {
                                setDept(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 min-w-40 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            <option value="all">كل الأقسام</option>
                            {departments.map((item) => (
                                <option key={item.code} value={item.code}>
                                    {item.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label
                        className="flex min-w-56 flex-1 flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor={`erp-${config.entity}-search`}
                    >
                        بحث
                        <input
                            id={`erp-${config.entity}-search`}
                            type="search"
                            value={search}
                            placeholder={
                                config.sourceLabel === 'البيان' ? 'البيان أو الملاحظات…' : 'المصدر أو الملاحظات…'
                            }
                            onChange={(event) => {
                                setSearch(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                </div>
            </Card>

            <Card className="flex flex-wrap items-baseline justify-between gap-sm p-md">
                <span className="text-body-sm text-muted">إجمالي المعروض</span>
                <span className="erp-numeric text-heading-lg text-ink">
                    {formatMoney(total)}
                    {currency ? <span className="ms-xs text-body-sm text-muted">{currency}</span> : null}
                </span>
                <span className="text-body-sm text-muted">{formatInt(rows.length)} سجلًا</span>
            </Card>

            <Card>
                {registerQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label={`جارٍ تحميل ${config.title}`} />
                        <TableSkeleton rows={6} columns={config.showKind ? 6 : 5} />
                    </div>
                ) : null}

                {registerQuery.isError ? (
                    <StateError
                        message={registerQuery.error instanceof Error ? registerQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void registerQuery.refetch();
                        }}
                    />
                ) : null}

                {registerQuery.isSuccess && rows.length === 0 ? (
                    <StateEmpty
                        title="لا سجلات"
                        hint="لا توجد سجلات مطابقة للفترة أو المرشّحات — وسّع الفترة أو «عرض الكل»."
                    />
                ) : null}

                {registerQuery.isSuccess && rows.length > 0 ? (
                    <>
                        <TableScroll label={`جدول ${config.title}`}>
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th
                                            scope="col"
                                            aria-sort={ariaSort('source')}
                                            className="px-sm py-xs text-start font-medium"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    toggleSort('source');
                                                }}
                                            >
                                                {config.sourceLabel}
                                            </button>
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            القسم
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
                                        {config.showKind ? (
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                النوع
                                            </th>
                                        ) : null}
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            ملاحظات
                                        </th>
                                        {writable ? (
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                إجراءات
                                            </th>
                                        ) : null}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((item) => (
                                        <tr
                                            key={item.row.id}
                                            className="border-b border-hairline hover:bg-surface-hover"
                                        >
                                            <td className="px-sm py-xxs text-ink">{item.source || '—'}</td>
                                            <td className="px-sm py-xxs text-body-sm text-ink-secondary">
                                                {item.deptName}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink">
                                                {formatMoney(normalizeAmount(item.row.amount))}
                                                {currency ? (
                                                    <span className="ms-xs text-caption text-muted">{currency}</span>
                                                ) : null}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-center text-body-sm text-muted">
                                                {item.row.date}
                                            </td>
                                            {config.showKind ? (
                                                <td className="px-sm py-xxs text-body-sm text-muted">{item.kind}</td>
                                            ) : null}
                                            <td className="px-sm py-xxs text-body-sm text-muted">
                                                {item.notes || '—'}
                                            </td>
                                            {writable ? (
                                                <td className="px-sm py-xxs text-body-sm" data-erp-print-hide>
                                                    {editLocked(item.row) ? null : (
                                                        <div className="flex flex-wrap items-center gap-xs">
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="sm"
                                                                aria-label={`تعديل ${item.source || `#${String(item.row.id)}`}`}
                                                                onClick={() => {
                                                                    openEdit(item.row);
                                                                }}
                                                            >
                                                                تعديل
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                variant="danger"
                                                                size="sm"
                                                                disabled={deleteMutation.isPending}
                                                                aria-label={`حذف ${item.source || `#${String(item.row.id)}`}`}
                                                                onClick={() => {
                                                                    void handleDelete(item.row);
                                                                }}
                                                            >
                                                                حذف
                                                            </Button>
                                                        </div>
                                                    )}
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

            <RegisterCreateDialog
                open={createOpen}
                entity={config.entity}
                departments={departments}
                onClose={() => {
                    setCreateOpen(false);
                }}
                onSaved={handleSaved}
            />
            <RegisterEditDialog
                open={dialogOpen}
                entity={config.entity}
                row={editingRow}
                departments={departments}
                onClose={() => {
                    setDialogOpen(false);
                    setEditingRow(null);
                }}
                onSaved={handleSaved}
            />
        </div>
    );
}

export const REVENUES_CONFIG: RegisterConfig = {
    entity: 'revenues',
    title: 'الإيرادات',
    english: 'Revenues',
    subtitle: 'كل الأرقام من سجلات الإيرادات المسجّلة فعليًا — التعديل والحذف حسب صلاحيتك.',
    sourceLabel: 'المصدر',
    sourceOf: (row) => ('source' in row ? String(row.source ?? '') : ''),
    showKind: false,
};

export const EXPENSES_CONFIG: RegisterConfig = {
    entity: 'expenses',
    title: 'المصروفات',
    english: 'Expenses',
    subtitle: 'المصروفات المسجّلة فعليًا — تشمل حركات المخزون الآلية (مقفولة عن التعديل)، والتعديل والحذف حسب صلاحيتك.',
    sourceLabel: 'البيان',
    sourceOf: (row) => ('desc' in row ? String(row.desc ?? '') : ''),
    showKind: true,
};
