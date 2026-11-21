import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { StateError, StateLoading, TableScroll } from '../components/TableState';
import { useAuthState, getAccessToken } from '../lib/auth';
import { ATT_STATE, fetchAttendanceReport, rangeReportRows } from '../lib/employee-card';
import { fetchEmployeeLeaves, fetchEmployeeSuite } from '../lib/employee-profile';
import { fetchEmployees, fetchHrDepartments } from '../lib/employees';
import { employeeWriteVisible, updateEmployeeProfile } from '../lib/employees-write';
import { formatMoney } from '../lib/format';
import { PRINT_COMPANY_EN, usePrintBrand } from '../lib/print';
import { printSmart } from '../lib/print-viewer';
import { errorMessage, intOf, presetRange } from '../lib/reporting';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';
import { ScreenHero } from '../ui/ScreenHero';
import { StatCard } from '../ui/StatCard';
import { useToast } from '../ui/Toast';

/**
 * بطاقة الموظف الكاملة — ملف شخصي احترافي بصفحة واحدة (?id=، خارج القائمة).
 * غلاف هوية الشركة باللوجو + ملف الموظف بورقة مواصفات + كشف حضور رسمي
 * + سجلات HR. التحرير بأدراج شاملة للأدمن وHR فقط (قرار المالك 2026-11-21).
 */

const DAY_OFF_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function expiryTone(value: string | null | undefined): 'danger' | 'warning' | 'neutral' {
    if (!value) {
        return 'neutral';
    }
    const days = Math.round((new Date(value).getTime() - Date.now()) / 86400000);
    if (Number.isFinite(days) && days < 0) {
        return 'danger';
    }
    if (Number.isFinite(days) && days < 30) {
        return 'warning';
    }
    return 'neutral';
}

function isTrue(value: unknown): boolean {
    return value === true || value === 1 || value === '1' || value === 'true';
}

function initialsOf(name: string): string {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0] ?? '')
        .join('');
}

