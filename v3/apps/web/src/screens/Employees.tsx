import './Employees.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import {
    Card,
    StateEmpty,
    StateError,
    StateLoading,
    TableScroll,
    TableSkeleton,
} from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { fetchEmployees } from '../lib/employees';
import {
    employeeToRow,
    fetchHrDepartments,
    cardExtrasMap,
    initialsOf,
    validPhotoSrc,
    shiftSummary,
    type EmployeeExtras,
    type EmployeeRow,
    searchEmployees,
    employeeTotals,
    statusCounts,
    deptCounts,
    departmentCodeMap,
    MAX_PAGES,
    PAGE_SIZE as SERVER_PAGE_SIZE,
    type HrDepartment,
} from '../lib/employees';
import { fetchAttendanceRange, todayIso, attendanceMinutes, weekdayAr } from '../lib/attendance';
import {
    ATT_STATE,
    fetchAttendanceReport,
    minutesCell,
    rangeReportRows,
    type RangeModel,
} from '../lib/employee-card';
import {
    createEmployee,
    deleteEmployee,
    setEmployeeActive,
    updateEmployee,
    employeeActivateConfirm,
    employeeDeactivateConfirm,
    employeeDeleteConfirm,
    EMPLOYEE_TEXT,
    type EmployeeCreateInput,
    type EmployeeUpdateInput,
    employeeWriteVisible,
    employeeDeleteVisible,
} from '../lib/employees-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

/**
 * دليل الموظفين — CRUD كامل مثل V2 (عرض بطاقات/جدول):
 *  • إنشاء موظف (POST /api/employees — admin|manager|hr)
 *  • تعديل بيانات (PATCH /api/employees/:id — admin|manager|hr)
 *  • إيقاف/تفعيل الموظف (PATCH /api/employees/:id/active — admin|manager|hr)
 *  • حذف نهائي (DELETE /api/employees/:id — أدمن فقط)
 *  • طباعة القائمة (PrintActions)
 *  • عرض «بطاقات» افتراضيًا مرآة V2 (`data-v2-view`، محفوظ في localStorage):
 *    بطاقة avatar/اسم/كود/حالة/قسم/وظيفة/هاتف، الراتب لبطاقات الأدوار
 *    المرتفعة فقط (admin|manager|hr — نفس استثناء الخصوصية في القديم)،
 *    وسطر الوردية والبصمة وحضور اليوم. الضغط على البطاقة يفتح الملف
 *    (حوار كشف)، بينما الجدول يبقى كما هو.
 *
 * القراءة من `/api/employees` مع ربط القسم عبر `hrDepartments`.
 * الراتب والإقامة والبصمة لا تُعرض في صفوف الجدول أبدًا.
 */

const PAGE_SIZE_LOCAL = 25;
const CARD_PAGE_SIZE = 12;

/** عرض البطاقات/الجدول — محفوظ مثل V2 (`VIEW_KEY = 'v2-employees-view'`). */
const EMPLOYEES_VIEW_KEY = 'erp-employees-view';

type RosterView = 'cards' | 'table';

function readRosterView(): RosterView {
    try {
        const raw = localStorage.getItem(EMPLOYEES_VIEW_KEY);
        return raw === 'table' ? 'table' : 'cards';
    } catch {
        return 'cards';
    }
}

type SortKey = 'code' | 'name' | 'dept' | 'status';

function formatInt(value: number): string {
    return value.toLocaleString('en-US');
}

function Kpi({ label, english, value, hint }: { label: string; english: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg border border-hairline bg-surface p-md shadow-card">
            <p className="text-label-md text-muted">
                {label}{' '}
                <span className="text-caption text-faint" dir="ltr" lang="en">{english}</span>
            </p>
            <p className="erp-numeric mt-xs text-heading-lg text-ink" dir="ltr">
                {value}
            </p>
            <p className="mt-xxs text-caption text-muted">{hint}</p>
        </div>
    );
}

function SortableTh({
    label,
    sortKey,
    sort,
    onToggle,
}: {
    label: string;
    sortKey: SortKey;
    sort: { key: SortKey; dir: 'asc' | 'desc' } | null;
    onToggle: (key: SortKey) => void;
}) {
    const ariaSort = sort?.key !== sortKey ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending';
    return (
        <th scope="col" aria-sort={ariaSort} className="px-sm py-xs text-start font-medium">
            <button type="button" onClick={() => onToggle(sortKey)}>
                {label}
            </button>
        </th>
    );
}

function compare(a: EmployeeRow, b: EmployeeRow, key: SortKey): number {
    if (key === 'code') {
        return a.code.localeCompare(b.code, 'ar', { numeric: true });
    }
    if (key === 'dept') {
        return a.dept.localeCompare(b.dept, 'ar');
    }
    if (key === 'status') {
        return a.statusLabel.localeCompare(b.statusLabel, 'ar');
    }
    return a.name.localeCompare(b.name, 'ar');
}

const POSITION_OPTIONS = [
    { value: 'cashier', label: 'كاشير' },
    { value: 'waiter', label: 'نادل' },
    { value: 'chef', label: 'شيف' },
    { value: 'kitchen_helper', label: 'مساعد مطبخ' },
    { value: 'warehouse', label: 'أمين مخزن' },
    { value: 'cleaner', label: 'عامل نظافة' },
    { value: 'security', label: 'أمن' },
    { value: 'manager', label: 'مدير' },
    { value: 'hr', label: 'موظف موارد بشرية' },
    { value: 'accountant', label: 'محاسب' },
    { value: 'employee', label: 'موظف' },
] as const;

const STATUS_OPTIONS = [
    { value: 'active', label: 'نشط' },
    { value: 'inactive', label: 'موقوف' },
] as const;

/* ── نموذج إضافة/تعديل موظف ───────────────────────────────────────────── */

interface EmployeeFormDialogProps {
    open: boolean;
    onClose: () => void;
    pending: boolean;
    editing: EmployeeRow | null;
    departments: { code: string; name: string }[];
    onSave: (payload: EmployeeCreateInput | EmployeeUpdateInput, editing: boolean) => Promise<void>;
}

const EMPLOYEE_FORM_ID = 'erp-employees-form';

