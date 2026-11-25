import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken, getAppKey } from './auth';

/**
 * موظفو القسم — `GET /api/hr/dept-employees` (رئيس القسم، ونطاقه محسوم على
 * الخادم من `dept_code`).
 *
 * حقول آمنة فقط: الاسم/الرقم الوظيفي/الوظيفة/الهاتف — الراتب والحالة
 * والقسم والحسابات صلاحيات hr/admin، فلا تُطلب أصلًا هنا.
 *
 * الشاشة قراءة فقط: الإضافة والتعديل والتعطيل تبقى في القديم.
 */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const text = z.string().nullable().optional();

export const deptEmployeeSchema = z
    .object({
        id: idValue,
        name: text,
        employeeId: text,
        position: text,
        phone: text,
        department: text,
        status: text,
    })
    .passthrough();

export type DeptEmployee = z.infer<typeof deptEmployeeSchema>;

export const deptEmployeesResponseSchema = z
    .object({
        depts: z.array(z.string()).nullable().optional(),
        employees: z.array(deptEmployeeSchema).nullable().optional(),
    })
    .passthrough();

export interface DeptEmployeesPayload {
    depts: string[];
    employees: DeptEmployee[];
}

export async function fetchDeptEmployees(signal?: AbortSignal): Promise<DeptEmployeesPayload> {
    const body = await fetchJson(deptEmployeesResponseSchema, '/api/hr/dept-employees', getAccessToken(), signal ? { signal } : {});
    return {
        depts: (body.depts ?? []).map((dept) => String(dept)),
        employees: body.employees ?? [],
    };
}

/** تطبيع بحث عربي — همزات وتاء مربوطة وألف مقصورة وتشكيل ومسافات. */
export function normalizeSearch(value: string): string {
    return String(value || '')
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/[ىئ]/g, 'ي')
        .replace(/\s+/g, ' ')
        .trim();
}

export function searchDeptEmployees(rows: readonly DeptEmployee[], query: string): DeptEmployee[] {
    const key = normalizeSearch(query);
    if (!key) {
        return [...rows];
    }
    return rows.filter((row) =>
        [row.name, row.employeeId, row.position, row.phone]
            .map((field) => normalizeSearch(String(field ?? '')))
            .some((field) => field.includes(key)),
    );
}

export function statusLabel(status: string): string {
    const key = String(status || '');
    if (key === 'active') {
        return 'نشط';
    }
    if (key === 'inactive') {
        return 'موقوف';
    }
    return key || '—';
}

/** V2 write contract: server independently enforces role and department scope. */
export const DEPT_EMP_WRITE_ROLES = ['dept_head'] as const;
export function canWriteDeptEmployees(role: string | null | undefined): boolean {
    return role === 'dept_head';
}
export interface DeptEmployeeForm {
    name: string;
    employeeId: string;
    position?: string;
    phone?: string;
}
export function validateDeptEmployeeForm(form: Partial<DeptEmployeeForm>): string[] {
    const name = String(form.name || '').trim();
    const employeeId = String(form.employeeId || '').trim();
    const errors: string[] = [];
    if (!name || !employeeId) errors.push('الاسم والرقم الوظيفي إجباريان');
    if (employeeId && !/^[A-Za-z0-9_-]{2,50}$/.test(employeeId)) {
        errors.push('الرقم الوظيفي: حروف لاتينية/أرقام فقط (2-50)');
    }
    return errors;
}
function normalizeDeptEmployeeForm(form: DeptEmployeeForm) {
    const cut = (value: unknown, length: number) =>
        String(value || '')
            .trim()
            .slice(0, length);
    return {
        name: cut(form.name, 255),
        employeeId: cut(form.employeeId, 50),
        position: cut(form.position, 255) || null,
        phone: cut(form.phone, 50) || null,
    };
}
async function writeDeptEmployee(path: string, method: 'POST' | 'PUT' | 'DELETE', form?: DeptEmployeeForm): Promise<unknown> {
    const response = await fetch(`/api${path}`, {
        method,
        headers: {
            Accept: 'application/json',
            ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
            ...(getAppKey() ? { 'x-api-key': getAppKey() as string } : {}),
            ...(form ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(form ? { body: JSON.stringify(normalizeDeptEmployeeForm(form)) } : {}),
    });
    if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
            const body = (await response.json()) as { message?: string };
            message = body.message || message;
        } catch {
            /* non-JSON error */
        }
        throw new Error(message);
    }
    try {
        return await response.json();
    } catch {
        return null;
    }
}
export function createDeptEmployee(form: DeptEmployeeForm): Promise<unknown> {
    return writeDeptEmployee('/hr/dept-employees', 'POST', form);
}
export function updateDeptEmployee(id: string, form: DeptEmployeeForm): Promise<unknown> {
    return writeDeptEmployee(`/hr/dept-employees/${encodeURIComponent(id)}`, 'PUT', form);
}
export function deactivateDeptEmployee(id: string): Promise<unknown> {
    return writeDeptEmployee(`/hr/dept-employees/${encodeURIComponent(id)}`, 'DELETE');
}