export function EmployeeCard() {
    const [employeeId] = useState(() => {
        try {
            return new URLSearchParams(window.location.search).get('id') ?? '';
        } catch {
            return '';
        }
    });
    const navigate = useNavigate();
    const auth = useAuthState();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const brand = usePrintBrand();
    const canEdit = employeeWriteVisible(auth.user?.role);
    const isAdmin = auth.user?.role === 'admin';
    const showSalary = auth.user?.role === 'admin' || auth.user?.role === 'manager' || auth.user?.role === 'hr';

    const employeesQuery = useQuery({
        queryKey: ['employees', 'card', employeeId],
        queryFn: ({ signal }) => fetchEmployees(signal),
        enabled: employeeId !== '',
    });
    const employee = useMemo(
        () => (employeesQuery.data ?? []).find((row) => row.id === employeeId) ?? null,
        [employeesQuery.data, employeeId],
    );
    const departmentsQuery = useQuery({
        queryKey: ['employee-card', 'departments'],
        queryFn: ({ signal }) => fetchHrDepartments(signal),
        staleTime: 10 * 60_000,
        enabled: employeeId !== '' && canEdit,
    });
    const departmentOptions = (departmentsQuery.data ?? []).map((dept) => ({
        value: String(dept.code ?? ''),
        label: String(dept.name ?? dept.code ?? ''),
    }));

    const leavesQuery = useQuery({
        queryKey: ['employee-card', 'leaves', employeeId],
        queryFn: ({ signal }) => fetchEmployeeLeaves(employeeId, signal),
        enabled: employeeId !== '',
    });
    const suiteQuery = useQuery({
        queryKey: ['employee-card', 'suite', employeeId],
        queryFn: ({ signal }) => fetchEmployeeSuite(employeeId, signal),
        enabled: employeeId !== '',
    });
    const [editOpen, setEditOpen] = useState(false);

    function invalidate() {
        void queryClient.invalidateQueries({ queryKey: ['employees'] });
        void queryClient.invalidateQueries({ queryKey: ['employee-card'] });
    }

    async function printLuxCard() {
        try {
            const token = getAccessToken();
            const headers: Record<string, string> = { Accept: 'text/html' };
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }
            const response = await fetch(`/api/hr/employees/${encodeURIComponent(employeeId)}/lux-card`, { headers });
            if (!response.ok) {
                throw new Error(`HTTP ${String(response.status)}`);
            }
            const html = await response.text();
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            window.open(URL.createObjectURL(blob), '_blank', 'noopener');
        } catch {
            toast({ title: 'تعذّر تجهيز البطاقة الفاخرة', variant: 'error' });
        }
    }

    const shell = (children: React.ReactNode) => (
        <div className="flex flex-col gap-lg premium-screen premium-employee-card">
            <ScreenHero title="بطاقة الموظف" english="EMPLOYEE CARD" />
            {children}
        </div>
    );

    if (employeeId === '') {
        return shell(
            <p className="rounded-lg border border-hairline bg-surface p-md text-body-md text-muted">
                افتح البطاقة من شاشة الموظفين — اختر الموظف ثم اضغط «فتح البطاقة الكاملة».
            </p>,
        );
    }

    if (employeesQuery.isPending) {
        return shell(<StateLoading label="جارٍ قراءة بيانات الموظف…" />);
    }

    if (employeesQuery.isError) {
        return shell(
            <StateError
                message={errorMessage(employeesQuery.error)}
                onRetry={() => {
                    void employeesQuery.refetch();
                }}
            />,
        );
    }

    if (!employee) {
        return shell(
            <p className="rounded-lg border border-hairline bg-surface p-md text-body-md text-muted">
                الموظف غير موجود — ربما حُذف أو تغيّر الرابط.
            </p>,
        );
    }

    const name = String(employee.name ?? '—');
    const code = String(employee.employeeId ?? '');
    const status = String(employee.status ?? 'active');
    const position = String(employee.position ?? '');
    const department = String(employee.department ?? '');
    const photo = String(employee.photo ?? '');
    const hasPhoto = photo.startsWith('data:') || photo.startsWith('http') || photo.startsWith('/');
    const inactive = status === 'inactive';

    function printAttendance() {
        printSmart(
            '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>كشف الحضور</title></head><body><p>استخدم «كشف الحضور والانصراف» في البطاقة لطباعة الكشف الرسمي.</p></body></html>',
        );
    }

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-lg premium-screen premium-employee-card">
            {/* ─── غلاف هوية الشركة — اللوجو + الاسم + الختم الرسمي ─── */}
            <section
                className="flex flex-wrap items-center gap-md rounded-lg bg-sidebar p-md shadow-card"
                aria-label="هوية الشركة"
                data-erp-print-hide
            >
                <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface shadow-card">
                    <img src={brand.logoSrc} alt="شعار الشركة" className="size-12 object-contain" />
                </span>
                <div className="flex min-w-0 flex-col gap-xxs">
                    <span className="text-heading-md text-sidebar-ink">{brand.name}</span>
                    <span className="text-caption uppercase tracking-[0.18em] text-sidebar-plaque-ink" dir="ltr" lang="en">
                        {PRINT_COMPANY_EN}
                    </span>
                </div>
                <span className="ms-auto inline-flex items-center gap-xxs rounded-full border border-sidebar-accent px-md py-xxs text-caption font-medium text-sidebar-plaque-ink">
                    <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-sidebar-accent" />
                    بطاقة موظف رسمية
                </span>
            </section>

            {/* ─── رأس الملف: الصورة + الاسم + الحالة + الإجراءات ─── */}
            <div className="flex flex-wrap items-center gap-md">
                {hasPhoto ? (
                    <img
                        src={photo}
                        alt={`صورة ${name}`}
                        className="size-20 shrink-0 rounded-full border-2 border-primary object-cover shadow-card"
                    />
                ) : (
                    <span
                        aria-hidden="true"
                        className="grid size-20 shrink-0 place-items-center rounded-full bg-sidebar text-display-lg text-sidebar-plaque-ink shadow-card"
                    >
                        {initialsOf(name)}
                    </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-xxs">
                    <div className="flex flex-wrap items-center gap-sm">
                        <h2 className="text-heading-lg text-ink">{name}</h2>
                        {inactive ? <Badge variant="warning">موقوف</Badge> : <Badge variant="success" dot>نشط</Badge>}
                    </div>
                    <p className="text-body-sm text-muted">
                        {[position || null, department || null, code ? `كود ${code}` : null].filter(Boolean).join(' · ') || '—'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-xs" data-erp-print-hide>
                    <Button type="button" size="sm" variant="secondary" onClick={() => navigate({ to: '/employees' })}>
                        عودة
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={printAttendance}>
                        🖨 كشف الحضور
                    </Button>
                    {canEdit ? (
                        <Button type="button" size="sm" variant="secondary" onClick={() => void printLuxCard()}>
                            🪪 البطاقة الفاخرة
                        </Button>
                    ) : null}
                    {canEdit ? (
                        <Button type="button" size="sm" onClick={() => setEditOpen(true)}>
                            ✏️ تحرير البيانات
                        </Button>
                    ) : null}
                </div>
            </div>

            {/* ─── ورقة المواصفات — حقول بفواصل رفيعة في عمودين ─── */}
            <div className="grid gap-md md:grid-cols-2">
                <section className="rounded-lg border border-hairline bg-surface p-sm shadow-card" aria-label="الهوية والاتصال">
                    <h3 className="mb-xs text-caption font-medium uppercase tracking-[0.14em] text-faint">
                        الهوية والاتصال <span className="normal-case" dir="ltr" lang="en">Identity</span>
                    </h3>
                    <Fact label="الاسم الكامل" value={name} />
                    <Fact label="كود الموظف" value={code || '—'} mono />
                    <Fact label="الوظيفة" value={position || '—'} />
                    <Fact label="القسم (HR)" value={department || '—'} />
                    <Fact label="الهاتف" value={String(employee.phone ?? '—')} mono />
                    <Fact label="البريد الإلكتروني" value={String(employee.email ?? '—')} mono />
                    <Fact label="تاريخ التعيين" value={String(employee.joinDate ?? '—')} mono />
                    <Fact label="الجنسية" value={String(employee.nationality ?? '—')} />
                </section>

                <section className="rounded-lg border border-hairline bg-surface p-sm shadow-card" aria-label="الوثائق والعمل">
                    <h3 className="mb-xs text-caption font-medium uppercase tracking-[0.14em] text-faint">
                        الوثائق والانتهاءات <span className="normal-case" dir="ltr" lang="en">Documents</span>
                    </h3>
                    <ExpiryFact label="انتهاء الإقامة" value={employee.iqamaExpiry} />
                    <ExpiryFact label="الشهادة الصحية" value={employee.healthCertExpiry} />
                    <ExpiryFact label="الشهادة التعليمية الصحية" value={employee.healthEduExpiry} />
                    <Fact label="رقم الهوية/الإقامة" value={String(employee.iqamaNumber ?? '—')} mono />
                    <h3 className="mb-xs mt-sm text-caption font-medium uppercase tracking-[0.14em] text-faint">
                        البنك وWPS <span className="normal-case" dir="ltr" lang="en">Bank</span>
                    </h3>
                    <Fact label="IBAN الحساب البنكي" value={String(employee.iban ?? '—')} mono />
                    <Fact label="رقم التأمينات (GOSI)" value={String(employee.gosi_number ?? '—')} mono />
                    <h3 className="mb-xs mt-sm text-caption font-medium uppercase tracking-[0.14em] text-faint">
                        العمل والوردية <span className="normal-case" dir="ltr" lang="en">Work</span>
                    </h3>
                    {showSalary ? <Fact label="الراتب" value={employee.salary == null ? '—' : formatMoney(String(employee.salary))} mono /> : null}
                    <Fact label="بداية الوردية" value={String(employee.shift_start ?? '—')} mono />
                    <Fact label="مدة الوردية (ساعات)" value={employee.shift_karim == null ? '—' : String(employee.shift_karim)} mono />
                    <Fact label="الراحة الأسبوعية" value={employee.day_off == null ? '—' : DAY_OFF_AR[Number(employee.day_off) % 7] ?? '—'} />
                    <Fact label="رقم البطاقة" value={String(employee.cardId ?? '—')} mono />
                    <Fact label="رقم الجهاز" value={String(employee.deviceUserId ?? '—')} mono />
                    {isAdmin ? <Fact label="الانصراف التلقائي" value={isTrue(employee.auto_checkout) ? 'مُفعّل' : 'مُعطّل'} /> : null}
                    {isAdmin ? <Fact label="قفل اليوم التلقائي" value={isTrue(employee.auto_lock) ? 'مُفعّل' : 'مُعطّل'} /> : null}
                </section>
            </div>

            {/* ─── كشف الحضور ─── */}
            <AttendanceRangeBlock
                employeeId={employeeId}
                employeeName={name}
                employeeCode={code}
                department={department}
                position={position}
                dayOff={employee.day_off == null ? null : Number(employee.day_off)}
            />

            {/* ─── سجلات HR ─── */}
            <div className="grid gap-md md:grid-cols-2">
                <LeavesSection query={leavesQuery} />
                <SuiteSection title="سلف الرواتب" english="Advances" rows={suiteQuery.data?.advances ?? []} loading={suiteQuery.isPending} />
                <SuiteSection title="تسويات الرواتب" english="Adjustments" rows={suiteQuery.data?.adjustments ?? []} loading={suiteQuery.isPending} />
                <SuiteSection title="عقود العمل" english="Contracts" rows={suiteQuery.data?.contracts ?? []} loading={suiteQuery.isPending} />
                <SuiteSection title="التقييمات" english="Evaluations" rows={suiteQuery.data?.evaluations ?? []} loading={suiteQuery.isPending} />
            </div>

            {editOpen && employee ? (
                <EmployeeEditDrawer
                    employee={employee}
                    employeeId={employeeId}
                    isAdmin={isAdmin}
                    departmentOptions={departmentOptions}
                    onClose={() => {
                        setEditOpen(false);
                    }}
                    onSaved={() => {
                        setEditOpen(false);
                        invalidate();
                        toast({ title: 'تم حفظ تعديلات الموظف', variant: 'success' });
                    }}
                />
            ) : null}
        </div>
    );
}

/* ─── حقول ورقة المواصفات — صف رفيع: التسمية يمين والقيمة يسار ─────────── */

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-sm border-b border-hairline py-xs last:border-b-0">
            <span className="shrink-0 text-caption text-muted">{label}</span>
            <span
                className={`min-w-0 truncate text-body-md text-ink ${mono ? 'erp-numeric' : ''}`}
                dir={mono ? 'ltr' : undefined}
                title={value}
            >
                {value}
            </span>
        </div>
    );
}

