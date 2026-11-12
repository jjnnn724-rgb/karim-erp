import './EmployeePortal.premium.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useConfirm } from '../components/ConfirmProvider';
import { FaceCaptureDialog, type FaceCaptureResult } from '../components/FaceCaptureDialog';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { fetchAttendanceReport } from '../lib/employee-card';
import {
    canSwitchPortalEmployee,
    fetchPortalSnapshot,
    isOn,
    type PortalStatus,
    portalLeaveBadge,
    portalMonthRange,
    portalRecordHours,
    portalRecordState,
    portalRegisterHtml,
    portalSourceBadge,
    punchStateName,
    punchTimeText,
} from '../lib/employee-portal';
import { fetchEmployees } from '../lib/employees';
import { fetchCurrency } from '../lib/finance';
import { formatMoney } from '../lib/format';
import { fetchLeaveTypes, fetchLeaveWorkflow, leaveDays, leaveTypeMap } from '../lib/leaves';
import {
    canEnrollFace,
    canPunchPortal,
    collectLocationFixes,
    enrollFaceV1,
    enrollFaceV2,
    faceEnrollMessage,
    faceV1Required,
    nativeMockSignals,
    type PunchPayload,
    type PunchResult,
    portalDeviceId,
    punchActionLabel,
    punchPortal,
    punchSampleTarget,
    removeFaceEnrollment,
    reportClientReject,
} from '../lib/portal-write';
import { usePrintBrand } from '../lib/print';
import { openBlankTab, writeHtmlDocument } from '../lib/print-document';
import { errorMessage, intOf, num, qtyOf, textOf, todayIso } from '../lib/reporting';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';

interface CardResult {
    kind: 'ok' | 'error' | 'neutral';
    text: string;
}

interface CaptureRequest {
    title: string;
    target: number;
    requireDescriptor: boolean;
    allowUpload: boolean;
}

function resultClass(kind: CardResult['kind'] | null): string {
    if (kind === 'ok') {
        return 'text-success-text';
    }
    if (kind === 'error') {
        return 'text-danger-text';
    }
    return 'text-muted';
}

function punchChip(status: PortalStatus | null): { label: string; tone: 'neutral' | 'warning' | 'success' } {
    if (!status) {
        return { label: 'الحالة غير معروفة', tone: 'neutral' };
    }
    if (!isOn(status.enabled)) {
        return { label: 'غير مفعّلة إداريًا', tone: 'neutral' };
    }
    if (status.hasEmployeeProfile === false) {
        return { label: 'بلا ربط موظف', tone: 'warning' };
    }
    if (isOn(status.faceEnabled) && status.faceEnrolled === false) {
        return { label: 'الوجه غير مسجّل', tone: 'warning' };
    }
    return { label: 'مفعّلة', tone: 'success' };
}

/**
 * بوابة الموظف — البطاقة الذكية: الربط، وحالة اليوم، وقوالب الوجه، وسجل
 * البصمات، مع أبواب الكتابة الأربعة التي كانت في V2 وحده:
 * البصمة الذاتية، تسجيل الرفض المحلي، تسجيل الوجه (v1+v2)، وإزالة القالب.
 * كل حكم على الخادم؛ الواجهة تجمع الدليل (موقع/وجه) وتعرض قراره.
 */