function EmployeeFormDialog({ open, onClose, pending, editing, departments, onSave }: EmployeeFormDialogProps) {
    const [form, setForm] = useState<{
        employeeId: string;
        name: string;
        department: string;
        position: string;
        phone: string;
        status: string;
    }>({
        employeeId: '',
        name: '',
        department: '',
        position: '',
        phone: '',
        status: 'active',
    });
    const [formError, setFormError] = useState('');

    useEffect(() => {
        if (!open) {
            return;
        }
        if (editing) {
            setForm({
                employeeId: editing.code,
                name: editing.name,
                department: editing.deptCode,
                position: editing.position ?? '',
                phone: editing.phone ?? '',
                status: editing.status ? 'active' : 'inactive',
            });
        } else {
            setForm({ employeeId: '', name: '', department: '', position: '', phone: '', status: 'active' });
        }
        setFormError('');
    }, [open, editing]);

    async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setFormError('');
        if (!form.employeeId.trim()) {
            setFormError(EMPLOYEE_TEXT.employeeIdRequired);
            return;
        }
        if (!form.name.trim()) {
            setFormError(EMPLOYEE_TEXT.nameRequired);
            return;
        }
        if (!form.position.trim()) {
            setFormError(EMPLOYEE_TEXT.positionRequired);
            return;
        }
        if (!form.phone.trim()) {
            setFormError(EMPLOYEE_TEXT.phoneRequired);
            return;
        }

        const input: EmployeeCreateInput | EmployeeUpdateInput = {
            employeeId: form.employeeId.trim(),
            name: form.name.trim(),
            department: form.department.trim() || null,
            position: form.position.trim(),
            phone: form.phone.trim(),
            status: form.status as 'active' | 'inactive',
        };

        try {
            await onSave(input, Boolean(editing));
            onClose();
        } catch (cause) {
            setFormError(writeErrorMessage(cause, editing ? EMPLOYEE_TEXT.updateFailed : EMPLOYEE_TEXT.createFailed));
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={editing ? 'تعديل بيانات الموظف' : 'موظف جديد'}
            size="lg"
            footer={
                <>
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                        {EMPLOYEE_TEXT.cancel}
                    </Button>
                    <Button type="submit" form={EMPLOYEE_FORM_ID} size="sm" loading={pending}>
                        {editing ? 'حفظ التعديل' : 'إضافة الموظف'}
                    </Button>
                </>
            }
        >
            <form id={EMPLOYEE_FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-sm">
                <div className="grid gap-sm sm:grid-cols-2">
                    <Input
                        label="كود الموظف"
                        name="employeeId"
                        value={form.employeeId}
                        onChange={(e) => setForm((prev) => ({ ...prev, employeeId: e.target.value }))}
                        readOnly={Boolean(editing)}
                        maxLength={20}
                        placeholder="EMP-001"
                        required
                    />
                    <Input
                        label="الاسم completo"
                        name="name"
                        value={form.name}
                        onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="أحمد محمد علي"
                        required
                    />
                    <Select
                        label="القسم"
                        name="department"
                        value={form.department}
                        onValueChange={(value) => setForm((prev) => ({ ...prev, department: String(value ?? '') }))}
                        options={departments.map((d) => ({ label: d.name, value: d.code }))}
                    />
                    <Select
                        label="الوظيفة"
                        name="position"
                        value={form.position}
                        onValueChange={(value) => setForm((prev) => ({ ...prev, position: String(value ?? '') }))}
                        options={POSITION_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
                        required
                    />
                    <Input
                        label="رقم الهاتف"
                        name="phone"
                        value={form.phone}
                        onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                        placeholder="+20 12 345 6789"
                        required
                    />
                    <Select
                        label="الحالة"
                        name="status"
                        value={form.status}
                        onValueChange={(value) => setForm((prev) => ({ ...prev, status: String(value ?? 'active') }))}
                        options={STATUS_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
                        required
                    />
                </div>
                {formError ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {formError}
                    </p>
                ) : null}
            </form>
        </Dialog>
    );
}

/* ── نموذج تأكيد الإيقاف/التفعيل/الحذف ───────────────────────────────── */

interface EmployeeActionDialogProps {
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onClose: () => void;
    pending: boolean;
    confirmLabel: string;
    variant: 'secondary' | 'danger';
}

function EmployeeActionDialog({
    open,
    title,
    message,
    onConfirm,
    onClose,
    pending,
    confirmLabel,
    variant,
}: EmployeeActionDialogProps) {
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={title}
            size="md"
        >
            <p className="text-body-md text-ink">{message}</p>
            <div className="flex justify-end gap-sm" data-erp-print-hide>
                <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                    {EMPLOYEE_TEXT.cancel}
                </Button>
                <Button type="button" size="sm" variant={variant} loading={pending} onClick={onConfirm}>
                    {confirmLabel}
                </Button>
            </div>
        </Dialog>
    );
}

/* ── بطاقة الموظف (مرآة `erp-person` في V2) ──────────────────────────────── */

type TodayMap = ReadonlyMap<string, { checkIn: string | null; checkOut: string | null; onLeave: boolean }>;

function todayBitsLine(attendanceToday: TodayMap, row: EmployeeRow, ex: EmployeeExtras): string {
    if (!attendanceToday.size) {
        return 'لا بصمة اليوم';
    }
    const a = attendanceToday.get(String(row.id));
    const hasIn = Boolean(a?.checkIn);
    const hasOut = Boolean(a?.checkOut);
    if (a?.onLeave) {
        return 'إجازة';
    }
    const off = ex.day_off;
    if (!a && off !== null && off === new Date().getDay()) {
        return 'راحة أسبوعية';
    }
    if (hasIn && hasOut) {
        return 'انصرف';
    }
    if (hasIn) {
        return 'داخل الآن';
    }
    if (hasOut) {
        return 'بلا حضور';
    }
    return 'لا بصمة اليوم';
}

function minutesToHM(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return `${h}:${String(m).padStart(2, '0')}`;
}

function EmployeeCard({
    row,
    extras,
    attendanceToday,
    showSalary,
    index,
    onOpen,
}: {
    row: EmployeeRow;
    extras: EmployeeExtras | null;
    attendanceToday: TodayMap;
    showSalary: boolean;
    index: number;
    onOpen: (row: EmployeeRow) => void;
}) {
    const photo = validPhotoSrc(extras?.photo ?? '');
    const sh = extras
        ? shiftSummary({
              shift_start: extras.shift_start,
              shift_karim: extras.shift_karim,
              auto_checkout: extras.auto_checkout,
              auto_lock: extras.auto_lock,
              day_off: extras.day_off,
          })
        : null;
    const fp = extras?.deviceUserId
        ? { dot: 'erp-dot erp-dot--success', label: `بصمة ${extras.deviceUserId}` }
        : { dot: 'erp-dot erp-dot--warning', label: 'بلا بصمة' };
    const today = todayBitsLine(attendanceToday, row, extras ?? {
        salary: null, photo: '', deviceUserId: '', shift_start: '', shift_karim: 0,
        auto_checkout: false, auto_lock: false, day_off: null,
        email: '', joinDate: '', iqamaExpiry: '', healthCertExpiry: '', healthEduExpiry: '', cardId: '',
    });
    const att = attendanceToday.get(String(row.id));
    const mins = att ? attendanceMinutes({ checkIn: att.checkIn, checkOut: att.checkOut, workMinutes: null }) : null;
    const hasTimes = Boolean(att?.checkIn || att?.checkOut);
    const attTone = att?.onLeave ? 'neutral' : today === 'انصرف' ? 'success' : today === 'داخل الآن' ? 'info' : today === 'بلا حضور' ? 'warning' : 'none';

    const expiryChip = (label: string, value: string): { label: string; tone: 'danger' | 'warning' | null } | null => {
        if (!value) {
            return null;
        }
        const day = value.slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
            return { label: `${label}: ${day}`, tone: null };
        }
        const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
        const diffDays = Math.round((new Date(`${day}T00:00:00Z`).getTime() - new Date(`${now}T00:00:00Z`).getTime()) / 86400000);
        if (diffDays < 0) {
            return { label: `${label} منتهي (${day})`, tone: 'danger' };
        }
        if (diffDays <= 60) {
            return { label: `${label} ينتهي خلال ${diffDays} يوم (${day})`, tone: 'warning' };
        }
        return { label: `${label}: ${day}`, tone: null };
    };
    const expiryChips = extras
        ? [
              expiryChip('الإقامة', extras.iqamaExpiry),
              expiryChip('الصحي', extras.healthCertExpiry),
              expiryChip('التعليم الصحي', extras.healthEduExpiry),
          ].filter((chip): chip is { label: string; tone: 'danger' | 'warning' | null } => Boolean(chip))
        : [];

    return (
        <li
            className="erp-person"
            data-status={row.status === 'active' ? 'active' : 'inactive'}
            style={{ ['--erp-card-i' as string]: index }}
        >
            <button
                type="button"
                className="erp-person__head erp-person__open"
                onClick={() => onOpen(row)}
                aria-label={`فتح كشف ${row.name}`}
            >
                {photo ? (
                    <span className="erp-avatar" aria-hidden="true">
                        <img src={photo} alt="" loading="lazy" />
                    </span>
                ) : (
                    <span className="erp-avatar" aria-hidden="true">
                        {initialsOf(row.name)}
                    </span>
                )}
                <span className="erp-person__who">
                    <span className="erp-person__name">{row.name}</span>
                    <span className="erp-person__code" dir="ltr">
                        {row.code}
                    </span>
                </span>
                <span
                    className={`erp-person__status ${row.status === 'active' ? 'erp-person__status--active' : 'erp-person__status--inactive'}`}
                >
                    {row.statusLabel}
                </span>
            </button>
            <div className="erp-person__facts">
                <div className="erp-person__fact">
                    <span className="erp-person__fact-label">القسم</span>
                    <span>{row.dept}</span>
                </div>
                <div className="erp-person__fact">
                    <span className="erp-person__fact-label">الوظيفة</span>
                    <span>{row.position}</span>
                </div>
                <div className="erp-person__fact">
                    <span className="erp-person__fact-label">الهاتف</span>
                    <span className="erp-numeric" dir="ltr">
                        {row.phone}
                    </span>
                </div>
                {extras?.email ? (
                    <div className="erp-person__fact">
                        <span className="erp-person__fact-label">البريد</span>
                        <span dir="ltr">{extras.email}</span>
                    </div>
                ) : null}
                {extras?.joinDate ? (
                    <div className="erp-person__fact">
                        <span className="erp-person__fact-label">تاريخ التعيين</span>
                        <span className="erp-numeric" dir="ltr">
                            {extras.joinDate.slice(0, 10)}
                        </span>
                    </div>
                ) : null}
                {extras?.cardId ? (
                    <div className="erp-person__fact">
                        <span className="erp-person__fact-label">رقم البطاقة</span>
                        <span className="erp-numeric" dir="ltr">
                            {extras.cardId}
                        </span>
                    </div>
                ) : null}
                {showSalary ? (
                    <div className="erp-person__fact">
                        <span className="erp-person__fact-label">الراتب</span>
                        <span className="erp-numeric" dir="ltr">
                            {extras?.salary !== null && extras?.salary !== undefined ? extras.salary : '—'}
                        </span>
                    </div>
                ) : null}
            </div>
            {expiryChips.length ? (
                <div className="erp-person__meta" aria-label="تواريخ الانتهاء">
                    {expiryChips.map((chip) => (
                        <span
                            key={chip.label}
                            className={`erp-person__shift ${chip.tone === 'danger' ? 'erp-person__chip--danger' : chip.tone === 'warning' ? 'erp-person__chip--warning' : ''}`}
                        >
                            {chip.label}
                        </span>
                    ))}
                </div>
            ) : null}
            {sh ? (
                <div className="erp-person__meta">
                    <span className="erp-person__shift">
                        <span className="erp-person__shift-lbl">الوردية</span>
                        <span className="erp-numeric" dir="ltr">
                            {sh.start}
                        </span>
                        <span>
                            · {sh.hours}
                            {sh.overnight ? ' ليلي' : ''}
                        </span>
                    </span>
                    {sh.auto ? <span className="erp-person__shift">انصراف تلقائي</span> : null}
                    {sh.locked ? <span className="erp-person__shift">مقفل</span> : null}
                    {sh.off ? <span className="erp-person__shift">راحة: {sh.off}</span> : null}
                </div>
            ) : null}
            <div className="erp-person__meta">
                <span className="erp-person__shift">
                    <span className={fp.dot} aria-hidden="true" />
                    <span>{fp.label}</span>
                </span>
            </div>
            <div className={`erp-person__att${hasTimes ? '' : ' erp-person__att--bare'}`} data-tone={attTone}>
                <span className="erp-person__att-chip">{today}</span>
                {hasTimes ? (
                    <div className="erp-person__att-cells">
                        <div className="erp-person__att-cell">
                            <span className="erp-person__att-lbl">دخول</span>
                            <span className="erp-person__att-val erp-numeric" dir="ltr">
                                {att?.checkIn ?? '—'}
                            </span>
                        </div>
                        <div className="erp-person__att-cell">
                            <span className="erp-person__att-lbl">خروج</span>
                            <span className="erp-person__att-val erp-numeric" dir="ltr">
                                {att?.checkOut ?? '—'}
                            </span>
                        </div>
                        <div className="erp-person__att-cell">
                            <span className="erp-person__att-lbl">صافي</span>
                            <span className="erp-person__att-val erp-numeric" dir="ltr">
                                {mins !== null ? `${minutesToHM(mins)} س` : '—'}
                            </span>
                        </div>
                    </div>
                ) : null}
            </div>
        </li>
    );
}

