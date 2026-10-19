/**
 * V2 - HR registers repository (departments + hrDepartments + payroll)
 *  - read-only registers, one door per entity.
 */

import { apiFetch } from '../../core/api.js?v=4.9.169';

export const WALK_PAGES = 8;

async function walk(entity) {
    const rows = [];
    for (let page = 1; page <= WALK_PAGES; page += 1) {
        const res = await apiFetch(`/${entity}?page=${page}&limit=1000&sort=id&order=desc`);
        const batch = res && Array.isArray(res.data) ? res.data
            : (Array.isArray(res) ? res : []);
        rows.push(...batch);
        const totalPages = Number(res && res.pagination && res.pagination.totalPages) || 0;
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < 1000) {break;}
    }
    return rows;
}

export const fetchHrDepartments = () => walk('hrDepartments');
export const fetchPayroll = () => walk('payroll');
export const fetchPayrollRuns = () => walk('payroll_runs');
export const fetchEmployees = () => walk('employees');

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

export function hrDeptToRow(d = {}) {
    return {
        id: d.id,
        code: d.code ? String(d.code) : '',
        name: d.name ? String(d.name) : '—',
        manager: d.manager ? String(d.manager) : '—',
    };
}

export function payrollToRow(p = {}) {
    return {
        id: p.id,
        employee: p.employeeName ? String(p.employeeName) : (p.employeeId ? `#${p.employeeId}` : '—'),
        employeeId: p.employeeId || null,
        month: p.month ? String(p.month) : '',
        basic: num(p.basic ?? p.basicSalary ?? p.salary),
        overtime: num(p.overtime),
        bonuses: num(p.bonuses),
        penalties: num(p.penalties ?? p.deductions),
        advances: num(p.advances),
        net: num(p.net ?? p.netSalary),
        status: p.status ? String(p.status) : '',
    };
}

export function payrollRunToRow(r = {}) {
    return {
        id: r.id,
        month: r.month ? String(r.month) : '',
        basic: num(r.basic ?? r.totalBasic ?? r.basic_total),
        overtime: num(r.overtime),
        bonuses: num(r.bonuses),
        penalties: num(r.penalties),
        advances: num(r.advances),
        net: num(r.net ?? r.net_total),
        status: r.status ? String(r.status) : '',
        count: num(r.employeeCount ?? r.employees),
    };
}