export function EmployeePortal() {
    const auth = useAuthState();
    const { toast } = useToast();
    const confirm = useConfirm();
    const queryClient = useQueryClient();

    const canPunch = canPunchPortal(auth.user?.role);
    const canFace = canEnrollFace(auth.user?.role);
    const canSwitch = canSwitchPortalEmployee(auth.user?.role);
    const brand = usePrintBrand();

    const [punchResult, setPunchResult] = useState<CardResult | null>(null);
    const [punchStage, setPunchStage] = useState('');
    const [faceTarget, setFaceTarget] = useState('');
    const [faceResult, setFaceResult] = useState<CardResult | null>(null);
    const [faceBusy, setFaceBusy] = useState(false);
    const [capture, setCapture] = useState<CaptureRequest | null>(null);
    const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
    const [printMonth, setPrintMonth] = useState(() => todayIso().slice(0, 7));
    const [printing, setPrinting] = useState<'day' | 'month' | null>(null);
    const captureResolveRef = useRef<((result: FaceCaptureResult | null) => void) | null>(null);

    const snapshotQuery = useQuery({
        queryKey: ['hr', 'employee-portal'],
        queryFn: ({ signal }) => fetchPortalSnapshot(signal),
    });
    const employeesQuery = useQuery({
        queryKey: ['employees'],
        queryFn: ({ signal }) => fetchEmployees(signal),
        refetchOnWindowFocus: false,
    });
    const leavesQuery = useQuery({
        queryKey: ['hr', 'employee-portal', 'leaves'],
        queryFn: ({ signal }) => fetchLeaveWorkflow(signal),
    });
    const leaveTypesQuery = useQuery({
        queryKey: ['hr', 'employee-portal', 'leave-types'],
        queryFn: ({ signal }) => fetchLeaveTypes(signal),
    });
    const currencyQuery = useQuery({
        queryKey: ['settings', 'currency'],
        queryFn: ({ signal }) => fetchCurrency(signal),
        staleTime: 10 * 60 * 1000,
    });

    const snapshot = snapshotQuery.data;
    const status = snapshot?.status ?? null;
    const punches = snapshot?.punches ?? null;
    const rows = punches?.punches ?? [];

    const today = todayIso();
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const employees = employeesQuery.data ?? [];
    const selectedEmployee = useMemo(() => {
        if (selectedEmployeeId) {
            const chosen = employees.find((employee) => employee.id === selectedEmployeeId);
            if (chosen) {
                return chosen;
            }
        }
        const selfId = String(auth.user?.id ?? '');
        const own = selfId ? employees.find((employee) => employee.userId !== '' && employee.userId === selfId) : undefined;
        return own ?? (canSwitch ? (employees[0] ?? null) : null);
    }, [employees, selectedEmployeeId, auth.user?.id, canSwitch]);
    const employeeKey = selectedEmployee?.id ?? '';

    const registerQuery = useQuery({
        queryKey: ['hr', 'employee-portal', 'register', employeeKey, yearStart, today],
        queryFn: ({ signal }) => fetchAttendanceReport(employeeKey, yearStart, today, signal),
        enabled: employeeKey !== '',
    });

    const leaveTypeById = useMemo(() => leaveTypeMap(leaveTypesQuery.data?.rows ?? []), [leaveTypesQuery.data]);
    const employeeLeaves = useMemo(
        () => (leavesQuery.data ?? []).filter((leave) => String(leave.employeeId ?? '') === employeeKey),
        [leavesQuery.data, employeeKey],
    );
    const registerRows = useMemo(() => {
        const records = registerQuery.data?.records ?? [];
        return records
            .filter((record) => String(record.checkIn ?? '').trim() !== '')
            .slice()
            .reverse();
    }, [registerQuery.data]);

    const summary = registerQuery.data?.summary;
    const totalHours = summary?.totalKarim === null || summary?.totalKarim === undefined ? null : num(summary.totalKarim);
    const daysPresent = summary?.daysPresent === null || summary?.daysPresent === undefined ? null : num(summary.daysPresent);
    const salaryRaw = selectedEmployee?.salary;
    const salary = salaryRaw === null || salaryRaw === undefined || salaryRaw === '' ? null : Number(salaryRaw);
    const currency = currencyQuery.data ?? '';
    const salaryText =
        salary !== null && Number.isFinite(salary) ? `${formatMoney(salary.toFixed(2))}${currency ? ` ${currency}` : ''}` : '—';

    const captureFace = (request: CaptureRequest): Promise<FaceCaptureResult | null> =>
        new Promise((resolve) => {
            captureResolveRef.current = resolve;
            setCapture(request);
        });

    const finishCapture = (result: FaceCaptureResult | null) => {
        const resolve = captureResolveRef.current;
        captureResolveRef.current = null;
        setCapture(null);
        resolve?.(result);
    };

    const punch = useWriteMutation<PunchPayload, PunchResult>({
        mutationFn: punchPortal,
        invalidate: [['hr', 'employee-portal']],
        silentError: true,
        onSuccess: (result) => {
            setPunchResult({ kind: 'ok', text: punchActionLabel(result.action) });
        },
        onError: (error) => {
            setPunchResult({ kind: 'error', text: `✋ ${writeErrorMessage(error, 'تعذر تسجيل البصمة')}` });
        },
    });

    const doPunch = async () => {
        if (!canPunch || punch.isPending) {
            return;
        }
        if (!status) {
            setPunchResult({ kind: 'error', text: 'تعذر قراءة حالة البوابة — أعد التحديث.' });
            return;
        }
        if (!isOn(status.enabled)) {
            setPunchResult({ kind: 'error', text: 'البصمة الذاتية غير مفعّلة إداريًا' });
            return;
        }
        if (status.hasEmployeeProfile === false) {
            setPunchResult({ kind: 'error', text: 'لم يتم ربط حسابك بملف موظف' });
            return;
        }
        if (isOn(status.faceEnabled) && status.faceEnrolled === false) {
            setPunchResult({ kind: 'error', text: 'لم يتم تسجيل وجهك بعد — راجع الموارد البشرية' });
            return;
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            setPunchResult({ kind: 'error', text: 'لا يوجد اتصال بالشبكة — اتصل بشبكة المطعم وأعد المحاولة' });
            return;
        }

        setPunchResult(null);
        setPunchStage('');

        let face: FaceCaptureResult | null = null;
        if (isOn(status.faceEnabled)) {
            setPunchStage('جارٍ التقاط الوجه…');
            face = await captureFace({
                title: 'تأكيد البصمة بالوجه',
                target: punchSampleTarget(status),
                requireDescriptor: faceV1Required(status) && !isOn(status.faceStrict),
                allowUpload: !isOn(status.faceStrict),
            });
            setPunchStage('');
            if (!face) {
                setPunchResult({ kind: 'neutral', text: 'أُلغيت البصمة — لم يُسجَّل شيء' });
                return;
            }
        }

        let fixes: Awaited<ReturnType<typeof collectLocationFixes>> = null;
        let mockSignals: Awaited<ReturnType<typeof nativeMockSignals>> = null;
        if (isOn(status.geofence)) {
            setPunchStage('تحديد الموقع 0/6…');
            const [collected, signals] = await Promise.all([
                collectLocationFixes((done, total, accuracy) => {
                    setPunchStage(
                        accuracy !== null
                            ? `تحديد الموقع ${done}/${total} — الدقة ${Math.round(accuracy)}م`
                            : `تحديد الموقع ${done}/${total}…`,
                    );
                }),
                nativeMockSignals(),
            ]);
            setPunchStage('');
            fixes = collected;
            mockSignals = signals;
            if (mockSignals?.mocked === true) {
                void reportClientReject('PUNCH_LOCATION_MOCKED_CLIENT', mockSignals.detail).catch(() => undefined);
                setPunchResult({
                    kind: 'error',
                    text: '✋ قراءة الموقع على جهازك معلَّمة كموقع مزيف — أوقف تطبيقات تغيير الموقع ثم أعد المحاولة',
                });
                return;
            }
            if (!fixes) {
                void reportClientReject('PUNCH_LOCATION_UNAVAILABLE_CLIENT', mockSignals?.detail).catch(() => undefined);
                setPunchResult({
                    kind: 'error',
                    text: '✋ تعذر تحديد موقعك — شغّل خدمة الموقع وانتظر إشارة أفضل ثم أعد المحاولة',
                });
                return;
            }
        }

        const descriptor = face?.descriptors[0];
        const image = face?.images[0];
        const payload: PunchPayload = {
            deviceId: portalDeviceId(),
            location:
                isOn(status.geofence) && fixes
                    ? {
                          fixes,
                          mocked: false,
                          spoofSignals: mockSignals?.mockAppSelected === true ? ['MOCK_APP_SELECTED'] : [],
                      }
                    : null,
            ...(descriptor ? { faceDescriptor: descriptor } : {}),
            ...(image
                ? {
                      faceImage: image,
                      faceImages: face?.images ?? [],
                      faceCapture: {
                          source: (face?.sources ?? []).includes('upload') ? 'upload' : 'live',
                          sampleCount: face?.images.length ?? 0,
                      },
                  }
                : {}),
        };
        punch.mutate(payload);
    };

    const employeeOptions = employees
        .filter((employee) => employee.userId !== '')
        .map((employee) => ({
            value: employee.userId,
            label: `${textOf(employee.name) || employee.userId} — ${textOf(employee.employeeId)}`,
        }));
    const switchOptions = employees.map((employee) => ({
        value: employee.id,
        label: `${textOf(employee.name) || employee.id} — ${textOf(employee.employeeId)}`,
    }));

    const printRange = async (kind: 'day' | 'month') => {
        if (!selectedEmployee || printing !== null) {
            return;
        }
        const range = kind === 'day' ? { from: today, to: today } : portalMonthRange(printMonth);
        if (!range) {
            toast({ variant: 'error', title: 'اختر شهرًا صالحًا للكشف' });
            return;
        }
        const title = kind === 'day' ? `كشف حضور وانصراف يوم ${range.from}` : `كشف حضور وانصراف شهر ${printMonth}`;
        const win = openBlankTab(title);
        if (!win) {
            toast({ variant: 'error', title: 'تعذّر فتح نافذة الطباعة', description: 'اسمح بالنوافذ المنبثقة ثم أعد المحاولة' });
            return;
        }
        setPrinting(kind);
        try {
            const report = await fetchAttendanceReport(selectedEmployee.id, range.from, range.to);
            writeHtmlDocument(
                win,
                portalRegisterHtml({
                    title,
                    from: range.from,
                    to: range.to,
                    report,
                    employeeName: textOf(selectedEmployee.name) || textOf(status?.employeeName) || '—',
                    employeeId: textOf(selectedEmployee.employeeId),
                    brandName: brand.name,
                    logoSrc: brand.logoSrc,
                }),
            );
            win.document.querySelector('[data-report-print]')?.addEventListener('click', () => win.print());
            win.document.querySelector('[data-report-close]')?.addEventListener('click', () => win.close());
        } catch (error) {
            win.close();
            toast({
                variant: 'error',
                title: 'تعذّر تجهيز الكشف',
                description: writeErrorMessage(error),
            });
        } finally {
            setPrinting(null);
        }
    };

    const enrollFace = async () => {
        if (!canFace || faceBusy) {
            return;
        }
        if (!faceTarget) {
            setFaceResult({ kind: 'error', text: 'اختر الموظف أولًا' });
            return;
        }
        const targetName = employeeOptions.find((option) => option.value === faceTarget)?.label ?? faceTarget;
        setFaceBusy(true);
        setFaceResult(null);
        try {
            const face = await captureFace({
                title: `تسجيل وجه: ${targetName}`,
                target: 5,
                requireDescriptor: false,
                allowUpload: true,
            });
            if (!face) {
                return;
            }
            const saved: { v1?: boolean; v2?: boolean; v1Error?: string; v2Error?: string } = {};
            if (face.images.length) {
                try {
                    await enrollFaceV2(faceTarget, face.images);
                    saved.v2 = true;
                } catch (error) {
                    saved.v2Error = writeErrorMessage(error, 'فشل المحرك المتقدم');
                }
            }
            if (face.descriptors.length) {
                try {
                    await enrollFaceV1(faceTarget, face.descriptors);
                    saved.v1 = true;
                } catch (error) {
                    saved.v1Error = writeErrorMessage(error, 'فشل المحرك الأساسي');
                }
            }
            const ok = Boolean(saved.v1 || saved.v2);
            setFaceResult({ kind: ok ? 'ok' : 'error', text: faceEnrollMessage(saved) });
            if (ok) {
                toast({ title: 'تم تسجيل الوجه', variant: 'success' });
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['hr', 'employee-portal'] }),
                    queryClient.invalidateQueries({ queryKey: ['settings', 'punch-faces'] }),
                ]);
            }
        } finally {
            setFaceBusy(false);
        }
    };

    const removeFace = async () => {
        if (!canFace || faceBusy) {
            return;
        }
        if (!faceTarget) {
            setFaceResult({ kind: 'error', text: 'اختر الموظف أولًا' });
            return;
        }
        if (!(await confirm('إزالة قالب الوجه لهذا الموظف؟'))) {
            return;
        }
        setFaceBusy(true);
        setFaceResult(null);
        try {
            const result = await removeFaceEnrollment(faceTarget);
            const removed = Number(result.removed ?? 0) + Number(result.removedV2 ?? 0);
            setFaceResult(
                removed > 0
                    ? { kind: 'ok', text: 'تمت إزالة القالب' }
                    : { kind: 'neutral', text: 'لا يوجد قالب نشط لهذا الموظف — لم يتغيّر شيء' },
            );
            if (removed > 0) {
                toast({ title: 'تمت إزالة القالب', variant: 'success' });
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['hr', 'employee-portal'] }),
                    queryClient.invalidateQueries({ queryKey: ['settings', 'punch-faces'] }),
                ]);
            }
        } catch (error) {
            setFaceResult({ kind: 'error', text: writeErrorMessage(error, 'فشلت الإزالة') });
        } finally {
            setFaceBusy(false);
        }
    };

    const chip = punchChip(status);

    return (
        <div className="flex flex-col gap-md employeeportal-premium">
            <ReportHeader
                title="بوابة الموظف"
                english="Employee Portal"
                description="بصمة ذاتية، وربط الحساب بالموظف، وقوالب الوجه، وسجل البصمات."
                pending={snapshotQuery.isFetching}
                onRefresh={() => {
                    void snapshotQuery.refetch();
                }}
            />
            <PrintActions title="بوابة الموظف" />

            {snapshotQuery.isPending ? <StateLoading label="جارٍ قراءة بوابة الموظف…" /> : null}

            {snapshotQuery.isError ? (
                <StateError
                    message={errorMessage(snapshotQuery.error)}
                    onRetry={() => {
                        void snapshotQuery.refetch();
                    }}
                />
            ) : null}

            {snapshot ? (
                <>
                    {canPunch ? (
                        <SectionCard
                            title="البصمة الذاتية"
                            english="Self punch"
                            actions={
                                <div className="flex items-center gap-sm">
                                    {canSwitch ? <span className="text-body-xs text-muted">تُسجَّل لصاحب الحساب الحالي</span> : null}
                                    <Badge variant={chip.tone}>{chip.label}</Badge>
                                </div>
                            }
                        >
                            <div className="flex flex-col gap-sm p-sm">
                                {!status ? (
                                    <p className="text-body-sm text-danger-text">تعذر قراءة حالة البوابة — أعد التحديث.</p>
                                ) : !isOn(status.enabled) ? (
                                    <p className="text-body-sm text-muted">البصمة الذاتية غير مفعّلة من الإدارة بعد.</p>
                                ) : status.hasEmployeeProfile === false ? (
                                    <p className="text-body-sm text-muted">لم يتم ربط حسابك بملف موظف — تواصل مع الموارد البشرية.</p>
                                ) : isOn(status.faceEnabled) && status.faceEnrolled === false ? (
                                    <p className="text-body-sm text-warning-text">لم يتم تسجيل وجهك بعد — راجع الموارد البشرية لتسجيله.</p>
                                ) : (
                                    <div className="flex flex-wrap items-center gap-sm">
                                        <Button
                                            variant="primary"
                                            loading={punch.isPending}
                                            onClick={() => {
                                                void doPunch();
                                            }}
                                            data-testid="punch-button"
                                        >
                                            {punch.isPending ? 'جارٍ تسجيل البصمة…' : 'تسجيل البصمة الآن'}
                                        </Button>
                                        <span className="text-body-sm text-muted">
                                            {isOn(status.faceEnabled)
                                                ? 'سيُطلب تأكيد الوجه ثم الموقع — الوقت من ساعة الخادم.'
                                                : 'سيُقرأ موقعك لحظة البصمة فقط — الوقت من ساعة الخادم.'}
                                        </span>
                                    </div>
                                )}
                                {punchStage ? (
                                    <p className="text-body-sm text-muted" role="status" aria-live="polite">
                                        {punchStage}
                                    </p>
                                ) : null}
                                <p
                                    className={`text-body-sm ${resultClass(punchResult?.kind ?? null)}`}
                                    role="status"
                                    aria-live="polite"
                                    data-testid="punch-result"
                                >
                                    {punchResult?.text ?? ''}
                                </p>
                            </div>
                        </SectionCard>
                    ) : null}

                    <SectionCard
                        title="ملف الموظف"
                        english="Employee"
                        actions={
                            canSwitch && switchOptions.length > 1 ? (
                                <Select
                                    label="الموظف"
                                    options={switchOptions}
                                    {...(selectedEmployee ? { value: selectedEmployee.id } : {})}
                                    onValueChange={setSelectedEmployeeId}
                                    containerClassName="min-w-64"
                                />
                            ) : undefined
                        }
                    >
                        <div className="flex flex-col gap-xxs p-sm">
                            {selectedEmployee ? (
                                <>
                                    <p className="text-heading-sm text-ink" data-testid="portal-employee">
                                        {textOf(selectedEmployee.name) || '—'}
                                        <span className="erp-numeric ms-xs text-body-sm text-muted" dir="ltr">
                                            {textOf(selectedEmployee.employeeId)}
                                        </span>
                                    </p>
                                    <p className="text-body-sm text-muted">
                                        {[textOf(selectedEmployee.position), textOf(selectedEmployee.department)]
                                            .filter(Boolean)
                                            .join(' · ') || '—'}
                                    </p>
                                </>
                            ) : employeesQuery.isPending ? (
                                <p className="text-body-sm text-muted">جارٍ قراءة ملف الموظف…</p>
                            ) : (
                                <>
                                    <p className="text-heading-sm text-ink" data-testid="portal-employee">
                                        {textOf(status?.employeeName) || 'لم يتم ربط الحساب بملف موظف'}
                                    </p>
                                    <p className="text-body-sm text-muted">
                                        {status?.hasEmployeeProfile === false
                                            ? 'تواصل مع الموارد البشرية لربط حسابك.'
                                            : 'تعذّر العثور على ملف الموظف — أعد التحديث.'}
                                    </p>
                                </>
                            )}
                        </div>
                    </SectionCard>

                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات بوابة الموظف">
                        <KpiCard
                            label="الراتب الأساسي"
                            english="Salary"
                            value={salaryText}
                            hint={selectedEmployee ? 'من ملف الموظف' : 'يظهر بعد ربط الحساب'}
                        />
                        <KpiCard
                            label="ساعات العمل"
                            english="Hours"
                            value={totalHours === null ? '—' : qtyOf(totalHours)}
                            hint={`من بداية ${today.slice(0, 4)}`}
                        />
                        <KpiCard
                            label="أيام الحضور"
                            english="Days"
                            value={daysPresent === null ? '—' : intOf(daysPresent)}
                            hint={`من بداية ${today.slice(0, 4)}`}
                        />
                        <KpiCard
                            label="إجمالي الإجازات"
                            english="Leaves"
                            value={leavesQuery.isPending ? '—' : intOf(employeeLeaves.length)}
                            hint="طلب مسجّل"
                        />
                        <KpiCard
                            label="حضور اليوم"
                            english="Today"
                            value={textOf(status?.today?.checkIn) || 'لم يسجل'}
                            hint={`انصراف: ${textOf(status?.today?.checkOut) || '—'}`}
                        />
                        <KpiCard
                            label="قالب الوجه"
                            english="Face template"
                            value={isOn(status?.faceEnrolled) ? 'مسجل' : 'غير مسجل'}
                            hint={isOn(status?.faceEnabled) ? 'محرك الوجه مفعّل' : 'محرك الوجه مغلق'}
                            tone={isOn(status?.faceEnrolled) ? 'success' : 'neutral'}
                        />
                    </ul>

                    {canFace ? (
                        <SectionCard
                            title="تسجيل وجوه الموظفين"
                            english="Face enrollment"
                            actions={<Badge variant="info">إدارة / موارد بشرية</Badge>}
                        >
                            <div className="flex flex-col gap-sm p-sm">
                                {employeeOptions.length === 0 ? (
                                    <p className="text-body-sm text-muted">لا يوجد موظفون مرتبطون بحسابات مستخدمين — اربط الحساب أولًا.</p>
                                ) : (
                                    <div className="flex flex-wrap items-end gap-sm">
                                        <Select
                                            label="الموظف"
                                            options={employeeOptions}
                                            placeholder="— اختر الموظف —"
                                            {...(faceTarget ? { value: faceTarget } : {})}
                                            onValueChange={setFaceTarget}
                                            containerClassName="min-w-64"
                                            disabled={faceBusy}
                                        />
                                        <Button
                                            variant="primary"
                                            loading={faceBusy}
                                            onClick={() => {
                                                void enrollFace();
                                            }}
                                        >
                                            تسجيل الوجه
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            disabled={faceBusy || !faceTarget}
                                            onClick={() => {
                                                void removeFace();
                                            }}
                                        >
                                            إزالة القالب
                                        </Button>
                                    </div>
                                )}
                                <p className={`text-body-sm ${resultClass(faceResult?.kind ?? null)}`} role="status" aria-live="polite">
                                    {faceResult?.text ?? ''}
                                </p>
                                <p className="text-body-xs text-muted">
                                    تُجمع حتى 5 لقطات للقالب. الصور لا تُخزَّن على الخادم — تُستهلك لاستخراج البصمة ثم تُهمل.
                                </p>
                            </div>
                        </SectionCard>
                    ) : null}

                    <SectionCard
                        title="بصماتي"
                        english="My punches"
                        actions={
                            <span className="text-body-sm text-muted" role="status">
                                {`${intOf(punches?.punchCount ?? rows.length)} بصمة`}
                            </span>
                        }
                    >
                        {!isOn(punches?.linked) && rows.length === 0 ? (
                            <StateEmpty
                                title="لا ربط بجهاز البصمة"
                                hint={textOf(punches?.error) || 'اطلب من الموارد البشرية ربط رقمك على جهاز البصمة.'}
                            />
                        ) : rows.length === 0 ? (
                            <StateEmpty title="لا بصمات مسجلة" hint="لم تُسجَّل بصمة لهذا الحساب بعد." />
                        ) : (
                            <TableScroll label="جدول بصمات الموظف">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الوقت
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الحالة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الجهاز
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((punchRow) => (
                                            <tr key={punchRow.id} className="border-b border-hairline hover:bg-surface-hover">
                                                <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                    {punchTimeText(punchRow)}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">
                                                    {punchStateName(num(punchRow.state))}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm text-muted">
                                                    {textOf(punchRow.deviceName) || '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </SectionCard>

                    {selectedEmployee ? (
                        <SectionCard
                            title="سجل الحضور والانصراف"
                            english="Attendance register"
                            actions={
                                <div className="flex flex-wrap items-end gap-xs p-xs" data-erp-print-hide>
                                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                                        شهر الكشف
                                        <input
                                            type="month"
                                            className="erp-numeric h-10 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                                            dir="ltr"
                                            value={printMonth}
                                            onChange={(event) => {
                                                setPrintMonth(event.target.value);
                                            }}
                                        />
                                    </label>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        loading={printing === 'day'}
                                        onClick={() => {
                                            void printRange('day');
                                        }}
                                    >
                                        اليوم
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        loading={printing === 'month'}
                                        onClick={() => {
                                            void printRange('month');
                                        }}
                                    >
                                        الشهر كامل
                                    </Button>
                                </div>
                            }
                        >
                            {registerQuery.isPending ? (
                                <StateLoading label="جارٍ قراءة كشف الحضور…" />
                            ) : registerQuery.isError ? (
                                <StateError
                                    message={errorMessage(registerQuery.error)}
                                    onRetry={() => {
                                        void registerQuery.refetch();
                                    }}
                                />
                            ) : registerRows.length === 0 ? (
                                <StateEmpty title="لا سجلات حضور" hint={`لم تُسجَّل أيام حضور من بداية ${today.slice(0, 4)}.`} />
                            ) : (
                                <TableScroll label="جدول سجل الحضور والانصراف">
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    التاريخ
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الحضور
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الانصراف
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الساعات
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    المصدر
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الحالة
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {registerRows.map((record, index) => {
                                                const source = portalSourceBadge(record.source);
                                                const state = portalRecordState(record);
                                                const hours = record.checkIn && record.checkOut ? portalRecordHours(record) : null;
                                                return (
                                                    <tr
                                                        key={`${String(record.date ?? '')}-${String(index)}`}
                                                        className="border-b border-hairline hover:bg-surface-hover"
                                                    >
                                                        <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                            {String(record.date ?? '').slice(0, 10)}
                                                        </td>
                                                        <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                            {record.checkIn || '—'}
                                                        </td>
                                                        <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                            {record.checkOut || '—'}
                                                        </td>
                                                        <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                            {hours === null
                                                                ? '—'
                                                                : hours.toLocaleString('en-US', {
                                                                      maximumFractionDigits: 2,
                                                                  })}
                                                        </td>
                                                        <td className="px-sm py-xxs">
                                                            <Badge variant={source.tone}>{source.label}</Badge>
                                                        </td>
                                                        <td className="px-sm py-xxs">
                                                            <Badge variant={state.tone}>{state.label}</Badge>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                        </SectionCard>
                    ) : null}

                    {selectedEmployee ? (
                        <SectionCard
                            title="سجل الإجازات"
                            english="Leave history"
                            actions={
                                <span className="text-body-sm text-muted" role="status">
                                    {leavesQuery.isPending ? '' : `${intOf(employeeLeaves.length)} طلب`}
                                </span>
                            }
                        >
                            {leavesQuery.isPending ? (
                                <StateLoading label="جارٍ قراءة الإجازات…" />
                            ) : leavesQuery.isError ? (
                                <StateError
                                    message={errorMessage(leavesQuery.error)}
                                    onRetry={() => {
                                        void leavesQuery.refetch();
                                    }}
                                />
                            ) : employeeLeaves.length === 0 ? (
                                <StateEmpty title="لا إجازات مسجلة" hint="لم يُسجَّل طلب إجازة لهذا الموظف." />
                            ) : (
                                <TableScroll label="جدول سجل الإجازات">
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    النوع
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    من
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    إلى
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الأيام
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الحالة
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {employeeLeaves.map((leave) => {
                                                const badge = portalLeaveBadge(leave.status);
                                                const days = leaveDays(String(leave.startDate ?? ''), String(leave.endDate ?? ''));
                                                const typeName =
                                                    textOf(leave.leave_type_name) ||
                                                    textOf(leaveTypeById.get(String(leave.leaveTypeId ?? ''))?.name) ||
                                                    '—';
                                                return (
                                                    <tr key={leave.id} className="border-b border-hairline hover:bg-surface-hover">
                                                        <td className="px-sm py-xxs text-ink">{typeName}</td>
                                                        <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                            {String(leave.startDate ?? '').slice(0, 10)}
                                                        </td>
                                                        <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                            {String(leave.endDate ?? '').slice(0, 10)}
                                                        </td>
                                                        <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                            {days === null ? '—' : intOf(days)}
                                                        </td>
                                                        <td className="px-sm py-xxs">
                                                            <Badge variant={badge.tone}>{badge.label}</Badge>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                        </SectionCard>
                    ) : null}

                    {snapshot.failures.length > 0 ? (
                        <p className="rounded-md border border-warning bg-surface p-sm text-body-sm text-warning-text" role="alert">
                            {`تعذّر قراءة: ${snapshot.failures.join(' · ')}`}
                        </p>
                    ) : null}
                </>
            ) : null}

            <FaceCaptureDialog
                open={capture !== null}
                title={capture?.title ?? 'التقاط الوجه'}
                target={capture?.target ?? 1}
                requireDescriptor={capture?.requireDescriptor ?? false}
                allowUpload={capture?.allowUpload ?? true}
                onOpenChange={(open) => {
                    if (!open) {
                        finishCapture(null);
                    }
                }}
                onComplete={finishCapture}
            />
        </div>
    );
}
