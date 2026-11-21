import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { StateError, StateLoading, TableScroll } from '../components/TableState';
import { useAuthState, getAccessToken } from '../lib/auth';
import { ATT_STATE, fetchAttendanceReport, rangeReportRows } from '../lib/employee-card';
import { fetchEmployeeLeaves, fetchEmployeeSuite, fetchQrCard } from '../lib/employee-profile';
import { fetchEmployees, fetchHrDepartments } from '../lib/employees';
import { employeeWriteVisible, updateEmployeeProfile } from '../lib/employees-write';
import { formatMoney } from '../lib/format';
import { printSmart } from '../lib/print-viewer';
import { errorMessage, intOf, presetRange } from '../lib/reporting';
import { PRINT_COMPANY_EN, usePrintBrand } from '../lib/print';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';
import { ScreenHero } from '../ui/ScreenHero';
import { StatCard } from '../ui/StatCard';
import { StatusRail } from '../ui/StatusRail';
import { useToast } from '../ui/Toast';

/**
 * بطاقة الموظف الكاملة — شاشة خارج القائمة تُفتح من شاشة الموظفين (?id=).
 * كل بيانات الموظف في صفحة واحدة مع تحرير بالأقسام (Drawers) —
 * التحرير للأدمن وHR فقط (قرار المالك 2026-11-21) والخادم هو الحاكم.
 * لغة كريم: ScreenHero بجواب الحالة + أقسام بطاقات + كشف حضور رسمي + سجلات HR.
 */

