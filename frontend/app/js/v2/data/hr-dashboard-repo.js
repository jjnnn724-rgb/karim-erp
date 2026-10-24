/**
 * V2 — HR dashboard repository (باب التجميع للوحة الموارد)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * NO NEW ENDPOINT. This door composes four proven doors — the same sources
 * the legacy HR dashboard reads (features/hr.js:8-18 renderHRDashboard):
 *   employees (directory) + attendance range (last 7 days: the KPI counts
 *   today, the weekly chart counts the same window) + the leave approval
 *   chain + hrDepartments, via their own repo modules. Each source is
 *   optional: allSettled, and the screen names what answered.
 *   The leave source is /hr/leave-workflow, NOT the generic leaveRequests
 *   register: the register is unscoped (every authenticated account would
 *   pull everyone's requests), while this door scopes by role server-side
 *   (leave-workflow-routes.js:100-112) — see leaves-repo.js for the full
 *   contract. The rows still carry the stored leaveRequests.status, which is
 *   what the legacy card arithmetic counts.
 * Money unit: the stored settings currency (reports-repo door), because
 * the salary total is meaningless without it.
 *
 * THIS FILE NEVER WRITES. No POST/PUT/DELETE here by construction.
 */

import { fetchEmployees, fetchDepartments } from './employees-repo.js?v=4.9.151';
import { fetchAttendanceRange } from './attendance-repo.js?v=4.9.151';
import { fetchLeaveWorkflow } from './leaves-repo.js?v=4.9.151';
import { fetchCurrency, formatMoney, formatInt } from './reports-repo.js?v=4.9.151';

