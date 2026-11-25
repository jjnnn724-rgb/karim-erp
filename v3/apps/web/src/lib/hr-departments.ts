import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

export const HR_DEPARTMENT_WRITE_ROLES = ['admin', 'manager', 'hr'] as const;
export const HR_DEPARTMENT_WRITE_FLAG = 'v2hrdeptwrite';
export const HR_DEPARTMENT_PAGE_LIMIT = 8;
const PAGE_SIZE = 1000;

const departmentSchema = z
    .object({
        id: z.union([z.string(), z.number()]),
        code: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        manager: z.string().nullable().optional(),
    })
    .passthrough();

type Paged<T> = T[] | { data: T[]; pagination?: { totalPages?: number | undefined } | undefined };

function pagedSchema<T extends z.ZodTypeAny>(rowSchema: T): z.ZodType<Paged<z.infer<T>>> {
    return z.union([
        z.array(rowSchema),
        z
            .object({
                data: z.array(rowSchema),
                pagination: z.object({ totalPages: z.number().optional() }).passthrough().optional(),
            })
            .passthrough(),
    ]);
}

const departmentsResponseSchema = pagedSchema(departmentSchema);

const employeeSchema = z
    .object({
        id: z.union([z.string(), z.number()]),
        department: z.string().nullable().optional(),
    })
    .passthrough();

const employeesResponseSchema = pagedSchema(employeeSchema);

const unknownResponse = z.unknown();

export type HrEmployee = z.infer<typeof employeeSchema>;

export type HrDepartment = {
    id: string;
    code: string;
    name: string;
    manager: string;
    employeeCount: number;
};

function toDepartment(raw: z.infer<typeof departmentSchema>): Omit<HrDepartment, 'employeeCount'> {
    return {
        id: String(raw.id),
        code: raw.code ? String(raw.code) : '',
        name: raw.name ? String(raw.name) : '—',
        manager: raw.manager ? String(raw.manager) : '—',
    };
}

function pageRows<T>(response: Paged<T>): {
    rows: T[];
    totalPages: number;
} {
    if (Array.isArray(response)) {
        return { rows: response, totalPages: 0 };
    }
    return { rows: response.data, totalPages: response.pagination?.totalPages ?? 0 };
}

async function fetchPages<T>(url: (page: number) => string, schema: z.ZodType<Paged<T>>, signal?: AbortSignal): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; page <= HR_DEPARTMENT_PAGE_LIMIT; page += 1) {
        const response = await fetchJson(schema, url(page), getAccessToken(), signal ? { signal } : {});
        const batch = pageRows<T>(response);
        rows.push(...batch.rows);
        if (batch.rows.length < PAGE_SIZE || (batch.totalPages > 0 && page >= batch.totalPages)) {
            break;
        }
    }
    return rows;
}

export async function fetchHrDepartments(signal?: AbortSignal) {
    const rows = await fetchPages<z.infer<typeof departmentSchema>>(
        (page) => `/api/hrDepartments?page=${String(page)}&limit=${String(PAGE_SIZE)}&sort=id&order=desc`,
        departmentsResponseSchema,
        signal,
    );
    return rows.map(toDepartment);
}

export async function fetchHrEmployees(signal?: AbortSignal): Promise<HrEmployee[]> {
    const rows = await fetchPages<HrEmployee>(
        (page) => `/api/employees?page=${String(page)}&limit=${String(PAGE_SIZE)}&sort=id&order=desc`,
        employeesResponseSchema,
        signal,
    );
    return rows;
}

export function withEmployeeCounts(
    departments: readonly Omit<HrDepartment, 'employeeCount'>[],
    employees: readonly HrEmployee[],
): HrDepartment[] {
    const counts = new Map<string, number>();
    for (const employee of employees) {
        if (employee.department) {
            const code = String(employee.department);
            counts.set(code, (counts.get(code) ?? 0) + 1);
        }
    }
    return departments.map((department) => ({
        ...department,
        employeeCount: counts.get(department.code) ?? 0,
    }));
}

export function hrDepartmentWriteEnabled(search?: string, stored?: string | null): boolean {
    const query = search ?? (typeof window === 'undefined' ? '' : window.location.search);
    const match = new RegExp(`(?:^|[?&])${HR_DEPARTMENT_WRITE_FLAG}=([^&]*)`).exec(query);
    if (match) {
        return match[1] !== '0';
    }
    let persisted = stored;
    if (persisted === undefined && typeof window !== 'undefined') {
        try {
            persisted = window.localStorage.getItem('karim_v2_hr_department_write');
        } catch {
            persisted = null;
        }
    }
    return persisted === '1';
}

function clean(value: string): string {
    return value.trim();
}

export function safeHrCode(code: string, stamp = Date.now()): string {
    const normalized = clean(code).toUpperCase();
    if (normalized && !/[^A-Za-z0-9_-]/.test(normalized)) {
        return normalized.slice(0, 20);
    }
    return `HRD-${Number(stamp).toString(36).toUpperCase().slice(-6)}`;
}

export type HrDepartmentForm = {
    name: string;
    code: string;
    manager: string;
};

export type HrDepartmentPayload = { name: string; manager: string | null } & { code?: string };

export function validateHrDepartmentForm(
    form: HrDepartmentForm,
    editing: boolean,
    stamp?: number,
): { ok: true; payload: HrDepartmentPayload } | { ok: false; message: string } {
    const name = clean(form.name);
    const code = clean(form.code).toUpperCase();
    if (!name) {
        return { ok: false, message: 'اسم القسم مطلوب.' };
    }
    if (name.length > 150) {
        return { ok: false, message: 'اسم القسم أطول من الحد المسموح (150 حرفًا).' };
    }
    if (editing) {
        return { ok: true, payload: { name, manager: clean(form.manager) || null } };
    }
    return {
        ok: true,
        payload: {
            name,
            code: safeHrCode(code, stamp),
            manager: clean(form.manager) || null,
        },
    };
}

export async function createHrDepartment(payload: HrDepartmentPayload): Promise<void> {
    await fetchJson(unknownResponse, '/api/hrDepartments', getAccessToken(), { method: 'POST', body: payload });
}

export async function updateHrDepartment(id: string, payload: HrDepartmentPayload): Promise<void> {
    await fetchJson(unknownResponse, `/api/hrDepartments/${encodeURIComponent(id)}`, getAccessToken(), {
        method: 'PUT',
        body: payload,
    });
}

export async function deleteHrDepartment(id: string): Promise<void> {
    await fetchJson(unknownResponse, `/api/hrDepartments/${encodeURIComponent(id)}`, getAccessToken(), {
        method: 'DELETE',
    });
}
