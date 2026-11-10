import './HrDepartments.premium.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';
import { Card, StateEmpty, StateError, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import {
    createHrDepartment,
    deleteHrDepartment,
    fetchHrDepartments,
    fetchHrEmployees,
    HR_DEPARTMENT_WRITE_ROLES,
    type HrDepartment,
    type HrDepartmentPayload,
    hrDepartmentWriteEnabled,
    updateHrDepartment,
    validateHrDepartmentForm,
    withEmployeeCounts,
} from '../lib/hr-departments';
import { formatInt } from '../lib/inventory-register';
import { PrintActions } from '../components/PrintActions';

type FormState = { id: string | null; name: string; code: string; manager: string };
const EMPTY_FORM: FormState = { id: null, name: '', code: '', manager: '' };

function hasRole(role: string, roles: readonly string[]): boolean {
    return roles.includes(role);
}

export function HrDepartments() {
    const auth = useAuthState();
    const role = auth.user?.role ?? '';
    const canManage = hasRole(role, HR_DEPARTMENT_WRITE_ROLES) && hrDepartmentWriteEnabled();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [form, setForm] = useState<FormState | null>(null);
    const [formError, setFormError] = useState('');
    const [notice, setNotice] = useState('');

    const departmentsQuery = useQuery({
        queryKey: ['hr-departments'],
        queryFn: ({ signal }) => fetchHrDepartments(signal),
    });
    const employeesQuery = useQuery({
        queryKey: ['hr-departments', 'employees'],
        queryFn: ({ signal }) => fetchHrEmployees(signal),
        staleTime: 60_000,
    });

    const rows = useMemo(
        () => withEmployeeCounts(departmentsQuery.data ?? [], employeesQuery.data ?? []),
        [departmentsQuery.data, employeesQuery.data],
    );
    const filteredRows = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        return query
            ? rows.filter((row) => `${row.code} ${row.name} ${row.manager}`.toLocaleLowerCase().includes(query))
            : rows;
    }, [rows, search]);
    const employeeTotal = rows.reduce((sum, row) => sum + row.employeeCount, 0);

    const mutation = useMutation({
        mutationFn: async (
            action:
                | { kind: 'create'; payload: HrDepartmentPayload }
                | { kind: 'update'; id: string; payload: HrDepartmentPayload }
                | { kind: 'delete'; id: string },
        ) => {
            if (action.kind === 'create') {
                return createHrDepartment(action.payload);
            }
            if (action.kind === 'update') {
                return updateHrDepartment(action.id, action.payload);
            }
            return deleteHrDepartment(action.id);
        },
        onSuccess: async (_result, action) => {
            setNotice(
                action.kind === 'create'
                    ? 'تمت إضافة القسم.'
                    : action.kind === 'update'
                      ? 'تم تحديث القسم.'
                      : 'تم حذف القسم.',
            );
            setForm(null);
            setFormError('');
            await queryClient.invalidateQueries({ queryKey: ['hr-departments'] });
        },
        onError: (error) => {
            setNotice(`تعذّر تنفيذ العملية: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
        },
    });

    function openCreateForm() {
        setNotice('');
        setFormError('');
        setForm({ ...EMPTY_FORM });
    }

    function openEditForm(row: HrDepartment) {
        setNotice('');
        setFormError('');
        setForm({
            id: row.id,
            name: row.name === '—' ? '' : row.name,
            code: row.code,
            manager: row.manager === '—' ? '' : row.manager,
        });
    }

    function saveForm(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!form || !canManage) {
            return;
        }
        const validated = validateHrDepartmentForm(
            { name: form.name, code: form.code, manager: form.manager },
            form.id !== null,
        );
        if (!validated.ok) {
            setFormError(validated.message);
            return;
        }
        if (form.id === null && rows.some((row) => row.code.toUpperCase() === validated.payload.code?.toUpperCase())) {
            setFormError('كود القسم موجود بالفعل — اختر كودًا آخر.');
            return;
        }
        mutation.mutate(
            form.id === null
                ? { kind: 'create', payload: validated.payload }
                : { kind: 'update', id: form.id, payload: validated.payload },
        );
    }

    function removeDepartment(row: HrDepartment) {
        if (!canManage || mutation.isPending) {
            return;
        }
        if (window.confirm(`حذف قسم الموارد «${row.name}» (${row.code})؟`)) {
            mutation.mutate({ kind: 'delete', id: row.id });
        }
    }

    return (
        <div className="flex flex-col gap-md erp-premium erp-premium-hr-departments">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        أقسام الموظفين{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            HR Departments
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">
                        دليل أقسام الموارد البشرية وعدد الموظفين المرتبطين بكل قسم.
                    </p>
                </div>
                <div className="flex flex-wrap gap-xs">
                    <PrintActions title="أقسام الموظفين" />
                    <button
                        type="button"
                        onClick={() => {
                            void queryClient.invalidateQueries({ queryKey: ['hr-departments'] });
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink"
                    >
                        تحديث
                    </button>
                    {canManage ? (
                        <button
                            type="button"
                            onClick={openCreateForm}
                            className="rounded-md bg-primary px-md py-xs text-button-md text-on-primary"
                        >
                            إضافة قسم
                        </button>
                    ) : null}
                </div>
            </header>

            {notice ? (
                <p role="status" aria-live="polite" className="text-body-sm text-muted">
                    {notice}
                </p>
            ) : null}

            <div className="grid gap-sm sm:grid-cols-3">
                {[
                    ['الأقسام', formatInt(rows.length)],
                    ['الموظفون الموزعون', formatInt(employeeTotal)],
                    ['نتائج البحث', formatInt(filteredRows.length)],
                ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-hairline bg-surface p-md shadow-card">
                        <p className="text-label-md text-muted">{label}</p>
                        <p className="erp-numeric mt-xs text-heading-lg text-ink" dir="ltr">
                            {value}
                        </p>
                    </div>
                ))}
            </div>

            {form ? (
                <Card className="flex flex-col gap-sm p-md">
                    <div className="flex items-center justify-between gap-sm">
                        <h2 className="text-heading-md text-ink">
                            {form.id ? `تعديل قسم — ${form.name}` : 'إضافة قسم موارد بشرية'}
                        </h2>
                        <button
                            type="button"
                            onClick={() => setForm(null)}
                            className="rounded-md border border-hairline-strong px-sm py-xxs text-body-sm"
                        >
                            إلغاء
                        </button>
                    </div>
                    <form onSubmit={saveForm} className="grid gap-sm sm:grid-cols-2">
                        <label className="flex flex-col gap-xxs text-label-md text-ink" htmlFor="erp-hr-dept-name">
                            اسم القسم *
                            <input
                                id="erp-hr-dept-name"
                                name="name"
                                required
                                maxLength={150}
                                value={form.name}
                                onChange={(event) => setForm({ ...form, name: event.target.value })}
                                className="rounded-md border border-hairline-strong bg-surface px-sm py-xs"
                            />
                        </label>
                        {form.id ? (
                            <div className="flex flex-col gap-xxs text-label-md text-ink">
                                كود القسم
                                <span
                                    className="rounded-md border border-hairline bg-surface-sunken px-sm py-xs font-mono"
                                    dir="ltr"
                                >
                                    {form.code}
                                </span>
                            </div>
                        ) : (
                            <label className="flex flex-col gap-xxs text-label-md text-ink" htmlFor="erp-hr-dept-code">
                                الكود (لاتيني، اختياري)
                                <input
                                    id="erp-hr-dept-code"
                                    name="code"
                                    maxLength={20}
                                    value={form.code}
                                    onChange={(event) => setForm({ ...form, code: event.target.value })}
                                    placeholder="HRD-… أو يُولّد تلقائيًا"
                                    dir="ltr"
                                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xs"
                                />
                            </label>
                        )}
                        <label className="flex flex-col gap-xxs text-label-md text-ink" htmlFor="erp-hr-dept-manager">
                            المدير
                            <input
                                id="erp-hr-dept-manager"
                                name="manager"
                                maxLength={255}
                                value={form.manager}
                                onChange={(event) => setForm({ ...form, manager: event.target.value })}
                                className="rounded-md border border-hairline-strong bg-surface px-sm py-xs"
                            />
                        </label>
                        <p className="self-end text-caption text-muted">
                            الكود العربي أو الفارغ يتحول إلى كود لاتيني آمن، ويظل الكود ثابتًا عند التعديل.
                        </p>
                        {formError ? (
                            <p role="alert" className="sm:col-span-2 text-body-sm text-danger-text">
                                {formError}
                            </p>
                        ) : null}
                        <button
                            type="submit"
                            disabled={mutation.isPending}
                            className="justify-self-start rounded-md bg-primary px-md py-xs text-button-md text-on-primary disabled:opacity-50"
                        >
                            {mutation.isPending ? 'جارٍ الحفظ…' : 'حفظ القسم'}
                        </button>
                    </form>
                </Card>
            ) : null}

            <Card className="flex flex-col gap-sm p-md">
                <div className="flex flex-wrap items-end justify-between gap-sm">
                    <div>
                        <h2 className="text-heading-md text-ink">سجل الأقسام</h2>
                        <p className="text-caption text-muted">
                            {formatInt(filteredRows.length)} قسمًا · {formatInt(employeeTotal)} موظفًا
                        </p>
                    </div>
                    <label className="flex min-w-56 flex-col gap-xxs text-label-md text-ink" htmlFor="erp-hr-dept-q">
                        بحث
                        <input
                            id="erp-hr-dept-q"
                            name="q"
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="الرمز أو القسم أو المدير…"
                            className="rounded-md border border-hairline-strong bg-surface px-sm py-xs"
                        />
                    </label>
                </div>
                {employeesQuery.isError ? (
                    <p role="status" className="text-caption text-warning-text">
                        تعذّر جلب الموظفين؛ عُرضت الأقسام وأعداد الموظفين بصفر مؤقتًا.
                    </p>
                ) : null}
                {departmentsQuery.isError ? (
                    <StateError
                        message={
                            departmentsQuery.error instanceof Error
                                ? departmentsQuery.error.message
                                : 'تعذّر جلب الأقسام'
                        }
                        onRetry={() => void departmentsQuery.refetch()}
                    />
                ) : departmentsQuery.isLoading ? (
                    <TableSkeleton rows={6} columns={canManage ? 5 : 4} />
                ) : filteredRows.length ? (
                    <TableScroll label="سجل أقسام الموارد البشرية">
                        <table className="erp-table w-full min-w-[660px]">
                            <caption className="sr-only">رموز الأقسام والمديرون وعدد الموظفين</caption>
                            <thead>
                                <tr>
                                    <th scope="col">الرمز</th>
                                    <th scope="col">اسم القسم</th>
                                    <th scope="col">المدير</th>
                                    <th scope="col">عدد الموظفين</th>
                                    {canManage ? <th scope="col">إجراءات</th> : null}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRows.map((row) => (
                                    <tr key={row.id}>
                                        <td className="font-mono" dir="ltr">
                                            {row.code || '—'}
                                        </td>
                                        <th scope="row">{row.name}</th>
                                        <td>{row.manager}</td>
                                        <td className="erp-numeric" dir="ltr">
                                            {formatInt(row.employeeCount)}
                                        </td>
                                        {canManage ? (
                                            <td>
                                                <div className="flex flex-wrap gap-xxs">
                                                    <button
                                                        type="button"
                                                        onClick={() => openEditForm(row)}
                                                        className="rounded-md border border-hairline-strong px-xs py-xxs text-caption"
                                                    >
                                                        تعديل
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={mutation.isPending}
                                                        onClick={() => removeDepartment(row)}
                                                        className="rounded-md border border-danger-text/40 px-xs py-xxs text-caption text-danger-text disabled:opacity-50"
                                                    >
                                                        حذف
                                                    </button>
                                                </div>
                                            </td>
                                        ) : null}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableScroll>
                ) : (
                    <StateEmpty
                        title={search ? 'لا توجد نتائج مطابقة' : 'لا توجد أقسام مسجلة'}
                        hint={
                            search ? 'غيّر كلمات البحث أو امسحها لعرض جميع الأقسام.' : 'ستظهر الأقسام هنا بعد إنشائها.'
                        }
                    />
                )}
            </Card>
        </div>
    );
}
