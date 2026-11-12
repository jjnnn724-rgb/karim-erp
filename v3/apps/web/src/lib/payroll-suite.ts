import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { entityPageSchema } from './settings';
import { isWriteRole, writeAck } from './write';

/**
 * أبواب منظومة الرواتب الأربعة — عقود V2 حرفيًّا (`payroll-suite.js:1-130`):
 *
 *   السلف        CRUD /api/salary_advances    {employeeId,amount,date,monthly_deduction,remaining,status,notes}
 *   البنود       CRUD /api/payroll_adjustments {employeeId,month,kind,amount,reason}
 *   العقود       CRUD /api/employee_contracts  {employeeId,start_date,end_date,salary,notes}
 *   التقييمات    CRUD /api/employee_evaluations {employeeId,period,score,notes,evaluator}
 *
 * الحقول القابلة للكتابة هي قائمة `schema-registry` حرفيًّا؛ أي مفتاح زائد
 * يرفض الطلب كله (400 INVALID_PAYLOAD). الأدوار `admin|manager|hr` هي
 * `OPEN_ENTITY_WRITE_ROLES` في الخادم، وهي نفسها `PAYROLL_WRITE_ROLES` في V2.
 * لا حساب مالي هنا: المبالغ تُرسل كما كتبها المستخدم وتُقرأ كما أعادها الخادم.
 */

export const PAYROLL_SUITE_ROLES = ['admin', 'manager', 'hr'] as const;

export function canWritePayrollSuite(role: string | null | undefined): boolean {
    return isWriteRole(role, PAYROLL_SUITE_ROLES);
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function monthProblem(value: string): string {
    if (!MONTH_PATTERN.test(value)) {
        return 'الشهر بصيغة YYYY-MM';
    }
    const number = Number(value.slice(5, 7));
    return number >= 1 && number <= 12 ? '' : 'شهر غير صالح';
}

const text = z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value) => (value === null || value === undefined ? '' : String(value)));

const amount = z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value) => {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
    });

const idField = z.union([z.string(), z.number()]).transform((value) => String(value));

function entityRowsSchema<T extends z.ZodTypeAny>(row: T) {
    return entityPageSchema.transform((page) => {
        const rows: z.infer<T>[] = [];
        for (const raw of page.data) {
            const parsed = row.safeParse(raw);
            if (parsed.success) {
                rows.push(parsed.data);
            }
        }
        return rows;
    });
}

export const advanceSchema = z
    .object({
        id: idField,
        employeeId: text,
        amount: amount,
        monthly_deduction: amount,
        remaining: amount,
        status: text,
        date: text,
        notes: text,
    })
    .passthrough();

export const adjustmentSchema = z
    .object({
        id: idField,
        employeeId: text,
        month: text,
        kind: text,
        amount: amount,
        reason: text,
    })
    .passthrough();

export const contractSchema = z
    .object({
        id: idField,
        employeeId: text,
        start_date: text,
        end_date: text,
        salary: amount,
        notes: text,
    })
    .passthrough();

export const evaluationSchema = z
    .object({
        id: idField,
        employeeId: text,
        period: text,
        score: amount,
        notes: text,
        evaluator: text,
    })
    .passthrough();

export type PayrollAdvance = z.infer<typeof advanceSchema>;
export type PayrollAdjustment = z.infer<typeof adjustmentSchema>;
export type PayrollContract = z.infer<typeof contractSchema>;
export type PayrollEvaluation = z.infer<typeof evaluationSchema>;

const ADVANCES = 'salary_advances';
const ADJUSTMENTS = 'payroll_adjustments';
const CONTRACTS = 'employee_contracts';
const EVALUATIONS = 'employee_evaluations';

function listPath(entity: string): string {
    return `/api/${entity}?page=1&limit=1000&sort=id&order=desc`;
}

export async function fetchAdvances(signal?: AbortSignal): Promise<PayrollAdvance[]> {
    return fetchJson(entityRowsSchema(advanceSchema), listPath(ADVANCES), getAccessToken(), signal ? { signal } : {});
}

export async function fetchAdjustments(signal?: AbortSignal): Promise<PayrollAdjustment[]> {
    return fetchJson(entityRowsSchema(adjustmentSchema), listPath(ADJUSTMENTS), getAccessToken(), signal ? { signal } : {});
}

export async function fetchContracts(signal?: AbortSignal): Promise<PayrollContract[]> {
    return fetchJson(entityRowsSchema(contractSchema), listPath(CONTRACTS), getAccessToken(), signal ? { signal } : {});
}

export async function fetchEvaluations(signal?: AbortSignal): Promise<PayrollEvaluation[]> {
    return fetchJson(entityRowsSchema(evaluationSchema), listPath(EVALUATIONS), getAccessToken(), signal ? { signal } : {});
}

export interface AdvanceInput {
    employeeId: number;
    amount: number;
    monthlyDeduction: number;
    date: string;
}

export function validateAdvance(input: AdvanceInput): string {
    if (!input.employeeId || !(input.amount > 0)) {
        return 'اختر الموظف واكتب مبلغًا أكبر من صفر';
    }
    if (!ISO_DAY_PATTERN.test(input.date)) {
        return 'التاريخ بصيغة YYYY-MM-DD';
    }
    if (input.monthlyDeduction < 0) {
        return 'القسط لا يكون سالبًا';
    }
    return '';
}