type SectionKey = 'identity' | 'documents' | 'bank' | 'work' | 'device';

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
    const qrQuery = useQuery({
        queryKey: ['employee-card', 'qr', employeeId],
        queryFn: ({ signal }) => fetchQrCard(employeeId, signal),
        enabled: employeeId !== '' && Boolean(canEdit),
        retry: 0,
    });

    const [editSection, setEditSection] = useState<SectionKey | null>(null);
    const brand = usePrintBrand();

    function invalidate() {
        void queryClient.invalidateQueries({ queryKey: ['employees'] });
        void queryClient.invalidateQueries({ queryKey: ['employee-card'] });
    }

    const shell = (children: React.ReactNode) => (
        <div className="flex flex-col gap-lg premium-screen premium-employee-card">
            <ScreenHero title="بطاقة الموظف" english="EMPLOYEE CARD" />
            {children}
        </div>
    );

    if (employeeId === '') {
        return shell(
            <p className="rounded-md border border-hairline bg-surface p-md text-body-md text-muted">
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
            <p className="rounded-md border border-hairline bg-surface p-md text-body-md text-muted">
                الموظف غير موجود — ربما حُذف أو تغيّر الرابط.
            </p>,
        );
    }

    const name = String(employee.name ?? '—');
    const code = String(employee.employeeId ?? '');
    const status = String(employee.status ?? 'active');

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

    return (
        <div className="flex flex-col gap-lg premium-screen premium-employee-card">
            <section
                className="flex flex-wrap items-center gap-md rounded-lg bg-sidebar p-md shadow-card"
                aria-label="هوية الشركة"
                data-erp-print-hide
            >
                <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface shadow-card">
                    <img src={brand.logoSrc} alt="شعار الشركة" className="size-14 object-contain" />
                </span>
                <div className="flex min-w-0 flex-col gap-xxs">
                    <span className="text-heading-md text-sidebar-ink">{brand.name}</span>
                    <span className="text-caption uppercase tracking-[0.18em] text-sidebar-plaque-ink" dir="ltr" lang="en">
                        {PRINT_COMPANY_EN}
                    </span>
                </div>
                <span
                    className="ms-auto inline-flex items-center gap-xxs rounded-full border border-sidebar-accent px-md py-xxs text-caption font-medium text-sidebar-plaque-ink"
                >
                    <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-sidebar-accent" />
                    بطاقة موظف رسمية
                </span>
            </section>
            <ScreenHero
                title={name}
                english="EMPLOYEE CARD"
                description={`كود الموظف ${code || '—'}${String(employee.position ?? '') ? ` · ${String(employee.position)}` : ''}${String(employee.department ?? '') ? ` · ${String(employee.department)}` : ''}`}
                answer={
                    <StatusRail
                        steps={[
                            { key: 'active', label: 'نشط ومسجّل', tone: 'success' },
                            { key: 'documents', label: 'الوثائق', tone: 'info' },
                            { key: 'suite', label: 'الرواتب والعقود', tone: 'info' },
                        ]}
                        current={status === 'inactive' ? 0 : 2}
                        label={status === 'inactive' ? 'موظف موقوف — لا يظهر في قوائم الحضور' : 'موظف نشط — السجل مكتمل'}
                    />
                }
                actions={
                    <>
                        <Button type="button" size="sm" variant="secondary" onClick={() => navigate({ to: '/employees' })}>
                            عودة للموظفين
                        </Button>
                        {canEdit ? (
                            <Button type="button" size="sm" variant="secondary" onClick={() => void printLuxCard()}>
                                🪪 البطاقة الفاخرة
                            </Button>
                        ) : null}
                    </>
                }
            />

            <div className="grid gap-md lg:grid-cols-2">
                <Section title="الهوية والاتصال" english="Identity" canEdit={canEdit} onEdit={() => setEditSection('identity')}>
                    <Field label="الاسم" value={name} />
                    <Field label="كود الموظف" value={code} mono />
                    <Field label="الوظيفة" value={String(employee.position ?? '—')} />
                    <Field label="القسم (HR)" value={String(employee.department ?? '—')} />
                    <Field label="الهاتف" value={String(employee.phone ?? '—')} mono />
                    <Field label="البريد" value={String(employee.email ?? '—')} mono />
                    <Field label="تاريخ التعيين" value={String(employee.joinDate ?? '—')} mono />
                    <Field label="الجنسية" value={String(employee.nationality ?? '—')} />
                    <Field label="رقم الهوية/الإقامة" value={String(employee.iqamaNumber ?? '—')} mono />
                    <Field
                        label="الحالة"
                        value={status === 'inactive' ? 'موقوف' : 'نشط'}
                        {...(status === 'inactive' ? {} : { badge: { text: 'نشط' } })}
                    />
                </Section>

                <Section title="الوثائق والانتهاءات" english="Documents" canEdit={canEdit} onEdit={() => setEditSection('documents')}>
                    <ExpiryField label="انتهاء الإقامة" value={employee.iqamaExpiry} />
                    <ExpiryField label="الشهادة الصحية" value={employee.healthCertExpiry} />
                    <ExpiryField label="الشهادة التعليمية الصحية" value={employee.healthEduExpiry} />
                    <Field label="رقم التأمينات (GOSI)" value={String(employee.gosi_number ?? '—')} mono />
                </Section>

                <Section title="البنك وWPS" english="Bank & WPS" canEdit={canEdit} onEdit={() => setEditSection('bank')}>
                    <Field label="IBAN الحساب البنكي" value={String(employee.iban ?? '—')} mono />
                    <p className="text-caption text-muted">بيانات الحساب تُستخدم في ملف WPS لأوامر حماية الأجور.</p>
                </Section>

                <Section title="العمل والوردية" english="Work & shift" canEdit={canEdit} onEdit={() => setEditSection('work')}>
                    {showSalary ? <Field label="الراتب" value={employee.salary == null ? '—' : formatMoney(String(employee.salary))} mono /> : null}
                    <Field label="بداية الوردية" value={String(employee.shift_start ?? '—')} mono />
                    <Field label="مدة الوردية (ساعات)" value={employee.shift_karim == null ? '—' : String(employee.shift_karim)} mono />
                    <Field label="الراحة الأسبوعية" value={employee.day_off == null ? '—' : DAY_OFF_AR[Number(employee.day_off) % 7] ?? '—'} />
                    <Field label="رقم الجهاز" value={String(employee.deviceUserId ?? '—')} mono />
                    {isAdmin ? (
                        <>
                            <Field label="انصراف تلقائي" value={isTrue(employee.auto_checkout) ? 'مُفعّل' : 'مُعطّل'} />
                            <Field label="قفل اليوم التلقائي" value={isTrue(employee.auto_lock) ? 'مُفعّل' : 'مُعطّل'} />
                        </>
                    ) : null}
                </Section>

                <Section title="البطاقة والجهاز" english="Card & QR" canEdit={false}>
                    <Field label="رقم البطاقة" value={String(employee.cardId ?? '—')} mono />
                    <Field
                        label="حالة QR"
                        value={
                            qrQuery.data
                                ? qrQuery.data.qrAvailable
                                    ? 'صادرة وسارية'
                                    : String(qrQuery.data.message ?? 'غير صادرة')
                                : 'غير متاحة (يتطلب إعداد سر البطاقات على الخادم)'
                        }
                    />
                </Section>
            </div>

            <AttendanceRangeBlock
                employeeId={employeeId}
                employeeName={name}
                employeeCode={code}
                department={String(employee.department ?? '')}
                position={String(employee.position ?? '')}
                dayOff={employee.day_off == null ? null : Number(employee.day_off)}
            />

            <LeavesSection query={leavesQuery} />
            <SuiteSection title="سلف الرواتب" english="Salary advances" rows={suiteQuery.data?.advances ?? []} loading={suiteQuery.isPending} />
            <SuiteSection title="تسويات الرواتب" english="Adjustments" rows={suiteQuery.data?.adjustments ?? []} loading={suiteQuery.isPending} />
            <SuiteSection title="عقود العمل" english="Contracts" rows={suiteQuery.data?.contracts ?? []} loading={suiteQuery.isPending} />
            <SuiteSection title="التقييمات" english="Evaluations" rows={suiteQuery.data?.evaluations ?? []} loading={suiteQuery.isPending} />

            {editSection !== null && employee ? (
                <EmployeeEditDrawer
                    section={editSection}
                    employee={employee}
                    employeeId={employeeId}
                    isAdmin={isAdmin}
                    departmentOptions={departmentOptions}
                    onClose={() => {
                        setEditSection(null);
                    }}
                    onSaved={() => {
                        setEditSection(null);
                        invalidate();
                        toast({ title: 'تم حفظ تعديلات الموظف', variant: 'success' });
                    }}
                />
            ) : null}
        </div>
    );
}