/* ── كشف أيام الحضور والانصراف (مرآة V2: attRangeBlock/attRangeHtml) ────── */

function AttendanceRangeSection({
    employeeId,
    dayOff,
}: {
    employeeId: string;
    dayOff: number | null;
}) {
    const today = todayIso();
    const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
    const [to, setTo] = useState(today);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [model, setModel] = useState<RangeModel | null>(null);
    const [note, setNote] = useState('');

    const loaded = useMemo(
        () => Boolean(model),
        [model],
    );

    async function load(kind: 'day' | 'range') {
        setNote('');
        setError('');
        let nextFrom = today;
        let nextTo = today;
        if (kind !== 'day') {
            nextFrom = from;
            nextTo = to;
            if (!nextFrom || !nextTo) {
                setNote('اختر تاريخ البداية والنهاية');
                return;
            }
            if (nextTo < nextFrom) {
                setNote('تاريخ النهاية يسبق تاريخ البداية');
                return;
            }
        }
        setFrom(nextFrom);
        setTo(nextTo);
        setLoading(true);
        try {
            const report = await fetchAttendanceReport(employeeId, nextFrom, nextTo);
            setModel(rangeReportRows(report, dayOff));
        } catch (cause) {
            setError(writeErrorMessage(cause, 'تعذّر قراءة الكشف'));
            setModel(null);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void load('range');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [employeeId]);

    const s = model?.summary;
    const stat = (label: string, value: string) => (
        <span className="erp-emp-stat">
            <span className="erp-numeric erp-emp-stat__v" dir="ltr">
                {value}
            </span>
            <span className="erp-emp-stat__l">{label}</span>
        </span>
    );
    const minutesCellHtml = (v: number) => (
        <span className="erp-numeric" dir="ltr">
            {minutesCell(v)}
        </span>
    );
    const delayCell = (r: {
        arrivalLateRaw: number;
        earlyLeaveRaw: number;
        lateMinutes: number;
        withinGrace: boolean;
    }) => {
        const parts: React.ReactNode[] = [];
        if (r.arrivalLateRaw > 0) {
            parts.push(<span key="in">دخول {minutesCellHtml(r.arrivalLateRaw)}</span>);
        }
        if (r.earlyLeaveRaw > 0) {
            parts.push(<span key="out">انصراف {minutesCellHtml(r.earlyLeaveRaw)}</span>);
        }
        if (!parts.length) {
            return <span className="text-muted">—</span>;
        }
        const counted =
            r.lateMinutes > 0 && r.lateMinutes !== r.arrivalLateRaw + r.earlyLeaveRaw ? (
                <>
                    {' · محسَب '}
                    {minutesCellHtml(r.lateMinutes)}
                </>
            ) : null;
        return (
            <span className={`erp-emp-delay${r.withinGrace ? ' erp-emp-delay--grace' : ''}`}>
                {parts.reduce<React.ReactNode[]>((acc, part, i) => (i === 0 ? [part] : [...acc, ' · ', part]), [])}
                {counted}
            </span>
        );
    };

    return (
        <section className="erp-emp-sec-block" aria-label="أيام الحضور والانصراف">
            <h4 className="erp-emp-sec">
                أيام الحضور والانصراف{' '}
                <span className="text-caption text-muted" dir="ltr" lang="en">
                    Attendance
                </span>
            </h4>
            <div className="erp-emp-att flex flex-wrap items-end gap-sm">
                <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                    من
                    <input
                        type="date"
                        className="h-10 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink erp-numeric"
                        dir="ltr"
                        max={today}
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                    />
                </label>
                <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                    إلى
                    <input
                        type="date"
                        className="h-10 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink erp-numeric"
                        dir="ltr"
                        max={today}
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                    />
                </label>
                <Button type="button" size="sm" variant="secondary" loading={loading} onClick={() => void load('day')}>
                    كشف اليوم
                </Button>
                <Button type="button" size="sm" variant="secondary" loading={loading} onClick={() => void load('range')}>
                    كشف الفترة
                </Button>
            </div>
            {note ? (
                <p role="alert" className="text-body-sm text-danger-text">
                    {note}
                </p>
            ) : null}
            {loading ? <p className="text-body-sm text-muted">جارٍ قراءة الكشف…</p> : null}
            {error ? <p className="text-body-sm text-danger-text">{error}</p> : null}
            {model && s ? (
                <>
                    <h5 className="text-heading-sm text-ink">
                        كشف <span className="erp-numeric" dir="ltr">{s.from}</span> —{' '}
                        <span className="erp-numeric" dir="ltr">{s.to}</span>
                    </h5>
                    <div className="erp-emp-stats">
                        {stat('أيام حضور', formatInt(s.daysPresent))}
                        {stat('أيام مكتملة', formatInt(s.completeDays))}
                        {stat('عليها تأخير', formatInt(s.rawLateDays))}
                        {stat('أيام تأخير محسوبة', formatInt(s.lateDays))}
                        {stat('تأخير فعلي', s.totalRawLateMinutes > 0 ? minutesToHM(s.totalRawLateMinutes) : '—')}
                        {stat('تأخير محسوب', s.totalLateMinutes > 0 ? minutesToHM(s.totalLateMinutes) : '—')}
                        {stat('إجمالي الساعات', String(s.totalKarim))}
                    </div>
                    {model.truncated ? (
                        <p className="text-body-sm text-muted">الكشف مقترب على 62 يومًا كحدّ أعلى.</p>
                    ) : null}
                    <div className="erp-table__scroll erp-emp-att__scroll" tabIndex={0}>
                        <table className="erp-table__grid">
                            <thead>
                                <tr>
                                    <th scope="col">التاريخ</th>
                                    <th scope="col">اليوم</th>
                                    <th scope="col">الحضور</th>
                                    <th scope="col">الانصراف</th>
                                    <th scope="col">الساعات</th>
                                    <th scope="col">التأخير</th>
                                    <th scope="col">الحالة</th>
                                </tr>
                            </thead>
                            <tbody>
                                {model.rows.length ? (
                                    model.rows.map((r) => {
                                        const st = ATT_STATE[r.state] ?? ATT_STATE.review;
                                        return (
                                            <tr key={r.date}>
                                                <td>
                                                    <span className="erp-numeric" dir="ltr">
                                                        {r.date}
                                                    </span>
                                                </td>
                                                <td className="text-muted">{weekdayAr(r.date)}</td>
                                                <td>
                                                    <span className="erp-numeric" dir="ltr">
                                                        {r.checkIn || '—'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="erp-numeric" dir="ltr">
                                                        {r.checkOut || '—'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="erp-numeric" dir="ltr">
                                                        {minutesToHM(r.minutes)}
                                                    </span>
                                                </td>
                                                <td>{delayCell(r)}</td>
                                                <td>
                                                    <span className="erp-badge" data-tone={st.tone}>
                                                        {st.label}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr>
                                        <td colSpan={7} className="text-muted">
                                            لا أيام في هذه الفترة
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {loaded && model.rows.length > 0 ? (
                        <p className="text-caption text-muted" hidden>
                            كشف {s.from} — {s.to}
                        </p>
                    ) : null}
                </>
            ) : null}
        </section>
    );
}

/* ── حوار كشف الموظف ────────────────────────────────────────────────────── */

interface EmployeeProfileDialogProps {
    row: EmployeeRow | null;
    extras: EmployeeExtras | null;
    showSalary: boolean;
    canWrite: boolean;
    canDelete: boolean;
    onClose: () => void;
    onEdit: () => void;
    onChangeStatus: (activate: boolean) => void;
    onDelete: () => void;
}

function EmployeeProfileDialog({
    row,
    extras,
    showSalary,
    canWrite,
    canDelete,
    onClose,
    onEdit,
    onChangeStatus,
    onDelete,
}: EmployeeProfileDialogProps) {
    const photo = validPhotoSrc(extras?.photo ?? '');
    const sh = extras
        ? shiftSummary({
              shift_start: extras.shift_start,
              shift_karim: extras.shift_karim,
              auto_checkout: extras.auto_checkout,
              auto_lock: extras.auto_lock,
              day_off: extras.day_off,
          })
        : null;
    return (
        <Dialog
            open={Boolean(row)}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={`كشف الموظف — ${row?.name ?? ''}`}
            size="lg"
        >
            {row ? (
                <div className="flex flex-col gap-md">
                    <div className="flex items-center gap-md">
                        {photo ? (
                            <span className="erp-avatar erp-avatar--lg" aria-hidden="true">
                                <img src={photo} alt="" />
                            </span>
                        ) : (
                            <span className="erp-avatar erp-avatar--lg" aria-hidden="true">
                                {initialsOf(row.name)}
                            </span>
                        )}
                        <div className="min-w-0">
                            <p className="text-heading-md text-ink">{row.name}</p>
                            <p className="erp-numeric text-body-sm text-muted" dir="ltr">
                                {row.code}
                            </p>
                            <span
                                className={`erp-person__status mt-xxs inline-block ${row.status === 'active' ? 'erp-person__status--active' : 'erp-person__status--inactive'}`}
                            >
                                {row.statusLabel}
                            </span>
                        </div>
                    </div>
                    <dl className="grid gap-sm sm:grid-cols-2">
                        <div>
                            <dt className="text-caption text-muted">القسم</dt>
                            <dd className="text-body-md text-ink">{row.dept}</dd>
                        </div>
                        <div>
                            <dt className="text-caption text-muted">الوظيفة</dt>
                            <dd className="text-body-md text-ink">{row.position}</dd>
                        </div>
                        <div>
                            <dt className="text-caption text-muted">الهاتف</dt>
                            <dd className="erp-numeric text-body-md text-ink" dir="ltr">
                                {row.phone}
                            </dd>
                        </div>
                        {showSalary ? (
                            <div>
                                <dt className="text-caption text-muted">الراتب</dt>
                                <dd className="erp-numeric text-body-md text-ink" dir="ltr">
                                    {extras?.salary !== null && extras?.salary !== undefined ? extras.salary : '—'}
                                </dd>
                            </div>
                        ) : null}
                        <div>
                            <dt className="text-caption text-muted">البصمة</dt>
                            <dd className="text-body-md text-ink">
                                {extras?.deviceUserId ? `مسجّلة (${extras.deviceUserId})` : 'بلا بصمة'}
                            </dd>
                        </div>
                        {sh ? (
                            <div>
                                <dt className="text-caption text-muted">الوردية</dt>
                                <dd className="text-body-md text-ink" dir="ltr">
                                    {sh.start} · {sh.hours}س{sh.overnight ? ' (ليلي)' : ''}
                                </dd>
                            </div>
                        ) : null}
                    </dl>
                    <AttendanceRangeSection employeeId={row.id} dayOff={extras?.day_off ?? null} />
                    {(canWrite || canDelete) && (
                        <div className="flex flex-wrap items-center gap-xs border-t border-hairline pt-sm" data-erp-print-hide>
                            {canWrite ? (
                                <>
                                    <Button type="button" size="sm" variant="secondary" onClick={onEdit}>
                                        تعديل
                                    </Button>
                                    {row.status === 'active' ? (
                                        <Button type="button" size="sm" variant="secondary" onClick={() => onChangeStatus(false)}>
                                            إيقاف
                                        </Button>
                                    ) : (
                                        <Button type="button" size="sm" variant="secondary" onClick={() => onChangeStatus(true)}>
                                            تفعيل
                                        </Button>
                                    )}
                                </>
                            ) : null}
                            {canDelete ? (
                                <Button type="button" size="sm" variant="danger" onClick={onDelete}>
                                    حذف
                                </Button>
                            ) : null}
                        </div>
                    )}
                </div>
            ) : null}
        </Dialog>
    );
}

/* ── الشاشة ───────────────────────────────────────────────────────────── */

export function Employees() {
    const auth = useAuthState();
    const canWrite = employeeWriteVisible(auth.user?.role);
    const canDelete = employeeDeleteVisible(auth.user?.role);
    const showSalary = ['admin', 'manager', 'hr'].includes(String(auth.user?.role ?? '').toLowerCase());

    const [view, setView] = useState<RosterView>(() => readRosterView());
    const [profileRow, setProfileRow] = useState<EmployeeRow | null>(null);

    useEffect(() => {
        try {
            localStorage.setItem(EMPLOYEES_VIEW_KEY, view);
        } catch {
            /* وضع خاص — التفضيل يبقى في الذاكرة */
        }
    }, [view]);

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<EmployeeRow | null>(null);
    const [actionOpen, setActionOpen] = useState(false);
    const [actionRow, setActionRow] = useState<EmployeeRow | null>(null);
    const [actionType, setActionType] = useState<'activate' | 'deactivate' | 'delete'>('deactivate');
    const [actionTitle, setActionTitle] = useState('');
    const [actionMessage, setActionMessage] = useState('');

    const [query, setQuery] = useState('');
    const [dept, setDept] = useState('');
    const [status, setStatus] = useState('');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
    const [page, setPage] = useState(1);

    const employeesQuery = useQuery({
        queryKey: ['employees'],
        queryFn: ({ signal }) => fetchEmployees(signal),
    });
    const departmentsQuery = useQuery({
        queryKey: ['hr-departments'],
        queryFn: ({ signal }) => fetchHrDepartments(signal),
        staleTime: 10 * 60 * 1000,
    });

    const deptByCode = useMemo(() => departmentCodeMap(departmentsQuery.data ?? []), [departmentsQuery.data]);
    const extrasMap = useMemo(() => cardExtrasMap(employeesQuery.data ?? []), [employeesQuery.data]);
    const allRows = useMemo(
        () => (employeesQuery.data ?? []).map((employee) => employeeToRow(employee, deptByCode)),
        [employeesQuery.data, deptByCode],
    );

    const today = todayIso();
    const todayAttendanceQuery = useQuery({
        queryKey: ['employees', 'attendance-today', today],
        queryFn: ({ signal }) => fetchAttendanceRange({ from: today, to: today, signal }),
        enabled: view === 'cards',
        staleTime: 60 * 1000,
    });

    /** حضور اليوم — مفتاح رقم الموظف، الأكمل (دخول وخروج) يغلب عند التكرار. */
    const attendanceToday: TodayMap = useMemo(() => {
        const map = new Map<string, { checkIn: string | null; checkOut: string | null; onLeave: boolean }>();
        for (const rec of todayAttendanceQuery.data?.rows ?? []) {
            if (!rec.employeeId) {
                continue;
            }
            const key = String(rec.employeeId);
            const prev = map.get(key);
            const score = (r: { checkIn: string | null; checkOut: string | null }) =>
                (String(r.checkIn || '') ? 2 : 0) + (String(r.checkOut || '') ? 1 : 0);
            if (!prev || score(rec) > score(prev)) {
                map.set(key, { checkIn: rec.checkIn, checkOut: rec.checkOut, onLeave: rec.onLeave });
            }
        }
        return map;
    }, [todayAttendanceQuery.data]);

    const filteredRows = useMemo(() => {
        return allRows.filter((row) => {
            if (dept === '—') {
                if (row.deptCode !== '') return false;
            } else if (dept && row.deptCode !== dept) {
                return false;
            }
            if (status === '—') {
                if (row.status !== '') return false;
            } else if (status && row.status !== status) {
                return false;
            }
            return true;
        });
    }, [allRows, dept, status]);

    const search = useMemo(() => searchEmployees(filteredRows, query), [filteredRows, query]);
    const rows = search.rows;

    const sorted = useMemo(() => {
        if (!sort) return rows;
        const copy = [...rows].sort((a, b) => compare(a, b, sort.key));
        return sort.dir === 'asc' ? copy : copy.reverse();
    }, [rows, sort]);

    const totals = useMemo(() => employeeTotals(allRows), [allRows]);
    const statuses = useMemo(() => statusCounts(allRows), [allRows]);
    const departments = useMemo(() => deptCounts(allRows), [allRows]);

    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE_LOCAL));
    const safePage = Math.min(page, pageCount);
    const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE_LOCAL, safePage * PAGE_SIZE_LOCAL);

    const cardPageCount = Math.max(1, Math.ceil(sorted.length / CARD_PAGE_SIZE));
    const safeCardPage = Math.min(page, cardPageCount);
    const cardPageRows = sorted.slice((safeCardPage - 1) * CARD_PAGE_SIZE, safeCardPage * CARD_PAGE_SIZE);
    const capped = (employeesQuery.data?.length ?? 0) >= SERVER_PAGE_SIZE * MAX_PAGES;
    const filtered = Boolean(query || dept || status);

    function toggleSort(key: SortKey) {
        setPage(1);
        setSort((previous) =>
            previous?.key === key ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
        );
    }

    function resetFilters() {
        setQuery('');
        setDept('');
        setStatus('');
        setSort(null);
        setPage(1);
    }

    const activeCount = statuses.find((entry) => entry.value === 'active')?.count ?? 0;

    /* ── الكتبات عبر useWriteMutation ────────────────────────────────── */

    const createEmployeeMutation = useWriteMutation<EmployeeCreateInput, { id: string | number }>({
        mutationFn: (input) => createEmployee(input).then((r) => ({ id: r.id })),
        successTitle: () => EMPLOYEE_TEXT.createSuccess,
        invalidate: [['employees'], ['hr-departments']],
        silentError: true,
        onSuccess: () => {
            setFormOpen(false);
            setEditing(null);
        },
    });

    const updateEmployeeMutation = useWriteMutation<{ id: string | number; input: EmployeeUpdateInput }, { id: string | number }>({
        mutationFn: ({ id, input }) => updateEmployee(id, input).then((r) => ({ id: r.id })),
        successTitle: () => EMPLOYEE_TEXT.updateSuccess,
        invalidate: [['employees'], ['hr-departments']],
        silentError: true,
        onSuccess: () => {
            setFormOpen(false);
            setEditing(null);
        },
    });

    const setEmployeeActiveMutation = useWriteMutation<{ id: string | number; active: boolean }, { id: string | number; active: boolean }>({
        mutationFn: ({ id, active }) => setEmployeeActive(id, active).then((r) => ({ id: r.id, active })),
        successTitle: ({ active }) => (active ? EMPLOYEE_TEXT.activateSuccess : EMPLOYEE_TEXT.deactivateSuccess),
        invalidate: [['employees'], ['hr-departments']],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    const deleteEmployeeMutation = useWriteMutation<string | number, void>({
        mutationFn: (id) => deleteEmployee(id),
        successTitle: () => EMPLOYEE_TEXT.deleteSuccess,
        invalidate: [['employees'], ['hr-departments']],
        silentError: true,
        onSuccess: () => {
            setActionOpen(false);
            setActionRow(null);
        },
    });

    async function openForm(row?: EmployeeRow) {
        setEditing(row ?? null);
        setFormOpen(true);
    }

    async function handleChangeStatus(row: EmployeeRow, activate: boolean) {
        setActionRow(row);
        setActionType(activate ? 'activate' : 'deactivate');
        setActionTitle(activate ? 'تفعيل الموظف' : 'إيقاف الموظف');
        setActionMessage(activate ? employeeActivateConfirm(row.name) : employeeDeactivateConfirm(row.name));
        setActionOpen(true);
    }

    async function handleDelete(row: EmployeeRow) {
        setActionRow(row);
        setActionType('delete');
        setActionTitle('حذف الموظف');
        setActionMessage(employeeDeleteConfirm(row.name));
        setActionOpen(true);
    }

    async function confirmAction() {
        if (!actionRow) return;
        if (actionType === 'activate') {
            await setEmployeeActiveMutation.mutateAsync({ id: actionRow.id, active: true });
        } else if (actionType === 'deactivate') {
            await setEmployeeActiveMutation.mutateAsync({ id: actionRow.id, active: false });
        } else if (actionType === 'delete') {
            await deleteEmployeeMutation.mutateAsync(actionRow.id);
        }
    }

    const deptOptions = useMemo(
        () =>
            departmentsQuery.data?.map((d: HrDepartment) => ({ code: d.code, name: d.name ?? '' })) ?? [],
        [departmentsQuery.data],
    );

    return (
        <div className="flex flex-col gap-lg erp-premium erp-premium-employees">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        دليل الموظفين{' '}
                        <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted" dir="ltr" lang="en">
                            Employees
                        </span>
                    </h1>
                    <p className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                        من في الدليل، وفي أي قسم، وبأي حالة — الإضافة والتعديل والإيقاف والتفعيل والحذف مثل الشاشة
                        القديمة. الراتب والإقامة والبصمة لا تُعرض في أي صفّ. القراءة محجوزة في الخادم للأدوار الإدارية،
                        والكتابة لـ admin|manager|hr والحذف للأدمن فقط.
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    {canWrite ? (
                        <Button type="button" size="sm" onClick={() => openForm()}>
                            إضافة موظف
                        </Button>
                    ) : null}
                    <PrintActions title="دليل الموظفين" />
                    <button
                        type="button"
                        onClick={() => {
                            void employeesQuery.refetch();
                            void departmentsQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                    label="إجمالي الدليل"
                    english="Roster"
                    value={formatInt(totals.total)}
                    hint="بلا تكرار ولا تصفية"
                />
                <Kpi
                    label="نشط"
                    english="Active"
                    value={formatInt(activeCount)}
                    hint={`${statuses.find((entry) => entry.value === 'inactive')?.count ?? 0} غير نشط`}
                />
                <Kpi
                    label="الأقسام"
                    english="Departments"
                    value={formatInt(totals.departments)}
                    hint={
                        totals.departments
                            ? `${formatInt(totals.departmentsResolved)} من ${formatInt(totals.departments)} معروفة في دليل HR`
                            : 'لا أقسام في الدليل'
                    }
                />
                <Kpi
                    label="بلا هاتف مسجّل"
                    english="No phone"
                    value={formatInt(totals.noPhone)}
                    hint={totals.noPhone ? 'حقل الهاتف فارغ في قاعدة البيانات' : 'كل موظف له هاتف'}
                />
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm">
                    <div className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                        <span>طريقة العرض</span>
                        <div className="flex gap-xxs" role="group" aria-label="طريقة العرض">
                            <button
                                type="button"
                                aria-pressed={view === 'cards'}
                                onClick={() => setView('cards')}
                                className={`rounded-md border border-hairline-strong px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover ${
                                    view === 'cards' ? 'bg-surface-sunken font-medium' : 'bg-surface'
                                }`}
                            >
                                بطاقات
                            </button>
                            <button
                                type="button"
                                aria-pressed={view === 'table'}
                                onClick={() => setView('table')}
                                className={`rounded-md border border-hairline-strong px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover ${
                                    view === 'table' ? 'bg-surface-sunken font-medium' : 'bg-surface'
                                }`}
                            >
                                جدول
                            </button>
                        </div>
                    </div>
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-employees-q">
                        بحث
                        <input
                            id="erp-employees-q"
                            type="search"
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setPage(1);
                            }}
                            placeholder="اسم، كود، وظيفة، قسم، هاتف"
                            className="h-10 w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-64"
                        />
                    </label>
                    <label
                        className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-employees-dept"
                    >
                        القسم
                        <select
                            id="erp-employees-dept"
                            value={dept}
                            onChange={(event) => {
                                setDept(event.target.value);
                                setPage(1);
                            }}
                            className="h-10 w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-auto"
                        >
                            <option value="">كل الأقسام</option>
                            {departments.map((entry) => (
                                <option key={entry.code || '—'} value={entry.code || '—'}>
                                    {entry.code ? entry.label : 'بلا قسم'}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label
                        className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-employees-status"
                    >
                        الحالة
                        <select
                            id="erp-employees-status"
                            value={status}
                            onChange={(event) => {
                                setStatus(event.target.value);
                                setPage(1);
                            }}
                            className="h-10 w-full min-w-0 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-auto"
                        >
                            <option value="">كل الحالات</option>
                            <option value="active">نشط</option>
                            <option value="inactive">موقوف</option>
                        </select>
                    </label>
                    <button
                        type="button"
                        onClick={resetFilters}
                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                    >
                        مسح المرشّحات
                    </button>
                    <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted" role="status">
                        {formatInt(sorted.length)} موظفًا معروضًا من {formatInt(totals.total)}
                    </span>
                </div>
                {search.folded ? (
                    <p className="mt-sm text-body-sm text-muted">
                        بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.
                    </p>
                ) : null}
            </Card>

            <Card className="p-sm">
                <h2 className="px-sm pt-sm text-heading-sm text-ink">توزيع الموظفين حسب الحالة</h2>
                <ul className="flex flex-col gap-xxs p-sm" aria-label="توزيع الموظفين على الحالات">
                    {statuses.map((entry) => {
                        const share = totals.total ? (entry.count / totals.total) * 100 : 0;
                        const statusLabel =
                            entry.value === 'active'
                                ? 'نشط'
                                : entry.value === 'inactive'
                                  ? 'غير نشط'
                                  : entry.value === 'suspended'
                                    ? 'موقوف'
                                    : entry.value
                                      ? entry.value
                                      : 'غير محدد';
                        const statusColor =
                            entry.value === 'active' ? 'bg-success-text' : 'bg-danger-text';
                        return (
                            <li key={entry.value} className="flex items-center gap-sm text-body-sm">
                                <span className="w-40 shrink-0 truncate text-ink">{statusLabel}</span>
                                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                                    <span
                                        className={`block h-full rounded-full ${statusColor}`}
                                        style={{ width: `${share.toFixed(1)}%` }}
                                    />
                                </span>
                                <span className="erp-numeric w-16 shrink-0 text-end text-ink" dir="ltr">
                                    {formatInt(entry.count)}
                                </span>
                                <span className="erp-numeric w-14 shrink-0 text-end text-caption text-muted" dir="ltr">
                                    {share.toFixed(1)}%
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </Card>

            {view === 'cards' ? (
                <Card>
                    {employeesQuery.isPending ? (
                        <div aria-busy="true">
                            <StateLoading label="جارٍ تحميل بطاقات الموظفين" />
                            <TableSkeleton rows={4} columns={3} />
                        </div>
                    ) : null}

                    {employeesQuery.isError ? (
                        <StateError
                            message={employeesQuery.error instanceof Error ? employeesQuery.error.message : 'خطأ غير معروف'}
                            onRetry={() => {
                                void employeesQuery.refetch();
                            }}
                        />
                    ) : null}

                    {employeesQuery.isSuccess && sorted.length === 0 ? (
                        <StateEmpty
                            title={filtered ? 'لا موظفين يطابقون المرشّحات' : 'دليل الموظفين فارغ'}
                            hint={
                                filtered
                                    ? 'لا نتائج مطابقة؛ عدّل المرشّحات أو امسحها.'
                                    : 'أضف أول موظف.'
                            }
                        />
                    ) : null}

                    {employeesQuery.isSuccess && sorted.length > 0 ? (
                        <>
                            <p className="border-b border-hairline px-sm py-xs text-body-sm text-muted" role="status">
                                {`${formatInt(sorted.length)} موظفًا`}
                                {search.exact ? ` · ${formatInt(search.exact)} مطابقة تامة` : ''}
                                {capped ? ` · الخادم أعاد أول ${formatInt(SERVER_PAGE_SIZE * MAX_PAGES)} موظفًا فقط` : ''}
                            </p>
                            <ul className="erp-cards erp-cards--grid p-sm" aria-label="بطاقات الموظفين">
                                {cardPageRows.map((row, cardIndex) => (
                                    <EmployeeCard
                                        key={row.id}
                                        row={row}
                                        extras={extrasMap.get(String(row.id)) ?? null}
                                        attendanceToday={attendanceToday}
                                        showSalary={showSalary}
                                        index={cardIndex}
                                        onOpen={(opened) => setProfileRow(opened)}
                                    />
                                ))}
                            </ul>
                            <div className="flex items-center justify-between gap-sm border-t border-hairline px-sm py-xs">
                                <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                                    بطاقة {formatInt((safeCardPage - 1) * CARD_PAGE_SIZE + 1)}–
                                    {formatInt(Math.min(safeCardPage * CARD_PAGE_SIZE, sorted.length))} من{' '}
                                    {formatInt(sorted.length)}
                                </span>
                                <div className="flex items-center gap-xs">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setPage(1);
                                        }}
                                        disabled={safeCardPage <= 1}
                                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                    >
                                        الأولى
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setPage(safeCardPage - 1);
                                        }}
                                        disabled={safeCardPage <= 1}
                                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                    >
                                        السابق
                                    </button>
                                    <span className="text-body-sm text-muted" aria-label="أرقام الصفحات">
                                        {formatInt(safeCardPage)} / {formatInt(cardPageCount)}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setPage(safeCardPage + 1);
                                        }}
                                        disabled={safeCardPage >= cardPageCount}
                                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                    >
                                        التالي
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setPage(cardPageCount);
                                        }}
                                        disabled={safeCardPage >= cardPageCount}
                                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                    >
                                        الأخيرة
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : null}
                </Card>
            ) : (
            <Card>
                {employeesQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل دليل الموظفين" />
                        <TableSkeleton rows={6} columns={6} />
                    </div>
                ) : null}

                {employeesQuery.isError ? (
                    <StateError
                        message={employeesQuery.error instanceof Error ? employeesQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void employeesQuery.refetch();
                        }}
                    />
                ) : null}

                {employeesQuery.isSuccess && sorted.length === 0 ? (
                    <StateEmpty
                        title={filtered ? 'لا موظفين يطابقون المرشّحات' : 'دليل الموظفين فارغ'}
                        hint={
                            filtered
                                ? 'لا نتائج مطابقة؛ عدّل المرشّحات أو امسحها.'
                                : 'أضف أول موظف.'
                        }
                    />
                ) : null}

                {employeesQuery.isSuccess && sorted.length > 0 ? (
                    <>
                        <p className="border-b border-hairline px-sm py-xs text-body-sm text-muted" role="status">
                            {`${formatInt(sorted.length)} موظفًا`}
                            {search.exact ? ` · ${formatInt(search.exact)} مطابقة تامة` : ''}
                            {capped ? ` · الخادم أعاد أول ${formatInt(SERVER_PAGE_SIZE * MAX_PAGES)} موظفًا فقط` : ''}
                        </p>
                        <TableScroll label="جدول دليل الموظفين">
                            <table className="w-full min-w-[760px] border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <SortableTh label="الكود" sortKey="code" sort={sort} onToggle={toggleSort} />
                                        <SortableTh label="الاسم" sortKey="name" sort={sort} onToggle={toggleSort} />
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            القسم
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الوظيفة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الهاتف
                                        </th>
                                        <SortableTh label="الحالة" sortKey="status" sort={sort} onToggle={toggleSort} />
                                        {(canWrite || canDelete) && (
                                            <th scope="col" className="px-sm py-xs text-start font-medium" data-erp-print-hide>
                                                إجراءات
                                            </th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row) => (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                {row.code || '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-ink">{row.name}</td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">
                                                {row.deptCode || '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">
                                                {row.position || '—'}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                {row.phone || '—'}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm">
                                                <span className={row.status === 'active' ? 'text-success-text' : 'text-muted'}>
                                                    {row.statusLabel}
                                                </span>
                                            </td>
                                            {(canWrite || canDelete) && (
                                                <td className="px-sm py-xxs" data-erp-print-hide>
                                                    <div className="flex flex-wrap items-center gap-xs">
                                                        {canWrite ? (
                                                            <>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    variant="secondary"
                                                                    title="تعديل البيانات"
                                                                    onClick={() => openForm(row)}
                                                                >
                                                                    تعديل
                                                                </Button>
                                                                {row.status === 'active' ? (
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant="secondary"
                                                                        title="إيقاف الموظف"
                                                                        onClick={() => handleChangeStatus(row, false)}
                                                                    >
                                                                        إيقاف
                                                                    </Button>
                                                                ) : (
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant="secondary"
                                                                        title="تفعيل الموظف"
                                                                        onClick={() => handleChangeStatus(row, true)}
                                                                    >
                                                                        تفعيل
                                                                    </Button>
                                                                )}
                                                            </>
                                                        ) : null}
                                                        {canDelete ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="danger"
                                                                title="حذف الموظف"
                                                                onClick={() => handleDelete(row)}
                                                            >
                                                                حذف
                                                            </Button>
                                                        ) : null}
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>

                        <div className="flex items-center justify-between gap-sm border-t border-hairline px-sm py-xs">
                            <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                                صفحة {formatInt(safePage)} من {formatInt(pageCount)}
                            </span>
                            <div className="flex gap-xs">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPage(safePage - 1);
                                    }}
                                    disabled={safePage <= 1}
                                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                >
                                    السابق
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPage(safePage + 1);
                                    }}
                                    disabled={safePage >= pageCount}
                                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                >
                                    التالي
                                </button>
                            </div>
                        </div>
                    </>
                ) : null}
            </Card>
            )}

            {/* Dialogs */}
            <EmployeeFormDialog
                open={formOpen}
                onClose={() => setFormOpen(false)}
                pending={createEmployeeMutation.isPending || updateEmployeeMutation.isPending}
                editing={editing}
                departments={deptOptions}
                onSave={async (input, isEditing) => {
                    if (isEditing && editing) {
                        await updateEmployeeMutation.mutateAsync({ id: editing.id, input: input as EmployeeUpdateInput });
                    } else {
                        await createEmployeeMutation.mutateAsync(input as EmployeeCreateInput);
                    }
                }}
            />
            <EmployeeActionDialog
                open={actionOpen}
                title={actionTitle}
                message={actionMessage}
                onConfirm={confirmAction}
                onClose={() => {
                    setActionOpen(false);
                    setActionRow(null);
                }}
                pending={setEmployeeActiveMutation.isPending || deleteEmployeeMutation.isPending}
                confirmLabel={
                    actionType === 'activate'
                        ? 'تفعيل'
                        : actionType === 'deactivate'
                          ? 'إيقاف'
                          : 'حذف'
                }
                variant={actionType === 'delete' ? 'danger' : 'secondary'}
            />
            <EmployeeProfileDialog
                row={profileRow}
                extras={profileRow ? extrasMap.get(String(profileRow.id)) ?? null : null}
                showSalary={showSalary}
                canWrite={canWrite}
                canDelete={canDelete}
                onClose={() => setProfileRow(null)}
                onEdit={() => {
                    if (profileRow) {
                        setEditing(profileRow);
                        setFormOpen(true);
                        setProfileRow(null);
                    }
                }}
                onChangeStatus={(activate) => {
                    if (profileRow) {
                        setProfileRow(null);
                        void handleChangeStatus(profileRow, activate);
                    }
                }}
                onDelete={() => {
                    if (profileRow) {
                        setProfileRow(null);
                        void handleDelete(profileRow);
                    }
                }}
            />
        </div>
    );
}
