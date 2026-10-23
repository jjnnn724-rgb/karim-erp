/**
 * V2 — Payroll suite repository (أبواب منظومة الرواتب الكاملة)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM features/hr.js:733-987, NOT INVENTED
 *   POST /hr/payroll-runs/generate {month, includeOvertime} → {count,
 *     totals.net} (runPayrollGen :810-823: تأكيدان — الأوفرتايم ثم التوليد)
 *   GET  /hr/deductions/preview?month&skip_fridays → {month, totals,
 *     employees[{name,salary,daysPresent,lateMinutes,lateDeduction,
 *     absentDays,absentDeduction,totalDeduction}], skipFridays} (:843-870)
 *   POST /hr/deductions/apply {month, skipFridays} → {insertedRows,
 *     totalAmount} (:871-885: يستبدل الآلي السابق، اليدوي لا يُمس)
 *   CRUD العام: salary_advances {employeeId,amount,monthly_deduction,
 *     remaining,status,date} · payroll_adjustments {employeeId,month,kind,
 *     amount,reason} · employee_contracts {employeeId,start_date,end_date,
 *     salary} · employee_evaluations {employeeId,period,score,notes,
 *     evaluator} (:894-974)
 */

import { apiFetch } from '../../core/api.js?v=4.9.130';
import { fetchEmployees } from './employees-repo.js?v=4.9.130';
import { fetchAttendanceRange } from './attendance-repo.js?v=4.9.130';

/** الكتابة مرآة القديم (hr.js:779): admin/manager/hr. */
export const PAYROLL_WRITE_ROLES = ['admin', 'manager', 'hr'];

/** كشف الرواتب: النشطون + عدّ حضور الشهر الحالي. */
export async function fetchPayrollSheet(monthIso = '') {
    const [emps, att] = await Promise.all([
        fetchEmployees(),
        fetchAttendanceRange(monthIso
            ? { from: `${monthIso}-01`, to: monthEnd(monthIso) }
            : { from: currentMonthStart(), to: todayIso() }),
    ]);
    const rows = Array.isArray(att.rows) ? att.rows : (Array.isArray(att) ? att : []);
    const active = (Array.isArray(emps) ? emps : []).filter((e) => e && e.status === 'active');
    return {
        employees: active,
        monthDays: countByEmp(rows),
    };
}

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

function currentMonthStart() {
    return todayIso().slice(0, 7) + '-01';
}

function monthEnd(monthIso) {
    const [y, m] = String(monthIso).split('-').map(Number);
    return new Date(y, m, 0).toISOString().slice(0, 10);
}

function countByEmp(rows) {
    const map = new Map();
    for (const a of rows || []) {
        if (!a || !a.checkIn) {continue;}
        const k = String(a.employeeId);
        map.set(k, (map.get(k) || 0) + 1);
    }
    return map;
}

export async function generatePayrollRun({ month, includeOvertime }) {
    if (!/^\d{4}-\d{2}$/.test(String(month || ''))) {throw new Error('اختر الشهر');}
    return apiFetch('/hr/payroll-runs/generate', {
        method: 'POST', body: JSON.stringify({ month, includeOvertime: !!includeOvertime }),
    });
}

export async function fetchDeductionsPreview({ month, skipFridays }) {
    if (!/^\d{4}-\d{2}$/.test(String(month || ''))) {throw new Error('اختر الشهر');}
    return apiFetch(`/hr/deductions/preview?month=${encodeURIComponent(month)}&skip_fridays=${skipFridays ? '1' : '0'}`);
}

export async function applyDeductions({ month, skipFridays }) {
    return apiFetch('/hr/deductions/apply', {
        method: 'POST', body: JSON.stringify({ month, skipFridays: !!skipFridays }),
    });
}

function crud(entity) {
    return {
        create: (payload) => apiFetch(`/${entity}`, { method: 'POST', body: JSON.stringify(payload) }),
        remove: (id) => apiFetch(`/${entity}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    };
}

export const advancesApi = crud('salary_advances');
export const adjustmentsApi = crud('payroll_adjustments');
export const contractsApi = crud('employee_contracts');
export const evaluationsApi = crud('employee_evaluations');

export async function fetchSuiteLists() {
    const get = async (entity, fallback = []) => {
        try {
            const r = await apiFetch(`/${entity}?page=1&limit=1000&sort=id&order=desc`);
            const rows = r && Array.isArray(r.data) ? r.data : (Array.isArray(r) ? r : fallback);
            return Array.isArray(rows) ? rows : fallback;
        } catch {return fallback;}
    };
    const [advances, adjustments, contracts, evaluations] = await Promise.all([
        get('salary_advances'), get('payroll_adjustments'),
        get('employee_contracts'), get('employee_evaluations'),
    ]);
    return { advances, adjustments, contracts, evaluations };
}

/** فحص السلفة — مرآة hr.js:899 (موظف + مبلغ + تاريخ). */
export function validateAdvance({ employeeId, amount, date }) {
    if (!employeeId || !(Number(amount) > 0) || !date) {return 'أكمل البيانات';}
    return '';
}

/** فحص البند — مرآة hr.js:923. */
export function validateAdjustment({ employeeId, month, amount }) {
    if (!employeeId || !/^\d{4}-\d{2}$/.test(String(month || '')) || !(Number(amount) > 0)) {return 'أكمل البيانات';}
    return '';
}

/** فحص العقد — مرآة hr.js:941. */
export function validateContract({ employeeId, start_date, end_date }) {
    if (!employeeId || !start_date || !end_date || end_date < start_date) {return 'تواريخ غير صالحة';}
    return '';
}

/** فحص التقييم — مرآة hr.js:967. */
export function validateEvaluation({ employeeId, period, score }) {
    if (!employeeId || !/^\d{4}-\d{2}$/.test(String(period || '')) || !(Number(score) >= 1 && Number(score) <= 5)) {return 'أكمل البيانات';}
    return '';
}
