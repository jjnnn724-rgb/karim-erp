import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { fetchAttendanceRange } from '../lib/attendance';
import {
    auditNote,
    buildAttendanceCreate,
    buildPunchPayload,
    calcPunchTimes,
    canWriteAttendance,
    createAttendance,
    fetchWorkStartHour,
    joinNotes,
    shiftStartFor,
    updateAttendance,
    validatePunchForm,
} from '../lib/attendance-write';
import { useAuthState } from '../lib/auth';
import { fetchEmployees } from '../lib/employees';
import { todayIso } from '../lib/reporting';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FIX_KEYS = [['attendance-range'], ['attendance-today'], ['attendance-fix-day']] as const;

/**
 * تصحيح أي بصمة لأي موظف في أي يوم — لوحة المالك (admin|owner).
 * «أي تاريخ» يعني أب أي بصمة في أي شهر تبحث عنها وتصححها هنا:
 *  • لو فيه سجل للموظف في اليوم ده → تعديله (cause إجباري + تدقيق).
 *  • لو مفيش → إنشاء سجل جديد لهذا اليوم (بصمة تعبئة).
 * لا تُمحى البصمة الأصل ولا السبب السابق — يُلاحَق بسطر تدقيق يحمل التاريخ والمنفّذ.
 */
export function AttendanceFixPanel() {
    const auth = useAuthState();
    const writable = canWriteAttendance(auth.user?.role);
    const { toast } = useToast();
    const employeesQuery = useQuery({
        queryKey: ['attendance-employees'],
        queryFn: ({ signal }) => fetchEmployees(signal),
    });
    const workStart = useQuery({
        queryKey: ['work-start-hour'],
        queryFn: ({ signal }) => fetchWorkStartHour(signal),
        staleTime: 5 * 60_000,
    });

    const [employeeId, setEmployeeId] = useState('');
    const [date, setDate] = useState(() => todayIso());
    const [checkIn, setCheckIn] = useState('');
    const [checkOut, setCheckOut] = useState('');
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');

    const dayValid = DATE_RE.test(date);
    const dayQuery = useQuery({
        queryKey: ['attendance-fix-day', date],
        queryFn: ({ signal }) => fetchAttendanceRange({ from: date, to: date, limit: 2000, signal }),
        enabled: dayValid,
    });
    const record = dayQuery.data?.rows.find((row) => String(row.employeeId ?? '') === employeeId) ?? null;
    const selectedEmployee = (employeesQuery.data ?? []).find((employee) => String(employee.id) === employeeId);

    // مزامنة الحقول مع السجل المخزَّن عند تغيير الموظف/التاريخ
    useEffect(() => {
        setCheckIn(record?.checkIn ?? '');
        setCheckOut(record?.checkOut ?? '');
        setReason('');
        setError('');
    }, [record?.id, employeeId, date]); // eslint-disable-line react-hooks/exhaustive-deps

    const mutation = useWriteMutation<void, void>({
        mutationFn: async () => {
            const punch = validatePunchForm({ checkIn, checkOut, reason, reasonLabel: 'اكتب سبب التصحيح' });
            if (!punch.ok) {
                throw new Error(punch.message);
            }
            if (!employeeId) {
                throw new Error('حدّد الموظف');
            }
            const hour = workStart.data?.hour ?? 9;
            const calc = calcPunchTimes({
                checkIn: punch.checkIn,
                checkOut: punch.checkOut,
                shiftStart: shiftStartFor(selectedEmployee, hour),
                keepLate: Boolean(record),
            });
            const who = auth.user?.name ?? '';
            if (record) {
                const late = punch.checkIn ? calc.late : record.late;
                await updateAttendance(
                    record.id,
                    buildPunchPayload({
                        checkIn: punch.checkIn,
                        checkOut: punch.checkOut,
                        workMinutes: punch.checkIn && punch.checkOut ? calc.workMinutes : record.workMinutes,
                        late,
                        notes: joinNotes(record.notes, auditNote('correct', { who, reason: punch.reason, date })),
                    }),
                );
                return;
            }
            await createAttendance(
                buildAttendanceCreate({
                    employeeId,
                    date,
                    checkIn: punch.checkIn,
                    checkOut: punch.checkOut,
                    workMinutes: calc.workMinutes,
                    late: punch.checkIn ? calc.late : false,
                    notes: auditNote('fill', { who, reason: punch.reason, date }),
                }),
            );
        },
        invalidate: FIX_KEYS,
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, 'تعذر حفظ التصحيح')),
        onSuccess: () => {
            toast({ title: 'تم حفظ التصحيح', variant: 'success' });
            setReason('');
            setError('');
            void dayQuery.refetch();
        },
    });

    if (!writable) {
        return <p className="text-body-sm text-muted">هذه اللوحة متاحة للأدمن والمالك فقط — صلاحيات الكتابة على الحضور مقصورة عليهما.</p>;
    }

    const employees = (employeesQuery.data ?? [])
        .filter((employee) => employee.status === 'active')
        .map((employee) => ({ value: String(employee.id), label: String(employee.name || `#${employee.id}`) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ar'));

    return (
        <div className="flex flex-col gap-sm">
            <p className="text-body-sm text-muted">
                أي موظف، أي تاريخ — استعلم عن سجل اليوم المطلوب وعدّله، أو أنشئه إن لم يكن موجودًا. كل حفظ يكتب سطر تدقيق يحمل التاريخ
                والمنفّذ، والسبب إجباري دائمًا.
            </p>
            <div className="grid gap-sm sm:grid-cols-2">
                <Select
                    label="الموظف"
                    value={employeeId}
                    onValueChange={setEmployeeId}
                    placeholder={employeesQuery.isPending ? 'جارٍ تحميل الموظفين…' : 'اختر الموظف…'}
                    options={employees}
                />
                <Input label="التاريخ (أي يوم)" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>

            {dayQuery.isFetching ? (
                <p className="text-body-sm text-muted" role="status">
                    جارٍ قراءة سجل اليوم…
                </p>
            ) : null}
            {dayQuery.isError ? (
                <p className="text-body-sm text-danger-text" role="alert">
                    تعذرت قراءة سجل اليوم — أعد المحاولة.
                </p>
            ) : null}

            {employeeId && dayValid && !dayQuery.isFetching ? (
                <>
                    {record ? (
                        <div className="rounded-md border border-hairline bg-surface-sunken p-sm text-body-sm">
                            <p className="text-label-md text-muted">السجل المخزَّن</p>
                            <p className="mt-xxs text-ink">
                                حضور{' '}
                                <b className="erp-numeric" dir="ltr">
                                    {record.checkIn ?? '—'}
                                </b>
                                {' · '}انصراف{' '}
                                <b className="erp-numeric" dir="ltr">
                                    {record.checkOut ?? '—'}
                                </b>
                                {record.late ? ' · متأخر' : ''}
                                {record.checkoutInferred ? ' · انصراف مُقدَّر' : ''}
                            </p>
                            {record.notes ? <p className="mt-xxs text-caption text-muted">آخر ملاحظة: {record.notes}</p> : null}
                        </div>
                    ) : (
                        <p
                            className="rounded-md border border-warning/30 bg-warning-soft p-sm text-body-sm text-warning-text"
                            role="status"
                        >
                            لا توجد بصمة لهذا الموظف في هذا اليوم — احفظ «إنشاء السجل» وسيُسجَّل كتعبئة معتمدة.
                        </p>
                    )}
                    <div className="grid grid-cols-2 gap-sm">
                        <Input label="الحضور" type="time" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} />
                        <Input label="الانصراف" type="time" value={checkOut} onChange={(event) => setCheckOut(event.target.value)} />
                    </div>
                    <Input
                        label="سبب التصحيح (إجباري)"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="مثال: الموظف نسي يبصم / جهاز البصمة كان معطلًا…"
                    />
                    {error ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {error}
                        </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-sm">
                        <Button
                            type="button"
                            size="sm"
                            disabled={mutation.isPending}
                            onClick={() => {
                                setError('');
                                mutation.mutate();
                            }}
                        >
                            {mutation.isPending ? 'جارٍ الحفظ…' : record ? 'تصحيح البصمة' : 'إنشاء السجل لهذا اليوم'}
                        </Button>
                        <span className="text-caption text-faint">التعديل يكتب في سجل التدقيق باسمك — الأصل لا يُمحى.</span>
                    </div>
                </>
            ) : null}
        </div>
    );
}
