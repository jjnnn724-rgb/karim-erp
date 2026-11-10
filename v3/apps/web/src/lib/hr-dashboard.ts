import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { num, shiftIsoDays, todayIso } from './reporting';

/**
 * لوحة الموارد البشرية — تجميعٌ من خمسة أبواب قائمة، لا بابٍ جديد:
 * `/api/employees` + `/api/attendance/range` (آخر ٧ أيام) +
 * `/api/hr/leave-workflow` (نطاقه محسوم على الخادم) + `/api/hrDepartments` +
 * `/api/settings/main_settings` (وحدة المال).
 *
 * كل مصدر اختياري: فشلُ واحد يُسمّى في `failures` وتُعرض البقية — لا صفرٌ
 * يبدو بيانات. ولا كتابة هنا إطلاقًا.
 */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const text = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();
const maybeId = z.union([z.string(), z.number()]).nullable().optional();

export const hrEmployeeSchema = z
    .object({
        id: idValue,
        name: text,
        status: text,
        salary: numLike,
        department: text,
    })
    .passthrough();
export type HrEmployee = z.infer<typeof hrEmployeeSchema>;

export const hrAttendanceSchema = z
    .object({
        id: idValue,
        employeeId: maybeId,
        date: text,
        checkIn: text,
        late: z.boolean().nullable().optional(),
        lateMinutes: numLike,
    })
    .passthrough();
export type HrAttendance = z.infer<typeof hrAttendanceSchema>;

export const hrLeaveSchema = z
    .object({
        id: idValue,
        employeeId: maybeId,
        status: text,
        employee_name: text,
        startDate: text,
        endDate: text,
    })
    .passthrough();
export type HrLeave = z.infer<typeof hrLeaveSchema>;

export const hrDepartmentSchema = z
    .object({
        code: text,
        name: text,
    })
    .passthrough();
export type HrDepartmentLite = z.infer<typeof hrDepartmentSchema>;

const employeeListSchema = z.object({ data: z.array(hrEmployeeSchema) }).passthrough();
const attendanceRangeSchema = z.object({ data: z.array(hrAttendanceSchema) }).passthrough();
const departmentListSchema = z.object({ data: z.array(hrDepartmentSchema) }).passthrough();

/** الردّ قد يكون مصفوفة أو `{data}` — كما في القديم. */
const leaveListSchema = z
    .union([z.array(hrLeaveSchema), z.object({ data: z.array(hrLeaveSchema) }).passthrough()])
    .transform((body) => (Array.isArray(body) ? body : body.data));

const settingsSchema = z
    .union([
        z.object({ currency: z.string().nullable().optional() }).passthrough(),
        z.array(z.object({ currency: z.string().nullable().optional() }).passthrough()),
    ])
    .transform((body) => {
        const row = Array.isArray(body) ? body[0] : body;
        return row?.currency ? String(row.currency) : '';
    });

export interface HrSnapshot {
    employees: HrEmployee[];
    attendance: HrAttendance[];
    leaves: HrLeave[];
    departments: HrDepartmentLite[];
    currency: string;
    today: string;
    from: string;
    failures: string[];
}

/** يقرأ اللقطة كاملة؛ كل مصدرٍ فاشل يُسمّى ولا يُسقط الباقي. */
export async function fetchHrSnapshot(signal?: AbortSignal): Promise<HrSnapshot> {
    const today = todayIso();
    const from = shiftIsoDays(today, -6);
    const token = getAccessToken();
    const options = signal ? { signal } : {};
    const names = ['دليل الموظفين', 'حضور الأسبوع', 'سلسلة اعتماد الإجازات', 'أقسام HR', 'وحدة المال'];
    const settled = await Promise.allSettled([
        fetchJson(employeeListSchema, '/api/employees?page=1&limit=1000&sort=id&order=asc', token, options),
        fetchJson(
            attendanceRangeSchema,
            `/api/attendance/range?from=${from}&to=${today}&limit=5000`,
            token,
            options,
        ),
        fetchJson(leaveListSchema, '/api/hr/leave-workflow', token, options),
        fetchJson(
            departmentListSchema,
            '/api/hrDepartments?page=1&limit=1000&sort=id&order=asc',
            token,
            options,
        ),
        fetchJson(settingsSchema, '/api/settings/main_settings', token, options),
    ]);
    const failures: string[] = [];
    settled.forEach((result, index) => {
        if (result.status === 'rejected') {
            const reason = result.reason instanceof Error ? result.reason.message : 'لم يستجب';
            failures.push(`${names[index] ?? 'مصدر'}: ${reason}`);
        }
    });
    const value = <T>(index: number, fallback: T): T =>
        settled[index]?.status === 'fulfilled' ? (settled[index].value as T) : fallback;
    return {
        employees: value<{ data: HrEmployee[] }>(0, { data: [] }).data,
        attendance: value<{ data: HrAttendance[] }>(1, { data: [] }).data,
        leaves: value<HrLeave[]>(2, []),
        departments: value<{ data: HrDepartmentLite[] }>(3, { data: [] }).data,
        currency: value<string>(4, ''),
        today,
        from,
        failures,
    };
}