export async function createAdvance(input: AdvanceInput): Promise<void> {
    await writeAck(`/api/${ADVANCES}`, 'POST', {
        employeeId: input.employeeId,
        amount: input.amount,
        monthly_deduction: input.monthlyDeduction,
        remaining: input.amount,
        status: 'active',
        date: input.date,
    });
}

export const ADJUSTMENT_KINDS = [
    { value: 'penalty', label: 'جزاء' },
    { value: 'bonus', label: 'علاوة' },
    { value: 'deduction', label: 'خصم' },
    { value: 'allowance', label: 'بدل' },
] as const;

export function adjustmentKindName(kind: string): string {
    return ADJUSTMENT_KINDS.find((entry) => entry.value === kind)?.label ?? (kind || '—');
}

export interface AdjustmentInput {
    employeeId: number;
    month: string;
    kind: string;
    amount: number;
    reason: string;
}

export function validateAdjustment(input: AdjustmentInput): string {
    if (!input.employeeId) {
        return 'اختر الموظف';
    }
    const month = monthProblem(input.month);
    if (month) {
        return month;
    }
    if (!(input.amount > 0)) {
        return 'اكتب مبلغًا أكبر من صفر';
    }
    if (!ADJUSTMENT_KINDS.some((entry) => entry.value === input.kind)) {
        return 'اختر نوع البند';
    }
    return '';
}

export async function createAdjustment(input: AdjustmentInput): Promise<void> {
    await writeAck(`/api/${ADJUSTMENTS}`, 'POST', {
        employeeId: input.employeeId,
        month: input.month,
        kind: input.kind,
        amount: input.amount,
        reason: input.reason.trim(),
    });
}

export interface ContractInput {
    employeeId: number;
    startDate: string;
    endDate: string;
    salary: number;
}

export function validateContract(input: ContractInput): string {
    if (!input.employeeId) {
        return 'اختر الموظف';
    }
    if (!ISO_DAY_PATTERN.test(input.startDate) || !ISO_DAY_PATTERN.test(input.endDate)) {
        return 'التواريخ بصيغة YYYY-MM-DD';
    }
    if (input.endDate < input.startDate) {
        return 'نهاية العقد قبل بدايته';
    }
    if (input.salary < 0) {
        return 'الراتب لا يكون سالبًا';
    }
    return '';
}

export async function createContract(input: ContractInput): Promise<void> {
    await writeAck(`/api/${CONTRACTS}`, 'POST', {
        employeeId: input.employeeId,
        start_date: input.startDate,
        end_date: input.endDate,
        salary: input.salary,
    });
}

export type ContractState = { label: string; tone: 'success' | 'warning' | 'danger' };

/** حالة العقد كما في V2 (`payroll.js:199-202`): منتهٍ/متبقٍ N يوم/سارٍ. */
export function contractState(endDate: string, today: Date = new Date()): ContractState {
    if (!ISO_DAY_PATTERN.test(endDate)) {
        return { label: 'تاريخ غير صالح', tone: 'warning' };
    }
    const end = Date.parse(`${endDate}T00:00:00Z`);
    const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const left = Math.ceil((end - now) / 86400000);
    if (left < 0) {
        return { label: 'منتهٍ', tone: 'danger' };
    }
    if (left <= 30) {
        return { label: `متبقٍ ${String(left)} يوم`, tone: 'warning' };
    }
    return { label: 'سارٍ', tone: 'success' };
}

export interface EvaluationInput {
    employeeId: number;
    period: string;
    score: number;
    notes: string;
    evaluator: string;
}

export function validateEvaluation(input: EvaluationInput): string {
    if (!input.employeeId) {
        return 'اختر الموظف';
    }
    const period = monthProblem(input.period);
    if (period) {
        return period;
    }
    if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) {
        return 'التقييم من 1 إلى 5';
    }
    return '';
}

export async function createEvaluation(input: EvaluationInput): Promise<void> {
    await writeAck(`/api/${EVALUATIONS}`, 'POST', {
        employeeId: input.employeeId,
        period: input.period,
        score: input.score,
        notes: input.notes.trim(),
        evaluator: input.evaluator.trim(),
    });
}

export type PayrollSuiteEntity = 'advances' | 'adjustments' | 'contracts' | 'evaluations';

const ENTITY_PATH: Record<PayrollSuiteEntity, string> = {
    advances: ADVANCES,
    adjustments: ADJUSTMENTS,
    contracts: CONTRACTS,
    evaluations: EVALUATIONS,
};

export async function removePayrollSuiteRow(entity: PayrollSuiteEntity, id: string): Promise<void> {
    await writeAck(`/api/${ENTITY_PATH[entity]}/${encodeURIComponent(id)}`, 'DELETE');
}

export function evaluationStars(score: number): string {
    const filled = Math.max(0, Math.min(5, Math.round(score)));
    return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

/** سطر CSV واحد — كل خلية بين علامتي تنصيص مع مضاعفة الداخلي (`attendanceCsv` نفسها). */
function csvCell(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

export function payrollSheetCsv(
    rows: readonly { name: string; dept: string; position: string; salary: string | null; days: number }[],
): string {
    const lines = [['الموظف', 'القسم', 'المنصب', 'الراتب الأساسي', 'أيام الحضور'].map(csvCell).join(',')];
    for (const row of rows) {
        lines.push([row.name, row.dept, row.position, row.salary ?? '', String(row.days)].map(csvCell).join(','));
    }
    return lines.join('\r\n');
}