/* ─── مكوّنات العرض ──────────────────────────────────────────────────────── */

function Section({
    title,
    english,
    canEdit,
    onEdit,
    children,
}: {
    title: string;
    english: string;
    canEdit: boolean;
    onEdit?: () => void;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-lg border border-hairline bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-hairline px-sm py-xs">
                <h2 className="text-heading-md text-ink">
                    {title}{' '}
                    <span className="text-body-sm text-muted" dir="ltr" lang="en">
                        {english}
                    </span>
                </h2>
                {canEdit && onEdit ? (
                    <Button type="button" size="sm" variant="secondary" onClick={onEdit} data-erp-print-hide>
                        تحرير
                    </Button>
                ) : null}
            </div>
            <dl className="grid grid-cols-1 gap-xxs p-sm sm:grid-cols-2">{children}</dl>
        </section>
    );
}

function Field({
    label,
    value,
    mono = false,
    badge,
}: {
    label: string;
    value: string;
    mono?: boolean;
    badge?: { text: string };
}) {
    return (
        <div className="flex min-w-0 flex-col gap-xxs rounded-md bg-surface-sunken p-xs">
            <dt className="text-caption text-muted">{label}</dt>
            <dd className="flex items-center gap-xxs">
                <span className={mono ? 'erp-numeric text-body-md text-ink' : 'text-body-md text-ink'}>{value}</span>
                {badge ? <Badge variant="success">{badge.text}</Badge> : null}
            </dd>
        </div>
    );
}

function ExpiryField({ label, value }: { label: string; value: string | null | undefined }) {
    const tone = expiryTone(value);
    const toneClass = tone === 'danger' ? 'text-danger-text' : tone === 'warning' ? 'text-warning-text' : 'text-ink';
    return (
        <div className="flex min-w-0 flex-col gap-xxs rounded-md bg-surface-sunken p-xs">
            <dt className="text-caption text-muted">{label}</dt>
            <dd className="flex items-center gap-xxs">
                <span className={`erp-numeric text-body-md ${toneClass}`} dir="ltr">
                    {value || '—'}
                </span>
                {tone === 'danger' ? <Badge variant="danger">منتهية</Badge> : null}
                {tone === 'warning' ? <Badge variant="warning">قاربت</Badge> : null}
            </dd>
        </div>
    );
}

/* ─── كشف الحضور بفترة — توكنز مستقلة عن CSS شاشة الموظفين ───────────────── */

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
                                <span className="text-ink font-medium">{leave.typeName}</span>
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

/* ─── أدراج التحرير بالأقسام — hr/الأدمن فقط ─────────────────────────────── */

const SECTION_TITLES: Record<SectionKey, string> = {
    identity: 'الهوية والاتصال',
    documents: 'الوثائق والانتهاءات',
    bank: 'البنك وWPS',
    work: 'العمل والوردية',
    device: 'البطاقة والجهاز',
};