export interface HrKpi {
    id: string;
    label: string;
    english: string;
    value: string;
    hint: string;
    tone: 'neutral' | 'success' | 'warning' | 'danger';
}

export function buildHrKpis(snapshot: HrSnapshot): HrKpi[] {
    const active = snapshot.employees.filter((employee) => String(employee.status ?? '') === 'active');
    const todays = snapshot.attendance.filter((record) => String(record.date ?? '') === snapshot.today);
    const present = todays.filter((record) => Boolean(record.checkIn));
    const late = present.filter(
        (record) => (record.lateMinutes !== null && record.lateMinutes !== undefined && num(record.lateMinutes) > 0) || record.late === true,
    );
    const pending = snapshot.leaves.filter((leave) => String(leave.status ?? '') === 'pending');
    const salaries = snapshot.employees.reduce((sum, employee) => sum + num(employee.salary), 0);
    const absent = Math.max(0, active.length - present.length);
    return [
        {
            id: 'staff',
            label: 'الموظفون',
            english: 'Staff',
            value: String(snapshot.employees.length),
            hint: `نشط ${String(active.length)}`,
            tone: 'neutral',
        },
        {
            id: 'present',
            label: 'الحاضرون اليوم',
            english: 'Present',
            value: String(present.length),
            hint: `من ${String(active.length)} نشط`,
            tone: 'success',
        },
        {
            id: 'absent',
            label: 'لم يحضروا',
            english: 'Absent',
            value: String(absent),
            hint: snapshot.today || 'اليوم',
            tone: absent > 0 ? 'warning' : 'neutral',
        },
        {
            id: 'late',
            label: 'متأخرون اليوم',
            english: 'Late',
            value: String(late.length),
            hint: 'حضور بعد الموعد',
            tone: late.length > 0 ? 'warning' : 'neutral',
        },
        {
            id: 'pending',
            label: 'إجازات معلقة',
            english: 'Pending leaves',
            value: String(pending.length),
            hint: 'بانتظار القرار',
            tone: pending.length > 0 ? 'warning' : 'neutral',
        },
        {
            id: 'payroll',
            label: 'إجمالي الرواتب',
            english: 'Payroll total',
            value: `${salaries.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${snapshot.currency}`.trim(),
            hint: 'مجموع رواتب دليل الموظفين',
            tone: 'neutral',
        },
        {
            id: 'depts',
            label: 'أقسام HR',
            english: 'Departments',
            value: String(snapshot.departments.length),
            hint: 'من دليل الأقسام',
            tone: 'neutral',
        },
    ];
}

/** حضور كل يوم في نافذة الأسبوع — بنفس أساس الفلترة (نص التاريخ). */
export function weeklyAttendance(attendance: HrAttendance[], today: string): { date: string; present: number }[] {
    return Array.from({ length: 7 }, (_, index) => shiftIsoDays(today, index - 6)).map((date) => ({
        date,
        present: attendance.filter((record) => String(record.date ?? '') === date && Boolean(record.checkIn)).length,
    }));
}

/** توزيع الموظفين على الأقسام — الأكواد المجهولة تبقى ظاهرة بكودها. */
export function departmentDistribution(
    employees: HrEmployee[],
    departments: HrDepartmentLite[],
): { label: string; value: number }[] {
    const names = new Map<string, string>();
    for (const department of departments) {
        const code = String(department.code ?? '');
        if (code) {
            names.set(code, String(department.name ?? code));
        }
    }
    const counts = new Map<string, number>();
    for (const employee of employees) {
        const code = String(employee.department ?? '').trim();
        const label = code ? (names.get(code) ?? code) : 'بدون قسم';
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);
}

/** طلبات الإجازة المعلقة مع أسماء أصحابها — الأحدث أولًا كما وردت. */
export function pendingLeaveRows(
    leaves: HrLeave[],
    employees: HrEmployee[],
    limit = 6,
): { id: string; employee: string; start: string; end: string }[] {
    const byId = new Map(employees.map((employee) => [String(employee.id), String(employee.name ?? '')]));
    return leaves
        .filter((leave) => String(leave.status ?? '') === 'pending')
        .slice(0, limit)
        .map((leave) => ({
            id: leave.id,
            employee:
                String(leave.employee_name ?? '') ||
                byId.get(String(leave.employeeId ?? '')) ||
                (leave.employeeId ? `#${String(leave.employeeId)}` : '—'),
            start: String(leave.startDate ?? '').slice(0, 10),
            end: String(leave.endDate ?? '').slice(0, 10),
        }));
}
