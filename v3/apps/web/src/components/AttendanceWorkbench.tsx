import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AttendanceRecord } from '../lib/attendance';
import {
    ATT_WRITE_TEXT,
    attendanceMonthError,
    auditNote,
    buildAttendanceCreate,
    buildExcusePayload,
    buildPunchPayload,
    calcPunchTimes,
    canWriteAttendance,
    createApprovedLeave,
    createAttendance,
    fetchAttendanceAudit,
    fetchMonthlyAttendance,
    fetchStrictAudit,
    fetchWorkStartHour,
    joinNotes,
    minutesToHM,
    shiftStartFor,
    updateAttendance,
    validatePunchForm,
    validateReason,
} from '../lib/attendance-write';
import { useAuthState } from '../lib/auth';
import type { Employee } from '../lib/employees';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';

/**
 * كتابة الحضور — الأفعال التي كانت في V2 وحده: تصحيح بصمة، تعبئة ناقصة،
 * عذر إداري/معتمد/تبديل، سجل التدقيق، التدقيق الصارم، والكشف الشهري.
 *
 * كل الحساب على الخادم؛ الواجهة ترسل البصمة والسبب فقط، وتقرأ النتائج كما
 * وردت. سطر التدقيق في `notes` يُلاحَق ولا يُستبدل، والسبب إجباري دائمًا.
 */

/** مفاتيح الاستعلامات التي تتأثر بأي كتابة حضور. */
const ATTENDANCE_KEYS = [['attendance-range'], ['attendance-today'], ['attendance-leaves'], ['attendance-audit']] as const;

function employeeOptions(employees: readonly Employee[]): { value: string; label: string }[] {
    return employees
        .filter((employee) => employee.status === 'active')
        .map((employee) => ({ value: String(employee.id), label: String(employee.name || `#${employee.id}`) }));
}

function useWorkStartHour() {
    return useQuery({
        queryKey: ['work-start-hour'],
        queryFn: ({ signal }) => fetchWorkStartHour(signal),
        staleTime: 5 * 60_000,
    });
}

/* ─── تصحيح بصمة ────────────────────────────────────────────────────────── */

export function AttendanceCorrectButton({ record, employee }: { record: AttendanceRecord; employee: Employee | undefined }) {
    const auth = useAuthState();
    const writable = canWriteAttendance(auth.user?.role);
    const { toast } = useToast();
    const workStart = useWorkStartHour();
    const [open, setOpen] = useState(false);
    const [checkIn, setCheckIn] = useState(record.checkIn ?? '');
    const [checkOut, setCheckOut] = useState(record.checkOut ?? '');
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');

    const mutation = useWriteMutation<void, void>({
        mutationFn: async () => {
            const punch = validatePunchForm({ checkIn, checkOut, reason, reasonLabel: 'اكتب سبب التصحيح' });
            if (!punch.ok) {
                throw new Error(punch.message);
            }
            const hour = workStart.data?.hour ?? 9;
            const calc = calcPunchTimes({
                checkIn: punch.checkIn,
                checkOut: punch.checkOut,
                shiftStart: shiftStartFor(employee, hour),
                keepLate: true,
            });
            const late = punch.checkIn ? calc.late : record.late;
            await updateAttendance(
                record.id,
                buildPunchPayload({
                    checkIn: punch.checkIn,
                    checkOut: punch.checkOut,
                    workMinutes: punch.checkIn && punch.checkOut ? calc.workMinutes : record.workMinutes,
                    late,
                    notes: joinNotes(
                        record.notes,
                        auditNote('correct', {
                            who: auth.user?.name ?? '',
                            reason: punch.reason,
                            date: record.date,
                        }),
                    ),
                }),
            );
        },
        invalidate: ATTENDANCE_KEYS,
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, ATT_WRITE_TEXT.saveFailed)),
        onSuccess: () => {
            toast({ title: ATT_WRITE_TEXT.saved, variant: 'success' });
            setOpen(false);
            setReason('');
            setError('');
        },
    });

    if (!writable) {
        return null;
    }

    return (
        <>
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
                {ATT_WRITE_TEXT.correct}
            </Button>
            <Dialog
                open={open}
                onOpenChange={setOpen}
                title={`${ATT_WRITE_TEXT.correctTitle} — ${employee?.name ?? `#${record.employeeId ?? ''}`}`}
                description={`${record.date} · ${ATT_WRITE_TEXT.correctHint}`}
                size="sm"
                footer={
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
                            {ATT_WRITE_TEXT.close}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={mutation.isPending}
                            onClick={() => {
                                setError('');
                                mutation.mutate();
                            }}
                        >
                            {mutation.isPending ? ATT_WRITE_TEXT.saving : ATT_WRITE_TEXT.save}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <div className="grid grid-cols-2 gap-sm">
                        <Input
                            label={`${ATT_WRITE_TEXT.checkIn}${record.checkIn ? '' : ' (ناقصة)'}`}
                            type="time"
                            value={checkIn}
                            onChange={(event) => setCheckIn(event.target.value)}
                        />
                        <Input
                            label={`${ATT_WRITE_TEXT.checkOut}${record.checkOut ? '' : ' (ناقصة)'}`}
                            type="time"
                            value={checkOut}
                            onChange={(event) => setCheckOut(event.target.value)}
                        />
                    </div>
                    <Input
                        label={ATT_WRITE_TEXT.reason}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder={ATT_WRITE_TEXT.reasonPlaceholder}
                    />
                    {workStart.data && !workStart.data.ok ? (
                        <p className="text-caption text-warning-text" role="status">
                            تعذّرت قراءة ساعة بدء العمل — الحساب على 09:00.
                        </p>
                    ) : null}
                    {error ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {error}
                        </p>
                    ) : null}
                </div>
            </Dialog>
        </>
    );
}

