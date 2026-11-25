import { z } from 'zod';

export const cashierDeptRowSchema = z.object({
    department_id: z.string().or(z.number()).optional(),
    department_name: z.string().optional().default('القسم'),
    total: z.string().or(z.number()).optional().default(0),
    count: z.string().or(z.number()).optional().default(0),
});

export const briefingResponseSchema = z.object({
    day: z.string().optional(),
    yesterday: z.string().optional(),
    generatedAt: z.string().optional(),
    cashiers: z.array(cashierDeptRowSchema).optional().default([]),
    cashiersTotal: z.record(z.string(), z.unknown()).optional().default({}),
    pos: z.record(z.string(), z.unknown()).optional().default({}),
    expenses: z.record(z.string(), z.unknown()).optional().default({}),
    stockOut: z.array(z.record(z.string(), z.unknown())).optional().default([]),
    stockLow: z.array(z.record(z.string(), z.unknown())).optional().default([]),
    attendance: z.record(z.string(), z.unknown()).optional().default({}),
    payments: z.array(z.record(z.string(), z.unknown())).optional().default([]),
});
export type BriefingResponse = z.infer<typeof briefingResponseSchema>;

export const posStatsResponseSchema = z.object({
    ok: z.boolean().optional().default(true),
    orders_count: z.number().optional().default(0),
    total_sales: z.string().or(z.number()).optional().default(0),
    avg_ticket: z.string().or(z.number()).optional().default(0),
    recent_orders: z.array(z.record(z.string(), z.unknown())).optional().default([]),
});
export type PosStatsResponse = z.infer<typeof posStatsResponseSchema>;

export function parseNumericVal(val: unknown): number {
    if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
    if (typeof val === 'string') {
        const parsed = Number.parseFloat(val);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}