function ExpiryFact({ label, value }: { label: string; value: string | null | undefined }) {
    const tone = expiryTone(value);
    const toneClass = tone === 'danger' ? 'text-danger-text' : tone === 'warning' ? 'text-warning-text' : 'text-ink';
    return (
        <div className="flex items-center justify-between gap-sm border-b border-hairline py-xs last:border-b-0">
            <span className="shrink-0 text-caption text-muted">{label}</span>
            <span className="flex items-center gap-xxs">
                <span className={`erp-numeric text-body-md ${toneClass}`} dir="ltr">
                    {value || '—'}
                </span>
                {tone === 'danger' ? <Badge variant="danger">منتهية</Badge> : null}
                {tone === 'warning' ? <Badge variant="warning">قاربت</Badge> : null}
            </span>
        </div>
    );
}

/* ─── كشف الحضور بفترة — توكنز مستقلة ───────────────────────────────────── */

function AttendanceRangeBlock({
    employeeId,
    employeeName,
    employeeCode,
    department,
    position,
    dayOff,
}: {
    employeeId: string;
    employeeName: string;
    employeeCode: string;
    department: string;
    position: string;
    dayOff: number | null;
}) {
    const today = presetRange('today');
    const [draft, setDraft] = useState(() => ({ from: `${today.from.slice(0, 7)}-01`, to: today.to }));
    const [error, setError] = useState('');
    const attendanceQuery = useQuery({
        queryKey: ['employee-card', 'attendance', employeeId, draft.from, draft.to],
        queryFn: ({ signal }) => fetchAttendanceReport(employeeId, draft.from, draft.to, signal),
        enabled: employeeId !== '',
    });
    const model = useMemo(
        () => (attendanceQuery.data ? rangeReportRows(attendanceQuery.data, dayOff) : null),
        [attendanceQuery.data, dayOff],
    );

    function apply() {
        if (draft.to < draft.from) {
            setError('تاريخ النهاية يسبق تاريخ البداية');
            return;
        }
        setError('');
    }

    function printSheet() {
        if (!model) {
            return;
        }
        const s = model.summary;
        const rowsHtml = (model.rows ?? [])
            .map(
                (row) =>
                    `<tr><td>${String(row.date ?? '')}</td><td>${ATT_STATE[row.state]?.label ?? row.state}</td><td>${String(row.checkIn ?? '—')}</td><td>${String(row.checkOut ?? '—')}</td><td>${intOf(Number(row.minutes ?? 0))}</td></tr>`,
            )
            .join('');
        printSmart(
            `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>كشف حضور ${employeeName}</title><style>body{font-family:Tajawal,Arial;padding:24px}h1{font-size:20px;color:#102a43}table{width:100%;border-collapse:collapse;font-size:13px}th{background:#102a43;color:#fff;padding:6px}td{border-bottom:1px solid #dce5ec;padding:5px}</style></head><body><h1>كشف حضور ${employeeName}</h1><p>${employeeCode} · ${department} · ${position}</p><p>الملخص: أيام حضور ${intOf(Number(s?.daysPresent ?? 0))} · متأخر ${intOf(Number(s?.lateDays ?? 0))}</p><table><thead><tr><th>اليوم</th><th>الحالة</th><th>الدخول</th><th>الخروج</th><th>دقائق العمل</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`,
        );
    }

    const s = model?.summary;

    return (
        <section className="rounded-lg border border-hairline bg-surface shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-sm border-b border-hairline px-sm py-xs">
                <h2 className="text-heading-md text-ink">
                    كشف الحضور والانصراف{' '}
                    <span className="text-body-sm text-muted" dir="ltr" lang="en">
                        Attendance
                    </span>
                </h2>
                <Button type="button" size="sm" variant="secondary" onClick={printSheet} disabled={!model}>
                    🖨 طباعة الكشف الرسمي
                </Button>
            </div>
            <div className="flex flex-wrap items-end gap-sm p-sm" data-erp-print-hide>
                <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                    من
                    <input
                        type="date"
                        value={draft.from}
                        onChange={(event) => {
                            setDraft((current) => ({ ...current, from: event.target.value }));
                        }}
                        className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                    />
                </label>
                <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                    إلى
                    <input
                        type="date"
                        value={draft.to}
                        onChange={(event) => {
                            setDraft((current) => ({ ...current, to: event.target.value }));
                        }}
                        className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                    />
                </label>
                <button
                    type="button"
                    onClick={apply}
                    className="rounded-md bg-primary px-md py-xs text-button-md text-on-primary hover:bg-primary-hover"
                >
                    عرض
                </button>
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : null}
            </div>
            {attendanceQuery.isPending ? <StateLoading label="جارٍ قراءة الحضور…" /> : null}
            {attendanceQuery.isError ? (
                <StateError
                    message={errorMessage(attendanceQuery.error)}
                    onRetry={() => {
                        void attendanceQuery.refetch();
                    }}
                />
            ) : null}
            {model && s ? (
                <>
                    <ul className="grid list-none gap-sm px-sm sm:grid-cols-2 xl:grid-cols-4" role="list" aria-label="ملخص الحضور">
                        <StatCard label="أيام الحضور" english="Present" value={intOf(Number(s.daysPresent ?? 0))} />
                        <StatCard label="أيام مكتملة" english="Complete" value={intOf(Number(s.completeDays ?? 0))} tone="success" />
                        <StatCard label="أيام متأخرة" english="Late" value={intOf(Number(s.lateDays ?? 0))} tone="warning" />
                        <StatCard
                            label="أيام الغياب"
                            english="Absent"
                            value={intOf(Number((model.rows ?? []).filter((row) => row.state === 'absent').length))}
                            tone="danger"
                        />
                    </ul>
                    <TableScroll label="جدول سجل الحضور">
                        <table className="w-full border-collapse text-body-md">
                            <thead>
                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                    <th scope="col" className="px-sm py-xs text-start font-medium">اليوم</th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">الحالة</th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">الدخول</th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">الخروج</th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">دقائق العمل</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(model.rows ?? []).slice(0, 62).map((row) => (
                                    <tr key={String(row.date ?? '')} className="border-b border-hairline">
                                        <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">{String(row.date ?? '')}</td>
                                        <td className="px-sm py-xxs text-body-sm">{ATT_STATE[row.state]?.label ?? row.state}</td>
                                        <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">{String(row.checkIn ?? '—')}</td>
                                        <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">{String(row.checkOut ?? '—')}</td>
                                        <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">{intOf(Number(row.minutes ?? 0))}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableScroll>
                </>
            ) : null}
        </section>
    );
}

/* ─── الإجازات وحزمة HR ──────────────────────────────────────────────────── */

interface LeavesQueryShape {
    data: Array<{ id: string; typeName: string; start: string; end: string; days: string; status: string }> | undefined;
    isPending: boolean;
    isError: boolean;
}

function LeavesSection({ query }: { query: LeavesQueryShape }) {
    return (
        <section className="rounded-lg border border-hairline bg-surface shadow-card">
            <div className="border-b border-hairline px-sm py-xs">
                <h2 className="text-heading-md text-ink">
                    آخر الإجازات{' '}
                    <span className="text-body-sm text-muted" dir="ltr" lang="en">
                        Leaves
                    </span>
                </h2>
            </div>
            {query.isPending ? <StateLoading label="جارٍ قراءة الإجازات…" /> : null}
            {query.isError ? <p className="p-sm text-body-sm text-danger-text">تعذّر قراءة الإجازات.</p> : null}
            {query.data ? (
                query.data.length === 0 ? (
                    <p className="p-sm text-body-sm text-muted">لا إجازات مسجلة لهذا الموظف.</p>
                ) : (
                    <ul className="flex list-none flex-col gap-xxs p-sm" role="list">
                        {query.data.map((leave) => (
                            <li key={leave.id} className="flex flex-wrap items-center justify-between gap-xs rounded-md bg-surface-sunken p-xs text-body-md">
                                <span className="font-medium text-ink">{leave.typeName}</span>
                                <span className="text-caption text-muted" dir="ltr">
                                    {`${leave.start} ← ${leave.end}`}
                                </span>
                                <Badge variant="neutral">{leave.status || '—'}</Badge>
                            </li>
                        ))}
                    </ul>
                )
            ) : null}
        </section>
    );
}

function SuiteSection({ title, english, rows, loading }: { title: string; english: string; rows: Array<Record<string, unknown>>; loading: boolean }) {
    return (
        <section className="rounded-lg border border-hairline bg-surface shadow-card">
            <div className="border-b border-hairline px-sm py-xs">
                <h2 className="text-heading-md text-ink">
                    {title}{' '}
                    <span className="text-body-sm text-muted" dir="ltr" lang="en">
                        {english}
                    </span>
                </h2>
            </div>
            {loading ? <p className="p-sm text-body-sm text-muted">جارٍ القراءة…</p> : null}
            {!loading && rows.length === 0 ? <p className="p-sm text-body-sm text-muted">لا سجلات لهذا الموظف.</p> : null}
            {rows.length > 0 ? (
                <ul className="flex list-none flex-col gap-xxs p-sm" role="list">
                    {rows.slice(0, 6).map((row, index) => (
                        <li key={String(row.id ?? index)} className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-md">
                            <span className="text-ink">{String(row.notes ?? row.title ?? row.type ?? 'سجل')}</span>
                            <span className="text-caption text-muted" dir="ltr">
                                {String(row.date ?? row.created_at ?? '')}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
}

/* ─── درج التحرير الشامل — كل الحقول مجموعة، حفظ واحد — hr/الأدمن فقط ───── */

function EmployeeEditDrawer({
    employee,
    employeeId,
    isAdmin,
    departmentOptions,
    onClose,
    onSaved,
}: {
    employee: Record<string, unknown>;
    employeeId: string;
    isAdmin: boolean;
    departmentOptions: ReadonlyArray<{ value: string; label: string }>;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const fieldKeys: string[] = [
        'name', 'department', 'position', 'phone', 'email', 'joinDate', 'iqamaNumber', 'nationality',
        'iqamaExpiry', 'healthCertExpiry', 'healthEduExpiry',
        'iban', 'gosi_number',
        'salary', 'shift_start', 'day_off', 'status',
        'cardId', 'deviceUserId', 'auto_checkout', 'auto_lock',
    ];
    const [form, setForm] = useState<Record<string, string>>(() => {
        const picked: Record<string, string> = {};
        for (const key of fieldKeys) {
            const raw = employee[key];
            picked[key] = raw == null ? '' : String(raw);
        }
        return picked;
    });

    function set(key: string, value: string) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    async function save() {
        setBusy(true);
        setError('');
        try {
            const payload: Record<string, unknown> = {};
            for (const [key, raw] of Object.entries(form)) {
                if (key === 'salary') {
                    const n = Number(raw);
                    payload.salary = raw === '' ? null : (Number.isFinite(n) ? n : null);
                    continue;
                }
                if (key === 'day_off') {
                    const n = Number(raw);
                    payload.day_off = raw === '' ? null : (Number.isInteger(n) && n >= 0 && n <= 6 ? n : null);
                    continue;
                }
                if (key === 'status') {
                    payload.status = raw === 'inactive' ? 'inactive' : 'active';
                    continue;
                }
                if ((key === 'auto_checkout' || key === 'auto_lock') && !isAdmin) {
                    continue;
                }
                payload[key] = raw;
            }
            await updateEmployeeProfile(employeeId, payload as never);
            onSaved();
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Drawer
            open
            onOpenChange={(open) => {
                if (!open) {
                    onClose();
                }
            }}
            title="تحرير بيانات الموظف"
            description="كل الحقول القابلة للكتابة — الحفظ يُسجَّل في سجل التدقيق ويظهر فورًا في البطاقة."
        >
            <div className="flex flex-col gap-md">
                <p className="text-caption font-medium uppercase tracking-[0.14em] text-faint">الهوية والاتصال</p>
                <LabeledInput label="الاسم الكامل" value={form.name} onChange={(v) => set('name', v)} />
                <LabeledSelect label="القسم (HR)" value={form.department} onChange={(v) => set('department', v)} options={departmentOptions} />
                <LabeledInput label="الوظيفة" value={form.position} onChange={(v) => set('position', v)} />
                <LabeledInput label="الهاتف" value={form.phone} onChange={(v) => set('phone', v)} />
                <LabeledInput label="البريد الإلكتروني" value={form.email} onChange={(v) => set('email', v)} />
                <LabeledInput label="تاريخ التعيين" value={form.joinDate} onChange={(v) => set('joinDate', v)} type="date" />
                <LabeledInput label="رقم الهوية/الإقامة" value={form.iqamaNumber} onChange={(v) => set('iqamaNumber', v)} />
                <LabeledInput label="الجنسية" value={form.nationality} onChange={(v) => set('nationality', v)} />

                <p className="text-caption font-medium uppercase tracking-[0.14em] text-faint">الوثائق والانتهاءات</p>
                <LabeledInput label="انتهاء الإقامة" value={form.iqamaExpiry} onChange={(v) => set('iqamaExpiry', v)} type="date" />
                <LabeledInput label="انتهاء الشهادة الصحية" value={form.healthCertExpiry} onChange={(v) => set('healthCertExpiry', v)} type="date" />
                <LabeledInput label="انتهاء الشهادة التعليمية" value={form.healthEduExpiry} onChange={(v) => set('healthEduExpiry', v)} type="date" />

                <p className="text-caption font-medium uppercase tracking-[0.14em] text-faint">البنك وWPS</p>
                <LabeledInput label="IBAN الحساب البنكي" value={form.iban} onChange={(v) => set('iban', v)} />
                <LabeledInput label="رقم التأمينات (GOSI)" value={form.gosi_number} onChange={(v) => set('gosi_number', v)} />

                <p className="text-caption font-medium uppercase tracking-[0.14em] text-faint">العمل والوردية</p>
                <LabeledInput label="الراتب" value={form.salary} onChange={(v) => set('salary', v)} type="number" />
                <LabeledInput label="بداية الوردية" value={form.shift_start} onChange={(v) => set('shift_start', v)} />
                <LabeledSelect
                    label="الراحة الأسبوعية"
                    value={form.day_off}
                    onChange={(v) => set('day_off', v)}
                    options={[{ value: '', label: '— بلا راحة مسجلة —' }, ...DAY_OFF_AR.map((name, index) => ({ value: String(index), label: name }))]}
                />
                <LabeledSelect
                    label="الحالة"
                    value={form.status}
                    onChange={(v) => set('status', v)}
                    options={[{ value: 'active', label: 'نشط' }, { value: 'inactive', label: 'موقوف' }]}
                />

                <p className="text-caption font-medium uppercase tracking-[0.14em] text-faint">البطاقة والجهاز</p>
                <LabeledInput label="رقم البطاقة" value={form.cardId} onChange={(v) => set('cardId', v)} />
                <LabeledInput label="رقم الموظف على جهاز البصمة" value={form.deviceUserId} onChange={(v) => set('deviceUserId', v)} />
                {isAdmin ? (
                    <>
                        <LabeledSelect
                            label="انصراف تلقائي (أدمن)"
                            value={form.auto_checkout}
                            onChange={(v) => set('auto_checkout', v)}
                            options={[{ value: 'true', label: 'مُفعّل' }, { value: 'false', label: 'مُعطّل' }]}
                        />
                        <LabeledSelect
                            label="قفل اليوم التلقائي (أدمن)"
                            value={form.auto_lock}
                            onChange={(v) => set('auto_lock', v)}
                            options={[{ value: 'true', label: 'مُفعّل' }, { value: 'false', label: 'مُعطّل' }]}
                        />
                    </>
                ) : null}

                {error ? <p role="alert" className="text-body-sm text-danger-text">{error}</p> : null}
            </div>
            <Button type="button" onClick={() => void save()} disabled={busy} className="w-full">
                {busy ? 'جارٍ الحفظ…' : 'حفظ كل التعديلات'}
            </Button>
        </Drawer>
    );
}

function LabeledInput({ label, value, onChange, type = 'text' }: { label: string; value: string | undefined; onChange: (v: string) => void; type?: string }) {
    return (
        <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
            {label}
            <input
                type={type}
                value={value ?? ''}
                onChange={(event) => {
                    onChange(event.target.value);
                }}
                className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
            />
        </label>
    );
}

function LabeledSelect({ label, value, onChange, options }: { label: string; value: string | undefined; onChange: (v: string) => void; options: ReadonlyArray<{ value: string; label: string }> }) {
    return (
        <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
            {label}
            <select
                value={value ?? ''}
                onChange={(event) => {
                    onChange(event.target.value);
                }}
                className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </label>
    );
}