/* ─── معالجة استثناء اليوم (تعبئة/عذر/تبديل) ────────────────────────────── */

export function AttendanceResolveButton({
    employees,
    employee,
    date,
    record,
}: {
    employees: readonly Employee[];
    employee: Employee;
    date: string;
    record: AttendanceRecord | null;
}) {
    const auth = useAuthState();
    const writable = canWriteAttendance(auth.user?.role);
    const { toast } = useToast();
    const workStart = useWorkStartHour();
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState<'fill' | 'excuse' | 'swap'>('fill');
    const [checkIn, setCheckIn] = useState(record?.checkIn ?? '');
    const [checkOut, setCheckOut] = useState(record?.checkOut ?? '');
    const [withId, setWithId] = useState('');
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');

    const mutation = useWriteMutation<void, void>({
        mutationFn: async () => {
            const checked = validateReason(reason);
            if (!checked.ok) {
                throw new Error(checked.message);
            }
            if (kind === 'fill') {
                const punch = validatePunchForm({ checkIn, checkOut, reason });
                if (!punch.ok) {
                    throw new Error(punch.message);
                }
                const hour = workStart.data?.hour ?? 9;
                const calc = calcPunchTimes({
                    checkIn: punch.checkIn,
                    checkOut: punch.checkOut,
                    shiftStart: shiftStartFor(employee, hour),
                });
                const note = auditNote('fill', { who: auth.user?.name ?? '', reason: punch.reason, date });
                if (record) {
                    await updateAttendance(
                        record.id,
                        buildPunchPayload({
                            checkIn: punch.checkIn,
                            checkOut: punch.checkOut,
                            workMinutes: calc.workMinutes,
                            late: calc.late,
                            notes: joinNotes(record.notes, note),
                        }),
                    );
                } else {
                    await createAttendance(
                        buildAttendanceCreate({
                            employeeId: employee.id,
                            date,
                            checkIn: punch.checkIn,
                            checkOut: punch.checkOut,
                            workMinutes: calc.workMinutes,
                            late: calc.late,
                            notes: note,
                        }),
                    );
                }
                return;
            }
            if (kind === 'excuse') {
                await createApprovedLeave(
                    buildExcusePayload({
                        employeeId: employee.id,
                        date,
                        reason: checked.reason,
                        kind: 'approved',
                        userId: auth.user?.id ?? null,
                    }),
                );
                return;
            }
            const other = employees.find((entry) => String(entry.id) === withId);
            if (!other) {
                throw new Error('اختر الموظف البديل');
            }
            await createApprovedLeave(
                buildExcusePayload({
                    employeeId: employee.id,
                    date,
                    reason: checked.reason,
                    kind: 'swap',
                    withName: String(other.name || other.id),
                    userId: auth.user?.id ?? null,
                }),
            );
            if (record) {
                await updateAttendance(
                    record.id,
                    buildPunchPayload({
                        checkIn: record.checkIn ?? '',
                        checkOut: record.checkOut ?? '',
                        workMinutes: record.workMinutes,
                        late: record.late,
                        notes: joinNotes(
                            record.notes,
                            auditNote('swap', {
                                who: auth.user?.name ?? '',
                                reason: checked.reason,
                                date,
                                withName: String(other.name || other.id),
                            }),
                        ),
                    }),
                );
            }
        },
        invalidate: ATTENDANCE_KEYS,
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, ATT_WRITE_TEXT.saveFailed)),
        onSuccess: () => {
            toast({ title: ATT_WRITE_TEXT.saved, variant: 'success' });
            setOpen(false);
            setReason('');
            setError('');
        },
    });

    if (!writable) {
        return null;
    }

    return (
        <>
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
                {ATT_WRITE_TEXT.resolve}
            </Button>
            <Dialog
                open={open}
                onOpenChange={setOpen}
                title={`${ATT_WRITE_TEXT.resolveTitle} — ${employee.name}`}
                description={`${date} · ${ATT_WRITE_TEXT.resolveHint}`}
                size="sm"
                footer={
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
                            {ATT_WRITE_TEXT.close}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={mutation.isPending}
                            onClick={() => {
                                setError('');
                                mutation.mutate();
                            }}
                        >
                            {mutation.isPending ? ATT_WRITE_TEXT.saving : ATT_WRITE_TEXT.save}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <Select
                        label="نوع المعالجة"
                        value={kind}
                        onValueChange={(value) => setKind(value as 'fill' | 'excuse' | 'swap')}
                        options={[
                            { value: 'fill', label: ATT_WRITE_TEXT.fill },
                            { value: 'excuse', label: ATT_WRITE_TEXT.excuseKind },
                            { value: 'swap', label: ATT_WRITE_TEXT.swap },
                        ]}
                    />
                    <p className="text-body-sm text-muted">
                        الحالي: حضور{' '}
                        <b className="erp-numeric" dir="ltr">
                            {record?.checkIn ?? '—'}
                        </b>{' '}
                        · انصراف{' '}
                        <b className="erp-numeric" dir="ltr">
                            {record?.checkOut ?? '—'}
                        </b>
                    </p>
                    {kind === 'fill' ? (
                        <div className="grid grid-cols-2 gap-sm">
                            <Input
                                label={ATT_WRITE_TEXT.checkIn}
                                type="time"
                                value={checkIn}
                                onChange={(event) => setCheckIn(event.target.value)}
                            />
                            <Input
                                label={ATT_WRITE_TEXT.checkOut}
                                type="time"
                                value={checkOut}
                                onChange={(event) => setCheckOut(event.target.value)}
                            />
                        </div>
                    ) : null}
                    {kind === 'swap' ? (
                        <Select
                            label={ATT_WRITE_TEXT.withEmployee}
                            {...(withId ? { value: withId } : {})}
                            onValueChange={setWithId}
                            placeholder="اختر…"
                            options={employeeOptions(employees).filter((option) => option.value !== String(employee.id))}
                        />
                    ) : null}
                    <Input
                        label={ATT_WRITE_TEXT.reason}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder={ATT_WRITE_TEXT.reasonPlaceholder}
                    />
                    {error ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {error}
                        </p>
                    ) : null}
                </div>
            </Dialog>
        </>
    );
}

