import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useAuthState } from '../lib/auth';
import { fetchEmployees } from '../lib/employees';
import {
    ADJUSTMENT_KINDS,
    adjustmentKindName,
    canWritePayrollSuite,
    contractState,
    createAdjustment,
    createAdvance,
    createContract,
    createEvaluation,
    evaluationStars,
    fetchAdjustments,
    fetchAdvances,
    fetchContracts,
    fetchEvaluations,
    removePayrollSuiteRow,
    validateAdjustment,
    validateAdvance,
    validateContract,
    validateEvaluation,
} from '../lib/payroll-suite';
import { moneyOf, todayIso } from '../lib/reporting';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';
import { useConfirm } from './ConfirmProvider';
import { SectionCard } from './Reports';
import { StateEmpty, TableScroll } from './TableState';

/**
 * الأبواب الأربعة الباقية من شاشة الرواتب في V2 — السلف والبنود والعقود
 * والتقييمات. الأدوار `admin|manager|hr` كما في الخادم؛ المبالغ لا تُجمع
 * ولا تُعيد الواجهة حسابها، والرواتب قد تُخفى من الخادم فتُعرض كما وردت.
 */

const LIST_LIMIT = 30;

function fieldNumber(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function PayrollSuite({ month }: { month: string }) {
    const auth = useAuthState();
    const writable = canWritePayrollSuite(auth.user?.role);
    const confirm = useConfirm();
    const { toast } = useToast();

    const [panel, setPanel] = useState('');
    const [error, setError] = useState('');

    const [advEmployee, setAdvEmployee] = useState('');
    const [advAmount, setAdvAmount] = useState('');
    const [advInstallment, setAdvInstallment] = useState('0');
    const [advDate, setAdvDate] = useState(() => todayIso());

    const [adjEmployee, setAdjEmployee] = useState('');
    const [adjMonth, setAdjMonth] = useState(month);
    const [adjKind, setAdjKind] = useState('penalty');
    const [adjAmount, setAdjAmount] = useState('');
    const [adjReason, setAdjReason] = useState('');

    const [conEmployee, setConEmployee] = useState('');
    const [conFrom, setConFrom] = useState(() => todayIso());
    const [conTo, setConTo] = useState('');
    const [conSalary, setConSalary] = useState('');

    const [evEmployee, setEvEmployee] = useState('');
    const [evPeriod, setEvPeriod] = useState(month);
    const [evScore, setEvScore] = useState('5');
    const [evBy, setEvBy] = useState('');
    const [evNotes, setEvNotes] = useState('');

    const employeesQuery = useQuery({
        queryKey: ['payroll-suite-employees'],
        queryFn: ({ signal }) => fetchEmployees(signal),
        enabled: writable,
        refetchOnWindowFocus: false,
    });
    const advancesQuery = useQuery({
        queryKey: ['payroll-suite', 'advances'],
        queryFn: ({ signal }) => fetchAdvances(signal),
        enabled: writable,
        refetchOnWindowFocus: false,
    });
    const adjustmentsQuery = useQuery({
        queryKey: ['payroll-suite', 'adjustments'],
        queryFn: ({ signal }) => fetchAdjustments(signal),
        enabled: writable,
        refetchOnWindowFocus: false,
    });
    const contractsQuery = useQuery({
        queryKey: ['payroll-suite', 'contracts'],
        queryFn: ({ signal }) => fetchContracts(signal),
        enabled: writable,
        refetchOnWindowFocus: false,
    });
    const evaluationsQuery = useQuery({
        queryKey: ['payroll-suite', 'evaluations'],
        queryFn: ({ signal }) => fetchEvaluations(signal),
        enabled: writable,
        refetchOnWindowFocus: false,
    });

    const employeeNames = useMemo(() => {
        const map = new Map<string, string>();
        for (const employee of employeesQuery.data ?? []) {
            map.set(String(employee.id), employee.name || `#${employee.id}`);
        }
        return map;
    }, [employeesQuery.data]);

    const employeeOptions = useMemo(
        () =>
            (employeesQuery.data ?? [])
                .filter((employee) => employee.status !== 'inactive')
                .map((employee) => ({
                    value: String(employee.id),
                    label: `${employee.name || `#${employee.id}`}${employee.position ? ` — ${employee.position}` : ''}`,
                })),
        [employeesQuery.data],
    );

    const invalidate = [
        ['payroll-suite', 'advances'],
        ['payroll-suite', 'adjustments'],
        ['payroll-suite', 'contracts'],
        ['payroll-suite', 'evaluations'],
    ] as const;

    const saveAdvance = useWriteMutation<void, void>({
        mutationFn: () =>
            createAdvance({
                employeeId: fieldNumber(advEmployee),
                amount: fieldNumber(advAmount),
                monthlyDeduction: fieldNumber(advInstallment),
                date: advDate,
            }),
        successTitle: () => 'تم تسجيل السلفة',
        invalidate: [['payroll-suite', 'advances']],
        silentError: true,
        onSuccess: () => {
            setError('');
            setAdvEmployee('');
            setAdvAmount('');
            setAdvInstallment('0');
            setPanel('');
        },
        onError: (cause) => {
            setError(writeErrorMessage(cause, 'تعذّر تسجيل السلفة'));
        },
    });

    const saveAdjustment = useWriteMutation<void, void>({
        mutationFn: () =>
            createAdjustment({
                employeeId: fieldNumber(adjEmployee),
                month: adjMonth,
                kind: adjKind,
                amount: fieldNumber(adjAmount),
                reason: adjReason,
            }),
        successTitle: () => 'تم تسجيل البند',
        invalidate: [['payroll-suite', 'adjustments']],
        silentError: true,
        onSuccess: () => {
            setError('');
            setAdjEmployee('');
            setAdjAmount('');
            setAdjReason('');
            setPanel('');
        },
        onError: (cause) => {
            setError(writeErrorMessage(cause, 'تعذّر تسجيل البند'));
        },
    });

    const saveContract = useWriteMutation<void, void>({
        mutationFn: () =>
            createContract({
                employeeId: fieldNumber(conEmployee),
                startDate: conFrom,
                endDate: conTo,
                salary: fieldNumber(conSalary),
            }),
        successTitle: () => 'تم حفظ العقد',
        invalidate: [['payroll-suite', 'contracts']],
        silentError: true,
        onSuccess: () => {
            setError('');
            setConEmployee('');
            setConTo('');
            setConSalary('');
            setPanel('');
        },
        onError: (cause) => {
            setError(writeErrorMessage(cause, 'تعذّر حفظ العقد'));
        },
    });

    const saveEvaluation = useWriteMutation<void, void>({
        mutationFn: () =>
            createEvaluation({
                employeeId: fieldNumber(evEmployee),
                period: evPeriod,
                score: fieldNumber(evScore),
                notes: evNotes,
                evaluator: evBy,
            }),
        successTitle: () => 'تم حفظ التقييم',
        invalidate: [['payroll-suite', 'evaluations']],
        silentError: true,
        onSuccess: () => {
            setError('');
            setEvEmployee('');
            setEvBy('');
            setEvNotes('');
            setPanel('');
        },
        onError: (cause) => {
            setError(writeErrorMessage(cause, 'تعذّر حفظ التقييم'));
        },
    });

    const removeRow = useWriteMutation<{ entity: 'advances' | 'adjustments' | 'contracts' | 'evaluations'; id: string }, void>({
        mutationFn: (vars) => removePayrollSuiteRow(vars.entity, vars.id),
        successTitle: () => 'تم الحذف',
        invalidate: [...invalidate],
        silentError: true,
        onError: (cause) => {
            toast({ title: 'تعذّر الحذف', description: writeErrorMessage(cause), variant: 'error' });
        },
    });

    if (!writable) {
        return null;
    }

    const employeesMissing = employeesQuery.isError;
    const employeeHint = employeesMissing ? 'تعذّر تحميل دليل الموظفين — أعد المحاولة قبل الإضافة.' : undefined;

    async function askDelete(entity: 'advances' | 'adjustments' | 'contracts' | 'evaluations', id: string, label: string): Promise<void> {
        if (!(await confirm(`حذف ${label}؟`))) {
            return;
        }
        removeRow.mutate({ entity, id });
    }

    const nameOf = (id: string) => employeeNames.get(String(id)) ?? `#${id}`;
    const advances = (advancesQuery.data ?? []).slice(0, LIST_LIMIT);
    const adjustments = (adjustmentsQuery.data ?? []).slice(0, LIST_LIMIT);
    const contracts = (contractsQuery.data ?? []).slice(0, LIST_LIMIT);
    const evaluations = (evaluationsQuery.data ?? []).slice(0, LIST_LIMIT);

    const panelToggle = (key: string) => setPanel(panel === key ? '' : key);

    return (
        <div className="flex flex-col gap-md">
            {error ? (
                <p className="rounded-md border border-danger/40 bg-danger-soft px-sm py-xs text-body-sm text-danger-text" role="alert">
                    {error}
                </p>
            ) : null}

            <SectionCard title="السلف" english="Advances" actions={<Badge variant="neutral">{advances.length} سجلًا</Badge>}>
                <div className="flex flex-col gap-sm p-sm">
                    <div className="flex flex-wrap items-end gap-sm">
                        <Select
                            label="الموظف"
                            options={employeeOptions}
                            placeholder="اختر موظفًا"
                            {...(advEmployee ? { value: advEmployee } : {})}
                            onValueChange={setAdvEmployee}
                            containerClassName="w-64"
                            {...(employeeHint ? { hint: employeeHint } : {})}
                        />
                        <Input
                            label="المبلغ"
                            type="number"
                            inputMode="decimal"
                            min="0.01"
                            step="0.01"
                            dir="ltr"
                            containerClassName="w-36"
                            value={advAmount}
                            onChange={(event) => setAdvAmount(event.target.value)}
                        />
                        <Input
                            label="القسط الشهري"
                            hint="0 = دفعة واحدة"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            dir="ltr"
                            containerClassName="w-36"
                            value={advInstallment}
                            onChange={(event) => setAdvInstallment(event.target.value)}
                        />
                        <Input
                            label="التاريخ"
                            type="date"
                            dir="ltr"
                            containerClassName="w-40"
                            value={advDate}
                            onChange={(event) => setAdvDate(event.target.value)}
                        />
                        <Button
                            size="sm"
                            loading={saveAdvance.isPending}
                            onClick={() => {
                                const problem = validateAdvance({
                                    employeeId: fieldNumber(advEmployee),
                                    amount: fieldNumber(advAmount),
                                    monthlyDeduction: fieldNumber(advInstallment),
                                    date: advDate,
                                });
                                if (problem) {
                                    setError(problem);
                                    return;
                                }
                                setError('');
                                saveAdvance.mutate();
                            }}
                        >
                            سلفة
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => panelToggle('advances')}>
                            {panel === 'advances' ? 'إخفاء السجل' : 'عرض السجل'}
                        </Button>
                    </div>
                    {panel === 'advances' ? (
                        advances.length ? (
                            <TableScroll label="سجل السلف">
                                <table className="w-full border-collapse text-body-sm">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start">
                                                الموظف
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                المبلغ
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                القسط
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                المتبقي
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                الحالة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                التاريخ
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                إجراء
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {advances.map((row) => (
                                            <tr key={row.id} className="border-b border-hairline">
                                                <td className="px-sm py-xxs font-semibold text-ink">{nameOf(row.employeeId)}</td>
                                                <td className="px-sm py-xxs text-ink" dir="ltr">
                                                    {moneyOf(row.amount)}
                                                </td>
                                                <td className="px-sm py-xxs text-muted" dir="ltr">
                                                    {moneyOf(row.monthly_deduction)}
                                                </td>
                                                <td className="px-sm py-xxs font-semibold text-ink" dir="ltr">
                                                    {moneyOf(row.remaining)}
                                                </td>
                                                <td className="px-sm py-xxs">
                                                    <Badge variant={row.status === 'active' ? 'success' : 'neutral'}>
                                                        {row.status === 'active' ? 'نشطة' : 'مغلقة'}
                                                    </Badge>
                                                </td>
                                                <td className="px-sm py-xxs text-muted" dir="ltr">
                                                    {row.date.slice(0, 10) || '—'}
                                                </td>
                                                <td className="px-sm py-xxs">
                                                    <Button
                                                        size="sm"
                                                        variant="danger"
                                                        disabled={removeRow.isPending}
                                                        onClick={() => void askDelete('advances', row.id, 'هذه السلفة')}
                                                    >
                                                        حذف
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        ) : (
                            <StateEmpty title="لا سلف مسجّلة" hint="سجّل سلفة بالنموذج أعلاه." />
                        )
                    ) : null}
                </div>
            </SectionCard>

            <SectionCard title="بنود الرواتب" english="Adjustments" actions={<Badge variant="neutral">{adjustments.length} بندًا</Badge>}>
                <div className="flex flex-col gap-sm p-sm">
                    <div className="flex flex-wrap items-end gap-sm">
                        <Select
                            label="الموظف"
                            options={employeeOptions}
                            placeholder="اختر موظفًا"
                            {...(adjEmployee ? { value: adjEmployee } : {})}
                            onValueChange={setAdjEmployee}
                            containerClassName="w-64"
                            {...(employeeHint ? { hint: employeeHint } : {})}
                        />
                        <Input
                            label="الشهر"
                            type="month"
                            dir="ltr"
                            containerClassName="w-40"
                            value={adjMonth}
                            onChange={(event) => setAdjMonth(event.target.value)}
                        />
                        <Select
                            label="النوع"
                            options={ADJUSTMENT_KINDS.map((entry) => ({ value: entry.value, label: entry.label }))}
                            value={adjKind}
                            onValueChange={setAdjKind}
                            containerClassName="w-32"
                        />
                        <Input
                            label="المبلغ"
                            type="number"
                            inputMode="decimal"
                            min="0.01"
                            step="0.01"
                            dir="ltr"
                            containerClassName="w-36"
                            value={adjAmount}
                            onChange={(event) => setAdjAmount(event.target.value)}
                        />
                        <Input
                            label="السبب"
                            containerClassName="w-56"
                            value={adjReason}
                            onChange={(event) => setAdjReason(event.target.value)}
                        />
                        <Button
                            size="sm"
                            loading={saveAdjustment.isPending}
                            onClick={() => {
                                const problem = validateAdjustment({
                                    employeeId: fieldNumber(adjEmployee),
                                    month: adjMonth,
                                    kind: adjKind,
                                    amount: fieldNumber(adjAmount),
                                    reason: adjReason,
                                });
                                if (problem) {
                                    setError(problem);
                                    return;
                                }
                                setError('');
                                saveAdjustment.mutate();
                            }}
                        >
                            بند
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => panelToggle('adjustments')}>
                            {panel === 'adjustments' ? 'إخفاء السجل' : 'عرض السجل'}
                        </Button>
                    </div>
                    {panel === 'adjustments' ? (
                        adjustments.length ? (
                            <TableScroll label="سجل بنود الرواتب">
                                <table className="w-full border-collapse text-body-sm">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start">
                                                الموظف
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                الشهر
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                النوع
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                المبلغ
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                السبب
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                إجراء
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {adjustments.map((row) => (
                                            <tr key={row.id} className="border-b border-hairline">
                                                <td className="px-sm py-xxs font-semibold text-ink">{nameOf(row.employeeId)}</td>
                                                <td className="px-sm py-xxs text-muted" dir="ltr">
                                                    {row.month || '—'}
                                                </td>
                                                <td className="px-sm py-xxs">
                                                    <Badge
                                                        variant={row.kind === 'penalty' || row.kind === 'deduction' ? 'danger' : 'success'}
                                                    >
                                                        {adjustmentKindName(row.kind)}
                                                    </Badge>
                                                </td>
                                                <td className="px-sm py-xxs text-ink" dir="ltr">
                                                    {moneyOf(row.amount)}
                                                </td>
                                                <td className="px-sm py-xxs text-muted">{row.reason || '—'}</td>
                                                <td className="px-sm py-xxs">
                                                    <Button
                                                        size="sm"
                                                        variant="danger"
                                                        disabled={removeRow.isPending}
                                                        onClick={() => void askDelete('adjustments', row.id, 'هذا البند')}
                                                    >
                                                        حذف
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        ) : (
                            <StateEmpty title="لا بنود مسجّلة" hint="سجّل بندًا بالنموذج أعلاه." />
                        )
                    ) : null}
                </div>
            </SectionCard>

            <SectionCard title="العقود" english="Contracts" actions={<Badge variant="neutral">{contracts.length} عقدًا</Badge>}>
                <div className="flex flex-col gap-sm p-sm">
                    <div className="flex flex-wrap items-end gap-sm">
                        <Select
                            label="الموظف"
                            options={employeeOptions}
                            placeholder="اختر موظفًا"
                            {...(conEmployee ? { value: conEmployee } : {})}
                            onValueChange={setConEmployee}
                            containerClassName="w-64"
                            {...(employeeHint ? { hint: employeeHint } : {})}
                        />
                        <Input
                            label="من"
                            type="date"
                            dir="ltr"
                            containerClassName="w-40"
                            value={conFrom}
                            onChange={(event) => setConFrom(event.target.value)}
                        />
                        <Input
                            label="إلى"
                            type="date"
                            dir="ltr"
                            containerClassName="w-40"
                            value={conTo}
                            onChange={(event) => setConTo(event.target.value)}
                        />
                        <Input
                            label="الراتب التعاقدي"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            dir="ltr"
                            containerClassName="w-40"
                            value={conSalary}
                            onChange={(event) => setConSalary(event.target.value)}
                        />
                        <Button
                            size="sm"
                            loading={saveContract.isPending}
                            onClick={() => {
                                const problem = validateContract({
                                    employeeId: fieldNumber(conEmployee),
                                    startDate: conFrom,
                                    endDate: conTo,
                                    salary: fieldNumber(conSalary),
                                });
                                if (problem) {
                                    setError(problem);
                                    return;
                                }
                                setError('');
                                saveContract.mutate();
                            }}
                        >
                            حفظ العقد
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => panelToggle('contracts')}>
                            {panel === 'contracts' ? 'إخفاء السجل' : 'عرض السجل'}
                        </Button>
                    </div>
                    {panel === 'contracts' ? (
                        contracts.length ? (
                            <TableScroll label="سجل العقود">
                                <table className="w-full border-collapse text-body-sm">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start">
                                                الموظف
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                من
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                إلى
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                الحالة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                الراتب
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                إجراء
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {contracts.map((row) => {
                                            const state = contractState(row.end_date);
                                            return (
                                                <tr key={row.id} className="border-b border-hairline">
                                                    <td className="px-sm py-xxs font-semibold text-ink">{nameOf(row.employeeId)}</td>
                                                    <td className="px-sm py-xxs text-muted" dir="ltr">
                                                        {row.start_date.slice(0, 10) || '—'}
                                                    </td>
                                                    <td className="px-sm py-xxs text-muted" dir="ltr">
                                                        {row.end_date.slice(0, 10) || '—'}
                                                    </td>
                                                    <td className="px-sm py-xxs">
                                                        <Badge variant={state.tone}>{state.label}</Badge>
                                                    </td>
                                                    <td className="px-sm py-xxs text-ink" dir="ltr">
                                                        {moneyOf(row.salary)}
                                                    </td>
                                                    <td className="px-sm py-xxs">
                                                        <Button
                                                            size="sm"
                                                            variant="danger"
                                                            disabled={removeRow.isPending}
                                                            onClick={() => void askDelete('contracts', row.id, 'هذا العقد')}
                                                        >
                                                            حذف
                                                        </Button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </TableScroll>
                        ) : (
                            <StateEmpty title="لا عقود مسجّلة" hint="سجّل عقدًا بالنموذج أعلاه." />
                        )
                    ) : null}
                </div>
            </SectionCard>

            <SectionCard title="التقييمات" english="Evaluations" actions={<Badge variant="neutral">{evaluations.length} تقييمًا</Badge>}>
                <div className="flex flex-col gap-sm p-sm">
                    <div className="flex flex-wrap items-end gap-sm">
                        <Select
                            label="الموظف"
                            options={employeeOptions}
                            placeholder="اختر موظفًا"
                            {...(evEmployee ? { value: evEmployee } : {})}
                            onValueChange={setEvEmployee}
                            containerClassName="w-64"
                            {...(employeeHint ? { hint: employeeHint } : {})}
                        />
                        <Input
                            label="الفترة"
                            type="month"
                            dir="ltr"
                            containerClassName="w-40"
                            value={evPeriod}
                            onChange={(event) => setEvPeriod(event.target.value)}
                        />
                        <Select
                            label="التقييم"
                            options={['5', '4', '3', '2', '1'].map((value) => ({ value, label: `${value} من 5` }))}
                            value={evScore}
                            onValueChange={setEvScore}
                            containerClassName="w-32"
                        />
                        <Input label="المقيّم" containerClassName="w-40" value={evBy} onChange={(event) => setEvBy(event.target.value)} />
                        <Input
                            label="ملاحظات"
                            containerClassName="w-56"
                            value={evNotes}
                            onChange={(event) => setEvNotes(event.target.value)}
                        />
                        <Button
                            size="sm"
                            loading={saveEvaluation.isPending}
                            onClick={() => {
                                const problem = validateEvaluation({
                                    employeeId: fieldNumber(evEmployee),
                                    period: evPeriod,
                                    score: fieldNumber(evScore),
                                    notes: evNotes,
                                    evaluator: evBy,
                                });
                                if (problem) {
                                    setError(problem);
                                    return;
                                }
                                setError('');
                                saveEvaluation.mutate();
                            }}
                        >
                            تقييم
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => panelToggle('evaluations')}>
                            {panel === 'evaluations' ? 'إخفاء السجل' : 'عرض السجل'}
                        </Button>
                    </div>
                    {panel === 'evaluations' ? (
                        evaluations.length ? (
                            <TableScroll label="سجل التقييمات">
                                <table className="w-full border-collapse text-body-sm">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start">
                                                الموظف
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                الفترة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                التقييم
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                المقيّم
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                ملاحظات
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start">
                                                إجراء
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {evaluations.map((row) => (
                                            <tr key={row.id} className="border-b border-hairline">
                                                <td className="px-sm py-xxs font-semibold text-ink">{nameOf(row.employeeId)}</td>
                                                <td className="px-sm py-xxs text-muted" dir="ltr">
                                                    {row.period || '—'}
                                                </td>
                                                <td className="px-sm py-xxs text-ink" dir="ltr">
                                                    {evaluationStars(row.score)}
                                                </td>
                                                <td className="px-sm py-xxs text-muted">{row.evaluator || '—'}</td>
                                                <td className="px-sm py-xxs text-muted">{row.notes || '—'}</td>
                                                <td className="px-sm py-xxs">
                                                    <Button
                                                        size="sm"
                                                        variant="danger"
                                                        disabled={removeRow.isPending}
                                                        onClick={() => void askDelete('evaluations', row.id, 'هذا التقييم')}
                                                    >
                                                        حذف
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        ) : (
                            <StateEmpty title="لا تقييمات مسجّلة" hint="سجّل تقييمًا بالنموذج أعلاه." />
                        )
                    ) : null}
                </div>
            </SectionCard>
        </div>
    );
}
