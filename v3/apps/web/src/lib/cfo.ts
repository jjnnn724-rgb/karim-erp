import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { num } from './reporting';

/**
 * المدير المالي — قراءة فقط، بنفس أبواب v2 (`cfo-repo.js`) بلا باب جديد:
 *
 *   /api/accounting/cfo-summary?from&to   اللوحة (كل رقم يبنيه الخادم)
 *   /api/accounting/trial-balance?from&to ميزان المراجعة
 *   /api/accounting/journal?limit=30      دفتر اليومية
 *   /api/accounting/periods               قفل الفترات (24 شهرًا)
 *   /api/pos/shifts/open                  ورديات الكاشير المفتوحة
 *   /api/pos/day-close/status             جاهزية إقفال اليوم Z
 *
 * أبواب الكتابة الثمانية عشر في v2 (قيد/اعتماد/إلغاء/قفل فترة/رواتب/بنك/
 * أصول/عهد/موازنات/إقفال Z) خارج نطاق v3 بقرار القراءة فقط — تُنفَّذ في v2.
 *
 * كل مصدر فاشل يُسمّى في `failures` وتُعرض البقية؛ لا صفر يبدو بيانات.
 */

const numLike = z.union([z.string(), z.number()]).nullable().optional();
const text = z.string().nullable().optional();
const flag = z.boolean().nullable().optional();

const money = z.object({ amount: numLike, margin_pct: numLike }).passthrough();

export const cfoSummarySchema = z
    .object({
        from: text,
        to: text,
        revenue: z.object({ total: numLike, count: numLike }).passthrough().optional(),
        expenses: z.object({ total: numLike, count: numLike }).passthrough().optional(),
        cogs: z.object({ net: numLike }).passthrough().optional(),
        payroll_open: numLike,
        pos: z.object({ invoices: numLike, total: numLike }).passthrough().optional(),
        cash_position: numLike,
        cash_ledger: z
            .object({ petty_cash: numLike, bank: numLike })
            .passthrough()
            .optional(),
        journal_entries: numLike,
        journal_entries_all_time: numLike,
        gross_profit: money.optional(),
        net_profit: money.optional(),
        reconciliation: z
            .object({
                status: text,
                difference: numLike,
                unposted_rows: numLike,
                mirror_revenue: numLike,
                ledger_revenue: numLike,
            })
            .passthrough()
            .optional(),
        revenue_by_dept: z
            .array(
                z
                    .object({ code: text, name: text, total: numLike, net: numLike, margin_pct: numLike })
                    .passthrough(),
            )
            .optional(),
        top_expense_categories: z
            .array(z.object({ category: text, total: numLike }).passthrough())
            .optional(),
    })
    .passthrough();

export type CfoSummary = z.infer<typeof cfoSummarySchema>;

export const trialBalanceSchema = z
    .object({
        from: text,
        to: text,
        accounts: z
            .array(
                z
                    .object({
                        code: text,
                        name_ar: text,
                        name_en: text,
                        type: text,
                        debit: numLike,
                        credit: numLike,
                    })
                    .passthrough(),
            )
            .optional(),
        total_debit: numLike,
        total_credit: numLike,
        balanced: flag,
    })
    .passthrough();

export type TrialBalance = z.infer<typeof trialBalanceSchema>;

const journalLineSchema = z
    .object({ account_code: text, debit: numLike, credit: numLike, memo: text })
    .passthrough();

export const journalEntrySchema = z
    .object({
        id: z.union([z.string(), z.number()]),
        entry_no: text,
        date: text,
        memo: text,
        source_type: text,
        source_id: text,
        status: text,
        lines: z.array(journalLineSchema).optional(),
    })
    .passthrough();

export type JournalEntry = z.infer<typeof journalEntrySchema>;
export const journalSchema = z.array(journalEntrySchema);

export const periodsSchema = z
    .object({
        periods: z
            .array(
                z
                    .object({
                        period: text,
                        closed: flag,
                        closed_at: text,
                        closed_by_name: text,
                        posted: numLike,
                        drafts: numLike,
                    })
                    .passthrough(),
            )
            .optional(),
    })
    .passthrough();

export type AccountingPeriods = z.infer<typeof periodsSchema>;

