import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * employee-profile.ts — تجميع بيانات بطاقة الموظف الكاملة (2026-11-21).
 * ────────────────────────────────────────────────────────────────────────────
 * بطاقة الموظف تجمع من أبواب قائمة موجودة (بلا أي باب كتابة جديد):
 *  • الإجازات: `/api/hr/leave-workflow` + `/api/leaveTypes` — تُفلتر بالموظف
 *    في الواجهة (نمط V2 fillLeaves حرفيًا).
 *  • حزمة HR (السلف/التسويات/العقود/التقييمات): قوائم `/api/<entity>` —
 *    تُفلتر بالعميل بـemployeeId (لا باب استعلام فردي موجود — نمط مثبت).
 *  • الوردية المجدولة: `/api/hr/shift-schedule/:employeeId`.
 *  • بطاقة QR: `/api/hr/employees/:id/card` (تتطلب سر QR على الخادم —
 *    تتعامل بنعومة مع غيابه).
 *
 * القراءة فقط — الكتابة في lib/employees-write.ts (updateEmployeeProfile).
 */

const text = z.string().nullable().optional();
const idLike = z.union([z.string(), z.number()]).nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();

/* ── الإجازات ───────────────────────────────────────────────────────────── */

const leaveRowSchema = z
    .object({
        id: idLike,
        employeeId: idLike,
        leaveTypeId: idLike,
        start: text,
        end: text,
        days: numLike,
        status: text,
    })
    .passthrough();

export type EmployeeLeaveRow = z.infer<typeof leaveRowSchema>;

const leaveTypesSchema = z
    .object({ rows: z.array(z.object({ id: idLike, name: text }).passthrough()).optional() })
    .passthrough();

const leaveWorkflowSchema = z.union([z.array(leaveRowSchema), z.object({ rows: z.array(leaveRowSchema).optional() }).passthrough()]);

export interface EmployeeLeave {
    id: string;
    typeName: string;
    start: string;
    end: string;
    days: string;
    status: string;
}

/** آخر إجازات الموظف — تُفلتر وتُرتّب بالعميل (نمط V2). */
export async function fetchEmployeeLeaves(employeeId: string, signal?: AbortSignal): Promise<EmployeeLeave[]> {
    const token = getAccessToken();
    const [workflow, types] = await Promise.all([
        fetchJson(leaveWorkflowSchema, '/api/hr/leave-workflow', token, signal ? { signal } : {}),
        fetchJson(leaveTypesSchema, '/api/leaveTypes', token, signal ? { signal } : {}),
    ]);
    const wfRows = Array.isArray(workflow) ? workflow : (workflow.rows ?? []);
    const typeRows = types.rows ?? [];
    const typeName = (typeId: string) => {
        const match = typeRows.find((row) => String(row.id ?? '') === typeId);
        return match?.name ?? 'إجازة';
    };
    return wfRows
        .filter((row) => String(row.employeeId ?? '') === String(employeeId))
        .sort((a, b) => String(b.start ?? '').localeCompare(String(a.start ?? '')))
        .slice(0, 8)
        .map((row) => ({
            id: String(row.id ?? ''),
            typeName: typeName(String(row.leaveTypeId ?? '')),
            start: String(row.start ?? '—'),
            end: String(row.end ?? '—'),
            days: String(row.days ?? '—'),
            status: String(row.status ?? ''),
        }));
}

/* ── حزمة HR (سلف/تسويات/عقود/تقييمات) ─────────────────────────────────── */

const suiteRowSchema = z
    .object({
        id: idLike,
        employeeId: idLike,
    })
    .passthrough();

export type SuiteRow = z.infer<typeof suiteRowSchema>;

/** قائمة كيان HR مُفلترة على موظف واحد (التقليب الكامل ثم الترشيح بالعميل). */
async function fetchSuiteEntity(entity: string, employeeId: string, signal?: AbortSignal): Promise<SuiteRow[]> {
    const rowsSchema = z.union([z.array(suiteRowSchema), z.object({ rows: z.array(suiteRowSchema).optional() }).passthrough()]);
    const body = await fetchJson(rowsSchema, `/api/${entity}?page=1&limit=1000&sort=id&order=desc`, getAccessToken(), signal ? { signal } : {});
    const rows = Array.isArray(body) ? body : (body.rows ?? []);
    return rows.filter((row) => String(row.employeeId ?? '') === String(employeeId));
}

export type SuiteBundle = {
    advances: SuiteRow[];
    adjustments: SuiteRow[];
    contracts: SuiteRow[];
    evaluations: SuiteRow[];
};

export async function fetchEmployeeSuite(employeeId: string, signal?: AbortSignal): Promise<SuiteBundle> {
    const [advances, adjustments, contracts, evaluations] = await Promise.all([
        fetchSuiteEntity('salary_advances', employeeId, signal),
        fetchSuiteEntity('payroll_adjustments', employeeId, signal),
        fetchSuiteEntity('employee_contracts', employeeId, signal),
        fetchSuiteEntity('employee_evaluations', employeeId, signal),
    ]);
    return { advances, adjustments, contracts, evaluations };
}

/* ── الوردية المجدولة ───────────────────────────────────────────────────── */

export const shiftScheduleSchema = z.object({ schedule: z.unknown().optional() }).passthrough();
export type ShiftSchedule = z.infer<typeof shiftScheduleSchema>;

export async function fetchShiftSchedule(employeeId: string, signal?: AbortSignal): Promise<ShiftSchedule | null> {
    try {
        return await fetchJson(shiftScheduleSchema, `/api/hr/shift-schedule/${encodeURIComponent(employeeId)}`, getAccessToken(), signal ? { signal } : {});
    } catch {
        return null; // الوردية المجدولة اختيارية — غيابها لا يكسر البطاقة.
    }
}

/* ── بطاقة QR ───────────────────────────────────────────────────────────── */

export const qrCardSchema = z
    .object({
        qrAvailable: z.unknown().optional(),
        message: text,
        employee: z.unknown().optional(),
    })
    .passthrough();

export type QrCard = z.infer<typeof qrCardSchema>;

export async function fetchQrCard(employeeId: string, signal?: AbortSignal): Promise<QrCard | null> {
    try {
        return await fetchJson(qrCardSchema, `/api/hr/employees/${encodeURIComponent(employeeId)}/card`, getAccessToken(), signal ? { signal } : {});
    } catch {
        return null; // بلا سر QR أو بلا صلاحية — القسم يختفي بنعومة.
    }
}
