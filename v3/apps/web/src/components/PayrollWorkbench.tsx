import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuthState } from '../lib/auth';
import {
    applyDeductions,
    canWritePayroll,
    type DeductionPreview,
    generatePayrollRun,
    PAYROLL_WRITE_TEXT,
    type PayrollGenerateResult,
    payrollMonthError,
    previewDeductions,
} from '../lib/payroll-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';
import { useConfirm } from './ConfirmProvider';

/**
 * واجهة كتابة الرواتب: توليد المسير، ومعاينة/تطبيق الخصومات الآلية.
 *
 * كل الحساب على الخادم؛ الشاشة ترسل الشهر (وخيار الأوفرتايم أو استثناء
 * الجمعة) وتعرض ما يعود. لا تُجمع مبالغ ولا تُقرَّب هنا.
 */

function money(value: string | undefined): string {
    return value === undefined || value === '' ? '0.00' : String(value);
}

function formatInt(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
}

interface DeductionsTableProps {
    preview: DeductionPreview;
}

function DeductionsTable({ preview }: DeductionsTableProps) {
    const rows = preview.employees.filter((row) => Number(row.totalDeduction) > 0);
    if (rows.length === 0) {
        return (
            <p className="text-body-sm text-muted" role="status">
                {PAYROLL_WRITE_TEXT.none}
            </p>
        );
    }
    return (
        <div className="max-h-72 overflow-auto rounded-md border border-hairline">
            <table className="w-full border-collapse text-body-sm">
                <caption className="sr-only">تفصيل الخصومات الآلية لكل موظف</caption>
                <thead className="sticky top-0 bg-surface-sunken text-label-md text-ink-secondary">
                    <tr>
                        <th scope="col" className="px-sm py-xs text-start font-medium">
                            الموظف
                        </th>
                        <th scope="col" className="px-sm py-xs text-start font-medium">
                            تأخير
                        </th>
                        <th scope="col" className="px-sm py-xs text-start font-medium">
                            غياب
                        </th>
                        <th scope="col" className="px-sm py-xs text-start font-medium">
                            الإجمالي
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.employeeId} className="border-b border-hairline">
                            <td className="px-sm py-xxs text-ink">
                                {row.name || `#${row.employeeId}`}
                                {row.employeeCode ? (
                                    <small className="block text-caption text-muted" dir="ltr">
                                        {row.employeeCode}
                                    </small>
                                ) : null}
                            </td>
                            <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                {money(row.lateDeduction)}
                            </td>
                            <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                {money(row.absentDeduction)}
                            </td>
                            <td className="erp-numeric px-sm py-xxs font-semibold text-ink" dir="ltr">
                                {money(row.totalDeduction)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function PayrollWorkbench({ month }: { month: string }) {
    const auth = useAuthState();
    const writable = canWritePayroll(auth.user?.role);
    const confirm = useConfirm();
    const { toast } = useToast();

    const [generateOpen, setGenerateOpen] = useState(false);
    const [includeOvertime, setIncludeOvertime] = useState(false);
    const [generateError, setGenerateError] = useState('');

    const [deductionsOpen, setDeductionsOpen] = useState(false);
    const [skipFridays, setSkipFridays] = useState(false);
    const [deductionsError, setDeductionsError] = useState('');

    const generateMutation = useWriteMutation<void, PayrollGenerateResult>({
        mutationFn: () => generatePayrollRun(month, includeOvertime),
        invalidate: [['payroll-runs'], ['payroll-sheet', month]],
        silentError: true,
        onError: (cause) => {
            setGenerateError(writeErrorMessage(cause, PAYROLL_WRITE_TEXT.generateFailed));
        },
        onSuccess: (result) => {
            toast({
                title: PAYROLL_WRITE_TEXT.generated(result.month, result.count, money(result.totals?.net)),
                variant: 'success',
            });
            setGenerateOpen(false);
            setGenerateError('');
        },
    });

    const previewQuery = useQuery({
        queryKey: ['payroll-deductions', month, skipFridays],
        queryFn: ({ signal }) => previewDeductions(month, skipFridays, signal),
        enabled: deductionsOpen,
    });

    const applyMutation = useWriteMutation<void, void>({
        mutationFn: async () => {
            await applyDeductions(month, skipFridays);
        },
        invalidate: [['payroll-runs'], ['payroll-sheet', month], ['payroll-deductions', month]],
        silentError: true,
        onError: (cause) => {
            setDeductionsError(writeErrorMessage(cause, PAYROLL_WRITE_TEXT.applyFailed));
        },
        onSuccess: () => {
            setDeductionsOpen(false);
            setDeductionsError('');
        },
    });

    if (!writable) {
        return null;
    }

    const monthError = payrollMonthError(month);
    const monthErrorProps = monthError ? { error: monthError } : {};

    async function handleApply(): Promise<void> {
        const totals = previewQuery.data?.totals;
        const rows = previewQuery.data?.employees.filter((row) => Number(row.totalDeduction) > 0).length ?? 0;
        if (rows === 0) {
            setDeductionsError(PAYROLL_WRITE_TEXT.none);
            return;
        }
        const answer = await confirm(PAYROLL_WRITE_TEXT.applyConfirm(month, money(totals?.total), rows));
        if (!answer) {
            return;
        }
        setDeductionsError('');
        applyMutation.mutate();
    }

    return (
        <>
            <div className="flex flex-wrap items-center gap-xs" data-erp-print-hide>
                <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                        setGenerateError('');
                        setGenerateOpen(true);
                    }}
                >
                    {PAYROLL_WRITE_TEXT.generate}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                        setDeductionsError('');
                        setDeductionsOpen(true);
                    }}
                >
                    {PAYROLL_WRITE_TEXT.deductionsTitle}
                </Button>
            </div>

            <Dialog
                open={generateOpen}
                onOpenChange={setGenerateOpen}
                title={PAYROLL_WRITE_TEXT.generateTitle}
                description={PAYROLL_WRITE_TEXT.generateHint}
                size="sm"
                footer={
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setGenerateOpen(false)}>
                            {PAYROLL_WRITE_TEXT.close}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={Boolean(monthError) || generateMutation.isPending}
                            onClick={() => {
                                setGenerateError('');
                                generateMutation.mutate();
                            }}
                        >
                            {generateMutation.isPending ? 'جارٍ التوليد…' : PAYROLL_WRITE_TEXT.generate}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <Input
                        label="الشهر"
                        type="month"
                        value={month}
                        readOnly
                        hint={monthError || 'يُرسل الشهر المختار في كشف الرواتب أعلاه.'}
                        {...monthErrorProps}
                    />
                    <label className="flex items-center gap-xs text-body-md text-ink">
                        <input type="checkbox" checked={includeOvertime} onChange={(event) => setIncludeOvertime(event.target.checked)} />
                        {PAYROLL_WRITE_TEXT.overtime}
                    </label>
                    {generateError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {generateError}
                        </p>
                    ) : null}
                </div>
            </Dialog>

            <Dialog
                open={deductionsOpen}
                onOpenChange={setDeductionsOpen}
                title={PAYROLL_WRITE_TEXT.deductionsTitle}
                description={PAYROLL_WRITE_TEXT.deductionsHint}
                size="lg"
                footer={
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setDeductionsOpen(false)}>
                            {PAYROLL_WRITE_TEXT.close}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={applyMutation.isPending || previewQuery.isPending || Boolean(previewQuery.error)}
                            onClick={() => void handleApply()}
                        >
                            {applyMutation.isPending ? 'جارٍ التطبيق…' : PAYROLL_WRITE_TEXT.apply}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <p className="text-body-sm text-muted">
                        شهر{' '}
                        <span className="erp-numeric" dir="ltr">
                            {month}
                        </span>
                    </p>
                    <label className="flex items-center gap-xs text-body-md text-ink">
                        <input type="checkbox" checked={skipFridays} onChange={(event) => setSkipFridays(event.target.checked)} />
                        {PAYROLL_WRITE_TEXT.skipFridays}
                    </label>
                    {previewQuery.isPending ? (
                        <p className="text-body-sm text-muted" role="status">
                            جارٍ حساب المعاينة…
                        </p>
                    ) : null}
                    {previewQuery.isError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {writeErrorMessage(previewQuery.error, PAYROLL_WRITE_TEXT.previewFailed)}
                        </p>
                    ) : null}
                    {previewQuery.data ? (
                        <>
                            <dl className="grid grid-cols-3 gap-xs rounded-md bg-surface-sunken p-sm text-body-sm">
                                <div>
                                    <dt className="text-caption text-muted">خصم التأخير</dt>
                                    <dd className="erp-numeric text-ink" dir="ltr">
                                        {money(previewQuery.data.totals?.late)}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-caption text-muted">خصم الغياب</dt>
                                    <dd className="erp-numeric text-ink" dir="ltr">
                                        {money(previewQuery.data.totals?.absent)}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-caption text-muted">الإجمالي</dt>
                                    <dd className="erp-numeric font-semibold text-ink" dir="ltr">
                                        {money(previewQuery.data.totals?.total)}
                                    </dd>
                                </div>
                            </dl>
                            <DeductionsTable preview={previewQuery.data} />
                            <p className="text-caption text-muted">
                                {formatInt(previewQuery.data.employees.length)} موظفًا في الكشف — الصفوف التي عليها خصم فقط معروضة أعلاه.
                            </p>
                        </>
                    ) : null}
                    {deductionsError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {deductionsError}
                        </p>
                    ) : null}
                </div>
            </Dialog>
        </>
    );
}
