import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { isWriteRole, writeJson } from './write';

/**
 * كتابة الرواتب — العمليات الثلاث التي كانت في V2 وحده:
 *
 *   توليد المسير        POST /api/hr/payroll-runs/generate   (hr-routes.js:409)
 *   معاينة الخصومات     GET  /api/hr/deductions/preview      (hr-routes.js:825)
 *   تطبيق الخصومات      POST /api/hr/deductions/apply        (hr-routes.js:842)
 *
 * الأدوار هي `ADMIN_ROLES` في الخادم حرفيًّا (`admin|hr|manager`).
 * كل الحسابات المالية تبقى على الخادم: الواجهة ترسل الشهر فقط وتقرأ
 * المجاميع كما وردت، ولا تعيد جمع أو تقريب أي مبلغ.
 *
 * حالات الرفض التي يجب أن تصل للمستخدم بنصّها:
 *   409 PAYROLL_ALREADY_POSTED — الشهر مُرحّل محاسبيًا.
 *   423 PERIOD_LOCKED          — الفترة مقفلة.
 *   503 PERIOD_CHECK_UNAVAILABLE — تعذّر التحقق من الفترة (لا كتابة).
 */

/** أدوار التوليد والخصومات — `ADMIN_ROLES` في hr-routes.js:16. */
export const PAYROLL_WRITE_ROLES = ['admin', 'hr', 'manager'] as const;

export function canWritePayroll(role: string | null | undefined): boolean {
    return isWriteRole(role, PAYROLL_WRITE_ROLES);
}

/** صيغة الشهر المعتمدة عند الخادم — `^\d{4}-\d{2}$`. */
const MONTH_PATTERN = /^\d{4}-(\d{2})$/;

/** تحقق الشهر محليًّا بنفس رسالة الخادم (`PAYROLL_MONTH_INVALID`). */
export function payrollMonthError(month: unknown): string {
    const value = String(month ?? '').trim();
    if (!MONTH_PATTERN.test(value)) {
        return 'الشهر بصيغة YYYY-MM';
    }
    const number = Number(value.slice(5, 7));
    return number >= 1 && number <= 12 ? '' : 'شهر غير صالح';
}

const money = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined ? '0' : String(value)));

const count = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
    });

export const payrollTotalsSchema = z
    .object({
        basic: money,
        overtime: money,
        bonuses: money,
        penalties: money,
        advances: money,
        net: money,
    })
    .passthrough();

export const payrollGenerateSchema = z
    .object({
        ok: z.boolean().optional(),
        month: z.string(),
        count: count,
        totals: payrollTotalsSchema.optional(),
        detail: z.array(z.object({}).passthrough()).optional(),
    })
    .passthrough();

export type PayrollGenerateResult = z.infer<typeof payrollGenerateSchema>;

export const deductionEmployeeSchema = z
    .object({
        employeeId: z.union([z.string(), z.number()]).transform((value) => String(value)),
        name: z.string().nullable().optional(),
        employeeCode: z.string().nullable().optional(),
        salary: money,
        workDayMinutes: count,
        daysPresent: count,
        lateMinutes: count,
        absentDays: count,
        lateDeduction: money,
        absentDeduction: money,
        totalDeduction: money,
    })
    .passthrough();

export type DeductionEmployee = z.infer<typeof deductionEmployeeSchema>;

export const deductionPreviewSchema = z
    .object({
        ok: z.boolean().optional(),
        month: z.string(),
        skipFridays: z.boolean().optional(),
        totals: z.object({ late: money, absent: money, total: money }).passthrough().optional(),
        employees: z.array(deductionEmployeeSchema),
    })
    .passthrough();

export type DeductionPreview = z.infer<typeof deductionPreviewSchema>;

export const deductionApplySchema = z
    .object({
        ok: z.boolean().optional(),
        month: z.string(),
        insertedRows: count,
        totalAmount: money,
        employees: count,
    })
    .passthrough();

export type DeductionApplyResult = z.infer<typeof deductionApplySchema>;

/** معاينة الخصومات — نفس معاملات V2 (`month`, `skip_fridays`). */
export function deductionPreviewPath(month: string, skipFridays: boolean): string {
    const params = new URLSearchParams({ month: String(month) });
    params.set('skip_fridays', skipFridays ? '1' : '0');
    return `/api/hr/deductions/preview?${params.toString()}`;
}

/** توليد مسير الشهر — `includeOvertime` اختياري على الخادم (افتراضي false). */
export async function generatePayrollRun(month: string, includeOvertime: boolean): Promise<PayrollGenerateResult> {
    return writeJson(payrollGenerateSchema, '/api/hr/payroll-runs/generate', 'POST', {
        month: String(month),
        includeOvertime: Boolean(includeOvertime),
    });
}

/** معاينة الخصومات — قراءة لا تكتب شيئًا. */
export async function previewDeductions(month: string, skipFridays: boolean, signal?: AbortSignal): Promise<DeductionPreview> {
    return fetchJson(deductionPreviewSchema, deductionPreviewPath(month, skipFridays), getAccessToken(), signal ? { signal } : {});
}

/** تطبيق الخصومات — يستبدل البنود الآلية السابقة ولا يمسّ اليدوية. */
export async function applyDeductions(month: string, skipFridays: boolean): Promise<DeductionApplyResult> {
    return writeJson(deductionApplySchema, '/api/hr/deductions/apply', 'POST', {
        month: String(month),
        skipFridays: Boolean(skipFridays),
    });
}

/** نصوص الشاشة — عربية، ومطابقة لرسائل V2 حيث وُجدت. */
export const PAYROLL_WRITE_TEXT = {
    generateTitle: 'توليد مسير الرواتب',
    generateHint:
        'يحسب الخادم الأساسي والعلاوات والجزاءات وأقساط السلف من بيانات الشهر، ثم يحدّث المسير أو ينشئه. إعادة التوليد لنفس الشهر آمنة ما لم يكن مُرحّلًا محاسبيًّا.',
    generate: 'توليد المسير',
    overtime: 'احتساب الأوفرتايم من البصمات',
    deductionsTitle: 'معاينة وتطبيق الخصومات',
    deductionsHint:
        'معاينة الخصومات تحسب التأخير والغياب من البصمات دون كتابة. التطبيق يستبدل الخصومات الآلية السابقة لهذا الشهر ويترك اليدوية كما هي.',
    preview: 'معاينة',
    apply: 'تطبيق الخصومات',
    applyConfirm: (month: string, total: string, rows: number) =>
        `تطبيق الخصومات الآلية لشهر ${month}؟ سيُستبدل ${String(rows)} بندًا آليًّا سابقًا بإجمالي ${total}.`,
    applied: (month: string, rows: number, total: string) => `طُبّقت خصومات ${month}: ${String(rows)} بندًا بإجمالي ${total}`,
    generated: (month: string, employees: number, net: string) => `وُلّد مسير ${month}: ${String(employees)} موظفًا بصافي ${net}`,
    generateFailed: 'تعذر توليد المسير',
    previewFailed: 'تعذر حساب معاينة الخصومات',
    applyFailed: 'تعذر تطبيق الخصومات',
    skipFridays: 'استثناء أيام الجمعة من حساب الغياب',
    none: 'لا خصومات مستحقة في هذا الشهر.',
    close: 'إغلاق',
} as const;
