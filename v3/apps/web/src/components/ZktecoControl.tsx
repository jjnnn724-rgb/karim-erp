import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuthState } from '../lib/auth';
import { intOf, num, todayIso } from '../lib/reporting';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import {
    fetchZkControl,
    fetchZkCoverage,
    fetchZkLogs,
    fetchZkMappings,
    fetchZkReconciliation,
    rebuildZkDays,
    toggleZkPunch,
    type ZkLogRow,
    zkDaySpan,
    zkIgnoreReasonError,
    zkPunchStateName,
    zkRebuildErrors,
} from '../lib/zkteco-admin';
import { canControlZk } from '../lib/zkteco-write';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';
import { useConfirm } from './ConfirmProvider';
import { KpiCard, SectionCard } from './Reports';
import { StateEmpty, StateError, TableScroll } from './TableState';

/**
 * مركز تحكم البصمة كما في V2: سجل البصمات الخام بتجاهل/استعادة، إعادة بناء
 * أيام الموظف من بصماته، تغطية الربط لكل موظف، ومطابقة دفتر الجهاز بدفتر
 * النظام. كل كتابة تمرّ ببوابة الخادم بسببٍ مكتوب، والقراءة لا تعدّل شيئًا.
 */

const AUDIT_NAMES: Record<string, string> = {
    'engine:start': 'تشغيل المحرك',
    'engine:stop': 'إيقاف المحرك',
    'engine:restart': 'إعادة تشغيل المحرك',
    'rebuild-days': 'إعادة بناء أيام',
    'punch:ignore': 'تجاهل بصمة',
    'punch:restore': 'استعادة بصمة',
};

function auditName(action: unknown): string {
    const key = String(action ?? '');
    return AUDIT_NAMES[key] ?? (key || '—');
}

function timeText(value: unknown): string {
    return String(value ?? '')
        .slice(0, 19)
        .replace('T', ' ');
}