/* ─── شريط الأدوات وسجل التدقيق والتقارير ───────────────────────────────── */

export function AttendanceWorkbench({ employees, todayStr }: { employees: readonly Employee[]; todayStr: string }) {
    const auth = useAuthState();
    const writable = canWriteAttendance(auth.user?.role);
    const { toast } = useToast();
    const [panel, setPanel] = useState<'none' | 'audit' | 'strict' | 'monthly' | 'excuse'>('none');
    const [reason, setReason] = useState('');
    const [targetId, setTargetId] = useState('');
    const [date, setDate] = useState(todayStr);
    const [error, setError] = useState('');
    const [auditFrom, setAuditFrom] = useState('');
    const [auditTo, setAuditTo] = useState('');
    const [auditAction, setAuditAction] = useState('');
    const [month, setMonth] = useState(todayStr.slice(0, 7));

    const options = employeeOptions(employees);

    const excuseMutation = useWriteMutation<void, void>({
        mutationFn: async () => {
            if (!targetId) {
                throw new Error('حدّد الموظف');
            }
            const checked = validateReason(reason, 'اكتب سبب العذر');
            if (!checked.ok) {
                throw new Error(checked.message);
            }
            await createApprovedLeave(
                buildExcusePayload({
                    employeeId: targetId,
                    date,
                    reason: checked.reason,
                    kind: 'admin',
                    userId: auth.user?.id ?? null,
                }),
            );
        },
        invalidate: ATTENDANCE_KEYS,
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, ATT_WRITE_TEXT.saveFailed)),
        onSuccess: () => {
            toast({ title: ATT_WRITE_TEXT.saved, variant: 'success' });
            setPanel('none');
            setReason('');
            setError('');
        },
    });

    const auditQuery = useQuery({
        queryKey: ['attendance-audit', auditFrom, auditTo, auditAction],
        queryFn: ({ signal }) => fetchAttendanceAudit({ from: auditFrom, to: auditTo, action: auditAction, signal }),
        enabled: panel === 'audit',
    });

    const strictQuery = useQuery({
        queryKey: ['attendance-strict-audit', month],
        queryFn: ({ signal }) => fetchStrictAudit(month, signal),
        enabled: panel === 'strict' && !attendanceMonthError(month),
    });

    const monthlyQuery = useQuery({
        queryKey: ['attendance-monthly', month],
        queryFn: ({ signal }) => fetchMonthlyAttendance(month, signal),
        enabled: panel === 'monthly' && !attendanceMonthError(month),
    });

    if (!writable) {
        return null;
    }

    return (
        <>
            <div className="flex flex-wrap items-center gap-xs" data-erp-print-hide>
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                        setError('');
                        setPanel('excuse');
                    }}
                >
                    {ATT_WRITE_TEXT.excuse}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setPanel('audit')}>
                    {ATT_WRITE_TEXT.audit}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setPanel('strict')}>
                    {ATT_WRITE_TEXT.strict}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setPanel('monthly')}>
                    {ATT_WRITE_TEXT.monthly}
                </Button>
            </div>

            <Dialog
                open={panel === 'excuse'}
                onOpenChange={(open) => setPanel(open ? 'excuse' : 'none')}
                title={ATT_WRITE_TEXT.excuseTitle}
                description={ATT_WRITE_TEXT.excuseHint}
                size="sm"
                footer={
                    <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setPanel('none')}>
                            {ATT_WRITE_TEXT.close}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={excuseMutation.isPending}
                            onClick={() => {
                                setError('');
                                excuseMutation.mutate();
                            }}
                        >
                            {excuseMutation.isPending ? ATT_WRITE_TEXT.saving : ATT_WRITE_TEXT.save}
                        </Button>
                    </>
                }
            >
                <div className="flex flex-col gap-sm">
                    <Select
                        label={ATT_WRITE_TEXT.employee}
                        {...(targetId ? { value: targetId } : {})}
                        onValueChange={setTargetId}
                        placeholder="اختر…"
                        options={options}
                    />
                    <Input label={ATT_WRITE_TEXT.date} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                    <Input
                        label={ATT_WRITE_TEXT.reason}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder={ATT_WRITE_TEXT.reasonPlaceholder}
                    />
                    {error ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {error}
                        </p>
                    ) : null}
                </div>
            </Dialog>

            <Dialog
                open={panel === 'audit'}
                onOpenChange={(open) => setPanel(open ? 'audit' : 'none')}
                title={ATT_WRITE_TEXT.auditTitle}
                description={ATT_WRITE_TEXT.auditHint}
                size="lg"
                footer={
                    <Button type="button" variant="secondary" size="sm" onClick={() => setPanel('none')}>
                        {ATT_WRITE_TEXT.close}
                    </Button>
                }
            >
                <div className="flex flex-col gap-sm">
                    <div className="grid gap-sm sm:grid-cols-3">
                        <Input label="من" type="date" value={auditFrom} onChange={(event) => setAuditFrom(event.target.value)} />
                        <Input label="إلى" type="date" value={auditTo} onChange={(event) => setAuditTo(event.target.value)} />
                        <Select
                            label="الفعل"
                            {...(auditAction ? { value: auditAction } : {})}
                            onValueChange={(value) => setAuditAction(value === 'all' ? '' : value)}
                            placeholder="الكل"
                            options={[
                                { value: 'all', label: 'الكل' },
                                { value: 'create', label: 'إضافة' },
                                { value: 'update', label: 'تصحيح' },
                                { value: 'delete', label: 'حذف' },
                            ]}
                        />
                    </div>
                    {auditQuery.isPending ? <p className="text-body-sm text-muted">جارٍ التحميل…</p> : null}
                    {auditQuery.isError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {writeErrorMessage(auditQuery.error, ATT_WRITE_TEXT.loadFailed)}
                        </p>
                    ) : null}
                    {auditQuery.data ? (
                        auditQuery.data.rows.length ? (
                            <>
                                <p className="text-body-sm text-muted">
                                    {new Intl.NumberFormat('en-US').format(auditQuery.data.total)} سطرًا — يعرض{' '}
                                    {new Intl.NumberFormat('en-US').format(auditQuery.data.rows.length)}.
                                </p>
                                <div className="max-h-96 overflow-auto rounded-md border border-hairline">
                                    <table className="w-full border-collapse text-body-sm">
                                        <thead className="sticky top-0 bg-surface-sunken text-label-md text-ink-secondary">
                                            <tr>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    الموظف
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    الفعل
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    التغيير
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    السبب
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    بواسطة
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    التوقيت
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {auditQuery.data.rows.map((row) => (
                                                <tr key={row.id} className="border-b border-hairline">
                                                    <td className="px-sm py-xxs text-ink">
                                                        {row.employeeName}
                                                        <small className="block text-caption text-muted" dir="ltr">
                                                            {row.employeeNo}
                                                        </small>
                                                    </td>
                                                    <td className="px-sm py-xxs text-ink">{row.actionAr}</td>
                                                    <td className="px-sm py-xxs text-muted">
                                                        {row.fields.length
                                                            ? row.fields.map((field) => (
                                                                  <span key={field.field} className="block" dir="ltr">
                                                                      {field.field}: {field.before} ← {field.after}
                                                                  </span>
                                                              ))
                                                            : '—'}
                                                    </td>
                                                    <td className="px-sm py-xxs text-muted">{row.reason || '—'}</td>
                                                    <td className="px-sm py-xxs text-ink">
                                                        {row.actorName}
                                                        <small className="block text-caption text-muted">{row.actorRole}</small>
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                        {row.at}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        ) : (
                            <p className="text-body-sm text-muted">{ATT_WRITE_TEXT.noAudit}</p>
                        )
                    ) : null}
                </div>
            </Dialog>

            <Dialog
                open={panel === 'strict'}
                onOpenChange={(open) => setPanel(open ? 'strict' : 'none')}
                title={ATT_WRITE_TEXT.strictTitle}
                description={ATT_WRITE_TEXT.strictHint}
                size="lg"
                footer={
                    <Button type="button" variant="secondary" size="sm" onClick={() => setPanel('none')}>
                        {ATT_WRITE_TEXT.close}
                    </Button>
                }
            >
                <div className="flex flex-col gap-sm">
                    <Input label="الشهر" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
                    {attendanceMonthError(month) ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {attendanceMonthError(month)}
                        </p>
                    ) : null}
                    {strictQuery.isPending ? <p className="text-body-sm text-muted">جارٍ الفحص…</p> : null}
                    {strictQuery.isError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {writeErrorMessage(strictQuery.error, ATT_WRITE_TEXT.loadFailed)}
                        </p>
                    ) : null}
                    {strictQuery.data ? (
                        <>
                            <p className="text-body-sm text-muted">
                                النتيجة: {strictQuery.data.ok ? 'معتمد' : 'يحتاج مراجعة'} — سليم {strictQuery.data.counts.PASS} · تنبيه{' '}
                                {strictQuery.data.counts.WARN} · فشل {strictQuery.data.counts.FAIL}
                            </p>
                            {strictQuery.data.checks.length ? (
                                <ul className="flex list-none flex-col gap-xs">
                                    {strictQuery.data.checks.map((check) => (
                                        <li key={check.name} className="rounded-md border border-hairline bg-surface p-sm text-body-sm">
                                            <div className="flex flex-wrap items-center justify-between gap-xs">
                                                <b className="text-ink">{check.name}</b>
                                                <span
                                                    className={
                                                        check.tone === 'success'
                                                            ? 'text-success-text'
                                                            : check.tone === 'danger'
                                                              ? 'text-danger-text'
                                                              : check.tone === 'warning'
                                                                ? 'text-warning-text'
                                                                : 'text-muted'
                                                    }
                                                >
                                                    {check.statusAr} · {check.count}
                                                </span>
                                            </div>
                                            {check.details.length ? (
                                                <details className="mt-xxs">
                                                    <summary className="cursor-pointer text-caption text-muted">
                                                        عرض التفصيل ({check.details.length})
                                                    </summary>
                                                    <ul className="mt-xxs flex list-none flex-col gap-xxs text-caption text-muted">
                                                        {check.details.map((detail) => (
                                                            <li key={`${check.name}-${detail.emp}`} dir="ltr">
                                                                {detail.emp}
                                                                {detail.lateDays !== null ? ` · late ${detail.lateDays}` : ''}
                                                                {detail.days !== null ? ` · days ${detail.days}` : ''}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </details>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-body-sm text-muted">{ATT_WRITE_TEXT.noChecks}</p>
                            )}
                        </>
                    ) : null}
                </div>
            </Dialog>

            <Dialog
                open={panel === 'monthly'}
                onOpenChange={(open) => setPanel(open ? 'monthly' : 'none')}
                title={ATT_WRITE_TEXT.monthlyTitle}
                description={ATT_WRITE_TEXT.monthlyHint}
                size="lg"
                footer={
                    <Button type="button" variant="secondary" size="sm" onClick={() => setPanel('none')}>
                        {ATT_WRITE_TEXT.close}
                    </Button>
                }
            >
                <div className="flex flex-col gap-sm">
                    <Input label="الشهر" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
                    {attendanceMonthError(month) ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {attendanceMonthError(month)}
                        </p>
                    ) : null}
                    {monthlyQuery.isPending ? <p className="text-body-sm text-muted">جارٍ التحميل…</p> : null}
                    {monthlyQuery.isError ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {writeErrorMessage(monthlyQuery.error, ATT_WRITE_TEXT.loadFailed)}
                        </p>
                    ) : null}
                    {monthlyQuery.data ? (
                        monthlyQuery.data.rows.length ? (
                            <>
                                <p className="text-body-sm text-muted">
                                    {new Intl.NumberFormat('en-US').format(monthlyQuery.data.employees)} موظفًا · يوم العمل{' '}
                                    {minutesToHM(monthlyQuery.data.workDayMinutes)} · إجمالي العجز{' '}
                                    {minutesToHM(monthlyQuery.data.totals.deficitMinutes)}
                                </p>
                                <div className="max-h-96 overflow-auto rounded-md border border-hairline">
                                    <table className="w-full border-collapse text-body-sm">
                                        <thead className="sticky top-0 bg-surface-sunken text-label-md text-ink-secondary">
                                            <tr>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    الموظف
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    القسم
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    حضور
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    أيام كاملة
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    أيام ناقصة
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    العجز
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    إجازات
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start">
                                                    للمراجعة
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {monthlyQuery.data.rows.map((row) => (
                                                <tr key={row.id} className="border-b border-hairline">
                                                    <td className="px-sm py-xxs text-ink">{row.name}</td>
                                                    <td className="px-sm py-xxs text-muted">{row.department}</td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {row.present}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-success-text" dir="ltr">
                                                        {row.completeWorkDays}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-warning-text" dir="ltr">
                                                        {row.shortDays}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                        {minutesToHM(row.deficitMinutes)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {row.leaveDays}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                        {row.reviewDays}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        ) : (
                            <p className="text-body-sm text-muted">{ATT_WRITE_TEXT.noMonthly}</p>
                        )
                    ) : null}
                </div>
            </Dialog>
        </>
    );
}
