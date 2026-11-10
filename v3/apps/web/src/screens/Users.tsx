import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { PrintActions } from '../components/PrintActions';
import { useAuthState } from '../lib/auth';
import { fetchEmployees } from '../lib/employees';
import {
    employeeByUserMap,
    fetchUsers,
    MAX_PAGES,
    roleCounts,
    PAGE_SIZE as SERVER_PAGE_SIZE,
    searchUsers,
    type UserRow,
    userToRow,
    userTotals,
} from '../lib/users';
import {
    createUser,
    deleteUser,
    setUserActive,
    updateUser,
    isStrongPassword,
    userActivateConfirm,
    userDeactivateConfirm,
    userDeleteConfirm,
    USER_TEXT,
    type UserCreateInput,
    type UserUpdateInput,
    userWriteVisible,
    userDeleteVisible,
} from '../lib/users-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

/**
 * دليل حسابات الدخول — CRUD كامل مثل V2:
 *  • إنشاء مستخدم (POST /api/users)
 *  • تعديل بيانات (PATCH /api/users/:id)
 *  • إيقاف/تفعيل الحساب (PATCH /api/users/:id/active)
 *  • حذف نهائي (DELETE /api/users/:id — أدمن فقط)
 *  • طباعة القائمة (PrintActions)
 *
 * القراءة من `/api/users` محجوزة في الخادم للأدوار الإدارية.
 * الكتابة محجوزة لـ admin|manager|hr، والحذف النهائي للأدمن فقط.
 * كلمة المرور لا تُعرض في أي صف — تُدخل فقط عند الإنشاء.
 */

const PAGE_SIZE_LOCAL = 20;

type SortKey = 'username' | 'name' | 'role' | 'status' | 'lastLogin';
type LinkFilter = '' | 'linked' | 'unlinked';

const ROLE_OPTIONS = [
    { value: 'admin', label: 'مدير النظام' },
    { value: 'manager', label: 'مدير المطعم' },
    { value: 'hr', label: 'مدير الموارد البشرية' },
    { value: 'accountant', label: 'مدير الحسابات' },
    { value: 'dept_head', label: 'رئيس قسم' },
    { value: 'warehouse', label: 'أمين المخزن' },
    { value: 'kitchen', label: 'الشيف العمومي' },
    { value: 'sous_chef', label: 'سو شيف' },
    { value: 'cashier', label: 'كاشير' },
    { value: 'employee', label: 'موظف' },
    { value: 'auditor', label: 'مراجع' },
] as const;

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

function compare(a: UserRow, b: UserRow, key: SortKey): number {
    if (key === 'username') {
        return a.username.localeCompare(b.username, 'en');
    }
    if (key === 'role') {
        return a.roleLabel.localeCompare(b.roleLabel, 'ar');
    }
    if (key === 'status') {
        return a.statusLabel.localeCompare(b.statusLabel, 'ar');
    }
    if (key === 'lastLogin') {
        return a.lastLogin.localeCompare(b.lastLogin);
    }
    return a.name.localeCompare(b.name, 'ar');
}

/* ── نموذج إنشاء مستخدم ──────────────────────────────────────────────── */

interface CreateDialogProps {
    open: boolean;
    onClose: () => void;
    pending: boolean;
    onSave: (payload: UserCreateInput) => Promise<void>;
}

const CREATE_FORM_ID = 'erp-users-create-form';

