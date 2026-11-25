import { z } from 'zod';
import { ApiError, fetchJson } from './api';
import { getAccessToken } from './auth';

const moneySchema = z.string().regex(/^-?\d+\.\d{2}$/);

export const complianceAlertSchema = z.looseObject({
    type: z.string(),
    severity: z.enum(['warning', 'high']),
    title: z.string(),
    reference: z.string().nullable().optional(),
    date: z.string().nullable().optional(),
    employeeId: z.string().nullable().optional(),
    employeeName: z.string().nullable().optional(),
    expiryDate: z.string().nullable().optional(),
    blocker: z.string().nullable().optional(),
});

export const complianceDashboardSchema = z.looseObject({
    period: z.object({ from: z.string(), to: z.string() }),
    kpis: z.object({
        totalSales: moneySchema,
        outputVat: moneySchema,
        inputVat: moneySchema,
        netPayable: moneySchema,
    }),
    alerts: z.array(complianceAlertSchema),
});
export type ComplianceDashboard = z.infer<typeof complianceDashboardSchema>;

const vatBlockSchema = z.looseObject({
    sourceType: z.string().nullable().optional(),
    documentId: z.string().nullable().optional(),
    invoiceReference: z.string().nullable().optional(),
    invoiceDate: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    blocker: z.string().nullable().optional(),
    count: z.number().optional(),
});

const vatSuccessSchema = z.looseObject({
    ok: z.literal(true),
    valid: z.literal(true),
    period: z.object({
        taxPeriodId: z.string().nullable(),
        from: z.string(),
        to: z.string(),
    }),
    summary: z.looseObject({
        outputVat: moneySchema,
        inputVat: moneySchema,
        netVatPayable: moneySchema,
        ledgerNetVat: moneySchema,
    }),
});

const vatBlockedSchema = z.looseObject({
    error: z.string(),
    message: z.string(),
    blockingInvoices: z.array(vatBlockSchema),
    period: z
        .object({
            taxPeriodId: z.string().nullable(),
            from: z.string(),
            to: z.string(),
        })
        .optional(),
});

export type VatStatus =
    | { readonly ok: true; readonly data: z.infer<typeof vatSuccessSchema> }
    | { readonly ok: false; readonly data: z.infer<typeof vatBlockedSchema> };

const gosiCalculationSchema = z.looseObject({
    employeeId: z.string(),
    payrollId: z.string().nullable(),
    employeeName: z.string(),
    insuredCategory: z.enum(['saudi', 'expat']).nullable(),
    basicSalary: moneySchema.nullable().optional(),
    contributionBase: moneySchema.nullable().optional(),
    employeeContribution: moneySchema.nullable().optional(),
    employerContribution: moneySchema.nullable().optional(),
    blockers: z.array(z.looseObject({ code: z.string() })),
});

export const gosiMonthSchema = z.looseObject({
    month: z.string(),
    calculations: z.array(
        z.looseObject({
            payrollId: z.string(),
            employeeId: z.string(),
            employeeName: z.string(),
            payrollStatus: z.string(),
            calculation: gosiCalculationSchema.nullable(),
            payrollApprovalAllowed: z.boolean(),
            blockers: z.array(z.looseObject({ code: z.string() })),
        }),
    ),
    totals: z.object({
        employeeContribution: moneySchema,
        employerContribution: moneySchema,
        totalContribution: moneySchema,
    }),
    payrollApprovalAllowed: z.boolean(),
});
export type GosiMonth = z.infer<typeof gosiMonthSchema>;

export const bankMatchSchema = z.object({
    matched: z.array(
        z.object({
            bankTransactionId: z.string(),
            journalEntryId: z.string(),
        }),
    ),
    unmatched: z.array(
        z.object({
            bankTransactionId: z.string(),
            reason: z.string(),
            journalEntryId: z.string().nullable().optional(),
        }),
    ),
});
export type BankMatchResult = z.infer<typeof bankMatchSchema>;

export async function fetchComplianceDashboard(signal?: AbortSignal): Promise<ComplianceDashboard> {
    return fetchJson(complianceDashboardSchema, '/api/v3/dashboard', getAccessToken(), signal ? { signal } : {});
}

export async function fetchVatStatus(signal?: AbortSignal): Promise<VatStatus> {
    try {
        const data = await fetchJson(vatSuccessSchema, '/api/v3/vat/status', getAccessToken(), signal ? { signal } : {});
        return { ok: true, data };
    } catch (error) {
        if (error instanceof ApiError && error.status === 422) {
            const parsed = vatBlockedSchema.safeParse(error.payload);
            if (parsed.success) {
                return { ok: false, data: parsed.data };
            }
        }
        throw error;
    }
}

export async function fetchGosiMonth(signal?: AbortSignal): Promise<GosiMonth> {
    return fetchJson(gosiMonthSchema, '/api/v3/payroll/gosi', getAccessToken(), signal ? { signal } : {});
}

export async function submitBankMatches(statementIds: readonly string[]): Promise<BankMatchResult> {
    return fetchJson(bankMatchSchema, '/api/v3/bank/match', getAccessToken(), {
        method: 'POST',
        body: { transactions: statementIds.map((id) => ({ id })) },
    });
}