function EmployeeEditDrawer({
    section,
    employee,
    employeeId,
    isAdmin,
    departmentOptions,
    onClose,
    onSaved,
}: {
    section: SectionKey;
    employee: Record<string, unknown>;
    employeeId: string;
    isAdmin: boolean;
    departmentOptions: ReadonlyArray<{ value: string; label: string }>;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const keysBySection: Record<SectionKey, string[]> = {
        identity: ['name', 'department', 'position', 'phone', 'email', 'joinDate', 'iqamaNumber', 'nationality'],
        documents: ['iqamaExpiry', 'healthCertExpiry', 'healthEduExpiry'],
        bank: ['iban', 'gosi_number'],
        work: ['salary', 'shift_start', 'day_off', 'status'],
        device: ['cardId', 'deviceUserId', 'auto_checkout', 'auto_lock'],
    };
    const [form, setForm] = useState<Record<string, string>>(() => {
        const picked: Record<string, string> = {};
        for (const key of keysBySection[section]) {
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
                if (section === 'work' && key === 'salary') {
                    const n = Number(raw);
                    payload.salary = raw === '' ? null : (Number.isFinite(n) ? n : null);
                    continue;
                }
                if (section === 'work' && key === 'day_off') {
                    const n = Number(raw);
                    payload.day_off = raw === '' ? null : (Number.isInteger(n) && n >= 0 && n <= 6 ? n : null);
                    continue;
                }
                if (section === 'work' && key === 'status') {
                    payload.status = raw === 'inactive' ? 'inactive' : 'active';
                    continue;
                }
                if (section === 'device' && (key === 'auto_checkout' || key === 'auto_lock')) {
                    if (isAdmin) {
                        payload[key] = raw === '1' || raw === 'true';
                    }
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
            title={`تحرير — ${SECTION_TITLES[section]}`}
            description="الحفظ يُسجَّل في سجل التدقيق ويظهر فورًا في البطاقة."
        >
            <div className="flex flex-col gap-sm">
                {section === 'identity' ? (
                    <>
                        <LabeledInput label="الاسم الكامل" value={form.name} onChange={(v) => set('name', v)} />
                        <LabeledSelect label="القسم (HR)" value={form.department} onChange={(v) => set('department', v)} options={departmentOptions} />
                        <LabeledInput label="الوظيفة" value={form.position} onChange={(v) => set('position', v)} />
                        <LabeledInput label="الهاتف" value={form.phone} onChange={(v) => set('phone', v)} />
                        <LabeledInput label="البريد الإلكتروني" value={form.email} onChange={(v) => set('email', v)} />
                        <LabeledInput label="تاريخ التعيين" value={form.joinDate} onChange={(v) => set('joinDate', v)} type="date" />
                        <LabeledInput label="رقم الهوية/الإقامة" value={form.iqamaNumber} onChange={(v) => set('iqamaNumber', v)} />
                        <LabeledInput label="الجنسية" value={form.nationality} onChange={(v) => set('nationality', v)} />
                    </>
                ) : null}
                {section === 'documents' ? (
                    <>
                        <LabeledInput label="انتهاء الإقامة" value={form.iqamaExpiry} onChange={(v) => set('iqamaExpiry', v)} type="date" />
                        <LabeledInput label="انتهاء الشهادة الصحية" value={form.healthCertExpiry} onChange={(v) => set('healthCertExpiry', v)} type="date" />
                        <LabeledInput label="انتهاء الشهادة التعليمية" value={form.healthEduExpiry} onChange={(v) => set('healthEduExpiry', v)} type="date" />
                    </>
                ) : null}
                {section === 'bank' ? (
                    <>
                        <LabeledInput label="IBAN الحساب البنكي" value={form.iban} onChange={(v) => set('iban', v)} />
                        <LabeledInput label="رقم التأمينات (GOSI)" value={form.gosi_number} onChange={(v) => set('gosi_number', v)} />
                    </>
                ) : null}
                {section === 'work' ? (
                    <>
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
                    </>
                ) : null}
                {section === 'device' ? (
                    <>
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
                    </>
                ) : null}
                {error ? <p role="alert" className="text-body-sm text-danger-text">{error}</p> : null}
            </div>
            <Button type="button" onClick={() => void save()} disabled={busy} className="w-full">
                {busy ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}
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