export function ZktecoControl() {
    const auth = useAuthState();
    const controllable = canControlZk(auth.user?.role);
    const { toast } = useToast();
    const confirm = useConfirm();

    const [unmappedOnly, setUnmappedOnly] = useState(false);
    const logsQuery = useQuery({
        queryKey: ['zkteco', 'logs', unmappedOnly],
        queryFn: ({ signal }) => fetchZkLogs({ limit: 100, unmappedOnly }, signal),
    });

    const controlQuery = useQuery({
        queryKey: ['zkteco', 'control'],
        queryFn: ({ signal }) => fetchZkControl(signal),
        enabled: controllable,
    });

    const mappingsQuery = useQuery({
        queryKey: ['zkteco', 'mappings'],
        queryFn: ({ signal }) => fetchZkMappings(signal),
    });

    const [coverageDays, setCoverageDays] = useState('14');
    const coverageQuery = useQuery({
        queryKey: ['zkteco', 'coverage', coverageDays],
        queryFn: ({ signal }) => fetchZkCoverage(Number(coverageDays), signal),
    });

    const monthStart = `${todayIso().slice(0, 7)}-01`;
    const [reconFrom, setReconFrom] = useState(monthStart);
    const [reconTo, setReconTo] = useState(todayIso());
    const [reconArmed, setReconArmed] = useState(false);
    const reconQuery = useQuery({
        queryKey: ['zkteco', 'reconciliation', reconFrom, reconTo],
        queryFn: ({ signal }) => fetchZkReconciliation({ from: reconFrom, to: reconTo }, signal),
        enabled: reconArmed && reconFrom !== '' && reconTo !== '',
    });

    const [punchTarget, setPunchTarget] = useState<{ row: ZkLogRow; ignore: boolean } | null>(null);
    const [punchReason, setPunchReason] = useState('');
    const [punchError, setPunchError] = useState('');

    const punchMutation = useWriteMutation<{ id: string; ignore: boolean }, { message: string }>({
        mutationFn: async ({ id, ignore }) => {
            const error = zkIgnoreReasonError(punchReason);
            if (error) {
                throw new Error(error);
            }
            const result = await toggleZkPunch(id, ignore, punchReason);
            return { message: result.message };
        },
        invalidate: [
            ['zkteco', 'logs'],
            ['zkteco', 'status'],
            ['zkteco', 'control'],
            ['zkteco', 'coverage'],
        ],
        silentError: true,
        onError: (cause) => setPunchError(writeErrorMessage(cause, 'تعذّر تصحيح البصمة')),
        onSuccess: (result) => {
            setPunchTarget(null);
            setPunchReason('');
            setPunchError('');
            toast({ title: 'حُفظ التصحيح', description: result.message, variant: 'success' });
        },
    });

    const [rebuildOpen, setRebuildOpen] = useState(false);
    const [rebuildEmployee, setRebuildEmployee] = useState('');
    const [rebuildFrom, setRebuildFrom] = useState(todayIso());
    const [rebuildTo, setRebuildTo] = useState(todayIso());
    const [rebuildReason, setRebuildReason] = useState('');
    const [rebuildError, setRebuildError] = useState('');

    const maxDays = Math.max(1, Math.round(num(controlQuery.data?.limits?.rebuildMaxDays) || 31));

    const rebuildMutation = useWriteMutation<void, { message: string }>({
        mutationFn: async () => {
            const errors = zkRebuildErrors(
                { employeeId: rebuildEmployee, from: rebuildFrom, to: rebuildTo, reason: rebuildReason },
                maxDays,
            );
            if (errors.length > 0) {
                throw new Error(errors[0]);
            }
            const result = await rebuildZkDays({
                employeeId: rebuildEmployee,
                from: rebuildFrom,
                to: rebuildTo,
                reason: rebuildReason,
            });
            return { message: result.message };
        },
        invalidate: [
            ['zkteco', 'status'],
            ['zkteco', 'logs'],
            ['zkteco', 'control'],
            ['zkteco', 'coverage'],
            ['zkteco', 'mappings'],
            ['hr', 'attendance'],
        ],
        silentError: true,
        onError: (cause) => setRebuildError(writeErrorMessage(cause, 'تعذّرت إعادة البناء')),
        onSuccess: (result) => {
            setRebuildOpen(false);
            setRebuildError('');
            setRebuildReason('');
            toast({ title: 'تمت إعادة البناء', description: result.message, variant: 'success' });
        },
    });

    const logs = logsQuery.data ?? [];
    const coverage = coverageQuery.data;
    const coverageProblems = coverage?.problems ?? [];
    const totals = controlQuery.data?.totals;
    const reconSummary = reconQuery.data?.summary;
    const employees = mappingsQuery.data?.employees ?? [];
    const rebuildSpan = zkDaySpan(rebuildFrom, rebuildTo);

    const submitRebuild = async (): Promise<void> => {
        const errors = zkRebuildErrors({ employeeId: rebuildEmployee, from: rebuildFrom, to: rebuildTo, reason: rebuildReason }, maxDays);
        if (errors.length > 0) {
            setRebuildError(errors[0] ?? '');
            return;
        }
        const answered = await confirm(
            `إعادة بناء حضور ${String(employees.find((row) => row.id === rebuildEmployee)?.name ?? 'الموظف')} من ${rebuildFrom} إلى ${rebuildTo}؟ الصفوف الناتجة عن البصمة فقط تُلمس.`,
        );
        if (!answered) {
            return;
        }
        setRebuildError('');
        rebuildMutation.mutate();
    };

    return (
        <>
            <SectionCard
                title="سجل البصمات الخام"
                english="Raw punches"
                actions={
                    <label className="flex items-center gap-xs text-body-sm text-ink">
                        <input type="checkbox" checked={unmappedOnly} onChange={(event) => setUnmappedOnly(event.target.checked)} />
                        غير المربوطة فقط
                    </label>
                }
            >
                {logsQuery.isPending ? (
                    <p className="text-body-sm text-muted" role="status">
                        جارٍ قراءة سجل البصمات…
                    </p>
                ) : logsQuery.isError ? (
                    <StateError
                        message={writeErrorMessage(logsQuery.error, 'تعذّر جلب سجل البصمات')}
                        onRetry={() => {
                            void logsQuery.refetch();
                        }}
                    />
                ) : logs.length === 0 ? (
                    <StateEmpty title="لا بصمات" hint="لا بصمات مطابقة لهذا الفلتر." />
                ) : (
                    <TableScroll label="جدول البصمات الخام">
                        <table className="w-full border-collapse text-body-md">
                            <thead>
                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الوقت
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الموظف
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        رقم البصمة
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الحركة
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الجهاز
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الحالة
                                    </th>
                                    {controllable ? (
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            إجراء
                                        </th>
                                    ) : null}
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((row) => {
                                    const ignored = row.ignored === true;
                                    return (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {timeText(row.attendanceTime) || '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">
                                                {String(row.employeeName ?? '') ||
                                                    (row.employeeId == null ? <span className="text-warning-text">بلا موظف</span> : '—')}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                {String(row.deviceUserId ?? '') || '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{zkPunchStateName(row.punchState)}</td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">{String(row.deviceName ?? '') || '—'}</td>
                                            <td className="px-sm py-xxs">
                                                {ignored ? (
                                                    <Badge variant="warning">{String(row.ignoredReason ?? '') || 'متجاهلة'}</Badge>
                                                ) : (
                                                    <Badge variant="success">مسجلة</Badge>
                                                )}
                                            </td>
                                            {controllable ? (
                                                <td className="px-sm py-xxs">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant={ignored ? 'ghost' : 'danger'}
                                                        onClick={() => {
                                                            setPunchError('');
                                                            setPunchReason('');
                                                            setPunchTarget({ row, ignore: !ignored });
                                                        }}
                                                    >
                                                        {ignored ? 'استعادة' : 'تجاهل'}
                                                    </Button>
                                                </td>
                                            ) : null}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </TableScroll>
                )}
            </SectionCard>

            {controllable ? (
                <SectionCard
                    title="مركز التحكم"
                    english="Control center"
                    actions={
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                setRebuildError('');
                                setRebuildOpen(true);
                            }}
                        >
                            إعادة بناء الأيام
                        </Button>
                    }
                >
                    {controlQuery.isError ? (
                        <StateError
                            message={writeErrorMessage(controlQuery.error, 'تعذّر جلب مركز التحكم')}
                            onRetry={() => {
                                void controlQuery.refetch();
                            }}
                        />
                    ) : (
                        <div className="flex flex-col gap-sm">
                            <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4">
                                <KpiCard
                                    label="بصمات اليوم"
                                    english="Today"
                                    value={intOf(num(totals?.today))}
                                    hint="من دفتر البصمات غير المتجاهَل"
                                />
                                <KpiCard
                                    label="بصمات بلا موظف"
                                    english="Unmapped"
                                    value={intOf(num(totals?.unmapped))}
                                    hint="أرقام تحتاج ربطًا بموظف"
                                />
                                <KpiCard
                                    label="أيام حضور مفتوحة"
                                    english="Open days"
                                    value={intOf(num(totals?.openDays))}
                                    hint="دخول بلا انصراف"
                                />
                                <KpiCard
                                    label="صفوف يدوية اليوم"
                                    english="Manual today"
                                    value={intOf(num(totals?.manualToday))}
                                    hint="أُدخلت خارج البصمة"
                                />
                            </ul>
                            {(controlQuery.data?.audit?.length ?? 0) === 0 ? (
                                <p className="text-body-sm text-muted" role="status">
                                    لا إجراءات تحكم مسجلة بعد.
                                </p>
                            ) : (
                                <TableScroll label="جدول إجراءات التحكم">
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الإجراء
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    المنفّذ
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    السبب
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الوقت
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(controlQuery.data?.audit ?? []).map((row) => (
                                                <tr key={row.id} className="border-b border-hairline">
                                                    <td className="px-sm py-xxs text-ink">{auditName(row.action)}</td>
                                                    <td className="px-sm py-xxs text-body-sm text-muted">
                                                        {String(row.actorName ?? '') || '—'}
                                                    </td>
                                                    <td className="px-sm py-xxs text-body-sm text-muted">
                                                        {String(row.reason ?? '') || '—'}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-caption text-faint" dir="ltr">
                                                        {timeText(row.createdAt) || '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                        </div>
                    )}
                </SectionCard>
            ) : null}

            <SectionCard
                title="تغطية الربط والتشخيص"
                english="Coverage"
                actions={
                    <Select
                        label="الفترة"
                        options={[
                            { value: '7', label: '7 أيام' },
                            { value: '14', label: '14 يومًا' },
                            { value: '30', label: '30 يومًا' },
                        ]}
                        value={coverageDays}
                        onValueChange={(value) => setCoverageDays(value)}
                        containerClassName="w-36"
                    />
                }
            >
                {coverageQuery.isError ? (
                    <StateError
                        message={writeErrorMessage(coverageQuery.error, 'تعذّر جلب التغطية')}
                        onRetry={() => {
                            void coverageQuery.refetch();
                        }}
                    />
                ) : coverage ? (
                    <div className="flex flex-col gap-sm">
                        <p className="text-body-sm text-muted" role="status">
                            {`${intOf(num(coverage.summary?.total_employees))} موظفًا · سليم ${intOf(num(coverage.summary?.ok))} · مشاكل ${intOf(num(coverage.summary?.problems))} · بوجه مسجل ${intOf(num(coverage.summary?.face_enrolled))}`}
                        </p>
                        {coverageProblems.length === 0 ? (
                            <p className="text-body-sm text-success-text" role="status">
                                لا مشاكل ربط في هذه الفترة.
                            </p>
                        ) : (
                            <TableScroll label="جدول مشاكل التغطية">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الموظف
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                التشخيص
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الإجراء المقترح
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                آخر بصمة
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {coverageProblems.slice(0, 25).map((row) => (
                                            <tr key={String(row.id)} className="border-b border-hairline">
                                                <td className="px-sm py-xxs text-ink">
                                                    {String(row.name ?? '')}
                                                    <span className="erp-numeric ms-xs text-caption text-faint" dir="ltr">
                                                        {String(row.employeeId ?? '')}
                                                    </span>
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm text-warning-text">
                                                    {String(row.diagnosis ?? '')}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">{String(row.action ?? '') || '—'}</td>
                                                <td className="erp-numeric px-sm py-xxs text-caption text-faint" dir="ltr">
                                                    {timeText(row.last_punch) || '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </div>
                ) : (
                    <p className="text-body-sm text-muted" role="status">
                        جارٍ قراءة التغطية…
                    </p>
                )}
            </SectionCard>

            <SectionCard title="مطابقة الجهاز بالنظام" english="Reconciliation">
                <div className="flex flex-wrap items-end gap-sm">
                    <Input
                        label="من"
                        type="date"
                        value={reconFrom}
                        onChange={(event) => {
                            setReconFrom(event.target.value);
                            setReconArmed(false);
                        }}
                    />
                    <Input
                        label="إلى"
                        type="date"
                        value={reconTo}
                        onChange={(event) => {
                            setReconTo(event.target.value);
                            setReconArmed(false);
                        }}
                    />
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={reconQuery.isFetching || reconFrom === '' || reconTo === ''}
                        onClick={() => {
                            if (reconArmed) {
                                void reconQuery.refetch();
                            } else {
                                setReconArmed(true);
                            }
                        }}
                    >
                        {reconQuery.isFetching ? 'جارٍ المطابقة…' : 'تشغيل المطابقة'}
                    </Button>
                </div>
                {reconQuery.isError ? (
                    <p role="alert" className="mt-sm text-body-sm text-danger-text">
                        {writeErrorMessage(reconQuery.error, 'تعذّرت المطابقة')}
                    </p>
                ) : reconSummary ? (
                    <div className="mt-sm flex flex-col gap-sm">
                        <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4">
                            <KpiCard
                                label="بصمات الجهاز"
                                english="Device punches"
                                value={intOf(num(reconSummary.device_punches))}
                                hint="في المدى المختار"
                            />
                            <KpiCard label="مطابقة" english="Matched" value={intOf(num(reconSummary.matched))} hint="لها صف حضور" />
                            <KpiCard
                                label="فجوات حقيقية"
                                english="Real gaps"
                                value={intOf(num(reconSummary.real_gaps))}
                                hint="بصمات لم تُكتب"
                                tone={num(reconSummary.real_gaps) > 0 ? 'warning' : 'success'}
                            />
                            <KpiCard
                                label="بلا موظف"
                                english="Unmapped"
                                value={intOf(num(reconSummary.unmapped_punches))}
                                hint="رقم غير مربوط"
                            />
                        </ul>
                        {reconQuery.data?.coverage?.note ? (
                            <p className="text-caption text-muted" role="status">
                                {String(reconQuery.data.coverage.note)}
                            </p>
                        ) : null}
                    </div>
                ) : (
                    <p className="mt-sm text-body-sm text-muted" role="status">
                        اختر المدى ثم شغّل المطابقة — قراءة فقط، لا تعديل.
                    </p>
                )}
            </SectionCard>

            <Dialog
                open={punchTarget !== null}
                onOpenChange={(next) => {
                    if (!next && punchMutation.isPending) {
                        return;
                    }
                    if (!next) {
                        setPunchTarget(null);
                    }
                }}
                title={punchTarget?.ignore ? 'تجاهل بصمة' : 'استعادة بصمة'}
                {...(punchTarget
                    ? {
                          description: `${timeText(punchTarget.row.attendanceTime)} · ${String(
                              punchTarget.row.employeeName ?? 'بلا موظف',
                          )}`,
                      }
                    : {})}
                size="sm"
                footer={
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setPunchTarget(null)}>
                            إغلاق
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant={punchTarget?.ignore ? 'danger' : 'secondary'}
                            disabled={punchMutation.isPending}
                            onClick={() => {
                                if (punchTarget) {
                                    setPunchError('');
                                    punchMutation.mutate({ id: punchTarget.row.id, ignore: punchTarget.ignore });
                                }
                            }}
                        >
                            {punchMutation.isPending ? 'جارٍ الحفظ…' : punchTarget?.ignore ? 'تجاهل' : 'استعادة'}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <p className="text-body-sm text-muted">
                        البصمة لا تُحذف — تُعلَّم فقط وتُستثنى من بناء الحضور. بعدها أعد بناء يومها من «إعادة بناء الأيام».
                    </p>
                    <Input
                        label="سبب التصحيح"
                        value={punchReason}
                        maxLength={200}
                        placeholder="مثال: ساعة الجهاز كانت منحرفة"
                        onChange={(event) => setPunchReason(event.target.value)}
                    />
                    {punchError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {punchError}
                        </p>
                    ) : null}
                </div>
            </Dialog>

            <Dialog
                open={rebuildOpen}
                onOpenChange={(next) => {
                    if (!next && rebuildMutation.isPending) {
                        return;
                    }
                    setRebuildOpen(next);
                }}
                title="إعادة بناء الأيام من البصمات"
                description={`يزيل صفوف الحضور الناتجة عن البصمة في المدى ويعيد تشغيل بصماته. أقصى مدى ${String(maxDays)} يومًا.`}
                size="md"
                footer={
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setRebuildOpen(false)}>
                            إغلاق
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={rebuildMutation.isPending}
                            onClick={() => {
                                void submitRebuild();
                            }}
                        >
                            {rebuildMutation.isPending ? 'جارٍ البناء…' : 'إعادة البناء'}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <Select
                        label="الموظف"
                        options={employees.map((row) => ({
                            value: row.id,
                            label: `${String(row.name ?? '')} · ${String(row.employeeId ?? '')}`,
                        }))}
                        value={rebuildEmployee}
                        onValueChange={(value) => setRebuildEmployee(value)}
                    />
                    <div className="grid grid-cols-2 gap-sm">
                        <Input label="من" type="date" value={rebuildFrom} onChange={(event) => setRebuildFrom(event.target.value)} />
                        <Input label="إلى" type="date" value={rebuildTo} onChange={(event) => setRebuildTo(event.target.value)} />
                    </div>
                    {rebuildSpan !== null && rebuildSpan > 0 ? (
                        <p className="text-caption text-muted" role="status">
                            {`المدى ${intOf(rebuildSpan)} يومًا`}
                        </p>
                    ) : null}
                    <Input
                        label="سبب إعادة البناء"
                        value={rebuildReason}
                        maxLength={500}
                        placeholder="مثال: تصحيح بصمة متجاهلة في يوم 2026-11-09"
                        onChange={(event) => setRebuildReason(event.target.value)}
                    />
                    {rebuildError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {rebuildError}
                        </p>
                    ) : null}
                </div>
            </Dialog>
        </>
    );
}
