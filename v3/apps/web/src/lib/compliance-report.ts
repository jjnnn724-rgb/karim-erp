import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * تقرير الامتثال الشهري — `/api/integration/monthly-report?month=YYYY-MM` (admin فقط).
 *
 * كل حقول الشاشة اختيارية: غياب GOSI rate_set يُعلن rate_set_required
 * بدل أن يُعرض صفر. لا أي حساب هنا ولا أي تقريب — الشاشة عرض فقط.
 */
export const complianceReportPayloadSchema = z
    .object({
        ok: z.boolean().optional(),
        report: z
            .object({
                month: z.string(),
                generated_at: z.string(),
                employer: z.object({ crn: z.string().nullable(), name: z.string().nullable() }).passthrough(),
                payroll: z
                    .object({
                        active_employees: z.number(),
                        employees_with_line: z.number(),
                        employees_without_line: z.number(),
                        totals: z.object({
                            basic: z.number(),
                            allowances: z.number(),
                            deductions: z.number(),
                            net: z.number(),
                        }),
                        posted: z.boolean(),
                    })
                    .passthrough(),
                readiness: z
                    .object({
                        percent: z.number(),
                        export_ready: z.boolean(),
                        blockers: z.array(z.string()),
                        summary: z.object({ ready: z.number() }).passthrough(),
                    })
                    .passthrough(),
                global_blockers: z.array(z.string()),
                export_ready: z.boolean(),
                gosi: z
                    .object({
                        rate_set_required: z.boolean().optional(),
                        note: z.string().optional(),
                        rate_set: z.object({ id: z.string(), label_ar: z.string(), verified: z.boolean() }).passthrough().optional(),
                        preview: z
                            .object({
                                totals: z
                                    .object({
                                        saudiEmployee: z.number().optional(),
                                        saudiEmployer: z.number().optional(),
                                        expatEmployer: z.number().optional(),
                                    })
                                    .passthrough()
                                    .optional(),
                            })
                            .passthrough()
                            .optional(),
                    })
                    .passthrough(),
                qiwa: z
                    .object({
                        checks: z.array(
                            z
                                .object({
                                    id: z.string(),
                                    label_ar: z.string(),
                                    ok: z.boolean(),
                                    detail: z.string().optional(),
                                })
                                .passthrough(),
                        ),
                        ready: z.boolean().nullable(),
                    })
                    .passthrough(),
            })
            .passthrough(),
    })
    .passthrough();

export type ComplianceReportPayload = z.infer<typeof complianceReportPayloadSchema>;

export async function fetchComplianceReport(month: string, rateSetId: string, signal?: AbortSignal): Promise<ComplianceReportPayload> {
    const params = new URLSearchParams({ month, rate_set: rateSetId });
    return fetchJson(
        complianceReportPayloadSchema,
        `/api/integration/monthly-report?${params.toString()}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}
