import './DeptEmployees.premium.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import {
    canWriteDeptEmployees,
    createDeptEmployee,
    type DeptEmployee,
    type DeptEmployeeForm,
    deactivateDeptEmployee,
    fetchDeptEmployees,
    searchDeptEmployees,
    statusLabel,
    updateDeptEmployee,
    validateDeptEmployeeForm,
} from '../lib/dept-employees';
import { errorMessage, intOf } from '../lib/reporting';

/** حدّ الأقسام المعروض في بطاقة النطاق — بلا اقتطاع لاسم القسم نفسه. */
const DEPT_SEPARATOR = ' + ';

export function DeptEmployees() {
    const auth = useAuthState();
    const canWrite = canWriteDeptEmployees(auth.user?.role);
    const queryClient = useQueryClient();
    const [query, setQuery] = useState('');
    const [formRow, setFormRow] = useState<DeptEmployee | null | undefined>(undefined);
    const [formError, setFormError] = useState('');
    const employeesQuery = useQuery({
        queryKey: ['hr', 'dept-employees'],
        queryFn: ({ signal }) => fetchDeptEmployees(signal),
    });

    const depts = employeesQuery.data?.depts ?? [];
    const employees = employeesQuery.data?.employees ?? [];
    const rows = useMemo(() => searchDeptEmployees(employees, query), [employees, query]);
    const active = employees.filter((row) => String(row.status ?? '') === 'active').length;
    const saveMutation = useMutation({
        mutationFn: ({ id, form }: { id?: string; form: DeptEmployeeForm }) =>
            id ? updateDeptEmployee(id, form) : createDeptEmployee(form),
        onSuccess: async () => {
            setFormRow(undefined);
            setFormError('');
            await queryClient.invalidateQueries({ queryKey: ['hr', 'dept-employees'] });
        },
        onError: (error) => setFormError(errorMessage(error)),
    });
    const deactivateMutation = useMutation({
        mutationFn: deactivateDeptEmployee,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hr', 'dept-employees'] }),
    });

    return (
        <div className="flex flex-col gap-md erp-premium erp-premium-dept-employees">
            <ReportHeader
                title="موظفو القسم"
                english="Dept Employees"
                description="سجل موظفي قسمك كما يراه رئيس القسم: الاسم والرقم الوظيفي والوظيفة والهاتف — بلا راتب ولا صلاحيات."
                pending={employeesQuery.isFetching}
                onRefresh={() => {
                    void employeesQuery.refetch();
                }}
            />

            <div className="flex gap-sm" data-erp-print-hide>
                {canWrite ? (
                    <button
                        type="button"
                        onClick={() => {
                            setFormError('');
                            setFormRow(null);
                        }}
                    >
                        إضافة موظف
                    </button>
                ) : null}
                <PrintActions title="موظفو القسم" />
            </div>
            {formRow !== undefined && canWrite ? (
                <form
                    className="grid gap-sm rounded-md border border-hairline p-md sm:grid-cols-2"
                    data-erp-print-hide
                    onSubmit={(event) => {
                        event.preventDefault();
                        const data = new FormData(event.currentTarget);
                        const form: DeptEmployeeForm = {
                            name: String(data.get('name') || ''),
                            employeeId: String(data.get('employeeId') || ''),
                            position: String(data.get('position') || ''),
                            phone: String(data.get('phone') || ''),
                        };
                        const errors = validateDeptEmployeeForm(form);
                        if (errors.length) {
                            setFormError(errors.join(' · '));
                            return;
                        }
                        if (formRow) {
                            saveMutation.mutate({ id: formRow.id, form });
                        } else {
                            saveMutation.mutate({ form });
                        }
                    }}
                >
                    <label>
                        الاسم *<input name="name" required maxLength={255} defaultValue={formRow?.name || ''} />
                    </label>
                    <label>
                        الرقم الوظيفي *
                        <input
                            name="employeeId"
                            required
                            maxLength={50}
                            readOnly={Boolean(formRow)}
                            defaultValue={formRow?.employeeId || ''}
                        />
                    </label>
                    <label>
                        الوظيفة
                        <input name="position" maxLength={255} defaultValue={formRow?.position || ''} />
                    </label>
                    <label>
                        الهاتف
                        <input name="phone" maxLength={50} inputMode="tel" defaultValue={formRow?.phone || ''} />
                    </label>
                    {formError ? (
                        <p role="alert" className="text-danger-text sm:col-span-2">
                            {formError}
                        </p>
                    ) : null}
                    <div className="flex gap-sm sm:col-span-2">
                        <button type="submit" disabled={saveMutation.isPending}>
                            {saveMutation.isPending ? 'جارٍ الحفظ…' : 'حفظ'}
                        </button>
                        <button type="button" onClick={() => setFormRow(undefined)}>
                            إلغاء
                        </button>
                    </div>
                </form>
            ) : null}

            <ul className="grid list-none gap-sm sm:grid-cols-3" aria-label="مؤشرات موظفي القسم">
                <KpiCard label="الموظفون" english="Employees" value={intOf(employees.length)} hint="كل موظفي القسم المسجلين" />
                <KpiCard label="النشطون" english="Active" value={intOf(active)} hint="حالة الخدمة نشطة" tone="success" />
                <KpiCard
                    label="نطاق الأقسام"
                    english="Department scope"
                    value={intOf(depts.length)}
                    hint={depts.length > 0 ? depts.join(DEPT_SEPARATOR) : 'لا نطاق معلن من الخادم'}
                />
            </ul>

            <SectionCard title="السجل" english="Register">
                <div className="flex flex-wrap items-end gap-sm border-b border-hairline p-sm">
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-dept-emp-q">
                        بحث
                        <input
                            id="erp-dept-emp-q"
                            type="search"
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                            }}
                            placeholder="اسم، رقم وظيفي، وظيفة، هاتف"
                            className="h-9 w-64 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <span className="text-body-sm text-muted" role="status">
                        {`${intOf(rows.length)} من ${intOf(employees.length)} موظفًا`}
                    </span>
                </div>

                {employeesQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل موظفي القسم" />
                        <TableSkeleton rows={5} columns={5} />
                    </div>
                ) : null}

                {employeesQuery.isError ? (
                    <StateError
                        message={errorMessage(employeesQuery.error)}
                        onRetry={() => {
                            void employeesQuery.refetch();
                        }}
                    />
                ) : null}

                {employeesQuery.isSuccess && employees.length === 0 ? (
                    <StateEmpty
                        title="لا موظفين في قسمك"
                        hint={canWrite ? 'أضف أول موظف من الزر أعلاه.' : 'راجع الإدارة لربط حسابك بقسم.'}
                    />
                ) : null}

                {employeesQuery.isSuccess && employees.length > 0 && rows.length === 0 ? (
                    <StateEmpty title="لا نتائج تطابق البحث" hint="امسح خانة البحث لعرض السجل كاملًا." />
                ) : null}

                {rows.length > 0 ? (
                    <TableScroll label="جدول موظفي القسم">
                        <table className="w-full border-collapse text-body-md">
                            <thead>
                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الاسم
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الرقم الوظيفي
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الوظيفة
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الهاتف
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الحالة
                                    </th>
                                    {canWrite ? (
                                        <th scope="col" data-erp-print-hide>
                                            إجراءات
                                        </th>
                                    ) : null}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row: DeptEmployee) => (
                                    <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                        <td className="px-sm py-xxs text-ink">{String(row.name ?? '') || '—'}</td>
                                        <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                            {String(row.employeeId ?? '') || '—'}
                                        </td>
                                        <td className="px-sm py-xxs text-body-sm text-muted">{String(row.position ?? '') || '—'}</td>
                                        <td className="erp-numeric px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                            {String(row.phone ?? '') || '—'}
                                        </td>
                                        <td className="px-sm py-xxs text-body-sm">
                                            <span className={String(row.status ?? '') === 'active' ? 'text-success-text' : 'text-muted'}>
                                                {statusLabel(String(row.status ?? ''))}
                                            </span>
                                        </td>
                                        {canWrite ? (
                                            <td data-erp-print-hide>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setFormError('');
                                                        setFormRow(row);
                                                    }}
                                                >
                                                    تعديل
                                                </button>{' '}
                                                <button
                                                    type="button"
                                                    disabled={deactivateMutation.isPending}
                                                    onClick={() => {
                                                        if (
                                                            window.confirm(
                                                                `تعطيل الموظف «${row.name}»؟ سيختفي من القسم (سجلاته التاريخية تبقى محفوظة).`,
                                                            )
                                                        )
                                                            deactivateMutation.mutate(row.id);
                                                    }}
                                                >
                                                    تعطيل
                                                </button>
                                            </td>
                                        ) : null}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableScroll>
                ) : null}
            </SectionCard>
        </div>
    );
}