export { formatMoney, formatInt };

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** Local YYYY-MM-DD (device calendar — same basis as the legacy today()). */
export function todayLocal(d = new Date()) {
    const x = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(x.getTime())) {return '';}
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** Day arithmetic on the calendar day, noon-anchored so DST cannot shift it. */
export function shiftDay(day, delta) {
    const d = new Date(`${String(day).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) {return String(day || '').slice(0, 10);}
    d.setDate(d.getDate() + Number(delta || 0));
    return todayLocal(d);
}

/** Oldest→newest inclusive window, ending at `day`. */
export function lastNDays(day, n = 7) {
    const count = Math.max(1, Math.floor(Number(n) || 7));
    return Array.from({ length: count }, (_, i) => shiftDay(day, i - (count - 1)));
}

/**
 * @returns {Promise<{employees:any[],attendance:any[],leaves:any[],departments:any[],currency:string,day:string,failures:string[]}>}
 */
export async function fetchHrSnapshot() {
    const day = todayLocal();
    const settled = await Promise.allSettled([
        fetchEmployees(),
        fetchAttendanceRange({ from: shiftDay(day, -6), to: day }),
        fetchLeaveWorkflow(),
        fetchDepartments().catch(() => []),
        fetchCurrency().catch(() => ''),
    ]);
    const ok = (i) => (settled[i].status === 'fulfilled' ? settled[i].value : null);
    const failures = [];
    const names = ['دليل الموظفين', 'حضور اليوم', 'سلسلة اعتماد الإجازات', 'الأقسام', 'وحدة المال'];
    settled.forEach((s, i) => {
        if (s.status === 'rejected') {
            failures.push(`${names[i]}: ${(s.reason && s.reason.message) || 'لم يستجب'}`);
        }
    });
    return {
        employees: ok(0) || [],
        attendance: (ok(1) && ok(1).rows) || [],
        leaves: ok(2) || [],
        departments: ok(3) || [],
        currency: String(ok(4) ?? ''),
        day,
        failures,
    };
}

/**
 * Pure view model from the snapshot — the legacy card arithmetic
 * (features/hr.js:9-15), stated per card. Exported for tests.
 */
export function buildHrKpis({ employees = [], attendance = [], leaves = [], departments = [], currency = '', day = '' } = {}) {
    const active = employees.filter((e) => e && e.status === 'active');
    const present = attendance.filter((a) => a && a.date === day && a.checkIn);
    const late = present.filter((a) => a.late);
    const pending = leaves.filter((l) => l && l.status === 'pending');
    const salaries = employees.reduce((s, e) => s + num(e.salary), 0);
    const absent = Math.max(0, active.length - present.length);
    const m = (v) => formatMoney(v, currency);
    return [
        { id: 'staff', icon: 'users', label: 'الموظفون', en: 'Staff', value: formatInt(employees.length), unit: '', pill: null, hint: `نشط ${formatInt(active.length)}` },
        { id: 'present', icon: 'circle-check', label: 'الحاضرون اليوم', en: 'Present', value: formatInt(present.length), unit: '', pill: null, hint: `من ${formatInt(active.length)} نشط` },
        { id: 'absent', icon: 'circle-x', label: 'لم يحضروا', en: 'Absent', value: formatInt(absent), unit: '', pill: null, hint: day || 'اليوم' },
        { id: 'late', icon: 'clock', label: 'متأخرون اليوم', en: 'Late', value: formatInt(late.length), unit: '', pill: null, hint: 'حضور بعد الموعد' },
        { id: 'pending', icon: 'hourglass', label: 'إجازات معلقة', en: 'Pending Leaves', value: formatInt(pending.length), unit: '', pill: null, hint: 'بانتظار القرار' },
        { id: 'payroll', icon: 'banknote', label: 'إجمالي الرواتب', en: 'Payroll Total', value: m(salaries).amount, unit: m(salaries).hasUnit ? m(salaries).unit : '', pill: null, hint: 'مجموع رواتب دليل الموظفين' },
        { id: 'depts', icon: 'building', label: 'أقسام HR', en: 'Departments', value: formatInt(departments.length), unit: '', pill: null, hint: 'من دليل الأقسام' },
    ];
}

/**
 * Employee count per department name — the legacy doughnut counted
 * `STATE.employees` by `department` against `STATE.hrDepartments`.
 * Unknown codes stay visible as the code rather than being dropped.
 * @returns {{label:string,value:number}[]} largest first
 */
export function departmentDistribution(employees = [], departments = []) {
    const names = new Map((Array.isArray(departments) ? departments : [])
        .map((d) => [String((d && d.code) ?? ''), String((d && d.name) || (d && d.code) || '')]));
    const counts = new Map();
    (Array.isArray(employees) ? employees : []).forEach((e) => {
        const code = e && e.department != null ? String(e.department).trim() : '';
        const label = code ? (names.get(code) || code) : 'بدون قسم';
        counts.set(label, (counts.get(label) || 0) + 1);
    });
    return [...counts.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);
}

/** Present count per day for the same 7-day window the snapshot fetched. */
export function weeklyAttendance(attendance = [], day = '') {
    const rows = Array.isArray(attendance) ? attendance : [];
    return lastNDays(day, 7).map((date) => ({
        date,
        present: rows.filter((a) => a && String(a.date || '').slice(0, 10) === date && a.checkIn).length,
    }));
}

/** Pending leaves with employee names, newest 6 — mirrors the legacy table. *  The joined name from the door is preferred; the directory map is the
 *  fallback, because the door is what actually answered. */
export function pendingLeaveRows(leaves = [], empById = new Map(), limit = 6) {
    return leaves
        .filter((l) => l && l.status === 'pending')
        .slice(0, limit)
        .map((l) => {
            const emp = empById.get(String(l.employeeId));
            const name = l.employee_name ? String(l.employee_name) : (emp && emp.name ? String(emp.name) : '');
            return {
                id: l.id,
                employee: name || (l.employeeId ? `#${l.employeeId}` : '—'),
                start: l.startDate ? String(l.startDate).slice(0, 10) : '',
                end: l.endDate ? String(l.endDate).slice(0, 10) : '',
            };
        });
}