export const openShiftsSchema = z
    .object({
        count: numLike,
        shifts: z
            .array(
                z
                    .object({
                        id: z.union([z.string(), z.number()]),
                        cashier_name: text,
                        dept_name: text,
                        biz_date: text,
                        opening_balance: numLike,
                        expected_cash: numLike,
                        invoice_count: numLike,
                    })
                    .passthrough(),
            )
            .optional(),
    })
    .passthrough();

export type OpenShifts = z.infer<typeof openShiftsSchema>;

export const dayCloseSchema = z
    .object({
        date: text,
        today: text,
        existing_z: z.unknown().nullable().optional(),
        open: z.array(z.unknown()).optional(),
        closed: z.array(z.unknown()).optional(),
        stale_open: z.array(z.unknown()).optional(),
        threshold: numLike,
        can_close: flag,
    })
    .passthrough();

export type DayClose = z.infer<typeof dayCloseSchema>;

export interface CfoSnapshot {
    summary: CfoSummary | null;
    trialBalance: TrialBalance | null;
    journal: JournalEntry[];
    periods: AccountingPeriods | null;
    openShifts: OpenShifts | null;
    dayClose: DayClose | null;
    failures: string[];
}

function failureName(result: PromiseSettledResult<unknown>, name: string): string | null {
    if (result.status !== 'rejected') {
        return null;
    }
    const reason = result.reason instanceof Error ? result.reason.message : 'لم يستجب';
    return `${name}: ${reason}`;
}

export async function fetchCfoSnapshot(
    from: string,
    to: string,
    signal?: AbortSignal,
): Promise<CfoSnapshot> {
    const token = getAccessToken();
    const options = signal ? { signal } : {};
    const settled = await Promise.allSettled([
        fetchJson(
            cfoSummarySchema,
            `/api/accounting/cfo-summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
            token,
            options,
        ),
        fetchJson(
            trialBalanceSchema,
            `/api/accounting/trial-balance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
            token,
            options,
        ),
        fetchJson(journalSchema, '/api/accounting/journal?limit=30', token, options),
        fetchJson(periodsSchema, '/api/accounting/periods', token, options),
        fetchJson(openShiftsSchema, '/api/pos/shifts/open', token, options),
        fetchJson(dayCloseSchema, '/api/pos/day-close/status', token, options),
    ]);

    const at = <T,>(index: number): T | null => {
        const result = settled[index];
        return result && result.status === 'fulfilled' ? (result.value as T) : null;
    };

    return {
        summary: at<CfoSummary>(0),
        trialBalance: at<TrialBalance>(1),
        journal: at<JournalEntry[]>(2) ?? [],
        periods: at<AccountingPeriods>(3),
        openShifts: at<OpenShifts>(4),
        dayClose: at<DayClose>(5),
        failures: [
            failureName(settled[0] ?? { status: 'rejected', reason: 'لم يستجب' }, 'ملخص المدير المالي'),
            failureName(settled[1] ?? { status: 'rejected', reason: 'لم يستجب' }, 'ميزان المراجعة'),
            failureName(settled[2] ?? { status: 'rejected', reason: 'لم يستجب' }, 'دفتر اليومية'),
            failureName(settled[3] ?? { status: 'rejected', reason: 'لم يستجب' }, 'الفترات المحاسبية'),
            failureName(settled[4] ?? { status: 'rejected', reason: 'لم يستجب' }, 'الورديات المفتوحة'),
            failureName(settled[5] ?? { status: 'rejected', reason: 'لم يستجب' }, 'حالة الإقفال'),
        ].filter((value): value is string => Boolean(value)),
    };
}

/** حالة تسوية الدفتر مع مرآة الكاشير — نغمة العرض من نص الخادم. */
export function reconciliationTone(status: string): 'success' | 'danger' | 'neutral' {
    if (!status) {
        return 'neutral';
    }
    return status === 'متوافق' ? 'success' : 'danger';
}

/** نسبة الهامش من كائن مالي — تُعرض «—» حين لا يرسل الخادم أساسًا. */
export function marginText(value: unknown): string {
    if (value === null || value === undefined || value === '') {
        return '—';
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? `${parsed.toFixed(1)}%` : '—';
}

export function balanceLine(trialBalance: TrialBalance | null): string {
    if (!trialBalance) {
        return '—';
    }
    const debit = num(trialBalance.total_debit);
    const credit = num(trialBalance.total_credit);
    return `${debit.toFixed(2)} / ${credit.toFixed(2)}`;
}