function CreateDialog({ open, onClose, pending, onSave }: CreateDialogProps) {
    const [username, setUsername] = useState('');
    const [name, setName] = useState('');
    const [role, setRole] = useState('');
    const [deptCode, setDeptCode] = useState('');
    const [password, setPassword] = useState('');
    const [active, setActive] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setUsername('');
            setName('');
            setRole('');
            setDeptCode('');
            setPassword('');
            setActive(true);
            setError('');
        }
    }, [open]);

    async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setError('');
        if (!username.trim()) {
            setError(USER_TEXT.usernameRequired);
            return;
        }
        if (!name.trim()) {
            setError(USER_TEXT.nameRequired);
            return;
        }
        if (!role) {
            setError(USER_TEXT.roleRequired);
            return;
        }
        if (!password || !isStrongPassword(password)) {
            setError(USER_TEXT.passwordWeak);
            return;
        }

        const payload: UserCreateInput = {
            username: username.trim(),
            name: name.trim(),
            role,
            dept_code: deptCode.trim() || null,
            password,
            active,
        };

        try {
            await onSave(payload);
            onClose();
        } catch (cause) {
            setError(writeErrorMessage(cause, USER_TEXT.createFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title="إضافة مستخدم جديد"
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {USER_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={CREATE_FORM_ID} size="sm" loading={pending}>
                        إنشاء الحساب
                    </Button>
                </>
            }
        >
            <form id={CREATE_FORM_ID} onSubmit={(event) => void submit(event)} className="flex flex-col gap-sm">
                <div className="grid gap-sm sm:grid-cols-2">
                    <Input
                        label="اسم المستخدم"
                        name="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="karim.ahmed"
                        required
                    />
                    <Input
                        label="الاسم الكامل"
                        name="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="كريم أحمد محمد"
                        required
                    />
                    <Select
                        label="الدور"
                        name="role"
                        value={role}
                        onValueChange={(value) => setRole(String(value ?? ''))}
                        options={ROLE_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
                        required
                    />
                    <Input
                        label="كود القسم (اختياري)"
                        name="dept_code"
                        value={deptCode}
                        onChange={(e) => setDeptCode(e.target.value)}
                        placeholder="ACC, HR, WH…"
                    />
                </div>
                <div className="grid gap-sm sm:grid-cols-2">
                    <Input
                        label="كلمة المرور"
                        name="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="١٢ حرفًا على الأقل مع رقم"
                        required
                    />
                    <div className="flex items-end gap-sm">
                        <input
                            id="erp-users-active"
                            type="checkbox"
                            checked={active}
                            onChange={(e) => setActive(e.target.checked)}
                            className="h-5 w-5 text-primary rounded border-hairline-strong"
                        />
                        <label htmlFor="erp-users-active" className="text-body-sm text-ink-secondary">
                            الحساب نشط
                        </label>
                    </div>
                </div>
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

/* ── نموذج تعديل مستخدم ──────────────────────────────────────────────── */

interface EditDialogProps {
    open: boolean;
    row: UserRow | null;
    onClose: () => void;
    pending: boolean;
    onSave: (payload: UserUpdateInput) => Promise<void>;
}

const EDIT_FORM_ID = 'erp-users-edit-form';

function EditDialog({ open, row, onClose, pending, onSave }: EditDialogProps) {
    const [name, setName] = useState('');
    const [role, setRole] = useState('');
    const [deptCode, setDeptCode] = useState('');
    const [active, setActive] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (open && row) {
            setName(row.name);
            setRole(row.role);
            setDeptCode(row.deptCode);
            setActive(row.active);
            setError('');
        }
    }, [open, row]);

    async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setError('');
        if (!name.trim()) {
            setError(USER_TEXT.nameRequired);
            return;
        }
        if (!role) {
            setError(USER_TEXT.roleRequired);
            return;
        }

        const payload: UserUpdateInput = {
            name: name.trim(),
            role,
            dept_code: deptCode.trim() || null,
            active,
        };

        try {
            await onSave(payload);
            onClose();
        } catch (cause) {
            setError(writeErrorMessage(cause, USER_TEXT.updateFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title="تعديل بيانات المستخدم"
            size="md"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {USER_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={EDIT_FORM_ID} size="sm" loading={pending}>
                        حفظ التعديل
                    </Button>
                </>
            }
        >
            <form id={EDIT_FORM_ID} onSubmit={(event) => void submit(event)} className="flex flex-col gap-sm">
                <p className="text-body-sm text-muted">
                    <strong className="text-ink">{row?.username ? `@${row.username}` : ''}</strong>
                </p>
                <Input
                    label="الاسم الكامل"
                    name="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                />
                <Select
                    label="الدور"
                    name="role"
                    value={role}
                    onValueChange={(value) => setRole(String(value ?? ''))}
                    options={ROLE_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
                    required
                />
                <Input
                    label="كود القسم (اختياري)"
                    name="dept_code"
                    value={deptCode}
                    onChange={(e) => setDeptCode(e.target.value)}
                    placeholder="ACC, HR, WH…"
                />
                <div className="flex items-end gap-sm">
                    <input
                        id="erp-users-edit-active"
                        type="checkbox"
                        checked={active}
                        onChange={(e) => setActive(e.target.checked)}
                        className="h-5 w-5 text-primary rounded border-hairline-strong"
                    />
                    <label htmlFor="erp-users-edit-active" className="text-body-sm text-ink-secondary">
                        الحساب نشط
                    </label>
                </div>
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

/* ── نموذج تأكيد ─────────────────────────────────────────────────────── */

interface ActionDialogProps {
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
    onClose: () => void;
    pending: boolean;
    confirmLabel: string;
    variant: 'secondary' | 'danger';
}

function ActionDialog({ open, title, message, onConfirm, onClose, pending, confirmLabel, variant }: ActionDialogProps) {
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
                    {USER_TEXT.cancel}
                </Button>
                <Button type="button" size="sm" variant={variant} loading={pending} onClick={() => void onConfirm()}>
                    {confirmLabel}
                </Button>
            </div>
        </Dialog>
    );
}

/* ── الشاشة ───────────────────────────────────────────────────────────── */

export function Users() {
    const [query, setQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState('');
    const [status, setStatus] = useState('');
    const [link, setLink] = useState<LinkFilter>('');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
    const [page, setPage] = useState(1);

    const [createOpen, setCreateOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [editRow, setEditRow] = useState<UserRow | null>(null);
    const [actionOpen, setActionOpen] = useState(false);
    const [actionRow, setActionRow] = useState<UserRow | null>(null);
    const [actionType, setActionType] = useState<'activate' | 'deactivate' | 'delete'>('deactivate');
    const [actionTitle, setActionTitle] = useState('');
    const [actionMessage, setActionMessage] = useState('');

    const auth = useAuthState();
    const role = auth.user?.role;
    const canWrite = userWriteVisible(role);
    const canDelete = userDeleteVisible(role);

    const usersQuery = useQuery({
        queryKey: ['users'],
        queryFn: ({ signal }) => fetchUsers(signal),
    });
    const employeesQuery = useQuery({
        queryKey: ['employees'],
        queryFn: ({ signal }) => fetchEmployees(signal),
        staleTime: 10 * 60 * 1000,
    });

    const employeeByUserId = useMemo(() => employeeByUserMap(employeesQuery.data ?? []), [employeesQuery.data]);
    const allRows = useMemo(
        () => (usersQuery.data ?? []).map((user) => userToRow(user, employeeByUserId)),
        [usersQuery.data, employeeByUserId],
    );

    const filteredRows = useMemo(() => {
        return allRows.filter((row) => {
            if (roleFilter === '—') {
                if (row.role !== '') return false;
            } else if (roleFilter && row.role !== roleFilter) {
                return false;
            }
            if (status === 'active' && !row.active) return false;
            if (status === 'inactive' && row.active) return false;
            if (link === 'linked' && !row.linked) return false;
            if (link === 'unlinked' && row.linked) return false;
            return true;
        });
    }, [allRows, roleFilter, status, link]);

    const search = useMemo(() => searchUsers(filteredRows, query), [filteredRows, query]);
    const rows = search.rows;

    const sorted = useMemo(() => {
        if (!sort) return rows;
        const copy = [...rows].sort((a, b) => compare(a, b, sort.key));
        return sort.dir === 'asc' ? copy : copy.reverse();
    }, [rows, sort]);

    const totals = useMemo(() => userTotals(allRows), [allRows]);
    const roles = useMemo(() => roleCounts(allRows), [allRows]);
    const heads = useMemo(() => allRows.filter((row) => row.role === 'dept_head').length, [allRows]);

    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE_LOCAL));
    const safePage = Math.min(page, pageCount);
    const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE_LOCAL, safePage * PAGE_SIZE_LOCAL);
    const capped = (usersQuery.data?.length ?? 0) >= SERVER_PAGE_SIZE * MAX_PAGES;
    const filtered = Boolean(query || roleFilter || status || link);

    function toggleSort(key: SortKey) {
        setPage(1);
        setSort((previous) =>
            previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
        );
    }

    function resetFilters() {
        setQuery('');
        setRoleFilter('');
        setStatus('');
        setLink('');
        setSort(null);
        setPage(1);
    }

    /* ── الكتبات عبر useWriteMutation ────────────────────────────────── */

    const createMutation = useWriteMutation<UserCreateInput, { id: string | number }>({
        mutationFn: (input) => createUser(input).then((r) => ({ id: r.id })),
        successTitle: () => USER_TEXT.createSuccess,
        invalidate: [['users']],
        silentError: true,
        onSuccess: () => setCreateOpen(false),
    });

    const updateMutation = useWriteMutation<UserUpdateInput, { id: string | number }>({
        mutationFn: (input) => updateUser(editRow?.id ?? 0, input).then((r) => ({ id: r.id })),
        successTitle: () => USER_TEXT.updateSuccess,
        invalidate: [['users']],
        silentError: true,
        onSuccess: () => {
            setEditOpen(false);
            setEditRow(null);
        },
    });

    const activeMutation = useWriteMutation<{ id: string | number; active: boolean }, { id: string | number; active: boolean }>({
        mutationFn: ({ id, active }) => setUserActive(id, active).then((r) => ({ id: r.id, active })),
        successTitle: ({ active }) => (active ? USER_TEXT.activateSuccess : USER_TEXT.deactivateSuccess),
        invalidate: [['users']],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    const deleteMutation = useWriteMutation<string | number, void>({
        mutationFn: (id) => deleteUser(id),
        successTitle: () => USER_TEXT.deleteSuccess,
        invalidate: [['users']],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    async function openEdit(row: UserRow) {
        setEditRow(row);
        setEditOpen(true);
    }

    async function handleChangeStatus(row: UserRow, activate: boolean) {
        setActionRow(row);
        setActionType(activate ? 'activate' : 'deactivate');
        setActionTitle(activate ? 'تفعيل الحساب' : 'إيقاف الحساب');
        setActionMessage(activate ? userActivateConfirm(row.name) : userDeactivateConfirm(row.name));
        setActionOpen(true);
    }

    async function handleDelete(row: UserRow) {
        setActionRow(row);
        setActionType('delete');
        setActionTitle('حذف المستخدم');
        setActionMessage(userDeleteConfirm(row.name));
        setActionOpen(true);
    }

    async function confirmAction() {
        if (!actionRow) return;
        if (actionType === 'activate') {
            await activeMutation.mutateAsync({ id: actionRow.id, active: true });
        } else if (actionType === 'deactivate') {
            await activeMutation.mutateAsync({ id: actionRow.id, active: false });
        } else {
            await deleteMutation.mutateAsync(actionRow.id);
        }
    }

    return (
        <div className="flex flex-col gap-lg">
            <header className="flex flex-wrap items-end justify-between gap-md border-b border-hairline pb-md">
                <div>
                    <h1 className="text-display-lg text-ink">
                        المستخدمون{' '}
                        <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted" dir="ltr" lang="en">
                            Users
                        </span>
                    </h1>
                    <p className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                        من يدخل النظام وبأي دور، ومن هو موظفه المرتبط. إنشاء الحسابات وتعديل بياناتهم وإيقاف/
                        تفعيل الحساب وحذفه. كلمة المرور لا تُعرض في أي صفّ.
                        القراءة محجوزة في الخادم للأدوار الإدارية، والكتابة لـ admin|manager|hr والحذف للأدمن فقط.
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    {canWrite ? (
                        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                            إضافة مستخدم
                        </Button>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => {
                            void usersQuery.refetch();
                            void employeesQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                    <PrintActions title="المستخدمون" />
                </div>
            </header>

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                    label="إجمالي الحسابات"
                    english="Accounts"
                    value={formatInt(totals.total)}
                    hint={`${formatInt(totals.roles)} دورًا مستخدمًا`}
                />
                <Kpi
                    label="نشط"
                    english="Active"
                    value={formatInt(totals.active)}
                    hint={totals.inactive ? `${formatInt(totals.inactive)} موقوف` : 'لا حسابات موقوفة'}
                />
                <Kpi
                    label="مربوط بموظف"
                    english="Linked"
                    value={formatInt(totals.linked)}
                    hint={totals.unlinked ? `${formatInt(totals.unlinked)} بلا ربط وظيفي` : 'كل حساب له موظف'}
                />
                <Kpi
                    label="رؤساء أقسام بلا قسم"
                    english="Heads w/o dept"
                    value={formatInt(totals.headWithoutDept)}
                    hint={
                        totals.headWithoutDept
                            ? 'رئيس قسم بلا كود قسم مخزَّن'
                            : `${formatInt(heads)} رئيس قسم — كلهم بأكواد`
                    }
                />
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-md">
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-users-q">
                        بحث
                        <input
                            id="erp-users-q"
                            type="search"
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setPage(1);
                            }}
                            placeholder="اسم، مستخدم، دور، قسم، موظف"
                            className="h-10 w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-64"
                        />
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-users-role">
                        الدور
                        <select
                            id="erp-users-role"
                            value={roleFilter}
                            onChange={(event) => {
                                setRoleFilter(event.target.value);
                                setPage(1);
                            }}
                            className="h-10 w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-auto"
                        >
                            <option value="">كل الأدوار</option>
                            {roles.map((entry) => (
                                <option key={entry.value || '—'} value={entry.value || '—'}>
                                    {entry.value ? entry.label : 'بلا دور'}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label
                        className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-users-status"
                    >
                        الحالة
                        <select
                            id="erp-users-status"
                            value={status}
                            onChange={(event) => {
                                setStatus(event.target.value);
                                setPage(1);
                            }}
                            className="h-10 w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-auto"
                        >
                            <option value="">كل الحالات</option>
                            <option value="active">نشط</option>
                            <option value="inactive">موقوف</option>
                        </select>
                    </label>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-users-link">
                        ربط الموظف
                        <select
                            id="erp-users-link"
                            value={link}
                            onChange={(event) => {
                                setLink(event.target.value as LinkFilter);
                                setPage(1);
                            }}
                            className="h-10 w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-auto"
                        >
                            <option value="">الكل</option>
                            <option value="linked">مربوط</option>
                            <option value="unlinked">غير مربوط</option>
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
                        {formatInt(sorted.length)} حسابًا معروضًا من {formatInt(totals.total)}
                    </span>
                </div>
                {search.folded ? (
                    <p className="mt-sm text-body-sm text-muted">
                        بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.
                    </p>
                ) : null}
            </Card>

            <Card className="p-sm">
                <h2 className="px-sm pt-sm text-heading-sm text-ink">الحسابات حسب الدور</h2>
                {roles.length === 0 ? (
                    <p className="p-sm text-body-sm text-muted">لا حسابات في الدليل.</p>
                ) : (
                    <ul className="flex flex-col gap-xxs p-sm" aria-label="توزيع الحسابات على الأدوار">
                        {roles.map((entry) => {
                            const share = totals.total ? (entry.count / totals.total) * 100 : 0;
                            return (
                                <li key={entry.value || '—'} className="flex items-center gap-sm text-body-sm">
                                    <span className="w-40 shrink-0 truncate text-ink" title={entry.value || 'بلا دور'}>
                                        {entry.value ? entry.label : 'بلا دور'}
                                        {entry.known ? null : (
                                            <span className="text-caption text-faint" dir="ltr">
                                                {' '}
                                                ({entry.value})
                                            </span>
                                        )}
                                    </span>
                                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                                        <span
                                            className="block h-full rounded-full bg-primary"
                                            style={{ width: `${share.toFixed(1)}%` }}
                                        />
                                    </span>
                                    <span className="erp-numeric w-16 shrink-0 text-end text-ink" dir="ltr">
                                        {formatInt(entry.count)}
                                    </span>
                                    <span className="erp-numeric w-14 shrink-0 text-end text-caption text-muted" dir="ltr">
                                        {share.toFixed(1)}%
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Card>

            <Card>
                {usersQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل دليل الحسابات" />
                        <TableSkeleton rows={6} columns={7} />
                    </div>
                ) : null}

                {usersQuery.isError ? (
                    <StateError
                        message={usersQuery.error instanceof Error ? usersQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void usersQuery.refetch();
                        }}
                    />
                ) : null}

                {usersQuery.isSuccess && sorted.length === 0 ? (
                    <StateEmpty
                        title={filtered ? 'لا حسابات تطابق المرشّحات' : 'دليل الحسابات فارغ'}
                        hint={
                            filtered
                                ? 'لا نتائج مطابقة؛ عدّل المرشّحات أو امسحها.'
                                : 'أضف أول مستخدم.'
                        }
                    />
                ) : null}

                {usersQuery.isSuccess && sorted.length > 0 ? (
                    <>
                        <p className="border-b border-hairline px-sm py-xs text-body-sm text-muted" role="status">
                            {`${formatInt(sorted.length)} حسابًا`}
                            {search.exact ? ` · ${formatInt(search.exact)} مطابقة تامة لاسم المستخدم` : ''}
                            {capped ? ` · الخادم أعاد أول ${formatInt(SERVER_PAGE_SIZE * MAX_PAGES)} حسابًا فقط` : ''}
                        </p>
                        <TableScroll label="جدول دليل حسابات الدخول">
                            <table className="w-full min-w-[760px] border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh
                                            label="اسم المستخدم"
                                            sortKey="username"
                                            sort={sort}
                                            onToggle={toggleSort}
                                        />
                                        <SortableTh label="الاسم" sortKey="name" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الدور" sortKey="role" sort={sort} onToggle={toggleSort} />
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            القسم
                                        </th>
                                        <SortableTh label="الحالة" sortKey="status" sort={sort} onToggle={toggleSort} />
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الموظف المرتبط
                                        </th>
                                        <SortableTh
                                            label="آخر دخول"
                                            sortKey="lastLogin"
                                            sort={sort}
                                            onToggle={toggleSort}
                                        />
                                        {(canWrite || canDelete) && (
                                            <th scope="col" className="px-sm py-xs text-start font-medium" data-erp-print-hide>
                                                إجراءات
                                            </th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row) => (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {row.username ? `@${row.username}` : '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">{row.name}</td>
                                            <td className="px-sm py-xxs text-body-sm">
                                                <span className={row.roleKnown ? 'text-ink' : 'text-muted'}>
                                                    {row.roleLabel}
                                                </span>
                                                {row.roleKnown ? null : (
                                                    <span className="text-caption text-faint" dir="ltr">
                                                        {' '}
                                                        ({row.role})
                                                    </span>
                                                )}
                                            </td>
                                            <td
                                                className="px-sm py-xxs text-body-sm text-muted"
                                                title={row.deptCode || 'بلا كود قسم'}
                                            >
                                                {row.deptCode || '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm">
                                                <span className={row.active ? 'text-success-text' : 'text-muted'}>
                                                    {row.statusLabel}
                                                </span>
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm">
                                                {row.linked ? (
                                                    <>
                                                        <span className="text-ink">{row.employeeName}</span>
                                                        {row.employeeCode ? (
                                                            <span className="text-caption text-faint" dir="ltr">
                                                                {' '}
                                                                ({row.employeeCode})
                                                            </span>
                                                        ) : null}
                                                    </>
                                                ) : (
                                                    <span className="text-muted">غير مربوط</span>
                                                )}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {row.lastLogin || 'لم يسجّل الدخول'}
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
                                                                    title="تعديل البيانات"
                                                                    onClick={() => void openEdit(row)}
                                                                >
                                                                    تعديل
                                                                </Button>
                                                                {row.active ? (
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant="secondary"
                                                                        title="إيقاف الحساب"
                                                                        onClick={() => void handleChangeStatus(row, false)}
                                                                    >
                                                                        إيقاف
                                                                    </Button>
                                                                ) : (
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant="secondary"
                                                                        title="تفعيل الحساب"
                                                                        onClick={() => void handleChangeStatus(row, true)}
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
                                                                title="حذف المستخدم"
                                                                onClick={() => void handleDelete(row)}
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
            <CreateDialog
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                pending={createMutation.isPending}
                onSave={async (payload) => {
                    await createMutation.mutateAsync(payload);
                }}
            />
            <EditDialog
                open={editOpen}
                row={editRow}
                onClose={() => {
                    setEditOpen(false);
                    setEditRow(null);
                }}
                pending={updateMutation.isPending}
                onSave={async (payload) => {
                    await updateMutation.mutateAsync(payload);
                }}
            />
            <ActionDialog
                open={actionOpen}
                title={actionTitle}
                message={actionMessage}
                onConfirm={confirmAction}
                onClose={() => {
                    setActionOpen(false);
                    setActionRow(null);
                }}
                pending={activeMutation.isPending || deleteMutation.isPending}
                confirmLabel={actionType === 'activate' ? 'تفعيل' : actionType === 'deactivate' ? 'إيقاف' : 'حذف'}
                variant={actionType === 'delete' ? 'danger' : 'secondary'}
            />
        </div>
    );
}
